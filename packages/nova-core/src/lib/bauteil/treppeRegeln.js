// 115-13: the rule values and shared helpers of every stair type in ONE place — the straight flight (bauteil/treppe.js, 108-06) and
// the two-flight stair with intermediate landing (bauteil/treppeU.js) read the same numbers, so a decided value changes both at once.
// treppe.js re-exports the values it had before (its importers stay untouched); the module has no imports, so treppe.js can import
// treppeU.js and treppeU.js this file without an import cycle.
//
// Norm basis: DIN 18065:2020-08 "Gebäudetreppen — Begriffe, Messregeln, Hauptmaße". The limits below are the values of Tab. 1 for
// "Wohngebäude mit nicht mehr als zwei Wohnungen" as the office uses them; they are [ASSUMED] until checked against the norm text
// (D-EFH-08) — way to a sourced value: compare each value with DIN 18065 Tab. 1 / the cited clause and drop the marker.
// Every deviation is a WARNING in the result, never a block or a silent correction: the liability for a stair stays with the
// planner (who may e.g. plan a building-law exception), so the app shows the conflict and keeps the input.
//
// In:  nothing. Out: constants (m), `r3`, `regelWarnungen` (riser / going / step rule / width), `treppenTextAus`, `deckeUeber`.

import { elevationOf } from "./hoehen.js";

/** Target riser height in m. [ASSUMED] 17.5 cm — the usual design value of dwelling stairs; way to a decided value: the planner's office standard. */
export const SOLL_STEIGUNG_M = 0.175;
/** Step rule 2 s + a in m. [ASSUMED] 0.63 m with the tolerance 0.59…0.65 (DIN 18065 §6, to be checked against the norm text). */
export const SCHRITTMASS_M = 0.63;
/** Allowed step-rule range in m. [ASSUMED] */
export const SCHRITTMASS_BEREICH_M = Object.freeze({ min: 0.59, max: 0.65 });
/** DIN 18065 Tab. 1 limits for dwellings with up to two flats, m. [ASSUMED] placeholders until the norm check. */
export const DIN_18065_WOHNEN = Object.freeze({ s_min: 0.14, s_max: 0.20, a_min: 0.23, a_max: 0.37, breite_min: 0.80 });
/** Minimum headroom over the walking line in m. [ASSUMED] 2.00 m (DIN 18065 §6.5, to be checked). */
export const KOPFHOEHE_MIN_M = 2.0;
/** Default stair width in m for "Treppe einfügen". [ASSUMED] 1.00 m (the usual EFH flight). */
export const STANDARD_BREITE_M = 1.0;
/** Thickness of the massive flight plate under the steps in m (3D body, IFC). [ASSUMED] 0.18 m. */
export const LAUFPLATTE_M = 0.18;

/** Tolerance of the limit comparisons in m: a value on the limit counts as kept (floating point, 115-13 review 20.11.). No norm value. */
export const TOLERANZ_M = 1e-9;

/** Round to millimetres. @param {number} v metres @returns {number} */
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** @typedef {{code: string, text: string, wert: number, grenze: number}} TreppenWarnung */

/**
 * The checks every stair type shares: riser, going, step rule and usable width against DIN 18065 Tab. 1 (dwellings with up to two
 * flats). Same codes, texts and order as the straight flight had inline since 108-06 (its output is unchanged).
 * `warn`, never `fail`: the values are [ASSUMED] placeholders of DIN 18065 and the planner decides (D-EFH-08).
 * @param {number} s riser height, m
 * @param {number} a going (tread depth on the walking line), m
 * @param {number} b usable flight width, m
 * @returns {TreppenWarnung[]}
 */
export function regelWarnungen(s, a, b) {
  const schritt = 2 * s + a;
  // 115-13 review 20.11. (finding 3): a value exactly ON a limit is allowed — compared with a tolerance of 1e-9 m (far below any
  // buildable size), because s = h / n and a = 0.63 − 2 s are not exact in binary (2.80 / 20 = 0.13999…, 0.63 − 0.40 = 0.22999…) and
  // warned "unter 14 cm (14,0 cm)" before. Same tolerance as the landing check (treppeU.js podest_kurz).
  const E = TOLERANZ_M;
  /** @type {TreppenWarnung[]} */
  const warnungen = [];
  if (s < DIN_18065_WOHNEN.s_min - E) warnungen.push({ code: "steigung_niedrig", text: "Steigung unter 14 cm (DIN 18065 Tab. 1)", wert: r3(s), grenze: DIN_18065_WOHNEN.s_min });
  if (s > DIN_18065_WOHNEN.s_max + E) warnungen.push({ code: "steigung_hoch", text: "Steigung über 20 cm (DIN 18065 Tab. 1)", wert: r3(s), grenze: DIN_18065_WOHNEN.s_max });
  if (a < DIN_18065_WOHNEN.a_min - E) warnungen.push({ code: "auftritt_klein", text: "Auftritt unter 23 cm (DIN 18065 Tab. 1)", wert: r3(a), grenze: DIN_18065_WOHNEN.a_min });
  if (a > DIN_18065_WOHNEN.a_max + E) warnungen.push({ code: "auftritt_gross", text: "Auftritt über 37 cm (DIN 18065 Tab. 1)", wert: r3(a), grenze: DIN_18065_WOHNEN.a_max });
  if (schritt < SCHRITTMASS_BEREICH_M.min - E || schritt > SCHRITTMASS_BEREICH_M.max + E) warnungen.push({ code: "schrittmass", text: "Schrittmaß 2s + a außerhalb 59…65 cm", wert: r3(schritt), grenze: SCHRITTMASS_M });
  if (b < DIN_18065_WOHNEN.breite_min - E) warnungen.push({ code: "breite", text: "Nutzbare Laufbreite unter 0,80 m (DIN 18065 Tab. 1)", wert: r3(b), grenze: DIN_18065_WOHNEN.breite_min });
  return warnungen;
}

/**
 * Where the slab above a flight may end so that the clear headroom stays — the ONE headroom rule of every stair type (straight flight
 * treppe.treppenLoch, both flights of treppeU.treppeULoch). 115-13 review 20.11., user decision "korrigieren, für beide":
 * the clear headroom is measured PLUMB ABOVE THE LINE OF THE STEP NOSINGS (DIN 18065 "lichte Treppendurchgangshöhe", measured from
 * the "Verbindungslinie der Stufenvorderkanten") — [ASSUMED] measuring basis: the norm text was not at hand; way to a sourced value:
 * check DIN 18065:2020-08 (definition of the clear headroom and its figure) and drop the marker. Before (108-06) it was measured above
 * the TREAD under the slab edge, which left the edge ~0.2 m too far into the stair (case 2.80 m / UK 2.55: 1.85 m above the nosings
 * where the app showed 2.025 m).
 * Flight geometry: tread k = 1 … n has its nosing at d = (k − 1) · a and its top at basis + k · s, so the nosing line is
 * y(d) = basis + s + d · s / a. The slab may reach to d_v where UK − y(d_v) = kopf:  d_v = a · ((UK − basis − kopf) / s − 1).
 * Below 0 (the slab is lower than kopf above the first nosing) the whole flight is opened (d_v = 0) and the headroom there,
 * UK − basis − s, stays below the minimum — the caller warns.
 * @param {number} uk_m underside of the slab above, m above the floor the stair starts on
 * @param {number} s riser height, m
 * @param {number} a going, m
 * @param {number} [basis_m] height of the floor the flight starts from (0 for flight 1, the landing top for flight 2), m
 * @param {number} [kopf_m] required headroom, m (KOPFHOEHE_MIN_M)
 * @returns {{d_m: number, kopfhoehe_m: number}} d_m = distance from the flight's first nosing to the slab edge (≥ 0), m;
 *   kopfhoehe_m = headroom above the nosing line at that edge, m
 */
export function kopfLochBeginn(uk_m, s, a, basis_m = 0, kopf_m = KOPFHOEHE_MIN_M) {
  const frei = uk_m - basis_m;
  const d = Math.max(0, a * ((frei - kopf_m) / s - 1));
  return { d_m: d, kopfhoehe_m: frei - s - (d * s) / a };
}

/**
 * Plan label "17 Stg 17,1/28,9" (riser / going in cm, one decimal, decimal comma) — the one spelling of every stair type. "Stg" is the
 * German drawing abbreviation of the sheet (plans are drawn in German, like the room stamps), not a UI string.
 * @param {number} n risers
 * @param {number} s riser height, m
 * @param {number} a going, m
 * @returns {string}
 */
export function treppenTextAus(n, s, a) {
  const cm = (/** @type {number} */ v) => (v * 100).toFixed(1).replace(".", ",");
  return `${n} Stg ${cm(s)}/${cm(a)}`;
}

/**
 * The hull slab ABOVE storey `level` in a built model: createBuildingModel pushes the ceiling of storey L as `{level: L, elevation:
 * elevation(L) + height}`; the base slab (`level` −1 at elevation 0 without basements, or the id "-1") is never a ceiling.
 * (Moved here from treppe.js in 115-13 so treppeU.js can use it without an import cycle; treppe.js re-exports it.)
 * @param {any} model built model
 * @param {number} level
 * @param {import("./hoehen.js").Geschosse} [gs]
 * @returns {any|null}
 */
export function deckeUeber(model, level, gs) {
  const boden = elevationOf(level, gs);
  return (Array.isArray(model?.slabs) ? model.slabs : []).find((s) => Math.round(Number(s.level)) === Math.round(level) && s.id !== "-1" && Number(s.elevation) > boden + 1e-6) || null;
}
