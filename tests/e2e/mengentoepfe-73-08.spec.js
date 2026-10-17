// Headless-Nachweis 73-08 (BEST-10/11): AVA › BIM-Mengen zeigt im Bestandsprojekt die vier Mengentöpfe aus
// der gespeicherten Bauaufnahme (Rückbau 336 m², Unbekannt 22 m², Klartext-Verteilung); eine Filterposition
// „Abbruch“ mit 89 % angenommener Menge wird zur Bedarfsposition angeboten und nach Klick als solche
// gespeichert. Im Neubau-Testhaus erscheint die Karte nicht. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { bimSnapshots } from "../../packages/nova-core/server/seed-data.js";

const API = "/api/entities";
const NAME = "E2E Mengentoepfe 7308";

test("73-08 Mengentöpfe + Bedarfsposition", async ({ page, request }) => {
  test.setTimeout(150000);
  const ids = { project: null, snap: null, filter: null, pos: null, filter2: null, pos2: null };
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    ids.project = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;
    const { id: _seedId, project_id: _p, ...snap } = bimSnapshots[0];
    ids.snap = (await (await request.post(`${API}/BimSnapshot`, { data: { ...snap, project_id: ids.project } })).json()).id;
    ids.filter = (await (await request.post(`${API}/AvaFilter`, { data: { project_id: ids.project, name: "Abbruch Wände", was: { ifc_klasse: ["IfcWall"] }, zustand: { status: ["abbruch"] } } })).json()).id;
    ids.pos = (await (await request.post(`${API}/LVPosition`, { data: { project_id: ids.project, oz: "01.0010", short_text: "Wände abbrechen", unit: "m²", quantity: 0, mengen_modus: "filter", filter_ref: ids.filter, mengenbasis: "area" } })).json()).id;
    // 97-06 rule 2: a position over all walls without status filter mixes demolition with the rest.
    ids.filter2 = (await (await request.post(`${API}/AvaFilter`, { data: { project_id: ids.project, name: "Alle Wände", was: { ifc_klasse: ["IfcWall"] } } })).json()).id;
    ids.pos2 = (await (await request.post(`${API}/LVPosition`, { data: { project_id: ids.project, oz: "01.0020", short_text: "Wände gesamt", unit: "m²", quantity: 0, mengen_modus: "filter", filter_ref: ids.filter2, mengenbasis: "area" } })).json()).id;

    await page.goto(`/AVA?projekt=Review%20Testhaus&tab=takeoff`);
    await expect(page.getByText("IFC-Import (web-ifc)")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("bm-karte")).toHaveCount(0);

    await page.goto(`/AVA?projekt=${encodeURIComponent(NAME)}&tab=takeoff`);
    const karte = page.getByTestId("bm-karte");
    await expect(karte).toHaveAttribute("data-quelle", "aufnahme", { timeout: 30000 });
    await expect(page.getByTestId("bm-topf-rueckbau")).toHaveAttribute("data-menge", "336");
    await expect(page.getByTestId("bm-topf-unbekannt")).toHaveAttribute("data-menge", "22");
    await expect(page.getByTestId("bm-topf-rueckbau")).toContainText("36 m² gemessen, 300 m² angenommen");
    // 97-07: demolition is KG 394 (LB 084, DIN 18459) by default, chosen per project and stored.
    await expect(page.getByTestId("bm-topf-rueckbau")).toContainText("KG 394 · LB 084 · DIN 18459");
    await page.getByTestId("bm-abbruch-kg").selectOption("212");
    await expect(page.getByTestId("bm-topf-rueckbau")).toContainText("KG 212");
    await expect.poll(async () => (await (await request.get(`${API}/Project/${ids.project}`)).json()).abbruch_kg).toBe("212");
    await expect(page.getByTestId("bm-gemischt-01.0020")).toContainText("Abbruch 336");
    await expect(page.getByTestId("bm-gemischt-01.0010")).toHaveCount(0);
    const vorschlag = page.getByTestId("bm-vorschlag-01.0010");
    await expect(vorschlag).toContainText("89 %");
    await vorschlag.getByRole("button", { name: "Als Bedarfsposition kennzeichnen" }).click();
    await expect.poll(async () => (await (await request.get(`${API}/LVPosition/${ids.pos}`)).json()).kennz).toBe("Bedarfsposition");
    await expect(vorschlag).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (ids.pos) await request.delete(`${API}/LVPosition/${ids.pos}`);
    if (ids.pos2) await request.delete(`${API}/LVPosition/${ids.pos2}`);
    if (ids.filter2) await request.delete(`${API}/AvaFilter/${ids.filter2}`);
    if (ids.filter) await request.delete(`${API}/AvaFilter/${ids.filter}`);
    if (ids.snap) await request.delete(`${API}/BimSnapshot/${ids.snap}`);
    if (ids.project) await request.delete(`${API}/Project/${ids.project}`);
  }
});
