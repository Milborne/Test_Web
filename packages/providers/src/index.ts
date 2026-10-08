import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { BuildContext, DetectionResult, EngineVersion, PreflightResult, ProjectFile, ProviderId } from "@game2web/shared";

const execFileAsync = promisify(execFile);
export interface GodotBuilderConfig {
  version: string;
  image: string;
  digest: string | null;
  supported: boolean;
  baseImage: string;
  baseImageDigest: string;
  supportedExportFormats: readonly string[];
  compatibleProjectVersions: readonly string[];
  status: "available" | "planned" | "disabled";
  supportsFbx2Gltf: boolean;
}

export const GODOT_BUILDER_REGISTRY: readonly GodotBuilderConfig[] = [
  {
    version: "4.3",
    image: "game2web/godot-builder:4.3.0",
    digest: null,
    supported: true,
    baseImage: "flashlight13/godot:4.3",
    baseImageDigest: "sha256:5df8082d218b41df626b0d30dd0aebeee9d31963347cccbbf83c697f5135618a",
    supportedExportFormats: ["Web"],
    compatibleProjectVersions: ["4.0"],
    status: "available",
    supportsFbx2Gltf: false
  },
  {
    version: "4.4",
    image: "game2web/godot-builder:4.4.0",
    digest: null,
    supported: true,
    baseImage: "flashlight13/godot:4.4",
    baseImageDigest: "sha256:bb0dc52ab4e77528cac72a8707ed043b8c179370a91ce0825e2bc124a41f8cab",
    supportedExportFormats: ["Web"],
    compatibleProjectVersions: ["4.4"],
    status: "available",
    supportsFbx2Gltf: false
  }
];
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

const GODOT_STARTUP_PATTERN = /engine\.startGame\(\{[\s\S]*?\}\)\.then\(\(\) => \{\s*setStatusMode\('hidden'\);\s*\}, displayFailureNotice\);/g;

export function addGodotUserGestureAudioGate(html: string): string {
  if (html.includes("id=\"game2web-start-overlay\"")) {
    const handlerIndex = html.indexOf("game2webStartButton.addEventListener('click'");
    const startupIndex = html.indexOf("engine.startGame(");
    if (handlerIndex < 0 || startupIndex < handlerIndex || (html.match(/engine\.startGame\(/g) ?? []).length !== 1) {
      throw new Error("Godot Web export contains a conflicting start overlay; refusing to publish without a verified user-gesture audio gate");
    }
    return html;
  }
  if (!html.includes("new Engine(GODOT_CONFIG)")) {
    throw new Error("Godot Web export is missing the expected Engine startup shell; refusing to publish without the user-gesture audio gate");
  }
  const matches = [...html.matchAll(GODOT_STARTUP_PATTERN)];
  if (matches.length !== 1 || !html.includes("</head>") || !html.includes('<script src="index.js"></script>')) {
    throw new Error("Godot Web export shell does not match the supported startup structure; refusing to publish without the user-gesture audio gate");
  }

  const startup = matches[0][0];
  const monitoredStartup = startup
    .replace(
      /setStatusMode\('hidden'\);/,
      `setStatusMode('hidden');
    game2webStartOverlay.hidden = true;
    document.documentElement.dataset.game2webRuntime = 'ready';
    const game2webCanvas = document.getElementById('canvas');
    game2webCanvas.tabIndex = 0;
    game2webCanvas.focus({ preventScroll: true });`
    )
    .replace(
      /,\s*displayFailureNotice\);$/,
      `, (error) => {
    game2webStartButton.disabled = true;
    game2webStartButton.textContent = 'Unable to start';
    document.getElementById('game2web-audio-status').textContent = 'The game could not start. Reload this page and try again.';
    displayFailureNotice(error);
  });`
    );
  const gatedStartup = `const game2webStartOverlay = document.getElementById('game2web-start-overlay');
const game2webStartButton = document.getElementById('game2web-start-button');
if (window.matchMedia('(pointer: fine)').matches) game2webStartButton.focus({ preventScroll: true });
game2webStartOverlay.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    game2webStartButton.focus();
  }
});
game2webStartButton.addEventListener('click', () => {
  game2webStartButton.disabled = true;
  game2webStartButton.textContent = 'Starting…';
  document.getElementById('game2web-audio-status').textContent = 'Starting game and audio…';
  setStatusMode('progress');
  ${monitoredStartup}
}, { once: true });`;

  const htmlWithOverlay = html
    .replace("</head>", `${godotStartOverlayStyles}</head>`)
    .replace(
      '<script src="index.js"></script>',
      `<section id="game2web-start-overlay" class="game2web-start-overlay" role="dialog" aria-modal="true" aria-labelledby="game2web-start-title" aria-describedby="game2web-audio-status">
  <div class="game2web-start-card">
    <p class="game2web-start-brand">GAME2WEB</p>
    <h1 id="game2web-start-title">Ready to play?</h1>
    <button id="game2web-start-button" type="button">Play Game</button>
    <p id="game2web-audio-status" role="status">Use the Play Game button to start with audio. Keyboard users can press Tab, then Enter or Space.</p>
  </div>
</section>
<script src="index.js"></script>`
    );
  return htmlWithOverlay.replace(startup, gatedStartup);
}

const godotStartOverlayStyles = `<style id="game2web-start-overlay-styles">
.game2web-start-overlay { position: fixed; inset: 0; z-index: 5; display: grid; place-items: center; padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); background: rgba(8, 10, 12, .94); color: #edf2f7; font: 16px/1.5 Arial, Helvetica, sans-serif; text-align: center; touch-action: manipulation; }
.game2web-start-overlay[hidden] { display: none; }
.game2web-start-card { width: min(100%, 420px); padding: 32px; border: 1px solid #27303a; background: #12161b; }
.game2web-start-brand { color: #a4ff4f; font-size: 12px; font-weight: 700; letter-spacing: .18em; }
.game2web-start-card h1 { margin: 14px 0 24px; font-size: clamp(28px, 6vw, 42px); }
#game2web-start-button { min-width: 180px; border: 0; border-radius: 4px; padding: 14px 20px; background: #a4ff4f; color: #10140c; font: inherit; font-weight: 700; cursor: pointer; }
#game2web-start-button:hover:not(:disabled) { background: #b8ff7a; }
#game2web-start-button:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
#game2web-start-button:disabled { cursor: wait; opacity: .75; }
#game2web-audio-status { margin: 20px 0 0; color: #c4cbd2; }
@media (max-width: 480px) { .game2web-start-card { padding: 24px 18px; } }
@media (prefers-reduced-motion: reduce) { .game2web-start-overlay * { scroll-behavior: auto; } }
</style>`;

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
    const builder = context.godotBuilderVersion ? builderForVersion(context.godotBuilderVersion) : undefined;
    if (!builder) throw new Error("No compatible Godot builder is configured; no build was started");
    const builderUid = typeof process.getuid === "function" && process.getuid() > 0 ? process.getuid() : 1000;
    context.log("Starting isolated Godot Web exporter");
    try {
      const result = await execFileAsync("docker", ["run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(context.limits.maxPids), "--cpus", String(context.limits.maxCpus), "--memory", `${context.limits.maxMemoryMb}m`, "--user", `${builderUid}:1000`, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "-e", `GODOT_EXPORT_PRESET=${context.godotExportPreset}`, "-e", `GODOT_PROJECT_DIRECTORY=${context.godotProjectDirectory ?? ""}`, "-e", `GODOT_GENERATE_WEB_PRESET=${context.generateTemporaryWebPreset ? "1" : "0"}`, "-e", `GODOT_USE_COMPATIBILITY_RENDERER=${context.useCompatibilityRenderer ? "1" : "0"}`, "-v", `${context.sourceDirectory}:/src:ro`, "-v", `${context.outputDirectory}:/out`, builder.image], { timeout: context.limits.maxBuildMinutes * 60_000 });
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

export function builderForVersion(version: string) {
  return GODOT_BUILDER_REGISTRY.find((builder) => builder.version === version && builder.supported && builder.status === "available");
}

export function selectGodotBuilder(projectVersion: string) {
  const exact = GODOT_BUILDER_REGISTRY.find((builder) => builder.version === projectVersion && builder.supported && builder.status === "available");
  if (exact) return exact;
  return GODOT_BUILDER_REGISTRY.find((builder) => builder.supported && builder.status === "available" && builder.compatibleProjectVersions.includes(projectVersion));
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
  const adaptations: string[] = [];
  const plugins: PreflightResult["plugins"] = [];
  let unsupportedStructure = false;
  let requiresBuilder = false;
  let generateTemporaryWebPreset = false;
  let useCompatibilityRenderer = false;
  const projectFiles = files.filter((file) => /(^|\/)project\.godot$/i.test(file.path));
  const engineVersion = projectFiles.length === 1 ? detectGodotVersion(projectFiles[0], files) : null;
  const selectedBuilder = engineVersion?.minor !== undefined ? selectGodotBuilder(`${engineVersion.major}.${engineVersion.minor}`) : undefined;
  const builderVersion = selectedBuilder?.version ?? null;
  const projectDirectory = projectFiles.length === 1 ? path.posix.dirname(projectFiles[0].path).replace(/^\.$/, "") : undefined;
  const presetsFile = projectDirectory ? `${projectDirectory}/export_presets.cfg` : "export_presets.cfg";
  const presetFile = files.find((file) => file.path === presetsFile || (projectDirectory === "" && file.path === "export_presets.cfg"));
  const webPresets = presetFile?.content ? parseWebPresets(presetFile.content) : [];
  const projectContent = projectFiles[0]?.content ?? "";
  const allText = files.filter((file) => file.content !== undefined).map((file) => file.content ?? "").join("\n");
  const threeDIndicators = files.some((file) => /\.(fbx|glb|gltf|obj|dae|blend)$/i.test(file.path))
    || /type="(?:Node3D|Node3D|MeshInstance3D|Camera3D|CharacterBody3D|RigidBody3D|StaticBody3D|Skeleton3D|Sprite3D|AnimationPlayer3D)"/.test(allText)
    || /extends\s+(?:Node3D|MeshInstance3D|Camera3D|CharacterBody3D|RigidBody3D|StaticBody3D|Skeleton3D|Sprite3D)\b/.test(allText);
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
    webExportStatus = "WEB_EXPORT_MISSING";
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
    errors.push("The project does not declare a detectable Godot version; no builder can be selected explicitly.");
    requirements.push("A detectable Godot project version with an explicitly compatible builder");
    requiresBuilder = true;
  } else if (engineVersion.major < 4) {
    errors.push(`This Game2Web provider supports Godot 4.x projects only. Detected: ${engineVersion.raw}.`);
    unsupportedStructure = true;
  } else if (engineVersion.minor === undefined || !selectedBuilder) {
    errors.push(`This project requires Godot ${engineVersion.raw}, but no explicitly compatible Game2Web builder is configured.`);
    requirements.push(`A builder explicitly compatible with Godot ${engineVersion.raw}`);
    requiresBuilder = true;
  }

  if (projectFiles.length === 1) {
    const renderer = projectContent.match(/renderer\/rendering_method(?:\.mobile)?\s*=\s*"([^"]+)"/)?.[1];
    const forwardRenderer = (renderer !== undefined && renderer !== "gl_compatibility") || /Forward Plus|Forward Mobile/i.test(projectContent.match(/config\/features\s*=\s*PackedStringArray\(([^)]*)\)/)?.[1] ?? "");
    const compatibilityRenderer = renderer === "gl_compatibility" || /GL Compatibility/i.test(projectContent);
    if (!compatibilityRenderer) {
      if (!threeDIndicators) {
        useCompatibilityRenderer = true;
        adaptations.push("Override renderer to Compatibility in temporary build workspace");
        if (forwardRenderer) warnings.push("The project selects Forward Plus; Game2Web will use the Compatibility renderer in a temporary copy for Web export.");
      } else {
        errors.push("Godot Web export requires the Compatibility renderer; this project selects or appears to require a Forward renderer.");
        requirements.push("A Web-compatible Compatibility renderer configuration");
      }
    }
    if (renderer && renderer !== "gl_compatibility" && !forwardRenderer) {
      errors.push(`Unsupported Godot renderer configured: ${renderer}.`);
      requirements.push("Godot Compatibility renderer for Web");
    }
    if (threeDIndicators && !compatibilityRenderer) {
      errors.push("3D nodes or assets were detected and cannot be safely switched to the Web Compatibility renderer automatically.");
      requirements.push("Godot Compatibility renderer for Web");
    }
  }

  const availablePaths = new Set(files.map((file) => file.path.replaceAll("\\", "/")));
  const textFiles = files.filter((file) => file.content !== undefined && isGodotPreflightTextFile(file.path));
  if (textFiles.length === 0) warnings.push("Project text files were unavailable for resource and plugin reference checks.");
  for (const file of textFiles) {
    const content = file.content ?? "";
    for (const rawResource of extractGodotResourceReferences(content)) {
      const resource = rawResource.replaceAll("\\", "/");
      if (resource.startsWith(".godot/") || resource.startsWith(".import/") || resource.includes("://")) continue;
      const resolved = projectDirectory ? `${projectDirectory}/${resource}` : resource;
      const directoryExists = resource.endsWith("/") && files.some((file) => file.path.startsWith(resolved));
      if (!availablePaths.has(resolved) && !directoryExists) missingFiles.add(resolved);
    }
  }
  if (missingFiles.size > 0) {
    errors.push(`Referenced project resources are missing: ${[...missingFiles].slice(0, 10).map((file) => `res://${file}`).join(", ")}${missingFiles.size > 10 ? ` and ${missingFiles.size - 10} more` : ""}.`);
    requirements.push("All referenced scenes, scripts, and assets in the source archive");
  }

  const enabledPlugins = projectFiles.flatMap((project) => [...(project.content ?? "").matchAll(/"res:\/\/(addons\/[^"]+\/plugin\.cfg)"/g)].map((match) => match[1]));
  for (const pluginPath of enabledPlugins) {
    const resolved = projectDirectory ? `${projectDirectory}/${pluginPath}` : pluginPath;
    const pluginFile = files.find((file) => file.path === resolved);
    const pluginContents = pluginFile?.content ?? "";
    const nativePlugin = /\.(gdextension|gdnlib|gdns|dll|so|dylib)/i.test(pluginContents)
      || files.some((file) => file.path.startsWith(path.posix.dirname(resolved)) && /\.(gdextension|gdnlib|gdns|dll|so|dylib)$/i.test(file.path));
    plugins.push({
      path: resolved,
      status: nativePlugin ? "WEB_INCOMPATIBLE" : "UNKNOWN",
      reason: nativePlugin ? "Plugin references native code that the Web builder cannot load." : "Plugin Web compatibility is not declared; preflight does not execute plugins."
    });
    if (!nativePlugin) warnings.push(`Plugin Web compatibility is unknown: ${resolved}.`);
  }
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
  if (fbxFiles.length > 0 && !selectedBuilder?.supportsFbx2Gltf) {
    errors.push(`FBX assets require the FBX2glTF converter, which is not included in the pinned builder; conversion fails in the offline sandbox: ${fbxFiles.slice(0, 5).map((file) => file.path).join(", ")}.`);
    requirements.push("Convert FBX assets to glTF/GLB before upload");
  }

  const onlySafeAdaptationBlockers = errors.length === 0 && requirements.length === 0 && !unsupportedStructure;
  if (!presetFile && onlySafeAdaptationBlockers) {
    generateTemporaryWebPreset = true;
    webExportPreset = "Game2Web Web";
    adaptations.push("Generate temporary Web export preset in builder workspace");
    warnings.push("No Web export preset was present; Game2Web will generate a temporary controlled preset without changing stored source.");
  } else if (!presetFile) {
    errors.push("No export_presets.cfg was found and automatic preset generation is not safe for this project's detected requirements.");
    requirements.push("A valid Godot Web export preset or a project verified for temporary preset adaptation");
  }

  if (errors.length > 0) {
    status = unsupportedStructure ? "UNSUPPORTED" : requiresBuilder ? "REQUIRES_BUILDER" : "REQUIRES_ADAPTATION";
  } else if (warnings.length > 0 || adaptations.length > 0) status = "SUPPORTED_WITH_WARNINGS";
  const result: PreflightResult = {
    status,
    engine: "godot",
    engineVersion,
    builderVersion,
    builderImage: selectedBuilder?.image ?? null,
    builderDigest: selectedBuilder?.digest ?? null,
    builderBaseImage: selectedBuilder?.baseImage ?? null,
    builderBaseImageDigest: selectedBuilder?.baseImageDigest ?? null,
    webExportStatus,
    ...(webExportPreset ? { webExportPreset } : {}),
    ...(projectDirectory !== undefined ? { projectDirectory } : {}),
    generateTemporaryWebPreset,
    useCompatibilityRenderer,
    adaptations,
    plugins,
    missingFiles: [...missingFiles],
    warnings,
    errors,
    requirements: [...new Set(requirements)],
    durationMs: Math.max(durationMs, Date.now() - started)
  };
  return result;
}

export function extractGodotResourceReferences(content: string): string[] {
  const references = new Set<string>();
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (character === "#") {
      const newline = content.indexOf("\n", index);
      index = newline === -1 ? content.length : newline + 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      const quote = character;
      let value = "";
      index++;
      while (index < content.length && content[index] !== quote) {
        if (content[index] === "\\" && index + 1 < content.length && /[\s"'\\,;}\]]/.test(content[index + 1])) {
          value += content[index + 1];
          index += 2;
        } else {
          value += content[index++];
        }
      }
      if (index < content.length) index++;
      if (value.startsWith("res://")) references.add(value.slice("res://".length));
      continue;
    }
    if (content.startsWith("res://", index)) {
      index += "res://".length;
      let reference = "";
      while (index < content.length && !/[\s,;}\]]/.test(content[index])) {
        if (content[index] === "\\" && index + 1 < content.length && /[\s"'\\,;}\]]/.test(content[index + 1])) {
          reference += content[index + 1];
          index += 2;
        } else {
          reference += content[index++];
        }
      }
      reference = reference.replace(/[)]$/, "");
      if (reference) references.add(reference);
      continue;
    }
    index++;
  }
  return [...references];
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
  const sections: string[] = [];
  let current: string[] | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (/^\[/.test(line)) {
      if (current) sections.push(current.join("\n"));
      current = /^\[preset\.\d+\]$/.test(line) ? [] : undefined;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current.join("\n"));
  return sections.flatMap((section) => {
    const name = section.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const platform = section.match(/^platform\s*=\s*"([^"]+)"/m)?.[1];
    const runnable = section.match(/^runnable\s*=\s*(true|false)/m)?.[1];
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
