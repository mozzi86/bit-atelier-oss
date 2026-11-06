// 107-14: the seam between the CSG core and the boolean library. Everything above this file (bauteil.js, the callers of
// 107-09/10) talks to a CsgBackend; only kern.js implements it and is the only file that imports a boolean library.
// 107-18 (D-BK-08c): kern.js implements it with manifold-3d (it replaced three-bvh-csg + three-mesh-bvh); no caller changed.
// A further backend would be a second implementation of the same typedef, chosen in laden.js.
//
// booleschMit() is the backend-independent wrapper with the safeguards of D-BK-08b: watertight check of BOTH inputs
// before the operation (an open input must never reach the library), clean-up of the result (draw range, index rests) and
// its volume. The raw operations of a backend (subtract/union/intersect) have NO such check — callers use boolesch() of
// kern.js (= booleschMit on that backend), never the backend directly. A backend that refuses an input on its own
// (manifold-3d: status NotManifold) throws CsgAblehnung("offen", input); booleschMit turns that into the same refusal as
// the watertight check, so callers see one reason for "this input is not a closed solid" whichever line caught it.
// A layered wall from wandSolid is several closed solids side by side, not one: a further boolean runs per layer
// (geometrieJeGruppe in dreiecke.js); the glued body would be refused as "offen".
//
// In: a backend, two clean geometries (m, groups per material index), an operation name. Out: {ok, geometrie, …} or a
// refusal {ok: false, grund, eingabe, bericht}.

import { geometrieBereinigen, dreieckAnzahl } from "./dreiecke.js";

/**
 * @typedef {import("three").BufferGeometry} Geo
 * @typedef {object} CsgBackend
 * @property {string} name                        library name (for messages and the cache version)
 * @property {string} version                     derivation version (basisHash.CSG_VERSION of this backend)
 * @property {(a: Geo, b: Geo, opt?: {toleranz_m?: number}) => Geo} subtract   a minus b; result non-indexed, groups keep the
 *   input material indices; opt.toleranz_m: the weld tolerance (m) of the watertight check, so the backend prepares its
 *   inputs with the same tolerance the check used
 * @property {(a: Geo, b: Geo, opt?: {toleranz_m?: number}) => Geo} union      a plus b
 * @property {(a: Geo, b: Geo, opt?: {toleranz_m?: number}) => Geo} intersect  common part of a and b
 * @property {(g: Geo, opt?: {toleranz_m?: number}) => import("./wasserdicht.js").WasserdichtBericht} watertight  check before every boolean
 * @property {(g: Geo) => number} volume          signed volume in m³
 */

/**
 * Refusal thrown by a backend operation (107-18). grund "offen": the library does not accept an input as a closed,
 * oriented 2-manifold; "fehler": the library reported an error status for the result. The message keeps the library's
 * status code (English, technical; the UI shows the component warning, not this text).
 */
export class CsgAblehnung extends Error {
  /**
   * @param {"offen"|"fehler"} grund
   * @param {"a"|"b"|null} eingabe the refused input (null for a result error)
   * @param {string} text technical message with the library status
   */
  constructor(grund, eingabe, text) {
    super(text);
    this.name = "CsgAblehnung";
    this.grund = grund;
    this.eingabe = eingabe;
  }
}

/** The operations of booleschMit. */
export const OPERATIONEN = Object.freeze(["subtract", "union", "intersect"]);

/**
 * @typedef {object} BooleschOk
 * @property {true} ok
 * @property {Geo} geometrie   clean result (non-indexed, groups per material index, flat normals), m
 * @property {number} dreiecke
 * @property {number} volumen_m3
 * @typedef {object} BooleschNein
 * @property {false} ok
 * @property {"offen"|"leer"|"fehler"} grund  offen = an input is not watertight (own check or refused by the library);
 *   leer = an input has no triangle; fehler = the library threw or reported an error status for the result
 * @property {"a"|"b"|null} eingabe
 * @property {import("./wasserdicht.js").WasserdichtBericht|null} bericht  report of the own watertight check; null when the
 *   library refused the input (its report said ok, the reason is in text) or for a result error
 * @property {string} [text]
 */

/**
 * One boolean with the D-BK-08b safeguards (see file head). No operation runs on an open input.
 * @param {CsgBackend} backend
 * @param {Geo} a first body (m)
 * @param {Geo} b second body (m)
 * @param {"subtract"|"union"|"intersect"} op
 * @param {{toleranz_m?: number}} [opt] weld tolerance of the watertight check in m
 * @returns {BooleschOk|BooleschNein}
 */
export function booleschMit(backend, a, b, op, opt = {}) {
  if (!OPERATIONEN.includes(op)) throw new Error(`unknown CSG operation: ${op}`);
  for (const [name, g] of /** @type {Array<["a"|"b", Geo]>} */ ([["a", a], ["b", b]])) {
    const bericht = backend.watertight(g, opt);
    if (bericht.dreiecke === 0) return { ok: false, grund: "leer", eingabe: name, bericht };
    if (!bericht.ok) return { ok: false, grund: "offen", eingabe: name, bericht };
  }
  let roh;
  try {
    roh = backend[op](a, b, opt);
  } catch (e) {
    const text = String(/** @type {any} */ (e)?.message || e);
    if (e instanceof CsgAblehnung && e.grund === "offen" && e.eingabe) {
      // bericht null: the own check passed this input (its report says ok / 0 open edges), so it must not be shown as the
      // reason of this refusal; the library's reason is in text
      return { ok: false, grund: "offen", eingabe: e.eingabe, bericht: null, text };
    }
    return { ok: false, grund: "fehler", eingabe: null, bericht: null, text };
  }
  // the backend already returns a clean geometry; a second pass only when it did not (index or a partial draw range)
  const voll = !roh.getIndex() && (roh.drawRange.start === 0 && (!Number.isFinite(roh.drawRange.count) || roh.drawRange.count >= roh.getAttribute("position").count));
  const geometrie = voll ? roh : geometrieBereinigen(roh);
  if (geometrie !== roh) roh.dispose();
  return { ok: true, geometrie, dreiecke: dreieckAnzahl(geometrie), volumen_m3: backend.volume(geometrie) };
}
