// 115-13: the two-flight stair with intermediate landing and stairwell eye (bauteil/treppeU.js) — geometry, rules, opening, bodies,
// quantities. Expected values are calculated by hand below, not read from the code.
//
// Coordinates: d along the ascent of flight 1, q towards flight 2. "links" (default) = a walker going up turns to their LEFT; in the top
// view (plan z points to the right of a walker facing +x, see treppeU.js "Handedness") an ascent along +x puts flight 2 at plan
// z = −q. (Review 20.11.: the first version of these values had z = +q, i.e. a right-turning stair for "links".)
// Case A — storey 2.80 m, width 1.00 m, eye 0.30 m (default), landing depth = width (default), start (0, 0), ascent +x, turn left:
//   n = round(2.80 / 0.175) = round(16.0) = 16, s = 2.80 / 16 = 0.175, a = 0.63 − 2 · 0.175 = 0.28, 2 s + a = 0.63
//   n1 = ceil(16 / 2) = 8, n2 = 8; L1 = 7 · 0.28 = 1.96, L2 = 1.96, dE = L1 − L2 = 0; landing top h1 = 8 · 0.175 = 1.40
//   middle of flight 2 at q = b + eye = 1.30, outer edge qMax = 1.80; landing d 1.96 … 2.96, q −0.50 … 1.80 → 1.00 × 2.30 = 2.30 m²
//   walking line: 1.96 + π · 0.65 + 1.96 = 3.92 + 2.042 = 5.962 m; treads 7 + 7 = 14; flight area (1.96 + 1.96) · 1.00 = 3.92 m²
//   opening under a slab with underside 2.55 m, headroom above the line of the nosings (review 20.11., treppeRegeln.kopfLochBeginn):
//   d_v = 0.28 · ((2.55 − 2.00) / 0.175 − 1) = 0.28 · 2.142857 = 0.60 (before: k_max = floor(3.14) = 3 → 0.84 over the tread);
//   hexagon (d, q) (0.60,−0.5) (2.96,−0.5) (2.96,1.8) (0,1.8) (0,0.5) (0.60,0.5) → plan z = −q; area 2.96 · 2.30 − 0.60 · 1.00 = 6.808 − 0.60 = 6.208 m²
//   (before 5.968); headroom at the edge 2.55 − 0.175 − 0.60 · 0.175 / 0.28 = 2.55 − 0.175 − 0.375 = 2.000 m → no warning (before "2.025")
// Case B — storey 2.90 m (odd total): n = round(16.57) = 17, s = 0.170588, a = 0.63 − 0.341176 = 0.288824,
//   n1 = ceil(17 / 2) = 9, n2 = 8, L1 = 8 a = 2.310588, L2 = 7 a = 2.021765, dE = a = 0.288824, h1 = 9 s = 1.535294
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { treppeUBerechnen, treppeULoch, treppeUKoerper, treppeUMengen, treppeUText, istUTreppe, TREPPE_U } from "@core/lib/bauteil/treppeU.js";
import { mitTreppenLoechern, deckeUeber, treppeBerechnen } from "@core/lib/bauteil/treppe.js";
import { EFH_108, efhModell } from "./fixtures/efh-108.js";
import { treppeUSymbol, treppeUPlan } from "@core/lib/plan/treppeUSymbol.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 5e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const U = Object.freeze({ _idx: 3, level: 0, art: TREPPE_U, start: { x: 0, z: 0 }, richtung_grad: 0, breite_m: 1.0 });

describe("115-13 treppeUBerechnen — case A (2.80 m, 8 + 8)", () => {
  const e = treppeUBerechnen(U, 2.8);
  it("risers, riser height, going, step rule, split", () => {
    assert.equal(e.n, 16);
    assert.equal(e.n1, 8);
    assert.equal(e.n2, 8);
    nah(e.s_m, 0.175);
    nah(e.a_m, 0.28);
    nah(e.schrittmass_m, 0.63);
    assert.deepEqual(e.warnungen, []);
    assert.equal(treppeUText(e), "16 Stg 17,5/28,0");
  });
  it("flights: lengths, start heights, riser lines", () => {
    nah(e.laeufe[0].laenge_m, 1.96);
    nah(e.laeufe[1].laenge_m, 1.96);
    assert.equal(e.laeufe[0].basis_m, 0);
    nah(e.laeufe[1].basis_m, 1.4);
    assert.equal(e.laeufe[0].stufen.length, 8);
    assert.equal(e.laeufe[1].stufen.length, 8);
    // last riser of flight 1 climbs onto the landing at d = 1.96, height 1.40
    assert.deepEqual(e.laeufe[0].stufen[7].vorne, [{ x: 1.96, z: 0.5 }, { x: 1.96, z: -0.5 }]);
    nah(e.laeufe[0].stufen[7].hoehe_m, 1.4);
    // first riser of flight 2 at the landing edge on the flight-2 side (q 0.80 … 1.80), last one at the austritt d = 0, height 2.80
    assert.deepEqual(e.laeufe[1].stufen[0].vorne, [{ x: 1.96, z: -0.8 }, { x: 1.96, z: -1.8 }]);
    assert.deepEqual(e.laeufe[1].stufen[7].vorne, [{ x: 0, z: -0.8 }, { x: 0, z: -1.8 }]);
    nah(e.laeufe[1].stufen[7].hoehe_m, 2.8);
  });
  it("landing, outline, walking line", () => {
    assert.deepEqual(e.podest.umriss, [{ x: 1.96, z: 0.5 }, { x: 2.96, z: 0.5 }, { x: 2.96, z: -1.8 }, { x: 1.96, z: -1.8 }]);
    nah(e.podest.hoehe_m, 1.4);
    nah(e.podest.flaeche_m2, 2.3);
    // dE = 0: the outline collapses to the rectangle 2.96 × 2.30
    assert.deepEqual(e.umriss, [{ x: 0, z: 0.5 }, { x: 2.96, z: 0.5 }, { x: 2.96, z: -1.8 }, { x: 0, z: -1.8 }]);
    assert.deepEqual(e.lauflinie[0], { x: 0, z: 0 });
    assert.deepEqual(e.lauflinie[1], { x: 1.96, z: 0 });
    // apex of the half circle: d = 1.96 + 0.65, q = 0.65
    assert.deepEqual(e.lauflinie[5], { x: 2.61, z: -0.65 });
    assert.deepEqual(e.lauflinie.at(-2), { x: 1.96, z: -1.3 });
    assert.deepEqual(e.lauflinie.at(-1), { x: 0, z: -1.3 });
    nah(e.lauflinieLaenge_m, 5.962);
  });
  it("quantities", () => {
    const m = treppeUMengen(e);
    assert.equal(m.steigungen, 16);
    assert.equal(m.auftritte, 14);
    nah(m.laufFlaeche_m2, 3.92);
    nah(m.laufLaenge_m, 3.92);
    nah(m.podestFlaeche_m2, 2.3);
    nah(m.podestVolumen_m3, 2.3 * 0.18);
  });
  it("bodies: 7 + 7 treads and one landing plate", () => {
    const k = treppeUKoerper(e);
    assert.equal(k.filter((x) => x.teil === "lauf1").length, 7);
    assert.equal(k.filter((x) => x.teil === "lauf2").length, 7);
    const p = k.filter((x) => x.teil === "podest");
    assert.equal(p.length, 1);
    nah(p[0].oben_m, 1.4);
    nah(p[0].unten_m, 1.4 - 0.18);
    // top tread of flight 2 (j = 7) at 1.40 + 7 · 0.175 = 2.625, between d = 1.96 − 7 · 0.28 = 0 and 0.28
    const l2 = k.filter((x) => x.teil === "lauf2").at(-1);
    nah(/** @type {any} */ (l2).oben_m, 2.625);
    assert.deepEqual(/** @type {any} */ (l2).ring[0], { x: 0, z: -0.8 });
    // the first tread of flight 1 stands on the floor
    assert.equal(k[0].unten_m, 0);
  });
});

describe("115-13 treppeUBerechnen — odd total, overrides, orientation", () => {
  it("case B 2.90 m: 17 = 9 + 8, flight 2 ends one going before the antritt line", () => {
    const e = treppeUBerechnen(U, 2.9);
    assert.equal(e.n, 17);
    assert.equal(e.n1, 9);
    assert.equal(e.n2, 8);
    nah(e.laeufe[0].laenge_m, 2.310588);
    nah(e.laeufe[1].laenge_m, 2.021765);
    nah(e.podest.hoehe_m, 1.535294);
    // outline hexagon: flight 2 austritt at dE = 0.289; the eye counts from there
    assert.deepEqual(e.umriss, [{ x: 0, z: 0.5 }, { x: 3.311, z: 0.5 }, { x: 3.311, z: -1.8 }, { x: 0.289, z: -1.8 }, { x: 0.289, z: -0.5 }, { x: 0, z: -0.5 }]);
    assert.deepEqual(e.warnungen, []);
  });
  it("steigungen_lauf1 = 10 on 16: n2 = 6, flight 2 ends at dE = 9 · 0.28 − 5 · 0.28 = 1.12", () => {
    const e = treppeUBerechnen({ ...U, steigungen_lauf1: 10 }, 2.8);
    assert.equal(e.n1, 10);
    assert.equal(e.n2, 6);
    assert.deepEqual(e.laeufe[1].stufen.at(-1)?.vorne[0], { x: 1.12, z: -0.8 });
  });
  it("turn right mirrors flight 2 to the other side (+z, the walker's right when going +x)", () => {
    const e = treppeUBerechnen({ ...U, wende: "rechts" }, 2.8);
    assert.deepEqual(e.lauflinie.at(-1), { x: 0, z: 1.3 });
    assert.equal(Math.max(...e.umriss.map((p) => p.z)), 1.8);
  });
  it("ascent 90°: flight 1 runs along +z (screen down), flight 2 lies at +x (the walker's left)", () => {
    const e = treppeUBerechnen({ ...U, richtung_grad: 90 }, 2.8);
    assert.deepEqual(e.lauflinie[1], { x: 0, z: 1.96 });
    assert.deepEqual(e.lauflinie.at(-1), { x: 1.3, z: 0 });
  });
  it("eye 0 and a custom landing depth", () => {
    const e = treppeUBerechnen({ ...U, auge_m: 0, podest_tiefe_m: 1.2 }, 2.8);
    assert.equal(e.auge_m, 0);
    nah(e.podest.flaeche_m2, 1.2 * 2.0);
  });
});

describe("115-13 rule warnings (warn, never fix)", () => {
  it("landing shallower than the flight is wide → podest_kurz, geometry keeps the input", () => {
    const e = treppeUBerechnen({ ...U, podest_tiefe_m: 0.9 }, 2.8);
    assert.deepEqual(e.warnungen.map((w) => w.code), ["podest_kurz"]);
    assert.equal(e.podest_tiefe_m, 0.9);
  });
  it("width 0.70 → breite; 13 risers on 2.80 (s = 0.2154) → steigung_hoch", () => {
    assert.ok(treppeUBerechnen({ ...U, breite_m: 0.7 }, 2.8).warnungen.some((w) => w.code === "breite"));
    const e = treppeUBerechnen({ ...U, steigungen: 13 }, 2.8);
    nah(e.s_m, 0.2154);
    assert.ok(e.warnungen.some((w) => w.code === "steigung_hoch"));
  });
  it("19 risers in flight 1 → lauf_lang", () => {
    const e = treppeUBerechnen({ ...U, steigungen: 22, steigungen_lauf1: 19 }, 3.85);
    assert.ok(e.warnungen.some((w) => w.code === "lauf_lang" && w.wert === 19));
  });
});

describe("115-13 treppeULoch", () => {
  const e = treppeUBerechnen(U, 2.8);
  it("underside 2.55 m: L-shaped hexagon from 0.60 m, 6.208 m², headroom 2.00 m above the nosings", () => {
    const l = treppeULoch(U, e, 2.55);
    assert.ok(l);
    assert.deepEqual(l.points, [{ x: 0.6, z: 0.5 }, { x: 2.96, z: 0.5 }, { x: 2.96, z: -1.8 }, { x: 0, z: -1.8 }, { x: 0, z: -0.5 }, { x: 0.6, z: -0.5 }]);
    assert.equal(l.flaeche_m2, 6.208);
    assert.equal(l.kopfhoehe_m, 2);
    assert.equal(l.warnung, null);
  });
  it("underside below 2.00 m: the whole stair is open (rectangle) and the headroom is warned", () => {
    const l = treppeULoch(U, e, 1.95);
    assert.ok(l);
    assert.equal(l.points.length, 4);
    assert.equal(l.warnung?.code, "kopfhoehe");
  });
  it("very high storey (underside 4.20 m over 2.80 m of stair): landing keeps 2.80 m headroom, only flight 2 is open", () => {
    // nosing line of flight 2 from the landing top 1.40: e = 0.28 · ((4.20 − 2.00 − 1.40) / 0.175 − 1) = 0.28 · 3.5714 = 1.00 →
    // flight 2 open from d = 1.96 − 1.00 = 0.96 back to dE = 0 (before, over the tread: j_max = 4 → from 1.96 − 4 · 0.28 = 0.84)
    const l = treppeULoch(U, e, 4.2);
    assert.ok(l);
    assert.deepEqual(l.points, [{ x: 0, z: -0.8 }, { x: 0.96, z: -0.8 }, { x: 0.96, z: -1.8 }, { x: 0, z: -1.8 }]);
  });
});

describe("115-13 mitTreppenLoechern with a U stair in the test house", () => {
  // EG 2.90 m, the hull slab above has its underside 2.90 m over the EG floor (treppe-10806.test.js) → case B,
  // d_v = a · (0.90 / s − 1) = 0.288824 · 4.275862 = 1.235 m (review 20.11., above the nosings; before k_max = 5 → 1.444 m, 5.796 m²);
  // the corners are rounded to mm like every stair polygon (3.311, 0.289, 1.235), area of that polygon
  // (3.311 − 0.289) · 1.3 + (3.311 − 1.235) · 1.0 = 3.9286 + 2.076 = 6.0046 → 6.005 m² (the quantity follows the drawn polygon, as the IFC void does)
  const T = { ...U, _idx: 9, start: { x: -3, z: -2 } };
  it("one derived opening with the polygon area", () => {
    const { model, loecher } = mitTreppenLoechern(efhModell(), [T], EFH_108.geschosse);
    assert.equal(loecher.length, 1);
    assert.equal(loecher[0].id, "treppe-9");
    assert.equal(loecher[0].flaeche_m2, 6.005);
    assert.equal(loecher[0].points.length, 6);
    assert.equal(deckeUeber(model, 0, EFH_108.geschosse).oeffnungen_abgeleitet.length, 1);
  });
  it("a straight stair next to it: same rule (3.386 m², treppe-10806.test.js; before 3.177)", () => {
    const G = { _idx: 7, level: 0, art: "gerade", start: { x: -4.0, z: -2.0 }, richtung_grad: 0, breite_m: 1.0 };
    const { loecher } = mitTreppenLoechern(efhModell(), [G], EFH_108.geschosse);
    assert.equal(loecher[0].flaeche_m2, 3.386);
    assert.equal(istUTreppe(G), false);
    assert.equal(istUTreppe({ ...G, art: undefined }), false);
    assert.equal(treppeBerechnen(G, 2.9).n, 17);
  });
});

// Plan symbol (plan/treppeUSymbol.js): a snapshot of the generated primitives (kind, line style, points in m, text), not of pixels.
// Checked by hand against case A: risers of flight 1 at d = 0 … 1.96 (step 0.28), tops k · 0.175 ≤ 1.00 m for k ≤ 5 → five solid,
// three dashed; flight 2 starts at the landing height 1.40 > 1.00 → all eight dashed; break line at the first riser above the section
// (k = 6, d = 5 · 0.28 + 0.14 = 1.54, offset min(0.3, a) = 0.28); circle r = min(0.12, 1.00 / 6) = 0.12 at the antritt; walking line
// 8 chords of the half circle r = 0.65 around (d, q) = (1.96, 0.65) (first chord end: 1.96 + 0.65 cos −67.5° = 2.209, 0.65 + 0.65 sin −67.5° = 0.049),
// arrow along flight 2 to the austritt (0, 1.30); label at the middle of flight 2 (0.98, 1.30) (review 20.11.: on flight 1 it ran over
// "auf" and the circle); "auf" 0.25 m before the antritt; in the storey above everything dashed and "ab" 0.25 m beyond the austritt
// (−0.25, 1.30). Points below in plan (x, z) = (d, −q).

const sig = (/** @type {any} */ s) => [s.art, s.strich || "-", ...s.pts.map((/** @type {any} */ p) => `${p.x},${p.z}`), s.text || ""].join(" ").trim();
const RISER1 = (/** @type {string[]} */ stil) => [0, 0.28, 0.56, 0.84, 1.12, 1.4, 1.68, 1.96].map((d, i) => `linie ${stil[i]} ${d},0.5 ${d},-0.5`);
const RISER2 = (/** @type {string} */ stil) => [1.96, 1.68, 1.4, 1.12, 0.84, 0.56, 0.28, 0].map((d) => `linie ${stil} ${d},-0.8 ${d},-1.8`);
const BOGEN = ["0,0", "1.96,0", "2.209,-0.049", "2.42,-0.19", "2.561,-0.401", "2.61,-0.65", "2.561,-0.899", "2.42,-1.11", "2.209,-1.251", "1.96,-1.3"];
const LAUFLINIE = (/** @type {string} */ stil) => BOGEN.slice(0, -1).map((p, i) => `linie ${stil} ${p} ${BOGEN[i + 1]}`);

describe("115-13 treppeUSymbol", () => {
  const e = treppeUBerechnen(U, 2.8);
  it("storey of the stair (unten): snapshot", () => {
    assert.deepEqual(treppeUSymbol(e, { ansicht: "unten" }).map(sig), [
      "poly voll 0,0.5 2.96,0.5 2.96,-1.8 0,-1.8",
      "linie voll 0,-0.5 1.96,-0.5",
      "linie gestrichelt 0,-0.8 1.96,-0.8",
      "linie gestrichelt 1.96,-0.5 1.96,-0.8",
      ...RISER1(["voll", "voll", "voll", "voll", "voll", "gestrichelt", "gestrichelt", "gestrichelt"]),
      ...RISER2("gestrichelt"),
      "linie voll 1.26,0.5 1.54,0",
      "linie voll 1.54,0 1.82,-0.5",
      "kreis - 0,0",
      ...LAUFLINIE("voll"),
      "pfeil voll 1.96,-1.3 0,-1.3",
      "text - 0.98,-1.3 16 Stg 17,5/28,0",
      "text - -0.25,0 auf",
    ]);
  });
  it("storey above (oben): everything dashed, \"ab\" at the austritt, the opening", () => {
    const loch = treppeULoch(U, e, 2.55)?.points || null;
    assert.deepEqual(treppeUSymbol(e, { ansicht: "oben", loch }).map(sig), [
      "poly gestrichelt 0,0.5 2.96,0.5 2.96,-1.8 0,-1.8",
      "linie gestrichelt 0,-0.5 1.96,-0.5",
      "linie gestrichelt 0,-0.8 1.96,-0.8",
      "linie gestrichelt 1.96,-0.5 1.96,-0.8",
      ...RISER1(Array(8).fill("gestrichelt")),
      ...RISER2("gestrichelt"),
      ...LAUFLINIE("gestrichelt"),
      "pfeil gestrichelt 1.96,-1.3 0,-1.3",
      "text - -0.25,-1.3 ab",
      "poly gestrichelt 0.6,0.5 2.96,0.5 2.96,-1.8 0,-1.8 0,-0.5 0.6,-0.5",
    ]);
  });
  it("treppeUPlan: own storey unten, storey above oben with the opening, other storeys nothing", () => {
    const T = { ...U, start: { x: -3, z: -2 } };
    const m = efhModell();
    const eg = treppeUPlan(T, m, 0, EFH_108.geschosse);
    const dg = treppeUPlan(T, m, 1, EFH_108.geschosse);
    assert.ok(eg && dg);
    assert.ok(eg.teile.some((s) => s.text === "auf"));
    assert.ok(dg.teile.some((s) => s.text === "ab"));
    assert.equal(dg.teile.at(-1)?.pts.length, 6, "the L-shaped opening of the slab above the EG");
    assert.equal(treppeUPlan(T, m, -1, EFH_108.geschosse), null);
  });
});

describe("115-13 geometry import (modellImport) accepts the U stair", () => {
  it("art podest_u passes; its own rule warning is reported, the stair fields are kept", async () => {
    const { modellPruefen } = await import("../../packages/nova-core/src/lib/bauteil/modellImport.js");
    const fs = await import("node:fs");
    const j = JSON.parse(fs.readFileSync(new URL("./fixtures/efh-108-import.json", import.meta.url), "utf8"));
    Object.assign(j.customStairs[0], { art: TREPPE_U, podest_tiefe_m: 0.9, auge_m: 0.3, wende: "rechts" });
    const r = modellPruefen(j);
    assert.equal(r.ok, true, JSON.stringify(r.fehler));
    assert.deepEqual(r.warnungen.filter((/** @type {any} */ w) => w.pfad === "customStairs[0]").map((/** @type {any} */ w) => w.text), ["Treppe 11: Podesttiefe kleiner als die Laufbreite (DIN 18065)."]);
    const t = r.normalisiert.customStairs[0];
    assert.equal(t.art, TREPPE_U);
    assert.equal(t.wende, "rechts");
    assert.equal(t.podest_tiefe_m, 0.9);
  });
  it("another art is still refused", async () => {
    const { modellPruefen } = await import("../../packages/nova-core/src/lib/bauteil/modellImport.js");
    const fs = await import("node:fs");
    const j = JSON.parse(fs.readFileSync(new URL("./fixtures/efh-108-import.json", import.meta.url), "utf8"));
    j.customStairs[0].art = "spindel";
    assert.equal(modellPruefen(j).ok, false);
  });
});

describe("115-13 quantities (classifiedElements)", () => {
  it("U stair: one stair line (flights) and one landing line; straight stair unchanged", async () => {
    const { classifiedElements } = await import("@core/lib/bimClassification.js");
    // storey 2.80 m → case A: flights 3.92 m² / 3.92 m, landing 2.30 m², plate 2.30 · 0.18 = 0.414 m³
    const els = classifiedElements({ footprintM: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: -5, z: 5 }], storeys: 2, storeyHeight: 2.8,
      customStairs: [{ ...U, start: { x: -3, z: -3 } }, { _idx: 4, level: 0, art: "gerade", start: { x: 2, z: -3 }, richtung_grad: 90, breite_m: 1 }] });
    const st = (/** @type {string} */ id) => els.find((e) => e.id === id);
    nah(st("stair-3").mengen.area, 3.92);
    nah(st("stair-3").mengen.length, 3.92);
    assert.equal(st("stair-3").kg, "351");
    nah(st("stair-3-podest").mengen.area, 2.3);
    nah(st("stair-3-podest").mengen.volume, 0.414);
    // straight 2.80 m: 16 risers, a = 0.28, run 15 · 0.28 = 4.20 m, area 4.20 m²
    nah(st("stair-4").mengen.length, 4.2);
    assert.equal(st("stair-4-podest"), undefined);
  });
});
