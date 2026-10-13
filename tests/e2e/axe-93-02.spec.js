// Accessibility gate with axe over every module page (Plan 93-02, register lever 157).
//
// For each module route the page is checked against WCAG 2.1 A/AA (axe tags wcag2a,
// wcag2aa, wcag21a, wcag21aa). Known violations live in tests/e2e/axe-basis.json as
// { "<route>": { "<rule id>": <number of nodes> } }. The test fails only on what is NEW:
// a rule that is not in the baseline for that page, or more nodes than recorded. Fewer
// nodes than recorded print a hint to shrink the baseline (docs/BARRIEREFREIHEIT-PRUEFUNG.md).
//
// Data is deterministic: the same private, freshly seeded API server at a fixed instant as
// the visual baseline (visuell/privatServer.js) answers the browser's /api requests.
//
// DEPENDENCY: the devDependency @axe-core/playwright (exact version in package.json since
// 93-02; the user's go came on 2026-10-13). Without it every test skips with that reason.
// Record or lower the baseline deliberately:
//   AXE_BASIS_SCHREIBEN=1 PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/axe-93-02.spec.js
// records the baseline once; afterwards the plain run is the gate (nightly via npm run test:e2e).

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiUmleiten, privatenServerStarten } from "./visuell/privatServer.js";

const BASIS_DATEI = path.join(path.dirname(fileURLToPath(import.meta.url)), "axe-basis.json");
const ZEITPUNKT = new Date(process.env.VISUELL_ZEIT || "2026-10-01T09:00:00Z");
const PRIVAT_PORT = Number(process.env.AXE_API_PORT) || (Number(process.env.API_PORT) || 3001) + 11;
const SCHREIBEN = process.env.AXE_BASIS_SCHREIBEN === "1";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Module pages (menu of src/navigation.js) plus the accessibility statement itself. */
const SEITEN = [
  "/Dashboard", "/Projects", "/Reports", "/Deadlines", "/RealEstateFeasibility", "/ComplexDesigner",
  "/Werkplanung", "/Baustelle", "/ModelCheck", "/BimViewer", "/ModelVersions", "/AVA", "/Finance", "/AIDashboard",
  "/TimeTracking", "/Fees", "/Controlling", "/Accounting", "/People", "/Absences", "/AddressBook",
  "/Correspondence", "/Settings", "/BitAegis", "/barrierefreiheit",
];

// Loaded at runtime through a variable, so a missing package skips instead of breaking
// the whole suite at import time.
const AXE_PAKET = "@axe-core/playwright";
/** @type {any} */
let AxeBuilder = null;
try {
  AxeBuilder = (await import(AXE_PAKET)).default;
} catch {
  AxeBuilder = null;
}

/** @returns {Record<string, Record<string, number>>} */
const basisLesen = () => (fs.existsSync(BASIS_DATEI) ? JSON.parse(fs.readFileSync(BASIS_DATEI, "utf8")).seiten || {} : {});

/** @type {Record<string, Record<string, number>>} */
const gemessen = {};
/** @type {{ basis: string, stoppen: () => void } | null} */
let server = null;

test.describe("93-02 axe über alle Modulseiten (WCAG 2.1 AA)", () => {
  // Not serial: one failed page must not keep the remaining pages from being compared.
  test.describe.configure({ timeout: 120000 });
  test.skip(!AxeBuilder, "@axe-core/playwright nicht installiert — neue devDependency braucht das Ja des Nutzers (93-02-PLAN)");

  test.beforeAll(async () => {
    server = await privatenServerStarten(PRIVAT_PORT);
  });

  test.afterAll(() => {
    server?.stoppen();
    if (SCHREIBEN && Object.keys(gemessen).length) {
      const daten = { hinweis: "Bekannte axe-Verstöße je Seite (Regel → Anzahl Knoten). Nur schrumpfen lassen: docs/BARRIEREFREIHEIT-PRUEFUNG.md", tags: WCAG_TAGS, seiten: { ...basisLesen(), ...gemessen } };
      fs.writeFileSync(BASIS_DATEI, `${JSON.stringify(daten, null, 2)}\n`);
    }
  });

  for (const pfad of SEITEN) {
    test(`${pfad}: keine neuen Verstöße`, async ({ page }) => {
      await page.clock.setFixedTime(ZEITPUNKT);
      await apiUmleiten(page, server?.basis || "");
      await page.goto(pfad);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await expect(page.locator("main").first()).toBeVisible({ timeout: 30000 });

      const ergebnis = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      /** @type {Record<string, number>} */
      const jeRegel = {};
      for (const v of ergebnis.violations) jeRegel[v.id] = v.nodes.length;
      gemessen[pfad] = jeRegel;
      if (SCHREIBEN) return;

      const bekannt = basisLesen()[pfad] || {};
      const neu = Object.entries(jeRegel)
        .filter(([id, n]) => n > (bekannt[id] || 0))
        .map(([id, n]) => {
          const v = ergebnis.violations.find((x) => x.id === id);
          return `${id}: ${n} Knoten (Basis ${bekannt[id] || 0}) — ${v?.help}\n    ${v?.nodes.slice(0, 3).map((k) => k.target.join(" ")).join("\n    ")}`;
        });
      const weniger = Object.entries(bekannt).filter(([id, n]) => (jeRegel[id] || 0) < n).map(([id, n]) => `${id} ${n} → ${jeRegel[id] || 0}`);
      if (weniger.length) console.log(`[axe] ${pfad}: weniger als in der Basis — Basis senken: ${weniger.join(", ")}`);
      expect(neu, `Neue Barrieren auf ${pfad}`).toEqual([]);
    });
  }
});
