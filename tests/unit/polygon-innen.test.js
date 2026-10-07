// Unit-Tests für packages/nova-core/src/lib/polygonInnen.js (75-06 Task 1).
// Jede Flächenzahl ist im Kommentar per Hand gerechnet — der Maßstabsfehler
// KD-01 (Faktor 25) entstand genau an dieser Sorte Test. Punkte {x, y} in
// Metern, Polygon-Literale ohne Rahmenwerk.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  flaecheM2, punktInnen, kantenSchnitte, istKonvex, clipSutherlandHodgman,
  flaecheAusserhalb, konvexeHuelle, laengsteKante,
} from "@core/lib/polygonInnen";

// 10 × 10 m Quadrat bei 0…10 (Fläche: Shoelace = 10 · 10 = 100 m²).
const QUADRAT_10 = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
// 20 × 20 m Baufeld bei 0…20 (Fläche 400 m²).
const BAUFELD_20 = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
// L-Form (nicht konvex): 6 Punkte, konkave Ecke bei (10,10).
const L_FORM = [
  { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
  { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 },
];

describe("flaecheM2 (Shoelace in Metern)", () => {
  it("10×10-Quadrat → 100 m² (Handrechnung: 10 · 10)", () => {
    assert.ok(Math.abs(flaecheM2(QUADRAT_10) - 100) < 1e-9);
  });

  it("Umlaufsinn egal, < 3 Punkte → 0", () => {
    const cw = [...QUADRAT_10].reverse(); // clockwise ring
    assert.ok(Math.abs(flaecheM2(cw) - 100) < 1e-9);
    assert.equal(flaecheM2([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0);
  });
});

describe("punktInnen", () => {
  it("Punkt in der Mitte → true, außerhalb → false", () => {
    assert.equal(punktInnen(QUADRAT_10, { x: 5, y: 5 }), true);
    assert.equal(punktInnen(QUADRAT_10, { x: 15, y: 5 }), false);
  });

  it("Punkt exakt auf der Kante gilt als innen (sonst schraffuriert ein Körper auf der Grenze sich selbst rot)", () => {
    assert.equal(punktInnen(QUADRAT_10, { x: 0, y: 5 }), true);   // left edge
    assert.equal(punktInnen(QUADRAT_10, { x: 10, y: 10 }), true); // corner
  });
});

describe("kantenSchnitte", () => {
  it("Rechteck ragt zur Hälfte über die Baufeldkante → genau 2 Schnittpunkte", () => {
    // Body 15…25 × 5…15 crosses the envelope edge x = 20 at (20,5) and (20,15):
    // two edges of the body (y=5 and y=15) each cross exactly one envelope edge.
    const koerper = [{ x: 15, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 15 }, { x: 15, y: 15 }];
    const schnitte = kantenSchnitte(koerper, BAUFELD_20);
    assert.equal(schnitte.length, 2);
    const xs = schnitte.map((s) => Math.round(s.x));
    assert.deepEqual(xs, [20, 20]); // both on the envelope edge x = 20
  });

  it("vollständig innen (kein Randkontakt) → 0 Schnitte; parallele Segmente → kein Treffer", () => {
    // Square 2…8 strictly inside the envelope 0…20: no edge can cross.
    const INNEN_6 = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }];
    assert.equal(kantenSchnitte(INNEN_6, BAUFELD_20).length, 0);
    // Degenerate: the square shares its corner (0,0) and two edges with the
    // envelope's lower/left border — measured T-touch points are (0,0) twice
    // (both edges meeting at the shared corner), (10,0) and (0,10): 4 hits.
    // Geometrically correct segment touches, NOT violations;
    // flaecheAusserhalb judges via the area difference (0 m² here).
    assert.equal(kantenSchnitte(QUADRAT_10, BAUFELD_20).length, 4);
  });
});

describe("istKonvex", () => {
  it("L-Form → false, Rechteck → true", () => {
    assert.equal(istKonvex(L_FORM), false);
    assert.equal(istKonvex(QUADRAT_10), true);
  });
});

describe("clipSutherlandHodgman", () => {
  it("10×10-Körper im 20×20-Baufeld → Körper unverändert (Fläche 100)", () => {
    const clipped = clipSutherlandHodgman(QUADRAT_10, BAUFELD_20);
    assert.ok(Math.abs(flaecheM2(clipped) - 100) < 1e-9); // hand: 10 · 10 = 100
  });

  it("Körper zur Hälfte draußen → geclippte Fläche 50 m² (Handrechnung: 5 · 10)", () => {
    // Body 15…25 × 5…15, envelope 0…20: the inside part is 15…20 × 5…15 = 5 · 10.
    const koerper = [{ x: 15, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 15 }, { x: 15, y: 15 }];
    const clipped = clipSutherlandHodgman(koerper, BAUFELD_20);
    assert.ok(Math.abs(flaecheM2(clipped) - 50) < 1e-9);
  });
});

describe("flaecheAusserhalb", () => {
  it("konvexes Baufeld: 10×10 bei x 15…25 → 50 m² außerhalb (Handrechnung: 5 · 10)", () => {
    const koerper = [{ x: 15, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 15 }, { x: 15, y: 15 }];
    const res = flaecheAusserhalb(koerper, BAUFELD_20);
    assert.ok(Math.abs(res.m2 - 50) < 1e-9);
    assert.equal(res.hatAnteilAusserhalb, true);
  });

  it("nicht-konvexes Baufeld → m2 null, aber hatAnteilAusserhalb true (Ehrlichkeit statt erfundener Zahl)", () => {
    // Body inside the L's notch region 15…25 × 15…25 sticks out of the L
    // (the L only reaches x/y = 20 on one leg each, and the notch corner is
    // at (10,10)) — corner (25,15) is outside, so the flag must be set.
    const koerper = [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }];
    const res = flaecheAusserhalb(koerper, L_FORM);
    assert.equal(res.m2, null);
    assert.equal(res.hatAnteilAusserhalb, true);
    assert.ok(Array.isArray(res.punkte));
  });

  it("Körper ganz im Baufeld → 0 m², keine Verletzung (auf 0 geklemmt)", () => {
    const res = flaecheAusserhalb(QUADRAT_10, BAUFELD_20);
    assert.equal(res.m2, 0);
    assert.equal(res.hatAnteilAusserhalb, false);
  });
});

describe("konvexeHuelle", () => {
  it("zwei getrennte Rechtecke → Hülle umfasst beide (Fläche Handrechnung: 30 · 10 = 300 m²)", () => {
    // Rect 0…10 × 0…10 and rect 20…30 × 0…10: hull = 0…30 × 0…10.
    const punkte = [...QUADRAT_10, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }];
    const huelle = konvexeHuelle(punkte);
    assert.ok(Math.abs(flaecheM2(huelle) - 300) < 1e-9);
    assert.equal(istKonvex(huelle), true);
  });

  it("< 3 Punkte → leeres Polygon, kein Wurf", () => {
    assert.deepEqual(konvexeHuelle([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
    assert.deepEqual(konvexeHuelle(null), []);
  });
});

describe("laengsteKante", () => {
  it("Rechteck 30×10 → längste Kante 30 m, Winkel 0° (achsenparallel)", () => {
    const rechteck = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 0, y: 10 }];
    const k = laengsteKante(rechteck);
    assert.equal(k.i, 0);
    assert.ok(Math.abs(k.laengeM - 30) < 1e-9);
    assert.ok(Math.abs(k.winkelGrad - 0) < 1e-9);
  });

  it("gedrehtes Rechteck (+30°) → Winkel 30° ±0,5° (Richtung egal, [0,180))", () => {
    // Rotate the 30×10 rect by 30° around the origin: cos30 ≈ 0.866025,
    // sin30 = 0.5. Longest edge direction becomes 30° against +x.
    const rad = (30 * Math.PI) / 180;
    const rot = (p) => ({ x: p.x * Math.cos(rad) - p.y * Math.sin(rad), y: p.x * Math.sin(rad) + p.y * Math.cos(rad) });
    const rechteck = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 0, y: 10 }].map(rot);
    const k = laengsteKante(rechteck);
    assert.ok(Math.abs(k.winkelGrad - 30) <= 0.5, `Winkel ${k.winkelGrad} outside 30 ±0.5`);
    assert.ok(Math.abs(k.laengeM - 30) < 1e-6); // rotation preserves length
  });

  it("degeneriert (< 2 Punkte) → null", () => {
    assert.equal(laengsteKante([{ x: 0, y: 0 }]), null);
    assert.equal(laengsteKante(null), null);
  });
});
