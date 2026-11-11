import { defineConfig, devices } from "@playwright/test";

// PORT / API_PORT (+ API_ORIGINS=http://localhost:<PORT>) run the suite beside a local install
// that already holds 3001, e.g. PORT=5183 API_PORT=3011 API_ORIGINS=http://localhost:5183.
const BASIS = `http://localhost:${Number(process.env.PORT) || 5173}`;

// Node 22 caps the V8 old space near 2 GB. `vite build` already raises it to 4 GB
// (gates.yml, commit 7a27013) because the CSG graph aborts the render with
// "Ineffective mark-compacts near heap limit". This dev server compiles the same
// graph, so it gets the same ceiling — otherwise the nightly server can stall in
// GC or die mid-suite. An explicit max-old-space-size already in the environment
// is left alone.
const NODE_OPTIONS = process.env.NODE_OPTIONS?.includes("max-old-space-size")
  ? process.env.NODE_OPTIONS
  : `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim();

/**
 * Playwright-Konfiguration für BIT-Atelier.
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
    env: { ...process.env, NODE_OPTIONS },
  },
});
