import { expect, test } from "@playwright/test";

const slug = process.env.EXTERNAL_GAME_SLUG;

test("external Godot build initializes in the published player", async ({ page }) => {
  if (!slug) {
    test.skip(true, "only run from the Compatibility Lab after a real external build");
    return;
  }
  const runtimeErrors: string[] = [];
  const wasmResponses: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (/\.wasm(?:$|\?)/i.test(response.url()) && response.ok()) wasmResponses.push(response.url());
  });

  const response = await page.goto(`/play/${encodeURIComponent(slug)}`, { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("iframe")).toHaveAttribute("src", new RegExp(`/api/play/${slug}/?$`), { timeout: 30_000 });
  const gameFrame = page.frames().find((frame) => frame.url().includes("/api/play/"));
  expect(gameFrame, "published game iframe should be loaded").toBeTruthy();
  if (!gameFrame) return;
  await expect(page.locator("iframe")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => gameFrame.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas ? canvas.width * canvas.height : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => wasmResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(runtimeErrors, `fatal browser runtime errors:\n${runtimeErrors.join("\n")}`).toEqual([]);
});
