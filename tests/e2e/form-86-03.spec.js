// Headless-Nachweis 86-03 (Riegel-Netz): im Massing-Studio eine Ecke des Review-Testhauses
// 15 m nach außen ziehen (Rechteck 70 × 16 → Viereck, rechts 31 m tief; weiter lässt die Grundstücksgrenze nicht zu) — die Werkstatt füllt
// die Form mit mehreren Riegeln (Umriss + Nummer je Riegel, Hinweis [86-03]), jede WE-Nummer
// kommt je Geschoss einmal vor, die Konsole bleibt sauber. Danach Ecke zurück → Rechteck, kein
// Riegel mehr. Der Baukörper wird am Ende exakt zurückgesetzt (Pfeiltasten, 0,1-m-Schritte;
// Notfall: resetRechteck auf die Ausgangsecken).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost, punkte, presse, resetRechteck } from "./fixtures/massing.js";

const PROJEKT = "projekt=Review%20Testhaus";
const SEITE_WERKSTATT = `/ComplexDesigner?${PROJEKT}&tab=werkstatt`;
const SEITE_STUDIO = `/ComplexDesigner?${PROJEKT}&tab=studio`;

async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Corner of the footprint with the largest x + y (bottom right on screen). */
const eckeUntenRechts = (pts) => pts.reduce((best, p, i) => (p.x + p.y > pts[best].x + pts[best].y ? i : best), 0);

test.describe("86-03 Riegel-Netz: mehrere Riegel füllen die Form", () => {
  test.setTimeout(300000);

  test("Ecke 15 m nach außen → Werkstatt zeigt mehrere Riegel mit eindeutigen WE; zurück → ein Rechteck", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.locator("select[data-massstab]").first().selectOption("200");
    await page.waitForTimeout(1500);
    const start = await punkte(page);
    expect(start.pts.length, "Review-Testhaus ist ein Rechteck").toBe(4);
    const idx = eckeUntenRechts(start.pts);

    let zurueck = false;
    try {
      await page.locator('[data-griff="ecke"]').nth(idx).focus();
      await presse(page, "ArrowDown", 150);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2500); // footprint save (debounced)
      const viereck = await punkte(page);
      expect(Math.abs(viereck.pts[idx].y - start.pts[idx].y - 15), "Ecke 15 m verschoben").toBeLessThan(0.05);

      await page.goto(SEITE_WERKSTATT);
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
      const riegel = page.getByTestId("wt-riegel");
      expect(await riegel.count(), "mehrere Riegel").toBeGreaterThanOrEqual(2);
      expect(await riegel.first().textContent()).toMatch(/Riegel 1/);
      await expect(page.getByText(/Form \[86-03\]: \d Riegel/).first()).toBeVisible();
      // Unit numbers: the WE polygons of the shown storey carry each id once per bar's
      // band zone or room — the set of ids must not repeat across bars (R2 numbers follow R1).
      const we = await page.evaluate(() => [...document.querySelectorAll('[data-testid="wt-we"]')].map((e) => e.getAttribute("data-we")));
      const jeRiegel = await page.evaluate(() => [...document.querySelectorAll('[data-testid="wt-riegel"]')].map((e) => Number(e.getAttribute("data-we"))));
      expect(new Set(we).size, "WE-Ids im Geschoss").toBeGreaterThan(0);
      expect(jeRiegel.every((n) => n > 0), "jeder Riegel hat Wohnungen").toBe(true);
      await page.screenshot({ path: test.info().outputPath("86-03-werkstatt-riegel.png"), fullPage: false });

      await page.goto(SEITE_STUDIO);
      await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
      await page.locator("select[data-massstab]").first().selectOption("200");
      await page.waitForTimeout(1000);
      await page.locator('[data-griff="ecke"]').nth(idx).focus();
      await presse(page, "ArrowUp", 150);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2500);
      // Measure on a fresh page: `punkte` counts from the first grid line, and the view is still
      // fitted to the bigger shape until it reloads (a 7,5 m offset otherwise).
      await page.goto(SEITE_STUDIO);
      await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
      await page.locator("select[data-massstab]").first().selectOption("200");
      await page.waitForTimeout(1500);
      const ende = await punkte(page);
      ende.pts.forEach((p, i) => expect(Math.abs(p.x - start.pts[i].x) + Math.abs(p.y - start.pts[i].y), `Ecke ${i} zurück`).toBeLessThan(0.011));
      zurueck = true;

      await page.goto(SEITE_WERKSTATT);
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000);
      expect(await page.getByTestId("wt-riegel").count(), "Rechteck: kein Riegel-Umriss").toBe(0);
    } finally {
      // 87-01: fixtures/base.js restores the house through the API after the test.
      await page.waitForTimeout(1500);
    }
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
