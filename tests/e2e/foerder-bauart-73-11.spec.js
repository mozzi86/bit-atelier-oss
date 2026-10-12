// Headless-Nachweis 73-11 (BEST-13): Reiter Förderungen im Bestandsprojekt — KfW Klimafreundlicher Neubau
// ist als „passt nicht zur Bauart“ markiert; ein Antrag, gestellt NACH dem Vorhabenbeginn, steht rot;
// ein früheres Antragsdatum macht ihn grün (gespeichert als eingereicht_am). Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Foerderung 7311";

test("73-11 Förderung je Bauart + Antrag vor Vorhabenbeginn", async ({ page, request }) => {
  test.setTimeout(150000);
  let id = null, antragId = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept", vorhabenbeginn: "2026-06-01" } })).json()).id;
    antragId = (await (await request.post(`${API}/FoerderAntrag`, { data: { project_id: id, programm_key: "beg_em", titel: "BEG EM Fenster", foerderfaehige_kosten: 50000, status: "eingereicht", eingereicht_am: "2026-07-01", frist: "" } })).json()).id;

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=funding`);
    await expect(page.getByTestId("fr-karte")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("fp-bauart-kfw_kfn")).toBeVisible();
    await expect(page.getByTestId("fp-bauart-beg_em")).toHaveCount(0);
    const zeile = page.getByTestId(`fr-zeile-${antragId}`);
    await expect(zeile).toHaveAttribute("data-status", "warn");
    await expect(zeile).toContainText("NICHT vor Vorhabenbeginn");
    await page.getByTestId(`fr-datum-${antragId}`).fill("2026-05-15");
    await page.getByTestId(`fr-datum-${antragId}`).blur();
    await expect(page.getByTestId(`fr-zeile-${antragId}`)).toHaveAttribute("data-status", "pass", { timeout: 15000 });
    expect((await (await request.get(`${API}/FoerderAntrag/${antragId}`)).json()).eingereicht_am).toBe("2026-05-15");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (antragId) await request.delete(`${API}/FoerderAntrag/${antragId}`);
    if (id) await request.delete(`${API}/Project/${id}`);
  }
});
