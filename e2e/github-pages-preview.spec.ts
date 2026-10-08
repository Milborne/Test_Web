import { expect, test } from "@playwright/test";

const previewUrl = process.env.GITHUB_PAGES_PREVIEW_URL;

test("deployed GitHub Pages preview initializes the Godot runtime", async ({ page }) => {
  if (!previewUrl) {
    test.skip(true, "only run against a real deployed GitHub Pages preview URL");
    return;
  }

  const target = new URL(previewUrl);
  expect(target.protocol).toBe("https:");
  expect(target.hostname).toMatch(/\.github\.io$/);

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
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => wasmResponses.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => javascriptResponses.length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(runtimeErrors, `fatal browser runtime errors:\n${runtimeErrors.join("\n")}`).toEqual([]);
  expect(leakedCookies).toEqual([]);
  expect(privateApiRequests).toEqual([]);
});
