// 108-06: stairs as building elements — step rule, warnings, slab opening, derived holes in the hull slabs, 3D bodies, plan symbol.
// Test house: tests/unit/fixtures/efh-108.js (EG 2.90 m, DG 2.60 m, hull slab 0.25 m standing on the storey elevation).
// Hand calculation EG: n = round(2.90 / 0.175) = round(16.57) = 17, s = 2.90 / 17 = 0.17059, a = 0.63 − 2 · 0.17059 = 0.28882,
//   run = 16 · 0.28882 = 4.621 m. Slab above the EG: elevation 2.90 + 2.90 = 5.80, bezug "unten" → underside 5.80 → 2.90 m over the EG
//   floor → k_max = floor((2.90 − 2.00) / 0.17059) = floor(5.28) = 5 → opening from 5 · 0.28882 = 1.444 m to 4.621 m = 3.177 m long.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { treppeBerechnen, treppenLoch, mitTreppenLoechern, treppeKoerper, treppenText, neueTreppe, deckeUeber } from "@core/lib/bauteil/treppe.js";
import { treppeSymbol } from "@core/lib/plan/treppeSymbol.js";
import { geschosshoehe } from "@core/lib/bauteil/hoehen.js";
import { EFH_108, efhModell } from "./fixtures/efh-108.js";

const EG = { _idx: 7, level: 0, art: "gerade", start: { x: -4.0, z: -2.0 }, richtung_grad: 0, breite_m: 1.0 };

describe("108-06 treppeBerechnen", () => {
  it("EG 2.90 m: 17 risers 17.1/28.9, step rule 0.63, run 4.621 m, no warning", () => {
    const e = treppeBerechnen(EG, geschosshoehe(0, EFH_108.geschosse));
    assert.equal(e.n, 17);
    const nah = (a, b) => assert.ok(Math.abs(a - b) < 5e-4, `${a} ≈ ${b}`);
    nah(e.s_m, 0.1706);
    nah(e.a_m, 0.2888);
    nah(e.schrittmass_m, 0.63);
    nah(e.laufLaenge_m, 4.621);
    assert.equal(e.stufen.length, 17);
    nah(e.stufen[16].abstand_m, 4.621);
    nah(e.stufen[16].hoehe_m, 2.9);
    assert.deepEqual(e.warnungen, []);
    assert.equal(treppenText(e), "17 Stg 17,1/28,9");
    // outline: 4.621 × 1.00 around the walking line z = −2
    // quer = left of the ascent (+z for ascent along +x): corner 0 lies right (z −2.5), corner 2 left at the austritt
    assert.deepEqual(e.umriss[0], { x: -4, z: -2.5 });
    assert.deepEqual(e.umriss[2], { x: 0.621, z: -1.5 });
  });
  it("DG 2.60 m: 15 risers", () => {
    const e = treppeBerechnen({ ...EG, level: 1 }, geschosshoehe(1, EFH_108.geschosse));
    assert.equal(e.n, 15);
    assert.ok(Math.abs(e.s_m - 0.1733) < 5e-4);
  });
  it("warnings: width 0.70 → breite; 14 risers on 2.90 m → steigung_hoch + schrittmass stays inside", () => {
    const w = treppeBerechnen({ ...EG, breite_m: 0.7 }, 2.9);
    assert.ok(w.warnungen.some((x) => x.code === "breite"));
    const s = treppeBerechnen({ ...EG, steigungen: 14 }, 2.9);
    assert.ok(s.warnungen.some((x) => x.code === "steigung_hoch"));
    assert.ok(Math.abs(s.s_m - 0.2071) < 5e-4);
  });
  it("direction 90° runs along +z", () => {
    const e = treppeBerechnen({ ...EG, richtung_grad: 90 }, 2.9);
    assert.equal(e.lauflinie[1].x, -4);
    assert.equal(e.lauflinie[1].z, 2.621);
  });
});

describe("108-06 treppenLoch + mitTreppenLoechern", () => {
  it("opening from 1.444 m to the austritt, 3.177 m long, 1.00 m wide, headroom ok", () => {
    const e = treppeBerechnen(EG, 2.9);
    const l = treppenLoch(EG, e, 2.9);
    assert.ok(l);
    assert.equal(l.laenge_m, 3.177);
    assert.equal(l.breite_m, 1);
    assert.equal(l.warnung, null);
    assert.deepEqual(l.points[0], { x: -2.556, z: -2.5 });
    assert.deepEqual(l.points[1], { x: 0.621, z: -2.5 });
  });
  it("loch_breite_m override widens the opening (stringer side)", () => {
    const t = { ...EG, loch_breite_m: 1.12 };
    const l = treppenLoch(t, treppeBerechnen(t, 2.9), 2.9);
    assert.equal(l.breite_m, 1.12);
  });
  it("model without stairs is returned unchanged (same reference)", () => {
    const m = efhModell();
    assert.equal(mitTreppenLoechern(m, [], EFH_108.geschosse).model, m);
    assert.equal(mitTreppenLoechern(m, null, EFH_108.geschosse).model, m);
  });
  it("one derived hole in the slab above the EG, no stored `oeffnungen`", () => {
    const m = efhModell();
    const { model, loecher } = mitTreppenLoechern(m, [EG], EFH_108.geschosse);
    assert.equal(loecher.length, 1);
    assert.equal(loecher[0].id, "treppe-7");
    assert.equal(loecher[0].flaeche_m2, 3.177);
    const decke = deckeUeber(model, 0, EFH_108.geschosse);
    assert.ok(decke);
    assert.equal(decke.oeffnungen_abgeleitet.length, 1);
    assert.equal(decke.oeffnungen, undefined);
    assert.equal(m.slabs.find((s) => s.level === 0).oeffnungen_abgeleitet, undefined, "the input model is not mutated");
    // the KG ceiling (level −1) and the base slab stay untouched
    assert.equal(model.slabs.filter((s) => s.oeffnungen_abgeleitet).length, 1);
  });
  it("KG stair (level −1) opens the ceiling of the basement, not the base slab", () => {
    const m = efhModell();
    const { loecher, model } = mitTreppenLoechern(m, [{ ...EG, level: -1 }], EFH_108.geschosse);
    assert.equal(loecher.length, 1);
    const d = model.slabs.find((s) => s.oeffnungen_abgeleitet);
    assert.equal(d.id, "ug-1");
  });
  it("opening outside the slab outline is dropped", () => {
    const m = efhModell();
    const { loecher } = mitTreppenLoechern(m, [{ ...EG, start: { x: 3, z: -2 } }], EFH_108.geschosse);
    assert.equal(loecher.length, 0);
  });
});

describe("108-06 treppeKoerper, treppeSymbol, neueTreppe", () => {
  it("16 step bodies, the last one top at 16 · s", () => {
    const e = treppeBerechnen(EG, 2.9);
    const k = treppeKoerper(e);
    assert.equal(k.length, 16);
    assert.ok(Math.abs(k[15].oben_m - 2.7294) < 5e-4);
    assert.equal(k[0].unten_m, 0);
    assert.ok(Math.abs(k[0].d1_m - 0.2888) < 5e-4);
  });
  it("symbol: 17 step lines, those above 1.00 m dashed, arrow, text; view from above shows the opening", () => {
    const e = treppeBerechnen(EG, 2.9);
    const s = treppeSymbol(e, { schnitt_m: 1.0 });
    const linien = s.filter((x) => x.art === "linie" && x.pts.length === 2 && x.gewicht === "duenn" && s.indexOf(x) < 18);
    assert.equal(linien.filter((x) => x.strich === "voll").length, 5, "risers 1…5 top ≤ 1.00 m (5 · 0.171 = 0.853; 6 · 0.171 = 1.024)");
    assert.equal(linien.filter((x) => x.strich === "gestrichelt").length, 12);
    assert.ok(s.some((x) => x.art === "pfeil"));
    assert.equal(s.find((x) => x.art === "text").text, "17 Stg 17,1/28,9");
    const o = treppeSymbol(e, { ansicht: "oben", loch: treppenLoch(EG, e, 2.9).points });
    assert.ok(o.some((x) => x.art === "poly" && x.strich === "gestrichelt"));
    assert.ok(!o.some((x) => x.art === "text"));
  });
  it("neueTreppe centres the flight in the outline along its longer side", () => {
    const t = neueTreppe(EFH_108.footprintM, 0, 2.9, 3);
    assert.equal(t.richtung_grad, 0);
    assert.equal(t._idx, 3);
    assert.equal(t.start.z, 0);
    assert.equal(t.start.x, -2.311);
  });
});
