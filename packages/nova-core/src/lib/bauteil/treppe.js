// 108-06 (D-EFH-08): stairs as building elements of the BIM studio — the data form of `customStairs`, the step geometry from the
// storey height (DIN 18065 step rule), the derived slab opening above the run and the 3D step bodies. Pure mathematics, no three.js,
// no React: the studio (3D, inspector, "Treppe einfügen"), the plan symbol (plan/treppeSymbol.js), the PDF plan, the IFC export
// (IfcStair / IfcStairFlight) and the quantities (bimClassification) all read the SAME result from here.
//
// Record (`customStairs[]`, all lengths in m): {_idx, level, art: "gerade", start: {x, z}, richtung_grad, breite_m, steigungen?,
//   auftritt_m?, loch_breite_m?, guid?}. `start` = middle of the first riser (Antritt), `richtung_grad` = direction of ascent in the
//   plan (0 = +x, 90 = +z, counter-clockwise seen from above as the plan draws it), `steigungen` / `auftritt_m` override the rule.
//   Only straight single flights ("gerade") are computed; a landing stair ("podest", plan 108-06) is open — the record form leaves room.
//
// Rules ([ASSUMED] until the norm check, D-EFH-08 — every deviation is a WARNING, never a block: the liability stays with the planner):
//  - number of risers n = round(storey height / 0.175 m) (target riser 17.5 cm), at least 2
//  - riser s = height / n, tread a = 0.63 − 2 s (step rule 2 s + a = 63 cm), run length = (n − 1) · a (the top step is the floor above)
//  - DIN 18065 Tab. 1, dwellings with up to two flats: s 14–20 cm, a 23–37 cm, usable width ≥ 0.80 m; step rule 59–65 cm
//  - headroom over the walking line ≥ 2.00 m: the slab opening above the run reaches from the last riser back to the first tread
//    whose top edge still leaves 2.00 m under the slab
//
// In:  stair record, storey height (hoehen.geschosshoehe), slab underside above the run.
// Out: treppeBerechnen (steps, outline, walking line, warnings), treppenLoch (the opening polygon), mitTreppenLoechern (hull slabs with
//      `oeffnungen_abgeleitet`), treppeKoerper (step boxes for 3D and IFC).

import { geschosshoehe, elevationOf, deckenLage } from "./hoehen.js";
import { lochInDecke } from "./oeffnungen.js";

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

const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {object} Treppe
 * @property {number} [_idx]
 * @property {number} level           storey the flight starts on (its floor = the antritt)
 * @property {"gerade"} [art]
 * @property {PktXZ} start            middle of the first riser, m
 * @property {number} richtung_grad   direction of ascent in plan, degrees (0 = +x, 90 = +z)
 * @property {number} breite_m        usable width, m
 * @property {number} [steigungen]    override: number of risers
 * @property {number} [auftritt_m]    override: tread depth, m
 * @property {number} [loch_breite_m] override: width of the slab opening, m (default = breite_m)
 * @property {string} [guid]
 * @typedef {{code: string, text: string, wert: number, grenze: number}} TreppenWarnung
 * @typedef {object} TreppenErgebnis
 * @property {number} n               risers
 * @property {number} s_m             riser height, m
 * @property {number} a_m             tread depth, m
 * @property {number} schrittmass_m   2 s + a, m
 * @property {number} laufLaenge_m    (n − 1) · a, m
 * @property {number} hoehe_m         storey height the flight climbs, m
 * @property {PktXZ} richtung         unit vector of ascent
 * @property {PktXZ} quer             unit vector across the flight (left of the ascent)
 * @property {PktXZ[]} umriss         four corners of the flight in plan, m
 * @property {Array<{vorne: [PktXZ, PktXZ], abstand_m: number, hoehe_m: number}>} stufen  one entry per riser: its front line, distance from the antritt, top height
 * @property {PktXZ[]} lauflinie      walking line from antritt to austritt (middle of the flight)
 * @property {TreppenWarnung[]} warnungen
 */

/**
 * Point along the flight: `d` m from the antritt in the direction of ascent, `q` m across (positive = left of the ascent).
 * @param {Treppe} t @param {PktXZ} dir @param {PktXZ} quer @param {number} d @param {number} q @returns {PktXZ}
 */
function punkt(t, dir, quer, d, q) {
  return { x: r3(t.start.x + dir.x * d + quer.x * q), z: r3(t.start.z + dir.z * d + quer.z * q) };
}

/**
 * Direction vectors of a stair record.
 * @param {Treppe} t
 * @returns {{dir: PktXZ, quer: PktXZ}}
 */
export function treppenRichtung(t) {
  const a = ((Number(t?.richtung_grad) || 0) * Math.PI) / 180;
  const dir = { x: Math.cos(a), z: Math.sin(a) };
  return { dir, quer: { x: -dir.z, z: dir.x } };
}

/**
 * Steps of a straight flight from the storey height (see file head for the rules).
 * @param {Treppe} t
 * @param {number} hoehe_m storey height the flight climbs, m (hoehen.geschosshoehe of t.level)
 * @returns {TreppenErgebnis}
 */
export function treppeBerechnen(t, hoehe_m) {
  const h = Math.max(0.1, Number(hoehe_m) || 0);
  const b = Math.max(0.1, Number(t?.breite_m) || STANDARD_BREITE_M);
  const nOverride = Math.round(Number(t?.steigungen));
  const n = Math.max(2, Number.isFinite(nOverride) && nOverride > 0 ? nOverride : Math.round(h / SOLL_STEIGUNG_M));
  const s = h / n;
  const aOverride = Number(t?.auftritt_m);
  const a = Math.max(0.15, Number.isFinite(aOverride) && aOverride > 0 ? aOverride : SCHRITTMASS_M - 2 * s);
  const lauf = (n - 1) * a;
  const { dir, quer } = treppenRichtung(t);
  const hb = b / 2;
  const umriss = [punkt(t, dir, quer, 0, -hb), punkt(t, dir, quer, lauf, -hb), punkt(t, dir, quer, lauf, hb), punkt(t, dir, quer, 0, hb)];
  /** @type {TreppenErgebnis["stufen"]} */
  const stufen = [];
  for (let k = 1; k <= n; k += 1) {
    const d = (k - 1) * a;
    stufen.push({ vorne: [punkt(t, dir, quer, d, -hb), punkt(t, dir, quer, d, hb)], abstand_m: d, hoehe_m: k * s });
  }
  const schritt = 2 * s + a;
  /** @type {TreppenWarnung[]} */
  const warnungen = [];
  // `warn`, never `fail`: the values are [ASSUMED] placeholders of DIN 18065 and the planner decides (D-EFH-08)
  if (s < DIN_18065_WOHNEN.s_min) warnungen.push({ code: "steigung_niedrig", text: "Steigung unter 14 cm (DIN 18065 Tab. 1)", wert: r3(s), grenze: DIN_18065_WOHNEN.s_min });
  if (s > DIN_18065_WOHNEN.s_max) warnungen.push({ code: "steigung_hoch", text: "Steigung über 20 cm (DIN 18065 Tab. 1)", wert: r3(s), grenze: DIN_18065_WOHNEN.s_max });
  if (a < DIN_18065_WOHNEN.a_min) warnungen.push({ code: "auftritt_klein", text: "Auftritt unter 23 cm (DIN 18065 Tab. 1)", wert: r3(a), grenze: DIN_18065_WOHNEN.a_min });
  if (a > DIN_18065_WOHNEN.a_max) warnungen.push({ code: "auftritt_gross", text: "Auftritt über 37 cm (DIN 18065 Tab. 1)", wert: r3(a), grenze: DIN_18065_WOHNEN.a_max });
  if (schritt < SCHRITTMASS_BEREICH_M.min || schritt > SCHRITTMASS_BEREICH_M.max) warnungen.push({ code: "schrittmass", text: "Schrittmaß 2s + a außerhalb 59…65 cm", wert: r3(schritt), grenze: SCHRITTMASS_M });
  if (b < DIN_18065_WOHNEN.breite_min) warnungen.push({ code: "breite", text: "Nutzbare Laufbreite unter 0,80 m (DIN 18065 Tab. 1)", wert: r3(b), grenze: DIN_18065_WOHNEN.breite_min });
  return {
    // exact values (no rounding) — every consumer derives from them; only the plan label rounds (treppenText)
    n, s_m: s, a_m: a, schrittmass_m: schritt, laufLaenge_m: lauf, hoehe_m: h, richtung: dir, quer, umriss, stufen,
    lauflinie: [punkt(t, dir, quer, 0, 0), punkt(t, dir, quer, lauf, 0)], warnungen,
  };
}

/**
 * The slab opening above a flight: from the last riser (austritt, the floor above) back to the first tread whose top still leaves
 * KOPFHOEHE_MIN_M under the slab. A person on tread k stands at height k · s, so k_max = floor((UK − 2.00) / s); the opening starts at
 * the front edge of tread k_max + 1 (distance k_max · a) and ends at the austritt ((n − 1) · a). Width = `loch_breite_m` or the flight
 * width, centred on the flight (a stringer side can be added with the override).
 * @param {Treppe} t
 * @param {TreppenErgebnis} erg treppeBerechnen
 * @param {number} uk_m underside of the slab above, m above the floor the flight starts on
 * @param {{kopfhoehe_m?: number}} [opt]
 * @returns {{points: PktXZ[], laenge_m: number, breite_m: number, kopfhoehe_m: number, warnung: TreppenWarnung|null}|null} null when the slab lies above the austritt by less than nothing (no opening needed)
 */
export function treppenLoch(t, erg, uk_m, opt = {}) {
  const kopf = Number(opt?.kopfhoehe_m) > 0 ? Number(opt.kopfhoehe_m) : KOPFHOEHE_MIN_M;
  const uk = Number(uk_m);
  if (!Number.isFinite(uk) || uk <= 0) return null;
  const kMax = Math.max(0, Math.floor((uk - kopf) / erg.s_m + 1e-9));
  const von = Math.min(kMax, erg.n - 1) * erg.a_m;
  const bis = erg.laufLaenge_m;
  const laenge = bis - von;
  if (laenge <= 0.005) return null;
  const b = Number(t?.loch_breite_m) > 0 ? Number(t.loch_breite_m) : Math.max(0.1, Number(t?.breite_m) || STANDARD_BREITE_M);
  const { dir, quer } = treppenRichtung(t);
  const hb = b / 2;
  // the opening ends at the austritt edge; the floor above continues from there
  const points = [punkt(t, dir, quer, von, -hb), punkt(t, dir, quer, bis, -hb), punkt(t, dir, quer, bis, hb), punkt(t, dir, quer, von, hb)];
  // headroom at the first tread UNDER the slab (k_max): UK − k_max · s; below the minimum when the slab is thick and the run short
  const kopfIst = uk - Math.min(kMax, erg.n - 1) * erg.s_m;
  const warnung = kopfIst < kopf - 1e-6 ? { code: "kopfhoehe", text: "Lichte Kopfhöhe unter 2,00 m über der Lauflinie", wert: r3(kopfIst), grenze: kopf } : null;
  return { points, laenge_m: r3(laenge), breite_m: r3(b), kopfhoehe_m: r3(kopfIst), warnung };
}

/**
 * The hull slab ABOVE storey `level` in a built model: createBuildingModel pushes the ceiling of storey L as `{level: L, elevation:
 * elevation(L) + height}`; the base slab (`level` −1 at elevation 0 without basements, or the id "-1") is never a ceiling.
 * @param {any} model built model
 * @param {number} level
 * @param {import("./hoehen.js").Geschosse} [gs]
 * @returns {any|null}
 */
export function deckeUeber(model, level, gs) {
  const boden = elevationOf(level, gs);
  return (Array.isArray(model?.slabs) ? model.slabs : []).find((s) => Math.round(Number(s.level)) === Math.round(level) && s.id !== "-1" && Number(s.elevation) > boden + 1e-6) || null;
}

/**
 * Derived openings of the stairs in a built model: a copy of the model whose hull slabs carry `oeffnungen_abgeleitet: [{points, id}]`
 * for every flight below them (own key, never stored — the stored `oeffnungen` of drawn slabs stay distinguishable). A flight without
 * a slab above (top storey without collar-beam floor) or whose opening does not lie inside the slab outline adds nothing. Without
 * stairs the model object is returned unchanged (same reference: byte-identical downstream).
 * @param {any} model built model (createBuildingModel)
 * @param {Treppe[]|null|undefined} customStairs
 * @param {import("./hoehen.js").Geschosse} [gs]
 * @returns {{model: any, loecher: Array<{level: number, id: string, points: PktXZ[], flaeche_m2: number, treppe: Treppe, ergebnis: TreppenErgebnis, loch: NonNullable<ReturnType<typeof treppenLoch>>}>}}
 */
export function mitTreppenLoechern(model, customStairs, gs) {
  const treppen = Array.isArray(customStairs) ? customStairs.filter((t) => t && t.start) : [];
  if (!treppen.length || !Array.isArray(model?.slabs)) return { model, loecher: [] };
  /** @type {Map<any, Array<{points: PktXZ[], id: string}>>} */
  const jeDecke = new Map();
  /** @type {ReturnType<typeof mitTreppenLoechern>["loecher"]} */
  const loecher = [];
  for (const t of treppen) {
    const lvl = Math.round(Number(t.level) || 0);
    const decke = deckeUeber(model, lvl, gs);
    if (!decke) continue;
    const erg = treppeBerechnen(t, geschosshoehe(lvl, gs));
    const uk = deckenLage(decke, gs, "huelle").unterkante_m - elevationOf(lvl, gs);
    const loch = treppenLoch(t, erg, uk);
    if (!loch || !lochInDecke(loch.points, decke.polygon)) continue;
    const id = `treppe-${t._idx ?? loecher.length + 1}`;
    if (!jeDecke.has(decke)) jeDecke.set(decke, []);
    /** @type {Array<{points: PktXZ[], id: string}>} */ (jeDecke.get(decke)).push({ points: loch.points, id });
    loecher.push({ level: lvl, id, points: loch.points, flaeche_m2: r3(loch.laenge_m * loch.breite_m), treppe: t, ergebnis: erg, loch });
  }
  if (!loecher.length) return { model, loecher: [] };
  const slabs = model.slabs.map((s) => (jeDecke.has(s) ? { ...s, oeffnungen_abgeleitet: jeDecke.get(s) } : s));
  return { model: { ...model, slabs }, loecher };
}

/**
 * Step bodies of a flight for 3D and IFC: one box per tread (k = 1 … n − 1) from its front edge to the next riser, top at k · s, bottom
 * LAUFPLATTE_M below the underside of the flight plate at that place ([ASSUMED] massive flight: the plate follows the slope; the body
 * of tread k reaches down to (k · s − s − LAUFPLATTE_M / cos α), at least to the floor). Coordinates: distance along the flight `d`
 * and heights above the starting floor, so the caller places them with the direction vectors.
 * @param {TreppenErgebnis} erg
 * @returns {Array<{d0_m: number, d1_m: number, unten_m: number, oben_m: number}>}
 */
export function treppeKoerper(erg) {
  const cosA = erg.a_m / Math.hypot(erg.a_m, erg.s_m) || 1;
  /** @type {Array<{d0_m: number, d1_m: number, unten_m: number, oben_m: number}>} */
  const out = [];
  for (let k = 1; k <= erg.n - 1; k += 1) {
    const oben = k * erg.s_m;
    const unten = Math.max(0, oben - erg.s_m - LAUFPLATTE_M / cosA);
    out.push({ d0_m: (k - 1) * erg.a_m, d1_m: k * erg.a_m, unten_m: unten, oben_m: oben });
  }
  return out;
}

/**
 * Text of the plan label "17 Stg 17,1/28,9" (cm, one decimal) — the one spelling for screen, PDF and inspector.
 * @param {TreppenErgebnis} erg
 * @returns {string}
 */
export function treppenText(erg) {
  const cm = (/** @type {number} */ v) => (v * 100).toFixed(1).replace(".", ",");
  return `${erg.n} Stg ${cm(erg.s_m)}/${cm(erg.a_m)}`;
}

/**
 * A new flight for "Treppe einfügen": straight, STANDARD_BREITE_M wide, placed in the middle of `umriss` (the largest room of the level,
 * else the footprint), ascending along the longer side of that outline's bounding box. [ASSUMED] start position — the user moves it.
 * @param {PktXZ[]} umriss polygon in m
 * @param {number} level
 * @param {number} hoehe_m storey height, m
 * @param {number} idx
 * @returns {Treppe}
 */
export function neueTreppe(umriss, level, hoehe_m, idx) {
  const xs = umriss.map((p) => p.x), zs = umriss.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const langsX = maxX - minX >= maxZ - minZ;
  const probe = /** @type {Treppe} */ ({ level, art: "gerade", start: { x: 0, z: 0 }, richtung_grad: langsX ? 0 : 90, breite_m: STANDARD_BREITE_M });
  const lauf = treppeBerechnen(probe, hoehe_m).laufLaenge_m;
  const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
  const start = langsX ? { x: r3(mx - lauf / 2), z: r3(mz) } : { x: r3(mx), z: r3(mz - lauf / 2) };
  return { ...probe, start, _idx: idx };
}
