// Edge geometry for polygon editors (Phase 75-03, MS-03).
//
// "Push/pull a side": an edge moves perpendicular to itself, both end points
// travel with it, the neighbouring edges keep their direction when they are
// perpendicular to the moved edge (rectangles). For skewed neighbours the
// neighbour direction is NOT preserved (that would need an intersection
// mode, deliberately not built here - see 75-03-SUMMARY).
//
// In:  polygons as [{x, y}] in metres (screen-y down, as in MassingStudio).
// Out: normals, lengths, angles, moved polygons - all in metres / degrees.
// Pure module, no DOM, node-testable.

import { pointInPolygon } from "./geo.js";

/**
 * Unit normal of edge i (poly[i] -> poly[i+1]) pointing OUTWARD.
 * Outward is decided by a probe point 0.2 m from the edge midpoint: if it lies
 * inside the polygon the candidate normal is flipped.
 * @param {{x:number,y:number}[]} poly polygon in m
 * @param {number} i edge index
 * @returns {{nx:number, ny:number}} unit normal (dimensionless)
 */
export function kantenNormale(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;
  const mx = (a.x + b.x) / 2 + nx * 0.2, my = (a.y + b.y) / 2 + ny * 0.2;
  if (pointInPolygon(poly, mx, my)) { nx = -nx; ny = -ny; }
  return { nx, ny };
}

/**
 * Component of a displacement along a normal.
 * @param {{x:number,y:number}} delta displacement in m
 * @param {{nx:number,ny:number}} n unit normal
 * @returns {number} signed distance in m (positive = outward)
 */
export function projektionAufNormale(delta, n) {
  return delta.x * n.nx + delta.y * n.ny;
}

/**
 * Moves edge i by d metres along its outward normal; both end points move,
 * all other points stay. Coordinates rounded to 0.01 m.
 * @param {{x:number,y:number}[]} poly polygon in m
 * @param {number} i edge index
 * @param {number} d signed distance in m (positive = outward)
 * @returns {{x:number,y:number}[]} new polygon
 */
export function verschiebeKante(poly, i, d) {
  const n = kantenNormale(poly, i);
  const j = (i + 1) % poly.length;
  const r = (v) => Math.round(v * 100) / 100;
  return poly.map((p, k) => (k === i || k === j ? { x: r(p.x + n.nx * d), y: r(p.y + n.ny * d) } : p));
}

/**
 * Length of edge i in metres.
 * @param {{x:number,y:number}[]} poly
 * @param {number} i
 * @returns {number} m
 */
export function kantenLaenge(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Angle of edge i in degrees within [0, 180) (an edge has no direction).
 * 0 = horizontal, 90 = vertical.
 * @param {{x:number,y:number}[]} poly
 * @param {number} i
 * @returns {number} degrees
 */
export function kantenWinkelGrad(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const w = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return ((w % 180) + 180) % 180;
}

/**
 * Compass label of an outward normal on a screen-y-down plan with north up:
 * N = normal points to -y, O = +x, S = +y, W = -x (90 deg sectors).
 * @param {{nx:number,ny:number}} n unit normal
 * @returns {"N"|"O"|"S"|"W"}
 */
export function himmelsrichtung(n) {
  if (Math.abs(n.nx) >= Math.abs(n.ny)) return n.nx >= 0 ? "O" : "W";
  return n.ny >= 0 ? "S" : "N";
}
