// Pure GeoJSON-Builder für das Karten-Zeichnen im SiteDesigner (Phase 36,
// KARTE-03). Kein maplibre-Import — wie maplibreStyles.js Node-testbar.
// Alle Builder nehmen die Canvas-Px-Bestandsformate (designated_areas,
// buildings, elevation_points) und projizieren sie um den Standort (lat/lng).

import { footprintToGeoJson, canvasPointToLngLat } from "@designer/lib/maplibreStyles";

const EMPTY_FC = () => ({ type: "FeatureCollection", features: [] });

/** Baufeld-Polygone (designated_areas) → FC, ein Polygon-Feature je Fläche. */
export function areasToGeoJson(areas, centerLat, centerLng) {
  const features = [];
  for (const a of areas || []) {
    const fc = footprintToGeoJson(a?.points, centerLat, centerLng);
    const f = fc.features[0];
    if (f) features.push({ ...f, properties: { id: a.id } });
  }
  return { type: "FeatureCollection", features };
}

/** Baukörper ({x,y,width,height,floors}-Rechtecke) → FC mit floors-Label. */
export function buildingsToGeoJson(buildings, centerLat, centerLng) {
  const features = [];
  for (const b of buildings || []) {
    const w = Number(b?.width) || 0;
    const h = Number(b?.height) || 0;
    if (w <= 0 || h <= 0) continue;
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + w, y: b.y },
      { x: b.x + w, y: b.y + h },
      { x: b.x, y: b.y + h },
    ];
    const fc = footprintToGeoJson(corners, centerLat, centerLng);
    const f = fc.features[0];
    if (f) features.push({ ...f, properties: { id: b.id, floors: b.floors || 1 } });
  }
  return { type: "FeatureCollection", features };
}

/** Höhen-Demopunkte → Punkt-FC mit vorberechneter Farbe (circle-color: get). */
export function elevationToGeoJson(points, centerLat, centerLng) {
  const features = (points || [])
    .filter((e) => Number.isFinite(Number(e?.x)) && Number.isFinite(Number(e?.y)))
    .map((e) => ({
      type: "Feature",
      properties: {
        // 72-01 A-12 (Befund N-21): elevation nie als null in die properties —
        // Ausdrücke/Tooltips, die die Zahl lesen, brachen sonst mit
        // „Expected value to be of type number, but found null".
        elevation: Number.isFinite(Number(e?.elevation)) ? Number(e.elevation) : 0,
        color: elevColor(Number(e?.elevation) || 0),
      },
      geometry: { type: "Point", coordinates: canvasPointToLngLat(e, centerLat, centerLng) },
    }));
  return { type: "FeatureCollection", features };
}

/** Offener Zeichen-Draft ([lng,lat]-Liste) → LineString-FC (<2 Punkte: leer). */
export function draftToGeoJson(draftLngLat) {
  if (!Array.isArray(draftLngLat) || draftLngLat.length < 2) return EMPTY_FC();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: draftLngLat.map((p) => [p[0], p[1]]) },
      },
    ],
  };
}

/** Höhenfarbe (aus dem SVG-Lageplan übernommen): −10 m blau → +10 m rot. */
export function elevColor(e) {
  const t = Math.max(0, Math.min(1, (e + 10) / 20));
  const r = Math.round(255 * t);
  const g = Math.round(180 * (1 - Math.abs(t - 0.5) * 2));
  const b = Math.round(255 * (1 - t));
  return `rgb(${r},${g},${b})`;
}

/** [[minLng,minLat],[maxLng,maxLat]] für map.fitBounds; null bei <1 Punkt. */
export function ringBounds(ringLngLat) {
  if (!Array.isArray(ringLngLat) || !ringLngLat.length) return null;
  const lngs = ringLngLat.map((p) => Number(p?.[0]) || 0);
  const lats = ringLngLat.map((p) => Number(p?.[1]) || 0);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
