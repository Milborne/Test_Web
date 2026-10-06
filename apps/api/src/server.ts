import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { detectProject, providers } from "@game2web/providers";
import type { ProjectFile, ProviderId } from "@game2web/shared";
import { getObject, putObject } from "@game2web/storage";

const prisma = new PrismaClient();
const queue = new Queue("game-builds", { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } });
const limits = { maxBytes: Number(process.env.BUILD_MAX_UPLOAD_MB ?? 500) * 1024 * 1024, maxFiles: Number(process.env.BUILD_MAX_FILES ?? 10_000) };
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: limits.maxBytes, files: 1, fields: 4 } });

app.get("/health", async () => ({ status: "ok", service: "game2web-api", ai: false }));
app.get("/api/providers", async () => Object.values(providers).map((provider) => ({ id: provider.id, available: !["unity", "unreal", "dos"].includes(provider.id) })));
app.get("/api/projects", async () => prisma.project.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, slug: true, name: true, description: true, createdAt: true, builds: { orderBy: { createdAt: "desc" }, take: 1 } } }));

app.post("/api/projects", async (request, reply) => {
  const parts = request.parts();
  let name = "";
  let description = "";
  let archive: Buffer | undefined;
  let originalFilename = "";
  for await (const part of parts) {
    if (part.type === "field" && part.fieldname === "name") name = String(part.value);
    else if (part.type === "field" && part.fieldname === "description") description = String(part.value);
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
  const report = detectProject(files);
  const project = await prisma.project.create({ data: { name: name.trim(), slug: `${slugify(name)}-${randomUUID().slice(0, 8)}`, description, user: { create: { email: `${randomUUID()}@local.game2web`, passwordHash: "upload-only-development-user" } } } });
  const stored = await putObject(`sources/${project.id}/source.zip`, archive, "application/zip");
  await prisma.projectFile.createMany({ data: files.map((file) => ({ projectId: project.id, path: file.path, originalFilename, size: file.size, storageKey: stored.key, checksum: stored.checksum })) });
  return reply.code(201).send({ project, source: { originalFilename, storageKey: stored.key, size: stored.size, checksum: stored.checksum }, compatibility: { ...report, projectSizeBytes: stored.size, detectedFiles: files.map((file) => file.path) } });
});

app.post<{ Params: { id: string }; Body: { provider?: ProviderId } }>("/api/projects/:id/builds", async (request, reply) => {
  const project = await prisma.project.findUnique({ where: { id: request.params.id }, include: { files: true } });
  if (!project) return reply.code(404).send({ error: "Project not found" });
  const report = detectProject(project.files.map((file) => ({ path: file.path, size: Number(file.size) })), request.body?.provider);
  if (!report.compatible || !report.provider) return reply.code(422).send({ error: "Project is not compatible with an available provider", compatibility: report });
  const sourceStorageKey = project.files[0]?.storageKey;
  if (!sourceStorageKey) return reply.code(422).send({ error: "Project has no persisted source archive" });
  const build = await prisma.build.create({ data: { projectId: project.id, provider: report.provider, status: "QUEUED" } });
  await queue.add(build.id, { buildId: build.id, projectId: project.id, provider: report.provider, sourceStorageKey }, { jobId: build.id, removeOnComplete: 100, removeOnFail: 100 });
  return reply.code(202).send({ id: build.id, projectId: project.id, provider: report.provider, status: build.status });
});
app.get<{ Params: { id: string } }>("/api/builds/:id", async (request, reply) => {
  const build = await prisma.build.findUnique({ where: { id: request.params.id }, include: { artifacts: true, deployment: true, project: true, logs: { orderBy: { createdAt: "asc" } } } });
  if (!build) return reply.code(404).send({ error: "Build not found" });
  return { ...build, artifacts: build.artifacts.map((artifact) => ({ ...artifact, size: Number(artifact.size) })), publicUrl: build.deployment ? `${process.env.PUBLIC_WEB_URL ?? "http://localhost:3000"}/play/${build.project.slug}` : undefined };
});
app.get<{ Params: { slug: string; "*": string } }>("/api/play/:slug/*", async (request, reply) => {
  const deployment = await prisma.deployment.findUnique({ where: { slug: request.params.slug }, include: { build: true } });
  if (!deployment || deployment.build.status !== "READY") return reply.code(404).send({ error: "Published game not found" });
  const requested = request.params["*"] || "index.html";
  const safePath = requested.replaceAll("\\", "/");
  if (safePath.includes("..") || safePath.startsWith("/")) return reply.code(400).send({ error: "Invalid artifact path" });
  const artifact = await prisma.artifact.findFirst({ where: { buildId: deployment.buildId, path: safePath } });
  if (!artifact || !artifact.storageKey.startsWith(`${deployment.publishedPrefix}/`)) return reply.code(404).send({ error: "Artifact not found" });
  const object = await getObject(artifact.storageKey);
  return reply.type(contentType(safePath, object.contentType)).send(object.body);
});

function archiveEntries(buffer: Buffer): ProjectFile[] {
  const zip = new AdmZip(buffer);
  return zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => {
    const normalized = entry.entryName.replaceAll("\\", "/");
    if (normalized.includes("..") || normalized.startsWith("/")) throw new Error(`Unsafe source path: ${entry.entryName}`);
    return { path: normalized, size: entry.header.size };
  });
}
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "game"; }
function contentType(path: string, fallback: string) { return path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".wasm") ? "application/wasm" : fallback; }
const port = Number(process.env.API_PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((error) => { app.log.error(error); process.exit(1); });
