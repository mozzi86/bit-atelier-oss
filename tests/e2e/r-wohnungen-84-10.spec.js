// Headless-Nachweis 84-10 (D-P84-R): R-Wohnungen über den Wohnungsmix UND per Schalter je Wohnung.
//
// Ablauf: Werkstatt des Review-Testhauses öffnen → im Typ-Editor den 3-Zimmer-Eintrag auf „R“
// stellen (Kennzeichen in der Liste, Zähler „R-Wohnungen im Gebäude“ > 0) → Fokus einer solchen
// Wohnung: Umschalter steht auf R → „Standard“ klicken (Schalter schlägt den Mix: Hinweis
// `fk-stufe-vorgabe`, Zähler −1) → Reload: der Schalter ist gespeichert (Zähler gleich) →
// wieder „R“ klicken (= Mix → Eintrag entfällt, Hinweis weg, Zähler wieder voll) → Aufräumen:
// Mix zurück auf Standard, Zähler 0. Konsole bleibt sauber.
//
// Regeln (Lehren 75-05/07/09/11): Umschalter per dispatchEvent · SVG nur über count()/Attribute ·
// three.js-WebGL-pageerror ignorieren · Werkstatt-Zustand am Ende zurücksetzen.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE } from "./fixtures/massing.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";

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

async function werkstattBereit(page) {
  await page.goto(SEITE_WERKSTATT);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  if (!(await page.getByTestId("wt-we").count())) {
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    await expect(anwenden).toBeVisible({ timeout: 15000 });
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) { await anwenden.click(); await page.waitForTimeout(1200); }
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1600);
  expect(await page.getByTestId("wt-we").count(), "WE-Zonen vorhanden").toBeGreaterThan(0);
}

const rZahl = async (page) => Number(await page.getByTestId("r-zaehler").getAttribute("data-r"));

/** Select the mix entry whose name contains `muster` and set its level in the type editor. */
async function setzeMixStufe(page, muster, wert) {
  // List entries are einheit-0, einheit-1 … (not einheit-stufe-wahl, einheit-flaechen, the badges).
  const eintrag = page.getByTestId(/^einheit-\d+$/).filter({ hasText: muster }).first();
  await eintrag.click();
  await page.getByTestId("einheit-stufe-wahl").selectOption(wert);
  await page.waitForTimeout(1200);
}

test.describe("84-10 R-Wohnungen: Mix + Schalter je Wohnung", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 240000 });

  test("Mix-Eintrag R → Zähler + Kennzeichen; Schalter im Fokus schlägt den Mix; bleibt nach Reload; Aufräumen", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);
    try {
      // Start state: no R in the review house. B → Standard is a real change, so leftover
      // "standard" switches of an aborted run are dropped too (they equal the mix level then).
      await setzeMixStufe(page, /3-Zimmer/, "B");
      await setzeMixStufe(page, /3-Zimmer/, "standard");
      expect(await rZahl(page), "Ausgangslage: keine R-Wohnung").toBe(0);

      // 1) Mix: the 3-room type is R → badge in the list, counter > 0, units carry the level.
      await setzeMixStufe(page, /3-Zimmer/, "R");
      await expect(page.getByTestId(/^einheit-stufe-\d+$/).first()).toHaveText("R");
      const nR = await rZahl(page);
      expect(nR, "R-Wohnungen über den Mix").toBeGreaterThan(0);
      await expect(page.getByTestId("wt-qualitaet")).toBeVisible();

      // 2) Focus of an R unit: the level switch stands on R (effective level).
      const typKey = await page.locator('[data-testid="wt-we"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-typ")).find((t) => /st-3zi/.test(t || "")));
      expect(typKey, "eine 3-Zimmer-WE im Geschossplan").toBeTruthy();
      const we = await page.locator(`[data-testid="wt-we"][data-typ="${typKey}"]`).first().getAttribute("data-we");
      const oeffneFokus = async () => {
        await page.locator(`[data-testid="wt-qualitaet-we"][data-we="${we}"]`).getByTestId("wt-qualitaet-fokus").dispatchEvent("click");
        await expect(page.getByText(`Fokusansicht: ${we}`).first()).toBeVisible({ timeout: 20000 });
      };
      await oeffneFokus();
      await expect(page.locator('[data-testid="fk-stufe"] [data-wert="R"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("fk-stufe-vorgabe")).toHaveCount(0);

      // 3) Switch beats the mix: "Standard" for this one unit → hint + counter −1.
      await page.locator('[data-testid="fk-stufe"] [data-wert="standard"]').dispatchEvent("click");
      await page.waitForTimeout(1200);
      await expect(page.locator('[data-testid="fk-stufe"] [data-wert="standard"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("fk-stufe-vorgabe")).toBeVisible();
      await expect(page.getByTestId("fk-stufe-vorgabe")).toContainText("R");
      expect(await rZahl(page), "eine R-Wohnung weniger").toBe(nR - 1);

      // 4) The switch is saved: after a reload the unit is still "Standard", the counter the same.
      await page.waitForTimeout(2000);
      await werkstattBereit(page);
      expect(await rZahl(page), "Schalter nach Reload erhalten").toBe(nR - 1);
      await oeffneFokus();
      await expect(page.locator('[data-testid="fk-stufe"] [data-wert="standard"]')).toHaveAttribute("aria-pressed", "true");

      // 5) Back to the mix level (R): the entry disappears again, hint gone, counter full.
      await page.locator('[data-testid="fk-stufe"] [data-wert="R"]').dispatchEvent("click");
      await page.waitForTimeout(1200);
      await expect(page.getByTestId("fk-stufe-vorgabe")).toHaveCount(0);
      expect(await rZahl(page), "wieder alle R").toBe(nR);
    } finally {
      // Leave the review house as the other specs expect it: mix back to Standard.
      await page.reload();
      await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1200);
      if ((await rZahl(page).catch(() => 0)) !== 0) await setzeMixStufe(page, /3-Zimmer/, "standard");
    }
    expect(await rZahl(page), "aufgeräumt: keine R-Wohnung").toBe(0);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
