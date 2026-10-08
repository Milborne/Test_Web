import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { godotAudioStates, godotKeyEvents, installGodotRuntimeObservers } from "./helpers/godot-runtime-observer";

const previewUrl = process.env.GITHUB_PAGES_PREVIEW_URL;

test("deployed GitHub Pages preview initializes the Godot runtime", async ({ page }) => {
  if (!previewUrl) {
    test.skip(true, "only run against a real deployed GitHub Pages preview URL");
    return;
  }

  const target = new URL(previewUrl);
  expect(target.protocol).toBe("https:");
  expect(target.hostname).toMatch(/\.github\.io$/);

  await installGodotRuntimeObservers(page);
  const runtimeErrors: string[] = [];
  const wasmResponses: string[] = [];
  const javascriptResponses: string[] = [];
  const leakedCookies: string[] = [];
  const privateApiRequests: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (/\.wasm(?:$|\?)/i.test(response.url()) && response.ok()) wasmResponses.push(response.url());
    if (/\.js(?:$|\?)/i.test(response.url()) && response.ok()) javascriptResponses.push(response.url());
  });
  page.on("request", async (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin === target.origin && requestUrl.pathname.startsWith("/api/")) {
      privateApiRequests.push(request.url());
    }
    const cookie = (await request.allHeaders()).cookie ?? "";
    if (/game2web_(?:session|csrf)=/.test(cookie)) leakedCookies.push(request.url());
  });

  const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("#game2web-start-overlay")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Play Game" })).toBeFocused();
  expect(await godotAudioStates(page.mainFrame())).not.toContain("running");
  await page.getByRole("button", { name: "Play Game" }).click();
  await expect(page.locator("#game2web-start-overlay")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => godotAudioStates(page.mainFrame()), { timeout: 60_000 }).toContain("running");
  expect(await page.locator("html").getAttribute("data-game2web-runtime")).toBe("ready");
  expect(await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => document.activeElement === canvas)).toBe(true);
  await expect.poll(() => wasmResponses.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => javascriptResponses.length, { timeout: 60_000 }).toBeGreaterThan(0);

  const auditPath = process.env.GODOT_INPUT_AUDIT_PATH ?? "tests/compatibility/reports/godot-platformer/input-audit.json";
  const inputAudit = JSON.parse(await readFile(auditPath, "utf8"));
  expect(inputAudit.commit).toBe("6944ec4c323dcbad470ff7654fec665f010f50d1");
  expect(inputAudit.godotVersion).toBe("4.4");
  expect(inputAudit.movement.actions).toEqual(["ui_left", "ui_right", "ui_down", "ui_up"]);
  const movementKeys = new Set<string>(inputAudit.movement.controls.flatMap((control: { keys: string[] }) => control.keys));
  for (const expectedKey of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "A", "D", "S", "W"]) {
    expect(movementKeys).toContain(expectedKey);
  }
  for (const unrelatedKey of ["Q", "E", "R", "T", "Y", "F", "G"]) {
    expect(movementKeys).not.toContain(unrelatedKey);
  }
  expect(inputAudit.keyInputHandlers).toEqual([{ file: "source/main.gd", method: "_unhandled_key_input" }]);
  expect(inputAudit.additionalKeyActions).toEqual([
    { file: "source/main.gd", key: "KEY_F11", behavior: "fullscreen toggle" }
  ]);
  await page.locator("canvas").click();
  for (const key of ["Q", "E", "R", "T", "Y", "F", "G"]) await page.keyboard.press(key);
  expect((await godotKeyEvents(page.mainFrame())).slice(-7).map((event) => event.code)).toEqual(["KeyQ", "KeyE", "KeyR", "KeyT", "KeyY", "KeyF", "KeyG"]);
  expect(runtimeErrors, `fatal browser runtime errors:\n${runtimeErrors.join("\n")}`).toEqual([]);
  expect(leakedCookies).toEqual([]);
  expect(privateApiRequests).toEqual([]);
});
