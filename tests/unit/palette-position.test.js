// Unit tests for the palette placement (Phase 75-04, MS-04).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { palettePosition, schneidet, lerp, PALETTE_ABSTAND_PX } from "@core/lib/palettePosition";

const G = { w: 220, h: 120 };
const VP = { w: 1000, h: 700 };

describe("palettePosition — Kandidatenreihenfolge", () => {
  it("Zeiger mittig, nichts zu meiden → SO mit 28 px Abstand", () => {
    const p = palettePosition({ x: 500, y: 350 }, G, null, VP);
    assert.equal(p.ecke, "SO");
    assert.equal(p.x, 500 + PALETTE_ABSTAND_PX);
    assert.equal(p.y, 350 + PALETTE_ABSTAND_PX);
  });
  it("Zeiger unten rechts im Viewport → NW", () => {
    const p = palettePosition({ x: 980, y: 680 }, G, null, VP);
    assert.equal(p.ecke, "NW");
    assert.ok(p.x + G.w <= VP.w && p.y + G.h <= VP.h);
  });
  it("Polygon-Bbox deckt SO und SW → NO", () => {
    const meide = { x0: 0, y0: 360, x1: 1000, y1: 700 }; // everything below the pointer
    const p = palettePosition({ x: 500, y: 350 }, G, meide, VP);
    assert.equal(p.ecke, "NO");
  });
  it("alles belegt → SO geklemmt, innerhalb des Viewports", () => {
    const meide = { x0: -1000, y0: -1000, x1: 3000, y1: 3000 };
    const p = palettePosition({ x: 990, y: 690 }, G, meide, VP);
    assert.equal(p.ecke, "SO-geklemmt");
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + G.w <= VP.w && p.y + G.h <= VP.h);
  });
});

describe("palettePosition — Helfer", () => {
  it("schneidet: Überlappung ja, Berührung nein, null nein", () => {
    assert.equal(schneidet({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 5, x1: 15, y1: 15 }), true);
    assert.equal(schneidet({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 }), false);
    assert.equal(schneidet({ x0: 0, y0: 0, x1: 10, y1: 10 }, null), false);
  });
  it("lerp(0, 100, 0.18) = 18", () => assert.equal(lerp(0, 100, 0.18), 18));
});
