// Headless proof 107-03: layer function and priority of a build-up, core reference lines, project build-ups.
//  1. A wall is drawn with the build-up "cavity" and the reference "Kern außen" (the face of the calcium-silicate core lies ON the line).
//     Plan, 3D and the IFC placement agree with the hand calculation (offset = outside layers − d/2). The build-up is copied into the project
//     ("Als Projektaufbau kopieren") and its insulation made thicker: the core line STAYS where it was, the body grows to the outside
//     (measured before and after, plan and 3D); the project build-up is stored in the fachlayer `aufbauten_layer` (v1) and survives a reload.
//     The element override of the layer function moves the core line (measured), the priority override reaches the IFC (Category/Priority).
//  2. A project build-up WITHOUT stated function: the data sheet shows function and core line as proposed ("Vorschlag"), the override of
//     one layer takes the core away (the line then acts like "Mitte": measured), a second override restores it.
//  3. The labels of the reference-line selects say where the line lies.
//  4. Review fixes: the priority field takes digits only (letters, minus and point never reach the store) and names its origin; removing a layer
//     of a project build-up moves the per-layer settings of the wall with the layers; deleting a build-up (and copying a wall that has only
//     a thickness) keeps the wall's thickness; the studio's IFC download carries the decisions of bauteil_attribute_layer (status, KG).
// Own projects (like bauteilkern-107-01); the plan box is read from the SVG, the 3D box from the test hook
// window.__bitZeigen.bimAenderung.waende3d(), the IFC placement from the downloaded text.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const ORDNER = path.join("test-results", "bauteilkern-107-03");

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

function nah(ist, soll, eps = 1e-6) {
  expect(Math.abs(ist - soll), `${ist} ≠ ${soll}`).toBeLessThan(eps);
}

/**
 * Hand-calculated body of a wall: line end points a/b shifted along n = (−dz, dx) by o − d/2 and o + d/2.
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}}} w
 * @param {number} o offset of the body centre line against the reference line in m
 * @param {number} d total thickness in m
 */
function koerperErwartet(w, o, d) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
  const nx = -(w.b.z - w.a.z) / len, nz = (w.b.x - w.a.x) / len;
  const ecken = [];
  for (const p of [w.a, w.b]) for (const q of [o - d / 2, o + d / 2]) ecken.push({ x: p.x + nx * q, z: p.z + nz * q });
  const xs = ecken.map((e) => e.x), zs = ecken.map((e) => e.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), n: { x: nx, z: nz }, mitte: { x: (w.a.x + w.b.x) / 2 + nx * o, z: (w.a.z + w.b.z) / 2 + nz * o } };
}

/** Plan box of the wall in metres (scale from the dashed reference line's own length). */
async function planBox(page, wand) {
  return page.evaluate(([idx, len, a]) => {
    const g = document.querySelector(`[data-bim-plan2d] [data-wand="${idx}"]`);
    const linie = [...document.querySelectorAll('[data-bim-plan2d] line[stroke="#0ea5a4"]')].find((l) => l.getAttribute("stroke-dasharray") === "3 2");
    if (!g || !linie) return null;
    const x1 = Number(linie.getAttribute("x1")), y1 = Number(linie.getAttribute("y1")), x2 = Number(linie.getAttribute("x2")), y2 = Number(linie.getAttribute("y2"));
    const s = Math.hypot(x2 - x1, y2 - y1) / len;
    const b = /** @type {any} */ (g).getBBox();
    return { s, minX: a.x + (b.x - x1) / s, maxX: a.x + (b.x + b.width - x1) / s, minZ: a.z + (b.y - y1) / s, maxZ: a.z + (b.y + b.height - y1) / s };
  }, [wand._idx, Math.hypot(wand.b.x - wand.a.x, wand.b.z - wand.a.z), wand.a]);
}

/** Rows of the STEP text by id. */
function zeilenMap(ifc) {
  const m = new Map();
  for (const l of ifc.split("\n")) { const r = l.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/); if (r) m.set(`#${r[1]}`, { typ: r[2], args: r[3] }); }
  return m;
}
/** [x, y, z] of the IfcLocalPlacement of the wall with this GUID. */
function wandPunkt(ifc, guid) {
  const rows = zeilenMap(ifc);
  const zeile = [...rows.values()].find((r) => r.typ === "IFCWALL" && r.args.startsWith(`'${guid}'`));
  if (!zeile) return null;
  const pl = zeile.args.match(/^'[^']*',\$,'[^']*',\$,\$,(#\d+),/)[1];
  const a2p = rows.get(pl).args.split(",")[1];
  const loc = rows.get(a2p).args.split(",")[0];
  return rows.get(loc).args.match(/^\(([-\d.]+),([-\d.]+),([-\d.]+)\)$/).slice(1, 4).map(Number);
}

/** Creates a fresh project with a BimModel record; returns its id. */
async function projektAnlegen(request, name, bim) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: { project_id: id, ...bim } });
  return id;
}
async function projektLoeschen(request, id) {
  if (!id) return;
  for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
  await request.delete(`/api/entities/Project/${id}`);
}
async function oeffnen(page, name) {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=bim`);
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
  await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
}

/** Stored BimModel record of the project. */
async function gespeichertC(request, id) {
  return (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
}

test.describe("107-03 Schichtaufbau: Funktion, Priorität, Kern-Lagen, Projektaufbauten", () => {
  test.setTimeout(420000);

  test("Kern außen mit Dämmstärke: die Kernlinie bleibt (Plan = 3D = IFC), Projektaufbau, Override von Funktion und Priorität", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    const NAME = "E2E Bauteilkern 10703 A";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      id = await projektAnlegen(request, NAME, { customWalls: [] });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      await oeffnen(page, NAME);
      const vorher = new Set((await befehl(page, "modell")).result.bauteile.map((b) => b.guid));

      // ---- draw: Wand tool, reference "Kern außen", build-up cavity ----
      await page.getByRole("button", { name: "Wand", exact: true }).click();
      await page.getByLabel("Wand-Referenzlinie").selectOption("coreOutside");
      await page.getByLabel("Wand-Aufbau").selectOption("cavity");
      const flaeche = page.locator("[data-bim-plan2d] svg").first();
      await expect(flaeche).toBeVisible();
      await flaeche.click({ position: { x: 380, y: 300 } });
      await flaeche.click({ position: { x: 560, y: 330 } });
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await modellStand(page)).customWalls.length, { timeout: 15000 }).toBe(1);
      const w0 = (await modellStand(page)).customWalls[0];
      expect(w0).toMatchObject({ refLine: "coreOutside", composite: "cavity" });
      const guid = (await befehl(page, "modell")).result.bauteile.find((b) => !vorher.has(b.guid) && b.klasse === "IfcWall").guid;
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);

      // cavity (outside → inside): clinker 100, air 50, insulation 120, calcium silicate 175 (core), plaster 15 → d = 0,46 m, outside layers 0,27 m
      // offset of the body = outside layers − d/2 = 0,27 − 0,23 = +0,04 m: the outer face of the core (0,23 − 0,27 = −0,04 from the body centre) lies on the line
      const misst = async (w, o, d, text) => {
        const soll = koerperErwartet(w, o, d);
        await expect.poll(async () => (await planBox(page, w))?.maxX ?? null, { timeout: 15000, message: `Plan ${text}` }).not.toBeNull();
        const plan = await planBox(page, w);
        for (const k of ["minX", "maxX", "minZ", "maxZ"]) expect(Math.abs(plan[k] - soll[k]), `Plan ${text} ${k}: ${plan[k]} ≠ ${soll[k]}`).toBeLessThan(0.02);
        await page.getByRole("button", { name: "Ansicht 3D" }).click();
        await expect.poll(async () => { const b = (await waende3d(page))[w._idx]; return b ? Math.round((b.max[0] - b.min[0] + b.max[2] - b.min[2]) * 100) : null; }, { timeout: 20000, message: `3D ${text}` })
          .toBe(Math.round((soll.maxX - soll.minX + soll.maxZ - soll.minZ) * 100));
        const k3 = (await waende3d(page))[w._idx];
        nah(k3.min[0], soll.minX, 0.01); nah(k3.max[0], soll.maxX, 0.01); nah(k3.min[2], soll.minZ, 0.01); nah(k3.max[2], soll.maxZ, 0.01);
        await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
        expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
        return { soll, plan, k3 };
      };
      const ifcLaden = async (name) => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
        const datei = path.join(ORDNER, name);
        await dl.saveAs(datei);
        return fs.readFileSync(datei, "utf8");
      };

      const m0 = await misst(w0, 0.04, 0.46, "cavity Kern außen");
      const ifc0 = await ifcLaden("cavity-kern-aussen.ifc");
      const p0 = wandPunkt(ifc0, guid);
      nah(p0[0], m0.soll.mitte.x, 0.001); nah(p0[1], m0.soll.mitte.z, 0.001);
      // layer details: Category/Priority of the core layer, a usage with offset d/2 for the wall
      expect(ifc0).toMatch(/IFCMATERIALLAYER\(#\d+,0\.1750,\.F\.,'Kalksandstein',\$,'Core',65\);/);
      expect(ifc0).toMatch(/IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.2300,\$\);/);
      expect(ifc0).toMatch(/Pset_MaterialCommon/);

      // ---- copy the build-up into the project, make the insulation thicker: 120 → 200 mm ----
      await page.getByTestId("aufbau-kopieren").click();
      await expect.poll(async () => (await modellStand(page)).customWalls[0].composite, { timeout: 15000 }).toBe("p-1");
      await expect(page.getByTestId("aufbau-dicke-2")).toHaveValue("120");
      await page.getByTestId("aufbau-dicke-2").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ORDNER, "inspektor-projektaufbau.png") }); // for the visual check by hand; not an assertion
      await page.getByTestId("aufbau-dicke-2").fill("200");
      // d = 0,54 m, outside layers 0,10 + 0,05 + 0,20 = 0,35 m → offset +0,08 m; the inner edge stays at −0,19 m (core 0,175 + plaster 0,015)
      const w1 = (await modellStand(page)).customWalls[0];
      expect({ a: w1.a, b: w1.b, refLine: w1.refLine }, "a, b und Bezug bleiben").toEqual({ a: w0.a, b: w0.b, refLine: "coreOutside" });
      const m1 = await misst(w1, 0.08, 0.54, "Dämmung 200");
      // the core line stays: the inner edge of the body (core + plaster behind it) did not move; the outer edge moved by 0,08 m
      const n = m1.soll.n, seite = Math.abs(n.x) > Math.abs(n.z) ? "X" : "Z", fest = n[seite.toLowerCase()] > 0 ? "min" : "max", beweglich = fest === "min" ? "max" : "min";
      expect(Math.abs(m1.plan[`${fest}${seite}`] - m0.plan[`${fest}${seite}`]), "Plan: Innenkante (hinter der Kernlinie) bleibt").toBeLessThan(0.02);
      expect(Math.abs(Math.abs(m1.plan[`${beweglich}${seite}`] - m0.plan[`${beweglich}${seite}`]) - 0.08), "Plan: Außenkante wanderte um die Mehrdicke der Dämmung").toBeLessThan(0.02);
      const i3 = seite === "X" ? 0 : 2;
      nah(m1.k3[fest][i3], m0.k3[fest][i3], 0.01);
      const ifc1 = await ifcLaden("projektaufbau-daemmung.ifc");
      const p1 = wandPunkt(ifc1, guid);
      nah(p1[0], m1.soll.mitte.x, 0.001); nah(p1[1], m1.soll.mitte.z, 0.001);
      expect(ifc1).toMatch(/IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.2700,\$\);/);

      // ---- the project build-up is stored in the fachlayer (v1) and survives a reload ----
      await expect.poll(async () => (await gespeichert()).aufbauten_layer?.aufbauten?.["p-1"]?.skins?.[2]?.thickness, { timeout: 20000, message: "aufbauten_layer gespeichert" }).toBe(200);
      const layer = (await gespeichert()).aufbauten_layer;
      expect(layer.v).toBe(1);
      expect(layer.aufbauten["p-1"].skins.map((s) => s.thickness)).toEqual([100, 50, 200, 175, 15]);
      await page.reload();
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      await misst(w1, 0.08, 0.54, "nach dem Neuladen");

      // ---- data sheet: function/priority rows (cavity copy: functions stated in the build-up, priorities proposed) ----
      await expect(page.getByTestId("sb-funktion-3")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("sb-funktion-3").locator('option[value=""]')).toHaveText("wie Aufbau: Kern");
      await expect(page.getByTestId("sb-funktion-0").locator('option[value=""]')).toHaveText("wie Aufbau: Bekleidung");
      await expect(page.getByTestId("sb-prioritaet-3")).toHaveAttribute("placeholder", "650");
      await expect(page.getByTestId("sb-hinweise"), "feste Funktion: keine Annahme zur Funktion").not.toContainText("Funktion der Schichten aus dem Material abgeleitet");

      // ---- override: the clinker skin counts as core → the first core layer is the outermost, the line lies on the outer face of the wall ----
      await page.getByTestId("sb-funktion-0").selectOption("kern");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_funktion, { timeout: 15000 }).toEqual({ 0: "kern" });
      // core = clinker only (the air layer behind it is not core): outside layers 0, offset = 0 − 0,27 = −0,27 m
      const w2 = (await modellStand(page)).customWalls[0];
      const m2 = await misst(w2, -0.27, 0.54, "Override Klinker = Kern");
      expect(Math.abs(m2.plan[`${beweglich}${seite}`] - m0.plan[`${beweglich}${seite}`]), "Plan: der Körper liegt jetzt auf der anderen Seite der Linie").toBeGreaterThan(0.2);
      // back to the build-up's own function
      await page.getByTestId("sb-funktion-0").selectOption("");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_funktion ?? null, { timeout: 15000 }).toBeNull();
      await misst((await modellStand(page)).customWalls[0], 0.08, 0.54, "Override zurückgenommen");

      // ---- priority field: digits only, origin named (review fix: the filter used /D/ instead of /\D/) ----
      await expect(page.getByTestId("sb-prioritaet-3")).toHaveAttribute("data-herkunft", "abgeleitet");
      await page.getByTestId("sb-prioritaet-3").fill("7a5");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_prioritaet, { timeout: 15000, message: "7a5 → 75" }).toEqual({ 3: 75 });
      await expect(page.getByTestId("sb-prioritaet-3")).toHaveValue("75");
      await expect(page.getByTestId("sb-prioritaet-3")).toHaveAttribute("data-herkunft", "gesetzt");
      await page.getByTestId("sb-prioritaet-3").fill("x");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_prioritaet ?? null, { timeout: 15000, message: "nur Buchstaben → Override entfällt" }).toBeNull();
      await expect(page.getByTestId("sb-prioritaet-3")).toHaveValue("");
      // ---- priority override reaches the IFC: 770 → written /10 rounded = 77 on the calcium-silicate layer ----
      await page.getByTestId("sb-prioritaet-3").fill("770");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_prioritaet, { timeout: 15000 }).toEqual({ 3: 770 });
      const ifc2 = await ifcLaden("prioritaet.ifc");
      expect(ifc2).toMatch(/IFCMATERIALLAYER\(#\d+,0\.1750,\.F\.,'Kalksandstein',\$,'Core',77\);/);
      expect(ifc2).toMatch(/IFCPROPERTYSINGLEVALUE\('Schichtprioritaet_Herkunft',\$,IFCLABEL\('abgeleitet \(Vorschlag\)'\),\$\);/);

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await projektLoeschen(request, id);
    }
  });

  test("Projektaufbau ohne Funktion: Vorschlag sichtbar als Vorschlag, Override nimmt den Kern weg und holt ihn zurück; Beschriftung der Bezug-Auswahl", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    const NAME = "E2E Bauteilkern 10703 B";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      // clinker 115, EPS 160, hollow brick 300 (proposed core), plaster 15 → d = 0,59 m, outside layers 0,275 m → offset "Kern außen" = 0,275 − 0,295 = −0,02 m
      id = await projektAnlegen(request, NAME, {
        aufbauten_layer: { v: 1, aufbauten: { "p-1": { name: "Mauerwerk mit Klinker (Projekt)", skins: [
          { name: "Klinker", material: "klinker", thickness: 115 }, { name: "Dämmung", material: "eps032", thickness: 160 },
          { name: "Hochlochziegel", material: "hlz", thickness: 300 }, { name: "Innenputz", material: "gipsputz", thickness: 15 } ] } } },
        customWalls: [{ a: { x: -4, z: -3 }, b: { x: 4, z: -3 }, level: 0, height: 3, composite: "p-1", refLine: "coreOutside", _idx: 1 }],
      });
      await oeffnen(page, NAME);
      const wand = (await modellStand(page)).customWalls[0];
      const huellwand = (await befehl(page, "modell")).result.bauteile.find((b) => b.klasse === "IfcWall" && b.name === "Außenwand" && b.geschoss === "EG");
      // the drawn wall (build-up of 0,59 m = load-bearing) is the only IfcWall that is not an "Außenwand" (hull)
      const guid = (await befehl(page, "modell")).result.bauteile.find((b) => b.klasse === "IfcWall" && b.name !== "Außenwand").guid;
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      const hoehe = async () => { const b = (await waende3d(page))[wand._idx]; return b ? b : null; };
      const messe3d = async (o, d, text) => {
        const soll = koerperErwartet(wand, o, d);
        await expect.poll(async () => { const b = await hoehe(); return b ? Math.round((b.max[0] - b.min[0] + b.max[2] - b.min[2]) * 100) : null; }, { timeout: 20000, message: `3D ${text}` })
          .toBe(Math.round((soll.maxX - soll.minX + soll.maxZ - soll.minZ) * 100));
        const b = await hoehe();
        nah(b.min[0], soll.minX, 0.01); nah(b.max[0], soll.maxX, 0.01); nah(b.min[2], soll.minZ, 0.01); nah(b.max[2], soll.maxZ, 0.01);
      };

      // ---- labels: where the LINE lies (inspector select) ----
      const bezug = page.getByTestId("wand-bezug");
      await expect(bezug).toBeVisible({ timeout: 15000 });
      await expect(bezug.locator("option")).toHaveText(["Linie Mitte", "Linie innen · Körper außen", "Linie außen · Körper innen", "Kern außen", "Kern innen", "Kern Mitte"]);
      await expect(bezug).toHaveValue("coreOutside");

      // ---- proposal is shown as proposal ----
      for (const [i, text] of [[0, "Vorschlag: Bekleidung"], [1, "Vorschlag: Sonstig"], [2, "Vorschlag: Kern"], [3, "Vorschlag: Bekleidung"]]) {
        await expect(page.getByTestId(`sb-funktion-${i}`).locator('option[value=""]')).toHaveText(text);
      }
      await expect(page.getByTestId("sb-hinweise")).toContainText("Funktion der Schichten aus dem Material abgeleitet");
      await expect(page.getByTestId("sb-hinweise")).toContainText("vorgeschlagene Kern-Schicht");
      await page.getByTestId("sb-funktion-0").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ORDNER, "inspektor-vorschlag.png") }); // for the visual check by hand; not an assertion
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await messe3d(-0.02, 0.59, "vorgeschlagener Kern");

      // ---- override: the hollow brick layer is a covering → no core any more → the line acts like "Mitte", the sheet says so ----
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      await page.getByTestId("sb-funktion-2").selectOption("bekleidung");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_funktion, { timeout: 15000 }).toEqual({ 2: "bekleidung" });
      await expect(page.getByTestId("sb-hinweise")).toContainText("ohne Kern-Schicht");
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await messe3d(0, 0.59, "ohne Kern wie Mitte");

      // ---- a second override restores a core (the plaster), the first one is taken back ----
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      await page.getByTestId("sb-funktion-3").selectOption("kern");
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_funktion, { timeout: 15000 }).toEqual({ 2: "bekleidung", 3: "kern" });
      // core = plaster only: outside layers 0,575 m → offset = 0,575 − 0,295 = +0,28 m
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await messe3d(0.28, 0.59, "Innenputz als Kern");
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      // with an override stored the empty choice names the way back, not a value
      await expect(page.getByTestId("sb-funktion-3").locator('option[value=""]')).toHaveText("Aufbau / Vorschlag");
      await expect(page.getByTestId("sb-funktion-3")).toHaveValue("kern");

      // ---- removing a layer moves the per-layer settings with the layers (review fix): bekleidung was set on index 2, kern on 3; the EPS layer (1) goes ----
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      await page.getByRole("button", { name: "Schicht entfernen 2", exact: true }).click();
      await expect.poll(async () => (await modellStand(page)).customWalls[0].schicht_funktion, { timeout: 15000 }).toEqual({ 1: "bekleidung", 2: "kern" });
      await expect(page.getByTestId("sb-funktion-2")).toHaveValue("kern");
      await expect(page.getByTestId("sb-funktion-1")).toHaveValue("bekleidung");

      // ---- hull select: labels by the line, outside = line on the OUTER face of the hull wall ----
      expect((await befehl(page, "auswahl-guid", { guid: huellwand.guid })).ok).toBe(true);
      const huelle = page.getByLabel("Bezug der Hülle");
      await expect(huelle).toBeVisible({ timeout: 15000 });
      await expect(huelle.locator("option")).toHaveText(["Linie Mitte", "Linie außen · Körper innen", "Linie innen · Körper außen"]);

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await projektLoeschen(request, id);
    }
  });

  test("Review-Fixes: Wand nur mit Dicke kopieren und Aufbau löschen behalten die Dicke; der Studio-IFC trägt die Entscheidungen des Attribut-Layers", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    const NAME = "E2E Bauteilkern 10703 C";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      id = await projektAnlegen(request, NAME, {
        customWalls: [{ a: { x: -4, z: -3 }, b: { x: 4, z: -3 }, level: 0, height: 3, thickness: 0.36, _idx: 1 }],
        bauteil_attribute_layer: { attribute: { "hull-wall": { status: "abbruch", kg: "335" } } },
      });
      await oeffnen(page, NAME);
      const guid = (await befehl(page, "modell")).result.bauteile.find((b) => b.klasse === "IfcWall" && b.name !== "Außenwand").guid;
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);

      // ---- a wall with only a thickness (no composite): the copy takes ITS thickness, not the standard build-up (24 cm) ----
      await page.getByTestId("aufbau-kopieren").click();
      await expect.poll(async () => (await modellStand(page)).customWalls[0].composite, { timeout: 15000 }).toBe("p-1");
      await expect(page.getByTestId("aufbau-dicke-0")).toHaveValue("360");
      await expect.poll(async () => (await gespeichertC(request, id)).aufbauten_layer?.aufbauten?.["p-1"]?.skins?.[0]?.thickness, { timeout: 20000 }).toBe(360);

      // ---- deleting the build-up: the wall keeps 36 cm (no jump to 24 cm), tool default and favourites do not keep the dead id ----
      await page.getByTestId("aufbau-loeschen").click();
      await expect.poll(async () => (await modellStand(page)).customWalls[0].composite ?? null, { timeout: 15000 }).toBeNull();
      expect((await modellStand(page)).customWalls[0].thickness).toBeCloseTo(0.36, 6);

      // ---- the studio's IFC download carries the decisions of the attribute layer for the hull (review fix: an end-of-line comment had swallowed the option) ----
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
      const datei = path.join(ORDNER, "attribute-layer.ifc");
      await dl.saveAs(datei);
      const ifc = fs.readFileSync(datei, "utf8");
      expect(ifc, "Status der Hüllwand aus bauteil_attribute_layer").toMatch(/IFCPROPERTYSINGLEVALUE\('Status',\$,IFCLABEL\('abbruch'\),\$\)/);
      expect(ifc, "KG der Hüllwand aus bauteil_attribute_layer").toMatch(/IFCPROPERTYSINGLEVALUE\('KG',\$,IFCLABEL\('335'\),\$\)/);

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await projektLoeschen(request, id);
    }
  });
});
