// Parzellen-Fabrik für ComplexDesigner.handleLocationUpdate (Phase 36, KARTE-04a).
// Pure Funktion (Node-testbar): entscheidet zwischen echter, auf der Karte
// gezeichneter Parzelle und dem generischen Startquadrat.
// 72-01 A-2 (Befund N-02): das generische Quadrat ist kein 1-km²-Werkzeugwert
// mehr — es leitet seine Kantenlänge aus der Gebäudefläche des Projekts ab.

import { SITE_EDGE_PX, DEFAULT_METERS_PER_PIXEL } from "@core/lib/geo";
import {
  geoJsonToFootprint,
  canvasPointToLngLat,
  lngLatToCanvasPoint,
  CANVAS_CENTER_X,
  CANVAS_CENTER_Y,
} from "@designer/lib/maplibreStyles";

// --- A-2 (72-01): Richtwerte der generischen Parzelle ------------------------
// [ASSUMED] Faktor 3: Parzellenfläche = Gebäudefläche × 3 — Platzreserve für
// Außenanlagen/Baugrube/Stellplätze als grober Richtwert ohne Normbezug
// (Review §3 A-2, 18.09.2026). Einheit: m² Parzelle je m² Gebäudefläche.
export const PARZELLEN_FAKTOR = 3;
// [ASSUMED] Klammer für die geschätzte Parzellenfläche in m² (Review §3 A-2:
// min. 400 m², max. 20.000 m²) — schützt vor Unsinn bei Extremeingaben.
export const PARZELLEN_FLAECHE_MIN_M2 = 400;
export const PARZELLEN_FLAECHE_MAX_M2 = 20000;
// [ASSUMED] Gebäudefläche in m², wenn das Projekt keine hat (1.000 m² ≈
// kleines Mehrfamilienhaus) → 3.000 m² Parzelle. Ersetzt den alten festen
// 1.000 × 1.000-m-Werkzeugwert (Befund N-02).
export const GEBAEUDEFLAECHE_FALLBACK_M2 = 1000;

/**
 * Kantenlänge und Fläche des generischen Startquadrats aus dem Projekt.
 * @param {{ building_area?: number } | null} [projekt] Projektdatensatz;
 *   `building_area` in m² (Brutto-Gebäudefläche laut Projektakte)
 * @returns {{ kanteM: number, flaecheM2: number }} Kantenlänge in m (Quadrat),
 *   Fläche in m² — auf PARZELLEN_FLAECHE_MIN/MAX_M2 geclamt
 */
export function generischeParzellenMasse(projekt) {
  const bf = Number(projekt?.building_area);
  const gebaeudeM2 = Number.isFinite(bf) && bf > 0 ? bf : GEBAEUDEFLAECHE_FALLBACK_M2;
  const flaecheM2 = Math.min(
    PARZELLEN_FLAECHE_MAX_M2,
    Math.max(PARZELLEN_FLAECHE_MIN_M2, gebaeudeM2 * PARZELLEN_FAKTOR),
  );
  return { kanteM: Math.sqrt(flaecheM2), flaecheM2 };
}

// --- A-3 (72-01): Baukörper-Standard in METERN statt Canvas-Pixeln -----------
// [ASSUMED] Fußabdruck 20 × 15 m für alle Typen (Review §3 A-3); Geschosse je
// Projekttyp: Gewerbe 4, Wohnen 3, Öffentlich 2 — Richtwerte ohne Normbezug,
// Einheit: Geschosse (Vollgeschosse). Fallback Wohnen bei unbekanntem Typ.
const GESCHOSSE_JE_TYP = { commercial: 4, residential: 3, institutional: 2 };
export const BAUKOERPER_BREITE_M = 20; // [ASSUMED] m
export const BAUKOERPER_TIEFE_M = 15;  // [ASSUMED] m

/**
 * Standardmaß eines per Klick gesetzten Baukörpers.
 * @param {string} [projektTyp] Project.type-Key (z. B. "commercial")
 * @returns {{ breiteM: number, tiefeM: number, geschosse: number }} Maße in m,
 *   Geschosszahl (einheitenlos)
 */
export function baukoerperDefaults(projektTyp) {
  return {
    breiteM: BAUKOERPER_BREITE_M,
    tiefeM: BAUKOERPER_TIEFE_M,
    geschosse: GESCHOSSE_JE_TYP[projektTyp] ?? 3,
  };
}

/**
 * Baut das site_parcel-Objekt für einen Standort.
 *
 * @param {Array<[number,number]>|null} parcelRingLngLat — auf der Karte
 *   gezeichneter Parzellen-Ring ([lng,lat], offen oder geschlossen); null/kurz
 *   → generisches Startquadrat.
 * @param {number} lat / @param {number} lng — Standort (Zentrum der Konvention).
 * @param {{ building_area?: number } | null} [projekt] — Projektdatensatz für
 *   das generische Quadrat (72-01 A-2): Gebäudefläche in m² × 3 [ASSUMED],
 *   geclamt auf 400…20.000 m². Ohne Projekt: 1.000-m²-Annahme (3.000 m²).
 *
 * Echte Parzelle: assumed:false, source:"gezeichnet" und EXPLIZITER Maßstab
 * m_per_px (1,25) — metersPerPixel leitet den Maßstab sonst aus der Bbox-Breite
 * ab und unterstellt 1000 m Kantenlänge, was nur fürs generische Quadrat galt.
 * Punkte werden wie im Bestand (SiteDesigner.closeDraft) auf ganze Canvas-Px
 * gerundet (1 px ≙ 1,25 m).
 *
 * Generisches Quadrat (72-01 A-2): trägt JETZT ebenfalls ein explizites
 * m_per_px — die Canvas-Kante bleibt SITE_EDGE_PX (800 px), aber der Maßstab
 * kommt aus der Projektableitung, damit Fläche, GRZ/GFZ und Baukörper-Meter
 * echte Größen sind (vorher: feste 1000 m Kante = 1.000.000 m², Befund N-02).
 */
export function buildSiteParcel(parcelRingLngLat, lat, lng, projekt = null) {
  const drawn = Array.isArray(parcelRingLngLat) && parcelRingLngLat.length >= 3
    ? geoJsonToFootprint(parcelRingLngLat, lat, lng)
    : null;
  if (drawn && drawn.length >= 3) {
    return {
      id: "site_parcel_main",
      type: "site_boundary",
      assumed: false,
      source: "gezeichnet",
      m_per_px: DEFAULT_METERS_PER_PIXEL,
      points: drawn.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    };
  }
  // KEINE Katasterfläche — Startquadrat aus der Gebäudefläche des Projekts
  // (72-01 A-2). `assumed` macht das für die Panels sichtbar; der Hinweis
  // „geschätzt — echte Parzelle zeichnen" steht im SiteDesigner-Panel.
  const { kanteM, flaecheM2 } = generischeParzellenMasse(projekt);
  return {
    id: "site_parcel_main",
    type: "site_boundary",
    assumed: true,
    source: "generisch",
    // Canvas-Kante = SITE_EDGE_PX; Maßstab so, dass die Fläche flaecheM2 ergibt.
    m_per_px: kanteM / SITE_EDGE_PX,
    geschaetzte_flaeche_m2: flaecheM2,
    points: [
      { x: CANVAS_CENTER_X - SITE_EDGE_PX / 2, y: CANVAS_CENTER_Y - SITE_EDGE_PX / 2 },
      { x: CANVAS_CENTER_X + SITE_EDGE_PX / 2, y: CANVAS_CENTER_Y - SITE_EDGE_PX / 2 },
      { x: CANVAS_CENTER_X + SITE_EDGE_PX / 2, y: CANVAS_CENTER_Y + SITE_EDGE_PX / 2 },
      { x: CANVAS_CENTER_X - SITE_EDGE_PX / 2, y: CANVAS_CENTER_Y + SITE_EDGE_PX / 2 },
    ],
  };
}

/** Bbox {minX, minY, maxX, maxY} über Parzellen-Punkte (für Topo-Streuung u.a.). */
export function parcelBbox(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const xs = points.map((p) => Number(p?.x) || 0);
  const ys = points.map((p) => Number(p?.y) || 0);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Überlappen zwei Bboxen (inkl. Randberührung)? null/undefined → false. */
export function bboxIntersects(a, b) {
  if (!a || !b) return false;
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * Canvas-Punkte vom alten aufs neue Standort-Zentrum umankern (Review-Fix
 * 36-02): Zeichnungen sind GEOGRAFISCH fixiert — Canvas-Px sind nur relativ
 * zum jeweiligen location-Zentrum. Punkt → LngLat (altes Zentrum) → Canvas
 * (neues Zentrum), gerundet. null bei unbrauchbaren Eingaben.
 */
export function reanchorPoints(points, oldLoc, newLoc) {
  if (!Array.isArray(points) || !points.length) return null;
  const oLat = Number(oldLoc?.lat);
  const oLng = Number(oldLoc?.lng);
  const nLat = Number(newLoc?.lat);
  const nLng = Number(newLoc?.lng);
  if (![oLat, oLng, nLat, nLng].every(Number.isFinite)) return null;
  return points.map((p) => {
    const moved = lngLatToCanvasPoint(canvasPointToLngLat(p, oLat, oLng), nLat, nLng);
    return { x: Math.round(moved.x), y: Math.round(moved.y) };
  });
}

// Außer-Reichweite-Grenze fürs Umankern: liegt die Parzellen-Mitte weiter als
// 5.000 px (= 6,25 km) neben dem neuen Zentrum, hat sie keinen sinnvollen
// Bezug mehr zum Projektstandort → zurück zum generischen Quadrat.
const REANCHOR_MAX_PX = 5000;

/**
 * Gezeichnete Parzelle bei Standortwechsel mitnehmen statt still durch das
 * generische Quadrat zu ersetzen (Review-Befund: minimale lat/lng-Änderung
 * zerstörte die Nutzer-Zeichnung). Liefert die umgeankerte Parzelle oder
 * null, wenn sie außer Reichweite liegt / Eingaben unbrauchbar sind.
 */
export function reanchorParcel(parcel, oldLoc, newLoc) {
  const pts = parcel?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const moved = reanchorPoints(pts, oldLoc, newLoc);
  if (!moved) return null;
  const bb = parcelBbox(moved);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  if (Math.hypot(cx - CANVAS_CENTER_X, cy - CANVAS_CENTER_Y) > REANCHOR_MAX_PX) return null;
  return { ...parcel, points: moved };
}
