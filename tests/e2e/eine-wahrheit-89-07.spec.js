// Headless-Nachweis 89-07 Teil 2 (BW-09, D-BW-05): eine Wahrheit für Türen und Werkstatt-Bauteile.
//
//   1. AVA ohne Werkstatt-Sitzung: die Werkstatt des Review-Testhauses ist angewendet und
//      gespeichert; ein frischer Seitenaufruf der AVA (Store leer, keine Werkstatt gerechnet)
//      zeigt die Werkstatt-Bauteile trotzdem — abgeleitet aus dem gespeicherten werkstatt_layer +
//      Bauprogramm (data-quelle "datensatz"), bei jedem Laden dieselbe Zahl. Nichts wird doppelt
//      gespeichert.
//   2. Ein Türsystem im Fokus: jede Zonentür trägt die Bauteil-GUID; den Aufschlag drehen ändert
//      die GUID nicht (gleicher Schlüssel wie werkstatt_layer.tuerAufschlaege), der Katalog bietet
//      keine Tür an. Undo stellt den Aufschlag wieder her (Aufräumen).
//
// Deterministisch: werkstattBereit wendet die Tesselierung an, falls ein früherer Lauf sie
// entfernt hat, und wartet die Speicher-Entprellung ab. --workers=1 (geteilte server/db.json).

import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";

const PROJEKT = encodeURIComponent("Review Testhaus");
const SEITE_WERKSTATT = `/ComplexDesigner?projekt=${PROJEKT}&tab=werkstatt`;
const SEITE_AVA = `/AVA?projekt=${PROJEKT}&tab=mengenregeln`;
const GUID = /^[0-3][0-9A-Za-z_$]{21}$/;

/**
 * Offline route guard + console/pageerror watchers (pattern bauteile-89-02).
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>} collected warnings (empty = clean)
 */
async function wacheAuf(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
  });
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/**
 * Workshop tab ready with applied unit zones; waits out the useFachlayer save debounce so the
 * saved record carries `angewendet: true` before any reload (pattern bauteile-89-02).
 * @param {import("@playwright/test").Page} page
 */
async function werkstattBereit(page) {
  await page.goto(SEITE_WERKSTATT);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await schalteRegel(page, "fensterJeRaum", false);
  if (!(await page.getByTestId("wt-we").count())) {
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    await expect(anwenden).toBeVisible({ timeout: 15000 });
    const entfernen = page.getByRole("button", { name: /entfernen/i }).first();
    if ((await anwenden.isDisabled()) && (await entfernen.count())) {
      await entfernen.click();
      await page.waitForTimeout(800);
    }
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) {
      await anwenden.click();
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1600);
  expect(await page.getByTestId("wt-we").count(), "WE-Zonen vorhanden").toBeGreaterThan(0);
}

test.describe("89-07 Eine Wahrheit — Türen und Werkstatt-Bauteile", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 180000 });

  test("AVA sieht die Werkstatt-Bauteile ohne Werkstatt-Sitzung (abgeleitet, nicht gespeichert)", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);

    // Fresh load of the AVA: the shared store is empty, the workshop never ran on this page.
    await page.goto(SEITE_AVA);
    const zeile = page.getByTestId("ava-werkstatt-bauteile");
    await expect(zeile).toBeVisible({ timeout: 45000 });
    await expect(zeile).toHaveAttribute("data-quelle", "datensatz");
    const n1 = Number(await zeile.getAttribute("data-anzahl"));
    expect(n1, "Innenwände + Innentüren der Werkstatt").toBeGreaterThan(20);
    await expect(zeile).toContainText("aus der gespeicherten Werkstatt abgeleitet");

    // Second fresh load: the same derivation gives the same number (deterministic, one truth).
    await page.reload();
    await expect(page.getByTestId("ava-werkstatt-bauteile")).toHaveAttribute("data-quelle", "datensatz", { timeout: 45000 });
    expect(Number(await page.getByTestId("ava-werkstatt-bauteile").getAttribute("data-anzahl")), "gleiche Zahl nach Reload").toBe(n1);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("Fokus: Zonentür = Bauteil mit GUID, Aufschlag drehen behält die GUID, Katalog ohne Tür", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);
    await page.waitForTimeout(1500);
    const we = await page.getByTestId("wt-we").first().getAttribute("data-we");
    expect(we, "data-we der ersten WE").toBeTruthy();
    await page.goto(`${SEITE_WERKSTATT}&we=${encodeURIComponent(we)}`);
    await expect(page.getByText(`Fokusansicht: ${we}`).first()).toBeVisible({ timeout: 30000 });

    const fokus = page.getByTestId("wt-fokus");
    const hinweis = page.getByTestId("fk-tueren-bauteil");
    await expect(hinweis).toHaveCount(1, { timeout: 15000 });
    const tueren = fokus.locator('[data-testid="fk-tuer"]');
    const guids = await tueren.evaluateAll((els) => els.map((e) => e.getAttribute("data-guid")));
    expect(guids.length, "Zonentüren im Fokus").toBeGreaterThan(1);
    for (const g of guids) expect(g).toMatch(GUID);
    expect(new Set(guids).size, "GUIDs eindeutig").toBe(guids.length);
    expect(Number(await hinweis.getAttribute("data-anzahl")), "Bauteil-Türen = Türsymbole").toBe(guids.length);
    await expect(page.locator('button:has([data-katalog-typ="tuer_885"]), button:has([data-katalog-typ="tuer_1010"])')).toHaveCount(0);

    // Toggle the swing of one room door: the leaf flips, the component keeps its GUID.
    const zimmerTuer = fokus.locator('[data-testid="fk-tuer"][data-typ="zimmer"]').first();
    const guid = await zimmerTuer.getAttribute("data-guid");
    const vorher = await zimmerTuer.getAttribute("data-tuer");
    await zimmerTuer.dispatchEvent("click");
    await page.waitForTimeout(1200);
    const nachher = fokus.locator(`[data-testid="fk-tuer"][data-guid="${guid}"]`);
    await expect(nachher).toHaveCount(1);
    expect(await nachher.getAttribute("data-tuer"), "Aufschlag gedreht").not.toBe(vorher);

    // Clean up: undo restores the swing (the layer is saved again through the same path).
    await page.getByTestId("fk-tuer-undo").dispatchEvent("click");
    await page.waitForTimeout(1200);
    expect(await fokus.locator(`[data-testid="fk-tuer"][data-guid="${guid}"]`).getAttribute("data-tuer"), "Undo").toBe(vorher);
    await page.waitForTimeout(1600);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
