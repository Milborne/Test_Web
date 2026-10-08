import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { godotAudioDiagnostics, godotAudioStates, godotKeyEvents, godotUnhandledRejections, installGodotRuntimeObservers } from "./helpers/godot-runtime-observer";

const previewUrl = process.env.GITHUB_PAGES_PREVIEW_URL;

test("deployed GitHub Pages preview initializes the Godot runtime", async ({ page }) => {
  if (!previewUrl) {
    test.skip(true, "only run against a real deployed GitHub Pages preview URL");
    return;
  }

  const target = new URL(previewUrl);
  expect(target.protocol).toBe("https:");
  expect(target.hostname).toMatch(/\.github\.io$/);

  await installGodotRuntimeObservers(page, { diagnoseAudioWorklets: true });
  const runtimeErrors: Array<{ type: string; message: string; stack: string }> = [];
  const wasmResponses: string[] = [];
  const javascriptResponses: string[] = [];
  const gameResourceResponses: string[] = [];
  const workletResponses: Array<{ url: string; status: number; contentType: string; sameOrigin: boolean }> = [];
  const failedWorkletRequests: Array<{ url: string; failure: string | null }> = [];
  const leakedCookies: string[] = [];
  const privateApiRequests: string[] = [];
  let responsePolicies: { contentSecurityPolicy: string | null; permissionsPolicy: string | null } | null = null;
  page.on("pageerror", (error) => runtimeErrors.push({ type: error.name, message: error.message, stack: error.stack }));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push({ type: "console.error", message: message.text(), stack: "" });
  });
  page.on("response", (response) => {
    if (/\.wasm(?:$|\?)/i.test(response.url()) && response.ok()) wasmResponses.push(response.url());
    if (/\.js(?:$|\?)/i.test(response.url()) && response.ok()) javascriptResponses.push(response.url());
    if (/\.(?:pck|png|worklet\.js)(?:$|\?)/i.test(response.url()) && response.ok()) gameResourceResponses.push(response.url());
    if (/\.worklet\.js(?:$|\?)/i.test(response.url())) {
      void response.allHeaders().then((headers) => {
        workletResponses.push({
          url: response.url(),
          status: response.status(),
          contentType: headers["content-type"] ?? "",
          sameOrigin: new URL(response.url()).origin === target.origin
        });
      });
    }
    if (response.url() === target.toString()) {
      void response.allHeaders().then((headers) => {
        responsePolicies = {
          contentSecurityPolicy: headers["content-security-policy"] ?? null,
          permissionsPolicy: headers["permissions-policy"] ?? null
        };
      });
    }
  });
  page.on("request", async (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin === target.origin && requestUrl.pathname.startsWith("/api/")) {
      privateApiRequests.push(request.url());
    }
    const cookie = (await request.allHeaders()).cookie ?? "";
    if (/game2web_(?:session|csrf)=/.test(cookie)) leakedCookies.push(request.url());
  });
  page.on("requestfailed", (request) => {
    if (/\.worklet\.js(?:$|\?)/i.test(request.url())) {
      failedWorkletRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? null });
    }
  });

  const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("#game2web-start-overlay")).toBeVisible({ timeout: 60_000 });
  const startButton = page.getByRole("button", { name: "Play Game" });
  await page.keyboard.press("Tab");
  await expect(startButton).toBeFocused();
  expect(await godotAudioStates(page.mainFrame())).not.toContain("running");
  await page.keyboard.press("Enter");
  await expect(page.locator("#game2web-start-overlay")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => godotAudioStates(page.mainFrame()), { timeout: 60_000 }).toContain("running");
  expect(await page.locator("html").getAttribute("data-game2web-runtime")).toBe("ready");
  expect(await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => document.activeElement === canvas)).toBe(true);
  await expect.poll(() => wasmResponses.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => javascriptResponses.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => gameResourceResponses.some((url) => /\.pck(?:$|\?)/i.test(url)), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => gameResourceResponses.some((url) => /\.png(?:$|\?)/i.test(url)), { timeout: 60_000 }).toBe(true);

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
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("d");
  expect((await godotKeyEvents(page.mainFrame())).slice(-2).map((event) => event.code)).toEqual(["ArrowRight", "KeyD"]);
  await page.keyboard.press("F11");
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBe(true);
  await page.keyboard.press("F11");
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBe(false);
  for (const key of ["Q", "E", "R", "T", "Y", "F", "G"]) await page.keyboard.press(key);
  expect((await godotKeyEvents(page.mainFrame())).slice(-7).map((event) => event.code)).toEqual(["KeyQ", "KeyE", "KeyR", "KeyT", "KeyY", "KeyF", "KeyG"]);
  await expect.poll(() => godotAudioDiagnostics(page.mainFrame()).then((diagnostics) => diagnostics.events.some((event) => event.event === "worklet-module-loaded")), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => workletResponses.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const browserDiagnostics = {
    browserName: page.context().browser()?.browserType().name() ?? "unknown",
    browserVersion: page.context().browser()?.version() ?? "unknown",
    browser: await page.evaluate(() => navigator.userAgent),
    headers: responsePolicies,
    audio: await godotAudioDiagnostics(page.mainFrame()),
    workletResponses,
    failedWorkletRequests,
    unhandledRejections: await godotUnhandledRejections(page.mainFrame())
  };
  expect(workletResponses.every((result) => result.status === 200 && result.sameOrigin && result.contentType.includes("javascript")), JSON.stringify(browserDiagnostics, null, 2)).toBe(true);
  expect(runtimeErrors, `fatal browser runtime errors:\n${JSON.stringify({ runtimeErrors, browserDiagnostics }, null, 2)}`).toEqual([]);
  expect(await godotUnhandledRejections(page.mainFrame()), JSON.stringify(browserDiagnostics, null, 2)).toEqual([]);
  expect(leakedCookies).toEqual([]);
  expect(privateApiRequests).toEqual([]);
});
