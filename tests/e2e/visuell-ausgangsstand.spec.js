// Baseline before the workflow navigation and design-token work (decision 2026-10-13):
// every page of the sidebar (src/navigation.js, Labor included) at 1440 px, in light AND
// dark theme, compared against tests/e2e/visuell-ausgangsstand.spec.js-snapshots/.
//
// Why a separate spec next to visuell-72-06: that phase is closed and covers 8 pages in
// light only. The token migration mostly breaks dark mode (an override layer in
// packages/nova-core/src/index.css remaps hardcoded slate classes), so dark is the half
// that needs the net. One width keeps the baseline at ~58 images; 72-06 keeps the
// tablet and phone widths for its 8 pages.
//
// Same determinism as 72-06: private freshly seeded API server, fixed clock, reduced
// motion, canvases/maps/toasts masked, no outside network. The theme is forced through
// the stored choice ("nc-theme", ThemeProvider.jsx) before the first script runs.
//
// The baseline is per platform (-win32 / -linux). Without one the test skips. Record or
// update it DELIBERATELY:
//   PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/visuell-ausgangsstand.spec.js --update-snapshots
//   node scripts/png-optimieren.mjs tests/e2e/visuell-ausgangsstand.spec.js-snapshots

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { apiUmleiten, privatenServerStarten } from "./visuell/privatServer.js";

/** Same instant as the seeder (fester-zeitpunkt.mjs). */
const ZEITPUNKT = new Date(process.env.VISUELL_ZEIT || "2026-10-01T09:00:00Z");
/** Private API port: beside the ones of 72-06 (+10) and axe (+11). */
const PRIVAT_PORT = Number(process.env.VISUELL_AUSGANG_API_PORT) || (Number(process.env.API_PORT) || 3001) + 12;

/** Sidebar pages in menu order (src/navigation.js, 2026-10-13), file name and route. */
const SEITEN = [
  ["projektuebersicht", "/Dashboard"],
  ["projekte", "/Projects"],
  ["berichte", "/Reports"],
  ["fristen", "/Deadlines"],
  ["machbarkeit", "/RealEstateFeasibility"],
  ["designer", "/ComplexDesigner"],
  ["werkplanung", "/Werkplanung"],
  ["baustelle", "/Baustelle"],
  ["pruef-suite", "/ModelCheck"],
  ["bim-viewer", "/BimViewer"],
  ["ifc-viewer", "/IfcViewer"],
  ["projektstaende", "/ModelVersions"],
  ["ava", "/AVA"],
  ["finanzen", "/Finance"],
  ["ki-zentrale", "/AIDashboard"],
  ["zeiterfassung", "/TimeTracking"],
  ["angebot-auftrag", "/Fees"],
  ["controlling", "/Controlling"],
  ["buchhaltung", "/Accounting"],
  ["personal", "/People"],
  ["abwesenheiten", "/Absences"],
  ["adressbuch", "/AddressBook"],
  ["schriftverkehr", "/Correspondence"],
  ["einstellungen", "/Settings"],
  ["skizze", "/SketchStudio"],
  ["leitstand", "/SiteControl"],
  ["investment", "/InvestmentPlatform"],
  ["pdf-ablage", "/BitAegis"],
  ["portfolio", "/AtelierDeveloper"],
  ["ki-tool", "/KiTool"],
];

const THEMEN = /** @type {const} */ (["hell", "dunkel"]);

/** @type {{ basis: string, stoppen: () => void } | null} */
let server = null;

test.describe("Ausgangsstand vor Navigation und Tokens (hell + dunkel, 1440 px)", () => {
  // Not serial: one failed page must not keep the remaining pages from being compared.
  test.describe.configure({ timeout: 120000 });
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  test.beforeAll(async () => {
    server = await privatenServerStarten(PRIVAT_PORT);
  });

  test.afterAll(() => {
    server?.stoppen();
  });

  for (const thema of THEMEN) {
    for (const [name, pfad] of SEITEN) {
      const datei = `${name}-${thema}.png`;

      test(`${name} ${thema}`, async ({ page }, info) => {
        test.skip(
          info.config.updateSnapshots !== "all" && info.config.updateSnapshots !== "changed" && !fs.existsSync(info.snapshotPath(datei)),
          `keine Baseline für ${process.platform} — mit --update-snapshots bewusst anlegen`
        );
        const gespeichert = thema === "dunkel" ? "dark" : "light";
        await page.addInitScript((wert) => {
          try { window.localStorage.setItem("nc-theme", wert); } catch { /* storage blocked: the shot shows the system theme */ }
        }, gespeichert);
        await page.clock.setFixedTime(ZEITPUNKT);
        await apiUmleiten(page, server?.basis || "");

        await page.goto(pfad);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await expect(page.locator("main").first()).toBeVisible({ timeout: 30000 });
        await expect(page.locator('[aria-busy="true"], .animate-spin')).toHaveCount(0, { timeout: 30000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        // Guard: the forced theme really applied, otherwise the dark baseline is a light one.
        await expect(page.locator("html")).toHaveClass(thema === "dunkel" ? /\bdark\b/ : /^(?!.*\bdark\b)/);

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
