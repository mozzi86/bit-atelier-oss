// 115-13 review follow-up (20.11.): the findings 1, 3, 4, 5, 6 and 8 of the review of the two-flight stair, each pinned by a test that
// was red on 089b1730.
//
// Handedness (finding 1) in the user's terms: "links" = a person walking UP flight 1 turns to their LEFT at the landing, i.e. the turn
// is counter-clockwise seen from above. The plan (BimPlan2D: screen x = plan x, screen y = plan z, no mirror) and the 3D view (three.js,
// y up, world z = plan z) both show plan (x, z) as a top view in which "left of a walker facing (dx, dz)" is (dz, −dx): walking +x
// (screen right) the left hand points to −z (screen up). The DXF writes (x, −z) with y up — the same picture. So the test reads the side
// on which flight 2 lies with the left vector (dz, −dx) for both turn values and for rotated stairs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { treppeUBerechnen, treppeULoch, treppeUKoerper, TREPPE_U } from "@core/lib/bauteil/treppeU.js";
import { treppeBerechnen } from "@core/lib/bauteil/treppe.js";
import { regelWarnungen } from "@core/lib/bauteil/treppeRegeln.js";
import { treppeUSymbol } from "@core/lib/plan/treppeUSymbol.js";

const U = Object.freeze({ _idx: 3, level: 0, art: TREPPE_U, start: { x: 1, z: 2 }, richtung_grad: 0, breite_m: 1.0 });

/**
 * Mean signed distance of points to the LEFT of the ascent of flight 1, m (> 0 = left of a person walking up flight 1, top view).
 * @param {any} e treppeUBerechnen result @param {Array<{x: number, z: number}>} pts
 */
const links = (e, pts) => {
  const s = e.lauflinie[0], d = e.richtung;
  return pts.reduce((sum, p) => sum + (p.x - s.x) * d.z - (p.z - s.z) * d.x, 0) / pts.length;
};

describe("115-13 follow-up finding 1: handedness of the turn (\"links\" = turn to the walker's left)", () => {
  for (const grad of [0, 90, 210, -45]) {
    it(`ascent ${grad}°: flight 2, landing side, bodies and opening lie left for "links" and right for "rechts"`, () => {
      for (const [wende, vz] of /** @type {const} */ ([["links", 1], [undefined, 1], ["rechts", -1]])) {
        const t = { ...U, richtung_grad: grad, ...(wende ? { wende } : {}) };
        const e = treppeUBerechnen(t, 2.8);
        // flight 2 at q = b + eye = 1.30 m beside flight 1 (centre line)
        assert.ok(Math.abs(links(e, e.laeufe[1].umriss) - vz * 1.3) < 1e-3, `${grad}° ${wende}: flight 2 ${links(e, e.laeufe[1].umriss)}`);
        assert.ok(Math.abs(links(e, e.laeufe[0].umriss)) < 1e-3, "flight 1 is centred on its walking line");
        assert.ok(vz * links(e, e.lauflinie.slice(-2)) > 1.29, "the walking line ends on flight 2");
        const k2 = treppeUKoerper(e).filter((k) => k.teil === "lauf2");
        assert.ok(k2.every((k) => vz * links(e, k.ring) > 0.79), "3D/IFC bodies of flight 2 on the same side");
        const loch = treppeULoch(t, e, 2.55);
        assert.ok(loch && Math.max(...loch.points.map((p) => vz * links(e, [p]))) > 1.79, "the slab opening reaches over flight 2");
      }
    });
  }
  it("screen check of the reviewer's case (ascent 0°, plan y = z): flight 2 of \"links\" lies ABOVE flight 1, of \"rechts\" below", () => {
    const yMitte = (/** @type {any} */ l) => l.umriss.reduce((s, /** @type {any} */ p) => s + p.z, 0) / 4;
    const l = treppeUBerechnen(U, 2.8), r = treppeUBerechnen({ ...U, wende: "rechts" }, 2.8);
    assert.ok(yMitte(l.laeufe[1]) < yMitte(l.laeufe[0]), "links: smaller screen y = higher on the screen");
    assert.ok(yMitte(r.laeufe[1]) > yMitte(r.laeufe[0]));
  });
  it("DXF picture (x, −z), y up: the turn of \"links\" is counter-clockwise (positive signed area of the walking line + closing chord)", () => {
    for (const grad of [0, 90, 210]) {
      const e = treppeUBerechnen({ ...U, richtung_grad: grad }, 2.8);
      const p = e.lauflinie.map((q) => ({ x: q.x, y: -q.z }));
      const a2 = p.reduce((s, q, i) => { const n = p[(i + 1) % p.length]; return s + q.x * n.y - n.x * q.y; }, 0);
      assert.ok(a2 > 0, `${grad}°: ${a2}`);
    }
  });
});

describe("115-13 follow-up finding 3: no false warnings exactly at the DIN 18065 limits (floating point)", () => {
  it("straight stair 2.80 m with 20 risers (s = 14.0 cm) does not warn; 2.79 m with 20 (13.95 cm) does", () => {
    const codes = (/** @type {any} */ e) => e.warnungen.map((/** @type {any} */ w) => w.code);
    assert.ok(!codes(treppeBerechnen({ ...U, art: "gerade", steigungen: 20 }, 2.8)).includes("steigung_niedrig"));
    assert.ok(codes(treppeBerechnen({ ...U, art: "gerade", steigungen: 20 }, 2.79)).includes("steigung_niedrig"));
  });
  it("straight stair 3.00 m with 15 risers (a = 0.63 − 0.40 = 23.0 cm) does not warn; a going of 22.99 cm does", () => {
    const e = treppeBerechnen({ ...U, art: "gerade", steigungen: 15 }, 3.0);
    assert.deepEqual(e.warnungen.map((w) => w.code), []);
    assert.ok(treppeBerechnen({ ...U, art: "gerade", steigungen: 15, auftritt_m: 0.2299 }, 3.0).warnungen.some((w) => w.code === "auftritt_klein"));
  });
  it("the U stair reads the same rule (3.00 m, 15 risers: no auftritt_klein)", () => {
    assert.ok(!treppeUBerechnen({ ...U, steigungen: 15 }, 3.0).warnungen.some((w) => w.code === "auftritt_klein"));
  });
  it("both sides of each limit, computed values (0.1 · 1.4 etc. are not exact in binary)", () => {
    const codes = (/** @type {number} */ s, /** @type {number} */ a, /** @type {number} */ b) => regelWarnungen(s, a, b).map((w) => w.code);
    assert.deepEqual(codes(2.8 / 20, 0.63 - 2 * (2.8 / 20), 1), []);
    assert.deepEqual(codes(3.0 / 15, 0.63 - 2 * (3.0 / 15), 1), []);
    assert.ok(codes(0.1399, 0.35, 1).includes("steigung_niedrig"));
    assert.ok(codes(0.2001, 0.23, 1).includes("steigung_hoch"));
    assert.ok(codes(0.17, 0.2299, 1).includes("auftritt_klein"));
    assert.ok(codes(0.14, 0.3701, 1).includes("auftritt_gross"));
    assert.ok(!codes(0.14, 0.1 * 3.7, 1).includes("auftritt_gross"), "0.1 · 3.7 = 0.37000000000000005 is the limit");
    assert.ok(!codes(0.2, 0.1 * 2.3, 1).includes("auftritt_klein"));
    assert.ok(!codes(0.17, 0.29, 0.1 * 8).includes("breite"));
    assert.ok(codes(0.17, 0.29, 0.799).includes("breite"));
  });
});

describe("115-13 follow-up finding 4: the import refuses invalid U fields in plain text", () => {
  const laden = async () => {
    const { modellPruefen } = await import("../../packages/nova-core/src/lib/bauteil/modellImport.js");
    const fs = await import("node:fs");
    const j = JSON.parse(fs.readFileSync(new URL("./fixtures/efh-108-import.json", import.meta.url), "utf8"));
    return { modellPruefen, j };
  };
  for (const [feld, wert, teil] of /** @type {const} */ ([
    ["wende", "right", "wende „right“"],
    ["auge_m", -2, "Treppenauge auge_m"],
    ["podest_tiefe_m", "tief", "Podesttiefe podest_tiefe_m"],
    ["steigungen_lauf1", 99, "steigungen_lauf1"],
    ["steigungen_lauf1", 2.5, "steigungen_lauf1"],
    ["steigungen_lauf1", 0, "steigungen_lauf1"],
  ])) {
    it(`${feld}: ${JSON.stringify(wert)} → refused, nothing stored`, async () => {
      const { modellPruefen, j } = await laden();
      Object.assign(j.customStairs[0], { art: TREPPE_U, [feld]: wert });
      const r = modellPruefen(j);
      assert.equal(r.ok, false);
      const f = r.fehler.find((/** @type {any} */ x) => x.pfad.startsWith(`customStairs[0].${feld}`));
      assert.ok(f, JSON.stringify(r.fehler));
      assert.ok(f.text.includes(teil), f.text);
    });
  }
  it("valid U fields pass; a straight stair keeps ignoring the U fields (unchanged)", async () => {
    const { modellPruefen, j } = await laden();
    Object.assign(j.customStairs[0], { art: TREPPE_U, wende: "links", auge_m: 0, podest_tiefe_m: 1.2, steigungen_lauf1: 9 });
    assert.equal(modellPruefen(j).ok, true, JSON.stringify(modellPruefen(j).fehler));
    const g = await laden();
    Object.assign(g.j.customStairs[0], { art: "gerade", wende: "right" });
    assert.equal(g.modellPruefen(g.j).ok, true);
  });
});

describe("115-13 follow-up finding 5: one U stair is one piece", () => {
  it("flight row and landing row together count 1; area and volume stay on both rows", async () => {
    const { classifiedElements } = await import("@core/lib/bimClassification.js");
    const els = classifiedElements({ footprintM: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: -5, z: 5 }], storeys: 2, storeyHeight: 2.8,
      customStairs: [{ ...U, start: { x: -3, z: 3 } }, { _idx: 4, level: 0, art: "gerade", start: { x: 2, z: -3 }, richtung_grad: 90, breite_m: 1 }] });
    const zeilen = els.filter((e) => e.id === "stair-3" || e.id === "stair-3-podest");
    assert.equal(zeilen.length, 2);
    assert.equal(zeilen.reduce((s, e) => s + e.mengen.count, 0), 1);
    assert.ok(zeilen.every((e) => e.mengen.area > 0));
    assert.equal(els.find((e) => e.id === "stair-4")?.mengen.count, 1, "straight stair unchanged");
  });
});

describe("115-13 follow-up finding 6: the label collides neither with \"auf\" nor with the antritt circle", () => {
  // Text box model: height h, width 0.6 h per character, centred on its point and turned along the flight (screen) — in the stair's
  // own frame (d along flight 1, q to its left). h = 0.125 / 0.25 m = 2.5 mm text on the sheet at 1:50 / 1:100 (vektorPlan).
  /** @param {any} e @param {any} s @param {number} h */
  const box = (e, s, h) => {
    const o = e.lauflinie[0], d = e.richtung, p = s.pts[0];
    const dd = (p.x - o.x) * d.x + (p.z - o.z) * d.z, qq = (p.x - o.x) * d.z - (p.z - o.z) * d.x;
    const hw = s.art === "kreis" ? s.radius_m : (0.6 * h * s.text.length) / 2, hh = s.art === "kreis" ? s.radius_m : h / 2;
    return { d0: dd - hw, d1: dd + hw, q0: qq - hh, q1: qq + hh };
  };
  const schneiden = (/** @type {any} */ a, /** @type {any} */ b) => a.d0 < b.d1 && b.d0 < a.d1 && a.q0 < b.q1 && b.q0 < a.q1;
  for (const [name, t] of /** @type {const} */ ([["default 1.00 m, eye 0.30", U], ["narrow 0.80 m, eye 0", { ...U, breite_m: 0.8, auge_m: 0 }],
    ["narrow 0.80 m, rechts, 120°", { ...U, breite_m: 0.8, wende: "rechts", richtung_grad: 120 }]])) {
    it(name, () => {
      const e = treppeUBerechnen(t, 2.8);
      const teile = treppeUSymbol(e, { ansicht: "unten" });
      const label = teile.find((s) => s.art === "text" && /Stg/.test(String(s.text)));
      const auf = teile.find((s) => s.art === "text" && s.text === "auf");
      const kreis = teile.find((s) => s.art === "kreis");
      assert.ok(label && auf && kreis);
      for (const h of [0.125, 0.25]) {
        assert.ok(!schneiden(box(e, label, h), box(e, auf, h)), `label × auf at h ${h}`);
        assert.ok(!schneiden(box(e, label, h), box(e, kreis, h)), `label × circle at h ${h}`);
      }
    });
  }
});

describe("115-13 follow-up finding 8: the walking line stays on the landing", () => {
  it("eye 1.20 > width 1.00, landing 1.00: every point of the walking line lies inside the landing depth", () => {
    const e = treppeUBerechnen({ ...U, auge_m: 1.2, podest_tiefe_m: 1.0 }, 2.8);
    const o = e.lauflinie[0], d = e.richtung;
    const L1 = e.laeufe[0].laenge_m;
    const dMax = Math.max(...e.lauflinie.map((p) => (p.x - o.x) * d.x + (p.z - o.z) * d.z));
    assert.ok(dMax <= L1 + 1.0 - 0.1, `the walking line reaches d = ${dMax}, the landing ends at ${L1 + 1.0}`);
    assert.ok(dMax > L1 + 0.5, "it still turns across the landing");
  });
  it("the default stair keeps its half circle (apex at L1 + (b + eye) / 2 = 1.96 + 0.65)", () => {
    const e = treppeUBerechnen(U, 2.8);
    const o = e.lauflinie[0], d = e.richtung;
    const dMax = Math.max(...e.lauflinie.map((p) => (p.x - o.x) * d.x + (p.z - o.z) * d.z));
    assert.ok(Math.abs(dMax - 2.61) < 1e-3, String(dMax));
  });
});

describe("115-13 follow-up finding 2 (user decision 20.11.: fix for both stair types): headroom over the line of the nosings", () => {
  // DIN 18065 [ASSUMED measuring basis, see treppeRegeln.kopfLochBeginn]: the clear headroom is measured plumb above the line joining
  // the step nosings. Tread k (k = 1 … n) has its nosing at d = (k − 1) a and its top at k s, so the nosing line is y(d) = s + d · s / a.
  // The slab may reach to d_v as long as UK − y(d_v) ≥ 2.00 → d_v = a · ((UK − 2.00) / s − 1).
  // Case A (h 2.80, UK 2.55, s 0.175, a 0.28): d_v = 0.28 · (0.55 / 0.175 − 1) = 0.28 · (3.142857 − 1) = 0.28 · 2.142857 = 0.600 m
  //   (before: k_max = floor(3.14) = 3 → 0.84 m, "2.025 m" over the TREAD, but over the nosing 2.55 − 4 · 0.175 = 1.85 m).
  // Case B (h 3.00, UK 2.75, n 17, s 0.176471, a = 0.63 − 0.352941 = 0.277059): d_v = 0.277059 · (0.75 / 0.176471 − 1)
  //   = 0.277059 · (4.25 − 1) = 0.277059 · 3.25 = 0.900 m (before: k_max = 4 → 1.108 m).
  // Headroom at the new edge: UK − (s + d_v s / a) = UK − s − (UK − 2.00 − s) = 2.00 m.
  const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1.5e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
  const G = Object.freeze({ _idx: 7, level: 0, art: "gerade", start: { x: 0, z: 0 }, richtung_grad: 0, breite_m: 1.0 });
  it("straight case A: opening from 0.60 m (not 0.84), length 4.20 − 0.60 = 3.60 m, headroom at the edge 2.00 m", async () => {
    const { treppenLoch } = await import("@core/lib/bauteil/treppe.js");
    const l = treppenLoch(G, treppeBerechnen(G, 2.8), 2.55);
    assert.ok(l);
    nah(Math.min(...l.points.map((p) => p.x)), 0.6);
    nah(l.laenge_m, 3.6);
    nah(l.kopfhoehe_m, 2.0);
    assert.equal(l.warnung, null);
  });
  it("U case A: the hexagon starts over flight 1 at 0.60 m, headroom 2.00 m", () => {
    const e = treppeUBerechnen({ ...U, start: { x: 0, z: 0 } }, 2.8);
    const l = treppeULoch(U, e, 2.55);
    assert.ok(l);
    // flight 1 lies at q ∈ [−0.5, 0.5] (plan z ∈ [−0.5, 0.5] for ascent +x); its opening corners have the smallest d
    nah(Math.min(...l.points.filter((p) => Math.abs(p.z) <= 0.5 + 1e-9 && p.x > 0.1).map((p) => p.x)), 0.6);
    nah(l.kopfhoehe_m, 2.0);
    // area: 2.96 · 2.30 − 0.60 · 1.00 = 6.808 − 0.600 = 6.208 m²
    nah(l.flaeche_m2, 6.208);
  });
  it("U case B (3.00 m, rechts, b 1.10, eye 0.20, landing 1.20, ascent 90°): opening from 0.90 m along flight 1", () => {
    const t = { ...U, start: { x: 0, z: 0 }, richtung_grad: 90, breite_m: 1.1, auge_m: 0.2, podest_tiefe_m: 1.2, wende: "rechts" };
    const e = treppeUBerechnen(t, 3.0);
    assert.equal(e.n, 17);
    const l = treppeULoch(t, e, 2.75);
    assert.ok(l);
    // ascent +z: d = plan z; flight 1 at plan x ∈ [−0.55, 0.55] (beyond the austritt corner of flight 2 at d = dE = a = 0.277)
    nah(Math.min(...l.points.filter((p) => Math.abs(p.x) <= 0.55 + 1e-9 && p.z > 0.4).map((p) => p.z)), 0.9);
    nah(l.kopfhoehe_m, 2.0);
  });
  it("slab so low that even the first nosing lacks 2.00 m: whole flight open and a warning (UK 2.10: 2.10 − 0.175 = 1.925 m)", async () => {
    const { treppenLoch } = await import("@core/lib/bauteil/treppe.js");
    const l = treppenLoch(G, treppeBerechnen(G, 2.8), 2.1);
    assert.ok(l);
    nah(Math.min(...l.points.map((p) => p.x)), 0);
    nah(l.kopfhoehe_m, 1.925);
    assert.equal(l.warnung?.code, "kopfhoehe");
  });
  it("very high storey (U, UK 4.20): only flight 2 is open, from e = 0.28 · ((4.20 − 2.00 − 1.40) / 0.175 − 1) = 1.00 m behind the landing", () => {
    const e = treppeUBerechnen({ ...U, start: { x: 0, z: 0 } }, 2.8);
    const l = treppeULoch(U, e, 4.2);
    assert.ok(l);
    // flight 2 runs back from d = 1.96: open from d = 1.96 − 1.00 = 0.96 to the austritt d = 0
    assert.deepEqual(l.points.map((p) => p.x).sort((a, b) => a - b), [0, 0, 0.96, 0.96]);
    nah(l.kopfhoehe_m, 2.0);
  });
});
