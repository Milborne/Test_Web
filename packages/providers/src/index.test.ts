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
