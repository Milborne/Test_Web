import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubPagesPreviewDeploymentProvider, normalizePagesArtifactPath } from "./index.js";

async function withTempDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "game2web-pages-provider-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function sourceArtifact(directory: string, artifactPath: string, contents: string) {
  const sourcePath = path.join(directory, `source-${path.basename(artifactPath)}`);
  await writeFile(sourcePath, contents);
  return {
    path: artifactPath,
    sourcePath,
    size: Buffer.byteLength(contents),
    checksum: createHash("sha256").update(contents).digest("hex")
  };
}

test("prepares only integrity-checked Godot artifacts for Pages", async () => {
  await withTempDirectory(async (directory) => {
    const artifacts = await Promise.all([
      sourceArtifact(directory, "index.html", "<canvas></canvas>"),
      sourceArtifact(directory, "game.js", "runtime"),
      sourceArtifact(directory, "game.wasm", "wasm")
    ]);
    const siteDirectory = path.join(directory, "site");
    const prepared = await new GitHubPagesPreviewDeploymentProvider().prepare({ artifacts, outputDirectory: siteDirectory });
    assert.equal(prepared.artifactCount, 3);
    assert.equal(await readFile(path.join(siteDirectory, "index.html"), "utf8"), "<canvas></canvas>");
    assert.equal(await readFile(path.join(siteDirectory, ".nojekyll"), "utf8"), "");
  });
});

test("rejects source, logs, environment files, and paths outside the Pages site", () => {
  for (const artifactPath of ["../secret.txt", "/absolute.js", "source.zip", "logs/build.log", ".env", "private/token.js"]) {
    assert.throws(() => normalizePagesArtifactPath(artifactPath), /unsafe artifact path/);
  }
});

test("rejects artifact checksum mismatches before copying them", async () => {
  await withTempDirectory(async (directory) => {
    const artifacts = await Promise.all([
      sourceArtifact(directory, "index.html", "html"),
      sourceArtifact(directory, "game.js", "js"),
      sourceArtifact(directory, "game.wasm", "wasm")
    ]);
    artifacts[1].checksum = "0".repeat(64);
    await assert.rejects(
      new GitHubPagesPreviewDeploymentProvider().prepare({ artifacts, outputDirectory: path.join(directory, "site") }),
      /checksum mismatch/
    );
  });
});

test("requires index, JavaScript, and WebAssembly artifacts", async () => {
  await withTempDirectory(async (directory) => {
    const artifacts = await Promise.all([
      sourceArtifact(directory, "index.html", "html"),
      sourceArtifact(directory, "game.js", "js")
    ]);
    await assert.rejects(
      new GitHubPagesPreviewDeploymentProvider().prepare({ artifacts, outputDirectory: path.join(directory, "site") }),
      /artifacts are incomplete/
    );
  });
});
