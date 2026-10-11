import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright-Konfiguration für NovaConstruct.
 * Startet automatisch den Dev-Stack (Express :3001 + Vite :5173) über `npm run dev`
 * und testet gegen die laufende App. Wenn bereits ein Server läuft, wird er wiederverwendet.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // 87-01: every massing/workshop/form spec shares ONE JSON-DB record (Review Testhaus) —
  // serial by design; fixtures/base.js restores the house after each test.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.js",
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
