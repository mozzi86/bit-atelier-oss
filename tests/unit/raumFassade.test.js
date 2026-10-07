// Unit-Tests für packages/nova-designer/src/lib/raumFassade.js (75-11 Task 1).
// Hüllwände als Literale (kein createBuildingModel-Import — der Test prüft die
// Geometrie, nicht die Modellfabrik). Zonen-Punkte sind {x, z} in Metern
// (tesselierung-Konvention), u-Werte mit Handrechnung im Kommentar.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FASSADE_TOL, aufSegment, fassadenAbschnitte } from "@designer/lib/raumFassade";

// 12-m-Hüllwand entlang der Nordkante (z = 0) von (0,0) nach (12,0), edge 0.
const WAND_N = { a: { x: 0, z: 0 }, b: { x: 12, z: 0 }, level: 0, edge: 0 };
// Ostwand (x = 12) von (12,0) nach (12,8), edge 1.
const WAND_O = { a: { x: 12, z: 0 }, b: { x: 12, z: 8 }, level: 0, edge: 1 };

/** Rechteck-Raum als Zone (Punkte im Uhrzeigersinn, {x,z}). */
const raum = (x0, z0, x1, z1, extra = {}) => ({
  points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
  level: 0,
  ...extra,
});

describe("aufSegment", () => {
  it("Punkt auf der Wandachse → u in Metern entlang a→b", () => {
    // Handrechnung: Punkt (5, 0) auf WAND_N → u = 5.
    assert.equal(aufSegment({ x: 5, z: 0 }, WAND_N), 5);
  });

  it("Punkt zu weit von der Achse → null", () => {
    assert.equal(aufSegment({ x: 5, z: 1 }, WAND_N), null); // 1 m > 0.35 m
  });

  it("Punkt vor/hinter der Wand außerhalb der Toleranz → null", () => {
    assert.equal(aufSegment({ x: -1, z: 0 }, WAND_N), null);
    assert.equal(aufSegment({ x: 13, z: 0 }, WAND_N), null);
  });
});

describe("fassadenAbschnitte", () => {
  it("Raum an der Außenkante → 1 Abschnitt { edge: 0, laengeM: 5 } (Handrechnung)", () => {
    // Room 5 × 4 m with its north edge on WAND_N from x = 2 to x = 7.
    const z = raum(2, 0, 7, 4);
    const abs = fassadenAbschnitte(z, [WAND_N, WAND_O]);
    assert.equal(abs.length, 1);
    assert.equal(abs[0].edge, 0);
    assert.equal(abs[0].u0, 2);
    assert.equal(abs[0].u1, 7);
    assert.equal(abs[0].laengeM, 5); // 7 − 2
  });

  it("Innenliegender Raum (keine Kante auf einer Hüllwand) → []", () => {
    // Room fully inside: x 4..8, z 2..6 — no edge touches WAND_N (z=0) or WAND_O (x=12).
    const z = raum(4, 2, 8, 6);
    assert.deepEqual(fassadenAbschnitte(z, [WAND_N, WAND_O]), []);
  });

  it("Eckraum mit zwei Kanten an zwei Hüllwänden → 2 Abschnitte, verschiedene edges", () => {
    // Corner room x 8..12, z 0..4: north edge on WAND_N (u 8..12, 4 m) and
    // east edge on WAND_O (u 0..4, 4 m).
    const z = raum(8, 0, 12, 4);
    const abs = fassadenAbschnitte(z, [WAND_N, WAND_O]);
    assert.equal(abs.length, 2);
    const edges = abs.map((a) => a.edge).sort();
    assert.deepEqual(edges, [0, 1]);
    assert.ok(abs.every((a) => a.u0 < a.u1 && a.u0 >= 0));
  });

  it("L-förmiger Footprint: Raum am kurzen Schenkel bekommt DESSEN Abschnitt, nicht den der Bbox-Kante", () => {
    // L-shaped footprint walls: the notch means the room at x 10..12, z 0..4
    // touches ONLY the short leg wall (x 10..12 at z=0), not a full 12-m wall.
    const schenkel = { a: { x: 10, z: 0 }, b: { x: 12, z: 0 }, level: 0, edge: 7 };
    const bboxKante = { a: { x: 0, z: 0 }, b: { x: 10, z: 0 }, level: 0, edge: 0 };
    const z = raum(10, 0, 12, 4);
    const abs = fassadenAbschnitte(z, [schenkel, bboxKante]);
    assert.equal(abs.length, 1);
    assert.equal(abs[0].edge, 7); // the SHORT leg wins, not the bbox edge 0
    assert.equal(abs[0].laengeM, 2); // 12 − 10
  });

  it("Zone um die halbe Wandstärke (0,18 m) nach innen versetzt → bei FASSADE_TOL 0,35 erkannt", () => {
    // Clear-dimension zone: its north edge sits 0.18 m inside the wall axis.
    const z = raum(2, 0.18, 7, 4);
    const abs = fassadenAbschnitte(z, [WAND_N]);
    assert.equal(abs.length, 1);
    assert.equal(abs[0].laengeM, 5);
    assert.ok(0.18 < FASSADE_TOL); // documented tolerance covers 36.5 cm walls
  });

  it("u0 < u1 und beide innerhalb [0, wallLength]; kurze Abschnitte < minLaenge fallen weg", () => {
    // Room touching WAND_N only from x = 11.5 to x = 12 → 0.5 m segment,
    // below the default minLaenge 0.9 → dropped.
    const z = raum(11.5, 0, 12, 4);
    assert.deepEqual(fassadenAbschnitte(z, [WAND_N]), []);
    // Same room with minLaenge 0.4 → kept, clamped to the wall end (u1 = 12).
    const abs = fassadenAbschnitte(z, [WAND_N], { minLaenge: 0.4 });
    assert.equal(abs.length, 1);
    assert.ok(abs[0].u0 >= 0 && abs[0].u1 <= 12);
    assert.ok(abs[0].u0 < abs[0].u1);
  });

  it("falsches Geschoss wird ignoriert (level muss passen)", () => {
    const z = raum(2, 0, 7, 4, { level: 1 });
    assert.deepEqual(fassadenAbschnitte(z, [WAND_N]), []);
  });
});
