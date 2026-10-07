// Room facade segments on the REAL polygon (75-11 Task 1, MSB-13).
//
// A facade segment is the piece of an envelope wall (model.walls, one wall per
// footprint edge) that belongs to ONE room zone. autoOpenings distributed
// windows every ~3.5 m along a wall regardless of the room slicing, so
// partitions cut through windows (user finding 21.09., Fokusansicht WE 0-3).
// Deriving the windows from these segments fixes that at the geometry level.
//
// In:  a room zone ({ points: [{x,z}], level, fensterpflicht, … } from
//      tesselierung.js raumzonen mode) and the envelope walls
//      ({ a:{x,z}, b:{x,z}, level, edge } from createBuildingModel).
// Out: segments in wall coordinates — u in metres along a→b, exactly the
//      convention of autoOpenings.js/raumklima.js (a sign error there would
//      be invisible and mirror every window).
// Pure module: no React, no import from tesselierung.js (that lib stays
// import-free and untouched in this plan), node-testable.

/**
 * Tolerance in metres between a zone edge and the wall axis.
 * [ASSUMED] Zones are CLEAR dimensions (lichte Maße, D-P75-06: wall
 * thicknesses are display-only) while envelope walls sit on the footprint
 * polygon: an outer wall of 36.5 cm leaves up to ~0.18 m offset. 0.35 m
 * covers that plus rounding. Provable path: use model.envThickness per wall
 * as soon as it exists per wall (today it is one model-wide value).
 */
export const FASSADE_TOL = 0.35;

/**
 * Project a point onto a wall segment.
 * @param {{x:number,z:number}} p point in metres (world/zone coordinates)
 * @param {{a:{x:number,z:number}, b:{x:number,z:number}}} wand wall (metres)
 * @param {number} [tol] tolerance in metres (default FASSADE_TOL)
 * @returns {number|null} u = distance in metres along a→b when the point is
 *   within tol of the wall LINE and the projection falls in [−tol, len+tol]
 *   (clamped to [0, len]); null when the point does not belong to this wall
 */
export function aufSegment(p, wand, tol = FASSADE_TOL) {
  if (!p || !wand?.a || !wand?.b) return null;
  const dx = wand.b.x - wand.a.x;
  const dz = wand.b.z - wand.a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null; // degenerate wall
  // u = projection along the wall direction, d = perpendicular distance.
  const u = ((p.x - wand.a.x) * dx + (p.z - wand.a.z) * dz) / len;
  const d = Math.abs((p.x - wand.a.x) * dz - (p.z - wand.a.z) * dx) / len;
  if (d >= tol) return null;
  if (u < -tol || u > len + tol) return null;
  return Math.max(0, Math.min(len, u));
}

/**
 * Facade segments of ONE room zone against the envelope walls.
 * A zone edge belongs to a wall when BOTH endpoints project onto the SAME
 * wall of the SAME level (aufSegment). Segments shorter than opt.minLaenge
 * are dropped — a regular window does not fit there (see
 * FENSTER_JE_RAUM.minBreite 0.6 m + randAbstand 0.5 m ⇒ 1.6 m absolute
 * minimum for the rule width; 0.9 m still carries a narrowed 0.6 m window
 * at reduced edge distance, hence the softer default).
 * Result sorted by laengeM DESC so the caller gets "the room's main facade"
 * without sorting itself.
 *
 * @param {{points?: Array<{x:number,z:number}>, level?: number}} zone room zone
 *   (points are clear dimensions in metres; tesselierung raumzonen format)
 * @param {Array<{a:{x:number,z:number}, b:{x:number,z:number}, level?: number, edge?: number}>} waende
 *   envelope walls of the model (one per footprint edge, metres)
 * @param {{minLaenge?: number, tol?: number}} [opt] minLaenge in metres
 *   (default 0.9), tol in metres (default FASSADE_TOL)
 * @returns {Array<{level:number, edge:number, u0:number, u1:number, laengeM:number}>}
 *   segments in wall coordinates (u0 < u1, both within [0, wallLength])
 */
export function fassadenAbschnitte(zone, waende, opt = {}) {
  const minLaenge = Number.isFinite(opt?.minLaenge) ? opt.minLaenge : 0.9;
  const tol = Number.isFinite(opt?.tol) ? opt.tol : FASSADE_TOL;
  const pts = Array.isArray(zone?.points) ? zone.points : [];
  if (pts.length < 3 || !Array.isArray(waende) || !waende.length) return [];
  const zLevel = Math.round(Number(zone?.level) || 0);
  const out = [];
  // Zone edges, closed ring (points pairwise).
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (!p || !q) continue;
    for (const w of waende) {
      if (Math.round(Number(w?.level) || 0) !== zLevel) continue; // same storey only
      const uA = aufSegment(p, w, tol);
      if (uA === null) continue;
      const uB = aufSegment(q, w, tol);
      if (uB === null) continue;
      const u0 = Math.min(uA, uB);
      const u1 = Math.max(uA, uB);
      const laengeM = u1 - u0;
      if (laengeM < minLaenge) continue; // no rule window fits (see JSDoc)
      out.push({
        level: zLevel,
        edge: Number.isFinite(w?.edge) ? w.edge : -1,
        u0,
        u1,
        laengeM,
      });
      break; // one edge belongs to at most one wall
    }
  }
  return out.sort((a, b) => b.laengeM - a.laengeM);
}
