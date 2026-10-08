export type ProviderId = "emscripten-sdl" | "godot" | "unity" | "unreal" | "dos";
export type BuildStatus = "QUEUED" | "PREPARING" | "VALIDATING" | "BUILDING" | "PACKAGING" | "UPLOADING" | "READY" | "FAILED" | "CANCELLED";

export interface ProjectFile { path: string; size: number; content?: string; }
export type CompatibilityStatus = "SUPPORTED" | "SUPPORTED_WITH_WARNINGS" | "REQUIRES_ADAPTATION" | "REQUIRES_BUILDER" | "UNSUPPORTED";
export type WebExportStatus = "WEB_EXPORT_READY" | "WEB_EXPORT_MISSING" | "WEB_EXPORT_INVALID";
export interface EngineVersion {
  major: number;
  minor?: number;
  patch?: number;
  raw: string;
  confidence: "high" | "medium" | "low";
}
export interface PreflightResult {
  status: CompatibilityStatus;
  engine: "godot";
  engineVersion: EngineVersion | null;
  builderVersion: string | null;
  builderImage: string | null;
  builderDigest: string | null;
  builderBaseImage: string | null;
  builderBaseImageDigest: string | null;
  webExportStatus: WebExportStatus;
  webExportPreset?: string;
  projectDirectory?: string;
  generateTemporaryWebPreset: boolean;
  useCompatibilityRenderer: boolean;
  adaptations: string[];
  plugins: { path: string; status: "WEB_COMPATIBLE" | "WEB_INCOMPATIBLE" | "UNKNOWN"; reason: string }[];
  missingFiles: string[];
  warnings: string[];
  errors: string[];
  requirements: string[];
  durationMs: number;
}
export interface DetectionResult {
  provider: ProviderId | null;
  engine: string;
  confidence: "high" | "medium" | "low";
  compatible: boolean;
  reasons: string[];
  warnings: string[];
  preflight?: PreflightResult;
}
export interface CompatibilityReport extends DetectionResult {
  projectSizeBytes: number;
  detectedFiles: string[];
}
export interface BuildLimits {
  maxBuildMinutes: number;
  maxMemoryMb: number;
  maxCpus: number;
  maxPids: number;
  maxDiskMb: number;
  maxUploadMb: number;
  maxSourceFiles: number;
  maxExpandedSourceMb: number;
}
export interface BuildRequest { projectId: string; provider?: ProviderId; sourceStorageKey: string; }
export interface BuildRecord {
  id: string;
  projectId: string;
  status: BuildStatus;
  provider: ProviderId | null;
  logs: string[];
  publicUrl?: string;
  durationMs?: number;
  error?: string;
}
export interface BuildContext {
  sourceDirectory: string;
  outputDirectory: string;
  limits: BuildLimits;
  godotExportPreset?: string;
  godotProjectDirectory?: string;
  godotBuilderVersion?: string;
  generateTemporaryWebPreset?: boolean;
  useCompatibilityRenderer?: boolean;
  log(message: string): void;
}
