// Headless proof of 107-10 in a real browser (dev server), own projects, cleaned up in finally.
// (A) BIM studio: footprint 10 × 3 m, two storeys of 3 m, a drawn roof over the footprint (form "sattel", ridge rise 1.0 m) whose eaves
//     lie on the floor of the upper storey (3 m). The gable hull wall of the upper storey (3 m long — below 3.5 m the window rule sets no
//     rule window, autoOpenings.js, so nothing but the roof shapes its top; 3 … 6 m) is chosen in the inspector "Wand abschrägen gegen
//     Dach": the relation is stored (solidrelationen_layer), the CSG library is loaded only now, the 3D wall ends at the apex
//     3 + 1 = 4.0 m (before 6.0 m), the volume comes from the solid (triangle ½ · 3 · 1 = 1.5 m² × thickness) and the section along
//     z = 0 shows the same edge (4.0 m). Setting the roof slope to 30° moves the apex to 3 + 1.5 · tan 30° = 3.866 m — the wall
//     follows. "Entfernen" sets aktiv: false and the wall is 6.0 m again. Console clean.
// (B) Massing studio: the same programme with one basement (107-13) and a flat sandbox terrain: the 3D view carries the basement, the
//     terrain after the excavation replaces the terrain mesh, and the excavation volume is 80 m² · 3 m = 240 m³ from the solid; a body
//     with a gable roof draws its roof. Console clean.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME_A = "E2E Bauteilkern 10710 A";
const NAME_B = "E2E Bauteilkern 10710 B";
const ORDNER = path.join("test-results", "bauteilkern-107-10");
const BIBLIOTHEK = /manifold-3d/; // 107-18: the CSG library (JS part; its WebAssembly binary follows)
const MODUL_ANFRAGE = /manifold-3d|manifold[^/]*\.wasm|\/lib\/csg\/|bauteil\/seo\.js|gelaendeSolid/;

/** @param {any} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (/** @type {any} */ m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (/** @type {any} */ e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}
const befehl = (/** @type {any} */ page, /** @type {string} */ id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);
const huellwaende3d = (/** @type {any} */ page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.huellwaende3d());
/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}
const RECHT = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** number shown with three decimals in the German format ("1,800 m³" or "1.800 m³") */
const zahlAus = (/** @type {string|null} */ t) => Number(String(t || "").split(" m³")[0].replace(/\s/g, "").replace(",", "."));

test.describe("107-10 Bauteil-Operationen, Dach-Lib, Untergeschoss", () => {
  test("BIM-Studio: Giebelwand gegen Satteldach abschrägen, Neigung ändern, Wand folgt; Schnitt zeigt dieselbe Kante", async ({ page, request }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    await altWeg(request, NAME_A);
    const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_A, build_kind: "neubau", status: "concept" } })).json()).id;
    await request.post("/api/entities/BimModel", { data: {
      project_id: id, storeys: 2, storeyHeight: 3, footprintM: RECHT(-5, -1.5, 5, 1.5),
      customRoofs: [{ _idx: 1, level: 0, points: RECHT(-5, -1.5, 5, 1.5), firsthoehe_m: 1, pitch: 1, form: "sattel" }],
    } });
    const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
    /** @type {string[]} */
    const anfragen = [];
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      page.on("request", (/** @type {any} */ r) => anfragen.push(r.url()));
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_A)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      // the gable hull walls of the upper storey: edges 1 (x = +5) and 3 (x = −5), 3 … 6 m
      await expect.poll(async () => (await huellwaende3d(page))["1:1"]?.max?.[1] ?? null, { timeout: 30000 }).not.toBeNull();
      const vorher = await huellwaende3d(page);
      expect(Math.abs(vorher["1:1"].max[1] - 6)).toBeLessThan(0.005);
      const dicke = vorher["1:1"].max[0] - vorher["1:1"].min[0];
      expect(anfragen.filter((u) => MODUL_ANFRAGE.test(u)), "ohne Relation kein CSG-Modul").toEqual([]);

      // ---- choose the gable wall of the upper storey: IfcWall on "1. OG" with the quantity 3 m × 3 m = 9 m² ----
      const waende = (await befehl(page, "modell", { klasse: "IfcWall" })).result.bauteile.filter((/** @type {any} */ b) => b.geschoss === "1. OG");
      let giebelGuid = null;
      for (const w of waende) {
        const r = (await befehl(page, "auswahl-guid", { guid: w.guid })).result;
        if (Math.abs((r.bauteile[0]?.steckbrief?.menge?.wert ?? 0) - 9) < 1e-6) { giebelGuid = w.guid; break; }
      }
      expect(giebelGuid, "Giebelwand des Obergeschosses gefunden").not.toBeNull();
      const wahl = page.getByTestId("seo-dach-wahl");
      await expect(wahl).toBeVisible({ timeout: 20000 });
      await wahl.selectOption({ label: "Dach 1" });
      // the relation is stored (target unchanged, operator = the roof, operation abzug_nach_oben, aktiv)
      await expect.poll(async () => (await gespeichert())?.solidrelationen_layer?.relationen?.length ?? 0, { timeout: 20000 }).toBe(1);
      const rel = (await gespeichert()).solidrelationen_layer.relationen[0];
      expect(rel).toMatchObject({ ziel_guid: giebelGuid, operation: "abzug_nach_oben", aktiv: true });
      await expect(page.getByTestId("seo-relation")).toHaveCount(1);
      // the wall follows the roof: apex 3 + 1 = 4.0 m; the library chunk is loaded only now
      await expect.poll(async () => Math.round(((await huellwaende3d(page))["1:1"]?.max?.[1] ?? 0) * 1000) / 1000, { timeout: 60000 }).toBe(4);
      expect(anfragen.some((u) => BIBLIOTHEK.test(u)), "CSG-Bibliothek erst mit der Relation nachgeladen").toBe(true);
      const menge = page.getByTestId("seo-volumen");
      await expect(menge).toHaveAttribute("data-quelle", "solid", { timeout: 20000 });
      // triangle ½ · 3 · 1.0 = 1.5 m² times the thickness of the hull wall (read from its 3D box), 3 decimals shown
      expect(Math.abs(zahlAus(await menge.textContent()) - 1.5 * dicke)).toBeLessThanOrEqual(0.0015);
      await page.screenshot({ path: path.join(ORDNER, "giebel-3d.png") });

      // ---- the section along z = 0 shows the same edge: the cut gable wall reaches 4.0 m ----
      await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
      const schnitt = page.locator('[data-schnittschicht^="env:1:1:"]');
      await expect(schnitt.first()).toBeVisible({ timeout: 20000 });
      await expect(schnitt.first()).toHaveAttribute("data-verschneidung", "solid");
      // the storey below stays in the section as its rectangle
      await expect(page.locator('[data-schnittschicht^="env:0:1:"]').first()).toBeVisible();
      await page.screenshot({ path: path.join(ORDNER, "giebel-schnitt.png") });
      const hoechster = await page.evaluate(() => {
        const svg = /** @type {SVGSVGElement} */ (document.querySelector('[data-schnittschicht^="env:1:1:"]')?.closest("svg"));
        const p = /** @type {SVGPathElement} */ (document.querySelector('[data-schnittschicht^="env:1:1:"]'));
        const q = /** @type {SVGPathElement} */ (document.querySelector('[data-schnittschicht^="env:0:1:"]'));
        const b1 = p.getBBox(), b0 = q.getBBox();
        // y grows downwards in the SVG: the storey below spans 0 … 3 m, so its height gives the scale (px per m)
        const proM = b0.height / 3;
        return svg ? { oben_m: 3 + (b0.y - b1.y) / proM, unten_m: 3 + (b0.y - (b1.y + b1.height)) / proM } : null;
      });
      expect(Math.abs(/** @type {any} */ (hoechster).oben_m - 4)).toBeLessThan(0.02);
      expect(Math.abs(/** @type {any} */ (hoechster).unten_m - 3)).toBeLessThan(0.02);

      // ---- roof slope 30° in the roof inspector: apex 3 + 1.5 · tan 30° = 3.866 m, the wall follows ----
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      const dachGuid = (await befehl(page, "modell", { klasse: "IfcRoof" })).result.bauteile[0].guid;
      expect((await befehl(page, "auswahl-guid", { guid: dachGuid })).ok).toBe(true);
      await expect(page.getByTestId("dach-form")).toHaveValue("sattel");
      await page.getByTestId("dach-neigung").fill("30");
      await expect.poll(async () => Math.round(((await huellwaende3d(page))["1:1"]?.max?.[1] ?? 0) * 1000) / 1000, { timeout: 60000 }).toBe(3.866);

      // ---- review 107-10: the floor plan comes from the same solid. Slope 60°: apex 3 + 1.5 · tan 60° = 5.598 m; the plan cut of the
      // upper storey (3 + 1.1 = 4.1 m) keeps only |z| ≤ 1.5 − 1.1 / tan 60° = 0.865 m of the 3 m gable wall (1.73 m), drawn from the solid
      await page.getByTestId("dach-neigung").fill("60");
      await expect.poll(async () => Math.round(((await huellwaende3d(page))["1:1"]?.max?.[1] ?? 0) * 1000) / 1000, { timeout: 60000 }).toBe(5.598);
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await page.getByLabel("Geschoss wählen").selectOption({ label: "1. OG" });
      const planWand = page.locator('[data-huellwand="1:1"]');
      await expect(planWand).toHaveAttribute("data-verschneidung", "solid", { timeout: 30000 });
      const verhaeltnis = await page.evaluate(() => {
        const box = (/** @type {string} */ s) => /** @type {SVGGraphicsElement} */ (document.querySelector(s)).getBBox();
        // the other gable wall (edge 3, x = −5) is not bevelled: its full length 3 m in z is the scale
        return box('[data-huellwand="1:1"]').height / box('[data-huellwand="1:3"]').height;
      });
      expect(verhaeltnis, "abgeschrägte Giebelwand im Grundriss kürzer als die volle (1,73 / 3 m ≈ 0,58)").toBeLessThan(0.7);
      expect(verhaeltnis).toBeGreaterThan(0.45);
      await page.screenshot({ path: path.join(ORDNER, "giebel-grundriss.png") });

      // ---- review 107-10: the global roof form goes into the IFC only with the switch (field dachform_ifc, stored once used) ----
      await page.locator('select[aria-label="Dachform"]:not([data-testid])').selectOption("sattel");
      await page.getByTestId("dach-ifc").check();
      await expect.poll(async () => (await gespeichert())?.dachform_ifc, { timeout: 20000 }).toBe(true);
      await page.locator('select[aria-label="Dachform"]:not([data-testid])').selectOption("flach");
      await page.getByRole("button", { name: "Ansicht 3D" }).click();

      // ---- remove: aktiv false, the relation stays stored, the wall is unchanged again (6.0 m) ----
      expect((await befehl(page, "auswahl-guid", { guid: giebelGuid })).ok).toBe(true);
      await page.getByTestId("seo-entfernen").click();
      await expect.poll(async () => (await gespeichert())?.solidrelationen_layer?.relationen?.[0]?.aktiv, { timeout: 20000 }).toBe(false);
      await expect.poll(async () => Math.round(((await huellwaende3d(page))["1:1"]?.max?.[1] ?? 0) * 1000) / 1000, { timeout: 30000 }).toBe(6);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await altWeg(request, NAME_A);
    }
  });

  test("Massing-Studio: Untergeschoss mit Geländeabzug (Aushub 240 m³ aus dem Solid), Dach auf einem Körper", async ({ page, request }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    await altWeg(request, NAME_B);
    const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_B, build_kind: "neubau", status: "concept" } })).json()).id;
    // flat terrain h = 0 over 60 × 40 m from (10, 5) site metres, 1 m cells — covers the main body wherever the studio centres it
    const nx = 61, ny = 41;
    const gelaende = { nx, ny, zelle: 1, x0: 10, y0: 5, h: new Array(nx * ny).fill(0) };
    await request.post("/api/entities/BimModel", { data: {
      project_id: id, storeys: 2, storeyHeight: 3, untergeschosse: 1, footprintM: RECHT(-5, -4, 5, 4),
      massing_layer: { v: 6, koerper: [{ id: "k1", name: "Haus", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 50, y: 30 }, drehung: 0, gruppe: null, dach: { form: "sattel", neigung_grad: 30 } }],
        gruppen: {}, naechsteId: 2, gelaende },
    } });
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_B)}&tab=studio`);
      await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
      const mv = page.getByTestId("mv-3d").first();
      await expect(mv).toHaveAttribute("data-ug", "1", { timeout: 30000 });
      // excavation 80 m² × 3 m = 240 m³ from the solid (stempeln gives the same on flat terrain), terrain after the excavation drawn
      await expect(mv).toHaveAttribute("data-ug-aushub-m3", "240", { timeout: 90000 });
      await expect(mv).toHaveAttribute("data-ug-quelle", "solid");
      await expect(mv).toHaveAttribute("data-gelaende-abzug", "1");
      await expect(mv).toHaveAttribute("data-ug-fehler", "");
      // review 107-10: the quantity, its source and the earth contact stand visibly on the view (not only in data attributes)
      const ugStatus = mv.getByTestId("mv-ug-status");
      await expect(ugStatus).toContainText("Aushub 240 m³ (aus dem 3D-Körper)");
      await expect(ugStatus).toContainText("Erdberührte UG-Wände");
      await expect(mv.getByTestId("mv-ug-warnung")).toHaveCount(0);
      // review 107-10: the body counters are set without WebGL too (before they were checked only with a canvas)
      await expect(mv).toHaveAttribute("data-mk-daecher", "1");
      await expect(mv).toHaveAttribute("data-mk-dach-offen", "0");
      await page.screenshot({ path: path.join(ORDNER, "massing-ug.png") });
      // the iso view for a look at the pit and the roof (screenshot only, the values above are the proof)
      await page.getByRole("button", { name: "Iso", exact: true }).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(ORDNER, "massing-ug-iso.png") });
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await altWeg(request, NAME_B);
    }
  });
});
