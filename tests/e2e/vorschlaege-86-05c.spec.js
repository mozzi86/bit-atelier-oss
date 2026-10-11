// Headless-Nachweis 86-05c (Bebauungsvorschläge: Vergleich + „ähnliche erzeugen“) am Review-
// Testhaus. Rechteck 70 × 16: zwei Karten wählen → „Vergleichen (2/4)“ öffnet die Tabelle mit
// beiden Spalten in Auswahlreihenfolge, die beste WE-Zelle ist markiert (größter Wert),
// die Fußzeile nennt Einheit und Quelle; „ähnliche“ fügt beim Rechteck nichts hinzu (Hinweis).
// Dann Grundfläche per API → L: „ähnliche“ an einer Karte fügt Karten mit „ähnlich zu“ an,
// ein zweiter Klick fügt nichts hinzu (Dedupe, kein Zufall). Konsole bleibt sauber; base.js
// setzt das Haus nach dem Test zurück.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { testhausFootprintSetzen } from "./fixtures/testhaus.js";
import { FOOTPRINTS } from "./fixtures/footprints.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";

async function wacheAuf(page) {
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

test.describe("86-05c Bebauungsvorschläge: Vergleich und ähnliche erzeugen", () => {
  test.setTimeout(300000);

  test("Vergleich 2 Karten mit bester Zelle + Quellen; Rechteck ohne Nachbarn; L: ähnliche anhängen, zweiter Klick ohne Neues", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-tab-vorschlaege")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-tab-vorschlaege").click();
    const karten = page.locator('[data-testid="vs-karte"]');
    await expect(karten).toHaveCount(5, { timeout: 60000 });

    // Selection: second card first, then the first → columns in click order.
    await expect(page.getByTestId("vs-vergleichen")).toBeDisabled();
    const idA = await karten.nth(1).getAttribute("data-vorschlag");
    const idB = await karten.nth(0).getAttribute("data-vorschlag");
    const weA = Number(await karten.nth(1).getAttribute("data-we"));
    const weB = Number(await karten.nth(0).getAttribute("data-we"));
    await karten.nth(1).getByTestId("vs-auswahl").check();
    await karten.nth(0).getByTestId("vs-auswahl").check();
    await expect(page.getByTestId("vs-vergleichen")).toHaveAttribute("data-anzahl", "2");
    await page.getByTestId("vs-vergleichen").click();
    const tabelle = page.getByTestId("vs-vergleich");
    await expect(tabelle).toBeVisible();
    const spalten = await page.getByTestId("vs-vergleich-spalte").evaluateAll((els) => els.map((el) => el.getAttribute("data-vorschlag")));
    expect(spalten, "Reihenfolge = Auswahlreihenfolge").toEqual([idA, idB]);

    // Best WE cell = larger value ("absteigend"); a tie marks both.
    const weZellen = page.locator('[data-testid="vs-vergleich-zelle"][data-kennzahl="we"]');
    await expect(weZellen).toHaveCount(2);
    const bestIds = await page.locator('[data-testid="vs-vergleich-zelle"][data-kennzahl="we"][data-best="1"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-vorschlag")));
    const erwartet = weA === weB ? [idA, idB] : [weA > weB ? idA : idB];
    expect(bestIds.sort()).toEqual(erwartet.sort());
    await expect(page.getByTestId("vs-vergleich-quellen")).toContainText("WE");
    await expect(page.getByTestId("vs-vergleich-quellen")).toContainText("tesseliere weListe");

    // Remove one column → the comparison closes below two (button disabled again).
    await page.getByTestId("vs-vergleich-entfernen").first().click();
    await expect(page.getByTestId("vs-vergleich")).toHaveCount(0);
    await expect(page.getByTestId("vs-vergleichen")).toBeDisabled();

    // Rectangle: no neighbours.
    await karten.first().getByTestId("vs-aehnliche").click();
    await expect(page.getByTestId("vs-aehnlich-hinweis")).toHaveAttribute("data-neu", "0", { timeout: 30000 });
    await expect(karten).toHaveCount(5);

    // L footprint → "ähnliche" appends cards, the second click adds nothing.
    await testhausFootprintSetzen(page.request, FOOTPRINTS.L.footprintM);
    await page.reload();
    await expect(page.getByTestId("wt-tab-vorschlaege")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-tab-vorschlaege").click();
    await expect(page.locator('[data-testid="vs-karte"][data-riegel="2"]').first()).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("vs-panel")).toHaveAttribute("data-laedt", "0");
    const vorher = await karten.count();
    const quelle = karten.filter({ hasNot: page.getByTestId("vs-ursprung") }).first();
    const quelleId = await quelle.getAttribute("data-vorschlag");
    await quelle.getByTestId("vs-aehnliche").click();
    await expect(page.getByTestId("vs-aehnlich-hinweis")).toBeVisible({ timeout: 60000 });
    const neu = Number(await page.getByTestId("vs-aehnlich-hinweis").getAttribute("data-neu"));
    expect(neu, "L: mindestens ein ähnlicher Vorschlag").toBeGreaterThan(0);
    await expect(karten).toHaveCount(vorher + neu);
    await expect(page.locator(`[data-testid="vs-karte"][data-ursprung="${quelleId}"]`)).toHaveCount(neu);

    await page.locator(`[data-testid="vs-karte"][data-vorschlag="${quelleId}"]`).getByTestId("vs-aehnliche").click();
    await expect(page.getByTestId("vs-aehnlich-hinweis")).toHaveAttribute("data-neu", "0", { timeout: 60000 });
    await expect(karten).toHaveCount(vorher + neu);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
