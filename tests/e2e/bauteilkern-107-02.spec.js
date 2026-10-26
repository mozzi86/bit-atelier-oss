// Headless proof 107-02: heights and elevations have ONE derivation (@core/lib/bauteil/hoehen.js). A drawn wall whose top
// edge follows the storey grows with the storey height (3,0 → 3,2 m) in 3D, in the IFC file and in the section marks,
// an old absolute wall stays 3,0 m; the offset of the lower edge moves 3D and IFC alike; slab thickness / reference side
// and the roof slope (degrees, separate from the ridge rise) reach the IFC; an old roof that only has `pitch` is converted
// on load; the storey table (own height per storey) moves the elevations; an element on a storey the model does not have
// is named in the hint instead of silently landing on the ground floor.
// Review fixes proven here too: a wall WITH a window follows storey and lower-edge offset in 3D (it had a NaN position), the section's
// storey dimension shows the ground-floor height of the table, a storey added after the table was made keeps its edited height,
// a roof of slope 0 degrees is a flat plate in 3D, the hull slab thickness is an input and reaches the IFC, "Geschosse bis Oberkante".
// Own project (like bauteilkern-107-01), the studio saves by itself; the 3D box comes from the test hook
// window.__bitZeigen.bimAenderung.waende3d(), the IFC values from the downloaded text.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Bauteilkern 10702";
const ORDNER = path.join("test-results", "bauteilkern-107-02");

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);
const modellStand = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
const waende3d = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.waende3d());
const daecher3d = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.daecher3d());

/** Rows of the STEP text by id. */
function zeilenMap(ifc) {
  const m = new Map();
  for (const l of ifc.split("\n")) { const r = l.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/); if (r) m.set(`#${r[1]}`, { typ: r[2], args: r[3] }); }
  return m;
}
/** Elements of one IFC class: placement point [x, y, z], extrusion depth, GUID and the row text. */
function elemente(ifc, klasse) {
  const rows = zeilenMap(ifc);
  const out = [];
  for (const r of rows.values()) {
    if (r.typ !== klasse) continue;
    const m = r.args.match(/^'([^']*)',\$,'[^']*',\$,\$,(#\d+),(#\d+),/);
    if (!m) continue;
    const a2p = rows.get(m[2]).args.split(",")[1];
    const loc = rows.get(a2p).args.split(",")[0];
    const punkt = rows.get(loc).args.match(/^\(([-\d.]+),([-\d.]+),([-\d.]+)\)$/).slice(1, 4).map(Number);
    const sr = rows.get(m[3]).args.match(/\(\s*(#\d+)\s*\)/)[1];
    const solid = rows.get(sr).args.match(/'SweptSolid',\((#\d+)\)/)[1];
    const tiefe = Number(rows.get(solid).args.split(",").at(-1));
    out.push({ guid: m[1], punkt, tiefe, args: r.args });
  }
  return out;
}

test.describe("107-02 Vertikale Bindung: Geschosshöhe, Oberkante, Decke, Dach", () => {
  test.setTimeout(420000);

  test("Wand bis Geschoss wächst mit der Geschosshöhe (3D = IFC = Schnittmarke), Versatz, Decke, Dach, Geschosstabelle, unbekanntes Geschoss", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      // an "old" project: wall without any 107-02 field (absolute 3,0 m), a slab and a roof that only has `pitch` (metres), a column on storey 9 (not in the model)
      const RECHT = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      await request.post("/api/entities/BimModel", { data: {
        project_id: id, storeys: 3, storeyHeight: 3,
        // wall 1: old absolute wall; wall 2: wall WITH a window on storey 1, top edge linked to the storey (review: it used to get a NaN position in 3D)
        customWalls: [{ a: { x: -6, z: -2 }, b: { x: -2, z: -2 }, level: 0, thickness: 0.3, height: 3, _idx: 1 },
          { a: { x: -6, z: 3 }, b: { x: -2, z: 3 }, level: 1, thickness: 0.3, oberkante_bezug: "geschoss", _idx: 2 }],
        customWindows: [{ wallIdx: 2, u: 2, kind: "window", typeId: "single", _idx: 6 }],
        customSlabs: [{ points: RECHT(-3, 3, 2, 5), level: 0, _idx: 3 }],
        customRoofs: [{ points: RECHT(-5, 5, -4, 4), level: 1, pitch: 2.5, _idx: 4 }],
        customColumns: [{ x: 8, z: 5, level: 9, size: 0.4, _idx: 5 }],
      } });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      const vorher = new Set((await befehl(page, "modell")).result.bauteile.map((b) => b.guid));

      // ---- old data load unchanged: wall stays absolute, the old roof gets firsthoehe_m (pitch stays) ----
      const m0 = await modellStand(page);
      expect(m0.customWalls[0].oberkante_bezug, "alte Wand bleibt ohne Verknüpfung").toBeUndefined();
      expect(m0.customWalls[0].height).toBe(3);
      expect(m0.customRoofs[0]).toMatchObject({ pitch: 2.5, firsthoehe_m: 2.5 });

      // ---- draw a new wall: its top edge follows the storey (D-BK-04) ----
      await page.getByRole("button", { name: "Wand", exact: true }).click();
      const flaeche = page.locator("[data-bim-plan2d] svg").first();
      await expect(flaeche).toBeVisible();
      await flaeche.click({ position: { x: 380, y: 300 } });
      await flaeche.click({ position: { x: 560, y: 330 } });
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await modellStand(page)).customWalls.length, { timeout: 15000 }).toBe(3);
      const neu = (await modellStand(page)).customWalls.find((w) => w._idx !== 1 && w._idx !== 2);
      expect(neu).toMatchObject({ oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: 0, level: 0 });
      const neuGuid = (await befehl(page, "modell")).result.bauteile.find((b) => !vorher.has(b.guid) && b.klasse === "IfcWall").guid;

      // ---- 3D at 3,0 m: both walls 0 … 3 ----
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await expect.poll(async () => Object.keys(await waende3d(page)).length, { timeout: 20000 }).toBe(3);
      let k = await waende3d(page);
      nah(k[1].min[1], 0, 0.01); nah(k[1].max[1], 3, 0.01);
      nah(k[neu._idx].min[1], 0, 0.01); nah(k[neu._idx].max[1], 3, 0.01);
      // wall WITH a window on storey 1: lower edge 3,0, top edge 6,0 (all numbers finite; before the fix every value was NaN)
      expect(k[2].min.every(Number.isFinite) && k[2].max.every(Number.isFinite), "Wand mit Fenster: Box ist endlich").toBe(true);
      nah(k[2].min[1], 3, 0.01); nah(k[2].max[1], 6, 0.01);

      // ---- storey height 3,0 → 3,2: the linked wall grows, the absolute one stays ----
      await page.getByLabel("Geschosshöhe", { exact: true }).fill("3.2");
      await expect.poll(async () => { const b = (await waende3d(page))[neu._idx]; return b ? Math.round(b.max[1] * 100) : null; }, { timeout: 20000, message: "3D: verknüpfte Wand 3,2 m" }).toBe(320);
      k = await waende3d(page);
      nah(k[neu._idx].min[1], 0, 0.01); nah(k[neu._idx].max[1], 3.2, 0.01);
      nah(k[1].min[1], 0, 0.01); nah(k[1].max[1], 3, 0.01);
      // the window wall on storey 1 moves up with the storey (3,2 ... 6,4) and keeps its window
      await expect.poll(async () => { const b = (await waende3d(page))[2]; return b ? Math.round(b.min[1] * 100) : null; }, { timeout: 20000, message: "3D: Wand mit Fenster auf Geschoss 1 liegt auf 3,2" }).toBe(320);
      nah((await waende3d(page))[2].max[1], 6.4, 0.01);
      // section marks: three storeys of 3,2 m → "OK Dach +9.60", storey dimension = height of the ground floor (3,20 m)
      await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
      await expect(page.locator("svg text", { hasText: "OK Dach +9.60" })).toBeVisible({ timeout: 15000 });
      await expect(page.locator("svg text", { hasText: "3.20 m" }).first(), "Schnitt: Maßlinie Geschosshöhe 3,20").toBeVisible();
      await page.getByRole("button", { name: "Ansicht 3D" }).click();

      const ifcLaden = async (name) => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
        const datei = path.join(ORDNER, name);
        await dl.saveAs(datei);
        return fs.readFileSync(datei, "utf8");
      };
      const hinweis = () => page.locator("body").innerText();

      // ---- IFC: linked wall 3,2 m, old wall 3,0 m, slab 0,22 m with the upper edge on the storey ceiling, column on storey 9 reported ----
      let ifc = await ifcLaden("geschosshoehe-3-2.ifc");
      let waende = elemente(ifc, "IFCWALL");
      const wNeu = waende.find((w) => w.guid === neuGuid);
      expect(wNeu, "neue Wand im IFC").toBeTruthy();
      nah(wNeu.tiefe, 3.2, 0.001); nah(wNeu.punkt[2], 0, 0.001);
      const wAlt = waende.find((w) => Math.abs(w.punkt[0] + 4) < 0.001 && Math.abs(w.punkt[1] + 2) < 0.001);
      expect(wAlt, "alte Wand im IFC (Mitte −4 / −2)").toBeTruthy();
      nah(wAlt.tiefe, 3, 0.001);
      const decke = elemente(ifc, "IFCSLAB").filter((s) => s.tiefe < 0.23 && s.tiefe > 0.21);
      expect(decke.length).toBe(1);
      nah(decke[0].punkt[2], 3.2 - 0.22, 0.001);
      const slabGuid = decke[0].guid; // the drawn slab (the hull slabs are 0,25 m)
      expect(await hinweis(), "unbekanntes Geschoss wird genannt").toContain("Element auf Geschoss 9");

      // ---- lower-edge offset of the linked wall: 3D and IFC move the lower edge, the top edge stays ----
      expect((await befehl(page, "auswahl-guid", { guid: neuGuid })).ok).toBe(true);
      await page.getByLabel("Versatz Unterkante (m)").fill("0.5");
      await expect.poll(async () => { const b = (await waende3d(page))[neu._idx]; return b ? Math.round(b.min[1] * 100) : null; }, { timeout: 20000, message: "3D: Unterkante 0,5" }).toBe(50);
      k = await waende3d(page);
      nah(k[neu._idx].max[1], 3.2, 0.01);
      await expect(page.getByTestId("wand-hoehe-abgeleitet")).toHaveText("2.70");
      ifc = await ifcLaden("versatz-unterkante.ifc");
      const wV = elemente(ifc, "IFCWALL").find((w) => w.guid === neuGuid);
      nah(wV.punkt[2], 0.5, 0.001); nah(wV.tiefe, 2.7, 0.001);
      // the wall with a window: the same offset moves ITS lower edge in 3D (before the fix it had no position at all)
      const fensterWand = (await befehl(page, "modell")).result.bauteile.find((b) => b.klasse === "IfcWall" && b.name === "Tragende Innenwand" && b.geschoss === "1. OG");
      expect(fensterWand?.guid, "Wand mit Fenster hat eine GUID").toBeTruthy();
      expect((await befehl(page, "auswahl-guid", { guid: fensterWand.guid })).ok).toBe(true);
      await page.getByLabel("Versatz Unterkante (m)").fill("0.4");
      await expect.poll(async () => { const b = (await waende3d(page))[2]; return b ? Math.round(b.min[1] * 100) : null; }, { timeout: 20000, message: "3D: Wand mit Fenster, Unterkante 3,2 + 0,4" }).toBe(360);
      nah((await waende3d(page))[2].max[1], 6.4, 0.01);
      // two storeys up: the wall reaches over two storeys (level 1 + 2 = top of the building 9,6)
      await page.getByTestId("wand-oberkante-geschosse").fill("2");
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 2)?.oberkante_geschosse).toBe(2);
      await expect.poll(async () => { const b = (await waende3d(page))[2]; return b ? Math.round(b.max[1] * 100) : null; }, { timeout: 20000, message: "3D: Oberkante 2 Geschosse über Geschoss 1 = 9,6" }).toBe(960);
      expect((await befehl(page, "auswahl-guid", { guid: neuGuid })).ok).toBe(true);
      // "absolut" freezes the current height (no jump) and the wall stops following the storey height
      await page.getByLabel("Oberkante", { exact: true }).selectOption("absolut");
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === neu._idx)?.oberkante_bezug).toBe("absolut");
      expect((await modellStand(page)).customWalls.find((w) => w._idx === neu._idx).height).toBeCloseTo(2.7, 2);
      await page.getByLabel("Oberkante", { exact: true }).selectOption("geschoss");

      // ---- slab: thickness 0,3 m, lower edge on the storey ceiling ----
      expect((await befehl(page, "auswahl-guid", { guid: slabGuid })).ok).toBe(true);
      await expect(page.getByLabel("Dicke (m)")).toHaveValue("0.22");
      await page.getByLabel("Dicke (m)").fill("0.3");
      await page.getByLabel("Bezug der Decke").selectOption("unten");
      await expect.poll(async () => (await modellStand(page)).customSlabs[0]?.dicke_m).toBe(0.3);
      await expect.poll(async () => (await modellStand(page)).customSlabs[0]?.bezug).toBe("unten");
      ifc = await ifcLaden("decke-unten.ifc");
      const dk = elemente(ifc, "IFCSLAB").find((s) => s.guid === slabGuid);
      nah(dk.tiefe, 0.3, 0.001); nah(dk.punkt[2], 3.2, 0.001);

      // ---- roof: the slope (°) classifies it; ridge rise and slope are two fields ----
      const dachGuid = (await befehl(page, "modell", { klasse: "IfcRoof" })).result.bauteile[0]?.guid;
      expect(dachGuid, "Dach hat eine GUID").toBeTruthy();
      expect((await befehl(page, "auswahl-guid", { guid: dachGuid })).ok).toBe(true);
      // old roof: 2,5 m ridge over 4 m half span = 32,0° (not "2,5 °" = flat)
      await expect(page.getByLabel("Neigung (°)")).toHaveValue("32");
      await page.getByLabel("Neigung (°)").fill("20");
      await expect.poll(async () => (await modellStand(page)).customRoofs[0]?.neigung_grad).toBe(20);
      const r20 = (await modellStand(page)).customRoofs[0];
      nah(r20.firsthoehe_m, Math.round(4 * Math.tan(20 * Math.PI / 180) * 100) / 100, 0.001);
      ifc = await ifcLaden("dach-20.ifc");
      let dach = elemente(ifc, "IFCROOF")[0];
      expect(dach.args).toContain(".GABLE_ROOF.");
      expect(ifc).toMatch(/'Neigung',\$,IFCREAL\(20\.0000\)/);
      nah(dach.punkt[2], 6.4, 0.001); // level 1 → eaves = elevation of storey 2 = 2 × 3,2
      await page.getByLabel("Neigung (°)").fill("5");
      await expect.poll(async () => (await modellStand(page)).customRoofs[0]?.neigung_grad).toBe(5);
      ifc = await ifcLaden("dach-5.ifc");
      dach = elemente(ifc, "IFCROOF")[0];
      expect(dach.args, "5° ist ein Flachdach").toContain(".FLAT_ROOF.");
      // 5° is drawn as a gable (rise 0,35 m), 0° as a flat plate (no 2,5 m gable any more): 3D, data sheet and IFC say the same
      const dachBox = async () => (await daecher3d(page))[4];
      await expect.poll(async () => { const b = await dachBox(); return b ? Math.round((b.max[1] - b.min[1]) * 100) : null; }, { timeout: 20000, message: "3D: Dach 5° ist ein Giebel von 0,35 m" }).toBe(35);
      await page.getByLabel("Neigung (°)").fill("0");
      await expect.poll(async () => (await modellStand(page)).customRoofs[0]?.neigung_grad).toBe(0);
      await expect.poll(async () => { const b = await dachBox(); return b ? Math.round((b.max[1] - b.min[1]) * 100) : null; }, { timeout: 20000, message: "3D: Dach 0° ist eine flache Platte von 0,2 m" }).toBe(20);
      ifc = await ifcLaden("dach-0.ifc");
      expect(elemente(ifc, "IFCROOF")[0].args, "0° ist ein Flachdach").toContain(".FLAT_ROOF.");

      // ---- storey table: own height of the ground floor → the linked wall (level 0) follows, the programme field is stored ----
      await page.locator('[data-testid="geschosshoehen"] summary').click();
      await page.getByTestId("geschosshoehe-0").fill("3.6");
      await expect.poll(async () => (await gespeichert()).geschosse?.[0]?.hoehe_m, { timeout: 20000, message: "Geschosstabelle wird gespeichert" }).toBe(3.6);
      expect((await gespeichert()).geschosse.map((g) => g.hoehe_m)).toEqual([3.6, 3.2, 3.2]);
      await expect.poll(async () => { const b = (await waende3d(page))[neu._idx]; return b ? Math.round(b.max[1] * 100) : null; }, { timeout: 20000, message: "3D: Wand bis zur Oberkante EG 3,6" }).toBe(360);
      ifc = await ifcLaden("geschosstabelle.ifc");
      const wT = elemente(ifc, "IFCWALL").find((w) => w.guid === neuGuid);
      nah(wT.punkt[2] + wT.tiefe, 3.6, 0.001);
      // storey elevations in the file: 0, 3.6, 6.8
      const stockwerke = [...zeilenMap(ifc).values()].filter((r) => r.typ === "IFCBUILDINGSTOREY").map((r) => Number(r.args.split(",").at(-1)));
      expect(stockwerke).toEqual([0, 3.6, 6.8]);
      // the single height field says the heights differ
      await expect(page.getByTestId("geschosshoehe-abweichend")).toBeVisible();
      // section: the storey dimension is the height of the ground floor, 3,60 m (not the uniform number 3,20)
      await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
      await expect(page.locator("svg text", { hasText: "3.60 m" }).first(), "Schnitt: Maßlinie Geschosshöhe 3,60 mit Tabelle").toBeVisible({ timeout: 15000 });
      await expect(page.locator("svg text", { hasText: "3.20 m" })).toHaveCount(0);
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      // raise the storey count after the table exists: the new storey 3 is no table row yet, its edited height must be kept (it used to snap back)
      await page.getByLabel("Geschosse", { exact: true }).selectOption("4");
      await page.getByTestId("geschosshoehe-3").fill("3.4");
      await expect.poll(async () => (await gespeichert()).geschosse?.[3]?.hoehe_m, { timeout: 20000, message: "neues Geschoss 3 bekommt eine Zeile mit 3,4" }).toBe(3.4);
      await expect(page.getByTestId("geschosshoehe-3")).toHaveValue("3.4");
      // "alle gleich" removes the table again (asks first, because the heights differ)
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "alle gleich (zurücksetzen)" }).click();
      await expect.poll(async () => (await gespeichert()).geschosse ?? null, { timeout: 20000 }).toBeNull();

      // ---- hull slabs: thickness is an input (review: it was only reachable from a unit test) and reaches the IFC ----
      const huellWand = (await befehl(page, "modell")).result.bauteile.find((b) => b.klasse === "IfcWall" && b.name === "Außenwand" && b.geschoss === "EG");
      expect((await befehl(page, "auswahl-guid", { guid: huellWand.guid })).ok).toBe(true);
      await expect(page.getByTestId("huelle-decke-dicke")).toHaveValue("0.25");
      await page.getByTestId("huelle-decke-dicke").fill("0.3");
      await expect.poll(async () => (await gespeichert()).huelle_decke_dicke_m, { timeout: 20000, message: "Hüllplatten-Dicke wird gespeichert" }).toBe(0.3);
      ifc = await ifcLaden("huellplatte-0-3.ifc");
      const hullDicken = elemente(ifc, "IFCSLAB").map((x) => Math.round(x.tiefe * 1000) / 1000);
      expect(hullDicken.filter((d) => d === 0.3).length, "Hüllplatten (Bodenplatte + Decken) sind 0,3 m dick").toBeGreaterThanOrEqual(4);

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});

function nah(ist, soll, eps = 1e-6) {
  expect(Math.abs(ist - soll), `${ist} ≠ ${soll}`).toBeLessThan(eps);
}
