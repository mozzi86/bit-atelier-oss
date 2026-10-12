// Headless-Nachweis 73-09: Reiter „Bauaufnahme“ im Bestandsprojekt — Lieferung anlegen und ausfüllen,
// UTM-Warnung bei großen Ostwerten, Speichern im eigenen Fachlayer `bauaufnahme_layer`; die Kachel
// „Raumprogramm aus Bestand“ zeigt die Räume des gespeicherten Modellstands, übernimmt aber nichts.
// Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { bimSnapshots } from "../../packages/nova-core/server/seed-data.js";

const API = "/api/entities";
const NAME = "E2E Bauaufnahme 7309";

test("73-09 Reiter Bauaufnahme", async ({ page, request }) => {
  test.setTimeout(150000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept", scan_3d_url: "//server/scan/aufmass.e57" } })).json()).id;
    const { id: _s, project_id: _p, ...snap } = bimSnapshots[0];
    await request.post(`${API}/BimSnapshot`, { data: { ...snap, project_id: id } });

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bauaufnahme`);
    await expect(page.getByTestId("ba-panel")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("panel-stand")).toHaveAttribute("data-stand", "gemessen");
    await expect(page.getByTestId("ba-kachel-raeume")).toHaveAttribute("data-raeume", "6", { timeout: 20000 });
    await expect(page.getByText("aufmass.e57")).toBeVisible();
    await page.getByTestId("ba-neu").click();
    const lf = page.getByTestId("ba-lieferung-lf-1");
    await lf.locator("select").first().selectOption("tls");
    await lf.locator("select").nth(1).selectOption("LOA30");
    await page.getByTestId("ba-georef-nullpunkt_e").fill("652300");
    await expect(page.getByTestId("ba-check-utm")).toBeVisible();
    await page.getByTestId("ba-georef-okff_eg_nhn").fill("310.25");
    await expect.poll(async () => {
      const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
      return m?.bauaufnahme_layer?.georeferenz?.okff_eg_nhn ?? null;
    }, { timeout: 15000 }).toBe(310.25);
    const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
    expect(m.bauaufnahme_layer.lieferungen[0]).toMatchObject({ id: "lf-1", verfahren: "tls", genauigkeit: "LOA30" });
    expect(m.bauaufnahme_layer.v).toBe(1);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const s of await (await request.get(`${API}/BimSnapshot?project_id=${id}`)).json()) await request.delete(`${API}/BimSnapshot/${s.id}`);
      for (const b of await (await request.get(`${API}/BimModel?project_id=${id}`)).json()) await request.delete(`${API}/BimModel/${b.id}`);
      await request.delete(`${API}/Project/${id}`);
    }
  }
});
