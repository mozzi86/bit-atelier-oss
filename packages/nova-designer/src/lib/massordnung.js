// 89-01 (BW-03): the dimensional order of German masonry construction as ONE source — octametric grid
// 12.5 cm (DIN 4172), structural grid size (Baurichtmaß) ↔ nominal size (Nennmaß) ↔ shell size (Rohbaumaß),
// the door-opening series of DIN 18100, calcium-silicate (KS) formats and wall thicknesses, and the 62.5 cm
// drywall grid. Before, door widths were "cited DIN 18100" in tesselierung.js while moebel.js said 0.985 m is
// not in that series — both were half right: 0.985 m is not a DIN 18100 opening.
//
// The relations (DIN 4172, simplified for the planning stage [ASSUMED rounding]):
//   - Baurichtmaß = n × 12.5 cm (octametre)
//   - joint 1 cm: outer dimension (Außenmaß) = Baurichtmaß − 1 cm, opening (Öffnungsmaß) = Baurichtmaß + 1 cm,
//     projection (Vorsprung) = Baurichtmaß
//   - door wall openings (DIN 18100): Rohbaumaß width = Baurichtmaß + 10 mm (875 → 885 mm)
//   - clear passage width ≈ Rohbaumaß − 25 mm frame/rebate deduction [ASSUMED, as moebel.js / 84-10]
//
// In:  lengths in metres. Out: pure helpers; no state. All units metres unless the name says otherwise.

/** Octametric grid unit (m), DIN 4172. */
export const OKTAMETER = 0.125;
/** Joint width used for the Außen-/Öffnungsmaß derivation (m) [ASSUMED 1 cm, DIN 4172 practice]. */
export const FUGE = 0.01;
/** Drywall grid (m): board width 1.25 m, stud spacing 0.625 m. */
export const TROCKENBAU_RASTER = 0.625;

/** DIN 18100 door wall openings: structural size (Baurichtmaß, m) → shell opening width (Rohbaumaß, m). */
export const TUER_REIHE_DIN18100 = Object.freeze([
  { baurichtmass: 0.625, rohbau: 0.635 },
  { baurichtmass: 0.75, rohbau: 0.76 },
  { baurichtmass: 0.875, rohbau: 0.885 },
  { baurichtmass: 1.0, rohbau: 1.01 },
  { baurichtmass: 1.125, rohbau: 1.135 },
  { baurichtmass: 1.25, rohbau: 1.26 },
]);
/** Frame / rebate deduction from shell width to clear passage (m) [ASSUMED, DIN 18101 order of magnitude]. */
export const TUER_LICHT_ABZUG = 0.025;

/** KS (and brick) formats: name → length × width × height in m (DIN 105 / DIN EN 771 order of sizes). */
export const KS_FORMATE = Object.freeze({
  NF: { l: 0.24, b: 0.115, h: 0.071 },
  DF: { l: 0.24, b: 0.115, h: 0.052 },
  "2DF": { l: 0.24, b: 0.115, h: 0.113 },
  "3DF": { l: 0.24, b: 0.175, h: 0.113 },
  "8DF": { l: 0.248, b: 0.24, h: 0.238 },
  "10DF": { l: 0.248, b: 0.3, h: 0.238 },
});
/** Standard masonry wall thicknesses (Nennmaß, m) of the octametric order. */
export const WANDDICKEN = Object.freeze([0.115, 0.175, 0.24, 0.3, 0.365]);

const r = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Snap a length to the octametric grid (nearest multiple of 12.5 cm).
 * @param {number} m length in m
 * @returns {number} Baurichtmaß in m
 */
export function aufOktameter(m) {
  return r(Math.round((Number(m) || 0) / OKTAMETER) * OKTAMETER);
}

/** Is the length a multiple of 12.5 cm (tolerance 1 mm)? */
export function istOktametrisch(m) {
  const n = (Number(m) || 0) / OKTAMETER;
  return Math.abs(n - Math.round(n)) * OKTAMETER < 0.001;
}

/**
 * Baurichtmaß → the three derived sizes of DIN 4172.
 * @param {number} baurichtmass m (should be a multiple of 12.5 cm)
 * @returns {{baurichtmass: number, aussenmass: number, oeffnungsmass: number, vorsprung: number}} m
 */
export function nennmasse(baurichtmass) {
  const b = Number(baurichtmass) || 0;
  return { baurichtmass: r(b), aussenmass: r(b - FUGE), oeffnungsmass: r(b + FUGE), vorsprung: r(b) };
}

/**
 * Door of the DIN 18100 series that fits a required clear passage width.
 * @param {number} lichtMin required clear width in m (e.g. 0.80 standard, 0.90 DIN 18040)
 * @returns {{baurichtmass: number, rohbau: number, licht: number}|null} smallest fitting door, null if none
 */
export function tuerFuerLichteBreite(lichtMin) {
  const t = TUER_REIHE_DIN18100.find((x) => r(x.rohbau - TUER_LICHT_ABZUG) >= (Number(lichtMin) || 0) - 1e-9);
  return t ? { ...t, licht: r(t.rohbau - TUER_LICHT_ABZUG) } : null;
}

/**
 * Is a shell door width part of the DIN 18100 series?
 * @param {number} rohbau m
 * @returns {boolean}
 */
export function istDin18100Tuer(rohbau) {
  return TUER_REIHE_DIN18100.some((x) => Math.abs(x.rohbau - (Number(rohbau) || 0)) < 0.0005);
}

/**
 * Nearest standard wall thickness (Nennmaß) for a given thickness.
 * @param {number} m
 * @returns {number} m
 */
export function naechsteWanddicke(m) {
  const d = Number(m) || 0;
  return WANDDICKEN.reduce((best, w) => (Math.abs(w - d) < Math.abs(best - d) ? w : best), WANDDICKEN[0]);
}

/**
 * Snap a drywall length to the 62.5 cm grid.
 * @param {number} m
 * @returns {number} m
 */
export function aufTrockenbauRaster(m) {
  return r(Math.round((Number(m) || 0) / TROCKENBAU_RASTER) * TROCKENBAU_RASTER);
}

/**
 * Door widths the apartment workshop (tesselierung.js) draws, in m (shell width of the opening). Room door
 * 0.885 and bath / apartment-entrance door 1.01 are DIN 18100 openings (Baurichtmaß 0.875 / 1.00). Until
 * 12.10.2026 the bath / entrance value was 0.985 — the CLEAR width of the 1.01 door (moebel.js tuer_1010),
 * entered as an opening; switched by user decision D-BW-06 (golden snapshots re-frozen).
 */
export const TUER_WERKSTATT = Object.freeze({
  standard: Object.freeze({ zimmer: 0.885, bad: 1.01, wohnung: 1.01 }),
  // 84-10 wheelchair unit (R): rooms need the 1.01 opening (clear 0.985 ≥ 0.90, DIN 18040-2).
  R: Object.freeze({ zimmer: 1.01, bad: 1.01, wohnung: 1.01 }),
});
/** 84-11: wall piece corner → hinge so that a wardrobe fits behind the leaf: 7 octametres = 0.875 m
 * [ASSUMED, D-BW-01 — alternative 8 × 12.5 = 1.00 m]. */
export const TUER_ECKABSTAND_OKTAMETER = 7;
