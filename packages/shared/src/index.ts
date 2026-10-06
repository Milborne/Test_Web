export type ProviderId = "emscripten-sdl" | "godot" | "unity" | "unreal" | "dos";
export type BuildStatus = "QUEUED" | "PREPARING" | "VALIDATING" | "BUILDING" | "PACKAGING" | "UPLOADING" | "READY" | "FAILED" | "CANCELLED";

export interface ProjectFile { path: string; size: number; }
export interface DetectionResult {
  provider: ProviderId | null;
  engine: string;
  confidence: "high" | "medium" | "low";
  compatible: boolean;
  reasons: string[];
  warnings: string[];
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
  log(message: string): void;
}
