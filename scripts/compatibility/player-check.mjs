import { chromium } from "@playwright/test";

const [appUrl, slug] = process.argv.slice(2);
if (!appUrl || !slug) throw new Error("usage: player-check.mjs <app-url> <slug>");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
try {
  const response = await page.goto(`${appUrl}/play/${encodeURIComponent(slug)}`, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`player page returned HTTP ${response?.status() ?? "unknown"}`);
  const frame = page.frameLocator("iframe");
  await frame.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  if (errors.length > 0) throw new Error(`fatal browser errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
}
