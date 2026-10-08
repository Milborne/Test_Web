import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { godotAudioStates, godotKeyEvents, installGodotRuntimeObservers } from "./helpers/godot-runtime-observer";

const previewUrl = process.env.EXTERNAL_GAME_PREVIEW_URL;

test("external Godot preview initializes in the temporary player", async ({ page }) => {
  if (!previewUrl) {
    test.skip(true, "only run from the Compatibility Lab after a real external preview build");
    return;
  }
  await installGodotRuntimeObservers(page);
  const runtimeErrors: string[] = [];
  const wasmResponses: string[] = [];
  const javascriptResponses: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (/\.wasm(?:$|\?)/i.test(response.url()) && response.ok()) wasmResponses.push(response.url());
    if (/\.js(?:$|\?)/i.test(response.url()) && response.ok()) javascriptResponses.push(response.url());
  });

  const previewOrigin = new URL(previewUrl).origin;
  await page.context().addCookies([
    { name: "game2web_session", value: "app-origin-session-only", url: previewOrigin, httpOnly: true, sameSite: "Lax" },
    { name: "game2web_csrf", value: "app-origin-csrf-only", url: previewOrigin, sameSite: "Lax" }
  ]);
  const authCookieRequests: string[] = [];
  page.on("request", async (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.hostname === new URL(previewOrigin).hostname || !requestUrl.pathname.startsWith("/api/")) return;
    const cookies = (await request.allHeaders()).cookie ?? "";
    if (/game2web_(?:session|csrf)=/.test(cookies)) authCookieRequests.push(request.url());
  });
  const response = await page.goto(previewUrl, { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  const playerOrigin = new URL(await page.locator("iframe").getAttribute("src") ?? "", previewUrl).origin;
  expect(new URL(playerOrigin).hostname).not.toBe(new URL(previewOrigin).hostname);
  const token = new URL(previewUrl).pathname.split("/").filter(Boolean).at(-1);
  expect(token).toBeTruthy();
  await expect(page.locator("iframe")).toHaveAttribute("src", new RegExp(`/api/preview/${token}/?$`), { timeout: 30_000 });
  const gameFrame = page.frames().find((frame) => frame.url().includes("/api/preview/"));
  expect(gameFrame, "temporary preview iframe should be loaded").toBeTruthy();
  if (!gameFrame) return;
  await expect(page.locator("iframe")).toBeVisible();
  const gameFrameLocator = page.frameLocator("iframe");
  await expect(gameFrameLocator.locator("#game2web-start-overlay")).toBeVisible({ timeout: 30_000 });
  await expect(gameFrameLocator.getByRole("button", { name: "Play Game" })).toBeFocused();
  expect(await godotAudioStates(gameFrame!)).not.toContain("running");
  await gameFrameLocator.getByRole("button", { name: "Play Game" }).click();
  await expect(gameFrameLocator.locator("#game2web-start-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(gameFrameLocator.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => gameFrame.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas ? canvas.width * canvas.height : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => godotAudioStates(gameFrame), { timeout: 30_000 }).toContain("running");
  expect(await gameFrame.evaluate(() => document.documentElement.dataset.game2webRuntime)).toBe("ready");
  expect(await gameFrame.evaluate(() => document.activeElement?.id)).toBe("canvas");

  const auditPath = process.env.GODOT_INPUT_AUDIT_PATH ?? "tests/compatibility/reports/godot-platformer/input-audit.json";
  const inputAudit = JSON.parse(await readFile(auditPath, "utf8"));
  expect(inputAudit.movement.method).toBe("Input.get_vector");
  expect(inputAudit.movement.actions).toEqual(["ui_left", "ui_right", "ui_down", "ui_up"]);
  const movementKeys = new Set<string>(inputAudit.movement.controls.flatMap((control: { keys: string[] }) => control.keys));
  for (const expectedKey of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "A", "D", "S", "W"]) {
    expect(movementKeys).toContain(expectedKey);
  }
  expect(inputAudit.movement.controls.find((control: { action: string }) => control.action === "ui_left").bindings)
    .toContainEqual({ key: "A", match: "physical", unicode: 113 });
  expect(inputAudit.movement.controls.find((control: { action: string }) => control.action === "ui_up").bindings)
    .toContainEqual({ key: "W", match: "physical", unicode: 122 });
  for (const unrelatedKey of ["Q", "E", "R", "T", "Y", "F", "G"]) {
    expect(movementKeys).not.toContain(unrelatedKey);
  }
  expect(inputAudit.additionalKeyActions).toEqual([
    { file: "source/main.gd", key: "KEY_F11", behavior: "fullscreen toggle" }
  ]);
  expect(inputAudit.keyInputHandlers).toEqual([{ file: "source/main.gd", method: "_unhandled_key_input" }]);
  expect(inputAudit.inputActionUsages.filter((usage: { action: string }) => usage.action === "ui_up").length).toBeGreaterThan(1);

  const parentHeader = page.locator("main.player header span");
  await parentHeader.click();
  const keysBeforeParentPress = await godotKeyEvents(gameFrame);
  await page.keyboard.press("A");
  expect(await godotKeyEvents(gameFrame)).toEqual(keysBeforeParentPress);
  await gameFrameLocator.locator("#canvas").click();
  await page.keyboard.press("Q");
  await page.keyboard.press("E");
  await page.keyboard.press("R");
  await page.keyboard.press("T");
  await page.keyboard.press("Y");
  await page.keyboard.press("F");
  await page.keyboard.press("G");
  const gameKeys = await godotKeyEvents(gameFrame);
  expect(gameKeys.slice(-7).map((event) => event.code)).toEqual(["KeyQ", "KeyE", "KeyR", "KeyT", "KeyY", "KeyF", "KeyG"]);
  expect(movementKeys.has("Q") || movementKeys.has("E") || movementKeys.has("R") || movementKeys.has("T") || movementKeys.has("Y") || movementKeys.has("F") || movementKeys.has("G")).toBe(false);
  await expect.poll(() => wasmResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => javascriptResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(runtimeErrors, `fatal browser runtime errors:\n${runtimeErrors.join("\n")}`).toEqual([]);
  expect(authCookieRequests).toEqual([]);
});
