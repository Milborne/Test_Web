import { defineConfig } from "@playwright/test";

const channel = process.env.PLAYWRIGHT_CHANNEL;
const firefoxWebGL = process.env.PLAYWRIGHT_FIREFOX_WEBGL === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...(channel ? { channel } : {}),
    ...(firefoxWebGL ? {
      launchOptions: {
        headless: false,
        firefoxUserPrefs: {
          "webgl.disabled": false,
          "webgl.force-enabled": true,
          "webgl.enable-webgl2": true,
          "webgl.allow-software": true,
          "webgl.disable-fail-if-major-performance-caveat": true,
          "gfx.webrender.all": true,
          "gfx.webrender.software": true
        }
      }
    } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  reporter: [["line"], ["html", { outputFolder: ".validation/playwright-report", open: "never" }]]
});
