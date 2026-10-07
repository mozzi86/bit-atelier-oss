// Unit-Tests für packages/nova-designer/src/lib/flurstueckImport.js
// (75-06 Task 2, D-P75-04): GeoJSON ohne Abhängigkeit, kaputte Dateien →
// Klartext-Warnung statt Wurf. Referenzpunkt wie das Testprojekt Nürnberg
// (lat 49.45, lng 11.08); Canvas-Px-Umrechnung prüft geoJsonToFootprint.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GRENZEN, flurstueckeAusGeoJson } from "@designer/lib/flurstueckImport";

const LAT = 49.45;
const LNG = 11.08;

/** Closed GeoJSON ring around the reference point (~±0.001° ≈ ±70/110 m). */
const RING = [
  [LNG - 0.001, LAT - 0.001],
  [LNG + 0.001, LAT - 0.001],
  [LNG + 0.001, LAT + 0.001],
  [LNG - 0.001, LAT + 0.001],
  [LNG - 0.001, LAT - 0.001],
];

const fc = (features) => JSON.stringify({ type: "FeatureCollection", features });
const feature = (props, ring = RING) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [ring] },
});

describe("flurstueckeAusGeoJson", () => {
  it("EIN Feature/Polygon → 1 Flurstück mit nummer/gemarkung aus properties", () => {
    const res = flurstueckeAusGeoJson(fc([feature({ flurstueck: "1234/5", gemarkung: "Nürnberg" })]), LAT, LNG);
    assert.equal(res.flurstuecke.length, 1);
    assert.equal(res.flurstuecke[0].nummer, "1234/5");
    assert.equal(res.flurstuecke[0].gemarkung, "Nürnberg");
    // Ring opened: 4 canvas points, rounded px.
    assert.equal(res.flurstuecke[0].polygon.length, 4);
    assert.ok(res.flurstuecke[0].polygon.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)));
  });

  it("FeatureCollection mit 3 Polygonen → 3 Flurstücke, Reihenfolge stabil", () => {
    const props = [{ nummer: "A" }, { nummer: "B" }, { nummer: "C" }];
    const res = flurstueckeAusGeoJson(fc(props.map((p) => feature(p))), LAT, LNG);
    assert.equal(res.flurstuecke.length, 3);
    assert.deepEqual(res.flurstuecke.map((f) => f.nummer), ["A", "B", "C"]);
  });

  it("MultiPolygon → je Ring ein Flurstück + Warnung „zerlegt”", () => {
    const mp = {
      type: "Feature",
      properties: { flurstueck: "99" },
      geometry: { type: "MultiPolygon", coordinates: [[RING], [RING.map((ll) => [ll[0] + 0.01, ll[1]])]] },
    };
    const res = flurstueckeAusGeoJson(fc([mp]), LAT, LNG);
    assert.equal(res.flurstuecke.length, 2);
    assert.ok(res.warnungen.some((w) => w.includes("MultiPolygon")));
  });

  it("fehlende properties → nummer „Flurstück 1”, gemarkung leer (kein Raten) + keine stille Leere", () => {
    const res = flurstueckeAusGeoJson(fc([feature({})]), LAT, LNG);
    assert.equal(res.flurstuecke[0].nummer, "Flurstück 1");
    assert.equal(res.flurstuecke[0].gemarkung, "");
  });

  it("kaputtes JSON → Warnung im Klartext, kein Wurf, leere Liste", () => {
    const res = flurstueckeAusGeoJson("{not json", LAT, LNG);
    assert.deepEqual(res.flurstuecke, []);
    assert.ok(res.warnungen.length >= 1);
    // Kein Feature / leerer Text ebenfalls abgefangen:
    assert.deepEqual(flurstueckeAusGeoJson(fc([]), LAT, LNG).flurstuecke, []);
    assert.ok(flurstueckeAusGeoJson("", LAT, LNG).warnungen.length >= 1);
  });

  it("Datei > GRENZEN.maxBytes → abgelehnt mit Klartext", () => {
    // Cheap oversized payload: valid JSON structure, but the text itself is
    // longer than the limit — the guard runs BEFORE JSON.parse.
    const huge = `{"type":"FeatureCollection","features":[],"pad":"${"x".repeat(GRENZEN.maxBytes)}"}`;
    const res = flurstueckeAusGeoJson(huge, LAT, LNG);
    assert.deepEqual(res.flurstuecke, []);
    assert.ok(res.warnungen.some((w) => w.includes("zu groß")));
  });

  it("Koordinaten außerhalb ±180/±90 → abgelehnt (lat/lng vertauscht)", () => {
    // Swapped axes: "lat" 11.08 is fine as lng, but 49.45 in position 0 with
    // 400 in position 1 breaks the ±90 latitude bound.
    const bad = [[LNG, 400], [LNG + 1, 400], [LNG + 1, 401], [LNG, 400]];
    const res = flurstueckeAusGeoJson(fc([feature({}, bad)]), LAT, LNG);
    assert.deepEqual(res.flurstuecke, []);
    assert.ok(res.warnungen.some((w) => w.includes("vertauscht")));
  });

  it("Ring < 3 Punkte → Warnung, kein Flurstück", () => {
    const mini = [[LNG, LAT], [LNG + 0.001, LAT]];
    const res = flurstueckeAusGeoJson(fc([feature({}, mini)]), LAT, LNG);
    assert.deepEqual(res.flurstuecke, []);
    assert.ok(res.warnungen.some((w) => w.includes("weniger als 3 Punkte")));
  });

  it("Lochfläche → verworfen MIT Warnung (stille Übernahme wäre eine falsche Fläche)", () => {
    const hole = [[LNG - 0.0005, LAT - 0.0005], [LNG + 0.0005, LAT - 0.0005], [LNG + 0.0005, LAT + 0.0005], [LNG - 0.0005, LAT + 0.0005], [LNG - 0.0005, LAT - 0.0005]];
    const poly = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [RING, hole] },
    };
    const res = flurstueckeAusGeoJson(fc([poly]), LAT, LNG);
    assert.equal(res.flurstuecke.length, 1);
    assert.ok(res.warnungen.some((w) => w.includes("Lochfläche")));
  });

  it("nackte Polygon-Geometrie (ohne Feature-Hülle) wird akzeptiert", () => {
    const res = flurstueckeAusGeoJson(JSON.stringify({ type: "Polygon", coordinates: [RING] }), LAT, LNG);
    assert.equal(res.flurstuecke.length, 1);
  });
});
