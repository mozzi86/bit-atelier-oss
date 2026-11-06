// 108-02 (D-EFH-01): clear height under a roof of plane faces — the area of a floor polygon over which every roof plane lies at least
// h m above the floor. Moved unchanged from @designer/lib/dachschraegenAnteile.js (107-11), where it was a private helper of the WoFlV
// partial areas, so that the full-storey rule in @core (vollgeschoss.js) can use the SAME computation (the package boundary forbids
// @core to import @designer). dachschraegenAnteile.js imports it from here; its results are unchanged.
//
// Method: the roof surface is the minimum of its planes, so "height ≥ h" is the intersection of one half-plane per face, cut from the
// floor polygon with the convex primitive inKonvex (formGeometrie.js). Exact for every plane roof form (flat, gable, hip, shed).
//
// In:  floor polygon {x, z} in m, roof planes (dachGeometrie.dachEbenen), clear height in m, floor height in m (same height frame as
//      the roof). Out: area in m².

import { flaeche, inKonvex } from "../formGeometrie.js";

const EPS = 1e-9;

/**
 * @typedef {{x: number, z: number}} P
 * @typedef {{punkt: {x: number, y: number, z: number}, normale: {x: number, y: number, z: number}}} DachEbene
 */

/**
 * Part of a floor polygon where every roof plane lies at least `h_m` above the floor, m².
 * @param {P[]} raum floor polygon, m
 * @param {DachEbene[]} ebenen roof planes (upward normals)
 * @param {number} h_m clear height in m above the floor
 * @param {number} boden_m floor height in m (roof frame)
 * @returns {number} m²
 */
export function flaecheAbHoehe(raum, ebenen, h_m, boden_m) {
  /** @type {Array<{nx: number, nz: number, c: number}>} */
  const halbebenen = [];
  for (const e of ebenen) {
    const n = e.normale, p = e.punkt;
    if (n.y <= EPS) continue;
    // plane height y(x, z) = p.y − (n.x (x − p.x) + n.z (z − p.z)) / n.y ≥ boden + h  ⇔  n.x x + n.z z ≤ n.y (p.y − boden − h) + n.x p.x + n.z p.z
    const c = n.y * (p.y - boden_m - h_m) + n.x * p.x + n.z * p.z;
    if (Math.abs(n.x) < EPS && Math.abs(n.z) < EPS) {
      if (c < -EPS) return 0; // a level face below the limit: nowhere high enough
      continue; // a level face above the limit: no restriction
    }
    halbebenen.push({ nx: n.x, nz: n.z, c });
  }
  return inKonvex(raum, halbebenen).reduce((s, t) => s + flaeche(t), 0);
}
