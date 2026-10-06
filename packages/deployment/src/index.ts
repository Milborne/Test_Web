export interface DeploymentProvider {
  publish(input: { projectId: string; projectSlug: string; buildId: string }): Promise<{ publishedPrefix: string; publicPath: string }>;
}

export class LocalStaticDeploymentProvider implements DeploymentProvider {
  constructor(private readonly baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:4000") {}
  async publish(input: { projectId: string; projectSlug: string; buildId: string }) {
    return { publishedPrefix: `published/${input.projectId}/${input.buildId}`, publicPath: `${this.baseUrl}/api/play/${encodeURIComponent(input.projectSlug)}/` };
  }
}
