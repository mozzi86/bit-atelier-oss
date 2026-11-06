// 108-02 (D-EFH-01): full-storey check (Vollgeschoss) of an attic storey from the ROOF GEOMETRY instead of hand values. Until now the
// rule existed only in src/lib/machbarkeit/kennzahlen.js vollgeschoss() with typed-in areas (`flaeche_h230_m2`), out of reach for the
// packages. Here the area with a clear height of at least 2.30 m is computed from the roof planes (lichteHoehe.flaecheAbHoehe) and the
// result has the shape vollgeschoss() reads, so the feasibility study can take it over later.
//
// Rule (MBO 1997 § 2 Abs. 4 and the state building codes derived from it): a storey is full when at least two thirds of its floor area
// have a clear height of ≥ 2.30 m AND the top of its ceiling lies on average more than 1.40 m above ground. [ASSUMED] the limits 2/3 and
// 2.30 m — they differ by state (some relate the attic to the floor area of the storey BELOW, some use other heights); way to a proven
// value: the building code of the project site. The 1.40 m rule needs the terrain and is NOT checked here (`grund: "Gelände fehlt"`,
// plan 108-10). The result is a hint to the planner, no legal statement: callers show it as a warning, never block an input.
//
// In:  floor outline in m, roof planes (dachGeometrie.dachEbenen), floor height in m in the height frame of the roof.
// Out: {flaeche_m2, flaeche_h230_m2, anteil, mindestAnteil, voll, grund}.

import { flaeche } from "../formGeometrie.js";
import { flaecheAbHoehe } from "./lichteHoehe.js";

/** Clear height of the full-storey rule in m. [ASSUMED] 2.30 m (MBO 1997 § 2 Abs. 4); state codes may differ — see the file head. */
export const VOLLGESCHOSS_LICHTE_HOEHE_M = 2.3;

/** Share of the floor area that needs that clear height. [ASSUMED] 2/3 (MBO 1997 § 2 Abs. 4); state codes may differ. */
export const VOLLGESCHOSS_ANTEIL = 2 / 3;

/**
 * @typedef {object} VollgeschossErgebnis
 * @property {number} flaeche_m2         floor area of the storey (the outline), m²
 * @property {number} flaeche_h230_m2    part of it with at least `lichteHoehe_m` clear height under the roof, m²
 * @property {number} anteil             flaeche_h230_m2 / flaeche_m2 (0 … 1; 0 without area)
 * @property {number} mindestAnteil      the share the rule asks for (0 … 1)
 * @property {boolean|null} voll         true / false by the area rule; null = not decidable (no outline or no pitched roof planes)
 * @property {string} grund              German reason; with a decision always "Gelände fehlt" — the 1.40 m rule is unchecked (108-10)
 */

/**
 * Full-storey check of an attic storey from the roof geometry (see file head). Clear height is measured from `boden_m` up to the roof
 * PLANES of the library, i.e. the underside of the rafters without the roof build-up [ASSUMED]: this overestimates the clear height by the
 * rafter / insulation depth below the planes; way to a real value: subtract the roof build-up of 107-03 once the global roof has one.
 * @param {{grundriss?: Array<{x: number, z: number}>, dachEbenen?: Array<{punkt: {x: number, y: number, z: number}, normale: {x: number, y: number, z: number}}>,
 *          boden_m?: number, lichteHoehe_m?: number, anteil?: number}} q grundriss: floor outline in m; dachEbenen: roof planes;
 *   boden_m: floor height in m (same frame as the planes); lichteHoehe_m: clear height in m (default 2.30); anteil: required share (default 2/3)
 * @returns {VollgeschossErgebnis}
 */
export function vollgeschossAusDach({ grundriss = [], dachEbenen = [], boden_m = 0, lichteHoehe_m = VOLLGESCHOSS_LICHTE_HOEHE_M, anteil = VOLLGESCHOSS_ANTEIL } = {}) {
  const raum = (Array.isArray(grundriss) ? grundriss : []).map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
  const A = raum.length >= 3 ? flaeche(raum) : 0;
  const ebenen = Array.isArray(dachEbenen) ? dachEbenen : [];
  if (!(A > 0)) return { flaeche_m2: 0, flaeche_h230_m2: 0, anteil: 0, mindestAnteil: anteil, voll: null, grund: "Grundriss fehlt" };
  if (!ebenen.length) return { flaeche_m2: A, flaeche_h230_m2: 0, anteil: 0, mindestAnteil: anteil, voll: null, grund: "kein geneigtes Dach" };
  const a230 = Math.min(A, flaecheAbHoehe(raum, ebenen, Number(lichteHoehe_m) || 0, Number(boden_m) || 0));
  const teil = a230 / A;
  // warn, never fail (see file head): `voll` only tells the planner which side of the 2/3 line the attic lies on
  return { flaeche_m2: A, flaeche_h230_m2: a230, anteil: teil, mindestAnteil: anteil, voll: teil >= anteil - 1e-9, grund: "Gelände fehlt" };
}
