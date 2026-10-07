// Unit tests for the edge geometry (Phase 75-03, MS-03).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kantenNormale, verschiebeKante, kantenLaenge, kantenWinkelGrad, projektionAufNormale, himmelsrichtung } from "@core/lib/polygonKante";

const nah = (ist, soll, eps = 1e-6) => assert.ok(Math.abs(ist - soll) < eps, `${ist} != ${soll}`);
// 16 x 10 rectangle, screen-y down: edge 0 is the north edge (y = 0).
const R = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 0, y: 10 }];
const Rgegen = [...R].reverse();

describe("polygonKante — Normale zeigt nach aussen", () => {
  it("Nordkante: Normale (0, -1) bei Uhrzeiger- und Gegenuhrzeiger-Reihenfolge", () => {
    const n1 = kantenNormale(R, 0);
    nah(n1.nx, 0); nah(n1.ny, -1);
    // in the reversed polygon the north edge is edge 2 (from (16,0) to (0,0))
    const n2 = kantenNormale(Rgegen, 2);
    nah(n2.nx, 0); nah(n2.ny, -1);
  });
  it("Himmelsrichtung aus der Normalen", () => {
    assert.equal(himmelsrichtung({ nx: 0, ny: -1 }), "N");
    assert.equal(himmelsrichtung({ nx: 1, ny: 0 }), "O");
    assert.equal(himmelsrichtung({ nx: 0, ny: 1 }), "S");
    assert.equal(himmelsrichtung({ nx: -1, ny: 0.2 }), "W");
  });
});

describe("polygonKante — verschiebeKante (Handrechnung Blatt 03)", () => {
  it("Nordkante +2 m nach aussen: Tiefe 12, Ost/West 12 m, rechtwinklig", () => {
    const out = verschiebeKante(R, 0, 2);
    const ys = out.map((p) => p.y);
    nah(Math.max(...ys) - Math.min(...ys), 12);
    nah(kantenLaenge(out, 1), 12); // east edge
    nah(kantenLaenge(out, 3), 12); // west edge
    // right angle at corner 1: (p0-p1) . (p2-p1) = 0
    const d = (out[0].x - out[1].x) * (out[2].x - out[1].x) + (out[0].y - out[1].y) * (out[2].y - out[1].y);
    nah(d, 0);
    // untouched points stay
    assert.deepEqual(out[2], R[2]); assert.deepEqual(out[3], R[3]);
  });
  it("negatives d zieht die Kante nach innen", () => {
    const out = verschiebeKante(R, 0, -3);
    nah(out[0].y, 3); nah(out[1].y, 3);
  });
  it("L-Form: nur die zwei Endpunkte der Kante bewegen sich", () => {
    const L = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 10 }, { x: 0, y: 10 }];
    const out = verschiebeKante(L, 2, 1); // edge (16,5)-(8,5), outward = +y
    nah(out[2].y, 6); nah(out[3].y, 6);
    for (const k of [0, 1, 4, 5]) assert.deepEqual(out[k], L[k]);
  });
});

describe("polygonKante — Laenge, Winkel, Projektion", () => {
  it("Winkel 0 (waagerecht) und 90 (senkrecht), Laenge 16/10", () => {
    nah(kantenWinkelGrad(R, 0), 0);
    nah(kantenWinkelGrad(R, 1), 90);
    nah(kantenLaenge(R, 0), 16);
    nah(kantenLaenge(R, 1), 10);
  });
  it("Projektion auf die Normale ist das Skalarprodukt", () => {
    nah(projektionAufNormale({ x: 3, y: -4 }, { nx: 0, ny: -1 }), 4);
    nah(projektionAufNormale({ x: 3, y: -4 }, { nx: 1, ny: 0 }), 3);
  });
});
