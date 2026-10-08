#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node audit-godot-input.mjs <Godot project directory>");

const projectPath = path.join(projectRoot, "project.godot");
const project = await readFile(projectPath, "utf8");
const inputStart = project.indexOf("[input]");
if (inputStart < 0) throw new Error("The project has no [input] section");
const nextSection = project.indexOf("\n[", inputStart + "[input]".length);
const inputSection = project.slice(inputStart, nextSection < 0 ? undefined : nextSection);
const actions = new Map();
for (const [, name, body] of inputSection.matchAll(/^([A-Za-z0-9_]+)=\{\s*\r?\n([\s\S]*?)^\}/gm)) {
  const bindings = [];
  for (const [, event] of body.matchAll(/Object\(InputEventKey,([\s\S]*?)\)/g)) {
    const logicalCode = Number(event.match(/"keycode":(\d+)/)?.[1] ?? 0);
    const physicalCode = Number(event.match(/"physical_keycode":(\d+)/)?.[1] ?? 0);
    const unicode = Number(event.match(/"unicode":(\d+)/)?.[1] ?? 0);
    if (logicalCode) bindings.push({ key: keyName(logicalCode), match: "logical", unicode });
    if (physicalCode) bindings.push({ key: keyName(physicalCode), match: "physical", unicode });
  }
  actions.set(name, bindings);
}

const scripts = [];
async function collectScripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectScripts(filePath);
    else if (entry.isFile() && entry.name.endsWith(".gd")) scripts.push([filePath, await readFile(filePath, "utf8")]);
  }
}
await collectScripts(projectRoot);

const vectorCalls = scripts.flatMap(([filePath, source]) =>
  [...source.matchAll(/Input\.get_vector\(([^)]*)\)/g)].map(([, args]) => ({
    file: path.relative(projectRoot, filePath).replaceAll("\\", "/"),
    actions: [...args.matchAll(/"([^"]+)"/g)].map(([, action]) => action)
  }))
);
if (vectorCalls.length !== 1 || vectorCalls[0].actions.length !== 4) {
  throw new Error(`Expected one four-action Input.get_vector movement mapping, found ${vectorCalls.length}`);
}
const movementActionNames = vectorCalls[0].actions;
const missingActions = movementActionNames.filter((action) => !actions.has(action));
if (missingActions.length) throw new Error(`Movement actions are missing from [input]: ${missingActions.join(", ")}`);

const additionalKeyActions = scripts.flatMap(([filePath, source]) =>
  [...source.matchAll(/Input\.is_key_pressed\((KEY_[A-Z0-9_]+)\)/g)].map(([, key]) => ({
    file: path.relative(projectRoot, filePath).replaceAll("\\", "/"),
    key,
    behavior: key === "KEY_F11" && source.includes("MODE_FULLSCREEN") && source.includes("window.set_mode")
      ? "fullscreen toggle"
      : "other direct key check"
  }))
);
const inputActionUsages = scripts.flatMap(([filePath, source]) =>
  [...source.matchAll(/Input\.(get_vector|is_action_[a-z_]+)\(([^)]*)\)/g)].flatMap(([, method, args]) =>
    [...args.matchAll(/"([^"]+)"/g)].map(([, action]) => ({
      file: path.relative(projectRoot, filePath).replaceAll("\\", "/"),
      method,
      action
    }))
  )
);
const keyInputHandlers = scripts.flatMap(([filePath, source]) =>
  [...source.matchAll(/^\s*func\s+(_(?:input|unhandled_input|unhandled_key_input|shortcut_input))\s*\(/gm)].map(([, method]) => ({
    file: path.relative(projectRoot, filePath).replaceAll("\\", "/"),
    method
  }))
);

const controls = movementActionNames.map((action) => ({
  action,
  keys: [...new Set(actions.get(action).map((binding) => binding.key))],
  bindings: actions.get(action)
}));
const report = {
  project: path.basename(projectRoot),
  commit: execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  godotVersion: project.match(/config\/features=PackedStringArray\("([^"]+)"/)?.[1] ?? "unknown",
  movement: { source: vectorCalls[0].file, method: "Input.get_vector", actions: movementActionNames, controls },
  inputActionUsages,
  keyInputHandlers,
  additionalKeyActions,
  auditedGdscriptFiles: scripts.length
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function keyName(code) {
  const named = new Map([[4194319, "ArrowLeft"], [4194321, "ArrowRight"], [4194320, "ArrowUp"], [4194322, "ArrowDown"]]);
  if (named.has(code)) return named.get(code);
  if (code >= 65 && code <= 90) return String.fromCharCode(code);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 32);
  return `KEY_${code}`;
}
