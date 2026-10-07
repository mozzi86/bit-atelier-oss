// Openings (windows / doors) at the boundary of one room zone — Phase 43 (MOEBEL-03).
//
// Why: furniture is placed relative to the door; until now the room card (MoebelDraufsicht)
// showed the bare polygon. This module is pure geometry (no React), so it is unit-tested
// under Node and shared by the room card and — if needed — other room-centred views.
//
// In:  zone { points:[{x,z}], level } plus the plan context of usePlanModel:
//      walls (hull walls of createBuildingModel: a, b, level, edge, thickness),
//      envOpenings (placed hull openings: level, edge, u, kind, typeId),
//      entranceCfg (ENTRANCE_DEFAULT-shaped or null),
//      customWalls (drawn interior walls: a, b, level, _idx), customWindows (wallIdx → _idx, u, kind, typeId).
// Out: world segments in metres { kind: "window"|"door", a:{x,z}, b:{x,z}, width, quelle: "huelle"|"innen" }
//      whose midpoint lies within OEFFNUNG_TOLERANZ_M of one of the zone's edges.
//
// The hull's rule openings come from autoEnvOpenings — the ONE source for auto windows and
// the entrance door (KD-16); this module never re-implements that rule.

import { autoEnvOpenings } from "@designer/lib/autoOpenings";
import { openingTypeById } from "@core/lib/buildingModel";

/**
 * Max distance (m) between an opening's midpoint and the nearest zone edge to count as
 * "at this room". [ASSUMED] half hull wall thickness (0.15) + 0.30 slack for zones drawn
 * along the inner wall face or slightly off the reference line.
 */
export const OEFFNUNG_TOLERANZ_M = 0.45;

/**
 * Distance from point p to the segment a–b (XZ plane).
 * @param {{x:number,z:number}} p
 * @param {{x:number,z:number}} a
 * @param {{x:number,z:number}} b
 * @returns {number} metres
 */
export function abstandPunktStrecke(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/**
 * Smallest distance from p to any edge of a closed polygon.
 * @param {{x:number,z:number}} p
 * @param {Array<{x:number,z:number}>} polygon zone points (closed implicitly)
 * @returns {number} metres; Infinity for a degenerate polygon
 */
export function abstandZuPolygonkante(p, polygon) {
  if (!polygon || polygon.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const d = abstandPunktStrecke(p, polygon[i], polygon[(i + 1) % polygon.length]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The opening's segment on wall a→b: centred at distance u (m) from a, total length width (m).
 * @param {{a:{x:number,z:number}, b:{x:number,z:number}}} w
 * @param {number} u metres along the wall from a
 * @param {number} width metres
 * @returns {{a:{x:number,z:number}, b:{x:number,z:number}}}
 */
export function segmentAufWand(w, u, width) {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
  const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
  const cx = w.a.x + dx * u, cz = w.a.z + dz * u;
  const hw = (width || 0) / 2;
  return { a: { x: cx - dx * hw, z: cz - dz * hw }, b: { x: cx + dx * hw, z: cz + dz * hw } };
}

const mitte = (s) => ({ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 });

/**
 * All openings at the boundary of a zone (hull rule openings, placed hull openings, openings
 * on drawn interior walls), as world segments. Only the zone's level is considered.
 * @param {{points:Array<{x:number,z:number}>, level?:number}} zone
 * @param {{walls?:Array<object>, envOpenings?:Array<object>, entranceCfg?:object|null, customWalls?:Array<object>, customWindows?:Array<object>}} [ctx]
 * @param {number} [toleranzM=OEFFNUNG_TOLERANZ_M] metres
 * @returns {Array<{kind:string, a:{x:number,z:number}, b:{x:number,z:number}, width:number, quelle:string}>}
 */
export function oeffnungenAmRaum(zone, ctx = {}, toleranzM = OEFFNUNG_TOLERANZ_M) {
  const poly = zone?.points;
  if (!poly || poly.length < 3) return [];
  const level = zone.level ?? 0;
  const walls = (ctx.walls || []).filter((w) => w.level === level);
  const wandZuKante = (edge) => walls.find((w) => w.edge === edge);
  const out = [];

  // Hull: placed openings first (with their real width, so autoEnvOpenings can drop the
  // auto window that would sit in the same spot — the same de-duplication as in 3D/IFC).
  const platziert = (ctx.envOpenings || [])
    .filter((o) => o.level === level)
    .map((o) => ({ ...o, width: openingTypeById(o.kind, o.typeId).w }));
  for (const o of platziert) {
    const w = wandZuKante(o.edge);
    if (!w) continue;
    out.push({ kind: o.kind, width: o.width, quelle: "huelle", ...segmentAufWand(w, o.u, o.width) });
  }
  const regel = autoEnvOpenings(walls, { entrance: ctx.entranceCfg || undefined }, platziert);
  for (const o of regel) {
    if (o.level !== level) continue;
    const w = wandZuKante(o.edge);
    if (!w) continue;
    out.push({ kind: o.kind, width: o.width, quelle: "huelle", ...segmentAufWand(w, o.u, o.width) });
  }

  // Interior: openings placed on drawn walls (BitBimStudio customWindows → wallIdx = wall._idx).
  const innenWaende = (ctx.customWalls || []).filter((w) => w.level === level);
  for (const cw of ctx.customWindows || []) {
    const w = innenWaende.find((x) => x._idx === cw.wallIdx);
    if (!w) continue;
    const width = openingTypeById(cw.kind, cw.typeId).w;
    out.push({ kind: cw.kind, width, quelle: "innen", ...segmentAufWand(w, cw.u, width) });
  }

  return out.filter((s) => abstandZuPolygonkante(mitte(s), poly) <= toleranzM);
}
