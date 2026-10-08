import { defineConfig } from "@playwright/test";

const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: { baseURL: "http://127.0.0.1:3000", ...(channel ? { channel } : {}), trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: [["line"], ["html", { outputFolder: ".validation/playwright-report", open: "never" }]]
});
