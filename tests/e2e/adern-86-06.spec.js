// Headless-Nachweis 86-06 (Adern aus dem Skelett): Werkstatt des Review-Testhauses (70 × 16) →
// „Bebauung: Adern aus dem Skelett (Freiform)" → Hinweis [86-06] mit Strahler-Ordnung, Murray-
// Breite und dem Vergleich zur automatischen Zerlegung; die Ader liegt als Linie im Plan
// (wt-ader). Zurück auf automatisch → keine Ader. Layer-Reset über fixtures/base.js.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const PROJEKT = "projekt=Review%20Testhaus";
const SEITE_WERKSTATT = `/ComplexDesigner?${PROJEKT}&tab=werkstatt`;

async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

test.describe("86-06 Adern aus dem Skelett", () => {
  test.setTimeout(180000);

  test("Testhaus: Skelett-Ader + Riegel, Hinweis mit Vergleich; automatisch → keine Ader", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-zerlegung").selectOption("skelett");
    await page.waitForTimeout(1500);
    await expect(page.getByText(/Adern \[86-06\]: \d Riegel aus dem Skelett der Form/).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/automatische Zerlegung belegt \d+ %/).first()).toBeVisible();
    expect(await page.getByTestId("wt-ader").count(), "Ader im Plan").toBeGreaterThanOrEqual(1);
    expect(Number(await page.getByTestId("wt-ader").first().getAttribute("data-breite")), "Murray-Breite ≥ 1,20 m").toBeGreaterThanOrEqual(1.2);
    expect(await page.getByTestId("wt-ader").first().getAttribute("data-zwang"), "Ader aus dem Skelett, keine gezeichnete Achse").toBe("0");
    await page.screenshot({ path: test.info().outputPath("86-06-adern.png"), fullPage: false });
    await page.getByTestId("wt-zerlegung").selectOption("auto");
    await page.waitForTimeout(1500);
    expect(await page.getByTestId("wt-ader").count(), "automatisch: keine Ader").toBe(0);
    await page.waitForTimeout(1500); // layer save before the fixture restores the house
    expect(warnungen, warnungen.join(" | ")).toEqual([]);
  });
});
