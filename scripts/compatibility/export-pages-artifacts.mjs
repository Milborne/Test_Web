import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GitHubPagesPreviewDeploymentProvider, normalizePagesArtifactPath } from "../../packages/deployment/dist/index.js";

const [buildStatusPath, playerPath, outputPath] = process.argv.slice(2);
if (!buildStatusPath || !playerPath || !outputPath) {
  throw new Error("usage: export-pages-artifacts.mjs <build-status.json> <player-path> <output-directory>");
}

const playerUrl = new URL(playerPath);
if (!["http:", "https:"].includes(playerUrl.protocol) || !playerUrl.pathname.startsWith("/api/preview/")) {
  throw new Error("player path must be an HTTP(S) Game2Web preview artifact endpoint");
}

const buildStatus = JSON.parse(await readFile(buildStatusPath, "utf8"));
const artifacts = buildStatus.artifacts;
if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error("validated build has no artifacts");

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "game2web-pages-artifacts."));
try {
  const stagedArtifacts = [];
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    if (typeof artifact.path !== "string" || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || typeof artifact.checksum !== "string") {
      throw new Error("build returned an invalid artifact record");
    }
    const normalizedPath = normalizePagesArtifactPath(artifact.path);
    const components = normalizedPath.split("/");
    const artifactUrl = new URL(components.map(encodeURIComponent).join("/"), playerUrl);
    if (artifactUrl.origin !== playerUrl.origin || !artifactUrl.pathname.startsWith(playerUrl.pathname)) {
      throw new Error(`artifact URL escaped preview endpoint: ${artifact.path}`);
    }
    const response = await fetch(artifactUrl);
    if (!response.ok || !response.body) throw new Error(`artifact download failed (${response.status}): ${artifact.path}`);

    const sourcePath = path.join(stagingRoot, `artifact-${index}`);
    const hash = createHash("sha256");
    let downloadedBytes = 0;
    const integrity = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), integrity, createWriteStream(sourcePath, { flags: "wx" }));
    if (downloadedBytes !== artifact.size) {
      throw new Error(`artifact size mismatch for ${artifact.path}: expected ${artifact.size}, received ${downloadedBytes}`);
    }
    if (hash.digest("hex") !== artifact.checksum) throw new Error(`artifact checksum mismatch for ${artifact.path}`);
    stagedArtifacts.push({ path: normalizedPath, sourcePath, size: artifact.size, checksum: artifact.checksum });
  }

  const prepared = await new GitHubPagesPreviewDeploymentProvider().prepare({
    artifacts: stagedArtifacts,
    outputDirectory: outputPath
  });
  console.log(`Exported ${prepared.artifactCount} integrity-checked game artifacts to ${prepared.siteDirectory}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
