// "An Plan ablegen" (110 follow-up) against the Express dev stack on the neutral test house "Review EFH 108" (fixtures/efh108.js):
//  - the output panel lists the plans of the project; in the floor plan a "Grundriss …" plan is preselected, in section B-B the
//    "Schnitt B-B" plan (title match, storey names long or short);
//  - "An Plan ablegen" files the vector PDF exactly like the plan list's "PDF ablegen": a Document of type "Plan-PDF" in the
//    project, Plan.datei_ref points at it, Plan.modellstand is read back from the PDF; the button then reads "PDF am Plan ersetzen";
//  - console clean.
// Own Plan rows (marker in the title), removed in finally together with the filed documents; the BIM record is reset first.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { EFH_PROJEKT, efhZuruecksetzen } from "./fixtures/efh108.js";

const API = "/api/entities";
const MARKE = "T110-Ablage";

/** Plans of this spec and the documents filed on them. @param {import("@playwright/test").APIRequestContext} request */
async function resteLoeschen(request) {
  const plaene = await (await request.get(`${API}/Plan`)).json();
  for (const p of Array.isArray(plaene) ? plaene : []) {
    if (!String(p.titel || "").includes(MARKE)) continue;
    if (p.datei_ref) await request.delete(`${API}/Document/${p.datei_ref}`);
    await request.delete(`${API}/Plan/${p.id}`);
  }
}

test("BIM-Studio: PDF direkt an einen Plan der Planliste ablegen", async ({ page, request }) => {
  test.setTimeout(300000);
  const { projekt } = await efhZuruecksetzen(request);
  await resteLoeschen(request);
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  try {
    /** @type {Record<string, string>} */
    const ids = {};
    for (const [nr, titel] of [["101", "Grundriss Kellergeschoss"], ["102", "Grundriss Erdgeschoss"], ["103", "Grundriss Dachgeschoss"], ["201", "Schnitt A-A"], ["202", "Schnitt B-B"]]) {
      const r = await request.post(`${API}/Plan`, { data: { project_id: projekt.id, gewerk: "AR", lph: "5", nr, titel: `${titel} ${MARKE}`, massstab: "1:100", format: "A1", status: "in_arbeit" } });
      expect(r.ok(), `Plan ${nr} anlegen`).toBeTruthy();
      ids[nr] = (await r.json()).id;
    }

    await page.setViewportSize({ width: 1400, height: 900 });
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(EFH_PROJEKT)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 90000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 90000 });
    await expect(page.getByLabel("Geschosse", { exact: true })).toHaveValue("2", { timeout: 30000 });

    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click(); // the plan output sits in the folder panel
    const wahl = page.getByTestId("bim-plan-ablage-wahl");
    await expect(wahl.locator("option")).toHaveCount(5, { timeout: 30000 });
    // floor plan: one of the "Grundriss" plans is preselected (the storey shown decides which)
    expect(Object.entries(ids).filter(([nr]) => nr.startsWith("1")).map(([, id]) => id)).toContain(await wahl.inputValue());

    // section B-B: the "Schnitt B-B" plan is preselected
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await page.locator('[data-testid="schnitt-achse"] [data-achse="z"]').click();
    await expect(wahl).toHaveValue(ids["202"]);
    const knopf = page.getByTestId("bim-plan-ablegen");
    await expect(knopf).toHaveText("An Plan ablegen");
    await knopf.click();
    await expect(page.getByText(/an Plan „AR-202 Schnitt B-B/)).toBeVisible({ timeout: 90000 });
    await expect(knopf).toHaveText("PDF am Plan ersetzen");

    // filed like the plan list: Document "Plan-PDF" in the project, the plan points at it, model state read from the PDF
    const plan = await (await request.get(`${API}/Plan/${ids["202"]}`)).json();
    expect(plan.datei_ref, "Plan.datei_ref").toBeTruthy();
    expect(plan).toHaveProperty("modellstand");
    const dok = await (await request.get(`${API}/Document/${plan.datei_ref}`)).json();
    expect(dok.project_id).toBe(projekt.id);
    expect(dok.type).toBe("Plan-PDF");
    expect(String(dok.name)).toMatch(/_Schnitt_B-B_1-\d+\.pdf$/);
    // the other plans stay untouched
    for (const nr of ["101", "102", "103", "201"]) expect((await (await request.get(`${API}/Plan/${ids[nr]}`)).json()).datei_ref ?? null).toBeNull();
    await page.screenshot({ path: ".planning/phases/110-bauherrenzugang/tmp-e2e/110-plan-ablage.png" });

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  } finally {
    await resteLoeschen(request);
  }
});
