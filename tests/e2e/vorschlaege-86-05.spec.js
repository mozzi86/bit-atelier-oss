// Headless-Nachweis 86-05b (Bebauungsvorschläge): Werkstatt › Reiter „Vorschläge“ am Review-
// Testhaus (Rechteck 70 × 16) → fünf Karten (eine je Erschließung — Mittelflur, Laubengang,
// Spänner, Reihenhaus, MFH; `efh` ausgenommen), Sortierung per <select> ändert die Reihenfolge
// (geprüft als Monotonie der data-Werte), „Übernehmen“ setzt die Typologie, der Kopf zeigt den
// gewählten Vorschlag, nach Reload bleibt er, die Karten-WE stimmen mit der Werkstatt überein
// (QA-Pflichttest). Dann die Grundfläche per API auf das L (fixtures/footprints.js) → Badge
// „Vorschlag veraltet“, Karte mit 2 Riegeln. Konsole bleibt sauber. base.js setzt das Haus
// (Footprint + Layer) nach jedem Test zurück.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { testhausFootprintSetzen } from "./fixtures/testhaus.js";
import { FOOTPRINTS } from "./fixtures/footprints.js";

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
const nichtFallend = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] <= v);

test.describe("86-05b Bebauungsvorschläge: Karten, Sortierung, Übernehmen, veraltet", () => {
  test.setTimeout(300000);

  test("Rechteck → 5 Karten, Sortierung monoton, Übernehmen setzt MFH und hält den Reload; L → veraltet + 2 Riegel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    const warnungen = await wacheAuf(page);
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-tab-vorschlaege")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-tab-vorschlaege").click();
    const karten = page.locator('[data-testid="vs-karte"]');
    await expect(karten).toHaveCount(ERSCHLIESSUNGEN, { timeout: 60000 });
    await expect(page.getByTestId("vs-panel")).toHaveAttribute("data-laedt", "0");

    // Sorting: default "we" descending; "erschliessung_m" ascending (register direction).
    expect(nichtSteigend(await kartenWerte(page, "we")), "WE absteigend").toBe(true);
    await page.getByTestId("vs-sortierung").selectOption("erschliessung_m");
    await page.waitForTimeout(200);
    expect(nichtFallend(await kartenWerte(page, "erschliessung")), "Erschließungslänge aufsteigend").toBe(true);
    await page.getByTestId("vs-sortierung").selectOption("we");

    // Apply the MFH proposal → typology select shows it, head badge names the proposal.
    const mfh = karten.filter({ has: page.locator('[data-typ="mfh"]') }).or(page.locator('[data-testid="vs-karte"][data-typ="mfh"]')).first();
    const mfhWe = Number(await mfh.getAttribute("data-we"));
    const mfhId = await mfh.getAttribute("data-vorschlag");
    await mfh.getByTestId("vs-uebernehmen").click();
    await expect(page.getByTestId("vs-hinweis")).toBeVisible();
    await expect(page.getByTestId("wt-typologie")).toContainText("Mehrfamilienhaus");
    await expect(page.getByTestId("wt-vorschlag-aktiv")).toHaveAttribute("data-vorschlag", mfhId);
    await expect(mfh).toHaveAttribute("data-gewaehlt", "1");
    // QA: card figure = workshop figure (unit counter "R-Wohnungen im Gebäude: r / N").
    const zaehler = await page.getByTestId("r-zaehler").textContent();
    const gesamt = Number((zaehler || "").split("/").pop());
    expect(gesamt, "WE der Karte = WE der Werkstatt").toBe(mfhWe);

    // Persisted: the layer saves debounced (1,2 s) — reload keeps typology and proposal.
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(page.getByTestId("wt-typologie")).toContainText("Mehrfamilienhaus", { timeout: 30000 });
    await expect(page.getByTestId("wt-vorschlag-aktiv")).toHaveAttribute("data-vorschlag", mfhId);
    await expect(page.getByTestId("wt-vorschlag-veraltet")).toHaveCount(0);

    // Footprint → L through the API: the stored proposal is stale, the list shows bars.
    await testhausFootprintSetzen(page.request, FOOTPRINTS.L.footprintM);
    await page.reload();
    await expect(page.getByTestId("wt-vorschlag-veraltet")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("wt-tab-vorschlaege").click();
    await expect(page.getByTestId("vs-veraltet")).toHaveAttribute("data-grund", "grundflaeche");
    await expect(page.locator('[data-testid="vs-karte"][data-riegel="2"]').first()).toBeVisible({ timeout: 90000 });
    expect(await page.locator('[data-testid="vs-karte"]').count()).toBeGreaterThanOrEqual(ERSCHLIESSUNGEN);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
