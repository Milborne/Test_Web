import assert from "node:assert/strict";
import test from "node:test";
import { detectProject } from "./index.js";

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
