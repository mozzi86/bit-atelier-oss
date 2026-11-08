// 108-13: dormers on the global roof. Test house: tests/unit/fixtures/efh-108.js with knee wall 1.00 m, gable roof 45°, ridge along x,
// eaves at z = ±5.10 (edges 0 north z = −5.1 and 2 south z = +5.1 of the footprint), eaves height 4.15 m (108-02), DG floor 2.90 m.
// Hand calculation, dormer on edge 0, 1.00 m behind the wall, front top 2.50 m over the DG floor:
//   roof at the front line = 4.15 + 1.00 · tan 45° = 5.15; y_front = 2.90 + 2.50 = 5.40 → front 0.25 m visible;
//   d* = (5.40 − 5.15) / (tan 45° − tan 20°) = 0.25 / (1 − 0.36397) = 0.393 m; dormer ridge 5.40 + 0.36397 · 0.393 = 5.543 m.
// With the front top 3.00 m: y_front 5.90, front 0.75, d* = 0.75 / 0.63603 = 1.179 m, ridge 5.90 + 0.429 = 6.329 m; main ridge 4.15 + 5.10 = 9.25.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gaubeBerechnen, gaubenDreiecke, neueGaube, huellKante, GAUBE_STANDARD } from "@core/lib/bauteil/gauben.js";
import { globalesDach } from "@core/lib/bauteil/dachGeometrie.js";
import { EFH_108, efhModellMitKniestock, efhGeschosseMitKniestock } from "./fixtures/efh-108.js";

const gs = efhGeschosseMitKniestock(1);
const model = efhModellMitKniestock(1);
const dach = globalesDach(model, "sattel", 45, gs);

describe("108-13 gaubeBerechnen", () => {
  it("edge 0 is an eave: outward normal −z, roof face found", () => {
    const k = huellKante(model.footprint, 0);
    assert.deepEqual(k.aussen, { x: 0, z: -1 });
    assert.equal(k.len, 11.4);
  });
  it("Schleppgaube 2.30 m, front 3.00 m: depth 1.179 m, ridge 6.329 m, checks", () => {
    const g = { _idx: 1, edge: 0, u_von_m: 2, u_bis_m: 4.3, neigung_grad: 20, ruecksprung_m: 1, front_hoehe_m: 3 };
    const e = gaubeBerechnen(g, model, dach, gs);
    assert.equal(e.ok, true);
    if (!e.ok) return;
    assert.equal(e.level, 1);
    assert.equal(e.breite_m, 2.3);
    assert.equal(e.y_dach_m, 5.15);
    assert.equal(e.y_front_m, 5.9);
    assert.equal(e.front_m, 0.75);
    assert.equal(e.tiefe_m, 1.179);
    assert.equal(e.y_first_m, 6.329);
    assert.equal(e.flaechen.length, 4);
    assert.equal(e.flaechen[0].id, "front");
    // front stands 1.00 m behind the north wall (z = −5.1 → −4.1), from u 2 → x = −5.7 + 2 = −3.7
    assert.deepEqual(e.flaechen[0].punkte3d[0], { x: -3.7, y: 5.15, z: -4.1 });
    assert.deepEqual(e.flaechen[3].punkte3d[2], { x: -1.4, y: 6.329, z: -2.921 });
    assert.equal(e.masse.abstandGiebel_m, 2);
    assert.equal(e.masse.abstandFirstVertikal_m, 2.921);
    assert.equal(e.masse.abstandFirstHorizontal_m, 2.921);
    // window 1.40 × 1.10 on a 1.15 m sill: 4.05 … 5.15 — the sill lies 1.10 m under the roof at the front (the knee wall is only
    // 1.00 m and the visible front 0.75 m): the dormer says so, the planner raises the front or the sill
    assert.ok(e.fenster);
    assert.equal(e.fenster.punkte3d[0].y, 4.05);
    assert.deepEqual(e.warnungen.map((w) => w.code), ["fenster_im_dach"]);
    assert.equal(e.warnungen[0].wert, 1.1);
    // a front of 4.00 m over the floor (y 6.90, 1.75 visible) takes the window without a warning
    const hoch = gaubeBerechnen({ ...g, front_hoehe_m: 4, fenster: { b: 1.4, h: 1.1, bruestung_m: 2.4 } }, model, dach, gs);
    assert.equal(hoch.ok, true);
    if (hoch.ok) assert.deepEqual(hoch.warnungen, []);
    assert.equal(gaubenDreiecke(e).length / 9, 2 + 1 + 1 + 2);
  });
  it("default front 2.50 m: sill 1.15 lies under the roof at the front → warning fenster_im_dach", () => {
    const e = gaubeBerechnen({ edge: 0, u_von_m: 2, u_bis_m: 4.3 }, model, dach, gs);
    assert.equal(e.ok, true);
    if (!e.ok) return;
    assert.equal(e.tiefe_m, 0.393);
    assert.ok(e.warnungen.some((w) => w.code === "fenster_im_dach"));
  });
  it("gable edge refused, flat roof refused, dormer steeper than the main roof refused", () => {
    assert.equal(gaubeBerechnen({ edge: 1, u_von_m: 2, u_bis_m: 4 }, model, dach, gs).ok, false);
    assert.equal(/** @type {any} */ (gaubeBerechnen({ edge: 1, u_von_m: 2, u_bis_m: 4 }, model, dach, gs)).grund, "giebelseite");
    assert.equal(gaubeBerechnen({ edge: 0, u_von_m: 2, u_bis_m: 4 }, model, null, gs).ok, false);
    assert.equal(/** @type {any} */ (gaubeBerechnen({ edge: 0, u_von_m: 2, u_bis_m: 4, neigung_grad: 50 }, model, dach, gs)).grund, "neigung");
  });
  it("south edge 2 mirrors the north one", () => {
    const e = gaubeBerechnen({ edge: 2, u_von_m: 2, u_bis_m: 4.3, front_hoehe_m: 3 }, model, dach, gs);
    assert.equal(e.ok, true);
    if (!e.ok) return;
    assert.equal(e.flaechen[0].punkte3d[0].z, 4.1);
    assert.equal(e.tiefe_m, 1.179);
  });
  it("neueGaube centres the default width on the edge", () => {
    const g = neueGaube(EFH_108.footprintM, 0, 9);
    assert.equal(g._idx, 9);
    assert.equal(g.u_von_m, 4.55);
    assert.equal(g.u_bis_m, 6.85);
    assert.equal(g.u_bis_m - g.u_von_m, GAUBE_STANDARD.breite_m);
  });
});
