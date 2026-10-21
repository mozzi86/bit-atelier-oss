// Polygon editing helpers for outlines drawn on the site plan (phase 101-02b, user 18.10.2026: "mit Kante
// draggen, Punkt hinzufügen und Punkt bewegen"): move a corner, insert a corner on an edge, delete a corner,
// move a whole edge parallel to itself. Pure, unit-agnostic (works in canvas units or metres), no DOM.
//
// In:  closed polygon as [{x, y}] (last point NOT repeated). Out: a new array; the input is never mutated.

/**
 * Move corner i to p.
 * @param {Array<{x:number,y:number}>} pts
 * @param {number} i corner index
 * @param {{x:number,y:number}} p new position
 */
export function eckeVerschieben(pts, i, p) {
  return pts.map((q, k) => (k === i ? { x: p.x, y: p.y } : q));
}

/**
 * Insert a corner after corner i (on edge i → i+1); default position = edge midpoint.
 * @param {Array<{x:number,y:number}>} pts
 * @param {number} i edge index (corner i to corner i+1)
 * @param {{x:number,y:number}} [p] position of the new corner
 */
export function eckeEinfuegen(pts, i, p) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const neu = p ? { x: p.x, y: p.y } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [...pts.slice(0, i + 1), neu, ...pts.slice(i + 1)];
}

/**
 * Delete corner i — a polygon keeps at least three corners (else unchanged).
 * @param {Array<{x:number,y:number}>} pts
 * @param {number} i corner index
 */
export function eckeLoeschen(pts, i) {
  return pts.length <= 3 ? pts : pts.filter((_, k) => k !== i);
}

/**
 * Move edge i (corner i → i+1) parallel to itself by the part of `delta` perpendicular to the edge.
 * @param {Array<{x:number,y:number}>} pts
 * @param {number} i edge index
 * @param {{x:number,y:number}} delta pointer movement
 */
export function kanteVerschieben(pts, i, delta) {
  const j = (i + 1) % pts.length;
  const a = pts[i], b = pts[j];
  const lx = b.x - a.x, ly = b.y - a.y, len = Math.hypot(lx, ly);
  if (len < 1e-9) return pts;
  const nx = -ly / len, ny = lx / len;
  const d = delta.x * nx + delta.y * ny;
  return pts.map((q, k) => (k === i || k === j ? { x: q.x + nx * d, y: q.y + ny * d } : q));
}

/**
 * Midpoints of all edges (positions of the "+" handles).
 * @param {Array<{x:number,y:number}>} pts
 * @returns {Array<{x:number,y:number}>}
 */
export function kantenMitten(pts) {
  return pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; });
}
