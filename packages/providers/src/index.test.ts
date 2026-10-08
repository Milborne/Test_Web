import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { detectProject, GODOT_BUILDER_REGISTRY, preflightGodot, readGodotProjectFiles, selectGodotBuilder } from "./index.js";

test("detects the Godot demo deterministically", () => {
  const result = detectProject([{ path: "project.godot", size: 400 }, { path: "scenes/main.tscn", size: 1200 }]);
  assert.equal(result.provider, "godot");
  assert.equal(result.compatible, true);
  assert.equal(result.confidence, "high");
});

test("does not claim unsupported Unity conversion", () => {
  const result = detectProject([{ path: "ProjectSettings/ProjectVersion.txt", size: 100 }], "unity");
  assert.equal(result.provider, "unity");
  assert.equal(result.compatible, false);
});

test("detects the SDL demo only with explicit deterministic project evidence", () => {
  const result = detectProject([
    { path: "game2web.yml", size: 120 },
    { path: "CMakeLists.txt", size: 800 },
    { path: "src/main.cpp", size: 1800 }
  ]);
  assert.equal(result.provider, "emscripten-sdl");
  assert.equal(result.compatible, true);
  assert.equal(result.engine, "C/C++ + SDL");
});

test("does not classify arbitrary C++ as SDL", () => {
  const result = detectProject([{ path: "CMakeLists.txt", size: 800 }, { path: "main.cpp", size: 100 }]);
  assert.equal(result.provider, "emscripten-sdl");
  assert.equal(result.compatible, false);
});

test("does not classify a Godot project as SDL", () => {
  const result = detectProject([{ path: "project.godot", size: 400 }, { path: "main.cpp", size: 100 }], "emscripten-sdl");
  assert.equal(result.compatible, false);
});

async function fixture(name: string) {
  return readGodotProjectFiles(path.resolve("tests/fixtures/godot-preflight", name));
}

test("rejects Godot 3 projects before building", async () => {
  const result = preflightGodot(await fixture("godot-3"));
  assert.equal(result.status, "UNSUPPORTED");
  assert.equal(result.engineVersion?.major, 3);
  assert.match(result.errors.join(" "), /supports Godot 4\.x/);
});

test("rejects projects that require a different Godot builder version", async () => {
  const result = preflightGodot(await fixture("version-mismatch"));
  assert.equal(result.status, "REQUIRES_BUILDER");
  assert.equal(result.engineVersion?.raw, "4.4");
  assert.match(result.errors.join(" "), /no explicitly compatible Game2Web builder/);
  assert.equal(result.builderImage, null);
});

test("rejects projects without a detectable Godot version instead of selecting a fallback builder", () => {
  const result = preflightGodot([{ path: "project.godot", size: 100, content: "config_version=5\n" }]);
  assert.equal(result.status, "REQUIRES_BUILDER");
  assert.equal(result.builderVersion, null);
  assert.equal(result.builderImage, null);
});

test("generates a temporary Web preset for a safe Godot 2D project", async () => {
  const result = preflightGodot(await fixture("missing-web-preset"));
  assert.equal(result.status, "SUPPORTED_WITH_WARNINGS");
  assert.equal(result.webExportStatus, "WEB_EXPORT_MISSING");
  assert.equal(result.generateTemporaryWebPreset, true);
  assert.equal(result.webExportPreset, "Game2Web Web");
});

test("accepts a valid Web preset and preserves its configured name", async () => {
  const result = preflightGodot(await fixture("valid-web"));
  assert.equal(result.status, "SUPPORTED", [...result.errors, ...result.warnings].join(" "));
  assert.equal(result.webExportStatus, "WEB_EXPORT_READY");
  assert.equal(result.webExportPreset, "Browser build");
});

test("detects missing resource references before building", async () => {
  const result = preflightGodot(await fixture("missing-resource"));
  assert.equal(result.status, "REQUIRES_ADAPTATION");
  assert.deepEqual(result.missingFiles, ["art/missing.png"]);
});

test("identifies FBX assets that need the unavailable converter", async () => {
  const result = preflightGodot(await fixture("fbx-asset"));
  assert.equal(result.status, "REQUIRES_ADAPTATION");
  assert.match(result.errors.join(" "), /FBX2glTF converter/);
});

test("uses only explicitly declared builder compatibility and prefers exact matches", () => {
  assert.equal(selectGodotBuilder("4.3")?.version, "4.3");
  assert.equal(selectGodotBuilder("4.0")?.version, "4.3");
  assert.equal(selectGodotBuilder("4.4"), undefined);
  assert.equal(GODOT_BUILDER_REGISTRY[0].digest, null);
  assert.match(GODOT_BUILDER_REGISTRY[0].baseImageDigest, /^sha256:[0-9a-f]{64}$/);
});

test("preflights the M9 Turn-based RPG requirements with temporary Web adaptations", async () => {
  const result = preflightGodot(await fixture("turn-based-rpg"));
  assert.equal(result.status, "SUPPORTED_WITH_WARNINGS");
  assert.equal(result.engineVersion?.raw, "4.0");
  assert.equal(result.builderVersion, "4.3");
  assert.equal(result.builderImage, "game2web/godot-builder:4.3.0");
  assert.equal(result.generateTemporaryWebPreset, true);
  assert.equal(result.useCompatibilityRenderer, true);
  assert.deepEqual(result.missingFiles, []);
});
