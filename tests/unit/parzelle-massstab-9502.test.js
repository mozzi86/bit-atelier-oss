// 95-02: the estimated (generic) parcel has its own scale (edge / 800 px). The map drew it with the
// fixed 1.25 m per unit — ~18× too large. With the record's m_per_px the map width equals the edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintToGeoJson, canvasPointToLngLat, lngLatToCanvasPoint, geoJsonToFootprint } from "@designer/lib/maplibreStyles";
import { buildSiteParcel, generischeParzellenMasse } from "@designer/lib/siteParcel";
import { areasToGeoJson } from "@designer/lib/mapDraw";

const LAT = 49.45, LNG = 11.08, M_PER_DEG_LAT = 111320;
const breiteM = (fc, lat) => {
  const ring = fc.features[0].geometry.coordinates[0];
  const lngs = ring.map((p) => p[0]);
  return (Math.max(...lngs) - Math.min(...lngs)) * M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
};

test("geschätzte Parzelle: Kartenbreite = Kantenlänge (mit m_per_px), ohne war sie ~18× zu groß", () => {
  const p = buildSiteParcel(null, LAT, LNG, null);
  const { kanteM } = generischeParzellenMasse(null);
  assert.equal(p.assumed, true);
  const mit = breiteM(footprintToGeoJson(p.points, LAT, LNG, p.m_per_px), LAT);
  assert.ok(Math.abs(mit - kanteM) / kanteM < 0.01, `${mit} m statt ${kanteM} m`);
  const ohne = breiteM(footprintToGeoJson(p.points, LAT, LNG), LAT);
  assert.ok(ohne / kanteM > 5, "der alte Weg zeichnete sie vielfach zu groß");
});

test("gezeichnete Parzelle unverändert (Standard 1,25 m), Hin- und Rückweg mit Maßstab verlustfrei", () => {
  const pt = { x: 700, y: 550 };
  assert.deepEqual(canvasPointToLngLat(pt, LAT, LNG), canvasPointToLngLat(pt, LAT, LNG, 1.25));
  const zurueck = lngLatToCanvasPoint(canvasPointToLngLat(pt, LAT, LNG, 0.07), LAT, LNG, 0.07);
  assert.ok(Math.abs(zurueck.x - 700) < 1e-6 && Math.abs(zurueck.y - 550) < 1e-6);
  const ring = [[11.08, 49.45], [11.081, 49.45], [11.081, 49.451]];
  const a = geoJsonToFootprint(ring, LAT, LNG, 0.5), b = geoJsonToFootprint(ring, LAT, LNG);
  assert.ok(Math.abs((a[1].x - a[0].x) / (b[1].x - b[0].x) - 2.5) < 1e-6, "halber Maßstab = 2,5-fache Canvas-Länge");
  const fc = areasToGeoJson([{ id: "a", points: [{ x: 500, y: 500 }, { x: 700, y: 500 }, { x: 700, y: 600 }] }], LAT, LNG, 0.1);
  assert.ok(Math.abs(breiteM(fc, LAT) - 20) < 0.2, "Baufeld 200 px × 0,1 m = 20 m");
});
