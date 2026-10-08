import { expect, test } from "@playwright/test";

const previewUrl = process.env.EXTERNAL_GAME_PREVIEW_URL;

test("external Godot preview initializes in the temporary player", async ({ page }) => {
  if (!previewUrl) {
    test.skip(true, "only run from the Compatibility Lab after a real external preview build");
    return;
  }
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

  const response = await page.goto(previewUrl, { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  const token = new URL(previewUrl).pathname.split("/").filter(Boolean).at(-1);
  expect(token).toBeTruthy();
  await expect(page.locator("iframe")).toHaveAttribute("src", new RegExp(`/api/preview/${token}/?$`), { timeout: 30_000 });
  const gameFrame = page.frames().find((frame) => frame.url().includes("/api/preview/"));
  expect(gameFrame, "temporary preview iframe should be loaded").toBeTruthy();
  if (!gameFrame) return;
  await expect(page.locator("iframe")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => gameFrame.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas ? canvas.width * canvas.height : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => wasmResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => javascriptResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(runtimeErrors, `fatal browser runtime errors:\n${runtimeErrors.join("\n")}`).toEqual([]);
});
