import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import AdmZip from "adm-zip";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { detectProject, isGodotPreflightTextFile, providers } from "@game2web/providers";
import type { ProjectFile, ProviderId } from "@game2web/shared";
import { deleteObject, ensureBucket, getObject, putObject } from "@game2web/storage";
import { createPreviewDeploymentProvider } from "@game2web/deployment";
import { createSession, hashPassword, logout, requireUser, validEmail, validPassword, verifyPassword } from "./auth.js";
import { assertBucket } from "@game2web/storage";
import { statfs } from "node:fs/promises";

const prisma = new PrismaClient();
const queue = new Queue("game-builds", { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } });
const limits = { maxBytes: Number(process.env.BUILD_MAX_UPLOAD_MB ?? 500) * 1024 * 1024, maxFiles: Number(process.env.BUILD_MAX_FILES ?? 10_000), maxExpandedBytes: Number(process.env.BUILD_MAX_EXPANDED_SOURCE_MB ?? 1024) * 1024 * 1024, maxCompressionRatio: Number(process.env.BUILD_MAX_COMPRESSION_RATIO ?? 100) };
const app = Fastify({ logger: true });
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const playerOrigin = process.env.PLAYER_ORIGIN ?? "http://localhost:3000";
const previewProvider = createPreviewDeploymentProvider();
const appFrameOrigins = [...new Set([appOrigin, appOrigin.replace("localhost", "127.0.0.1")])].join(" ");
const rateBuckets = new Map<string, { count: number; reset: number }>();
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (_request.url.startsWith("/api/play/") || _request.url.startsWith("/api/preview/")) {
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors " + appFrameOrigins);
  } else {
    reply.header("Content-Security-Policy", `default-src 'self'; frame-src 'self' ${playerOrigin}`);
  }
});
await app.register(cors, {
  origin: (origin, callback) => callback(null, origin === appOrigin ? appOrigin : false),
  credentials: true
});
await app.register(multipart, { limits: { fileSize: limits.maxBytes, files: 1, fields: 4 } });

app.get("/health", async () => ({ status: "ok", service: "game2web-api", ai: false }));
app.get("/readiness", async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await queue.client;
    await ensureBucket();
    await assertBucket();
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "not_ready" });
  }
});
app.get("/api/providers", async () => Object.values(providers).map((provider) => ({
  id: provider.id,
  name: provider.id === "godot" ? "Godot" : provider.id === "emscripten-sdl" ? "C/C++ + SDL" : provider.id,
  available: !["unity", "unreal", "dos"].includes(provider.id)
})));
app.post<{ Body: { email?: string; password?: string } }>("/api/auth/register", async (request, reply) => {
  if (!allowed(request.ip, "register", 10, 60000)) return reply.code(429).send({ error: "Too many attempts; try again shortly" });
  const email = request.body?.email?.trim().toLowerCase() ?? "";
  const password = request.body?.password ?? "";
  if (!validEmail(email) || !validPassword(password)) return reply.code(400).send({ error: "Use a valid email and a password of at least 10 characters" });
  try {
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
    await createSession(user.id, reply);
    return reply.code(201).send({ user: { id: user.id, email: user.email } });
  } catch { return reply.code(409).send({ error: "Unable to create account" }); }
});
app.post<{ Body: { email?: string; password?: string } }>("/api/auth/login", async (request, reply) => {
  if (!allowed(request.ip, "login", 10, 60000)) return reply.code(429).send({ error: "Too many attempts; try again shortly" });
  const email = request.body?.email?.trim().toLowerCase() ?? "";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(request.body?.password ?? "", user.passwordHash))) return reply.code(401).send({ error: "Invalid email or password" });
  await createSession(user.id, reply);
  return { user: { id: user.id, email: user.email } };
});
app.post("/api/auth/logout", async (request, reply) => { await logout(request, reply); return { ok: true }; });
app.get("/api/auth/me", async (request, reply) => { const user = await requireUser(request, reply); return user ? { id: user.id, email: user.email } : undefined; });
app.get("/api/projects", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, slug: true, name: true, description: true, createdAt: true, builds: { orderBy: { createdAt: "desc" }, take: 1 } } });
});

app.post("/api/projects", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!allowed(user.id, "upload", 30, 3600000)) return reply.code(429).send({ error: "Upload limit reached; try again later" });
  if ((await prisma.project.count({ where: { userId: user.id } })) >= Number(process.env.MAX_PROJECTS ?? 25)) return reply.code(429).send({ error: "Project limit reached" });
  const parts = request.parts();
  let name = "";
  let description = "";
  let redistributionStatus: "LICENSE_REVIEW_REQUIRED" | "REDISTRIBUTION_CLEARED" = "LICENSE_REVIEW_REQUIRED";
  let archive: Buffer | undefined;
  let originalFilename = "";
  for await (const part of parts) {
    if (part.type === "field" && part.fieldname === "name") name = String(part.value);
    else if (part.type === "field" && part.fieldname === "description") description = String(part.value);
    else if (part.type === "field" && part.fieldname === "redistributionStatus" && part.value === "REDISTRIBUTION_CLEARED") redistributionStatus = "REDISTRIBUTION_CLEARED";
    else if (part.type === "file" && part.fieldname === "archive") {
      originalFilename = part.filename;
      archive = await part.toBuffer();
    }
  }
  if (!name.trim() || !archive) return reply.code(400).send({ error: "name and archive are required" });
  if (archive.length > limits.maxBytes) return reply.code(413).send({ error: "source archive exceeds configured upload limit" });
  let files: ProjectFile[];
  try {
    files = archiveEntries(archive);
  } catch (error) {
    return reply.code(422).send({ error: error instanceof Error ? error.message : "Invalid source archive" });
  }
  if (files.length === 0 || files.length > limits.maxFiles) return reply.code(422).send({ error: "source archive has no files or exceeds file count limit" });
  const detected = detectProject(files);
  const report = detected.provider ? await providers[detected.provider].validate(files) : detected;
  const project = await prisma.project.create({ data: { name: name.trim(), slug: `${slugify(name)}-${randomUUID().slice(0, 8)}`, description, userId: user.id, redistributionStatus } });
  const stored = await putObject(`private/sources/${project.id}/source.zip`, archive, "application/zip");
  await prisma.projectFile.createMany({ data: files.map((file) => ({ projectId: project.id, path: file.path, originalFilename, size: file.size, storageKey: stored.key, checksum: stored.checksum })) });
  return reply.code(201).send({ project, source: { originalFilename, storageKey: stored.key, size: stored.size, checksum: stored.checksum }, compatibility: { ...report, projectSizeBytes: stored.size, detectedFiles: files.map((file) => file.path) } });
});

app.post<{ Params: { id: string }; Body: { provider?: ProviderId; mode?: "PRODUCTION" | "PREVIEW" } }>("/api/projects/:id/builds", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const project = await prisma.project.findFirst({ where: { id: request.params.id, userId: user.id }, include: { files: true } });
  if (!project) return reply.code(404).send({ error: "Project not found" });
  const sourceStorageKey = project.files[0]?.storageKey;
  if (!sourceStorageKey || project.files.some((file) => file.storageKey !== sourceStorageKey)) return reply.code(422).send({ error: "Project source archive binding is invalid" });
  const sourceArchive = await getObject(sourceStorageKey);
  const files = archiveEntries(sourceArchive.body);
  const detected = detectProject(files, request.body?.provider);
  const report = detected.provider ? await providers[detected.provider].validate(files) : detected;
  if (!report.compatible || !report.provider) {
    return reply.code(422).send({
      error: report.preflight?.errors.join(" ") || "Project is not compatible with an available provider",
      compatibility: report
    });
  }
  const mode = request.body?.mode ?? "PRODUCTION";
  if (mode !== "PRODUCTION" && mode !== "PREVIEW") return reply.code(400).send({ error: "Build mode must be PRODUCTION or PREVIEW" });
  if (mode === "PRODUCTION" && project.redistributionStatus !== "REDISTRIBUTION_CLEARED") {
    return reply.code(403).send({ error: "Production deployment requires explicit redistribution license clearance; use PREVIEW mode for a temporary owner-authorized test" });
  }
  const activeBuilds = await prisma.build.count({ where: { project: { userId: user.id }, status: { in: ["QUEUED", "PREPARING", "VALIDATING", "BUILDING", "PACKAGING", "UPLOADING"] } } });
  if (activeBuilds >= Number(process.env.MAX_CONCURRENT_BUILDS_PER_USER ?? 2)) return reply.code(429).send({ error: "Build concurrency limit reached; try again later" });
  const totalActiveBuilds = await prisma.build.count({ where: { status: { in: ["QUEUED", "PREPARING", "VALIDATING", "BUILDING", "PACKAGING", "UPLOADING"] } } });
  if (totalActiveBuilds >= Number(process.env.MAX_CONCURRENT_BUILDS ?? 2)) return reply.code(429).send({ error: "Build capacity is currently full; try again later" });
  const filesystem = await statfs(process.env.BUILD_WORKSPACE_ROOT ?? "/tmp");
  const freeMb = (Number(filesystem.bavail) * Number(filesystem.bsize)) / (1024 * 1024);
  if (freeMb < Number(process.env.BUILD_MIN_FREE_DISK_MB ?? 4096)) return reply.code(503).send({ error: "Build capacity is temporarily unavailable" });
  const build = await prisma.build.create({ data: { projectId: project.id, provider: report.provider, status: "QUEUED", mode } });
  await queue.add(build.id, {
    buildId: build.id,
    projectId: project.id,
    provider: report.provider,
    sourceStorageKey,
    godotExportPreset: report.preflight?.webExportPreset,
    godotProjectDirectory: report.preflight?.projectDirectory,
    godotBuilderVersion: report.preflight?.builderVersion,
    generateTemporaryWebPreset: report.preflight?.generateTemporaryWebPreset,
    useCompatibilityRenderer: report.preflight?.useCompatibilityRenderer
  }, { jobId: build.id, removeOnComplete: 100, removeOnFail: 100 });
  return reply.code(202).send({ id: build.id, projectId: project.id, provider: report.provider, status: build.status, preflight: report.preflight });
});
app.post<{ Params: { id: string } }>("/api/builds/:id/previews", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const build = await prisma.build.findFirst({
    where: { id: request.params.id, mode: "PREVIEW", project: { userId: user.id } },
    include: { project: true, artifacts: true }
  });
  if (!build) return reply.code(404).send({ error: "Preview build not found" });
  if (build.status !== "READY") return reply.code(409).send({ error: "Only READY preview builds can be previewed" });
  if (build.artifacts.length === 0) return reply.code(422).send({ error: "Preview build has no validated artifacts" });
  const previousPreview = await prisma.previewDeployment.findUnique({
    where: { buildId: build.id },
    include: { build: { include: { artifacts: true } } }
  });
  if (previousPreview && !previousPreview.revokedAt && previousPreview.expiresAt > new Date()) {
    return reply.code(409).send({ error: "An active preview already exists for this build" });
  }
  if (previousPreview) {
    for (const artifact of previousPreview.build.artifacts) {
      await deleteObject(`${previousPreview.storagePrefix}/${artifact.path}`);
    }
    await prisma.previewDeployment.delete({ where: { id: previousPreview.id } });
  }
  const ttlHours = Number(process.env.PREVIEW_TTL_HOURS ?? 24);
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 168) return reply.code(500).send({ error: "PREVIEW_TTL_HOURS must be between 1 and 168" });

  const previewId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const location = await previewProvider.create({ previewId, buildId: build.id, token });
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await prisma.previewDeployment.create({ data: {
    id: previewId,
    projectId: build.projectId,
    buildId: build.id,
    tokenHash,
    storagePrefix: location.storagePrefix,
    expiresAt
  } });
  const copiedKeys: string[] = [];
  try {
    for (const artifact of build.artifacts) {
      const privatePrefix = `private/${build.projectId}/${build.id}/`;
      if (!artifact.storageKey.startsWith(privatePrefix)) throw new Error("Preview build artifact is outside its private storage namespace");
      const object = await getObject(artifact.storageKey);
      const checksum = createHash("sha256").update(object.body).digest("hex");
      if (checksum !== artifact.checksum) throw new Error(`Preview artifact checksum mismatch: ${artifact.path}`);
      const stored = await putObject(`${location.storagePrefix}/${artifact.path}`, object.body, artifact.mimeType);
      copiedKeys.push(stored.key);
      if (stored.checksum !== artifact.checksum) throw new Error(`Preview artifact copy checksum mismatch: ${artifact.path}`);
    }
  } catch (error) {
    for (const key of copiedKeys) await deleteObject(key);
    await prisma.previewDeployment.delete({ where: { id: previewId } });
    throw error;
  }

  const previewOrigin = process.env.PREVIEW_APP_ORIGIN ?? appOrigin;
  const persistent = process.env.PREVIEW_PERSISTENT === "true"
    && /^https:\/\//i.test(previewOrigin)
    && /^https:\/\//i.test(playerOrigin)
    && /^https:\/\//i.test(process.env.S3_ENDPOINT ?? "");
  return reply.code(201).send({
    id: previewId,
    buildId: build.id,
    url: `${previewOrigin}/preview/${token}`,
    playerPath: location.playerPath,
    expiresAt: expiresAt.toISOString(),
    persistent
  });
});
app.delete<{ Params: { id: string } }>("/api/previews/:id", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const preview = await prisma.previewDeployment.findFirst({
    where: { id: request.params.id, project: { userId: user.id } },
    include: { build: { include: { artifacts: true } } }
  });
  if (!preview) return reply.code(404).send({ error: "Preview not found" });
  for (const artifact of preview.build.artifacts) {
    await deleteObject(`${preview.storagePrefix}/${artifact.path}`);
  }
  await prisma.previewDeployment.delete({ where: { id: preview.id } });
  return reply.code(204).send();
});
app.get<{ Params: { id: string } }>("/api/builds/:id", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const build = await prisma.build.findFirst({ where: { id: request.params.id, project: { userId: user.id } }, include: { artifacts: true, deployment: true, project: true, logs: { orderBy: { createdAt: "asc" } } } });
  if (!build) return reply.code(404).send({ error: "Build not found" });
  return { ...build, artifacts: build.artifacts.map((artifact) => ({ ...artifact, size: Number(artifact.size) })), publicUrl: build.deployment ? `${process.env.PLAYER_ORIGIN ?? "http://localhost:3000"}/play/${build.project.slug}` : undefined };
});
app.get<{ Params: { slug: string; "*": string } }>("/api/play/:slug/*", async (request, reply) => {
  const deployment = await prisma.deployment.findUnique({ where: { slug: request.params.slug }, include: { build: true } });
  if (!deployment || !deployment.published || deployment.build.status !== "READY") return reply.code(404).send({ error: "Published game not found" });
  const requested = request.params["*"] || "index.html";
  const safePath = requested.replaceAll("\\", "/");
  if (safePath.includes("..") || safePath.startsWith("/")) return reply.code(400).send({ error: "Invalid artifact path" });
  const artifact = await prisma.artifact.findFirst({ where: { buildId: deployment.buildId, path: safePath } });
  if (!artifact || !artifact.storageKey.startsWith(`${deployment.publishedPrefix}/`)) return reply.code(404).send({ error: "Artifact not found" });
  const object = await getObject(artifact.storageKey);
  reply.header("Cache-Control", safePath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
  reply.header("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors ${appOrigin}`);
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
  return reply.type(contentType(safePath, object.contentType)).send(object.body);
});
app.get<{ Params: { token: string; "*": string } }>("/api/preview/:token/*", async (request, reply) => {
  const tokenHash = createHash("sha256").update(request.params.token).digest("hex");
  const preview = await prisma.previewDeployment.findUnique({
    where: { tokenHash },
    include: { build: { include: { artifacts: true } } }
  });
  if (!preview || preview.revokedAt || preview.expiresAt <= new Date() || preview.build.status !== "READY") {
    return reply.code(404).send({ error: "Preview not found or expired" });
  }
  const requested = request.params["*"] || "index.html";
  const safePath = requested.replaceAll("\\", "/");
  if (safePath.includes("..") || safePath.startsWith("/")) return reply.code(400).send({ error: "Invalid artifact path" });
  const artifact = preview.build.artifacts.find((item) => item.path === safePath);
  if (!artifact || !artifact.storageKey.startsWith(`private/${preview.projectId}/${preview.buildId}/`)) return reply.code(404).send({ error: "Preview artifact not found" });
  const object = await getObject(`${preview.storagePrefix}/${safePath}`);
  reply.header("Cache-Control", "private, no-store");
  reply.header("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors ${appOrigin}`);
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
  return reply.type(contentType(safePath, object.contentType)).send(object.body);
});

function archiveEntries(buffer: Buffer): ProjectFile[] {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > limits.maxFiles) throw new Error("source archive exceeds file count limit");
  let expandedBytes = 0;
  let preflightTextBytes = 0;
  return entries.filter((entry) => !entry.isDirectory).map((entry) => {
    const normalized = entry.entryName.replaceAll("\\", "/");
    const segments = normalized.split("/");
    const mode = ((entry.header as { externalFileAttributes?: number }).externalFileAttributes ?? 0) >>> 16;
    if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || segments.some((segment) => segment === "..") || (mode & 0xf000) === 0xa000) throw new Error(`Unsafe source path: ${entry.entryName}`);
    expandedBytes += entry.header.size;
    if (expandedBytes > limits.maxExpandedBytes || (entry.header.compressedSize > 0 && entry.header.size / entry.header.compressedSize > limits.maxCompressionRatio)) throw new Error("source archive exceeds expansion safety limits");
    const file: ProjectFile = { path: normalized, size: entry.header.size };
    if (isGodotPreflightTextFile(normalized) && entry.header.size <= 1024 * 1024 && preflightTextBytes + entry.header.size <= 16 * 1024 * 1024) {
      file.content = entry.getData().toString("utf8");
      preflightTextBytes += entry.header.size;
    }
    return file;
  });
}
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "game"; }
function contentType(path: string, fallback: string) { return path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".wasm") ? "application/wasm" : fallback; }
function allowed(key: string, action: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucketKey = `${action}:${key}`;
  const bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.reset <= now) { rateBuckets.set(bucketKey, { count: 1, reset: now + windowMs }); return true; }
  bucket.count += 1;
  return bucket.count <= limit;
}
const port = Number(process.env.API_PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((error) => { app.log.error(error); process.exit(1); });
