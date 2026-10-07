// Style-Registry + Geo-Helfer für den MapLibre-Standort-Tab (Phase 29).
// Self-contained: keine "@/"-Imports, kein maplibre-Import — nur Daten + pure
// Funktionen, damit node-Smoke-Tests ohne Bundler laufen.
// Alle Quellen sind keyfrei (CLAUDE.md-Constraint: kostenlose APIs).
// AWS-Terrain-Quelle: [ASSUMED A1] — Tile-URL wird beim Einbau per curl verifiziert.

// Canvas-Koordinatensystem aus ComplexDesigner.handleLocationUpdate:
// 800×800-Canvas um Mittelpunkt (600, 400); 1000 m ≙ 800 Einheiten → 1.25 m/Einheit.
// Exportiert, damit siteParcel.js/SiteDesigner dieselbe Konvention nutzen statt
// eigene 600/400-Kopien zu pflegen.
export const CANVAS_CENTER_X = 600;
export const CANVAS_CENTER_Y = 400;
const M_PER_UNIT = 1.25;
const M_PER_LAT = 111320;

// Not-Fallback, falls selbst der OSM-Raster-Fallback scheitert.
export const DEMOTILES_URL = "https://demotiles.maplibre.org/style.json";

// Inline-Raster-Style-Fallback (kein separates Style-JSON-Fetch nötig).
export const OSM_RASTER_FALLBACK = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

const ESRI_SATELLITE_STYLE = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri World Imagery",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

// Registry: "normal" → OpenFreeMap Liberty (Vektor, keyfrei), "satellite" → Esri-Raster.
const STYLES = {
  normal: "https://tiles.openfreemap.org/styles/liberty",
  satellite: ESRI_SATELLITE_STYLE,
};

/** Liefert den Map-Style für einen Registry-Key; unbekannt/undefined → "normal". */
export function resolveStyle(styleKey) {
  return STYLES[styleKey] || STYLES.normal;
}

// raster-dem-Quelle für Terrain + Hillshade ([ASSUMED A1], siehe Kopfkommentar).
export const TERRAIN_SOURCE = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Terrain: Mapzen/AWS Open Data",
};

const EMPTY_FC = () => ({ type: "FeatureCollection", features: [] });

/**
 * Einzelner Canvas-Punkt ({x,y}, 1,25 m/Einheit um 600/400) → [lng, lat] um den
 * Standort (centerLat, centerLng). Punkt-Basis für footprintToGeoJson — und für
 * KARTE-03-Konsumenten (Höhenpunkte, Baukörper), die keine Ringe haben.
 */
export function canvasPointToLngLat(p, centerLat, centerLng) {
  const lat = Number(centerLat) || 0;
  const lng = Number(centerLng) || 0;
  const mPerLon = M_PER_LAT * Math.cos((lat * Math.PI) / 180) || 1;
  const xM = ((Number(p?.x) || 0) - CANVAS_CENTER_X) * M_PER_UNIT;
  const yM = ((Number(p?.y) || 0) - CANVAS_CENTER_Y) * M_PER_UNIT;
  return [lng + xM / mPerLon, lat - yM / M_PER_LAT];
}

/** INVERSE zu canvasPointToLngLat: [lng, lat] → Canvas-Punkt {x, y}. */
export function lngLatToCanvasPoint(lngLat, centerLat, centerLng) {
  const lat = Number(centerLat) || 0;
  const lng = Number(centerLng) || 0;
  const mPerLon = M_PER_LAT * Math.cos((lat * Math.PI) / 180) || 1;
  return {
    x: CANVAS_CENTER_X + ((Number(lngLat?.[0]) - lng) * mPerLon) / M_PER_UNIT,
    y: CANVAS_CENTER_Y - ((Number(lngLat?.[1]) - lat) * M_PER_LAT) / M_PER_UNIT,
  };
}

/**
 * Canvas-Footprint (site_parcel/designated_areas, {x,y}-Punkte) → GeoJSON-Polygon
 * in [lon, lat] um den Standort (centerLat, centerLng). Ring wird geschlossen.
 * null/leer/<3 Punkte → leere FeatureCollection.
 */
export function footprintToGeoJson(points, centerLat, centerLng) {
  if (!Array.isArray(points) || points.length < 3) return EMPTY_FC();
  const ring = points.map((p) => canvasPointToLngLat(p, centerLat, centerLng));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

/**
 * INVERSE zu footprintToGeoJson (Phase 36, Fundament für KARTE-03):
 * [lng,lat]-Ring → Canvas-Footprint-Punkte ({x,y}, 1,25 m/Einheit um 600/400).
 * Ein geschlossener Ring (letzter = erster Punkt) wird geöffnet. Damit können
 * auf der echten MapLibre-Karte gezeichnete Parzellen/Baufelder verlustarm in
 * das bestehende Canvas-Px-Format der designated_areas/site_parcel übernommen
 * werden — alle Bestandskonsumenten (footprintToMeters, polygonAreaM2,
 * BitBimStudio) arbeiten unverändert weiter.
 */
export function geoJsonToFootprint(ringLngLat, centerLat, centerLng) {
  if (!Array.isArray(ringLngLat) || ringLngLat.length < 3) return null;
  let ring = ringLngLat;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 3 && first[0] === last[0] && first[1] === last[1]) ring = ring.slice(0, -1);
  return ring.map((ll) => lngLatToCanvasPoint(ll, centerLat, centerLng));
}

/**
 * Rohe OSM-Gebäude ({coords:[{lat,lon}], height?, levels?}) → GeoJSON-FeatureCollection
 * für fill-extrusion. properties.height = height bzw. levels×3, Default 9 m.
 * Koordinaten-Reihenfolge GeoJSON: [lon, lat]! Gebäude mit <3 coords werden gefiltert.
 */
export function osmBuildingsToGeoJson(rawBuildings) {
  if (!Array.isArray(rawBuildings)) return EMPTY_FC();
  const features = [];
  for (const b of rawBuildings) {
    if (!Array.isArray(b?.coords) || b.coords.length < 3) continue;
    const ring = b.coords.map((c) => [Number(c?.lon) || 0, Number(c?.lat) || 0]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    features.push({
      type: "Feature",
      properties: {
        // OSM-levels ist Freitext ("3;4", "many") — nur endliche positive Zahlen nutzen,
        // sonst Default 9 m (nie NaN als fill-extrusion-height, ME-07).
        height: (() => {
          const h = Number(b.height) || 0;
          if (h > 0) return h;
          const lv = Number(b.levels);
          return Number.isFinite(lv) && lv > 0 ? lv * 3 : 9;
        })(),
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}
