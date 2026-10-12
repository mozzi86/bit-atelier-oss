// Headless-Nachweis 86-04 (Randbebauung/Hof): im Massing-Studio beide unteren Ecken des
// Review-Testhauses 15 m nach unten ziehen (70 × 16 → 70 × 31; weiter lässt die Grundstücksgrenze
// nicht zu), in der Werkstatt Laubengang (Randtiefe 9 m) und „Randbebauung (Hof)" wählen →
// mehrere Riegel entlang der Kanten mit Hof, Hinweis [86-04]; Riegel 2 bekommt 6 Geschosse →
// der Hinweis nennt die eigene Geschosszahl, das Geschoss-Menü reicht bis OG 5; zurück auf
// „automatisch" → kein [86-04]. Der Baukörper und der Werkstatt-Layer werden über
// fixtures/base.js zurückgesetzt (87-01).
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

/** Corners with the largest y (the two bottom corners on screen), left one first. */
const untereEcken = (pts) => pts.map((p, i) => ({ ...p, i })).sort((a, b) => b.y - a.y).slice(0, 2).sort((a, b) => a.x - b.x).map((p) => p.i);

/** Radix select "Erschließung" (portal): open, pick by visible label (pattern tueren-84-05). */
async function setzeTypologie(page, label) {
  const trigger = page.getByTestId("wt-typologie");
  if ((await trigger.textContent())?.trim() === label) return;
  await trigger.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(trigger).toHaveText(label);
}

test.describe("86-04 Randbebauung: Riegel entlang der Kanten um einen Hof", () => {
  test.setTimeout(300000);

  test("Block 70 × 31, Laubengang, Randbebauung → Riegel + Hof + [86-04]; Riegel 2 mit 6 Geschossen; zurück auf automatisch", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_STUDIO);
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.locator("select[data-massstab]").first().selectOption("200");
    await page.waitForTimeout(1500);
    const start = await punkte(page);
    expect(start.pts.length, "Review-Testhaus ist ein Rechteck").toBe(4);
    try {
      for (const i of untereEcken(start.pts)) {
        await page.locator('[data-griff="ecke"]').nth(i).focus();
        await presse(page, "ArrowDown", 150);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(2500); // footprint save (debounced)
      const block = await punkte(page);
      const ys = block.pts.map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys), "Block 31 m tief").toBeGreaterThan(30.9);

      await page.goto(SEITE_WERKSTATT);
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await setzeTypologie(page, "Laubengang");
      await page.getByTestId("wt-zerlegung").selectOption("rand");
      await page.waitForTimeout(1500);
      await expect(page.getByText(/Randbebauung \[86-04\]: \d Riegel entlang der Kanten/).first()).toBeVisible({ timeout: 15000 });
      expect(await page.getByTestId("wt-riegel").count(), "mehrere Riegel").toBeGreaterThanOrEqual(2);
      expect(await page.getByTestId("wt-form-rest").count(), "Hof als Restfläche").toBeGreaterThan(0);
      await page.screenshot({ path: test.info().outputPath("86-04-randbebauung.png"), fullPage: false });

      // Own storey count for house 2.
      const g2 = page.locator('[data-testid="wt-riegel-geschosse"][data-riegel="2"]');
      await g2.fill("6");
      await g2.press("Tab");
      await page.waitForTimeout(1500);
      await expect(page.getByText(/eigene Geschosszahl: Riegel 2 6/).first()).toBeVisible({ timeout: 15000 });

      // Back to the automatic decomposition: no perimeter hint any more.
      await page.getByTestId("wt-zerlegung").selectOption("auto");
      await page.waitForTimeout(1500);
      expect(await page.getByText(/Randbebauung \[86-04\]/).count(), "automatisch: kein [86-04]").toBe(0);
    } finally {
      // 87-01: fixtures/base.js restores footprint and layers through the API after the test.
      await page.waitForTimeout(1500);
    }
    expect(warnungen, warnungen.join(" | ")).toEqual([]);
  });
});
