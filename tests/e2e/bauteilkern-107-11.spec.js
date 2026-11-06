// Headless proof of 107-11 (rooms from walls, D-BK-13): in the BIM studio four walls are drawn as a closed rectangle inside the hull
// (x −3 … 1, z −2 … 2, drawn walls with the default build-up single24 = 0.24 m on their axes), the zone tool proposes the rooms of the storey (the
// drawn room 3.76 × 3.76 = 14.14 m² and the hull room with the drawn room as an island, named), the user takes the drawn room over, it is stored as a
// customZones record, and the inspector shows the net area 14.1376 − 0.40 × 0.40 = 13.978 m² (shown 13.98, IFC 13.9780) (a seeded column stands in the room). The IFC
// download with the option "Raumgrenzen" holds IfcRelSpaceBoundary for the new room (four drawn walls) and its Qto. Own project,
// deleted at the end; console clean.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Bauteilkern 10711";
const ORDNER = path.join("test-results", "bauteilkern-107-11");

/** @param {any} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (/** @type {any} */ m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (/** @type {any} */ e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}
/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}
const befehl = (/** @type {any} */ page, /** @type {string} */ id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);

test("107-11 Räume: vier Wände zeichnen, Räume vorschlagen, übernehmen, Netto-Fläche im Inspektor, IFC-Raumgrenzen", async ({ page, request }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  fs.mkdirSync(ORDNER, { recursive: true });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const R = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3, footprintM: R(-5, -4, 5, 4),
    customColumns: [{ x: -1, z: 0, level: 0, size: 0.4, _idx: 50 }],
  } });
  const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
  try {
    await nurLocalhost(page);
    const warnungen = wache(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
    const stand = () => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());

    // ---- four walls as one chain in the floor plan ----
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const flaeche = page.locator("[data-bim-plan2d] svg").first();
    await expect(flaeche).toBeVisible();
    await flaeche.scrollIntoViewIfNeeded();
    // plan metres → screen through the frame the plan publishes (data-plan-*) and the live screen matrix (pattern of 107-07)
    const bildschirm = (/** @type {number} */ x, /** @type {number} */ z) => flaeche.evaluate((el, a) => {
      const s = /** @type {SVGSVGElement} */ (el);
      const k = Number(s.dataset.planSkala), x0 = Number(s.dataset.planX0), z0 = Number(s.dataset.planZ0);
      const q = new window.DOMPoint((a[0] - x0) * k, (a[1] - z0) * k).matrixTransform(/** @type {DOMMatrix} */ (s.getScreenCTM()));
      return { x: q.x, y: q.y };
    }, [x, z]);
    const klickPlan = async (/** @type {number} */ x, /** @type {number} */ z) => { const q = await bildschirm(x, z); await page.mouse.move(q.x, q.y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(80); };
    await page.getByRole("button", { name: "Wand", exact: true }).click();
    for (const [x, z] of [[-3, -2], [1, -2], [1, 2], [-3, 2], [-3, -2]]) await klickPlan(x, z);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(4);
    const waende = (await stand()).customWalls;
    const enden = waende.flatMap((/** @type {any} */ w) => [w.a, w.b]).map((/** @type {any} */ p) => `${p.x};${p.z}`);
    for (const e of ["-3;-2", "1;-2", "1;2", "-3;2"]) expect(enden.filter((x) => x === e).length, `Ecke ${e} von zwei Wänden`).toBe(2);

    // ---- zone tool: propose rooms ----
    await page.getByRole("button", { name: "Zone", exact: true }).click();
    await page.getByTestId("raeume-vorschlagen").click();
    const panel = page.getByTestId("raum-vorschlaege");
    await expect(panel).toBeVisible();
    // the drawn room (walls 0.24 m: 3.76 × 3.76 = 14.14 m², 16 m² on the axes) and the hull room (hull 0.30 m: 9.70 × 7.70 = 74.69 m²) with the drawn room as an island
    await expect(page.getByTestId("raum-vorschlag")).toHaveCount(2);
    const raum = page.getByTestId("raum-vorschlag").filter({ hasText: "14.14 m² innen" });
    await expect(raum).toHaveCount(1);
    await expect(raum).toContainText("16.00 m² an der Referenzlinie");
    await expect(page.getByTestId("raum-vorschlaege-meldungen")).toContainText("enthält freistehende Wände");
    expect((await stand()).customZones.length, "Vorschlagen speichert nichts").toBe(0);
    await page.screenshot({ path: path.join(ORDNER, "vorschlaege.png") });

    // ---- take the drawn room over: one customZones record, stored ----
    await raum.getByTestId("raum-vorschlag-uebernehmen").click();
    await expect.poll(async () => (await stand()).customZones.length, { timeout: 15000 }).toBe(1);
    await expect(raum).toContainText("übernommen");
    const zone = (await stand()).customZones[0];
    expect(zone.level).toBe(0);
    expect("messregel" in zone, "Standard innenkante wird nicht gespeichert").toBe(false);
    await expect.poll(async () => ((await gespeichert()).customZones || []).length, { timeout: 20000, message: "Raum gespeichert" }).toBe(1);
    // review fix: the remaining proposal is the hull room with the island — "Alle übernehmen" leaves it out, so the button is gone
    await expect(page.getByTestId("raum-vorschlaege-alle")).toHaveCount(0);

    // ---- review fix: DIN 277 table of the storeys (hull 0.30 m, drawn ring 0.24 m, column 0.40 m) ----
    // BGF 10 × 8 = 80; KGF = hull inner halves 80 − 9.70 × 7.70 = 5.31 + ring 4.24² − 3.76² = 3.84 + column 0.16 = 9.31; NGF = NUF = 70.69
    await page.getByTestId("din277-zeigen").click();
    const eg = page.getByTestId("din277-zeile").and(page.locator('[data-level="0"]'));
    await expect(eg).toHaveCount(1);
    await expect(eg).toContainText("80.00");
    await expect(eg).toContainText("9.31");
    await expect(eg).toContainText("70.69");
    await expect(page.getByTestId("din277-summe-gesamt")).toContainText("70.69");
    await page.screenshot({ path: path.join(ORDNER, "din277.png") });

    // ---- inspector of the new room: net area minus the column ----
    const bauteile = (await befehl(page, "modell")).result.bauteile;
    const raumBauteil = bauteile.find((/** @type {any} */ b) => b.klasse === "IfcSpace" && /Raum 1/.test(String(b.name)));
    expect(raumBauteil, `Raum im Modell: ${JSON.stringify(bauteile.map((/** @type {any} */ b) => [b.klasse, b.name]))}`).toBeTruthy();
    expect((await befehl(page, "auswahl-guid", { guid: raumBauteil.guid })).ok).toBe(true);
    await expect(page.getByTestId("raum-netto")).toHaveText("13.98 m²", { timeout: 15000 });
    await expect(page.getByTestId("raum-messregel")).toHaveValue("innenkante");
    await page.screenshot({ path: path.join(ORDNER, "inspektor.png") });

    // ---- IFC with the option "Raumgrenzen": four boundaries (the drawn walls) of the new room and its net area ----
    await page.getByTestId("ifc-raumgrenzen").check();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
    const datei = path.join(ORDNER, "raumgrenzen.ifc");
    await dl.saveAs(datei);
    const zeilen = fs.readFileSync(datei, "utf8").split("\n");
    const raumZeile = zeilen.find((l) => l.includes("=IFCSPACE(") && l.includes("'Raum 1'"));
    expect(raumZeile, "IfcSpace Raum 1").toBeTruthy();
    const raumRef = String(raumZeile).split("=")[0];
    const grenzen = zeilen.filter((l) => l.includes("=IFCRELSPACEBOUNDARY(") && l.includes(`,${raumRef},`));
    expect(grenzen.length, "vier Wände begrenzen den Raum").toBe(4);
    expect(grenzen.every((l) => l.includes(".INTERNAL.")), "gezeichnete Wände sind innen").toBe(true);
    expect(zeilen.some((l) => l.includes("'NetFloorArea',$,$,13.9780,$")), "Netto-Fläche im Qto").toBe(true);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await altWeg(request, NAME);
  }
});
