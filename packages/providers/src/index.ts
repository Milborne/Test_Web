import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { BuildContext, DetectionResult, EngineVersion, PreflightResult, ProjectFile, ProviderId } from "@game2web/shared";

const execFileAsync = promisify(execFile);
const GODOT_BUILDER_MATRIX = {
  "4.3": { version: "4.3", image: "game2web/godot-builder:4.3.0", supportsFbx2Gltf: false }
} as const;
const PREFLIGHT_TEXT_FILE_LIMIT = 1024 * 1024;
const PREFLIGHT_TEXT_TOTAL_LIMIT = 16 * 1024 * 1024;
const PREFLIGHT_TEXT_EXTENSIONS = new Set([".godot", ".cfg", ".gd", ".tscn", ".tres", ".import", ".gdextension", ".gdnlib", ".gdns", ".json", ".cs"]);

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
    const sdlEvidence = configured && cmake;
    return {
      provider: this.id, engine: "C/C++ + SDL", confidence: sdlEvidence ? "high" : cmake || configured ? "medium" : "low",
      compatible: sdlEvidence && source,
      reasons: sdlEvidence ? ["game2web.yml selects emscripten-sdl", "CMakeLists.txt detected"] : ["A CMake project and explicit emscripten-sdl configuration are required"],
      warnings: source ? [] : ["No C/C++ source files were detected"]
    };
  }
  async validate(files: ProjectFile[]) { return this.detect(files); }
  async build(context: BuildContext) {
    context.log("Starting isolated Emscripten builder");
    try {
      const result = await execFileAsync("docker", ["run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(context.limits.maxPids), "--cpus", String(context.limits.maxCpus), "--memory", `${context.limits.maxMemoryMb}m`, "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "-e", "HOME=/tmp",             "-e", "EM_CACHE=/tmp/emscripten-cache", "-v", `${context.sourceDirectory}:/src:ro`, "-v", `${context.outputDirectory}:/out`, process.env.EMSCRIPTEN_BUILDER_IMAGE ?? "game2web/emscripten-builder:3.1.74"], { timeout: context.limits.maxBuildMinutes * 60_000 });
      context.log(result.stdout);
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string };
      context.log(output.stdout ?? "");
      context.log(output.stderr ?? "");
      throw error;
    }
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
  async validate(files: ProjectFile[]) {
    const result = this.detect(files);
    if (!result.compatible) return result;
    const preflight = preflightGodot(files);
    return {
      ...result,
      compatible: preflight.status === "SUPPORTED" || preflight.status === "SUPPORTED_WITH_WARNINGS",
      reasons: [...result.reasons, ...preflight.errors],
      warnings: [...result.warnings.filter((warning) => warning !== "Web export requires a compatible Godot version and project settings"), ...preflight.warnings],
      preflight
    };
  }
  async build(context: BuildContext) {
    if (!context.godotExportPreset) throw new Error("Godot Web export was not preflighted; no build was started");
    const builder = builderForVersion(process.env.GODOT_BUILDER_VERSION ?? "4.3");
    if (!builder) throw new Error("No compatible Godot builder is configured; no build was started");
    context.log("Starting isolated Godot Web exporter");
    try {
      const result = await execFileAsync("docker", ["run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(context.limits.maxPids), "--cpus", String(context.limits.maxCpus), "--memory", `${context.limits.maxMemoryMb}m`, "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "-e", `GODOT_EXPORT_PRESET=${context.godotExportPreset}`, "-e", `GODOT_PROJECT_DIRECTORY=${context.godotProjectDirectory ?? ""}`, "-v", `${context.sourceDirectory}:/src:ro`, "-v", `${context.outputDirectory}:/out`, process.env.GODOT_BUILDER_IMAGE ?? builder.image], { timeout: context.limits.maxBuildMinutes * 60_000 });
      context.log(result.stdout);
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string };
      context.log(output.stdout ?? "");
      context.log(output.stderr ?? "");
      throw error;
    }
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

function builderForVersion(version: string) {
  return Object.values(GODOT_BUILDER_MATRIX).find((builder) => builder.version === version);
}

export function isGodotPreflightTextFile(filePath: string) {
  return PREFLIGHT_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function readGodotProjectFiles(directory: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];
  let totalTextBytes = 0;
  async function visit(current: string, relative = ""): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(childPath, childRelative);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = await stat(childPath);
      const item: ProjectFile = { path: childRelative.replaceAll("\\", "/"), size: file.size };
      if (isGodotPreflightTextFile(item.path) && file.size <= PREFLIGHT_TEXT_FILE_LIMIT && totalTextBytes + file.size <= PREFLIGHT_TEXT_TOTAL_LIMIT) {
        item.content = await readFile(childPath, "utf8");
        totalTextBytes += file.size;
      }
      files.push(item);
    }
  }
  await visit(directory);
  return files;
}

export function preflightGodot(files: ProjectFile[], durationMs = 0): PreflightResult {
  const started = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFiles = new Set<string>();
  const requirements: string[] = [];
  let unsupportedStructure = false;
  const projectFiles = files.filter((file) => /(^|\/)project\.godot$/i.test(file.path));
  const builderVersion = process.env.GODOT_BUILDER_VERSION ?? "4.3";
  const engineVersion = projectFiles.length === 1 ? detectGodotVersion(projectFiles[0], files) : null;
  const projectDirectory = projectFiles.length === 1 ? path.posix.dirname(projectFiles[0].path).replace(/^\.$/, "") : undefined;
  const presetsFile = projectDirectory ? `${projectDirectory}/export_presets.cfg` : "export_presets.cfg";
  const presetFile = files.find((file) => file.path === presetsFile || (projectDirectory === "" && file.path === "export_presets.cfg"));
  const webPresets = presetFile?.content ? parseWebPresets(presetFile.content) : [];
  let webExportStatus: PreflightResult["webExportStatus"] = "WEB_EXPORT_MISSING";
  let webExportPreset: string | undefined;
  let status: PreflightResult["status"] = "SUPPORTED";

  if (projectFiles.length === 0) {
    errors.push("No project.godot file was found.");
    unsupportedStructure = true;
  }
  if (projectFiles.length > 1) {
    errors.push("Multiple project.godot files were found; select a single project root.");
    unsupportedStructure = true;
  }
  if (!presetFile) {
    errors.push("No export_presets.cfg was found beside project.godot. Add a Web export preset; Game2Web does not modify project files.");
    requirements.push("A valid Godot Web export preset");
  } else if (!presetFile.content) {
    errors.push("export_presets.cfg could not be inspected within the preflight text-file limits.");
    requirements.push("A readable Web export preset");
    webExportStatus = "WEB_EXPORT_INVALID";
  } else if (webPresets.length === 0) {
    errors.push("export_presets.cfg has no valid Web platform preset.");
    requirements.push("A valid Godot Web export preset");
    webExportStatus = "WEB_EXPORT_INVALID";
  } else if (webPresets.length > 1) {
    errors.push("Multiple Web export presets are configured; select one unambiguous preset.");
    requirements.push("Exactly one Godot Web export preset");
    webExportStatus = "WEB_EXPORT_INVALID";
  } else {
    webExportStatus = "WEB_EXPORT_READY";
    webExportPreset = webPresets[0].name;
  }

  if (!engineVersion) {
    warnings.push("The project does not declare a detectable Godot version; builder compatibility cannot be confirmed.");
  } else if (engineVersion.major < 4) {
    errors.push(`This Game2Web provider supports Godot 4.x projects only. Detected: ${engineVersion.raw}.`);
    unsupportedStructure = true;
  } else if (engineVersion.minor !== undefined && !builderForVersion(`${engineVersion.major}.${engineVersion.minor}`)) {
    errors.push(`This project requires Godot ${engineVersion.major}.${engineVersion.minor}, but no matching Game2Web builder is configured. Current builder: Godot ${builderVersion}.`);
    requirements.push(`A Godot ${engineVersion.major}.${engineVersion.minor} builder`);
  } else if (engineVersion.minor !== undefined && `${engineVersion.major}.${engineVersion.minor}` !== builderVersion) {
    errors.push(`This project requires Godot ${engineVersion.major}.${engineVersion.minor}, but the configured builder is Godot ${builderVersion}.`);
    requirements.push(`A matching Godot ${engineVersion.major}.${engineVersion.minor} builder`);
  }

  if (projectFiles.length === 1) {
    const projectContent = projectFiles[0].content ?? "";
    const renderer = projectContent.match(/renderer\/rendering_method(?:\.mobile)?\s*=\s*"([^"]+)"/)?.[1];
    const featureLine = projectContent.match(/config\/features\s*=\s*PackedStringArray\(([^)]*)\)/)?.[1] ?? "";
    if ((renderer && renderer !== "gl_compatibility") || /Forward Plus|Forward Mobile/i.test(featureLine)) {
      errors.push("Godot Web export requires the Compatibility renderer; this project selects a Forward renderer.");
      requirements.push("Godot Compatibility renderer for Web");
    } else if (renderer !== "gl_compatibility" && !/GL Compatibility/i.test(featureLine)) {
      errors.push("Godot Web export requires an explicitly configured Compatibility renderer; the project renderer could not be verified.");
      requirements.push("Godot Compatibility renderer for Web");
    }
  }

  const availablePaths = new Set(files.map((file) => file.path.replaceAll("\\", "/")));
  const textFiles = files.filter((file) => file.content !== undefined && isGodotPreflightTextFile(file.path));
  if (textFiles.length === 0) warnings.push("Project text files were unavailable for resource and plugin reference checks.");
  for (const file of textFiles) {
    for (const match of (file.content ?? "").matchAll(/res:\/\/([^"'`\r\n,)]+)/g)) {
      const resource = match[1].replace(/[\])}]+$/, "").replaceAll("\\", "/");
      if (resource.startsWith(".godot/") || resource.startsWith(".import/") || resource.includes("://")) continue;
      const resolved = projectDirectory ? `${projectDirectory}/${resource}` : resource;
      if (!availablePaths.has(resolved)) missingFiles.add(resolved);
    }
  }
  if (missingFiles.size > 0) {
    errors.push(`Referenced project resources are missing: ${[...missingFiles].slice(0, 10).join(", ")}${missingFiles.size > 10 ? ` and ${missingFiles.size - 10} more` : ""}.`);
    requirements.push("All referenced scenes, scripts, and assets in the source archive");
  }

  const enabledPlugins = projectFiles.flatMap((project) => [...(project.content ?? "").matchAll(/"res:\/\/(addons\/[^"]+\/plugin\.cfg)"/g)].map((match) => match[1]));
  for (const pluginPath of enabledPlugins) {
    const resolved = projectDirectory ? `${projectDirectory}/${pluginPath}` : pluginPath;
    if (!availablePaths.has(resolved)) missingFiles.add(resolved);
  }
  if (enabledPlugins.some((pluginPath) => !availablePaths.has(projectDirectory ? `${projectDirectory}/${pluginPath}` : pluginPath))) {
    errors.push("An enabled Godot editor plugin is missing its plugin.cfg file.");
    requirements.push("All enabled editor plugins included in the source archive");
  }
  const nativeExtensions = files.filter((file) => /\.(gdextension|gdnlib|gdns|dll|so|dylib)$/i.test(file.path));
  if (nativeExtensions.length > 0) {
    errors.push(`Native extensions are not supported by the current Web builder: ${nativeExtensions.slice(0, 5).map((file) => file.path).join(", ")}.`);
    requirements.push("A Web-compatible replacement for native extensions");
  }
  const fbxFiles = files.filter((file) => /\.fbx$/i.test(file.path));
  const currentBuilder = builderForVersion(builderVersion);
  if (fbxFiles.length > 0 && !currentBuilder?.supportsFbx2Gltf) {
    errors.push(`FBX assets require the FBX2glTF converter, which is not included in the pinned builder; conversion fails in the offline sandbox: ${fbxFiles.slice(0, 5).map((file) => file.path).join(", ")}.`);
    requirements.push("Convert FBX assets to glTF/GLB before upload");
  }

  if (errors.length > 0) status = unsupportedStructure ? "UNSUPPORTED" : "REQUIRES_ADAPTATION";
  else if (warnings.length > 0) status = "SUPPORTED_WITH_WARNINGS";
  const result: PreflightResult = {
    status,
    engine: "godot",
    engineVersion,
    builderVersion,
    webExportStatus,
    ...(webExportPreset ? { webExportPreset } : {}),
    ...(projectDirectory !== undefined ? { projectDirectory } : {}),
    missingFiles: [...missingFiles],
    warnings,
    errors,
    requirements: [...new Set(requirements)],
    durationMs: Math.max(durationMs, Date.now() - started)
  };
  return result;
}

function detectGodotVersion(project: ProjectFile, files: ProjectFile[]): EngineVersion | null {
  const content = project.content ?? "";
  const featureVersion = content.match(/config\/features\s*=\s*PackedStringArray\(\s*"(\d+)\.(\d+)(?:\.(\d+))?/);
  if (featureVersion) {
    const [, major, minor, patch] = featureVersion;
    const raw = `${major}.${minor}${patch ? `.${patch}` : ""}`;
    return { major: Number(major), minor: Number(minor), ...(patch ? { patch: Number(patch) } : {}), raw, confidence: "high" };
  }
  const legacyMarkers = /scancode\s*=|KinematicBody2D|Particles2D|Spatial\b|"base":\s*"Spatial"/.test(content)
    || files.some((file) => /\.(gd|tscn|tres)$/i.test(file.path) && /extends\s+(?:Spatial|KinematicBody2D|Particles2D)\b/.test(file.content ?? ""));
  if (legacyMarkers) return { major: 3, raw: "Godot 3.x (legacy API markers)", confidence: "medium" };
  return null;
}

function parseWebPresets(content: string) {
  const sections = [...content.matchAll(/^\[preset\.\d+\]([\s\S]*?)(?=^\[|\s*$)/gm)];
  return sections.flatMap((section) => {
    const name = section[1].match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const platform = section[1].match(/^platform\s*=\s*"([^"]+)"/m)?.[1];
    const runnable = section[1].match(/^runnable\s*=\s*(true|false)/m)?.[1];
    return platform === "Web" && name && runnable === "true" ? [{ name }] : [];
  });
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
