import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DeploymentProvider {
  publish(input: { projectId: string; projectSlug: string; buildId: string }): Promise<{ publishedPrefix: string; publicPath: string }>;
}

export interface PreviewDeploymentProvider {
  create(input: { projectId: string; previewId: string; buildId: string; token: string }): Promise<{ storagePrefix: string; playerPath: string }>;
}

export interface GitHubPagesPreviewArtifact {
  path: string;
  sourcePath: string;
  size: number;
  checksum: string;
}

export class GitHubPagesPreviewDeploymentProvider {
  async prepare(input: { artifacts: GitHubPagesPreviewArtifact[]; outputDirectory: string }): Promise<{ siteDirectory: string; artifactCount: number }> {
    if (input.artifacts.length === 0) throw new Error("GitHub Pages preview requires validated build artifacts");
    const outputRoot = path.resolve(input.outputDirectory);
    await mkdir(outputRoot, { recursive: true });
    let foundIndex = false;
    let foundWasm = false;
    let foundJavaScript = false;

    for (const artifact of input.artifacts) {
      const normalizedPath = normalizePagesArtifactPath(artifact.path);
      const sourcePath = path.resolve(artifact.sourcePath);
      const destination = path.resolve(outputRoot, ...normalizedPath.split("/"));
      if (!destination.startsWith(`${outputRoot}${path.sep}`)) throw new Error(`artifact escaped Pages output directory: ${artifact.path}`);
      const sourceMetadata = await lstat(sourcePath);
      if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) throw new Error(`Pages artifact source must be a regular file: ${artifact.path}`);
      const metadata = await stat(sourcePath);
      if (!Number.isSafeInteger(artifact.size) || artifact.size < 1 || metadata.size !== artifact.size) {
        throw new Error(`Pages artifact size mismatch: ${artifact.path}`);
      }
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(sourcePath)) digest.update(chunk);
      if (!/^[a-f0-9]{64}$/i.test(artifact.checksum) || digest.digest("hex") !== artifact.checksum.toLowerCase()) {
        throw new Error(`Pages artifact checksum mismatch: ${artifact.path}`);
      }

      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
      if ((await stat(destination)).size !== artifact.size) throw new Error(`written Pages artifact size mismatch: ${artifact.path}`);
      foundIndex ||= normalizedPath === "index.html";
      foundWasm ||= /\.wasm$/i.test(normalizedPath);
      foundJavaScript ||= /\.js$/i.test(normalizedPath);
    }

    if (!foundIndex || !foundWasm || !foundJavaScript) {
      throw new Error(`Godot Pages artifacts are incomplete (index=${foundIndex}, wasm=${foundWasm}, javascript=${foundJavaScript})`);
    }
    await writeFile(path.join(outputRoot, ".nojekyll"), "", { flag: "wx" });
    return { siteDirectory: outputRoot, artifactCount: input.artifacts.length };
  }
}

export function normalizePagesArtifactPath(artifactPath: string): string {
  const normalizedPath = artifactPath.replaceAll("\\", "/");
  const components = normalizedPath.split("/");
  if (
    normalizedPath.startsWith("/") ||
    components.some((part) => part === "" || part === "." || part === "..") ||
    /(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:source|logs?|private)(?:\/|$)|\.(?:zip|log)$/i.test(normalizedPath)
  ) {
    throw new Error(`refusing to publish a non-game or unsafe artifact path: ${artifactPath}`);
  }
  return normalizedPath;
}

export class LocalStaticDeploymentProvider implements DeploymentProvider {
  constructor(private readonly baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:4000") {}
  async publish(input: { projectId: string; projectSlug: string; buildId: string }) {
    return { publishedPrefix: `published/${input.projectId}/${input.buildId}`, publicPath: `${this.baseUrl}/api/play/${encodeURIComponent(input.projectSlug)}/` };
  }
}

export class PublicStaticDeploymentProvider extends LocalStaticDeploymentProvider {
  constructor() {
    super(process.env.PLAYER_ORIGIN ?? "http://localhost:3000");
  }
}

export class LocalPreviewDeploymentProvider implements PreviewDeploymentProvider {
  constructor(private readonly playerOrigin = process.env.PLAYER_ORIGIN ?? "http://localhost:4000") {}
  async create(input: { projectId: string; previewId: string; buildId: string; token: string }) {
    return {
      storagePrefix: `previews/${input.projectId}/${input.buildId}/${input.previewId}`,
      playerPath: `${this.playerOrigin}/api/preview/${encodeURIComponent(input.token)}/`
    };
  }
}

export function createDeploymentProvider(): DeploymentProvider {
  return process.env.DEPLOYMENT_PROVIDER === "public" ? new PublicStaticDeploymentProvider() : new LocalStaticDeploymentProvider();
}

export function createPreviewDeploymentProvider(): PreviewDeploymentProvider {
  return new LocalPreviewDeploymentProvider();
}
