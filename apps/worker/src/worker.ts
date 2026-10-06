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
const limits = { maxBuildMinutes: Number(process.env.BUILD_MAX_MINUTES ?? 10), maxMemoryMb: Number(process.env.BUILD_MAX_MEMORY_MB ?? 4096), maxCpus: Number(process.env.BUILD_MAX_CPUS ?? 2), maxUploadMb: Number(process.env.BUILD_MAX_UPLOAD_MB ?? 500) };
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
    for (const entry of zip.getEntries()) {
      const safe = entry.entryName.replaceAll("\\", "/");
      if (entry.isDirectory || safe.includes("..") || safe.startsWith("/")) throw new Error(`Unsafe source path: ${entry.entryName}`);
      const target = path.resolve(sourceDirectory, safe);
      if (!target.startsWith(`${path.resolve(sourceDirectory)}${path.sep}`)) throw new Error(`Source path escapes workspace: ${safe}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.getData(), { mode: 0o644 });
    }
    await update(buildId, "VALIDATING", "Validating deterministic provider compatibility");
    await update(buildId, "BUILDING", `Running ${providerId} builder`);
    const context: BuildContext = { sourceDirectory, outputDirectory, limits, log: (message) => void addLog(buildId, message) };
    await provider.build(context);
    await update(buildId, "PACKAGING", "Collecting and validating generated artifacts");
    const paths = await provider.collectArtifacts(outputDirectory);
    const artifacts = await validateArtifacts(outputDirectory, paths);
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
