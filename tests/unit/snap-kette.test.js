// Unit tests for the snap chain (Phase 75-03, MS-03).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rasterSnap, strahlTrifftSegment, abstandZurGrenze, grenzSnap, abstandSnap, snapKette } from "@core/lib/snapKette";

const nah = (ist, soll, eps = 1e-6) => assert.ok(Math.abs(ist - soll) < eps, `${ist} != ${soll}`);
// Parcel 70 x 50, building north edge midpoint at y = 12 with outward normal (0, -1):
// boundary lies 12 m outward.
const GRENZE = [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 50 }, { x: 0, y: 50 }];
const MITTE = { x: 35, y: 12 };
const N = { nx: 0, ny: -1 };

describe("snapKette — Bausteine", () => {
  it("rasterSnap rundet auf 0,5 m", () => {
    nah(rasterSnap(1.24), 1.0); nah(rasterSnap(1.26), 1.5); nah(rasterSnap(-0.3), -0.5);
    nah(rasterSnap(NaN), 0);
  });
  it("Strahl trifft Segment: Abstand 12 m zur Nordgrenze, kein Treffer parallel", () => {
    nah(strahlTrifftSegment(MITTE, { x: 0, y: -1 }, GRENZE[0], GRENZE[1]), 12);
    assert.equal(strahlTrifftSegment(MITTE, { x: 1, y: 0 }, GRENZE[0], GRENZE[1]), null);
  });
  it("abstandZurGrenze: +12 nach aussen (Nord) — die Suedgrenze liegt weiter weg", () => {
    nah(abstandZurGrenze(MITTE, N, GRENZE), 12);
    assert.equal(abstandZurGrenze(MITTE, N, []), null);
  });
});

describe("snapKette — Grenze und Abstand", () => {
  it("Grenz-Snap greift bei 0,25 m, nicht bei 0,5 m", () => {
    nah(grenzSnap(MITTE, N, 11.75, GRENZE), 12);
    assert.equal(grenzSnap(MITTE, N, 11.5, GRENZE), null);
  });
  it("Abstand-Snap haelt die Kante um die Tiefe vor der Grenze (Tiefe 3 -> d = 9)", () => {
    nah(abstandSnap(MITTE, N, 8.8, GRENZE, 3), 9);
    assert.equal(abstandSnap(MITTE, N, 5, GRENZE, 3), null);
  });
});

describe("snapKette — Reihenfolge und Alt", () => {
  const phi = Object.assign((d) => (Math.abs(d - 1.1) < 0.2 ? 1.1 : null), { zielName: "phi" });
  const grenze = Object.assign((d) => (Math.abs(d - 1.0) < 0.3 ? 1.0 : null), { zielName: "grenze" });
  const raster = Object.assign((d) => rasterSnap(d, 0.5), { zielName: "raster" });
  it("phi gewinnt vor Grenze, wenn beide passen", () => {
    assert.deepEqual(snapKette(1.05, [phi, grenze, raster]), { d: 1.1, ziel: "phi" });
  });
  it("faellt durch bis zum Raster", () => {
    assert.deepEqual(snapKette(2.2, [phi, grenze, raster]), { d: 2.0, ziel: "raster" });
  });
  it("Alt ueberspringt alles", () => {
    assert.deepEqual(snapKette(1.05, [phi, grenze, raster], { alt: true }), { d: 1.05, ziel: null });
  });
});
