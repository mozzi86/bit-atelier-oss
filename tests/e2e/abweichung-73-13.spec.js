// Headless-Nachweis 73-13 (BEST-15): im Bestandsprojekt bekommt eine Hinweis-/Fehlerzeile der
// Entwässerungs-Prüfungen „Abweichung vermerken“; mit Begründung gespeichert wird sie zum vierten Zustand
// „Abweichung“ und der Vermerk liegt in entwaesserung_layer.abweichungen. Im Neubau-Testhaus gibt es den
// Knopf nicht. Aufräumen im finally, Konsole sauber.
// Zweiter Test (73-13 Rest): dieselbe Zeile in den Zusammenfassungen von Brandschutz, Barrierefreiheit und
// Schallschutz — Vermerke in brandschutz_vermerke_layer, barrierefreiheit_layer bzw.
// schallschutz_vermerke_layer (je ein Schreiber, KD-17). Barrierefreiheit: Flurbreite 0,90 m erzeugt eine
// Hinweiszeile, Brandschutz: Fluchtweg 60 m (> zulässig; seit 72-04 ist das leere Formular „offen“), Schallschutz: Ist R'w Wohnungstrennwand 40 dB (leeres Projekt ist sonst „plausibel“).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Abweichung 7313";

test("73-13 Abweichung / Bestandsschutz an einer Prüfzeile", async ({ page, request }) => {
  test.setTimeout(150000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ComplexDesigner?projekt=Review%20Testhaus&tab=haustechnik`);
    await page.getByTestId("ht-tab-entwaesserung").click();
    await expect(page.getByTestId("ew-checks")).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid^="pz-vermerken-"]')).toHaveCount(0);

    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;
    // A deterministic warning: an active basement without backwater protection puts the drain below the
    // backwater level (rueckstauCheck → warn). Which other rows warn depends on the building program
    // loading (e.g. rainwater yield flips warn → OK), which made the button vanish mid-click before.
    await request.post(`${API}/BimModel`, { data: { project_id: id, werkstatt_layer: { keller: { aktiv: true } } } });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=haustechnik`);
    await page.getByTestId("ht-tab-entwaesserung").click();
    const key = "rueckstau";
    const knopf = page.getByTestId(`pz-vermerken-${key}`);
    await expect(knopf).toBeVisible({ timeout: 30000 });
    await knopf.click();
    const form = page.getByTestId(`pz-form-${key}`);
    await form.locator("select").first().selectOption("bestandsschutz");
    await form.getByPlaceholder("Begründung (Pflicht)").fill("Bestandsleitung 1965, keine Nutzungsänderung");
    await form.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByTestId(`pz-${key}`)).toHaveAttribute("data-status", "abweichung");
    await expect(page.getByTestId(`pz-${key}`)).toContainText("Bestandsleitung 1965");
    await expect.poll(async () => {
      const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
      return m?.entwaesserung_layer?.abweichungen?.[key]?.art ?? null;
    }, { timeout: 15000 }).toBe("bestandsschutz");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const b of await (await request.get(`${API}/BimModel?project_id=${id}`)).json()) await request.delete(`${API}/BimModel/${b.id}`);
      await request.delete(`${API}/Project/${id}`);
    }
  }
});

test("73-13 Rest: Vermerk in Brandschutz, Barrierefreiheit und Schallschutz-Zusammenfassung", async ({ page, request }) => {
  test.setTimeout(240000);
  let id = null;
  const FAELLE = [
    { tab: "brandschutz", pfad: (m, k) => m?.brandschutz_vermerke_layer?.abweichungen?.[k]?.art },
    { tab: "barrierefreiheit", pfad: (m, k) => m?.barrierefreiheit_layer?.abweichungen?.[k]?.art },
    { tab: "acoustics", pfad: (m, k) => m?.schallschutz_vermerke_layer?.abweichungen?.[k]?.art },
  ];
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post(`${API}/Project`, { data: { name: `${NAME} Rest`, build_kind: "sanierung", status: "concept" } })).json()).id;
    for (const f of FAELLE) {
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(`${NAME} Rest`)}&tab=${f.tab}`);
      if (f.tab === "brandschutz") {
        const flucht = page.getByLabel("Längste geschätzte Fluchtweglänge");
        await expect(flucht).toBeVisible({ timeout: 30000 });
        await flucht.fill("60");
      }
      if (f.tab === "barrierefreiheit") {
        const flur = page.getByLabel("Flurbreite (Wohnung)");
        await expect(flur).toBeVisible({ timeout: 30000 });
        await flur.fill("0.9");
      }
      if (f.tab === "acoustics") {
        const wand = page.getByLabel("Ist R'w Wohnungstrennwand");
        await expect(wand).toBeVisible({ timeout: 30000 });
        await wand.fill("40");
      }
      // Scoped to the summary card — the Schallschutz plan card above uses PruefZeile with the same keys.
      const karte = page.getByText("Zusammenfassung & Plausibilität (Richtwert)").locator("xpath=ancestor::div[contains(@class,'rounded')][1]/..");
      const knopf = karte.locator('[data-testid^="pz-vermerken-"]').first();
      await expect(knopf, f.tab).toBeVisible({ timeout: 30000 });
      const key = (await knopf.getAttribute("data-testid")).replace("pz-vermerken-", "");
      await knopf.click();
      const form = karte.getByTestId(`pz-form-${key}`);
      await form.locator("select").first().selectOption("abweichung");
      await form.getByPlaceholder("Begründung (Pflicht)").fill(`Bestand ${f.tab}, Kompensation im Konzept`);
      await form.getByRole("button", { name: "Speichern" }).click();
      await expect(karte.getByTestId(`pz-${key}`)).toHaveAttribute("data-status", "abweichung");
      await expect.poll(async () => {
        const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
        return f.pfad(m, key) ?? null;
      }, { timeout: 15000, message: f.tab }).toBe("abweichung");
    }
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const b of await (await request.get(`${API}/BimModel?project_id=${id}`)).json()) await request.delete(`${API}/BimModel/${b.id}`);
      await request.delete(`${API}/Project/${id}`);
    }
  }
});
