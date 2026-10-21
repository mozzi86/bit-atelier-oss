import { defineConfig, devices } from "@playwright/test";

// PORT / API_PORT (+ API_ORIGINS=http://localhost:<PORT>) run the suite beside a local install
// that already holds 3001, e.g. PORT=5183 API_PORT=3011 API_ORIGINS=http://localhost:5183.
const BASIS = `http://localhost:${Number(process.env.PORT) || 5173}`;

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
    baseURL: BASIS,
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
    url: BASIS,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 19.10.2026: server output in the test log — a server that stops mid-run ("Stopped via …",
    // "[db] Persist fehlgeschlagen …") was invisible before (only stderr was shown).
    stdout: "pipe",
  },
});
