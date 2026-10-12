// Visual regression gate (Plan 72-06): screenshots of the main pages at 1440 / 768 /
// 375 px compared against the baseline in tests/e2e/visuell-72-06.spec.js-snapshots/.
//
// Deterministic by construction:
//   - data: a private API server, freshly seeded at a fixed instant (visuell/privatServer.js);
//     the browser's /api requests go there, not to the shared E2E database
//   - time: the page clock is fixed to the same instant (page.clock.setFixedTime)
//   - motion: prefers-reduced-motion, CSS animations/transitions disabled, caret hidden
//   - WebGL / maps / canvases (three.js, maplibre, charts on canvas) and toasts are masked
//   - only localhost is reachable (no web fonts, tiles or APIs from outside)
// Threshold: a pixel counts as different above 0.2 colour distance (Playwright default);
// a page fails when more than 1 % of its pixels differ. That absorbs anti-aliasing noise
// but not a moved button, a new line of text or a changed colour.
//
// The baseline is per platform (file suffix -win32 / -linux): font rendering differs
// between operating systems. Without a baseline for the current platform the test is
// skipped, not failed. Update the baseline DELIBERATELY (see docs/VISUELLE-BASIS.md):
//   PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/visuell-72-06.spec.js --update-snapshots
//   node scripts/png-optimieren.mjs tests/e2e/visuell-72-06.spec.js-snapshots
//
// Run: PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/visuell-72-06.spec.js --reporter=line

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { apiUmleiten, privatenServerStarten } from "./visuell/privatServer.js";

/** Same instant as the seeder (fester-zeitpunkt.mjs). */
const ZEITPUNKT = new Date(process.env.VISUELL_ZEIT || "2026-10-01T09:00:00Z");
/** Private API port: next to the E2E API port, never the shared one. */
const PRIVAT_PORT = Number(process.env.VISUELL_API_PORT) || (Number(process.env.API_PORT) || 3001) + 10;

/** Main pages of the app (menu order), route and a text that proves the page is ready. */
const SEITEN = [
  { name: "dashboard", pfad: "/Dashboard" },
  { name: "projekte", pfad: "/Projects" },
  { name: "designer", pfad: "/ComplexDesigner" },
  { name: "pruef-suite", pfad: "/ModelCheck" },
  { name: "ava", pfad: "/AVA" },
  { name: "buchhaltung", pfad: "/Accounting" },
  { name: "ki-zentrale", pfad: "/AIDashboard" },
  { name: "einstellungen", pfad: "/Settings" },
];

/** Viewports: desktop, tablet portrait, phone. Heights are the usual screen heights. */
const BREITEN = [
  { breite: 1440, hoehe: 900 },
  { breite: 768, hoehe: 1024 },
  { breite: 375, hoehe: 812 },
];

/** @type {{ basis: string, stoppen: () => void } | null} */
let server = null;

test.describe("72-06 Visuelle Regressionsbasis", () => {
  // Not serial: one failed page must not keep the remaining pages from being compared.
  test.describe.configure({ timeout: 120000 });
  test.use({ reducedMotion: "reduce" });

  test.beforeAll(async () => {
    server = await privatenServerStarten(PRIVAT_PORT);
  });

  test.afterAll(() => {
    server?.stoppen();
  });

  for (const { breite, hoehe } of BREITEN) {
    for (const seite of SEITEN) {
      const datei = `${seite.name}-${breite}.png`;

      test(`${seite.name} bei ${breite} px`, async ({ page }, info) => {
        test.skip(
          info.config.updateSnapshots !== "all" && info.config.updateSnapshots !== "changed" && !fs.existsSync(info.snapshotPath(datei)),
          `keine Baseline für ${process.platform} — mit --update-snapshots bewusst anlegen (docs/VISUELLE-BASIS.md)`
        );
        await page.setViewportSize({ width: breite, height: hoehe });
        await page.clock.setFixedTime(ZEITPUNKT);
        await apiUmleiten(page, server?.basis || "");

        await page.goto(seite.pfad);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await expect(page.locator("main").first()).toBeVisible({ timeout: 30000 });
        // Loading indicators gone (LoadingState / spinners) before the shot.
        await expect(page.locator('[aria-busy="true"], .animate-spin')).toHaveCount(0, { timeout: 30000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);

        await expect(page).toHaveScreenshot(datei, {
          animations: "disabled",
          caret: "hide",
          scale: "css",
          maxDiffPixelRatio: 0.01,
          threshold: 0.2,
          timeout: 20000,
          mask: [
            page.locator("canvas"),
            page.locator(".maplibregl-map"),
            page.locator("[data-sonner-toaster]"),
          ],
        });
      });
    }
  }
});
