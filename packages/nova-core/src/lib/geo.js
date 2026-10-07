// Reine Geometrie-Helfer für den SiteDesigner (keine React-Abhängigkeit).
// Polygon-Punkte sind {x, y} im Parzellen-/Canvas-Koordinatensystem (Pixel).

// Shoelace-Formel → Fläche in Pixel².
export function polygonAreaPx(points) {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// --- Maßstab: EINE Konvention für den gesamten Komplex-Designer -----------------
// Die generierte Parzelle ist SITE_EDGE_PX Pixel breit und repräsentiert
// SITE_EDGE_METERS Meter Kantenlänge ⇒ DEFAULT_METERS_PER_PIXEL = 1000/800 = 1,25 m/px.
// Flächen werden mit dem QUADRAT dieses Faktors umgerechnet (1,25² = 1,5625).
// Wer hier hartcodierte 0.0625 / 1.25 / 1.5625 sieht: das ist ein Bug — immer
// pxToM / mToPx / pxAreaToM2 benutzen.
export const SITE_EDGE_METERS = 1000;
export const SITE_EDGE_PX = 800;
export const DEFAULT_METERS_PER_PIXEL = SITE_EDGE_METERS / SITE_EDGE_PX; // 1,25 m/px

// Meter-pro-Pixel aus der bekannten Parzelle ableiten.
// Ohne (brauchbare) Parzelle gilt die Default-Konvention 1,25 m/px — NICHT 1.
// KARTE-04a: eine ECHTE (gezeichnete) Parzelle spannt nicht mehr 1000 m auf —
// sie trägt ihren Maßstab explizit als `m_per_px` (1,25, siehe buildSiteParcel).
// Der hat Vorrang, sonst rechnete z. B. eine 60-m-Parzelle mit ~20,8 m/px.
export function metersPerPixel(parcel, siteEdgeMeters = SITE_EDGE_METERS) {
  const explicit = Number(parcel?.m_per_px);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const pts = parcel?.points;
  if (!pts || pts.length < 2) return DEFAULT_METERS_PER_PIXEL;
  const xs = pts.map((p) => p.x);
  const widthPx = Math.max(...xs) - Math.min(...xs);
  if (!widthPx) return DEFAULT_METERS_PER_PIXEL;
  return siteEdgeMeters / widthPx;
}

// Pixel-Länge → Meter.
export function pxToM(px, parcel, siteEdgeMeters = SITE_EDGE_METERS) {
  return (Number(px) || 0) * metersPerPixel(parcel, siteEdgeMeters);
}

// Meter-Länge → Pixel.
export function mToPx(m, parcel, siteEdgeMeters = SITE_EDGE_METERS) {
  const mpp = metersPerPixel(parcel, siteEdgeMeters);
  return mpp ? (Number(m) || 0) / mpp : 0;
}

// Pixel-FLÄCHE → m² (Quadrat des Maßstabsfaktors).
export function pxAreaToM2(areaPx, parcel, siteEdgeMeters = SITE_EDGE_METERS) {
  const mpp = metersPerPixel(parcel, siteEdgeMeters);
  return (Number(areaPx) || 0) * mpp * mpp;
}

// Alias aus Bestandscode — bitte pxToM verwenden.
export function pxToMeters(px, parcel, siteEdgeMeters = SITE_EDGE_METERS) {
  return pxToM(px, parcel, siteEdgeMeters);
}

// Polygon-Fläche in m² (gerundet).
export function polygonAreaM2(points, parcel, siteEdgeMeters = 1000) {
  const mpp = metersPerPixel(parcel, siteEdgeMeters);
  return Math.round(polygonAreaPx(points) * mpp * mpp);
}

// Punkt-im-Polygon (Ray-Casting). Für UI-Zwecke (Klick-Gating im Lageplan) —
// Kantenberührung braucht keine exakte Epsilon-Behandlung. Review-Fix 36-02:
// der reine Bbox-Test erlaubte bei gezeichneten (nicht-rechteckigen) Parzellen
// Punkte/Baukörper außerhalb des Grundstücks.
export function pointInPolygon(points, x, y) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i]?.x) || 0;
    const yi = Number(points[i]?.y) || 0;
    const xj = Number(points[j]?.x) || 0;
    const yj = Number(points[j]?.y) || 0;
    const schneidet =
      (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (schneidet) inside = !inside;
  }
  return inside;
}

// Schwerpunkt (für Label-Platzierung).
export function centroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / points.length, y: s.y / points.length };
}
