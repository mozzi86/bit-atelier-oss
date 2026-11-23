// W-1118-29: canopy on a hull wall. Test house: tests/unit/fixtures/efh-108.js (footprint 11.40 × 10.20 m, edge 3 = west gable,
// start (−5.7 / +5.1) running north, outward normal −x; ground floor at ±0.00, 2.90 m high).
// Hand calculation, canopy on edge 3 from u = 4.30 to 5.90, 1.00 m deep, underside 2.40 m over the ground floor, plate 0.02 m:
//   wall points (−5.7 / 0.8) and (−5.7 / −0.8), outer points at x = −6.7; underside 2.40, top 2.42; plan area 1.60 m².
//   Two brackets 0.15 m from the ends: u = 4.45 and 5.75 → z = 0.65 and −0.65, each 0.04 wide, 0.12 high, 0.90 long.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { vordachBerechnen, neuesVordach, quaderDreiecke, VORDACH_STANDARD, KONSOLE } from "@core/lib/bauteil/vordach.js";
import { efhModellMitKniestock, efhGeschosseMitKniestock } from "./fixtures/efh-108.js";

const gs = efhGeschosseMitKniestock(1);
const model = efhModellMitKniestock(1);
const basis = { _idx: 1, edge: 3, u_von_m: 4.3, u_bis_m: 5.9, level: 0, tiefe_m: 1, unterkante_m: 2.4, dicke_m: 0.02, konsolen: 2 };

describe("W-1118-29 vordachBerechnen", () => {
  it("plate in front of the west gable: corners, heights, area", () => {
    const e = vordachBerechnen(basis, model, gs);
    assert.equal(e.ok, true);
    if (!e.ok) return;
    assert.equal(e.breite_m, 1.6);
    assert.equal(e.tiefe_m, 1);
    assert.equal(e.flaeche_m2, 1.6);
    assert.equal(e.y_unten_m, 2.4);
    assert.equal(e.y_oben_m, 2.42);
    assert.deepEqual(e.grundriss, [{ x: -5.7, z: 0.8 }, { x: -5.7, z: -0.8 }, { x: -6.7, z: -0.8 }, { x: -6.7, z: 0.8 }]);
    assert.equal(e.platte.length, 8);
    assert.deepEqual(e.platte[0], { x: -5.7, y: 2.4, z: 0.8 });
    assert.deepEqual(e.platte[6], { x: -6.7, y: 2.42, z: -0.8 });
    assert.deepEqual(e.warnungen, []);
  });
  it("two brackets under the plate, 0.15 m from the ends, standing on the wall face", () => {
    const e = vordachBerechnen(basis, model, gs);
    if (!e.ok) return assert.fail("canopy not built");
    assert.equal(e.konsolen.length, 2);
    const [k0, k1] = e.konsolen;
    assert.deepEqual(k0[0], { x: -5.7, y: 2.4 - KONSOLE.hoehe_m, z: 0.67 });
    assert.deepEqual(k0[1], { x: -5.7, y: 2.28, z: 0.63 });
    assert.deepEqual(k0[6], { x: -6.6, y: 2.4, z: 0.63 });
    assert.deepEqual(k1[0], { x: -5.7, y: 2.28, z: -0.63 });
  });
  it("underside follows the storey: on level 1 it sits 2.90 m higher", () => {
    const e = vordachBerechnen({ ...basis, level: 1 }, model, gs);
    assert.equal(e.ok && e.y_unten_m, 5.3);
  });
  it("no brackets and one bracket", () => {
    const ohne = vordachBerechnen({ ...basis, konsolen: 0 }, model, gs);
    assert.equal(ohne.ok && ohne.konsolen.length, 0);
    const eine = vordachBerechnen({ ...basis, konsolen: 1 }, model, gs);
    assert.deepEqual(eine.ok && eine.konsolen[0][0], { x: -5.7, y: 2.28, z: 0.02 });
  });
  it("missing optional fields fall back to VORDACH_STANDARD", () => {
    const e = vordachBerechnen({ edge: 3, u_von_m: 4.3, u_bis_m: 5.9 }, model, gs);
    assert.equal(e.ok && e.tiefe_m, VORDACH_STANDARD.tiefe_m);
    assert.equal(e.ok && e.y_unten_m, VORDACH_STANDARD.unterkante_m);
    assert.equal(e.ok && e.konsolen.length, VORDACH_STANDARD.konsolen);
  });
  it("warns above 1.50 m projection and below 2.10 m clear height", () => {
    const e = vordachBerechnen({ ...basis, tiefe_m: 1.8, unterkante_m: 2 }, model, gs);
    assert.deepEqual(e.ok && e.warnungen.map((w) => w.code), ["vordach_abstand", "vordach_hoehe"]);
  });
  it("refuses a canopy that is too narrow, too shallow or on a missing edge", () => {
    assert.deepEqual(vordachBerechnen({ ...basis, u_bis_m: 4.4 }, model, gs).ok, false);
    assert.equal(/** @type {any} */ (vordachBerechnen({ ...basis, tiefe_m: 0.1 }, model, gs)).grund, "tiefe");
    assert.equal(/** @type {any} */ (vordachBerechnen(basis, { footprint: [] }, gs)).grund, "kante");
  });
  it("is clamped to the edge", () => {
    const e = vordachBerechnen({ ...basis, u_von_m: -1, u_bis_m: 99 }, model, gs);
    assert.equal(e.ok && e.breite_m, 10.2);
  });
});

describe("W-1118-29 quaderDreiecke / neuesVordach", () => {
  it("12 triangles per box", () => {
    const e = vordachBerechnen(basis, model, gs);
    if (!e.ok) return assert.fail("canopy not built");
    assert.equal(quaderDreiecke(e.platte).length, 12 * 9);
  });
  it("new canopy: standard size, centred on the given point, ground floor", () => {
    const v = neuesVordach(model.footprint, 3, 7, 5.1);
    assert.deepEqual(v, { _idx: 7, edge: 3, u_von_m: 4.3, u_bis_m: 5.9, level: 0, tiefe_m: 1, unterkante_m: 2.4, dicke_m: 0.02, konsolen: 2, material: "glas" });
    const mitte = neuesVordach(model.footprint, 0, 8);
    assert.equal(mitte.u_von_m, 4.9);
    assert.equal(mitte.u_bis_m, 6.5);
  });
});

describe("W-1118-29 canopy in plan, IFC and quantities", () => {
  const v = { ...basis, guid: "2VordachTestGuid0000001" };
  it("planGrafik: dashed outline on ebene 'vordach' in its storey only", async () => {
    const { planGrafik } = await import("@designer/lib/vektorPlan.js");
    const eg = planGrafik({ model, level: 0, vordaecher: [v], geschosse: gs });
    const umriss = eg.elemente.filter((e) => e.ebene === "vordach");
    assert.equal(umriss.length, 1);
    assert.equal(umriss[0].dash, "3 2");
    assert.equal(umriss[0].pts.length, 4);
    const dg = planGrafik({ model, level: 1, vordaecher: [v], geschosse: gs });
    assert.equal(dg.elemente.filter((e) => e.ebene === "vordach").length, 0);
  });
  it("exportIFC: one IfcRoof USERDEFINED 'Vordach' with plate and two brackets; none without canopies", async () => {
    const { exportIFC } = await import("@designer/lib/ifcExport.js");
    const mit = exportIFC(model, { vordaecher: [v], geschosse: gs });
    const zeile = mit.split("\n").find((z) => z.includes("IFCROOF") && z.includes("'Vordach'"));
    assert.ok(zeile, "IfcRoof 'Vordach' missing");
    assert.ok(zeile.includes(".USERDEFINED."));
    assert.ok(zeile.includes("2VordachTestGuid0000001"));
    assert.ok(mit.includes("'Plattendicke'"));
    assert.equal(exportIFC(model, { geschosse: gs }).includes("'Vordach'"), false);
  });
});
