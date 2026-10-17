// Planning-law study checks shared by the Massing-Studio (one free body) and the site plan
// (many blocks, phase 95-06): setback strips (Abstandsflächen) per facade, polygon overlap, GRZ/GFZ.
// Extracted from MassingStudio.jsx (KD-05 / 72-01 A-4 logic) so both editors compute the same
// thing — no second rule set.
//
// All coordinates in site metres ({x, y}), areas in m², heights in m. Pure module, no DOM.
// Everything here is a STUDY, not a legal proof (LBO setbacks depend on the state, the facade
// type and privileges like the 16-m rule — none of that is modelled).

/**
 * Point in polygon (ray casting).
 * @param {{x: number, y: number}} p point, m
 * @param {Array<{x: number, y: number}>} poly polygon, m
 * @returns {boolean}
 */
export function punktInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Polygon area (shoelace).
 * @param {Array<{x: number, y: number}>} poly polygon, m
 * @returns {number} m²
 */
export function polyFlaeche(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; a += poly[i].x * q.y - q.x * poly[i].y; }
  return Math.abs(a) / 2;
}

/**
 * Setback depth T = max(factor × H, minimum).
 * [ASSUMED] defaults 0.4 H / 3 m = BayBO Art. 6 (5) — other states use other factors; the
 * Massing-Studio exposes both as sliders.
 * @param {number} hoehe wall height H, m
 * @param {{faktor?: number, min?: number}} [opt] factor (−), minimum depth (m)
 * @returns {number} m
 */
export function abstandsTiefe(hoehe, { faktor = 0.4, min = 3 } = {}) {
  return Math.max(min, faktor * hoehe);
}

/**
 * Setback strip per facade: the rectangle in front of each edge, depth T, pointing outward
 * (outside detected by point-in-polygon, robust for concave shapes).
 *
 * `conflict` = a strip corner lies outside the boundary. Approximation: on strongly concave
 * parcels an edge can cross the boundary with all corners inside — hence study only.
 * Without a boundary `conflict` is null ("not checkable") — callers must never show a green "ok"
 * then (KD-05).
 * @param {Array<{x: number, y: number}>} poly footprint, m
 * @param {number} hoehe height H, m
 * @param {{faktor?: number, min?: number, grenze?: Array<{x: number, y: number}>|null}} [opt]
 * @returns {Array<{pts: Array<{x: number, y: number}>, conflict: boolean|null, depth: number}>}
 */
export function abstandsStreifen(poly, hoehe, { faktor = 0.4, min = 3, grenze = null } = {}) {
  const T = abstandsTiefe(hoehe, { faktor, min });
  const bekannt = Array.isArray(grenze) && grenze.length >= 3;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len; // normal candidate
    if (punktInPoly({ x: (a.x + b.x) / 2 + nx * 0.2, y: (a.y + b.y) / 2 + ny * 0.2 }, poly)) { nx = -nx; ny = -ny; }
    const pts = [a, b, { x: b.x + nx * T, y: b.y + ny * T }, { x: a.x + nx * T, y: a.y + ny * T }];
    const conflict = bekannt ? pts.some((p) => !punktInPoly(p, /** @type {any[]} */ (grenze))) : null;
    return { pts, conflict, depth: T };
  });
}

/**
 * Do two CONVEX polygons overlap with positive area? Separating axis test — exact for
 * rectangles and setback strips; touching edges (gap ≥ −eps) do not count.
 * @param {Array<{x: number, y: number}>} a convex polygon, m
 * @param {Array<{x: number, y: number}>} b convex polygon, m
 * @param {number} [eps] tolerance, m
 * @returns {boolean}
 */
export function konvexUeberlappen(a, b, eps = 1e-6) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q.y - p.y), ay = q.x - p.x;
      const len = Math.hypot(ax, ay);
      if (len < 1e-12) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const s = (v.x * ax + v.y * ay) / len; minA = Math.min(minA, s); maxA = Math.max(maxA, s); }
      for (const v of b) { const s = (v.x * ax + v.y * ay) / len; minB = Math.min(minB, s); maxB = Math.max(maxB, s); }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}

/**
 * GRZ / GFZ (BauNVO §§ 19, 20) from footprint and gross floor area on the plot area.
 * Reference values 0.4 / 1.2 [ASSUMED] = BauNVO § 17 upper limits for WA — the Massing-Studio
 * shows the same thresholds.
 * @param {number} grundflaeche footprint, m²
 * @param {number} bgf gross floor area, m²
 * @param {number} grundstueck plot area, m²
 * @returns {{grz: number, gfz: number, grzUeber: boolean, gfzHoch: boolean}}
 */
export function dichte(grundflaeche, bgf, grundstueck) {
  const grz = grundstueck > 0 ? grundflaeche / grundstueck : 0;
  const gfz = grundstueck > 0 ? bgf / grundstueck : 0;
  return { grz, gfz, grzUeber: grz > 0.4, gfzHoch: gfz > 1.2 };
}
