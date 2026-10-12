// Headless-Nachweis 75-10 (Varianten-Bewertung): Werkstatt › „Vorschläge" am Review-Testhaus →
// Sortierung „Bewertung (gewichtet)" → jede Karte trägt Rang + Score, Score nicht steigend,
// „Warum Rang 1" zeigt die Beiträge je Dimension. Regler „Kompaktheit A/V" auf 3 und
// „Wohnfläche / BGF" auf 0 (Tastatur am nativen Range) → Gewichte im Layer, nach Reload noch da;
// „Bürostandard" stellt zurück. Nur harte Regeln schließen aus, keine weichen Kriterien.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";
/** Typologies of the proposal axis (VARIANTEN_ACHSEN.erschliessung) — the spec cannot import the aliased lib. */
const ERSCHLIESSUNGEN = 5;

async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** data-<attr> of every card in DOM order, as numbers. */
async function kartenWerte(page, attr) {
  return (await page.locator('[data-testid="vs-karte"]').evaluateAll((els, a) => els.map((el) => Number(el.getAttribute(`data-${a}`))), attr));
}
const nichtSteigend = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] >= v);

test.describe("75-10 Varianten-Bewertung", () => {
  test.setTimeout(300000);

  test("Rang je Karte, Score sortiert, Warum Rang 1; Gewichte verschieben, Reload, Bürostandard", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-tab-vorschlaege")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-tab-vorschlaege").click();
    await expect(page.locator('[data-testid="vs-karte"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("vs-panel")).toHaveAttribute("data-laedt", "0");

    await page.getByTestId("vs-sortierung").selectOption("bewertung");
    await page.waitForTimeout(300);
    const anzahl = await page.locator('[data-testid="vs-karte"]').count();
    const raenge = await page.getByTestId("vs-rang").count(), kos = await page.getByTestId("vs-ko").count();
    expect(raenge + kos, "jede Karte hat Rang oder K.-o.").toBe(anzahl);
    expect(nichtSteigend((await page.getByTestId("vs-rang").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-score")))))), "Score nicht steigend").toBe(true);
    await expect(page.getByTestId("vs-rang").first()).toHaveAttribute("data-rang", "1");
    const warum = page.getByTestId("vs-warum");
    await expect(warum).toBeVisible();
    expect(await warum.locator("li").count(), "vier Dimensionen mit Gewicht > 0").toBe(4);

    // Sliders (native range → keyboard): A/V to 3, Wohnfläche/BGF to 0.
    await page.locator('[data-testid="vs-gewicht"][data-key="av"]').focus();
    await page.keyboard.press("End");
    await page.locator('[data-testid="vs-gewicht"][data-key="effizienz"]').focus();
    await page.keyboard.press("Home");
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="vs-gewicht"][data-key="av"]')).toHaveValue("3");
    expect(await warum.locator("li").count(), "Effizienz ohne Gewicht fällt aus der Begründung").toBe(3);
    await expect(page.getByTestId("vs-gewichte-standard")).toBeEnabled();

    await page.waitForTimeout(1800); // layer save
    await page.reload();
    await expect(page.getByTestId("wt-tab-vorschlaege")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-tab-vorschlaege").click();
    await expect(page.locator('[data-testid="vs-karte"]').first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-testid="vs-gewicht"][data-key="av"]')).toHaveValue("3");
    await page.getByTestId("vs-bewertung").locator("summary").click();
    await page.getByTestId("vs-gewichte-standard").click();
    await expect(page.locator('[data-testid="vs-gewicht"][data-key="av"]')).toHaveValue("1");
    await expect(page.locator('[data-testid="vs-gewicht"][data-key="graueEnergie"]')).toHaveValue("0");
    await page.waitForTimeout(1800);
    expect(warnungen, warnungen.join(" | ")).toEqual([]);
  });
});
