import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { footprintToGeoJson, geoJsonToFootprint } from "@designer/lib/maplibreStyles";

const nah = (ist, soll, eps = 1e-6) => assert.ok(Math.abs(ist - soll) < eps, `${ist} ≠ ${soll}`);

describe("maplibreStyles — Geo-Transformationen (Phase 36)", () => {
  it("geoJsonToFootprint ist die Inverse von footprintToGeoJson (Roundtrip)", () => {
    const punkte = [
      { x: 200, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 200, y: 800 },
    ];
    const lat = 49.4521;
    const lng = 11.0767;
    const fc = footprintToGeoJson(punkte, lat, lng);
    const ring = fc.features[0].geometry.coordinates[0]; // geschlossen (5 Einträge)
    assert.equal(ring.length, 5);

    const zurueck = geoJsonToFootprint(ring, lat, lng);
    assert.equal(zurueck.length, 4, "geschlossener Ring wird geöffnet");
    punkte.forEach((p, i) => {
      nah(zurueck[i].x, p.x, 1e-6);
      nah(zurueck[i].y, p.y, 1e-6);
    });
  });

  it("geoJsonToFootprint: offener Ring bleibt punktgleich, Randfälle liefern null", () => {
    const offen = [
      [11.0767, 49.4521],
      [11.0787, 49.4521],
      [11.0777, 49.4541],
    ];
    const px = geoJsonToFootprint(offen, 49.4521, 11.0767);
    assert.equal(px.length, 3);
    nah(px[0].x, 600); // Zentrum → Canvas-Mitte
    nah(px[0].y, 400);
    assert.equal(geoJsonToFootprint(null, 49, 11), null);
    assert.equal(geoJsonToFootprint([[11, 49], [11.1, 49]], 49, 11), null, "unter 3 Punkten kein Polygon");
  });
});
