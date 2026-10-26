// Headless proof 100-02: the element data sheet in the TGA network editor, the structure plan and the
// opening list — select a run / a beam / open a row, set KG or section, the value lands on the stored
// element (netz_layer / statik_layer of the BimModel, Durchbruch record). The test house's network and
// structure layers are saved before and restored in finally; the opening is removed again.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const PROJEKT = "Review Testhaus";
const MARKE = "E2E10002";

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

test.describe("100-02 Steckbrief in TGA, Tragwerk und Durchbruch", () => {
  test.setTimeout(240000);

  test("TGA-Leitung und Träger: Steckbrief sichtbar, KG/Bauabschnitt landen im Fachlayer", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1800 });
    await nurLocalhost(page);
    const warnungen = wache(page);
    const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT)}`)).json())[0];
    const modell = (await (await request.get(`${API}/BimModel?project_id=${projekt.id}`)).json())[0];
    const vorher = { netz_layer: modell.netz_layer ?? null, statik_layer: modell.statik_layer ?? null };
    const lesen = async () => (await (await request.get(`${API}/BimModel/${modell.id}`)).json());
    try {
      await request.put(`${API}/BimModel/${modell.id}`, { data: {
        netz_layer: { version: 1, knoten: [], kanten: [{ id: "e1", gewerk: "heizung", level: 0, dn: 20, von: null, nach: null, points: [{ x: -20, z: 0 }, { x: -10, z: 0 }] }] },
        statik_layer: { traeger: [{ id: "tr_1", level: 0, a: { x: 5, z: -2 }, b: { x: 15, z: -2 } }], ergebnis: null },
      } });

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(PROJEKT)}&tab=haustechnik`);
      await page.getByTestId("ht-tab-netz").click({ timeout: 60000 });
      await page.locator('[data-testid="tn-kante"][data-id="e1"] polyline').first().click({ force: true });
      const sbNetz = page.getByTestId("tn-auswahl").getByTestId("steckbrief-kasten");
      await expect(sbNetz).toBeVisible({ timeout: 15000 });
      await expect(sbNetz.getByTestId("sb-ifc")).toContainText("IfcPipeSegment");
      // 429 on purpose: 422 is the derived KG of a heating run — filling the same value fires no change
      await sbNetz.getByTestId("sb-kg").fill("429");
      await expect.poll(async () => (await lesen()).netz_layer?.kanten?.[0]?.kg, { timeout: 15000 }).toBe("429");
      await expect(sbNetz.locator('[data-annahme="kg"]')).toHaveCount(0);

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(PROJEKT)}&tab=statics`);
      await page.locator('[data-testid="tw-traeger"][data-id="tr_1"] line').first().click({ force: true, timeout: 60000 });
      const sbTr = page.getByTestId("tw-steckbrief");
      await expect(sbTr).toBeVisible({ timeout: 15000 });
      await expect(sbTr.getByTestId("sb-ifc")).toContainText("IfcBeam");
      await sbTr.getByTestId("sb-abschnitt").fill("BA Nord");
      await expect.poll(async () => (await lesen()).statik_layer?.traeger?.[0]?.bauabschnitt, { timeout: 15000 }).toBe("BA Nord");
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await request.put(`${API}/BimModel/${modell.id}`, { data: vorher });
    }
  });

  test("Durchbruch: Steckbrief aufklappen, KG am Datensatz, Brandschott als eigenes Bauteil", async ({ page, request }) => {
    await nurLocalhost(page);
    const warnungen = wache(page);
    const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent(PROJEKT)}`)).json())[0];
    const aufraeumen = async () => {
      const alt = await (await request.get(`${API}/Durchbruch?project_id=${projekt.id}`)).json();
      for (const x of (Array.isArray(alt) ? alt : []).filter((d) => d.kommentar === MARKE)) await request.delete(`${API}/Durchbruch/${x.id}`);
    };
    await aufraeumen();
    try {
      const d = await (await request.post(`${API}/Durchbruch`, { data: { project_id: projekt.id, nr: "DB-9002", art: "durchbruch", form: "rechteck", b: 0.2, h: 0.3, status: "beantragt", kommentar: MARKE,
        feuerwiderstand: "EI 90", brandschott: { klasse: "EI 90", system: "Mörtelschott", zulassung_art: "abZ", zulassung_nr: "Z-19.15-0000", hersteller: "Muster" } } })).json();
      await page.goto(`/Werkplanung?projekt=${encodeURIComponent(PROJEKT)}&tab=durchbrueche`);
      const zeile = page.locator('[data-testid=db-zeile][data-nr="DB-9002"]');
      await zeile.getByTestId("db-steckbrief-knopf").click({ timeout: 30000 });
      const sb = page.getByTestId("db-steckbrief-durchbruch");
      await expect(sb).toBeVisible();
      await expect(sb.getByTestId("sb-ifc")).toContainText("PROVISIONFORVOID");
      await sb.getByTestId("sb-kg").fill("394");
      await expect.poll(async () => (await (await request.get(`${API}/Durchbruch/${d.id}`)).json()).kg, { timeout: 15000 }).toBe("394");
      await expect(page.getByTestId("db-steckbrief-schott")).toContainText("Mörtelschott, Muster");
      await zeile.getByTestId("db-steckbrief-knopf").click();
      await expect(page.getByTestId("db-steckbrief")).toHaveCount(0);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen();
    }
  });
});
