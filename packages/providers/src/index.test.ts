import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { detectProject, extractGodotResourceReferences, GODOT_BUILDER_REGISTRY, preflightGodot, readGodotProjectFiles, selectGodotBuilder } from "./index.js";

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

test("selects the Godot 4.4 builder for a matching project", async () => {
  const result = preflightGodot(await fixture("version-mismatch"));
  assert.equal(result.status, "SUPPORTED");
  assert.equal(result.engineVersion?.raw, "4.4");
  assert.equal(result.builderVersion, "4.4");
  assert.equal(result.builderImage, "game2web/godot-builder:4.4.0");
  assert.equal(result.webExportPreset, "HTML5");
});

test("rejects projects without a detectable Godot version instead of selecting a fallback builder", () => {
  const result = preflightGodot([{ path: "project.godot", size: 100, content: "config_version=5\n" }]);
  assert.equal(result.status, "REQUIRES_BUILDER");
  assert.equal(result.builderVersion, null);
  assert.equal(result.builderImage, null);
});

test("requires project changes when an existing export file has no Web preset", async () => {
  const result = preflightGodot(await fixture("missing-web-preset"));
  assert.equal(result.status, "REQUIRES_ADAPTATION");
  assert.equal(result.webExportStatus, "WEB_EXPORT_INVALID");
  assert.match(result.errors.join(" "), /no valid Web platform preset/);
});

test("generates a temporary Web preset when a safe Godot 2D project has no export file", async () => {
  const result = preflightGodot(await fixture("no-export-presets"));
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

test("extracts quoted resource paths without truncating spaces or punctuation", () => {
  assert.deepEqual(extractGodotResourceReferences([
    String.raw`preload("res://folder/file.tres")`,
    String.raw`preload("res://Some Folder/file.tres")`,
    String.raw`preload("res://Some Folder/My Asset (1).tres")`,
    String.raw`preload("res://folder/escaped\ name.tres")`,
    String.raw`preload("res://folder/quoted\"name.tres")`,
    String.raw`res://folder/unquoted\ path(My\ Asset).tres`,
    'var first = "res://first.tres"; var second = "res://second.tres"',
    '# preload("res://commented/missing.tres")',
    'var not_a_reference = "user://save.dat"'
  ].join("\n")).sort(), [
    "Some Folder/My Asset (1).tres",
    "Some Folder/file.tres",
    "first.tres",
    "folder/escaped name.tres",
    "folder/file.tres",
    'folder/quoted"name.tres',
    "folder/unquoted path(My Asset).tres",
    "second.tres"
  ]);
});

test("preflight resolves complete resource paths containing spaces", () => {
  const result = preflightGodot([
    { path: "project.godot", size: 100, content: 'config_version=5\nconfig/features=PackedStringArray("4.4", "GL Compatibility")\nrun/main_scene="res://Some Folder/Main Scene.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n' },
    { path: "export_presets.cfg", size: 100, content: '[preset.0]\nname="HTML5"\nplatform="Web"\nrunnable=true\n' },
    { path: "Some Folder/Main Scene.tscn", size: 20, content: '[gd_scene]\n[ext_resource type="Script" path="res://Some Folder/My Script (1).gd" id="1"]\n' },
    { path: "Some Folder/My Script (1).gd", size: 20, content: 'extends Node\n' },
    { path: "assets/pixel-adventure/Items/Fruits/Apple.png", size: 20 },
    { path: "scene.tscn", size: 20, content: '[gd_scene]\n[ext_resource type="Texture2D" path="res://assets/pixel-adventure/Items/Fruits/" id="1"]\n' }
  ]);
  assert.equal(result.status, "SUPPORTED", result.errors.join(" "));
  assert.deepEqual(result.missingFiles, []);
});

test("identifies FBX assets that need the unavailable converter", async () => {
  const result = preflightGodot(await fixture("fbx-asset"));
  assert.equal(result.status, "REQUIRES_ADAPTATION");
  assert.match(result.errors.join(" "), /FBX2glTF converter/);
});

test("uses only explicitly declared builder compatibility and prefers exact matches", () => {
  assert.equal(selectGodotBuilder("4.3")?.version, "4.3");
  assert.equal(selectGodotBuilder("4.0")?.version, "4.3");
  assert.equal(selectGodotBuilder("4.4")?.version, "4.4");
  assert.equal(GODOT_BUILDER_REGISTRY.find((builder) => builder.version === "4.4")?.supported, true);
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
