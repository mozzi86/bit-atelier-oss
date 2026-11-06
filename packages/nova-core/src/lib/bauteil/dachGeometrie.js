// 107-10 (BK-07, BK-26, D-BK-23, D-BK-25): roof library — the plane faces of a roof from its outline, form, slope and ridge
// direction. Pure mathematics, no three.js, no React: the BIM studio (global roof form and drawn roofs), the Massing studio
// (optional `dach` of a body), the IFC export (one inclined plate per face) and the solid relations (seo.js: a wall cut
// against the roof planes) all read the SAME faces from here. Until 107-10 the three builders buildGableRoof / buildHipRoof /
// buildShedRoof and roofRiseFromPitch lived inside BitBimStudio.jsx and drew a mesh only; their geometry is reproduced here
// exactly (comparison old/new in tests/unit/seo-10710.test.js).
//
// Later phases build on this file instead of their own roof faces: phase 47 (roof studio, "real roof face model") and the
// candidate 107-16 (editable roof form, draggable roof points, drainage by roof form). For that the result is not a mesh but
// named ROOF POINTS (eaves corners t0…t3, ridge ends f0/f1, outline points p0…pn of a flat roof) and FACES that reference those
// points by id. A later plan can store moved points by id (e.g. `punkte: {t2: {y}}`) and derive the faces again from the
// same ids — nothing here has to change its shape for that. 107-10 itself stores no point.
//
// Rules:
//  - Outline: a rectangle (4 corners, right angles) is used EXACTLY in its own frame, also when it is rotated; every other
//    outline uses its axis-aligned bounding box, as the old builders did ("Rechteck exakt, sonst BBox wie heute").
//  - Ridge direction `firstrichtung`: "laengs" (default) = along the longest side of that frame, "quer" = across it. [ASSUMED]
//    the default "along the longest side" is the old builders' rule (ridge along the longer bounding-box axis, a square takes
//    the x axis); way to a decided value: the roof studio of phase 47 / candidate 107-16 with the user.
//  - The frame (rectangle / bounding box, ridge direction) is dachRahmen.js since the 107-10 review — hoehen.js measures the run of
//    a drawn roof on the SAME frame, so the faces have exactly the slope the inspector and the IFC data sheet show (D-BK-25).
//  - Slope ↔ rise: ONE derivation, hoehen.js (dachFirsthoehe_m, dachNeigung_grad, dachLauf_m; D-BK-25). This file never
//    computes a slope from a rise or the other way round itself — it hands hoehen.js an outline whose half span is the run.
//  - Only PLANE faces. A curved roof (barrel, dome, …) is not computed: dachBerechnen() answers {ok: false, grund: "form-offen"}
//    and the caller shows that the form is open (no silent fallback to a gable).
//
// Coordinates: plan points {x, z} in m (the BIM studio frame; the Massing studio maps its {x, y} to {x, z}), height y in m.
//
// In: outline (m), roof parameters {form, neigung_grad?, firsthoehe_m?, firstrichtung?}, eaves height (m).
// Out: {ok, rahmen, anstieg_m, neigung_grad, punkte[{id, art, x, y, z}], flaechen[{id, art, punktIds, punkte3d, normale,
//      neigung_grad}]}, a triangle list for three.js, the face planes and the roof height at a plan point.
// 108-01: globalesDach() (the global roof form in ONE call for 3D, solid relations and section), dachSchnittLinie() (the roof surface
// along a vertical section line, exact break points) and schnittAchseQuerZumFirst() (the section axis that cuts the ridge).
// 108-02: deckeUnterDach() (a slab outline clipped to the roof at its height — the collar-beam floor above the attic storey) and
// umrissSpanneBeiZ() (where such an outline crosses the section line).

import { dachFirsthoehe_m, dachNeigung_grad, DECKEN_STANDARD } from "./hoehen.js";
import { dachRahmen, umrissBereinigt as bereinigt } from "./dachRahmen.js";
import { globaleTraufhoehe_m } from "./ebenen.js";

/** Roof forms the library computes (plane faces only). */
export const DACHFORMEN = Object.freeze(["flach", "sattel", "walm", "pult"]);

/** Ridge directions relative to the longest side of the roof frame. */
export const FIRSTRICHTUNGEN = Object.freeze(["laengs", "quer"]);

/**
 * Inset of the hip ridge from each end, as a share of the SHORTER full side. [ASSUMED] 1/4 — the value of the old builder
 * buildHipRoof (BitBimStudio.jsx until 107-10), kept so old projects look the same; the hip ends are then steeper than the main
 * faces. A hip with equal slopes on all four faces would need 1/2; way to a decided value: the roof studio (phase 47 / 107-16).
 */
export const WALM_EINRUECKUNG_ANTEIL = 0.25;

/**
 * Clamps of the GLOBAL roof form of the BIM studio (slope field "Dachneigung"), the values of the old roofRiseFromPitch:
 * slope 1…60° (empty field = 30°), rise at least 0.3 m and at most the full shorter span. [ASSUMED] editor values since the
 * global roof form exists; they are UI limits, not a standard.
 */
export const GLOBAL_DACH = Object.freeze({ min_grad: 1, max_grad: 60, standard_grad: 30, min_anstieg_m: 0.3 });

const EPS = 1e-9;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {{x: number, y: number, z: number}} Pkt3
 * @typedef {object} DachParameter
 * @property {string} form                  "flach" | "sattel" | "walm" | "pult" (anything else: open)
 * @property {number} [neigung_grad]        slope in degrees (leads over firsthoehe_m, hoehen.js)
 * @property {number} [firsthoehe_m]        ridge rise above the eaves in m (pult: rise of the high eave)
 * @property {"laengs"|"quer"} [firstrichtung] ridge along ("laengs", default) or across the longest side
 * @typedef {object} DachRahmen
 * @property {PktXZ} mitte                  middle of the frame, m
 * @property {PktXZ} u                      unit vector along the ridge
 * @property {PktXZ} v                      unit vector across the ridge (the fall direction of the faces)
 * @property {number} halbL_m               half extent along u, m
 * @property {number} halbB_m               half extent along v, m (= the run of a gable)
 * @property {"rechteck"|"bbox"} quelle     exact rectangle or bounding box
 * @typedef {{id: string, art: "traufe"|"first"|"umriss", x: number, y: number, z: number}} DachPunkt
 * @typedef {object} DachFlaeche
 * @property {string} id                    "dach-1", "dach-2", "walm-1", "giebel-1", "flach" …
 * @property {"dachflaeche"|"walm"|"giebel"|"flach"} art  giebel = vertical gable triangle (drawn, never a roof plane)
 * @property {string[]} punktIds            corners by roof point id, ordered so the normal points up (giebel: outwards)
 * @property {Pkt3[]} punkte3d              the corners in m
 * @property {Pkt3} normale                 unit normal
 * @property {number} neigung_grad          inclination of this face against the horizontal, degrees (giebel 90)
 * @typedef {object} DachErgebnis
 * @property {true} ok
 * @property {string} form
 * @property {DachRahmen} rahmen
 * @property {number} traufhoehe_m
 * @property {number} anstieg_m             ridge (pult: high eave) above the eaves, m
 * @property {number} neigung_grad          slope of the roof (hoehen.dachNeigung_grad of the parameters)
 * @property {DachPunkt[]} punkte
 * @property {DachFlaeche[]} flaechen
 * @typedef {{ok: false, grund: "form-offen"|"kein-umriss", form: string}} DachFehler
 */

/**
 * Is the form one the library computes? A curved or unknown form is "offen" (see file head).
 * @param {unknown} form
 * @returns {boolean}
 */
export function dachFormBekannt(form) {
  return typeof form === "string" && DACHFORMEN.includes(form);
}

/**
 * Frame of a roof outline: an exact rectangle in its own frame, otherwise the axis-aligned bounding box (see file head). Lives in
 * dachRahmen.js since the 107-10 review, so hoehen.js measures the run on the SAME frame (D-BK-25); re-exported here.
 */
export { dachRahmen };

/**
 * An outline whose half span (hoehen.dachHalbspannweite_m) is `lauf_m`: the way this file hands the run of its frame to the
 * one slope derivation of hoehen.js (a square of side 2 · lauf).
 * @param {number} lauf_m
 * @returns {PktXZ[]}
 */
function laufUmriss(lauf_m) {
  const s = 2 * Math.max(0, lauf_m);
  return [{ x: 0, z: 0 }, { x: s, z: 0 }, { x: s, z: s }, { x: 0, z: s }];
}

/**
 * Ridge rise (shed: rise of the high eave) in m of roof parameters over a frame — through hoehen.dachFirsthoehe_m (D-BK-25):
 * a stored slope leads (run × tan; the run is the half span across the ridge, for a shed roof the full span), else the stored
 * rise. A flat roof has none.
 * @param {DachRahmen} rahmen
 * @param {DachParameter} dach
 * @returns {number} m
 */
export function dachAnstieg_m(rahmen, dach) {
  if (!rahmen || !dach || dach.form === "flach") return 0;
  return dachFirsthoehe_m({ form: dach.form, neigung_grad: dach.neigung_grad, firsthoehe_m: dach.firsthoehe_m, points: laufUmriss(rahmen.halbB_m) });
}

/**
 * Slope in degrees of roof parameters over a frame (hoehen.dachNeigung_grad, the one derivation).
 * @param {DachRahmen} rahmen
 * @param {DachParameter} dach
 * @returns {number} degrees
 */
export function dachNeigungImRahmen_grad(rahmen, dach) {
  if (!rahmen || !dach || dach.form === "flach") return 0;
  return dachNeigung_grad({ form: dach.form, neigung_grad: dach.neigung_grad, firsthoehe_m: dach.firsthoehe_m, points: laufUmriss(rahmen.halbB_m) });
}

/**
 * Rise of the GLOBAL roof form of the BIM studio (select "Dachform" + field "Dachneigung" over the footprint), in m. Gable and
 * hip: exactly the old roofRiseFromPitch (half shorter span × tan, clamps GLOBAL_DACH). Shed: deliberately corrected in 107-10 —
 * the old function took the LONGER span as the run but the face rises across the SHORTER one, so the drawn slope was steeper
 * than the field said; now the run is the full shorter span and the face has the slope of the field (the IFC data sheet must not
 * lie, D-BK-25). Only the 3D view of a global shed roof changes; nothing is stored.
 * @param {PktXZ[]} profil footprint in m
 * @param {string} form "sattel" | "walm" | "pult"
 * @param {number} grad field value in degrees
 * @returns {number} m
 */
export function globalerDachAnstieg_m(profil, form, grad) {
  const r = dachRahmen(profil);
  if (!r || form === "flach") return 0;
  const g = Math.max(GLOBAL_DACH.min_grad, Math.min(GLOBAL_DACH.max_grad, Number(grad) || GLOBAL_DACH.standard_grad));
  const roh = dachAnstieg_m(r, { form, neigung_grad: g });
  return Math.max(GLOBAL_DACH.min_anstieg_m, Math.min(roh, 2 * r.halbB_m));
}

/** @param {Pkt3[]} pts @returns {Pkt3} Newell normal (not normalised; length = 2 × area) */
function newell(pts) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

/**
 * Plane faces of a roof (see file head for the rules and the point ids).
 *  - flach: one face = the outline itself at the eaves height (points p0…pn)
 *  - sattel: two faces dach-1 (−v side) and dach-2 (+v side) meeting at the ridge f0–f1, two vertical gables
 *  - walm: two main faces and two hip ends walm-1/walm-2 (ridge inset WALM_EINRUECKUNG_ANTEIL of the shorter side)
 *  - pult: one face from the low eave t0–t1 (−v side) up to the high eave t2–t3 (+v side)
 * @param {PktXZ[]} profil outline in m
 * @param {DachParameter} dach
 * @param {{traufhoehe_m?: number, anstieg_m?: number}} [opt] traufhoehe_m: eaves height in m (default 0); anstieg_m: a rise already
 *   derived by the caller (the drawn roofs pass hoehen.dachFirsthoehe_m of the record, the global form globalerDachAnstieg_m)
 * @returns {DachErgebnis|DachFehler}
 */
export function dachBerechnen(profil, dach, opt = {}) {
  const form = String(dach?.form ?? "");
  if (!dachFormBekannt(form)) return { ok: false, grund: "form-offen", form };
  const rahmen = dachRahmen(profil, dach?.firstrichtung === "quer" ? "quer" : "laengs");
  if (!rahmen) return { ok: false, grund: "kein-umriss", form };
  const y0 = Number(opt.traufhoehe_m) || 0;
  const anstieg = form === "flach" ? 0 : Math.max(0, opt.anstieg_m != null ? Number(opt.anstieg_m) || 0 : dachAnstieg_m(rahmen, dach));
  const { mitte, u, v, halbL_m: L, halbB_m: B } = rahmen;
  const at = (/** @type {number} */ su, /** @type {number} */ sv) => ({ x: mitte.x + u.x * su + v.x * sv, z: mitte.z + u.z * su + v.z * sv });
  /** @type {DachPunkt[]} */
  const punkte = [];
  const punkt = (/** @type {string} */ id, /** @type {DachPunkt["art"]} */ art, /** @type {PktXZ} */ p, /** @type {number} */ y) => punkte.push({ id, art, x: p.x, y, z: p.z });
  /** @type {Array<{id: string, art: DachFlaeche["art"], punktIds: string[]}>} */
  let roh;
  if (form === "flach") {
    bereinigt(profil).forEach((p, i) => punkt(`p${i}`, "umriss", p, y0));
    roh = [{ id: "flach", art: "flach", punktIds: punkte.map((p) => p.id) }];
  } else {
    const hoch = form === "pult" ? y0 + anstieg : y0;
    punkt("t0", "traufe", at(-L, -B), y0);
    punkt("t1", "traufe", at(L, -B), y0);
    punkt("t2", "traufe", at(L, B), hoch);
    punkt("t3", "traufe", at(-L, B), hoch);
    if (form === "pult") {
      roh = [{ id: "dach-1", art: "dachflaeche", punktIds: ["t0", "t1", "t2", "t3"] }];
    } else {
      const fL = form === "walm" ? Math.max(0, L - WALM_EINRUECKUNG_ANTEIL * Math.min(2 * L, 2 * B)) : L;
      punkt("f0", "first", at(-fL, 0), y0 + anstieg);
      punkt("f1", "first", at(fL, 0), y0 + anstieg);
      const ende = form === "walm" ? "walm" : "giebel";
      roh = [
        { id: "dach-1", art: "dachflaeche", punktIds: ["t0", "t1", "f1", "f0"] },
        { id: "dach-2", art: "dachflaeche", punktIds: ["f0", "f1", "t2", "t3"] },
        { id: `${ende}-1`, art: ende, punktIds: ["t0", "f0", "t3"] },
        { id: `${ende}-2`, art: ende, punktIds: ["t1", "t2", "f1"] },
      ];
    }
  }
  const nachId = new Map(punkte.map((p) => [p.id, p]));
  const mitte3 = { x: mitte.x, z: mitte.z };
  /** @type {DachFlaeche[]} */
  const flaechen = [];
  for (const f of roh) {
    // a hip ridge of length 0 (square hip = pyramid) leaves a doubled corner: dropped, the face stays a triangle
    const ids = f.punktIds.filter((id, i, a) => {
      const p = nachId.get(id), q = nachId.get(a[(i + 1) % a.length]);
      return !(p && q && id !== a[(i + 1) % a.length] && Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS && Math.abs(p.z - q.z) < EPS);
    });
    let pts = ids.map((id) => /** @type {DachPunkt} */ (nachId.get(id))).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    let n = newell(pts);
    const len = Math.hypot(n.x, n.y, n.z);
    if (len < EPS) continue; // no area (a zero rise gable)
    n = { x: n.x / len, y: n.y / len, z: n.z / len };
    // orientation: roof planes face up; a gable faces away from the middle of the frame
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, z: a.z + p.z / pts.length }), { x: 0, z: 0 });
    const umdrehen = f.art === "giebel" ? n.x * (c.x - mitte3.x) + n.z * (c.z - mitte3.z) < 0 : n.y < 0;
    if (umdrehen) {
      // reversed with the FIRST corner kept, so the fan of dachDreiecke keeps the diagonal of the old builders
      const umkehr = (/** @type {any[]} */ a) => [a[0], ...a.slice(1).reverse()];
      ids.splice(0, ids.length, ...umkehr(ids));
      pts = umkehr(pts);
      n = { x: -n.x, y: -n.y, z: -n.z };
    }
    flaechen.push({ id: f.id, art: f.art, punktIds: ids, punkte3d: pts, normale: n, neigung_grad: (Math.acos(Math.min(1, Math.abs(n.y))) * 180) / Math.PI });
  }
  // the slope of the roof: from the parameters, or — when the caller handed in a rise — from that rise over the run (hoehen.js)
  const neigung_grad = opt.anstieg_m != null ? dachNeigungImRahmen_grad(rahmen, { form, firsthoehe_m: anstieg }) : dachNeigungImRahmen_grad(rahmen, dach);
  return { ok: true, form, rahmen, traufhoehe_m: y0, anstieg_m: anstieg, neigung_grad, punkte, flaechen };
}

/**
 * Triangle list of the faces for a three.js BufferGeometry (positions x, y, z in m, 9 numbers per triangle): a fan per face,
 * triangles without area left out. The faces of the pitched forms are convex (rectangle frame), so the fan is exact. The face
 * of a FLAT roof is the outline itself and may be concave (an L-shaped house): it is left out here — callers draw a flat roof
 * as an extruded plate, as before.
 * @param {DachFlaeche[]} flaechen
 * @returns {number[]}
 */
export function dachDreiecke(flaechen) {
  /** @type {number[]} */
  const pos = [];
  for (const f of flaechen || []) {
    if (f.art === "flach") continue;
    const p = f.punkte3d;
    for (let i = 1; i + 1 < p.length; i += 1) {
      const a = p[0], b = p[i], c = p[i + 1];
      const n = newell([a, b, c]);
      if (Math.hypot(n.x, n.y, n.z) < EPS) continue;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  }
  return pos;
}

/**
 * Planes of the roof faces (no gables): a point on the plane and the upward unit normal, m.
 * @param {DachErgebnis} dach
 * @returns {Array<{id: string, punkt: Pkt3, normale: Pkt3}>}
 */
export function dachEbenen(dach) {
  return (dach?.flaechen || []).filter((f) => f.art !== "giebel" && f.normale.y > 1e-6).map((f) => ({ id: f.id, punkt: f.punkte3d[0], normale: f.normale }));
}

/**
 * Height of one roof plane over a plan point, m.
 * @param {{punkt: Pkt3, normale: Pkt3}} e
 * @param {number} x m
 * @param {number} z m
 * @returns {number} m
 */
export function ebeneHoeheAn(e, x, z) {
  return e.punkt.y - (e.normale.x * (x - e.punkt.x) + e.normale.z * (z - e.punkt.z)) / e.normale.y;
}

/**
 * Height of the roof surface over a plan point inside the roof frame, m: the LOWEST of the face planes. Exact for every form of
 * this library (gable, hip and shed surfaces are the minimum of their planes over the frame — a tent shape), which is also why
 * "above the roof" is the union of the half-spaces above the single planes (seo.js builds the cutting bodies that way).
 * @param {Array<{punkt: Pkt3, normale: Pkt3}>} ebenen dachEbenen()
 * @param {number} x m
 * @param {number} z m
 * @returns {number} m (Infinity without planes)
 */
export function dachHoeheAn(ebenen, x, z) {
  let h = Infinity;
  for (const e of ebenen || []) h = Math.min(h, ebeneHoeheAn(e, x, z));
  return h;
}

/**
 * Corners of the roof frame in plan (counter-clockwise order t0…t3 of dachBerechnen), m.
 * @param {DachRahmen} r
 * @returns {PktXZ[]}
 */
export function rahmenEcken(r) {
  const at = (/** @type {number} */ su, /** @type {number} */ sv) => ({ x: r.mitte.x + r.u.x * su + r.v.x * sv, z: r.mitte.z + r.u.z * su + r.v.z * sv });
  return [at(-r.halbL_m, -r.halbB_m), at(r.halbL_m, -r.halbB_m), at(r.halbL_m, r.halbB_m), at(-r.halbL_m, r.halbB_m)];
}

/**
 * Roof parameters of a drawn roof (`customRoofs` record): its form (107-10: optional field `form`; absent = the gable the 3D
 * view has always drawn, and a rise of 0 = the flat plate) and its slope fields as hoehen.js reads them (D-BK-25).
 * @param {{form?: string, neigung_grad?: number, firsthoehe_m?: number, pitch?: number, points?: PktXZ[], firstrichtung?: string}} rf
 * @returns {{dach: DachParameter, anstieg_m: number}}
 */
export function dachVonDachelement(rf) {
  const anstieg_m = dachFirsthoehe_m(rf);
  const form = rf?.form ? String(rf.form) : anstieg_m > 0.005 ? "sattel" : "flach";
  return { dach: { form, ...(rf?.neigung_grad != null ? { neigung_grad: Number(rf.neigung_grad) } : {}), firsthoehe_m: anstieg_m, firstrichtung: rf?.firstrichtung === "quer" ? "quer" : "laengs" }, anstieg_m };
}

/**
 * 108-01: thickness of the global roof plate in m, measured at right angles to the face — the plate the IFC export writes on top of
 * each face (ifcExport dachPlatten with DECKEN_STANDARD.dach.dicke_m). [ASSUMED] the section draws the SAME 0.20 m (editor value of
 * drawn roofs, no build-up); way to a real value: the roof build-up of the roof studio (phase 47) — then section and IFC read it here.
 */
export const GLOBAL_DACH_DICKE_M = DECKEN_STANDARD.dach.dicke_m;

/**
 * 108-01: the GLOBAL roof form of the BIM studio over the footprint, eaves at globaleTraufhoehe_m (ebenen.js) and the rise of
 * globalerDachAnstieg_m — the one call the 3D view, the solid relations and the section make instead of three equal lines.
 * @param {any} model built model (footprint in m, totalHeight)
 * @param {string|null|undefined} form "sattel" | "walm" | "pult" (anything else is computed as dachBerechnen answers it)
 * @param {number} grad slope field in degrees
 * @param {import("./hoehen.js").Geschosse} [gs] storey table (fallback of the eaves height)
 * @returns {DachErgebnis|DachFehler|null} null for no form, "flach" or a footprint below 3 points
 */
export function globalesDach(model, form, grad, gs) {
  const fp = Array.isArray(model?.footprint) ? model.footprint : [];
  if (!form || form === "flach" || fp.length < 3) return null;
  return dachBerechnen(fp, { form }, { traufhoehe_m: globaleTraufhoehe_m(model, gs), anstieg_m: globalerDachAnstieg_m(fp, form, grad) });
}

/**
 * 108-01: section axis that runs ACROSS the ridge (the roof triangle is visible there): "x" = section line along x (z = const,
 * today's section A-A), "z" = along z (x = const, B-B). The axis whose direction is closest to the fall direction `rahmen.v`; a
 * rotated rectangle takes the nearer axis of its bounding box, a tie (45°) the x axis.
 * @param {DachErgebnis|DachFehler|null|undefined} dach dachBerechnen / globalesDach
 * @returns {"x"|"z"|null} null for no roof, a failed one or a flat roof
 */
export function schnittAchseQuerZumFirst(dach) {
  if (!dach || !dach.ok || dach.form === "flach") return null;
  const v = dach.rahmen.v;
  return Math.abs(v.x) >= Math.abs(v.z) ? "x" : "z";
}

/**
 * 108-01: the roof surface along a vertical section line, as a polyline in section coordinates: s = position along the line in m
 * (x for axis "x", z for axis "z"), h = height in m. The surface is the minimum of the face planes (dachHoeheAn), so it is piecewise
 * linear; the break points are computed EXACTLY (no sampling): the two points where the line enters and leaves the roof frame
 * (rahmenEcken) and every point where two face planes have the same height on the line. Collinear inner points are dropped.
 * @param {DachErgebnis|DachFehler|null|undefined} dach dachBerechnen / globalesDach
 * @param {"x"|"z"} achse "x": line z = lage_m, s = x; "z": line x = lage_m, s = z
 * @param {number} [lage_m] position of the section plane in m (0 = through the middle of a centred footprint)
 * @param {{dicke_m?: number}} [opt] dicke_m: the TOP of a plate of this thickness (m, at right angles to each face) instead of the
 *   roof surface — every face plane is lifted by dicke_m / cos(slope); the end points stay on the frame
 * @returns {{punkte: Array<{s_m: number, h_m: number}>, traufe_m: number, first_m: number}|null} first_m = eaves + rise (shed roof:
 *   the high eave); null for no roof, a flat roof or a line that misses the roof frame
 */
export function dachSchnittLinie(dach, achse, lage_m = 0, opt = {}) {
  if (!dach || !dach.ok || dach.form === "flach") return null;
  const d = Math.max(0, Number(opt?.dicke_m) || 0);
  const ebenen = dachEbenen(dach).map((e) => (d > 0 ? { ...e, punkt: { ...e.punkt, y: e.punkt.y + d / e.normale.y } } : e));
  if (!ebenen.length) return null;
  const lage = Number(lage_m) || 0;
  const P = (/** @type {number} */ s) => (achse === "z" ? { x: lage, z: s } : { x: s, z: lage });
  const sVon = (/** @type {PktXZ} */ p) => (achse === "z" ? p.z : p.x);
  const qVon = (/** @type {PktXZ} */ p) => (achse === "z" ? p.x : p.z);
  // where the line crosses the (convex) frame
  const ecken = rahmenEcken(dach.rahmen);
  /** @type {number[]} */
  const rand = [];
  for (let i = 0; i < ecken.length; i += 1) {
    const a = ecken[i], b = ecken[(i + 1) % ecken.length];
    const qa = qVon(a) - lage, qb = qVon(b) - lage;
    if (Math.abs(qa) < 1e-9 && Math.abs(qb) < 1e-9) { rand.push(sVon(a), sVon(b)); continue; }
    if ((qa <= 0 && qb >= 0) || (qa >= 0 && qb <= 0)) rand.push(sVon(a) + (sVon(b) - sVon(a)) * (qa / (qa - qb)));
  }
  if (rand.length < 2) return null;
  const s0 = Math.min(...rand), s1 = Math.max(...rand);
  if (s1 - s0 < 1e-6) return null;
  // each plane is linear on the line: h_i(s) = a_i + b_i · s
  const lin = ebenen.map((e) => { const a = ebeneHoeheAn(e, P(0).x, P(0).z); return { a, b: ebeneHoeheAn(e, P(1).x, P(1).z) - a }; });
  const ss = [s0, s1];
  for (let i = 0; i < lin.length; i += 1) {
    for (let j = i + 1; j < lin.length; j += 1) {
      const db = lin[i].b - lin[j].b;
      if (Math.abs(db) < 1e-12) continue;
      const s = (lin[j].a - lin[i].a) / db;
      if (s > s0 + 1e-9 && s < s1 - 1e-9) ss.push(s);
    }
  }
  const sortiert = [...ss].sort((p, q) => p - q).filter((s, i, a) => i === 0 || s - a[i - 1] > 1e-9);
  const roh = sortiert.map((s) => { const p = P(s); return { s_m: s, h_m: dachHoeheAn(ebenen, p.x, p.z) }; });
  /** @type {Array<{s_m: number, h_m: number}>} */
  const punkte = [];
  for (let i = 0; i < roh.length; i += 1) {
    const p = roh[i];
    if (punkte.length >= 1 && i < roh.length - 1) {
      const a = punkte[punkte.length - 1], b = roh[i + 1];
      const quer = (p.s_m - a.s_m) * (b.h_m - a.h_m) - (p.h_m - a.h_m) * (b.s_m - a.s_m);
      if (Math.abs(quer) < 1e-9) continue; // collinear: no break point
    }
    punkte.push(p);
  }
  return { punkte, traufe_m: dach.traufhoehe_m, first_m: dach.traufhoehe_m + dach.anstieg_m };
}

/**
 * 108-02 (D-EFH-01, user decision 01.11.2026: collar-beam floor): the part of a slab outline that lies UNDER the roof at `hoehe_m` —
 * where every roof plane is at least `hoehe_m` high. The roof surface is the minimum of its planes (dachHoeheAn), so "roof ≥ h" is the
 * intersection of one half-plane per face: n.x·x + n.z·z ≤ n.y·(p.y − h) + n.x·p.x + n.z·p.z (the same inequality as lichteHoehe.js
 * flaecheAbHoehe). The outline is clipped against each half-plane (Sutherland–Hodgman), exact for every plane roof form; a gable roof
 * at 45° makes the strip 2 m narrower per metre above the eaves. Level faces (a flat part) restrict nothing when they are high enough
 * and remove everything when they are lower.
 * @param {PktXZ[]} polygon slab outline in m
 * @param {Array<{punkt: Pkt3, normale: Pkt3}>} ebenen roof planes with upward normals (dachEbenen)
 * @param {number} hoehe_m height in m that must stay under the roof (the top of the slab)
 * @returns {PktXZ[]} clipped outline in m (same winding); [] when nothing is left (the slab lies above the ridge)
 */
export function deckeUnterDach(polygon, ebenen, hoehe_m) {
  /** @type {PktXZ[]} */
  let pts = (Array.isArray(polygon) ? polygon : []).map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
  const h = Number(hoehe_m) || 0;
  for (const e of ebenen || []) {
    if (pts.length < 3) return [];
    const n = e.normale, p = e.punkt;
    if (!(n.y > EPS)) continue;
    const c = n.y * (p.y - h) + n.x * p.x + n.z * p.z;
    if (Math.abs(n.x) < EPS && Math.abs(n.z) < EPS) {
      if (c < -1e-9) return []; // a level face below h: nothing stays under it
      continue;
    }
    const wert = (/** @type {PktXZ} */ q) => c - (n.x * q.x + n.z * q.z); // ≥ 0 = inside
    /** @type {PktXZ[]} */
    const neu = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const wa = wert(a), wb = wert(b);
      if (wa >= -1e-12) neu.push(a);
      if ((wa >= -1e-12) !== (wb >= -1e-12)) {
        const t = wa / (wa - wb);
        neu.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    // drop doubled points (a vertex exactly on the clip line)
    pts = neu.filter((q, i) => { const r = neu[(i + 1) % neu.length]; return neu.length < 2 || Math.hypot(q.x - r.x, q.z - r.z) > 1e-9; });
  }
  if (pts.length < 3) return [];
  let a2 = 0;
  for (let i = 0; i < pts.length; i += 1) { const a = pts[i], b = pts[(i + 1) % pts.length]; a2 += a.x * b.z - b.x * a.z; }
  return Math.abs(a2) / 2 > 1e-9 ? pts : [];
}

/**
 * 108-02: where a slab outline crosses the section line z = z_m — the lowest and highest x of its edges' crossings, m. The screen and
 * PDF sections draw a clipped slab (collar-beam floor) only over this range instead of the full building width.
 * @param {PktXZ[]} polygon outline in m (in the frame of the section, after referenz.modellImSchnitt)
 * @param {number} [z_m] position of the section line in m (default 0)
 * @returns {{von_m: number, bis_m: number}|null} null when the line misses the outline
 */
export function umrissSpanneBeiZ(polygon, z_m = 0) {
  const pts = Array.isArray(polygon) ? polygon : [];
  /** @type {number[]} */
  const xs = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const qa = a.z - z_m, qb = b.z - z_m;
    if (Math.abs(qa) < 1e-12 && Math.abs(qb) < 1e-12) { xs.push(a.x, b.x); continue; }
    if ((qa <= 0 && qb >= 0) || (qa >= 0 && qb <= 0)) xs.push(a.x + (b.x - a.x) * (qa / (qa - qb)));
  }
  if (xs.length < 2) return null;
  const von = Math.min(...xs), bis = Math.max(...xs);
  return bis - von > 1e-9 ? { von_m: von, bis_m: bis } : null;
}
