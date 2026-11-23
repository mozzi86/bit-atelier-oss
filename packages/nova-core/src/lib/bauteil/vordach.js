// W-1118-29: canopies (Vordächer) on a hull wall — the data form of `vordaecher`, the plate and its brackets in 3D, the plan
// outline and the checks. Pure mathematics, no three.js, no React: the studio (3D, inspector, "Vordach einfügen"), the plan
// (BimPlan2D, vector export / PDF) and the quantities read the SAME box from here, so a canopy drawn once shows up in every
// view that is derived from the model (finding 22.11.2026: a canopy drawn by hand in a plan script was missing in the
// renderings of the same house).
//
// Record (`vordaecher[]`, all lengths in m): {_idx, edge, u_von_m, u_bis_m, level, tiefe_m, unterkante_m, dicke_m?, konsolen?,
//   material?: "glas", guid?}
//   edge          hull edge (index into model.footprint, the same as envOpenings.edge and gauben.edge) the canopy hangs on
//   u_von/u_bis   position along that edge from its start point (the same u as the hull openings), m
//   level         storey whose floor the underside is measured from (0 = ground floor)
//   tiefe         projection in front of the OUTER face of the hull wall, m
//   unterkante    underside of the plate above the floor elevation of `level`, m
//   dicke         plate thickness, m
//   konsolen      number of brackets under the plate (0 = none, e.g. a canopy on tension rods)
//
// Geometry (heights absolute, m above ±0.00): the plate is a box u_von…u_bis × 0…tiefe (outwards) × y_unten…y_unten + dicke.
// Brackets are slim boxes under the plate, standing on the wall face; they are a picture of the fixing, not a structural design.
// The wall is NOT cut and carries no opening for the fixing (overlay, like the dormers).
//
// In:  canopy record, built model (footprint), storey table.
// Out: vordachBerechnen (boxes, plan outline, dimensions, checks), neuesVordach, quaderDreiecke.

import { huellKante } from "./gauben.js";
import { elevationOf } from "./hoehen.js";

/**
 * Defaults of a new canopy in m. [ASSUMED] usual single-family-house values, no norm: 1.60 m wide and 1.00 m deep covers a
 * 1.10 m front door with a hand's width on each side; underside 2.40 m keeps 0.30 m above a 2.10 m door; 0.02 m plate =
 * laminated safety glass 2 × 10 mm (the real thickness comes from the glass statics, DIN 18008-2); 2 brackets.
 */
export const VORDACH_STANDARD = Object.freeze({ breite_m: 1.6, tiefe_m: 1.0, unterkante_m: 2.4, dicke_m: 0.02, konsolen: 2 });

/** Bracket picture in m: width along the wall, height at the wall, distance of the outer brackets from the plate ends. [ASSUMED] drawing sizes, no design. */
export const KONSOLE = Object.freeze({ breite_m: 0.04, hoehe_m: 0.12, randabstand_m: 0.15 });

/**
 * Projection from which a canopy is no longer a minor projecting part for the setback areas, m. [ASSUMED] 1.50 m: the limit
 * the Bavarian building code uses for projecting parts (Art. 6 BayBO, wording to be checked per project and federal state).
 */
export const VORDACH_TIEFE_ABSTAND_M = 1.5;

/** Clear height under a canopy below which a warning is shown, m. [ASSUMED] 2.10 m: the usual clear height of a front door. */
export const VORDACH_LICHTE_HOEHE_M = 2.1;

const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {{x: number, y: number, z: number}} Pkt3
 * @typedef {object} Vordach
 * @property {number} [_idx]
 * @property {number} edge
 * @property {number} u_von_m
 * @property {number} u_bis_m
 * @property {number} [level]
 * @property {number} [tiefe_m]
 * @property {number} [unterkante_m]
 * @property {number} [dicke_m]
 * @property {number} [konsolen]
 * @property {"glas"} [material]
 * @property {string} [guid]
 * @typedef {object} VordachErgebnis
 * @property {true} ok
 * @property {number} level
 * @property {number} breite_m
 * @property {number} tiefe_m
 * @property {number} dicke_m
 * @property {number} flaeche_m2              plate area in plan, m²
 * @property {number} y_unten_m               underside of the plate, m above ±0.00
 * @property {number} y_oben_m                top of the plate, m above ±0.00
 * @property {Pkt3[]} platte                  8 corners: 4 at the underside (wall start, wall end, outer end, outer start), then the same 4 at the top
 * @property {Pkt3[][]} konsolen              8 corners per bracket, same order
 * @property {PktXZ[]} grundriss              plan outline (wall start, wall end, outer end, outer start), m
 * @property {Array<{code: string, text: string, wert: number}>} warnungen
 * @typedef {{ok: false, grund: "kante"|"breite"|"tiefe", text: string}} VordachFehler
 */

/**
 * Box, brackets, plan outline and checks of a canopy on a hull edge (see file head).
 * @param {Vordach} v
 * @param {any} model built model (footprint; createBuildingModel)
 * @param {import("./hoehen.js").Geschosse} [gs]
 * @returns {VordachErgebnis|VordachFehler}
 */
export function vordachBerechnen(v, model, gs) {
  const kante = huellKante(model?.footprint, Number(v?.edge) || 0);
  if (!kante) return { ok: false, grund: "kante", text: "Hüllkante nicht gefunden" };
  const u0 = Math.max(0, Math.min(Number(v?.u_von_m) || 0, Number(v?.u_bis_m) || 0));
  const u1 = Math.min(kante.len, Math.max(Number(v?.u_von_m) || 0, Number(v?.u_bis_m) || 0));
  if (u1 - u0 < 0.3) return { ok: false, grund: "breite", text: "Vordach zu schmal (unter 0,30 m)" };
  const tiefe = Number(v?.tiefe_m) > 0 ? Number(v.tiefe_m) : VORDACH_STANDARD.tiefe_m;
  if (tiefe < 0.2) return { ok: false, grund: "tiefe", text: "Vordach zu flach (Ausladung unter 0,20 m)" };
  const level = Number.isFinite(Number(v?.level)) ? Math.round(Number(v.level)) : 0;
  const uk = Number(v?.unterkante_m) > 0 ? Number(v.unterkante_m) : VORDACH_STANDARD.unterkante_m;
  const dicke = Number(v?.dicke_m) > 0 ? Number(v.dicke_m) : VORDACH_STANDARD.dicke_m;
  const yUnten = elevationOf(level, gs) + uk;
  const yOben = yUnten + dicke;
  // plan point at u along the edge and d outwards from the outer wall face
  const P = (/** @type {number} */ u, /** @type {number} */ d) => ({ x: kante.a.x + kante.e.x * u + kante.aussen.x * d, z: kante.a.z + kante.e.z * u + kante.aussen.z * d });
  const p3 = (/** @type {PktXZ} */ p, /** @type {number} */ y) => ({ x: r3(p.x), y: r3(y), z: r3(p.z) });
  /** Box corners for u-range × d-range × y-range, in the order of VordachErgebnis.platte. */
  const quader = (/** @type {number} */ ua, /** @type {number} */ ub, /** @type {number} */ da, /** @type {number} */ db, /** @type {number} */ ya, /** @type {number} */ yb) => {
    const ring = [P(ua, da), P(ub, da), P(ub, db), P(ua, db)];
    return [...ring.map((p) => p3(p, ya)), ...ring.map((p) => p3(p, yb))];
  };
  const platte = quader(u0, u1, 0, tiefe, yUnten, yOben);
  const n = Math.max(0, Math.min(6, Math.round(Number.isFinite(Number(v?.konsolen)) ? Number(v.konsolen) : VORDACH_STANDARD.konsolen)));
  /** @type {Pkt3[][]} */
  const konsolen = [];
  const rand = Math.min(KONSOLE.randabstand_m, (u1 - u0) / 4);
  for (let i = 0; i < n; i += 1) {
    const um = n === 1 ? (u0 + u1) / 2 : u0 + rand + ((u1 - u0 - 2 * rand) * i) / (n - 1);
    konsolen.push(quader(um - KONSOLE.breite_m / 2, um + KONSOLE.breite_m / 2, 0, Math.max(0.1, tiefe - 0.1), yUnten - KONSOLE.hoehe_m, yUnten));
  }
  /** @type {VordachErgebnis["warnungen"]} */
  const warnungen = [];
  // warn, not fail: both are questions for the planner (setback areas depend on the plot, the door height on the door), the
  // canopy itself is drawable either way
  if (tiefe > VORDACH_TIEFE_ABSTAND_M + 1e-9) warnungen.push({ code: "vordach_abstand", text: "Vordach tritt mehr als 1,50 m vor — Abstandsflächen prüfen", wert: r3(tiefe) });
  if (uk < VORDACH_LICHTE_HOEHE_M - 1e-9) warnungen.push({ code: "vordach_hoehe", text: "Unterkante unter 2,10 m — lichte Höhe über der Tür prüfen", wert: r3(uk) });
  return {
    ok: true, level, breite_m: r3(u1 - u0), tiefe_m: r3(tiefe), dicke_m: r3(dicke), flaeche_m2: r3((u1 - u0) * tiefe), y_unten_m: r3(yUnten), y_oben_m: r3(yOben),
    platte, konsolen,
    grundriss: [P(u0, 0), P(u1, 0), P(u1, tiefe), P(u0, tiefe)].map((p) => ({ x: r3(p.x), z: r3(p.z) })),
    warnungen,
  };
}

/** Faces of a box given as 8 corners (4 bottom, 4 top, same order): bottom, top and the four sides. */
const QUADER_FLAECHEN = Object.freeze([[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);

/**
 * Triangle list of a box for a three.js BufferGeometry (9 numbers per triangle, 12 triangles). The winding follows the corner
 * order, which depends on the direction of the hull edge — draw it double-sided.
 * @param {Pkt3[]} p8 corners as VordachErgebnis.platte
 * @returns {number[]}
 */
export function quaderDreiecke(p8) {
  /** @type {number[]} */
  const pos = [];
  for (const f of QUADER_FLAECHEN) {
    const [a, b, c, d] = f.map((i) => p8[i]);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
  return pos;
}

/**
 * A new canopy for "Vordach einfügen": on `edge`, VORDACH_STANDARD wide and centred on the edge (or at `u_mitte_m`, e.g. the
 * centre of the front door).
 * @param {PktXZ[]} fp footprint in m
 * @param {number} edge
 * @param {number} idx
 * @param {number|null} [u_mitte_m] centre along the edge, m
 * @param {number} [level] storey, default ground floor
 * @returns {Vordach}
 */
export function neuesVordach(fp, edge, idx, u_mitte_m = null, level = 0) {
  const k = huellKante(fp, edge);
  const len = k ? k.len : VORDACH_STANDARD.breite_m * 2;
  const m = u_mitte_m != null ? Number(u_mitte_m) : len / 2;
  const hb = VORDACH_STANDARD.breite_m / 2;
  return {
    _idx: idx, edge, u_von_m: r3(Math.max(0, m - hb)), u_bis_m: r3(Math.min(len, m + hb)), level,
    tiefe_m: VORDACH_STANDARD.tiefe_m, unterkante_m: VORDACH_STANDARD.unterkante_m, dicke_m: VORDACH_STANDARD.dicke_m, konsolen: VORDACH_STANDARD.konsolen, material: "glas",
  };
}
