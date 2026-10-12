// Headless-Nachweis 73-05 (BEST-05): „Grundriss → Gebäudemodell“ im IFC-Viewer (Musterprojekt) schreibt
// den Umriss MIT Herkunft (footprintQuelle.art = gemessen, Quelle, Geschoss) in den BimModel-Datensatz,
// und der Designer zeigt im Reiter Gebäudemodell „Umriss: gemessen (…)“. Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Umriss Herkunft 7305";

test("73-05 IFC-Umriss trägt seine Herkunft bis in den Designer", async ({ page, request }) => {
  test.setTimeout(240000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/style diff|Style is not done loading|WebGL|GPU stall|wasm/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;

    await page.goto(`/IfcViewer?projekt=${encodeURIComponent(NAME)}&beispiel=1`);
    const knopf = page.getByRole("button", { name: /Grundriss → Gebäudemodell/ });
    await expect(knopf).toBeEnabled({ timeout: 120000 });
    await knopf.click();
    await expect.poll(async () => {
      const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
      return m?.footprintQuelle?.art || null;
    }, { timeout: 60000 }).toBe("gemessen");
    const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
    expect(m.footprintM.length).toBeGreaterThanOrEqual(3);
    expect(m.footprintQuelle.quelle).toBeTruthy();

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await expect(page.getByTestId("panel-herkunft")).toContainText("Umriss: gemessen", { timeout: 30000 });
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const m of await (await request.get(`${API}/BimModel?project_id=${id}`)).json()) await request.delete(`${API}/BimModel/${m.id}`);
      await request.delete(`${API}/Project/${id}`);
    }
  }
});
