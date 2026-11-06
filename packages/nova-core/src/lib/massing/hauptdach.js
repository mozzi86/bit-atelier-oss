// 108-11: the main body of the Massing-Studio WITH the global roof of the building model. Until 108-11 the studio extruded the
// footprint to storeys × storey height (a flat box) and never read the roof form; for a single-family house with a gable roof the
// iso, the key figure "height" and the setback strips were those of a box 2.7 m lower than the ridge.
//
// One roof computation: this module builds the building model with createBuildingModel (the same programme fields the BIM studio
// passes: footprint, storeys, storey height, storey table with the knee wall, basements, roof form and slope, hull slab thickness and
// reference side) and asks dachGeometrie.globalesDach(model, form, slope, storey table) for the roof — the very call the BIM studio's
// 3D view, its section and the IFC export make. Eaves = ebenen.globaleTraufhoehe_m (knee wall rule of buildingModel.kniestockGeometrie),
// ridge = eaves + globalerDachAnstieg_m, ridge direction "laengs" (along the longer side of the roof frame) as in the building model.
// Nothing here computes a slope, an eaves or a ridge height itself.
//
// Frames: the footprint can be handed in any plan frame {x, z} in m — the roof (dachRahmen) only depends on the shape, so the studio
// hands its live polygon in SITE metres ({x: p.x, z: p.y}) and gets the roof faces back in that frame.
//
// In:  programme fields (createBuildingModel input) + roof form/slope of the BimModel record.
// Out: hauptkoerperDach() — eaves, ridge, roof faces, wall infill of a shed roof, storey planes, volume (BRI study), frame flag;
//      abstandsHoehenJeKante() — wall height H of the setback rule per footprint edge (eaves side / gable side / high side of a shed
//      roof) with the roof surcharge of dachZuschlagAnteil() for slopes above 45°.
// Pure module, no DOM, no React, no three.js.

import { createBuildingModel } from "../buildingModel.js";
import { globalesDach } from "../bauteil/dachGeometrie.js";
import { geschosseAus } from "../bauteil/hoehen.js";

/** Roof forms with a slope that put a roof on the main body (a flat roof keeps the box of before). */
export const GENEIGTE_HAUPTDAECHER = Object.freeze(["sattel", "walm", "pult"]);

/**
 * Share of the gable triangle height that counts towards the wall height H of a GABLE side in the setback rule. [ASSUMED] 1/3 — a
 * placeholder of this study, independent of the slope: state building codes treat gable areas differently (by a third, a quarter, a
 * half, or by the mean wall height), and the slope rule of MBO § 6 Abs. 4 is a different rule for roof faces (DACH_ZUSCHLAG below).
 * Way to a checked value: the state of the project (Baurecht research of the project) decides the share. Shown in the studio as an
 * assumption next to the key figure.
 */
export const GIEBEL_ANRECHNUNG = 1 / 3;

/**
 * Roof surcharge on the wall height H of a side under a roof face (eaves side, hip side, low side of a shed roof). [ASSUMED] the
 * wording of MBO § 6 Abs. 4: the height of roofs steeper than 70° counts fully, steeper than 45° by one third, up to 45° nothing.
 * State law may differ; way to a checked value: the Baurecht research of the project. Steepest step first. Shown in the studio as an
 * assumption whenever it applies.
 */
export const DACH_ZUSCHLAG = Object.freeze([Object.freeze({ ab_grad: 70, anteil: 1 }), Object.freeze({ ab_grad: 45, anteil: 1 / 3 })]);

/**
 * Share of the roof rise that counts towards H under a roof face of this slope (DACH_ZUSCHLAG). [ASSUMED]
 * @param {number|null|undefined} grad roof slope in degrees
 * @returns {number} 0, 1/3 or 1 (share of the rise, dimensionless)
 */
export function dachZuschlagAnteil(grad) {
  const g = Number(grad);
  if (!Number.isFinite(g)) return 0;
  for (const stufe of DACH_ZUSCHLAG) if (g > stufe.ab_grad) return stufe.anteil;
  return 0;
}

/**
 * @typedef {object} HauptkoerperDach
 * @property {string} form                  "sattel" | "walm" | "pult"
 * @property {number} neigung_grad          slope of the roof faces in degrees (as dachBerechnen reports it, after the clamps of GLOBAL_DACH)
 * @property {number} traufhoehe_m          eaves above ±0.00, m (top of the walls of the main body)
 * @property {number} firsthoehe_m          ridge above ±0.00, m (shed roof: the high eave)
 * @property {number} anstieg_m             ridge − eaves, m
 * @property {number|null} kniestock_m      knee wall of the top storey, m (null = none)
 * @property {number} fusshoehe_m           lowest point of the body (bottom of the lowest basement, 0 without basement), m
 * @property {number[]} geschossEbenen_m    storey planes above ground between ±0.00 and the eaves (elevations of the storeys 1 … n−1), m
 * @property {number} wandObenAnteil         wall height of the top storey (eaves − its elevation) as a share of its storey height (1 = no
 *   knee wall; a knee wall storey is lower) — for schematic viewers that draw storeys of one height
 * @property {any} dach                     DachErgebnis of globalesDach in the frame of the given footprint (rahmen, punkte, flaechen)
 * @property {Array<{id: string, art: "wand", punkte3d: Array<{x: number, y: number, z: number}>}>} wandFlaechen  wall infill above the
 *   eaves that the roof faces leave open, in the frame of the footprint, m — shed roof: the high-side wall (eaves → high eave) and the
 *   two side triangles; gable/hip: none (their gable triangles are roof faces of art "giebel")
 * @property {boolean} dachUeberRahmen      true when the footprint is not its roof frame (non-rectangular outline): roof, wall infill and
 *   dachVolumen_m3 then belong to the frame (bounding box), i.e. the BRI is an approximation
 * @property {number} grundflaeche_m2       area of the footprint, m²
 * @property {number} wandVolumen_m3        footprint × (eaves − fusshoehe_m), m³
 * @property {number} dachVolumen_m3        volume between the eaves plane and the roof faces over the roof frame, m³
 * @property {number} bri_m3                wandVolumen_m3 + dachVolumen_m3 (gross volume study, DIN 277 idea without build-up), m³
 */

/**
 * Shoelace area of a plan outline.
 * @param {Array<{x: number, z: number}>} fp outline, m
 * @returns {number} m²
 */
function flaecheXZ(fp) {
  let a = 0;
  for (let i = 0; i < fp.length; i += 1) { const q = fp[(i + 1) % fp.length]; a += fp[i].x * q.z - q.x * fp[i].z; }
  return Math.abs(a) / 2;
}

/**
 * Volume between the eaves plane and the roof over the roof frame (a rectangle 2·halbL × 2·halbB): the prismatoid formula
 * V = b · H / 6 · (2a + r) with a = frame length along the ridge, b = frame width across it, H = rise, r = ridge length — exact for
 * the plane faces of dachBerechnen (gable and shed: r = a → a·b·H/2; hip: ridge shortened by WALM_EINRUECKUNG_ANTEIL; pyramid: r = 0
 * → a·b·H/3). A non-rectangular footprint carries the roof of its bounding box (dachRahmen rule), so the value is the drawn roof.
 * @param {any} dach DachErgebnis
 * @returns {number} m³
 */
function dachVolumen_m3(dach) {
  const r = dach?.rahmen;
  if (!r) return 0;
  const a = 2 * r.halbL_m, b = 2 * r.halbB_m, H = Number(dach.anstieg_m) || 0;
  const f0 = (dach.punkte || []).find((/** @type {any} */ p) => p.id === "f0");
  const f1 = (dach.punkte || []).find((/** @type {any} */ p) => p.id === "f1");
  const first = f0 && f1 ? Math.hypot(f1.x - f0.x, f1.z - f0.z) : a; // shed roof: no ridge points, the wedge has r = a
  return (b * H / 6) * (2 * a + first);
}

/**
 * Wall infill of a shed roof above the eaves (dachBerechnen: one face from the low eave t0–t1 up to the high eave t2–t3): the walls of
 * the body end at the (low) eaves, so the high-side wall t2–t3 from the eaves up to the high eave and the two side triangles (t0, t3
 * and t1, t2) close the wedge. Gable and hip roofs need none (their gable triangles are roof faces of art "giebel").
 * @param {any} dach DachErgebnis
 * @returns {Array<{id: string, art: "wand", punkte3d: Array<{x: number, y: number, z: number}>}>} faces in the frame of the roof, m
 */
function wandFlaechenUeberTraufe(dach) {
  if (dach?.form !== "pult" || !(Number(dach.anstieg_m) > 1e-9)) return [];
  /** @param {string} id */
  const p = (id) => (dach.punkte || []).find((/** @type {any} */ q) => q.id === id);
  const t0 = p("t0"), t1 = p("t1"), t2 = p("t2"), t3 = p("t3");
  if (!t0 || !t1 || !t2 || !t3) return [];
  const y0 = Number(dach.traufhoehe_m);
  /** @param {any} q */
  const unten = (q) => ({ x: q.x, y: y0, z: q.z });
  /** @param {any} q */
  const oben = (q) => ({ x: q.x, y: q.y, z: q.z });
  return [
    { id: "pult-hochwand", art: "wand", punkte3d: [unten(t2), unten(t3), oben(t3), oben(t2)] },
    { id: "pult-seite-1", art: "wand", punkte3d: [oben(t0), unten(t3), oben(t3)] },
    { id: "pult-seite-2", art: "wand", punkte3d: [oben(t1), oben(t2), unten(t2)] },
  ];
}

/**
 * The main body of the Massing-Studio with the global roof of the building model (see file head). Same input as createBuildingModel
 * plus the roof form of the record; deckenDicke / deckenBezug are the hull slab fields of the record (they move the eaves of a knee
 * wall, kniestockGeometrie).
 * @param {{footprintM?: Array<{x: number, z: number}>|null, storeys?: number, storeyHeight?: number, geschosse?: Array<any>|null,
 *          untergeschosse?: number, dachform?: string|null, dachneigung?: number|null, deckenDicke?: number, deckenBezug?: string}} q
 *   footprint in m (any plan frame), storeys above ground, storey height in m, storey table, basements, roof form, slope in degrees,
 *   hull slab thickness in m and reference side ("unten" | "oben")
 * @returns {HauptkoerperDach|null} null for a flat roof, no roof form, no valid footprint or a roof the library does not compute — the
 *   caller then keeps the box of before
 */
export function hauptkoerperDach({ footprintM, storeys = 1, storeyHeight = 3, geschosse = null, untergeschosse = 0, dachform = null, dachneigung = null, deckenDicke, deckenBezug } = {}) {
  if (!dachform || !GENEIGTE_HAUPTDAECHER.includes(dachform)) return null;
  const fp = (Array.isArray(footprintM) ? footprintM : []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z));
  if (fp.length < 3) return null;
  const model = createBuildingModel({
    footprintM: fp, storeys, storeyHeight, geschosse, untergeschosse, dachform, dachneigung,
    ...(deckenDicke != null ? { deckenDicke } : {}), ...(deckenBezug === "oben" || deckenBezug === "unten" ? { deckenBezug } : {}),
  });
  const gs = geschosseAus({ geschosse, storeyHeight });
  // the call of the BIM studio (BitBimStudio globalDach / roof mesh): same model, form, slope and storey table
  const dach = globalesDach(model, dachform, Number(dachneigung), gs);
  if (!dach || !dach.ok) return null;
  const traufhoehe_m = dach.traufhoehe_m;
  const firsthoehe_m = traufhoehe_m + dach.anstieg_m;
  const fusshoehe_m = Number(model.fusshoehe_m) < 0 ? Number(model.fusshoehe_m) : 0;
  const geschossEbenen_m = model.storeys
    .filter((/** @type {any} */ s) => !s.unterirdisch && s.level > 0 && s.elevation > 1e-6 && s.elevation < traufhoehe_m - 1e-6)
    .map((/** @type {any} */ s) => s.elevation);
  const oben = model.storeys.filter((/** @type {any} */ s) => !s.unterirdisch).reduce((/** @type {any} */ a, /** @type {any} */ s) => (s.level > a.level ? s : a));
  const hoeheOben = Number(model.totalHeight) - oben.elevation;
  const wandObenAnteil = hoeheOben > 1e-6 ? Math.max(0, (traufhoehe_m - oben.elevation) / hoeheOben) : 1;
  const grundflaeche_m2 = flaecheXZ(fp);
  const wandVolumen_m3 = grundflaeche_m2 * (traufhoehe_m - fusshoehe_m);
  const dv = dachVolumen_m3(dach);
  const rahmenFlaeche = 4 * Number(dach.rahmen?.halbL_m || 0) * Number(dach.rahmen?.halbB_m || 0);
  // 0.5 % tolerance: a drawn rectangle carries the rounding of its corners
  const dachUeberRahmen = rahmenFlaeche > 0 && Math.abs(rahmenFlaeche - grundflaeche_m2) > 0.005 * rahmenFlaeche;
  return {
    form: dachform, neigung_grad: dach.neigung_grad, traufhoehe_m, firsthoehe_m, anstieg_m: dach.anstieg_m,
    kniestock_m: model.kniestock_m != null ? Number(model.kniestock_m) : null, fusshoehe_m, geschossEbenen_m, wandObenAnteil, dach,
    wandFlaechen: wandFlaechenUeberTraufe(dach), dachUeberRahmen, grundflaeche_m2, wandVolumen_m3, dachVolumen_m3: dv, bri_m3: wandVolumen_m3 + dv,
  };
}

/**
 * @typedef {{art: "traufe"|"giebel"|"hochseite", hoehe_m: number}} KantenHoehe
 */

/**
 * Wall height H of the setback rule per footprint edge (edge i runs from point i to point i+1), for the main body with its roof:
 *  - eaves side (edge along the ridge; every side of a hip roof; the low side of a shed roof): H = eaves height + roof surcharge
 *    dachZuschlagAnteil × rise (0 up to 45°, 1/3 above 45°, fully above 70° — DACH_ZUSCHLAG [ASSUMED])
 *  - gable side (edge across the ridge; the two ends of a gable or shed roof): H = eaves height + share × rise, share = the larger of
 *    GIEBEL_ANRECHNUNG [ASSUMED] and the roof surcharge (a roof steeper than 70° then counts fully on every side)
 *  - high side of a shed roof (the wall that runs up to the high eave): H = ridge height (the whole wall; the roof ends there)
 * The side is read from the direction of the edge against the roof frame (|along the ridge| ≥ |across| → eaves side), the high side
 * of a shed roof from the position of the edge middle (on the +v side of the frame). Heights above ±0.00 (no terrain; the setback
 * study of the studio has none either).
 * @param {Array<{x: number, y: number}>} poly footprint in site metres {x, y}, the SAME points (as {x, z: y}) hauptkoerperDach got
 * @param {HauptkoerperDach|null} hd hauptkoerperDach result
 * @param {{giebelAnteil?: number}} [opt] share of the gable triangle (default GIEBEL_ANRECHNUNG)
 * @returns {KantenHoehe[]|null} one entry per edge; null without a roof (the caller keeps one height for all edges)
 */
export function abstandsHoehenJeKante(poly, hd, { giebelAnteil = GIEBEL_ANRECHNUNG } = {}) {
  if (!hd || !hd.dach?.rahmen || !Array.isArray(poly) || poly.length < 3) return null;
  const { u, v, mitte } = hd.dach.rahmen;
  const anteil = Number.isFinite(Number(giebelAnteil)) ? Math.max(0, Math.min(1, Number(giebelAnteil))) : GIEBEL_ANRECHNUNG;
  const zuschlag = dachZuschlagAnteil(hd.neigung_grad);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.y - a.y;
    const laengs = Math.abs(dx * u.x + dz * u.z) >= Math.abs(dx * v.x + dz * v.z);
    if (hd.form === "walm" || laengs) {
      // shed roof: the eaves side on the +v half of the frame rises to the high eave (dachBerechnen: t2–t3 at eaves + rise)
      const mx = (a.x + b.x) / 2 - mitte.x, mz = (a.y + b.y) / 2 - mitte.z;
      if (hd.form === "pult" && laengs && mx * v.x + mz * v.z > 0) return { art: "hochseite", hoehe_m: hd.firsthoehe_m };
      return { art: "traufe", hoehe_m: hd.traufhoehe_m + zuschlag * hd.anstieg_m };
    }
    return { art: "giebel", hoehe_m: hd.traufhoehe_m + Math.max(anteil, zuschlag) * hd.anstieg_m };
  });
}
