export interface DeploymentProvider {
  publish(input: { projectId: string; projectSlug: string; buildId: string }): Promise<{ publishedPrefix: string; publicPath: string }>;
}

export interface PreviewDeploymentProvider {
  create(input: { previewId: string; buildId: string; token: string }): Promise<{ storagePrefix: string; playerPath: string }>;
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
  async create(input: { previewId: string; buildId: string; token: string }) {
    return {
      storagePrefix: `previews/${input.previewId}/${input.buildId}`,
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
