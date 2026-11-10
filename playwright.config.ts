import { defineConfig, devices } from "@playwright/test";
import { APP_PORT, FENCE_ENV, HARNESS_PORT } from "./scripts/visual/support/env";

// Optional local override (for machines that already have a Chromium); CI uses the browser installed by `playwright install`.
const chromium = process.env["PLAYWRIGHT_CHROMIUM_PATH"];
const ci = !!process.env["CI"];

export default defineConfig({
  testDir: "scripts/visual/specs",
  outputDir: "test-results/artifacts",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  ...(ci ? { workers: 2 } : {}),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "off",
    screenshot: "off",
    launchOptions: chromium ? { executablePath: chromium, args: ["--no-sandbox"] } : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /capture\.spec\.ts/ },
    { name: "capture", use: { ...devices["Desktop Chrome"] }, testMatch: /capture\.spec\.ts/ },
  ],
  webServer: [
    {
      // The real app, started with every backend address pointed at a dead local port and every secret blanked.
      command: `npx vite dev --port ${APP_PORT} --host 127.0.0.1 --strictPort`,
      url: `http://127.0.0.1:${APP_PORT}/`,
      env: FENCE_ENV,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // Document Upload harness (real components, fake services).
      command: `npx vite --config vite.visual.config.ts`,
      url: `http://127.0.0.1:${HARNESS_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
