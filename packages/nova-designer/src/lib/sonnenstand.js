// Sun position, building shadow and daylight class for a point on the site plan (Phase 37, GARTEN-03).
//
// In:  latitude (°), month (1–12), hour (0–24, local solar time), footprint polygon in metres
//      (x east, z south — the BIM/OSM plan convention), building height in metres.
// Out: sun elevation/azimuth (°), shadow test for a point, mean daily sun hours over the growing
//      season and the horticultural light class (sonnig | halbschattig | schattig).
//
// sunPosition is the app's ONLY solar formula: the private copy inside MassingStudio.jsx
// was removed in 75-08 (MSB-1) — the massing studio imports this module. Solar declination
// from the day of year (or an explicit day of year via opts.tagImJahr, 75-08 Task 2), hour
// angle from local solar time, no equation of time, no refraction — plenty for a
// concept-level light classification.

import { punktImPolygon } from "@designer/lib/moebel";

const RAD = Math.PI / 180;

/** Months of the growing season used for the sun-hour average ([ASSUMED] Apr–Sep, Central Europe). */
export const VEGETATIONS_MONATE = [4, 5, 6, 7, 8, 9];
/** Hours sampled per day (local solar time), [ASSUMED] 6–20 h covers every daylight hour Apr–Sep at 47–55° N. */
export const TAGES_STUNDEN = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
/** Sun below this elevation (°) does not count as a sun hour ([ASSUMED] — grazing light, long shadows). */
export const MIN_ELEVATION_GRAD = 5;
/** Light class thresholds in sun hours per day ([ASSUMED] horticultural rule of thumb: full sun ≥ 6 h). */
export const SONNIG_AB_H = 6;
export const HALBSCHATTIG_AB_H = 3;

/**
 * Simplified solar position.
 * @param {number} lat latitude in degrees (north positive)
 * @param {number} month 1–12
 * @param {number} hour 0–24 true local solar time (no equation of time — same simplification as the module header)
 * @param {{ tagImJahr?: number }} [opts] additive day-of-year override (75-08 Task 2):
 *   1–366, non-leap-year counting, 1 = 1 January. When a finite number is given it
 *   REPLACES the month approximation (rounded, clamped to 1…366); otherwise the
 *   month path runs EXACTLY as before (byte-identical — pinned by literals in
 *   tests/unit/sonnenstand.test.js).
 * @returns {{ elevation: number, azimuth: number }} degrees; azimuth from north, clockwise
 */
export function sunPosition(lat, month, hour, opts) {
  // Day selection is the ONLY changed line (Task 2 acceptance: formula diff = day pick only).
  const tag = Number(opts?.tagImJahr);
  const dayOfYear = Number.isFinite(tag)
    ? Math.min(366, Math.max(1, Math.round(tag)))
    : Math.round(((Number(month) || 6) - 0.5) * 30.4);
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const H = 15 * ((Number(hour) || 0) - 12); // hour angle in degrees
  const phi = (Number(lat) || 0) * RAD, delta = decl * RAD, h = H * RAD;
  const sinE = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h);
  const e = Math.asin(Math.max(-1, Math.min(1, sinE)));
  const cosE = Math.cos(e) || 1e-6;
  const sinA = (-Math.cos(delta) * Math.sin(h)) / cosE;
  const cosA = (Math.sin(delta) - Math.sin(phi) * sinE) / (Math.cos(phi) * cosE || 1e-6);
  let A = Math.atan2(sinA, cosA) / RAD;
  if (A < 0) A += 360;
  return { elevation: e / RAD, azimuth: A };
}

/**
 * Horizontal unit vector pointing from a ground point TOWARDS the sun, in plan coordinates
 * (x east, z south). Azimuth 180° (south) → {x: 0, z: 1}; 90° (east) → {x: 1, z: 0}.
 * @param {number} azimuth degrees from north, clockwise
 */
export function sonnenrichtung(azimuth) {
  const a = (Number(azimuth) || 0) * RAD;
  return { x: Math.sin(a), z: -Math.cos(a) };
}

/**
 * Sun preset days/hours for the massing iso light (75-08 Task 2, Blatt 08).
 * Equinoxes and solstices as office-standard reference days — NOT normative
 * days (DIN EN 17037 / DIN 5034-1 use their own) [ASSUMED]. Day numbers by
 * hand: 21 March = 31 + 28 + 21 = 80 · 21 June = 151 + 21 = 172 ·
 * 21 December = 334 + 21 = 355 (non-leap-year counting, sunPosition's base).
 * Frozen: the UI mutates nothing here.
 */
export const SONNEN_PRESETS = Object.freeze({
  /** Reference days: equinox (21.03.), summer solstice (21.06.), winter solstice (21.12.). */
  tage: Object.freeze([
    Object.freeze({ key: "21-03", label: "21.03.", monat: 3, tagImJahr: 80 }),
    Object.freeze({ key: "21-06", label: "21.06.", monat: 6, tagImJahr: 172 }),
    Object.freeze({ key: "21-12", label: "21.12.", monat: 12, tagImJahr: 355 }),
  ]),
  /** Sampled hours (true local solar time): morning / noon / afternoon. */
  stunden: Object.freeze([9, 12, 15]),
});

/**
 * Convert a GEOGRAPHIC azimuth to a PLAN azimuth: plan = geographic − north
 * angle. The project convention is geographic = plan + north angle
 * (raumklima.azimutFromNormal, tesselierung.orientierungFuerBand, nordwinkel.js).
 * At north angle 0 (or unset) the input is returned UNCHANGED — no modulo
 * rounding; the byte-identical 2D shadow (75-08 Task 5) relies on strict
 * identity.
 * @param {number} azimut geographic azimuth, degrees clockwise from north
 * @param {number} [nordwinkel] geographic azimuth of plan-up, degrees
 * @returns {number} plan azimuth in [0, 360); identical to azimut when nordwinkel is 0/unset
 */
export function planAzimut(azimut, nordwinkel = 0) {
  const n = Number(nordwinkel) || 0;
  if (n === 0) return azimut; // strict identity — see JSDoc
  return ((azimut - n) % 360 + 360) % 360;
}

/**
 * Unit vector from the ground TOWARDS the sun in SCENE/PLAN axes
 * (x = plan right/east at north angle 0, z = plan down/south, y = up) —
 * the direction a three.js DirectionalLight position must take (75-08 Task 2).
 * h = sonnenrichtung(planAzimut(azimut, nordwinkel)); x = h.x·cos(elev),
 * y = sin(elev), z = h.z·cos(elev). Checks (see tests):
 * (180, 45, 0) → (0; 0.7071; 0.7071) south at 45° elevation ·
 * (90, 30, 90) → (0; 0.5; −0.866) — geographic east = plan-up at north angle 90 ·
 * (180, 45, 90) → (0.7071; 0.7071; 0) — geographic south = plan-right.
 * @param {number} azimut geographic sun azimuth, degrees clockwise from north
 * @param {number} elevation sun elevation, degrees (negative below the horizon)
 * @param {number} [nordwinkel] geographic azimuth of plan-up, degrees
 * @returns {{ x: number, y: number, z: number, ueberHorizont: boolean }} unit vector; ueberHorizont = elevation > 0
 */
export function lichtrichtung(azimut, elevation, nordwinkel = 0) {
  const e = Number(elevation) || 0;
  const h = sonnenrichtung(planAzimut(Number(azimut) || 0, Number(nordwinkel) || 0));
  const cosE = Math.cos(e * RAD);
  return { x: h.x * cosE, y: Math.sin(e * RAD), z: h.z * cosE, ueberHorizont: e > 0 };
}

/**
 * Horizontal shadow length of a vertical edge.
 * @param {number} hoehe_m building height in metres
 * @param {number} elevation sun elevation in degrees
 * @returns {number} metres; Infinity-safe (elevation ≤ 0 → 0, the sun is down)
 */
export function schattenlaenge(hoehe_m, elevation) {
  const e = Number(elevation) || 0;
  if (e <= 0) return 0;
  return Math.max(0, Number(hoehe_m) || 0) / Math.tan(e * RAD);
}

// Segment intersection a→b with c→d (proper or touching).
function schneidet(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p, q, r) => Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.z, q.z) - 1e-9 <= r.z && r.z <= Math.max(p.z, q.z) + 1e-9;
  if (Math.abs(d1) < 1e-9 && on(c, d, a)) return true;
  if (Math.abs(d2) < 1e-9 && on(c, d, b)) return true;
  if (Math.abs(d3) < 1e-9 && on(a, b, c)) return true;
  if (Math.abs(d4) < 1e-9 && on(a, b, d)) return true;
  return false;
}

/**
 * Is ground point p shadowed by the building? True when the ray from p towards the sun, limited to the
 * shadow length h / tan(elevation), hits the footprint (or p lies inside it).
 * @param {{x:number,z:number}} p metres
 * @param {Array<{x:number,z:number}>} footprint metres
 * @param {number} hoehe_m building height in metres
 * @param {{ elevation: number, azimuth: number }} sonne degrees
 */
export function imSchatten(p, footprint, hoehe_m, sonne) {
  const fp = Array.isArray(footprint) ? footprint : [];
  if (fp.length < 3 || !p) return false;
  if (!sonne || sonne.elevation <= 0) return true; // night — no sun anyway
  if (punktImPolygon(p.x, p.z, fp)) return true;
  const L = schattenlaenge(hoehe_m, sonne.elevation);
  if (L <= 0) return false;
  const d = sonnenrichtung(sonne.azimuth);
  const q = { x: p.x + d.x * L, z: p.z + d.z * L };
  for (let i = 0; i < fp.length; i++) {
    if (schneidet(p, q, fp[i], fp[(i + 1) % fp.length])) return true;
  }
  return false;
}

/**
 * Mean daily sun hours at p over the growing season (only hours with the sun above MIN_ELEVATION_GRAD
 * and p not shadowed by the building count).
 * @param {{x:number,z:number}} p metres
 * @param {Array<{x:number,z:number}>} footprint metres
 * @param {number} hoehe_m building height in metres
 * @param {number} lat latitude in degrees
 * @param {{ monate?: number[], stunden?: number[] }} [opts]
 * @returns {number} hours per day (one decimal)
 */
export function sonnenstunden(p, footprint, hoehe_m, lat, { monate = VEGETATIONS_MONATE, stunden = TAGES_STUNDEN } = {}) {
  if (!monate.length) return 0;
  let summe = 0;
  for (const m of monate) {
    for (const h of stunden) {
      const s = sunPosition(lat, m, h);
      if (s.elevation < MIN_ELEVATION_GRAD) continue;
      if (!imSchatten(p, footprint, hoehe_m, s)) summe += 1;
    }
  }
  return Math.round((summe / monate.length) * 10) / 10;
}

/**
 * Horticultural light class from sun hours per day.
 * @param {number} stunden h/day
 * @returns {"sonnig"|"halbschattig"|"schattig"}
 */
export function lichtKlasse(stunden) {
  const h = Number(stunden) || 0;
  if (h >= SONNIG_AB_H) return "sonnig";
  if (h >= HALBSCHATTIG_AB_H) return "halbschattig";
  return "schattig";
}

/**
 * Shadow polygons of the footprint for the overlay: one quadrilateral per footprint edge (edge swept by
 * the shadow vector) plus the translated footprint. Drawn semi-transparent they read as the union.
 * @param {Array<{x:number,z:number}>} footprint metres
 * @param {number} hoehe_m building height in metres
 * @param {{ elevation: number, azimuth: number }} sonne degrees
 * @returns {Array<Array<{x:number,z:number}>>} polygons in metres; [] when the sun is down
 */
export function schattenPolygone(footprint, hoehe_m, sonne) {
  const fp = Array.isArray(footprint) ? footprint : [];
  if (fp.length < 3 || !sonne || sonne.elevation <= 0) return [];
  const L = schattenlaenge(hoehe_m, sonne.elevation);
  const d = sonnenrichtung(sonne.azimuth);
  const s = { x: -d.x * L, z: -d.z * L }; // shadow falls away from the sun
  const polys = fp.map((a, i) => {
    const b = fp[(i + 1) % fp.length];
    return [a, b, { x: b.x + s.x, z: b.z + s.z }, { x: a.x + s.x, z: a.z + s.z }];
  });
  polys.push(fp.map((q) => ({ x: q.x + s.x, z: q.z + s.z })));
  return polys;
}
