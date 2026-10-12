// Headless-Nachweis 86-07 (Achse zeichnen): im Massing-Studio „Achse zeichnen", zwei Klicks
// links und rechts in der Mitte des Review-Testhauses (70 × 16), „Achse fertig" → zwei rote
// Achspunkte; die Achse wird mit dem Bauprogramm gespeichert. In der Werkstatt „Bebauung: entlang
// der Achse" → Hinweis [86-07] (Riegel mittig auf der Achse); nach Reload bleibt er (Achse aus
// dem BimModel). Aufräumen über die UI: Achse löschen (achseM ist ein Programmfeld, das
// fixtures/base.js nicht zurücksetzt) und Bebauung zurück auf automatisch.
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

test.describe("86-07 Achse zeichnen: Riegel entlang der Mittellinie", () => {
  test.setTimeout(300000);

  test("Studio: Achse mit zwei Klicks; Werkstatt: entlang der Achse → [86-07], hält den Reload; Achse löschen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_STUDIO);
    const flaeche = page.locator('polygon[data-griff="flaeche"]');
    await expect(flaeche).toBeVisible({ timeout: 30000 });
    await page.locator("select[data-massstab]").first().selectOption("200");
    await page.waitForTimeout(1500);
    try {
      const box = await flaeche.boundingBox();
      const y = box.y + box.height / 2;
      await page.getByTestId("ms-achse").click();
      await expect(page.getByTestId("ms-achse")).toHaveAttribute("data-aktiv", "1");
      await page.mouse.click(box.x + box.width * 0.03, y);
      await page.mouse.click(box.x + box.width * 0.97, y);
      await page.getByTestId("ms-achse").click();
      await expect(page.getByTestId("ms-achse")).toHaveAttribute("data-aktiv", "0");
      await expect(page.getByTestId("ms-achse")).toHaveAttribute("data-punkte", "2");
      expect(await page.getByTestId("ms-achse-punkt").count()).toBe(2);
      await page.waitForTimeout(2500); // programme save (debounced 1,5 s)

      await page.goto(SEITE_WERKSTATT);
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await page.getByTestId("wt-zerlegung").selectOption("achse");
      await page.waitForTimeout(1500);
      await expect(page.getByText(/Achse \[86-07\]: \d Riegel entlang der gezeichneten Achse/).first()).toBeVisible({ timeout: 15000 });
      expect(await page.getByTestId("wt-achse-fehlt").count(), "Achse vorhanden").toBe(0);
      await page.waitForTimeout(1800); // layer save
      await page.reload();
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(/Achse \[86-07\]/).first()).toBeVisible({ timeout: 20000 });
      await page.getByTestId("wt-zerlegung").selectOption("auto");
      await page.waitForTimeout(1800);
    } finally {
      // Clean up the programme field through the UI (one write path).
      await page.goto(SEITE_STUDIO);
      await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
      // The button appears once the BimModel (with the axis) is loaded — wait for it.
      const loeschen = page.getByTestId("ms-achse-loeschen");
      await loeschen.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      if (await loeschen.count()) await loeschen.click();
      await page.waitForTimeout(2500);
    }
    await page.reload();
    await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
    expect(await page.getByTestId("ms-achse-punkt").count(), "Achse gelöscht und gespeichert").toBe(0);
    expect(warnungen, warnungen.join(" | ")).toEqual([]);
  });
});
