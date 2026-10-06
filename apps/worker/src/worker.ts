import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import AdmZip from "adm-zip";
import { providers, validateArtifacts } from "@game2web/providers";
import type { BuildContext, ProviderId } from "@game2web/shared";
import { getObject, putObject } from "@game2web/storage";
import { LocalStaticDeploymentProvider } from "@game2web/deployment";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const limits = { maxBuildMinutes: Number(process.env.BUILD_MAX_MINUTES ?? 10), maxMemoryMb: Number(process.env.BUILD_MAX_MEMORY_MB ?? 4096), maxCpus: Number(process.env.BUILD_MAX_CPUS ?? 2), maxPids: Number(process.env.BUILD_MAX_PIDS ?? 256), maxDiskMb: Number(process.env.BUILD_MAX_DISK_MB ?? 2048), maxUploadMb: Number(process.env.BUILD_MAX_UPLOAD_MB ?? 500), maxSourceFiles: Number(process.env.BUILD_MAX_FILES ?? 10_000), maxExpandedSourceMb: Number(process.env.BUILD_MAX_EXPANDED_SOURCE_MB ?? 1024) };
const deploymentProvider = new LocalStaticDeploymentProvider();

new Worker("game-builds", async (job) => {
  const started = Date.now();
  const buildId = String(job.data.buildId);
  const projectId = String(job.data.projectId);
  const providerId = job.data.provider as ProviderId;
  const provider = providers[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "game2web-"));
  const sourceDirectory = path.join(workspace, "source");
  const outputDirectory = path.join(workspace, "output");
  try {
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await chmod(workspace, 0o755);
    await chmod(sourceDirectory, 0o755);
    await chmod(outputDirectory, 0o777);
    await update(buildId, "PREPARING", "Downloading source archive from persistent storage");
    const source = await getObject(String(job.data.sourceStorageKey));
    const zip = new AdmZip(source.body);
    const entries = zip.getEntries();
    if (entries.length > limits.maxSourceFiles) throw new Error("Source archive exceeds file count limit");
    let expandedBytes = 0;
    for (const entry of entries) {
      const safe = entry.entryName.replaceAll("\\", "/");
      const segments = safe.split("/");
      const mode = ((entry.header as { externalFileAttributes?: number }).externalFileAttributes ?? 0) >>> 16;
      if (!safe || safe.startsWith("/") || safe.includes("\0") || segments.some((segment) => segment === "..") || (mode & 0xf000) === 0xa000) throw new Error(`Unsafe source path: ${entry.entryName}`);
      expandedBytes += entry.header.size;
      if (expandedBytes > limits.maxExpandedSourceMb * 1024 * 1024 || (entry.header.compressedSize > 0 && entry.header.size / entry.header.compressedSize > 100)) throw new Error("Source archive exceeds expansion safety limits");
      const target = path.resolve(sourceDirectory, safe);
      if (!target.startsWith(`${path.resolve(sourceDirectory)}${path.sep}`)) throw new Error(`Source path escapes workspace: ${safe}`);
      await mkdir(path.dirname(target), { recursive: true });
      if (entry.isDirectory) {
        await mkdir(target, { recursive: true });
        continue;
      }
      await writeFile(target, entry.getData(), { mode: 0o644 });
    }
    await update(buildId, "VALIDATING", "Validating deterministic provider compatibility");
    await update(buildId, "BUILDING", `Running ${providerId} builder`);
    const context: BuildContext = { sourceDirectory, outputDirectory, limits, log: (message) => void addLog(buildId, message) };
    await provider.build(context);
    await update(buildId, "PACKAGING", "Collecting and validating generated artifacts");
    const paths = await provider.collectArtifacts(outputDirectory);
    const artifacts = await validateArtifacts(outputDirectory, paths);
    if (artifacts.reduce((total, artifact) => total + artifact.size, 0) > limits.maxDiskMb * 1024 * 1024) {
      throw new Error("Build artifacts exceed configured disk limit");
    }
    if (providerId === "godot" && (!artifacts.some((artifact) => artifact.path.endsWith(".wasm")) || !artifacts.some((artifact) => artifact.path.endsWith(".js")))) {
      throw new Error("Godot Web export is missing required WASM or JavaScript runtime artifacts");
    }
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const deploymentLocation = await deploymentProvider.publish({ projectId, projectSlug: project.slug, buildId });
    const prefix = deploymentLocation.publishedPrefix;
    for (const artifact of artifacts) {
      const body = await readFile(path.join(outputDirectory, artifact.path));
      const stored = await putObject(`${prefix}/${artifact.path.replaceAll("\\", "/")}`, body, mime(artifact.path));
      await prisma.artifact.create({ data: { buildId, path: artifact.path.replaceAll("\\", "/"), size: stored.size, storageKey: stored.key, mimeType: mime(artifact.path), checksum: stored.checksum } });
    }
    await update(buildId, "UPLOADING", "Artifacts uploaded to MinIO");
    const deployment = await prisma.deployment.create({ data: { projectId, buildId, slug: project.slug, version: 1, publishedPrefix: prefix } });
    await prisma.build.update({ where: { id: buildId }, data: { status: "READY", durationMs: Date.now() - started } });
    await addLog(buildId, `Deployment ready at /play/${deployment.slug}`);
    return { status: "READY", deploymentId: deployment.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.build.update({ where: { id: buildId }, data: { status: "FAILED", error: message, durationMs: Date.now() - started } });
    await addLog(buildId, `Build failed: ${message}`);
    throw error;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}, { connection });

async function update(buildId: string, status: "PREPARING" | "VALIDATING" | "BUILDING" | "PACKAGING" | "UPLOADING", message: string) {
  await prisma.build.update({ where: { id: buildId }, data: { status } });
  await addLog(buildId, message);
}
async function addLog(buildId: string, message: string) { await prisma.buildLog.create({ data: { buildId, message } }); }
function mime(file: string) { return file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".pck") ? "application/octet-stream" : "application/octet-stream"; }
