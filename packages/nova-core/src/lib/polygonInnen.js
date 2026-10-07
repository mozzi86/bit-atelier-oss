// Pure containment/intersection geometry for the three site levels of the
// Massing studio (75-06, MS-06): Grundstueck (plot) > Baufeld (building
// envelope) > Baukoerper (massing body). Framework-free, node-testable, no
// imports from @designer — points are {x, y} in METRES like in MassingStudio.
//
// In:  polygons as [{x, y}] (metres, screen-y down), single points {x, y}.
// Out: booleans (inside/convex), intersection points, clipped polygons,
//      areas in m2, edge data {i, laengeM, winkelGrad}.
//
// Area convention: Shoelace on metre coordinates directly — @core/lib/geo's
// polygonAreaM2 converts PIXEL areas with a parcel scale and does not fit
// here (KD-01, the scale-factor bug, was born exactly at that seam).
import { pointInPolygon } from "./geo.js";

/** Numerical tolerance for "on the edge" / degeneracy tests, metres. */
const EPS = 1e-9;

/**
 * Polygon area in m2 via the Shoelace formula (absolute value; orientation of
 * the input ring does not matter). Hand-checked in the unit tests.
 * @param {{x:number,y:number}[]} poly polygon in metres
 * @returns {number} area in m2 (0 for fewer than 3 points)
 */
export function flaecheM2(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Distance of point p to the segment a-b, in metres.
 * @param {{x:number,y:number}} p probe point (m)
 * @param {{x:number,y:number}} a segment start (m)
 * @param {{x:number,y:number}} b segment end (m)
 * @returns {number} shortest distance in m
 */
function abstandZuSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  // Projection parameter of p on the infinite line, clamped to the segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Is point p inside polygon poly? Thin wrapper around geo.pointInPolygon
 * (ray casting, signature (points, x, y)) PLUS an explicit edge test: a point
 * closer than EPS to any edge counts as inside. Why: a massing body standing
 * EXACTLY on the envelope border would otherwise hatch itself red (ray casting
 * flips on the boundary), which reads as a violation where there is none.
 * @param {{x:number,y:number}[]} poly polygon in metres
 * @param {{x:number,y:number}} p probe point in metres
 * @returns {boolean} true when p is inside or on the boundary
 */
export function punktInnen(poly, p) {
  if (!Array.isArray(poly) || poly.length < 3 || !p) return false;
  if (pointInPolygon(poly, p.x, p.y)) return true;
  for (let i = 0; i < poly.length; i += 1) {
    if (abstandZuSegment(p, poly[i], poly[(i + 1) % poly.length]) < EPS) return true;
  }
  return false;
}

/**
 * All edge crossings of polygon a with polygon b (segment-segment, both
 * parameter sets in [0,1]; parallel/collinear pairs yield no hit).
 * @param {{x:number,y:number}[]} a polygon in metres
 * @param {{x:number,y:number}[]} b polygon in metres
 * @returns {Array<{x:number,y:number,i:number,j:number}>} crossing points
 *   (metres) with the edge indices i (in a) and j (in b)
 */
export function kantenSchnitte(a, b) {
  const out = [];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return out;
  for (let i = 0; i < a.length; i += 1) {
    const p1 = a[i];
    const p2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const q1 = b[j];
      const q2 = b[(j + 1) % b.length];
      const rx = p2.x - p1.x;
      const ry = p2.y - p1.y;
      const sx = q2.x - q1.x;
      const sy = q2.y - q1.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < EPS) continue; // parallel (or degenerate)
      const dx = q1.x - p1.x;
      const dy = q1.y - p1.y;
      const t = (dx * sy - dy * sx) / den; // along a-edge
      const u = (dx * ry - dy * rx) / den; // along b-edge
      if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
      out.push({ x: p1.x + t * rx, y: p1.y + t * ry, i, j });
    }
  }
  return out;
}

/**
 * Is the polygon convex? All consecutive cross products share the same sign
 * (collinear points allowed, tolerance EPS).
 * @param {{x:number,y:number}[]} poly polygon in metres
 * @returns {boolean} true for convex rings (fewer than 4 points: trivially true)
 */
export function istKonvex(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let positiv = false;
  let negativ = false;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const kreuz = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (kreuz > EPS) positiv = true;
    else if (kreuz < -EPS) negativ = true;
    if (positiv && negativ) return false;
  }
  return true;
}

/**
 * Sutherland-Hodgman polygon clipping: the part of `subjekt` inside `fenster`.
 * [ASSUMED] LIMIT: only valid for a CONVEX window polygon — for a concave
 * envelope the result is an approximation (the algorithm assumes every
 * window edge splits the plane into in/out exactly once). The proven way out
 * is a real polygon-boolean library (polygon-clipping / martinez), which is a
 * NEW DEPENDENCY and therefore needs explicit approval (CLAUDE.md).
 * @param {{x:number,y:number}[]} subjekt subject polygon (metres)
 * @param {{x:number,y:number}[]} fenster CONVEX clipping window (metres)
 * @returns {{x:number,y:number}[]} clipped polygon (metres; [] when fully outside)
 */
export function clipSutherlandHodgman(subjekt, fenster) {
  if (!Array.isArray(subjekt) || subjekt.length < 3) return [];
  if (!Array.isArray(fenster) || fenster.length < 3) return [];
  // Window orientation: work on a ring whose signed area is positive so the
  // "inside = left of the directed edge" test below is unambiguous.
  let ring = fenster;
  let sig = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sig += a.x * b.y - b.x * a.y;
  }
  if (sig < 0) ring = [...ring].reverse();
  const inside = (p, a, b) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPS;
  const intersect = (p, q, a, b) => {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const px = q.x - p.x;
    const py = q.y - p.y;
    const den = rx * py - ry * px;
    if (Math.abs(den) < EPS) return { x: p.x, y: p.y };
    const t = ((p.x - a.x) * py - (p.y - a.y) * px) / den;
    return { x: a.x + t * rx, y: a.y + t * ry };
  };
  let out = [...subjekt];
  for (let e = 0; e < ring.length && out.length; e += 1) {
    const a = ring[e];
    const b = ring[(e + 1) % ring.length];
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const p = input[i];
      const q = input[(i + 1) % input.length];
      const pIn = inside(p, a, b);
      const qIn = inside(q, a, b);
      if (pIn) out.push(p);
      if (pIn !== qIn) out.push(intersect(p, q, a, b));
    }
  }
  return out;
}

/**
 * Part of a massing body (koerper) lying OUTSIDE the envelope (baufeld).
 * Convex envelope: m2 = area(body) - area(clip(body, envelope)), clamped to 0
 * (rounding noise), plus the border crossings for the marker dots.
 * Non-convex envelope: m2 = null (honest "not computable" — Sutherland-Hodgman
 * would fabricate a number), hatAnteilAusserhalb from BOTH the corner test and
 * the edge crossings: a body can pierce a concave envelope without any corner
 * lying outside — exactly why the crossing test is mandatory here.
 * @param {{x:number,y:number}[]} koerper massing body polygon (metres)
 * @param {{x:number,y:number}[]} baufeld building envelope polygon (metres)
 * @returns {{m2:number|null, hatAnteilAusserhalb:boolean, punkte:Array<{x:number,y:number,i:number,j:number}>}}
 *   outside area in m2 (null = not computable), whether any part is outside,
 *   and the border crossing points (metres)
 */
export function flaecheAusserhalb(koerper, baufeld) {
  const empty = { m2: 0, hatAnteilAusserhalb: false, punkte: [] };
  if (!Array.isArray(koerper) || koerper.length < 3) return empty;
  if (!Array.isArray(baufeld) || baufeld.length < 3) return { ...empty, m2: null };
  const punkte = kantenSchnitte(koerper, baufeld);
  if (!istKonvex(baufeld)) {
    // No trustworthy difference area for concave windows ([ASSUMED] limit of
    // the approximation) — report the FACT of a violation, never a number.
    const eckeDraussen = koerper.some((p) => !punktInnen(baufeld, p));
    return { m2: null, hatAnteilAusserhalb: eckeDraussen || punkte.length > 0, punkte };
  }
  const aussen = flaecheM2(koerper) - flaecheM2(clipSutherlandHodgman(koerper, baufeld));
  const m2 = Math.max(0, aussen);
  // Convex: the AREA difference is authoritative. A body edge lying exactly on
  // an envelope edge (corner/edge graze) produces border points with zero area
  // difference — that is NOT a violation ("edge = inside", see punktInnen), so
  // the flag follows m2 alone, not the crossing count.
  return { m2, hatAnteilAusserhalb: m2 > EPS, punkte };
}

/**
 * Convex hull of a point list (Andrew's monotone chain). Used as the
 * APPROXIMATION of the union of several cadastral parcels (Flurstuecke).
 * [ASSUMED]: a true polygon union needs boolean operations (new dependency,
 * see clipSutherlandHodgman) — for a concave parcel arrangement the hull
 * covers MORE area than the union; the UI labels the derived parcel as
 * assumed:true so the number is never presented as measured truth.
 * @param {Array<{x:number,y:number}>} punkte point list in metres
 * @returns {{x:number,y:number}[]} hull polygon (counter-clockwise in
 *   screen-y-down terms; [] for fewer than 3 distinct points)
 */
export function konvexeHuelle(punkte) {
  const pts = (Array.isArray(punkte) ? punkte : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return [];
  const sorted = [...pts].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const kreuz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list) => {
    const hull = [];
    for (const p of list) {
      while (hull.length >= 2 && kreuz(hull[hull.length - 2], hull[hull.length - 1], p) <= EPS) hull.pop();
      hull.push(p);
    }
    return hull;
  };
  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  // Drop the last point of each chain (it is the first of the other).
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? hull : [];
}

/**
 * Longest edge of a polygon: index, length and its angle against +x,
 * normalised to [0, 180) degrees (direction-agnostic — an edge has no
 * orientation). Basis of the "Raster: Grundstueck" chip (75-06 Task 6): the
 * grid aligns with this angle WITHOUT rotating any geometry (user drawing
 * rule: rotation is display-only).
 * @param {{x:number,y:number}[]} poly polygon in metres
 * @returns {{i:number, laengeM:number, winkelGrad:number}|null} edge data, or
 *   null for a degenerate polygon (< 2 points)
 */
export function laengsteKante(poly) {
  if (!Array.isArray(poly) || poly.length < 2) return null;
  let best = null;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const laengeM = Math.hypot(dx, dy);
    if (best === null || laengeM > best.laengeM) {
      // atan2 in degrees, folded into [0, 180): opposite directions describe
      // the same grid line.
      let winkelGrad = (Math.atan2(dy, dx) * 180) / Math.PI;
      winkelGrad = ((winkelGrad % 180) + 180) % 180;
      best = { i, laengeM, winkelGrad };
    }
  }
  return best;
}
