// 107-10 (review, D-BK-25): the FRAME of a roof outline — the one rule that says along which direction a roof falls and over which
// run its slope is measured. Until the review it lived inside dachGeometrie.js while hoehen.js measured the run on the axis-aligned
// bounding box: for a ridge "quer" or a rotated rectangle the faces got another slope than the inspector and the IFC data sheet
// showed. Now hoehen.js (the one slope ↔ rise derivation: dachLauf_m, dachFirsthoehe_m, dachNeigung_grad) and dachGeometrie.js
// (the faces) read the SAME frame from here. Pure, no imports (hoehen.js imports it, dachGeometrie.js imports hoehen.js).
//
// Rules (unchanged from dachGeometrie.js):
//  - A rectangle (4 corners, right angles) is used EXACTLY in its own frame, also when rotated; every other outline uses its
//    axis-aligned bounding box (the old builders' frame). An axis-aligned rectangle gives the same frame both ways.
//  - `firstrichtung` "laengs" (default) = ridge along the longest side of that frame, "quer" = across it. [ASSUMED] the default is
//    the old builders' rule (ridge along the longer bounding-box axis, a square takes the x axis); way to a decided value: the roof
//    studio of phase 47 / candidate 107-16 with the user.
//
// In: outline points {x, z} in m, ridge direction. Out: {mitte, u, v, halbL_m, halbB_m, quelle} — halbB_m is the run of a gable
// (half the extent across the ridge), m.

const EPS = 1e-9;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {object} DachRahmen
 * @property {PktXZ} mitte                  middle of the frame, m
 * @property {PktXZ} u                      unit vector along the ridge
 * @property {PktXZ} v                      unit vector across the ridge (the fall direction of the faces)
 * @property {number} halbL_m               half extent along u, m
 * @property {number} halbB_m               half extent along v, m (= the run of a gable; a shed roof runs over 2 · halbB_m)
 * @property {"rechteck"|"bbox"} quelle     exact rectangle or bounding box
 */

/**
 * Outline without invalid points and without a closing duplicate of the first point.
 * @param {PktXZ[]|undefined|null} profil outline in m
 * @returns {PktXZ[]}
 */
export function umrissBereinigt(profil) {
  const p = (Array.isArray(profil) ? profil : []).filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.z));
  if (p.length > 1 && Math.abs(p[0].x - p[p.length - 1].x) < EPS && Math.abs(p[0].z - p[p.length - 1].z) < EPS) p.pop();
  return p;
}

/**
 * Frame of a rectangle (4 corners with right angles), or null.
 * @param {PktXZ[]} p
 * @returns {{mitte: PktXZ, u: PktXZ, v: PktXZ, halbL_m: number, halbB_m: number}|null}
 */
function rechteckRahmen(p) {
  if (p.length !== 4) return null;
  const e = [0, 1, 2, 3].map((i) => ({ x: p[(i + 1) % 4].x - p[i].x, z: p[(i + 1) % 4].z - p[i].z }));
  const l = e.map((k) => Math.hypot(k.x, k.z));
  if (l.some((x) => x < EPS)) return null;
  for (let i = 0; i < 4; i += 1) {
    const a = e[i], b = e[(i + 1) % 4];
    if (Math.abs(a.x * b.x + a.z * b.z) > 1e-6 * l[i] * l[(i + 1) % 4]) return null;
  }
  // longest side leads; a tie takes the side closer to the x axis (the old builders: spanX >= spanZ → ridge along x)
  const lang = l[0] > l[1] + EPS || (Math.abs(l[0] - l[1]) <= EPS && Math.abs(e[0].x) >= Math.abs(e[1].x)) ? 0 : 1;
  const kurz = 1 - lang;
  const u = { x: e[lang].x / l[lang], z: e[lang].z / l[lang] };
  const v = { x: e[kurz].x / l[kurz], z: e[kurz].z / l[kurz] };
  const mitte = { x: (p[0].x + p[1].x + p[2].x + p[3].x) / 4, z: (p[0].z + p[1].z + p[2].z + p[3].z) / 4 };
  return { mitte, u, v, halbL_m: l[lang] / 2, halbB_m: l[kurz] / 2 };
}

/**
 * Frame of a roof outline: an exact rectangle in its own frame, otherwise the axis-aligned bounding box (see file head).
 * @param {PktXZ[]|undefined|null} profil outline in m
 * @param {"laengs"|"quer"|string} [firstrichtung] "quer" turns the frame; anything else = "laengs"
 * @returns {DachRahmen|null} null without an outline of 3 points
 */
export function dachRahmen(profil, firstrichtung = "laengs") {
  const p = umrissBereinigt(profil);
  if (p.length < 3) return null;
  /** @type {DachRahmen} */
  let r;
  const re = rechteckRahmen(p);
  const achsparallel = re && (Math.abs(re.u.x) < EPS || Math.abs(re.u.z) < EPS);
  if (re && !achsparallel) {
    r = { ...re, quelle: "rechteck" };
  } else {
    const xs = p.map((q) => q.x), zs = p.map((q) => q.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const sx = maxX - minX, sz = maxZ - minZ;
    const mitte = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    r = sx >= sz
      ? { mitte, u: { x: 1, z: 0 }, v: { x: 0, z: 1 }, halbL_m: sx / 2, halbB_m: sz / 2, quelle: re ? "rechteck" : "bbox" }
      : { mitte, u: { x: 0, z: 1 }, v: { x: 1, z: 0 }, halbL_m: sz / 2, halbB_m: sx / 2, quelle: re ? "rechteck" : "bbox" };
  }
  if (firstrichtung === "quer") r = { ...r, u: r.v, v: r.u, halbL_m: r.halbB_m, halbB_m: r.halbL_m };
  return r;
}
