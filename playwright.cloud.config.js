import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright for the cloud build (57-06 Task 8).
 *
 * The default config starts the Express + Vite dev stack and seeds the
 * Testhaus before every run. In that mode the auth gate never applies
 * (isAuthenticated comes from the me() load), so a run there cannot prove
 * that a page is reachable WITHOUT a session. This config has no webServer and
 * no global setup: it tests whatever BASIS_URL serves -
 *   - the live site after a deploy (https://bit-atelier.pages.dev), or
 *   - a local cloud build: `npm run build:cloud` with placeholder Supabase
 *     values, then `npx vite preview --port 5194 --strictPort`.
 *
 * PowerShell:
 *   $env:BASIS_URL = 'http://localhost:5194'
 *   npm run test:e2e:cloud -- tests/e2e/rechtstexte-57-06.spec.js
 *   Remove-Item Env:BASIS_URL      # otherwise the next run hits the same URL
 */
const BASIS = process.env.BASIS_URL || "";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASIS || undefined,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
