// 108-05: door symbol (DIN 1356-1) from one helper. Wall coordinates: u along the wall (0 = opening middle), q across (+q = +normal).
// Door 0.885 m in a 0.24 m wall: hinge on the wall face (q = ±0.12), leaf 0.885 long perpendicular to the wall, swing = quarter circle of
// radius 0.885 from the leaf tip to the opposite jamb; "links" = hinge at the −u jamb for a swing to +q (the picture before 108-05), mirrored for −q.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tuerSymbol, tuerFelder, BOGEN_PUNKTE } from "@core/lib/plan/tuerSymbol.js";
import { planGrafik } from "@designer/lib/vektorPlan";
import { EFH_108, efhModell } from "./fixtures/efh-108.js";

const nah = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≈ ${b}`);

describe("108-05 tuerSymbol", () => {
  const basis = { breite_m: 0.885, dicke_m: 0.24 };
  it("links / innen (+q): hinge at −0.4425 on the +0.12 face, leaf tip 0.885 further out, swing ends at the +u jamb", () => {
    const s = tuerSymbol({ ...basis, anschlag: "links", aufschlag: "innen" });
    assert.equal(s.seite, 1);
    assert.equal(s.fluegel.length, 1);
    const f = s.fluegel[0];
    nah(f.drehpunkt.u, -0.4425, "hinge u"); nah(f.drehpunkt.q, 0.12, "hinge on the wall face");
    nah(f.blattEnde.u, -0.4425, "leaf along the wall"); nah(f.blattEnde.q, 0.12 + 0.885, "leaf length");
    assert.equal(f.bogen.length, BOGEN_PUNKTE);
    for (const p of f.bogen) nah(Math.hypot(p.u - f.drehpunkt.u, p.q - f.drehpunkt.q), 0.885, "radius = leaf width");
    nah(f.bogen[0].u, f.blattEnde.u, "swing starts at the leaf tip"); nah(f.bogen[0].q, f.blattEnde.q, "…");
    nah(f.bogen[BOGEN_PUNKTE - 1].u, 0.4425, "swing ends at the opposite jamb"); nah(f.bogen[BOGEN_PUNKTE - 1].q, 0.12, "on the wall face");
    nah(f.gegenleibung.u, 0.4425, "gegenleibung");
  });
  it("rechts / innen: hinge at +0.4425; aussen mirrors the side (−q); rechts/aussen hinge at −0.4425 on −0.12", () => {
    const r = tuerSymbol({ ...basis, anschlag: "rechts", aufschlag: "innen" });
    nah(r.fluegel[0].drehpunkt.u, 0.4425, "rechts hinge"); nah(r.fluegel[0].gegenleibung.u, -0.4425, "closes to −u");
    const a = tuerSymbol({ ...basis, anschlag: "links", aufschlag: "aussen" });
    assert.equal(a.seite, -1);
    nah(a.fluegel[0].drehpunkt.u, 0.4425, "links mirrored for a swing to −q = +u jamb"); nah(a.fluegel[0].drehpunkt.q, -0.12, "on the −q face");
    nah(a.fluegel[0].blattEnde.q, -(0.12 + 0.885), "leaf to −q");
    const ra = tuerSymbol({ ...basis, anschlag: "rechts", aufschlag: "aussen" });
    nah(ra.fluegel[0].drehpunkt.u, -0.4425, "rechts/aussen"); nah(ra.fluegel[0].drehpunkt.q, -0.12, "…");
  });
  it("innenSeite −1 (inside on the −q side): innen swings to −q", () => {
    const s = tuerSymbol({ ...basis, anschlag: "links", aufschlag: "innen", innenSeite: -1 });
    assert.equal(s.seite, -1);
    nah(s.fluegel[0].drehpunkt.u, 0.4425, "links mirrored for a swing to −q");
  });
  it("two leaves 1.80 m: hinges at both jambs, radii 0.90, both close to the middle", () => {
    const s = tuerSymbol({ breite_m: 1.8, dicke_m: 0.24, fluegel: 2 });
    assert.equal(s.fluegel.length, 2);
    nah(s.fluegel[0].drehpunkt.u, -0.9, "left hinge"); nah(s.fluegel[1].drehpunkt.u, 0.9, "right hinge");
    for (const f of s.fluegel) { nah(f.gegenleibung.u, 0, "closes to the middle"); for (const p of f.bogen) nah(Math.hypot(p.u - f.drehpunkt.u, p.q - f.drehpunkt.q), 0.9, "radius"); }
  });
  it("tuerFelder defaults: links / innen; stored values win", () => {
    assert.deepEqual(tuerFelder(null), { anschlag: "links", aufschlag: "innen" });
    assert.deepEqual(tuerFelder({ anschlag: "rechts", aufschlag: "aussen" }), { anschlag: "rechts", aufschlag: "aussen" });
    assert.deepEqual(tuerFelder({ anschlag: "x", aufschlag: "y" }), { anschlag: "links", aufschlag: "innen" });
  });
});

describe("108-05 PDF plan draws the helper", () => {
  it("a door on a drawn wall: leaf line + 9-point swing on the sheet, hinge on the wall face; rechts mirrors the hinge", () => {
    const model = efhModell();
    const wand = { a: { x: -0.5, z: -5.1 }, b: { x: -0.5, z: 5.1 }, level: 0, thickness: 0.24, _idx: 1 };
    const tuer = { wallIdx: 1, kind: "door", typeId: "single", u: 3, width: 0.885, height: 2.01, _idx: 5 };
    const g = planGrafik({ model, level: 0, customWalls: [wand], customWindows: [tuer], massstab: 50, ansicht: { optionen: { tuerAufschlag: true } } });
    // the entrance door of the hull draws a swing too (level 0): keep the one near the test door (wall x = −0.5, u 3 → z = −2.1)
    const nahTuer = (/** @type {any} */ e) => Math.hypot(e.pts[0].x + 0.5, e.pts[0].z + 2.1) < 1.5;
    const bogen = g.elemente.filter((e) => e.ebene === "oeffnung" && e.offen && e.pts.length === BOGEN_PUNKTE && nahTuer(e));
    assert.equal(bogen.length, 1, "one swing polyline at the door");
    const r = bogen[0].pts.map((p) => Math.hypot(p.x - bogen[0].pts[0].x, p.z - bogen[0].pts[0].z));
    assert.ok(r[BOGEN_PUNKTE - 1] > 1.2 && r[BOGEN_PUNKTE - 1] < 1.26, `chord of a quarter circle r 0.885 = 1.2516: ${r[BOGEN_PUNKTE - 1]}`);
    const blatt = g.elemente.filter((e) => e.ebene === "oeffnung" && e.offen && e.pts.length === 2 && nahTuer(e) && Math.abs(Math.hypot(e.pts[1].x - e.pts[0].x, e.pts[1].z - e.pts[0].z) - 0.885) < 1e-6);
    assert.equal(blatt.length, 1, "leaf 0.885 long");
    // hinge lies on the wall face (0.12 from the axis x = −0.5), swing side +n = +x for a wall along +z
    nah(Math.abs(blatt[0].pts[0].x + 0.5), 0.12, "hinge on the face");
    const g2 = planGrafik({ model, level: 0, customWalls: [wand], customWindows: [{ ...tuer, anschlag: "rechts" }], massstab: 50, ansicht: { optionen: { tuerAufschlag: true } } });
    const blatt2 = g2.elemente.filter((e) => e.ebene === "oeffnung" && e.offen && e.pts.length === 2 && nahTuer(e) && Math.abs(Math.hypot(e.pts[1].x - e.pts[0].x, e.pts[1].z - e.pts[0].z) - 0.885) < 1e-6);
    assert.ok(Math.abs(blatt2[0].pts[0].z - blatt[0].pts[0].z) > 0.8, "rechts hinges at the other jamb");
    void EFH_108;
  });
});
