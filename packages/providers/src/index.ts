import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { BuildContext, DetectionResult, ProjectFile, ProviderId } from "@game2web/shared";

const execFileAsync = promisify(execFile);

export interface BuildProvider {
  readonly id: ProviderId;
  detect(files: ProjectFile[]): DetectionResult;
  validate(files: ProjectFile[]): Promise<DetectionResult>;
  build(context: BuildContext): Promise<void>;
  collectArtifacts(outputDirectory: string): Promise<string[]>;
}

const has = (files: ProjectFile[], name: string) => files.some((file) => file.path === name || file.path.endsWith(`/${name}`));

export class EmscriptenSdlProvider implements BuildProvider {
  readonly id = "emscripten-sdl" as const;
  detect(files: ProjectFile[]): DetectionResult {
    const configured = has(files, "game2web.yml");
    const cmake = has(files, "CMakeLists.txt");
    const source = files.some((file) => /\.(c|cc|cpp|h|hpp)$/i.test(file.path));
    return {
      provider: this.id, engine: "C/C++ with Emscripten", confidence: configured || cmake ? "high" : "low",
      compatible: (configured || cmake) && source,
      reasons: cmake ? ["CMakeLists.txt detected"] : configured ? ["game2web.yml explicitly selects this provider"] : ["No CMake project was found"],
      warnings: source ? [] : ["No C/C++ source files were detected"]
    };
  }
  async validate(files: ProjectFile[]) { return this.detect(files); }
  async build(context: BuildContext) {
    context.log("Starting isolated Emscripten builder");
    await execFileAsync("docker", ["run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(context.limits.maxPids), "--cpus", String(context.limits.maxCpus), "--memory", `${context.limits.maxMemoryMb}m`, "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "-v", `${context.sourceDirectory}:/src:ro`, "-v", `${context.outputDirectory}:/out`, "game2web/emscripten-builder:3.1.74"], { timeout: context.limits.maxBuildMinutes * 60_000 });
  }
  async collectArtifacts(outputDirectory: string) { return listArtifacts(outputDirectory); }
}

export class GodotProvider implements BuildProvider {
  readonly id = "godot" as const;
  detect(files: ProjectFile[]): DetectionResult {
    const project = has(files, "project.godot");
    return {
      provider: this.id, engine: "Godot", confidence: project ? "high" : "low", compatible: project,
      reasons: project ? ["project.godot detected"] : ["project.godot was not found"],
      warnings: project ? ["Web export requires a compatible Godot version and project settings"] : []
    };
  }
  async validate(files: ProjectFile[]) { return this.detect(files); }
  async build(context: BuildContext) {
    context.log("Starting isolated Godot Web exporter");
    await execFileAsync("docker", ["run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(context.limits.maxPids), "--cpus", String(context.limits.maxCpus), "--memory", `${context.limits.maxMemoryMb}m`, "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "-v", `${context.sourceDirectory}:/src:ro`, "-v", `${context.outputDirectory}:/out`, process.env.GODOT_BUILDER_IMAGE ?? "game2web/godot-builder:4.3.0"], { timeout: context.limits.maxBuildMinutes * 60_000 });
  }
  async collectArtifacts(outputDirectory: string) { return listArtifacts(outputDirectory); }
}

export class UnavailableProvider implements BuildProvider {
  constructor(public readonly id: "unity" | "unreal" | "dos", private readonly reason: string) {}
  detect(): DetectionResult { return { provider: this.id, engine: this.id, confidence: "high", compatible: false, reasons: [this.reason], warnings: ["This provider is not available in the MVP"] }; }
  async validate() { return this.detect(); }
  async build() { throw new Error(`${this.id} provider is not available; no build was attempted`); }
  async collectArtifacts() { return []; }
}

export const providers: Record<ProviderId, BuildProvider> = {
  "emscripten-sdl": new EmscriptenSdlProvider(),
  godot: new GodotProvider(),
  unity: new UnavailableProvider("unity", "Unity conversion requires a licensed, version-pinned exporter"),
  unreal: new UnavailableProvider("unreal", "Unreal conversion requires a licensed, version-pinned exporter"),
  dos: new UnavailableProvider("dos", "DOS executable conversion is outside the MVP")
};

export function detectProject(files: ProjectFile[], override?: ProviderId): DetectionResult {
  if (override) return providers[override].detect(files);
  if (has(files, "project.godot")) return providers.godot.detect(files);
  if (has(files, "CMakeLists.txt") || files.some((file) => file.path === "game2web.yml")) return providers["emscripten-sdl"].detect(files);
  return { provider: null, engine: "Unknown", confidence: "low", compatible: false, reasons: ["No supported deterministic project markers were found"], warnings: ["Select a supported provider and provide its required project files"] };
}

async function listArtifacts(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? listArtifacts(path.join(directory, entry.name), path.join(prefix, entry.name))
    : path.join(prefix, entry.name))).then((items) => items.flat());
}

export async function readProjectManifest(file: string) { return readFile(file, "utf8"); }

export async function validateArtifacts(outputDirectory: string, artifacts: string[]) {
  if (artifacts.length === 0) throw new Error("Build output is empty");
  if (!artifacts.some((file) => file === "index.html")) throw new Error("Build output must contain an index.html entry point");
  const outputRoot = await realpath(outputDirectory);
  const validated = [];
  for (const relativePath of artifacts) {
    const resolved = await realpath(path.resolve(outputDirectory, relativePath));
    if (!resolved.startsWith(`${outputRoot}${path.sep}`)) {
      throw new Error(`Artifact path escapes output directory: ${relativePath}`);
    }
    const file = await stat(resolved);
    if (!file.isFile() || file.size === 0) throw new Error(`Artifact is empty or not a file: ${relativePath}`);
    validated.push({ path: relativePath, size: file.size });
  }
  return validated;
}
