// Headless-Nachweis 86-02 (Schrägen): im Massing-Studio die Ecke unten rechts des
// Review-Testhauses 8 m nach unten ziehen (Rechteck 70 × 16 → Viereck mit schräger Längsseite;
// zur Seite lässt die Grundstücksgrenze nichts zu) — die Werkstatt schlägt den Restkeil den Fensterräumen davor zu (Hinweis
// [86-02], Räume mit einer nicht achsparallelen Kante = Schrägwand). Danach Ecke zurück → Rechteck, kein
// Zuschlag. Der Baukörper wird am Ende über fixtures/base.js zurückgesetzt.
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

test.describe("86-02 Schrägen: Restkeile werden den Fensterräumen zugeschlagen", () => {
  test.setTimeout(300000);

  test("Ecke 8 m nach unten → Viereck mit schräger Kante; Werkstatt meldet [86-02], Räume mit Schrägwand; zurück → Rechteck ohne [86-02]", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.locator("select[data-massstab]").first().selectOption("200");
    await page.waitForTimeout(1500);
    const start = await punkte(page);
    expect(start.pts.length, "Review-Testhaus ist ein Rechteck").toBe(4);
    const idx = eckeUntenRechts(start.pts);

    try {
      await page.locator('[data-griff="ecke"]').nth(idx).focus();
      await presse(page, "ArrowDown", 80);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2500); // footprint save (debounced)
      const viereck = await punkte(page);
      expect(Math.abs(viereck.pts[idx].y - start.pts[idx].y - 8), "Ecke 8 m verschoben").toBeLessThan(0.05);

      await page.goto(SEITE_WERKSTATT);
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await expect(page.getByText(/Schrägen \[86-02\]: \d+ Fensterräume an Schrägen erweitert/).first()).toBeVisible({ timeout: 15000 });
      // Store zones (wt-we) exist only after "Tesselierung anwenden" (pattern fokus-75-09).
      const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
      for (let i = 0; i < 3 && !(await page.getByTestId("wt-we").count()) && (await anwenden.count()) && !(await anwenden.isDisabled()); i += 1) {
        await anwenden.click();
        await page.waitForTimeout(1500);
      }
      expect(await page.getByTestId("wt-we").count(), "Raumzonen im Store").toBeGreaterThan(0);
      // Rooms with a slanted wall: the house is axis-parallel except the dragged edge, so a room
      // path with a segment that is neither horizontal nor vertical has a slanted outer wall.
      const schraeg = await page.evaluate(() => [...document.querySelectorAll('[data-testid="wt-we"]')].filter((e) => {
        const p = (e.getAttribute("d") || "").match(/-?[0-9.]+,-?[0-9.]+/g)?.map((s) => s.split(",").map(Number)) || [];
        return p.some((a, i) => { const b = p[(i + 1) % p.length]; return Math.abs(b[0] - a[0]) > 0.5 && Math.abs(b[1] - a[1]) > 0.5; });
      }).length);
      expect(schraeg, "mindestens ein Raum mit Schrägwand").toBeGreaterThan(0);
      await page.screenshot({ path: test.info().outputPath("86-02-werkstatt-schraegen.png"), fullPage: false });

      await page.goto(SEITE_STUDIO);
      await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
      await page.locator("select[data-massstab]").first().selectOption("200");
      await page.waitForTimeout(1000);
      await page.locator('[data-griff="ecke"]').nth(idx).focus();
      await presse(page, "ArrowUp", 80);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2500);
      await page.goto(SEITE_WERKSTATT);
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
      expect(await page.getByText(/Schrägen \[86-02\]/).count(), "Rechteck: kein Zuschlag").toBe(0);
    } finally {
      // 87-01: fixtures/base.js restores the house through the API after the test.
      await page.waitForTimeout(1500);
    }
    expect(warnungen, warnungen.join(" | ")).toEqual([]);
  });
});
