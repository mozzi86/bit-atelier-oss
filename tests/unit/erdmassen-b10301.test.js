// Unit tests for B-103-01: earthworks sample the terrain at the footprint's REAL place and with the
// DEM's row 0 = SOUTH (gelaendeStudie footprintAmOrt, erdmassen, mittlereHoeheUnter). Before, a plot
// south of the project location on a south-facing slope read the higher northern terrain at the location.
// Style: node:test, German descriptions, hand calculation in the comment.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { demRaster, footprintAmOrt, erdmassen, mittlereHoeheUnter } from "@designer/lib/gelaendeStudie";
import { footprintToMeters } from "@core/lib/buildingModel";

// 3×3 grid over 200 m, row 0 = south: south row 100 m, middle 110 m, north row 120 m (slope falls to the south).
const R = demRaster([[100, 100, 100], [110, 110, 110], [120, 120, 120]], 200);
const PARCEL = { m_per_px: 1 }; // 1 m per canvas px

/** Square footprint of 10 × 10 px around a canvas centre (cx, cy). */
function flaeche(cx, cy) {
  return { type: "footprint", points: [{ x: cx - 5, y: cy - 5 }, { x: cx + 5, y: cy - 5 }, { x: cx + 5, y: cy + 5 }, { x: cx - 5, y: cy + 5 }] };
}

describe("B-103-01 Erdmassen an der echten Lage", () => {
  it("Footprint 50 m südlich des Standorts (Canvas y 450) liegt bei z = +50 m", () => {
    const area = flaeche(600, 450);
    const fp = footprintToMeters(area.points, PARCEL);
    const { poly, amOrt } = footprintAmOrt(fp, { designated_areas: [area], site_parcel: PARCEL });
    assert.equal(amOrt, true);
    const zMitte = poly.reduce((s, p) => s + p.z, 0) / poly.length;
    assert.ok(Math.abs(zMitte - 50) < 1e-9, `z-Mitte ${zMitte}`);
  });

  it("Hang nach Süden: südlicher Footprint ist tiefer als nördlicher (Hand: z=+50 → 105 m, z=−50 → 115 m)", () => {
    // halbM = 100, zelleM = 100: z = +50 → row index (100 − 50)/100 = 0.5 → 105 m; z = −50 → 1.5 → 115 m.
    const sued = flaeche(600, 450), nord = flaeche(600, 350);
    const lage = (a) => footprintAmOrt(footprintToMeters(a.points, PARCEL), { designated_areas: [a], site_parcel: PARCEL }).poly;
    assert.equal(mittlereHoeheUnter(R, lage(sued)), 105);
    assert.equal(mittlereHoeheUnter(R, lage(nord)), 115);
  });

  it("Planum 110 m: südlicher 10×10-Footprint (Gelände 105 m) braucht ~500 m³ Auftrag, keinen Abtrag", () => {
    // Area 100 m² × 5 m depth = 500 m³ fill.
    const a = flaeche(600, 450);
    const poly = footprintAmOrt(footprintToMeters(a.points, PARCEL), { designated_areas: [a], site_parcel: PARCEL }).poly;
    const e = erdmassen(R, 110, poly);
    assert.equal(e.cut, 0);
    assert.equal(e.area, 100);
    assert.equal(e.fill, 500);
    assert.equal(e.net, 500);
  });

  it("ohne gezeichneten Footprint bleibt das Polygon am Standort und meldet amOrt = false", () => {
    const fp = [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: -5, z: 5 }];
    const r = footprintAmOrt(fp, { designated_areas: [] });
    assert.equal(r.amOrt, false);
    assert.deepEqual(r.poly, fp);
    assert.equal(mittlereHoeheUnter(R, r.poly), 110);
  });

  it("ohne Raster oder Footprint: Nullwerte statt Wurf", () => {
    assert.deepEqual(erdmassen(null, 100, null), { cut: 0, fill: 0, net: 0, area: 0 });
    assert.equal(mittlereHoeheUnter(R, null), null);
    assert.deepEqual(footprintAmOrt(null, {}), { poly: null, amOrt: false });
  });
});
