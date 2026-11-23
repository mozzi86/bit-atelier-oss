// Checks of the building against the governing terrain (108-10, user brief 08.11.2026: "Anschlusshöhen, Sockel … ablesbar";
// house on a slope with a basement). Two questions a planner asks as soon as the ground is not flat:
//   1. Does an opening of the outer wall lie (partly) below the ground outside it? → light well, area well, external stair — or a
//      wrong storey. Reported as a WARNING, never blocked: a basement window in a light well is allowed, the planner decides.
//   2. Is a storey a full storey ("Vollgeschoss") by the terrain rule: the top of its ceiling lies ON AVERAGE more than 1,40 m above
//      the ground (MBO 1997 § 2 Abs. 4; most state codes and BauNVO § 20 refer to it). On a slope this decides whether the
//      basement counts as a full storey — the number of full storeys is a value of the land-use plan.
//
// The governing terrain is the new ground where one is modelled, else the existing ground (gelaendeEbenen.js); the caller passes it
// as a height function in model metres, heights relative to ±0,00.
//
// In:  wall end points, footprint and storey records in model metres {x east, z south}, heights in m relative to ±0,00.
// Out: plain numbers in m. Pure module, no DOM.

/** Distance in front of the outer face where the ground is read for an opening, m [ASSUMED: just outside a perimeter strip]. */
export const PRUEFABSTAND_M = 0.5;

/** Mean height of the top of a ceiling above the ground for a full storey, m (MBO 1997 § 2 Abs. 4: "im Mittel mehr als 1,40 m"). */
export const VOLLGESCHOSS_UEBER_GELAENDE_M = 1.4;

/** Sampling step along the footprint for the mean, m [ASSUMED: fine against a 1-m sandbox raster and a 22-m elevation grid]. */
export const UMRISS_SCHRITT_M = 0.5;

/** Below this depth an opening counts as clear of the ground, m [ASSUMED: rounding of the terrain raster and plaster base]. */
export const UNTER_GELAENDE_TOL_M = 0.01;

/** @typedef {{x: number, z: number}} PktXZ */
/** @typedef {(p: PktXZ) => number} HoeheFn  terrain height at a model point, m relative to ±0,00 */

/** Point in polygon (even-odd), model metres. */
function imPolygon(/** @type {PktXZ[]} */ poly, /** @type {PktXZ} */ p) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) innen = !innen;
  }
  return innen;
}

/**
 * Unit normal of a wall pointing OUT of the footprint (the side whose test point lies outside the outline).
 * @param {PktXZ} a @param {PktXZ} b wall end points, m
 * @param {PktXZ[]} umriss footprint, m
 * @returns {PktXZ|null} null for a wall without length
 */
export function aussenNormale(a, b, umriss) {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
  if (!(l > 1e-9)) return null;
  const n = { x: -dz / l, z: dx / l };
  const mitte = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const fp = Array.isArray(umriss) && umriss.length >= 3 ? umriss : null;
  if (!fp) return n;
  return imPolygon(fp, { x: mitte.x + n.x * PRUEFABSTAND_M, z: mitte.z + n.z * PRUEFABSTAND_M }) ? { x: -n.x, z: -n.z } : n;
}

/**
 * An opening of an outer wall against the ground in front of it: the ground is read PRUEFABSTAND_M outside the wall at both jambs and
 * in the middle, the highest of the three counts (worst case on a slope).
 * @param {{a: PktXZ, b: PktXZ, u: number, breite_m: number, bruestung_m: number, oben_m: number, umriss: PktXZ[], hoeheFn: HoeheFn,
 *   abstand_m?: number}} q u = middle of the opening along the wall from a, m; bruestung_m / oben_m = sill / head height, m relative to ±0,00
 * @returns {{gelaende_m: number, unter_m: number, ganz: boolean}|null} gelaende_m = governing ground height, m; unter_m = how far the sill
 *   lies below it, m (≤ 0: clear); ganz = the whole opening is below the ground; null without a usable wall
 */
export function oeffnungGegenGelaende({ a, b, u, breite_m, bruestung_m, oben_m, umriss, hoeheFn, abstand_m = PRUEFABSTAND_M }) {
  const n = aussenNormale(a, b, umriss);
  if (!n || typeof hoeheFn !== "function" || ![u, breite_m, bruestung_m, oben_m].every(Number.isFinite)) return null;
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  const ex = (b.x - a.x) / l, ez = (b.z - a.z) / l;
  const halb = Math.max(0, breite_m) / 2;
  const hoehen = [u - halb, u, u + halb].map((s) => hoeheFn({ x: a.x + ex * s + n.x * abstand_m, z: a.z + ez * s + n.z * abstand_m }));
  const gelaende = Math.max(...hoehen);
  const r = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return { gelaende_m: r(gelaende), unter_m: r(gelaende - bruestung_m), ganz: oben_m <= gelaende + 1e-9 };
}

/**
 * How far a height lies above the ground along the footprint: sampled every `schritt_m` (piece midpoints, weighted by piece length),
 * so the mean is the length-weighted mean over the outer walls [ASSUMED: the usual reading of "im Mittel"; some state codes weigh by the
 * wall faces instead — with straight terrain between the corners both agree].
 * @param {PktXZ[]} umriss footprint, m
 * @param {number} hoehe_m the height to compare (e.g. top of the ceiling), m relative to ±0,00
 * @param {HoeheFn} hoeheFn governing terrain
 * @param {number} [schritt_m]
 * @returns {{mittel_m: number, min_m: number, max_m: number}|null} m above the ground (negative = below); null without an outline
 */
export function umrissUeberGelaende(umriss, hoehe_m, hoeheFn, schritt_m = UMRISS_SCHRITT_M) {
  if (!Array.isArray(umriss) || umriss.length < 3 || typeof hoeheFn !== "function" || !Number.isFinite(hoehe_m)) return null;
  let summe = 0, laenge = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < umriss.length; i += 1) {
    const a = umriss[i], b = umriss[(i + 1) % umriss.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(l > 1e-9)) continue;
    const k = Math.max(1, Math.ceil(l / (schritt_m > 0 ? schritt_m : UMRISS_SCHRITT_M)));
    for (let j = 0; j < k; j += 1) {
      const t = (j + 0.5) / k;
      const d = hoehe_m - hoeheFn({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      summe += d * (l / k); laenge += l / k;
      min = Math.min(min, d); max = Math.max(max, d);
    }
  }
  if (!(laenge > 0)) return null;
  const r = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return { mittel_m: r(summe / laenge), min_m: r(min), max_m: r(max) };
}

/**
 * The terrain rule of the full storey for every storey that has a storey above it: top of its ceiling = the level of the storey above
 * [ASSUMED: model levels are structural levels, i.e. the top of the structural slab — MBO "Deckenoberkante"; with a floor build-up the
 * value rises by its thickness]. The top storey is left out (its ceiling is the roof; vollgeschoss.js checks the attic by its area).
 * @param {Array<{level: number, name?: string, elevation: number}>} storeys model.storeys (m)
 * @param {PktXZ[]} umriss footprint, m
 * @param {HoeheFn} hoeheFn governing terrain
 * @returns {Array<{level: number, name: string, deckenOK_m: number, mittel_m: number, min_m: number, max_m: number, voll140: boolean}>}
 *   lowest storey first; voll140 = the ceiling top lies on average MORE than 1,40 m above the ground (the clear-height rule 2/3 ≥ 2,30 m
 *   is a second condition the caller states)
 */
export function geschosseGegenGelaende(storeys, umriss, hoeheFn) {
  const liste = (Array.isArray(storeys) ? storeys : []).filter((s) => s && Number.isFinite(Number(s.elevation)))
    .slice().sort((x, y) => Number(x.elevation) - Number(y.elevation));
  /** @type {Array<{level: number, name: string, deckenOK_m: number, mittel_m: number, min_m: number, max_m: number, voll140: boolean}>} */
  const out = [];
  for (let i = 0; i + 1 < liste.length; i += 1) {
    const ok = Number(liste[i + 1].elevation);
    const m = umrissUeberGelaende(umriss, ok, hoeheFn);
    if (!m) continue;
    out.push({ level: liste[i].level, name: liste[i].name || String(liste[i].level), deckenOK_m: ok, ...m, voll140: m.mittel_m > VOLLGESCHOSS_UEBER_GELAENDE_M });
  }
  return out;
}
