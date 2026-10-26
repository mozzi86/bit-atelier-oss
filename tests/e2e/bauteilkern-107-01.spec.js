// Headless proof 107-01: the reference line of a wall has ONE derivation. A wall is drawn with the tool (reference
// "Außen"), its build-up is changed afterwards (= thickness changes) — the stored a, b and reference value stay,
// the face on the reference line stays in the plan, in 3D and in the IFC file, and all three show the body at the
// same place (hand-calculated: end points ± n · (d/2 ± d/2) with n = (−dz, dx)). The exported IFC file loads in the
// IFC viewer and contains the wall under its GUID.
// Own project (like aendern-106-03), the studio saves by itself; the plan box is read from the SVG, the 3D box from
// the test hook window.__bitZeigen.bimAenderung.waende3d(), the IFC placement from the downloaded text.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Bauteilkern 10701";
const ORDNER = path.join("test-results", "bauteilkern-107-01");

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

/** Wall thickness in m of a build-up id, read from the app's own table (data only, no geometry). */
const aufbauDicke = (page, id) => page.evaluate(async (cid) => {
  const m = await import(/* @vite-ignore */ "/packages/nova-core/src/lib/buildingModel.js");
  return m.compositeTotalM(cid);
}, id);

/**
 * Hand-calculated body of a wall with reference "outside": corners a/b shifted by n · (o ± d/2), o = +d/2, n = (−dz, dx).
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}}} w
 * @param {number} d thickness in m
 */
function koerperErwartet(w, d) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
  const nx = -(w.b.z - w.a.z) / len, nz = (w.b.x - w.a.x) / len;
  const ecken = [];
  for (const p of [w.a, w.b]) for (const q of [0, d]) ecken.push({ x: p.x + nx * q, z: p.z + nz * q }); // o − d/2 = 0, o + d/2 = d
  const xs = ecken.map((e) => e.x), zs = ecken.map((e) => e.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), n: { x: nx, z: nz }, mitte: { x: (w.a.x + w.b.x) / 2 + nx * d / 2, z: (w.a.z + w.b.z) / 2 + nz * d / 2 } };
}

/** Plan box of the wall in metres relative to the dashed reference line (scale from the line's own length). */
async function planBox(page, wand) {
  return page.evaluate(([idx, len, a]) => {
    const g = document.querySelector(`[data-bim-plan2d] [data-wand="${idx}"]`);
    const linie = [...document.querySelectorAll('[data-bim-plan2d] line[stroke="#0ea5a4"]')].find((l) => l.getAttribute("stroke-dasharray") === "3 2");
    if (!g || !linie) return null;
    const x1 = Number(linie.getAttribute("x1")), y1 = Number(linie.getAttribute("y1")), x2 = Number(linie.getAttribute("x2")), y2 = Number(linie.getAttribute("y2"));
    const s = Math.hypot(x2 - x1, y2 - y1) / len; // user units per metre
    const b = /** @type {any} */ (g).getBBox();
    // plan x = model x, plan y = model z (Z() grows with z): back to metres around the wall's own a
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

test.describe("107-01 Referenzlinie: eine Ableitung für Plan, 3D und IFC", () => {
  test.setTimeout(300000);

  test("Wand zeichnen (Bezug Außen), Aufbau/Dicke ändern: Bezugsseite bleibt, Plan = 3D = IFC, Viewer lädt die Datei", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [] } });

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      const vorher = new Set((await befehl(page, "modell")).result.bauteile.map((b) => b.guid));

      // ---- draw: tool Wand (switches to the plan), reference "Außen", two clicks, Esc ----
      await page.getByRole("button", { name: "Wand", exact: true }).click();
      const bezug = page.getByLabel("Wand-Referenzlinie");
      await expect(bezug).toBeVisible();
      // the six values are offered; since 107-03 the labels say where the LINE lies (stored values unchanged): "outside" keeps the body on
      // the outer side, so its line is the inner face of the layer stack
      await expect(bezug.locator("option")).toHaveText(["Linie Mitte", "Linie innen · Körper außen", "Linie außen · Körper innen", "Kern außen", "Kern innen", "Kern Mitte"]);
      await bezug.selectOption("outside");
      const flaeche = page.locator("[data-bim-plan2d] svg").first();
      await expect(flaeche).toBeVisible();
      await flaeche.click({ position: { x: 380, y: 300 } });
      await flaeche.click({ position: { x: 560, y: 330 } });
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await modellStand(page)).customWalls.length, { timeout: 15000 }).toBe(1);

      const w0 = (await modellStand(page)).customWalls[0];
      expect(w0.refLine, "Bezug Außen wird gespeichert").toBe("outside");
      expect(w0.composite).toBe("single24");
      const guid = (await befehl(page, "modell")).result.bauteile.find((b) => !vorher.has(b.guid) && b.klasse === "IfcWall").guid;
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
      const d0 = await aufbauDicke(page, "single24");

      // ---- BEFORE the change: measure plan and 3D of the 0,24 m wall (review: the "fixed edge" must be measured, not only calculated) ----
      await expect.poll(async () => (await planBox(page, w0))?.maxX ?? null, { timeout: 15000 }).not.toBeNull();
      const planVor = await planBox(page, w0);
      const soll0 = koerperErwartet(w0, d0);
      for (const k of ["minX", "maxX", "minZ", "maxZ"]) expect(Math.abs(planVor[k] - soll0[k]), `Plan vorher ${k}: ${planVor[k]} ≠ ${soll0[k]}`).toBeLessThan(0.02);
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await expect.poll(async () => (await waende3d(page))[w0._idx] ? 1 : 0, { timeout: 20000 }).toBe(1);
      const k3Vor = (await waende3d(page))[w0._idx];
      nah(k3Vor.min[0], soll0.minX, 0.01); nah(k3Vor.max[0], soll0.maxX, 0.01); nah(k3Vor.min[2], soll0.minZ, 0.01); nah(k3Vor.max[2], soll0.maxZ, 0.01);
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);

      // ---- change the build-up of the selected wall: thickness 0,24 m → cavity ----
      await page.getByLabel("Wand-Aufbau").selectOption("cavity");
      const d1 = await aufbauDicke(page, "cavity");
      expect(d1).toBeGreaterThan(d0 + 0.05);
      const w1 = (await modellStand(page)).customWalls[0];
      expect(w1.composite).toBe("cavity");
      expect({ a: w1.a, b: w1.b, refLine: w1.refLine }, "a, b und Bezug bleiben, nur der Aufbau ändert sich").toEqual({ a: w0.a, b: w0.b, refLine: "outside" });

      // ---- plan: the face on the reference line stays, the body grows to the +n side ----
      const soll1 = koerperErwartet(w1, d1);
      await expect.poll(async () => (await planBox(page, w1))?.maxX ?? null, { timeout: 15000 }).not.toBeNull();
      const plan = await planBox(page, w1);
      for (const k of ["minX", "maxX", "minZ", "maxZ"]) expect(Math.abs(plan[k] - soll1[k]), `Plan ${k}: ${plan[k]} ≠ ${soll1[k]}`).toBeLessThan(0.02);
      // the reference face: the box edge on the line side is the same before and after (hand calc of both thicknesses)
      const seite = Math.abs(soll1.n.x) > Math.abs(soll1.n.z) ? "X" : "Z";
      const feste = soll1.n[seite.toLowerCase()] > 0 ? "min" : "max";
      nah(soll1[`${feste}${seite}`], soll0[`${feste}${seite}`]);
      // ... and measured: the edge on the reference line is where it was before the change (plan and, below, 3D)
      expect(Math.abs(plan[`${feste}${seite}`] - planVor[`${feste}${seite}`]), "Plan: Kante auf der Linie vorher = nachher").toBeLessThan(0.02);
      expect(Math.abs(plan[`${feste === "min" ? "max" : "min"}${seite}`] - planVor[`${feste === "min" ? "max" : "min"}${seite}`]), "Plan: die andere Kante wanderte um die Dickendifferenz").toBeGreaterThan(Math.abs(d1 - d0) - 0.03);

      // ---- 3D: the wall meshes lie in the same box ----
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await expect.poll(async () => Object.keys(await waende3d(page)).length, { timeout: 20000 }).toBeGreaterThan(0);
      const k3 = (await waende3d(page))[w1._idx];
      expect(k3, "3D-Körper der Wand").toBeTruthy();
      nah(k3.min[0], soll1.minX, 0.01); nah(k3.max[0], soll1.maxX, 0.01); nah(k3.min[2], soll1.minZ, 0.01); nah(k3.max[2], soll1.maxZ, 0.01);
      const i3 = seite === "X" ? 0 : 2;
      nah(k3[feste][i3], k3Vor[feste][i3], 0.01); // 3D: the reference edge stays too

      // ---- IFC: placement = middle + n · d/2 (hand-calculated), download of the studio ----
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
      const datei = path.join(ORDNER, "wand-aussen.ifc");
      await dl.saveAs(datei);
      const text = fs.readFileSync(datei, "utf8");
      const p = wandPunkt(text, guid);
      expect(p, "Wand mit GUID im IFC").toBeTruthy();
      nah(p[0], soll1.mitte.x, 0.001); nah(p[1], soll1.mitte.z, 0.001); // IFC Y = model z
      nah(p[2], 0, 0.001);

      // ---- viewer: the exported file loads and lists the wall ----
      await page.goto("/IfcViewer");
      await page.locator('input[type="file"][accept=".ifc"]').setInputFiles(datei);
      await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 120000 });
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 30000 });
      await expect.poll(async () => (await befehl(page, "modell")).result?.bauteile?.some((b) => b.guid === guid), { timeout: 60000, message: "die gezeichnete Wand steht im Viewer" }).toBe(true);

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});

test.describe("107-01 Hülle: Bezug der Hülle (huelle_bezug)", () => {
  test.setTimeout(300000);

  test("gespeicherter Bezug wird geladen, im Inspektor geändert, gespeichert und verschiebt nur die Hüllwand im IFC", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    const NAME_H = "E2E Huelle 10701";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME_H)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME_H, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: [], huelle_bezug: "outside" } });
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_H)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      const huellwand = (await befehl(page, "modell", { klasse: "IfcWall" })).result.bauteile[0];
      expect((await befehl(page, "auswahl-guid", { guid: huellwand.guid })).ok).toBe(true);
      const wahl = page.getByLabel("Bezug der Hülle");
      await expect(wahl).toBeVisible({ timeout: 15000 });
      await expect(wahl, "gespeicherter Wert wird geladen").toHaveValue("outside");

      const ifcLaden = async (name) => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
        const datei = path.join(ORDNER, name);
        await dl.saveAs(datei);
        return fs.readFileSync(datei, "utf8");
      };
      /** Placement point of the first IFC wall (hull edge 0 of the default footprint: from (−10,−7) to (10,−7), n = (0, 1)). */
      const ersteWand = (text) => {
        const rows = zeilenMap(text);
        const z = [...rows.values()].find((r) => r.typ === "IFCWALL");
        const pl = z.args.match(/^'[^']*',\$,'[^']*',\$,\$,(#\d+),/)[1];
        const loc = rows.get(rows.get(pl).args.split(",")[1]).args.split(",")[0];
        return rows.get(loc).args.match(/^\(([-\d.]+),([-\d.]+),([-\d.]+)\)$/).slice(1, 4).map(Number);
      };
      // Outer extent of the four hull walls of the ground floor in m, measured in plan, section, 3D (and the IFC placement of edge 0).
      // Default footprint 20 m × 14 m, d = 0,30 m: the wall body of "outside" lies INSIDE the footprint line (outer face = line,
      // 20 × 14), "inside" outside it (20,6 × 14,6), "center" half and half (20,3 × 14,3) — for the standard winding of the footprint
      // (the winding independence is covered by the unit test referenzReview-10701).
      const planMasse = () => page.evaluate(() => {
        const box = (k) => {
          const g = document.querySelector(`[data-bim-plan2d] [data-huellwand="0:${k}"]`);
          if (!g) return null;
          let b = null;
          for (const pf of g.querySelectorAll("path")) { const r = /** @type {any} */ (pf).getBBox(); b = b ? { x0: Math.min(b.x0, r.x), y0: Math.min(b.y0, r.y), x1: Math.max(b.x1, r.x + r.width), y1: Math.max(b.y1, r.y + r.height) } : { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }; }
          return b;
        };
        const [b0, b1, b2, b3] = [0, 1, 2, 3].map(box);
        if (!b0 || !b1 || !b2 || !b3) return null;
        const s = (b0.x1 - b0.x0) / 20; // edge 0 runs along x over exactly 20 m
        return { x: (b1.x1 - b3.x0) / s, z: (b2.y1 - b0.y0) / s, dicke: (b0.y1 - b0.y0) / s };
      });
      const schnittMasse = () => page.evaluate(() => {
        const r = [...document.querySelectorAll("[data-schnittwand]")].map((e) => ({ x: Number(e.getAttribute("x")), w: Number(e.getAttribute("width")) }));
        if (r.length < 2) return null;
        const s = r[0].w / 0.3;
        return { x: (Math.max(...r.map((a) => a.x + a.w)) - Math.min(...r.map((a) => a.x))) / s };
      });
      const huelle3d = async () => {
        const b = await page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.huellwaende3d());
        if (!b["0:0"] || !b["0:1"] || !b["0:2"] || !b["0:3"]) return null;
        return { x: b["0:1"].max[0] - b["0:3"].min[0], z: b["0:2"].max[2] - b["0:0"].min[2] };
      };
      const ansicht = (name) => page.getByRole("button", { name: `Ansicht ${name}` }).click();
      const pruefeBezug = async (wert, soll, ifcName, ifcY) => {
        await ansicht("Grundriss");
        await expect.poll(async () => { const m = await planMasse(); return m ? Math.round(m.x * 50) + "," + Math.round(m.z * 50) : null; }, { timeout: 20000, message: `Plan ${wert}` }).toBe(Math.round(soll.x * 50) + "," + Math.round(soll.z * 50));
        const plan = await planMasse();
        nah(plan.dicke, 0.3, 0.02);
        await ansicht("Schnitt");
        // the section follows the hull reference line for every value, "center" included (107-03, user decision 25.10.2026): section = plan = 3D
        await expect.poll(async () => { const m = await schnittMasse(); return m ? Math.round(m.x * 50) : null; }, { timeout: 20000, message: `Schnitt ${wert}` }).toBe(Math.round(soll.x * 50));
        await ansicht("3D");
        await expect.poll(async () => { const m = await huelle3d(); return m ? Math.round(m.x * 50) + "," + Math.round(m.z * 50) : null; }, { timeout: 20000, message: `3D ${wert}` }).toBe(Math.round(soll.x * 50) + "," + Math.round(soll.z * 50));
        const ifc = ersteWand(await ifcLaden(ifcName));
        nah(ifc[0], 0, 0.001); nah(ifc[1], ifcY, 0.001);
      };
      const waehleBezug = async (wert) => {
        expect((await befehl(page, "auswahl-guid", { guid: huellwand.guid })).ok).toBe(true);
        await expect(wahl).toBeVisible({ timeout: 15000 });
        await wahl.selectOption(wert);
        await expect.poll(async () => (await gespeichert()).huelle_bezug, { timeout: 20000 }).toBe(wert);
      };

      // outside: IFC placement + n · d/2 with d = 0,30 m
      await pruefeBezug("outside", { x: 20, z: 14 }, "huelle-aussen.ifc", -7 + 0.15);
      await waehleBezug("inside");
      await pruefeBezug("inside", { x: 20.6, z: 14.6 }, "huelle-innen.ifc", -7 - 0.15);
      await waehleBezug("center");
      await pruefeBezug("center", { x: 20.3, z: 14.3 }, "huelle-mitte.ifc", -7);
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
