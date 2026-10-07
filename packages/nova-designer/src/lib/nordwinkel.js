// ONE north angle per project (75-06 Task 6, D-P75-05).
//
// Precedence: layer value > project value > 0. The EXISTING layer fields
// raumklima_layer.northAngle, schallschutz_layer.northAngle and
// werkstatt_layer.nordwinkel are NOT renamed and NOT overwritten — this module
// only READS them and reports which source won (additive, backwards
// compatible, CLAUDE.md "Harte Grenzen").
//
// In:  { projekt?, layer? } angles in degrees (azimuth of the plan's "up"
//      direction, clockwise; 0 = plan-up is true north).
// Out: { winkel: number, quelle: "layer"|"projekt"|"default" } — never NaN.
// Pure module, no React, node-testable.

/**
 * Is a value a SET angle? 0 counts as set ("explicitly north"), null /
 * undefined / NaN count as empty — the distinction matters: a user who typed 0
 * means 0, a legacy record without the field means "unknown".
 * @param {unknown} v candidate value
 * @returns {boolean} true when v is a finite number
 */
function istGesetzt(v) {
  return Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== "";
}

/**
 * Resolve the effective north angle for a planner/massing view.
 * @param {{projekt?: unknown, layer?: unknown}} [quelle] projekt = the project
 *   level angle (complexData.nordwinkel, degrees); layer = theFachlayer value
 *   of the calling planner (degrees)
 * @returns {{winkel: number, quelle: "layer"|"projekt"|"default"}} effective
 *   angle in degrees and which source won
 */
export function nordwinkelFuer({ projekt, layer } = {}) {
  if (istGesetzt(layer)) return { winkel: Number(layer), quelle: "layer" };
  if (istGesetzt(projekt)) return { winkel: Number(projekt), quelle: "projekt" };
  return { winkel: 0, quelle: "default" };
}
