// 107-11 (spec II.6 d, D-BK-14): the WoFlV partial areas under sloping roofs from the roof GEOMETRY instead of by hand.
//
// WoFlV § 4 counts floor area by clear height: under 1 m 0 %, from 1 m to under 2 m 50 %, from 2 m 100 % (DACHSCHRAEGE in
// wohnungsTypen.js, CITED). Until 107-11 the two partial areas were typed in per unit type (WohnungsWerkstatt, Dachschräge < 1 m /
// 1–2 m). Here they are computed: the roof faces of the roof library (@core/lib/bauteil/dachGeometrie.js, 107-10) are planes, so
// the clear height over a room is the lowest of several linear functions; "height ≥ h" is the intersection of one half-plane per
// face, cut from the room polygon with the convex primitive inKonvex (formGeometrie.js). Exact for every plane roof form
// (flat, gable, hip, shed), no sampling. 108-02: that half-plane area (flaecheAbHoehe) lives in @core/lib/bauteil/lichteHoehe.js now.
//
// The result has EXACTLY the shape woflvFlaeche() reads ({unter1m_m2, zwischen1und2m_m2}), so the hand input and the geometry go
// through the same calculation; the hand input stays the override (`dachschraege_quelle: "hand"` or missing at the unit type in
// werkstatt_layer.einheiten[], v6). A calculation aid, no legal advice: the WoFlV result still needs the planner's check.
//
// In:  room polygon {x, z} in m, roof (DachErgebnis of dachBerechnen, or its face planes), floor height in m (same height frame as
//      the roof). Out: partial areas in m² (3 decimals).

import { dachBerechnen, dachEbenen, globalerDachAnstieg_m } from "@core/lib/bauteil/dachGeometrie.js";
import { flaeche } from "@core/lib/formGeometrie.js";
// 108-02: the half-plane area moved to @core (the full-storey rule there uses it too); unchanged, same results
import { flaecheAbHoehe } from "@core/lib/bauteil/lichteHoehe.js";

/** Clear-height limits of WoFlV § 4 Nr. 1 and 2 in m (CITED, the same limits as DACHSCHRAEGE in wohnungsTypen.js). */
export const WOFLV_HOEHEN_M = Object.freeze({ unten: 1, oben: 2 });

/**
 * Knee wall height of the roof storey in m when the unit type has none: height of the eaves over the finished floor of the top storey.
 * [ASSUMED] 1.0 m — a common knee wall of a converted roof storey (no standard value; regional building law and the design decide).
 * The building model of the BIM studio puts its global roof ON TOP of the top storey (eaves = top of the walls), so a top storey there
 * has full height; the workshop treats its top storey as the roof storey when a unit type takes its sloping areas from the geometry
 * and places the eaves this high above the floor. Way to a decided value: the knee wall of the roof studio (phase 47 / candidate 107-16).
 * 108-02: when the building model has a knee wall (`kniestock_m` on the top storey row, model.kniestock_m) the workshop reads THAT value
 * (one source); this default and the unit type's own field are only the fallback without one.
 */
export const KNIESTOCK_STANDARD_M = 1.0;

/** German names of the roof forms (i18n keys; the same words as the roof select of the BIM studio). */
export const DACHFORM_NAMEN = Object.freeze(/** @type {Record<string, string>} */ ({ flach: "Flachdach", sattel: "Satteldach", walm: "Walmdach", pult: "Pultdach" }));

/** @param {number} v @returns {number} 3 decimals */
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

/**
 * @typedef {{x: number, z: number}} P
 * @typedef {{punkt: {x: number, y: number, z: number}, normale: {x: number, y: number, z: number}}} DachEbene
 */

/**
 * WoFlV partial areas of one room under a roof (D-BK-14): the area with a clear height under 1 m and between 1 m and 2 m, in the shape
 * woflvFlaeche() reads (wohnungsTypen.js). Without roof planes (no roof, or a curved form the library does not compute) both are 0 —
 * the caller falls back to the hand input.
 * @param {P[]} raumPolygon room polygon, m
 * @param {import("@core/lib/bauteil/dachGeometrie.js").DachErgebnis|DachEbene[]|null} dachFlaeche roof of dachBerechnen (all faces
 *   except gables are used) or its planes (dachEbenen)
 * @param {{boden_m?: number}} [opt] floor height of the room in m in the height frame of the roof (default 0)
 * @returns {{unter1m_m2: number, zwischen1und2m_m2: number, flaeche_m2: number}} m² (flaeche_m2 = polygon area of the room)
 */
export function dachschraegenAnteile(raumPolygon, dachFlaeche, opt = {}) {
  const raum = (Array.isArray(raumPolygon) ? raumPolygon : []).map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
  const A = raum.length >= 3 ? flaeche(raum) : 0;
  const ebenen = Array.isArray(dachFlaeche) ? dachFlaeche : dachFlaeche && /** @type {any} */ (dachFlaeche).ok ? dachEbenen(/** @type {any} */ (dachFlaeche)) : [];
  if (!A || !ebenen.length) return { unter1m_m2: 0, zwischen1und2m_m2: 0, flaeche_m2: r3(A) };
  const boden = Number(opt.boden_m) || 0;
  const ab1 = flaecheAbHoehe(raum, ebenen, WOFLV_HOEHEN_M.unten, boden);
  const ab2 = Math.min(ab1, flaecheAbHoehe(raum, ebenen, WOFLV_HOEHEN_M.oben, boden));
  return { unter1m_m2: r3(Math.max(0, A - ab1)), zwischen1und2m_m2: r3(Math.max(0, ab1 - ab2)), flaeche_m2: r3(A) };
}

/**
 * The roof over the top storey of the workshop as the roof storey: the global roof form of the BIM studio (`dachform`, `dachneigung`
 * of the BimModel, the same derivation as the 3D view: globalerDachAnstieg_m) over the footprint, eaves at `kniestock_m` above the
 * floor (height frame: floor of the top storey = 0). A flat roof or no footprint gives null (no sloping areas).
 * @param {{footprint?: P[], dachform?: string, dachneigung?: number, kniestock_m?: number}} p footprint in m, roof form, slope in degrees,
 *   knee wall in m (default KNIESTOCK_STANDARD_M)
 * @returns {import("@core/lib/bauteil/dachGeometrie.js").DachErgebnis|null}
 */
export function dachgeschossDach({ footprint, dachform, dachneigung, kniestock_m }) {
  if (!dachform || dachform === "flach" || !Array.isArray(footprint) || footprint.length < 3) return null;
  const knie = Number.isFinite(Number(kniestock_m)) && Number(kniestock_m) >= 0 ? Number(kniestock_m) : KNIESTOCK_STANDARD_M;
  const d = dachBerechnen(footprint, { form: dachform }, { traufhoehe_m: knie, anstieg_m: globalerDachAnstieg_m(footprint, dachform, Number(dachneigung)) });
  return d.ok ? d : null;
}

/**
 * Rooms with their sloping partial areas from the geometry, ready for woflvFlaeche({raeume}): one entry per room (per room, not booked
 * once per unit like the hand input — the geometry knows which room lies under the slope).
 * @param {Array<{name?: string, flaeche_m2?: number, points?: P[]}>} raeume rooms of one unit (zone polygons in m)
 * @param {import("@core/lib/bauteil/dachGeometrie.js").DachErgebnis|null} dach roof (dachgeschossDach)
 * @returns {Array<{name: string, flaeche_m2: number, dachschraege: {unter1m_m2: number, zwischen1und2m_m2: number}}>}
 */
export function dachschraegenJeRaum(raeume, dach) {
  return (Array.isArray(raeume) ? raeume : []).map((r) => {
    const a = dachschraegenAnteile(r.points || [], dach);
    const f = Number.isFinite(Number(r.flaeche_m2)) ? Number(r.flaeche_m2) : a.flaeche_m2;
    return { name: String(r.name || "Raum"), flaeche_m2: f, dachschraege: { unter1m_m2: a.unter1m_m2, zwischen1und2m_m2: a.zwischen1und2m_m2 } };
  });
}
