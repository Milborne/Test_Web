import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { detectProject, preflightGodot, readGodotProjectFiles } from "./index.js";

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
  assert.equal(result.status, "REQUIRES_ADAPTATION");
  assert.equal(result.engineVersion?.raw, "4.4");
  assert.match(result.errors.join(" "), /no matching Game2Web builder/);
});

test("requires adaptation when no Web export preset exists", async () => {
  const result = preflightGodot(await fixture("missing-web-preset"));
  assert.equal(result.status, "REQUIRES_ADAPTATION");
  assert.equal(result.webExportStatus, "WEB_EXPORT_INVALID");
  assert.match(result.errors.join(" "), /no valid Web platform preset/);
});

test("accepts a valid Web preset and preserves its configured name", async () => {
  const result = preflightGodot(await fixture("valid-web"));
  assert.equal(result.status, "SUPPORTED");
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
