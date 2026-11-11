// 108-03 follow-up (user 08.11.2026, "there is only 1 truth"): the hull slab does not run to the outer face of the envelope — it ends at the
// insulation (a slab through the insulation would be a thermal bridge). ONE place derives that edge for the built model, so 3D, IFC,
// section and quantities read the same slab polygon from createBuildingModel.
//
// Rules:
//  - inset = sum of the insulation layers of the envelope build-up (layer name / schicht / material matching "Dämm" or "insul"); without a
//    build-up or without such a layer there is no inset (the slab reaches the outer face, as before 08.11.2026 — goldens unchanged).
//  - the outline is moved inwards at every vertex along the bisector of its two edge normals (miter); exact for rectangles and L-shapes.
//
// In:  build-up (skins with thickness in mm), slab outline in m. Out: daemmstaerke_m(), polygonEinruecken(), deckenUmriss().

/**
 * Thickness of the insulation layers of a build-up, m. [ASSUMED] recognised by name ("Dämmung", "Dämm…", "insul…") — the build-up table
 * carries no explicit "insulation" function yet (aufbauten.js: funktion kern/bekleidung/sonstig); way to a decided value: a layer function
 * "daemmung" in the build-up table.
 * @param {{skins?: Array<{name?: string, schicht?: string, material?: string, thickness?: number}>}|null|undefined} aufbau
 * @returns {number} m (0 without a build-up or insulation layer)
 */
export function daemmstaerke_m(aufbau) {
  return (aufbau?.skins || [])
    .filter((sk) => /d[äa]mm|insul/i.test(`${sk.name || ""} ${sk.schicht || ""} ${sk.material || ""}`))
    .reduce((a, sk) => a + (Number(sk.thickness) || 0) / 1000, 0);
}

/**
 * Polygon moved inwards by `d` m (each vertex along the bisector of its two edge normals, miter length d / cos(half angle), capped).
 * Degenerate input or d ≤ 0 is returned as is (same reference).
 * @param {Array<{x: number, z: number}>} pts outline in m
 * @param {number} d inset in m
 * @returns {Array<{x: number, z: number}>}
 */
export function polygonEinruecken(pts, d) {
  if (!Array.isArray(pts) || pts.length < 3 || !(d > 0)) return pts;
  const n = pts.length;
  let a2 = 0;
  for (let i = 0; i < n; i += 1) { const p = pts[i], q = pts[(i + 1) % n]; a2 += p.x * q.z - q.x * p.z; }
  const sgn = a2 >= 0 ? 1 : -1; // inward normal of edge (dx, dz) is sgn · (−dz, dx) for this winding
  return pts.map((p, i) => {
    const pr = pts[(i + n - 1) % n], nx = pts[(i + 1) % n];
    const e1 = { x: p.x - pr.x, z: p.z - pr.z }, e2 = { x: nx.x - p.x, z: nx.z - p.z };
    const l1 = Math.hypot(e1.x, e1.z) || 1, l2 = Math.hypot(e2.x, e2.z) || 1;
    const n1 = { x: (-e1.z / l1) * sgn, z: (e1.x / l1) * sgn }, n2 = { x: (-e2.z / l2) * sgn, z: (e2.x / l2) * sgn };
    const bx = n1.x + n2.x, bz = n1.z + n2.z, bl = Math.hypot(bx, bz);
    if (bl < 1e-9) return { x: p.x + n1.x * d, z: p.z + n1.z * d };
    const cos = (bx * n1.x + bz * n1.z) / bl;
    const k = d / Math.max(0.2, cos);
    const r = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
    return { x: r(p.x + (bx / bl) * k), z: r(p.z + (bz / bl) * k) };
  });
}

/**
 * Slab outline of the hull: the footprint inset by the insulation of the envelope build-up (see file head).
 * @param {Array<{x: number, z: number}>} footprint m
 * @param {{skins?: any[]}|null|undefined} aufbau envelope build-up (compositeById)
 * @returns {{polygon: Array<{x: number, z: number}>, einzug_m: number}}
 */
export function deckenUmriss(footprint, aufbau) {
  const einzug_m = daemmstaerke_m(aufbau);
  return { polygon: einzug_m > 0 ? polygonEinruecken(footprint, einzug_m) : footprint, einzug_m };
}
