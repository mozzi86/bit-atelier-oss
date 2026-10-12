// Headless-Nachweis 88-09 (Projektkennzahlen Machbarkeit): oben auf der Seite „Machbarkeit“ werden am
// Review Testhaus feste Werte eingegeben — Grundstück 1 000 m², GRZ 0,4, GFZ 1,0, Grundfläche 400 m²,
// § 19 Abs. 4-Flächen 250 m², zwei Geschosse (Keller DOK 1,0 m = kein Vollgeschoss, EG DOK 3,0 m =
// Vollgeschoss) — und der Residualwert (Verkauf 1 000 m² × 5 000 €/m², BGF 1 300 m² × 2 500 €/m²).
// Erwartet: GRZ 0,4, GRZ II 0,65 > 0,6 → Warnung, GFZ 0,4, Bodenwert 143 518,52 €; Speichern legt den
// Datensatz Machbarkeit an, ein Neuladen zeigt die Werte wieder. Aufräumen im finally und beim Start.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";

test("88-09 Projektkennzahlen: Soll/Ist, Vollgeschoss, Residualwert, Speichern", async ({ page, request }) => {
  test.setTimeout(150000);
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const aufraeumen = async () => {
    const alt = await (await request.get(`${API}/Machbarkeit?project_id=${projekt.id}`)).json();
    for (const x of Array.isArray(alt) ? alt : []) await request.delete(`${API}/Machbarkeit/${x.id}`);
  };
  await aufraeumen();
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    await page.goto(`/RealEstateFeasibility?projekt=${encodeURIComponent("Review Testhaus")}`);
    await expect(page.getByTestId("mk-karte")).toBeVisible({ timeout: 30000 });

    for (const [k, v] of [["grundstueck_m2", "1000"], ["grz_max", "0.4"], ["gfz_max", "1"], ["grundflaeche_m2", "400"], ["nebenanlagen_m2", "250"]]) {
      await page.getByTestId(`mk-${k}`).fill(v);
    }
    for (const [i, dok] of [[0, "1"], [1, "3"]]) {
      await page.getByTestId("mk-geschoss-neu").click();
      await page.getByTestId(`mk-g-${i}-name`).fill(i === 0 ? "KG" : "EG");
      await page.getByTestId(`mk-g-${i}-flaeche_m2`).fill("400");
      await page.getByTestId(`mk-g-${i}-flaeche_h230_m2`).fill("400");
      await page.getByTestId(`mk-g-${i}-doK_ueber_gelaende_m`).fill(dok);
      await page.getByTestId(`mk-g-${i}-hoehe_m`).fill("3");
    }
    await expect(page.getByTestId("mk-g-voll-0")).toHaveAttribute("data-voll", "false");
    await expect(page.getByTestId("mk-g-voll-1")).toHaveAttribute("data-voll", "true");
    const ist = page.getByTestId("mk-ist");
    await expect(ist).toHaveAttribute("data-grz", "0.4");
    await expect(ist).toHaveAttribute("data-grz2", "0.65");
    await expect(ist).toHaveAttribute("data-gfz", "0.4");
    await expect(page.locator('[data-testid=mk-hinweis][data-code="grz2"]')).toBeVisible();
    await expect(page.locator('[data-testid=mk-hinweis][data-code="grz"]')).toHaveCount(0);

    for (const [k, v] of [["r-flaeche_m2", "1000"], ["r-preis_eur_m2", "5000"], ["r-bgf_m2", "1300"], ["r-baukosten_eur_m2_bgf", "2500"]]) {
      await page.getByTestId(`mk-${k}`).fill(v);
    }
    await expect(page.getByTestId("mk-bodenwert")).toHaveAttribute("data-wert", "143518.52");

    await page.getByTestId("mk-speichern").click();
    await expect(page.getByTestId("mk-gespeichert")).toBeVisible({ timeout: 15000 });
    const rec = (await (await request.get(`${API}/Machbarkeit?project_id=${projekt.id}`)).json())[0];
    expect(rec.geschosse.length).toBe(2);
    expect(String(rec.grz_max)).toBe("0.4");

    await page.reload();
    await expect(page.getByTestId("mk-ist")).toHaveAttribute("data-grz2", "0.65", { timeout: 30000 });
    await expect(page.getByTestId("mk-bodenwert")).toHaveAttribute("data-wert", "143518.52");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await aufraeumen();
  }
});
