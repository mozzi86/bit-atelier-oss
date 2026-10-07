// Snap chain for edge dragging (Phase 75-03, MS-03).
//
// Order of targets [ASSUMED] (Loesungskatalog Blatt 03): phi -> parcel
// boundary -> setback depth -> 0.5 m grid. The first function that returns a
// number wins; Alt bypasses everything. Boundary snaps cast a ray along the
// edge normal against the parcel polygon - no polygon-boolean library.
//
// In:  displacement d along the edge normal (m), edge geometry (m), parcel
//      polygon (m), setback depth (m).
// Out: snapped displacement (m) and the name of the winning target.
// Pure module, no DOM, node-testable.

/** Default snap capture distance for boundary/setback targets, m [ASSUMED]. */
export const FANG_M = 0.3;

/**
 * Round to a grid.
 * @param {number} d value in m
 * @param {number} [raster] grid size in m (default 0.5)
 * @returns {number} m
 */
export function rasterSnap(d, raster = 0.5) {
  if (!Number.isFinite(d)) return 0;
  return Math.round(d / raster) * raster;
}

/**
 * Ray (origin o, direction r, both m) against segment a-b. Returns the ray
 * parameter t (m along r) or null when there is no hit with t > -1e-9.
 * @param {{x:number,y:number}} o ray origin
 * @param {{x:number,y:number}} r ray direction (unit)
 * @param {{x:number,y:number}} a segment start
 * @param {{x:number,y:number}} b segment end
 * @returns {number|null} distance along the ray in m
 */
export function strahlTrifftSegment(o, r, a, b) {
  const sx = b.x - a.x, sy = b.y - a.y;
  const den = r.x * sy - r.y * sx;
  if (Math.abs(den) < 1e-12) return null; // parallel
  const qx = a.x - o.x, qy = a.y - o.y;
  const t = (qx * sy - qy * sx) / den; // along ray
  const u = (qx * r.y - qy * r.x) / den; // along segment
  if (u < -1e-9 || u > 1 + 1e-9 || t < -1e-9) return null;
  return t;
}

/**
 * Nearest boundary hit along +-normal from the edge midpoint.
 * @param {{x:number,y:number}} mitte edge midpoint in m
 * @param {{nx:number,ny:number}} n outward unit normal
 * @param {{x:number,y:number}[]} grenze boundary polygon in m
 * @returns {number|null} signed distance in m (positive = outward) to the nearest boundary segment
 */
export function abstandZurGrenze(mitte, n, grenze) {
  if (!Array.isArray(grenze) || grenze.length < 3) return null;
  let best = null;
  const dirs = [{ x: n.nx, y: n.ny, s: 1 }, { x: -n.nx, y: -n.ny, s: -1 }];
  for (const dir of dirs) {
    for (let i = 0; i < grenze.length; i += 1) {
      const t = strahlTrifftSegment(mitte, dir, grenze[i], grenze[(i + 1) % grenze.length]);
      if (t !== null && (best === null || t < Math.abs(best))) best = t * dir.s;
    }
  }
  return best;
}

/**
 * Snap the moved edge onto the parcel boundary when it ends up within `fang`.
 * @param {{x:number,y:number}} mitte edge midpoint in m (before the move)
 * @param {{nx:number,ny:number}} n outward unit normal
 * @param {number} d requested displacement in m
 * @param {{x:number,y:number}[]} grenze boundary polygon in m
 * @param {number} [fang] capture distance in m
 * @returns {number|null} displacement that puts the edge exactly on the boundary, or null
 */
export function grenzSnap(mitte, n, d, grenze, fang = FANG_M) {
  const g = abstandZurGrenze(mitte, n, grenze);
  if (g === null) return null;
  return Math.abs(g - d) <= fang ? Math.round(g * 100) / 100 : null;
}

/**
 * Snap so the setback strip of depth `tiefe` touches the boundary exactly.
 * @param {{x:number,y:number}} mitte edge midpoint in m
 * @param {{nx:number,ny:number}} n outward unit normal
 * @param {number} d requested displacement in m
 * @param {{x:number,y:number}[]} grenze boundary polygon in m
 * @param {number} tiefe setback depth in m
 * @param {number} [fang] capture distance in m
 * @returns {number|null}
 */
export function abstandSnap(mitte, n, d, grenze, tiefe, fang = FANG_M) {
  const g = abstandZurGrenze(mitte, n, grenze);
  if (g === null || !Number.isFinite(tiefe)) return null;
  const ziel = g - tiefe;
  return Math.abs(ziel - d) <= fang ? Math.round(ziel * 100) / 100 : null;
}

/**
 * Runs the snap chain: the first target returning a number wins.
 * @param {number} dRoh requested displacement in m
 * @param {Array<((d:number)=>number|null) & {zielName?: string}>} ziele ordered targets
 * @param {{alt?: boolean}} [opt] alt = bypass all targets
 * @returns {{d:number, ziel:string|null}} snapped displacement in m and winning target name
 */
export function snapKette(dRoh, ziele, { alt = false } = {}) {
  if (alt || !Array.isArray(ziele)) return { d: dRoh, ziel: null };
  for (let i = 0; i < ziele.length; i += 1) {
    const fn = ziele[i];
    const v = typeof fn === "function" ? fn(dRoh) : null;
    if (Number.isFinite(v)) return { d: v, ziel: fn.zielName || String(i) };
  }
  return { d: dRoh, ziel: null };
}
