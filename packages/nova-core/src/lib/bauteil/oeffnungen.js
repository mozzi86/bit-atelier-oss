// Opening chain of a wall — the ONE place for sizes, host and height anchor of an opening (phase 107-04, spec part
// I.4 Glue-To / Cut-Opening-Bridge, II.4, IV "push a rectangle through"). Before, three families of openings had three kinds of
// binding to their wall (drawn wall: `wallIdx`; hull wall: `level` + `edge`; workshop door: nothing, found by geometry in the IFC
// export; penetrations of the openings planning: `bauteil_guid`) and each reader resolved the host itself; sizes were read from the
// type table in 3D, plan and room module, but from the record (`width/height/sill`) in the IFC export.
//
// Rule (spec VI.3): the store holds the BASE GEOMETRY of an opening (host, position u along the wall, optional sizes, height anchor);
// the hole in the 3D wall, the plan symbol and the IFC void are derived from it. Nothing here writes back into a, b or a wall.
//
// Stored fields of an opening (all optional and additive, English names of the old fields unchanged):
//   kind        "window" | "door" | "oeffnung" (107-04: opening without a filling, IfcOpeningElement + IfcRelVoidsElement only)
//   typeId      type of the library (buildingModel.js); the type size applies where the record states none
//   u           position of the opening MIDDLE along the wall a→b, in m from a
//   width, height, sill      own sizes in m (override the type size field by field; `sill` = distance from the anchor, see below)
//   bruestung_bezug          "wand_uk" (default) | "okrd" | "okff": the line `sill` is measured from
//   wirt_guid   stable IFC GUID of the host wall (22 characters); the live binding (`wallIdx`, `level`+`edge`) wins, the GUID is the
//               fallback and the address for foreign references (penetrations, change tools)
//
// Height anchors (D-BK-11): wand_uk = bottom edge of the wall; okrd = top of the RAW floor of the storey (Oberkante Rohdecke, the floor
// slab without its floor build-up); okff = top of the FINISHED floor (Oberkante Fertigfußboden). Without a floor slab below the storey
// both are the storey plane, without a slab build-up OKFF = OKRD. [ASSUMED] a floor slab that carries a build-up (`composite`) holds
// its floor build-up INSIDE its thickness: the layers above the first core layer (kernLage, layer 1 = top) lie between OKRD and OKFF.
// Way to a proven value: the floor build-up of the execution planning of that storey.
//
// In:  opening records, wall records of the BIM model, the storey source (hoehen.js) and the slabs. Out: plain numbers and objects;
// pure, no I/O, no React, no three.
import { openingTypeById, oeffnungsGroesse } from "../buildingModel.js";
import { aufbauVon, kernLage } from "./aufbauten.js";
import { bauteilGuid } from "./steckbrief.js";
import { elevationOf, unterkante, wandHoehe, geschosshoehe, deckenLage } from "./hoehen.js";
import { wandDicke_m, wandGeometrie, kernVon } from "./referenz.js";

/** Height anchors an opening's `sill` can be measured from (stored as `bruestung_bezug`). */
export const BRUESTUNG_BEZUEGE = Object.freeze(["wand_uk", "okrd", "okff"]);

/** Default anchor: the bottom edge of the wall (today's behaviour of 3D and IFC). */
export const BRUESTUNG_BEZUG_STANDARD = "wand_uk";

/**
 * Smallest side of a rectangle that is drawn as an opening, in m. [ASSUMED] 0.10 m: a smaller rectangle is a mis-click, not an
 * opening; way to a proven value: the smallest penetration the openings planning accepts (it has none yet).
 */
export const MIN_OEFFNUNG_M = 0.1;

/**
 * Edge clearance of an opening to the wall ends in m: the IFC export keeps this distance so no boolean has a zero-width edge
 * (ifcExport.js, 107-04: now the same value in 3D). The 5 cm are the old literal of both places.
 * [ASSUMED] 0.05 m; way to a proven value: the minimum web width the structural engineer asks for.
 */
export const OEFFNUNG_RAND_M = 0.05;

/** Tolerance in m for "the point lies on the wall axis" of a workshop door found by geometry (the old literal of the IFC export: 1 cm). */
const WERKSTATT_TOL_M = 0.01;

/**
 * [ASSUMED] Tolerance in m around the wall body in which a penetration still counts as "lies in its host" (check 12 of
 * pruefregeln.js): the openings planning stores x/y/z rounded and the host wall is addressed by its axis; 15 cm = half a thin wall.
 * A way to a proven value: the position tolerance of the structural opening plan.
 */
export const DURCHBRUCH_WIRT_TOL_M = 0.15;

/**
 * Depth in m of a penetration that has neither a stated depth `t` nor a host wall (IFC proxy and 3D marker use the same value).
 * [ASSUMED] 0.30 m: no host, no depth stated; way to a proven value: the depth of the structural opening plan.
 */
export const DURCHBRUCH_TIEFE_OHNE_WIRT_M = 0.3;


/**
 * @typedef {object} Anker  absolute heights (m above the building zero) for the height anchors of one wall
 * @property {number} wandUk_m   bottom edge of the wall
 * @property {number} okrd_m     top of the raw floor of the storey
 * @property {number} okff_m     top of the finished floor of the storey
 */

/**
 * Sizes of an opening: its own `width`/`height`/`sill` first (field by field), the type size where the record states none.
 * With an anchor the sill is converted to the wall bottom (`bruestung_bezug`); without one it is returned as stored.
 * The same function feeds 3D, plan, room module and IFC export, so the sizes are the same everywhere (107-04).
 * @param {any} o opening record (customWindows / envOpenings / autoOpenings entry)
 * @param {Anker|null} [anker] heights of the wall and the floor (ankerFuerWand); null = sill as stored
 * @returns {{w: number, h: number, sill: number, sturz: number}} width, height, sill (from the wall bottom) and lintel height
 *   (sill + height, for display only), all in m. Same field names as the type table, so existing readers change one line.
 */
export function oeffnungsMasse(o, anker = null) {
  const { w, h, sill: eingabe } = oeffnungsGroesse(o);
  const sill = eingabe + (anker ? bezugVersatz(o?.bruestung_bezug, anker) : 0);
  return { w, h, sill, sturz: sill + h };
}

/**
 * The type object of an opening with its own sizes laid over it — what the glazing builder and the plan symbols read
 * (columns, rows, glass stay from the type).
 * @param {any} o opening record
 * @param {Anker|null} [anker]
 * @returns {any} type object {id, name, w, h, sill, cols, rows, ...} in m
 */
export function oeffnungsTyp(o, anker = null) {
  return { ...openingTypeById(o?.kind, o?.typeId), ...oeffnungsMasse(o, anker) };
}

/**
 * True for an opening without a filling (no window, no door): only the hole.
 * @param {any} o
 * @returns {boolean}
 */
export const istOeffnungOhneFuellung = (o) => o?.kind === "oeffnung";

/**
 * Shift from the wall bottom to the anchor of `bezug`, in m.
 * @param {any} bezug "wand_uk" | "okrd" | "okff"; unknown or missing = "wand_uk"
 * @param {Anker} anker
 * @returns {number} metres (add to the stored sill to get the sill above the wall bottom)
 */
function bezugVersatz(bezug, anker) {
  if (bezug === "okrd") return anker.okrd_m - anker.wandUk_m;
  if (bezug === "okff") return anker.okff_m - anker.wandUk_m;
  return 0;
}

/**
 * Sill above the wall bottom, whatever anchor the record states ("Brüstung ab Wand-Unterkante").
 * @param {any} o opening record
 * @param {Anker|null} anker
 * @returns {number} m
 */
export function bruestungAbWandUk(o, anker) {
  return oeffnungsMasse(o, anker).sill;
}

/** @param {{x: number, z: number}[]} poly @param {{x: number, z: number}} p @returns {boolean} point in polygon (x/z, even-odd) */
function imPolygon(poly, p) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) innen = !innen;
  }
  return innen;
}

/**
 * Raw and finished floor of a storey: the floor slab is the slab of the storey below (slab `level` = the ceiling of that storey, the
 * base plate has level −1), see hoehen.js deckenLage. A drawn slab that contains the point wins over the hull slab; without a
 * point the first drawn slab of that level, else the hull slab; without any slab both are the storey plane.
 * @param {number} level storey of the WALL (its floor is the slab of level − 1)
 * @param {import("./hoehen.js").Geschosse} geschosse storey source (hoehen.js)
 * @param {{huelle?: any[], gezeichnet?: any[]}} [decken] hull slabs (model.slabs) and drawn slabs (customSlabs)
 * @param {{x: number, z: number}|null} [punkt] plan point of the opening in m
 * @returns {{okrd_m: number, okff_m: number, quelle: "gezeichnet"|"huelle"|"geschossebene"}} heights in m
 */
export function bodenLage(level, geschosse, decken = {}, punkt = null) {
  const l = Math.round(Number(level) || 0);
  const gez = (decken.gezeichnet || []).filter((/** @type {any} */ s) => Math.round(Number(s?.level) || 0) === l - 1 && Array.isArray(s?.points) && s.points.length >= 3);
  const hul = (decken.huelle || []).filter((/** @type {any} */ s) => Math.round(Number(s?.level)) === l - 1);
  const treffer = punkt ? gez.find((/** @type {any} */ s) => imPolygon(s.points, punkt)) : gez[0];
  const slab = treffer || (hul.length ? hul[0] : null);
  if (!slab) return { okrd_m: elevationOf(l, geschosse), okff_m: elevationOf(l, geschosse), quelle: "geschossebene" };
  const oben = deckenLage(slab, geschosse, treffer ? "decke" : "huelle").oberkante_m;
  const kern = slab.composite ? kernLage(aufbauVon(slab).schichten) : null;
  // [ASSUMED] the layers above the core are the floor build-up and lie inside the slab thickness (file header)
  return { okrd_m: oben - (kern ? kern.aussen_m : 0), okff_m: oben, quelle: treffer ? "gezeichnet" : "huelle" };
}

/**
 * Anchor heights of one wall for oeffnungsMasse().
 * @param {{level?: number, unterkante_m: number}} wand wall: storey and bottom edge in m
 * @param {import("./hoehen.js").Geschosse} geschosse storey source
 * @param {{huelle?: any[], gezeichnet?: any[]}} [decken] slabs, see bodenLage
 * @param {{x: number, z: number}|null} [punkt] plan point of the opening in m (picks the slab below it)
 * @returns {Anker}
 */
export function ankerFuerWand(wand, geschosse, decken = {}, punkt = null) {
  const b = bodenLage(wand.level || 0, geschosse, decken, punkt);
  return { wandUk_m: wand.unterkante_m, okrd_m: b.okrd_m, okff_m: b.okff_m };
}

/**
 * Middle of an opening along its wall, kept inside the wall with the edge clearance — the rule the IFC export always had and
 * 3D now shares (before, 3D shrank the hole at the wall end while the IFC moved it).
 * @param {number|null|undefined} u stored middle in m from a (missing = wall middle)
 * @param {number} breite_m opening width in m
 * @param {number} wandLaenge_m wall length in m
 * @returns {number} m from a
 */
export function oeffnungMitte_m(u, breite_m, wandLaenge_m) {
  const wunsch = u ?? wandLaenge_m / 2;
  return Math.min(Math.max(wunsch, breite_m / 2 + OEFFNUNG_RAND_M), wandLaenge_m - breite_m / 2 - OEFFNUNG_RAND_M);
}

/**
 * Does the opening fit into its wall? Same test and same wording for the IFC export (which then leaves it out) and the 3D view
 * (which then clamps the hole to the wall and says so, 107-04: no silent clamp any more).
 * @param {{w: number, h: number, sill: number}} masse sizes in m (oeffnungsMasse)
 * @param {number} wandLaenge_m wall length in m
 * @param {number} wandHoehe_m wall height in m
 * @returns {{ok: boolean, text: string|null, daten: {w: number, h: number, sill: number, laenge: number, hoehe: number}}} text: German
 *   "<w>×<h> m (Brüstung <sill> m) passt nicht in die Wand (<len>×<height> m)" (export warning); daten: the same numbers in m, formatted to
 *   2 decimals, for the UI which builds its own translated sentence (tz) instead of showing this German text
 */
export function oeffnungPasst(masse, wandLaenge_m, wandHoehe_m) {
  const { w, h, sill } = masse;
  const daten = { w, h, sill, laenge: wandLaenge_m, hoehe: wandHoehe_m };
  if (w > 0 && h > 0 && w + 2 * OEFFNUNG_RAND_M <= wandLaenge_m && sill + h <= wandHoehe_m + 1e-6 && sill >= -1e-6) return { ok: true, text: null, daten };
  return { ok: false, daten, text: `${w.toFixed(2)}×${h.toFixed(2)} m (Brüstung ${sill.toFixed(2)} m) passt nicht in die Wand (${wandLaenge_m.toFixed(2)}×${wandHoehe_m.toFixed(2)} m)` };
}

/**
 * The hole of an opening in the wall plane (x along the wall from a, y up from the wall bottom), for the 3D wall profile.
 * Position as in the IFC (oeffnungMitte_m); the hole stays inside the wall by the edge clearance at the sides and 2 cm at bottom and
 * top (the old 3D rule).
 * @param {{w: number, h: number, sill: number}} masse sizes in m
 * @param {number|null|undefined} u stored middle in m
 * @param {number} wandLaenge_m wall length in m
 * @param {number} wandHoehe_m wall height in m
 * @returns {{x0: number, x1: number, y0: number, y1: number}|null} corners in m, null when nothing of the hole remains
 */
export function lochImWand(masse, u, wandLaenge_m, wandHoehe_m) {
  const mitte = oeffnungMitte_m(u, masse.w, wandLaenge_m);
  const x0 = Math.max(OEFFNUNG_RAND_M, mitte - masse.w / 2), x1 = Math.min(wandLaenge_m - OEFFNUNG_RAND_M, mitte + masse.w / 2);
  const y0 = Math.max(0.02, masse.sill), y1 = Math.min(wandHoehe_m - 0.02, masse.sill + masse.h);
  return x1 <= x0 || y1 <= y0 ? null : { x0, x1, y0, y1 };
}

/**
 * Point on a wall face in wall coordinates: u along a→b from a, v up from the wall bottom (both m). A point in space is projected onto
 * the wall plane — a hit of the 3D picking ray on the wall surface.
 * @param {{x: number, z: number}} a start of the wall axis, m
 * @param {{x: number, z: number}} b end of the wall axis, m
 * @param {number} unterkante_m wall bottom in m
 * @param {readonly number[]} punkt [x, y, z] world point in m (y up)
 * @returns {{u: number, v: number}} m
 */
export function wandPunkt(a, b, unterkante_m, punkt) {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { u: ((punkt[0] - a.x) * (b.x - a.x) + (punkt[2] - a.z) * (b.z - a.z)) / len, v: punkt[1] - unterkante_m };
}

/**
 * Rectangle from two clicks on one wall face ("push a rectangle through", spec part IV): the sizes of the new opening in wall
 * coordinates. The rectangle is kept inside the wall (edge clearance at the sides, wall bottom and top).
 * @param {{u: number, v: number}} p1 first corner in m
 * @param {{u: number, v: number}} p2 opposite corner in m
 * @param {number} wandLaenge_m wall length in m
 * @param {number} wandHoehe_m wall height in m
 * @returns {{u: number, width: number, height: number, sill: number}|null} middle u, width, height and sill (from the wall bottom), m;
 *   null when a side stays below MIN_OEFFNUNG_M (a mis-click)
 */
export function rechteckAufWand(p1, p2, wandLaenge_m, wandHoehe_m) {
  const u0 = Math.max(OEFFNUNG_RAND_M, Math.min(p1.u, p2.u)), u1 = Math.min(wandLaenge_m - OEFFNUNG_RAND_M, Math.max(p1.u, p2.u));
  const v0 = Math.max(0, Math.min(p1.v, p2.v)), v1 = Math.min(wandHoehe_m, Math.max(p1.v, p2.v));
  const r = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  if (!(u1 - u0 >= MIN_OEFFNUNG_M) || !(v1 - v0 >= MIN_OEFFNUNG_M)) return null;
  return { u: r((u0 + u1) / 2), width: r(u1 - u0), height: r(v1 - v0), sill: r(v0) };
}

/**
 * Rectangle hole of a slab from two plan clicks on its top face (axis parallel in x/z).
 * @param {{x: number, z: number}} p1 first corner in m
 * @param {{x: number, z: number}} p2 opposite corner in m
 * @returns {Array<{x: number, z: number}>|null} four corners in m (counter-clockwise in x/z), null when a side stays below MIN_OEFFNUNG_M
 */
export function deckenLochRechteck(p1, p2) {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x), z0 = Math.min(p1.z, p2.z), z1 = Math.max(p1.z, p2.z);
  if (!(x1 - x0 >= MIN_OEFFNUNG_M) || !(z1 - z0 >= MIN_OEFFNUNG_M)) return null;
  const r = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  return [{ x: r(x0), z: r(z0) }, { x: r(x1), z: r(z0) }, { x: r(x1), z: r(z1) }, { x: r(x0), z: r(z1) }];
}

/**
 * Does a rectangular slab hole lie completely inside the slab outline? A hole that crosses the edge would leave material outside the slab
 * in 3D and in the IFC (107-04 review), so the studio refuses it with a hint.
 * @param {Array<{x: number, z: number}>} loch corners of the hole in m (deckenLochRechteck)
 * @param {Array<{x: number, z: number}>} umriss outline of the slab in m (x/z plan coordinates)
 * @returns {boolean} true when every corner is inside the outline (even-odd rule)
 */
export function lochInDecke(loch, umriss) {
  return Array.isArray(umriss) && umriss.length >= 3 && loch.every((p) => imPolygon(umriss, p));
}

/**
 * Does a new rectangular slab hole overlap one that exists already? Two holes of one slab must not share area (the IFC would void it twice).
 * @param {Array<{x: number, z: number}>} loch corners of the new hole in m (axis parallel, deckenLochRechteck)
 * @param {Array<{points?: Array<{x: number, z: number}>}>} vorhandene holes of the slab (`oeffnungen`), m
 * @returns {boolean} true when the bounding boxes overlap by more than 1 mm on both axes
 */
export function lochUeberlappt(loch, vorhandene) {
  const kasten = (/** @type {Array<{x: number, z: number}>} */ pts) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) });
  const n = kasten(loch);
  return vorhandene.some((l) => {
    if (!Array.isArray(l?.points) || l.points.length < 3) return false;
    const k = kasten(l.points);
    return Math.min(n.x1, k.x1) - Math.max(n.x0, k.x0) > 0.001 && Math.min(n.z1, k.z1) - Math.max(n.z0, k.z0) > 0.001;
  });
}

// ---- Host (wirt) ----------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} WirtWand  a wall as the opening chain needs it (all lengths in m)
 * @property {{x: number, z: number}} a
 * @property {{x: number, z: number}} b
 * @property {number} level
 * @property {number} laenge_m   length of a→b
 * @property {number} dicke_m
 * @property {number} hoehe_m
 * @property {number} unterkante_m
 * @property {number} versatz_m  offset of the wall BODY middle from the axis a→b in m (reference line, 0 = centred), positive towards the left normal
 * @property {string|undefined} refLine reference line of the wall ("center" …), for the hull `refLine` of the model wall
 */

/**
 * @typedef {object} Wirt  the host wall of an opening
 * @property {"gezeichnet"|"huelle"|"werkstatt"} familie drawn wall / hull wall / workshop wall
 * @property {string} schluessel key of the IFC wall registry: "cw:<_idx>", "env:<level>:<edge>", "wt:<guid>"
 * @property {string} guid stable IFC GUID of the wall (the one the export gives it)
 * @property {WirtWand} wand
 * @property {any} roh the wall record as stored (drawn wall record, hull wall of the model, workshop wall)
 * @property {{wallIdx: number}|{level: number, edge: number}|{wirt_guid: string}} ref what an opening record stores to name this host
 * @property {number|null} u position along the wall in m from a: of the opening record, or the projection of a point (penetration, workshop door); null if unknown
 */

/**
 * Where the opening chain finds its walls.
 * @typedef {object} WirtModell
 * @property {any[]} [customWalls]  drawn walls (BIM model record)
 * @property {any[]} [huelle]       hull walls (`model.walls` of createBuildingModel)
 * @property {{waende?: any[]}|null} [werkstatt]  result of werkstattBauteile (workshop walls; envelope pieces with `huelle` are skipped)
 * @property {string|number|null} [projektId] project of the derived GUIDs
 * @property {import("./hoehen.js").Geschosse} [geschosse] storey source (hoehen.js); missing = 3 m storeys
 */

/** @type {WeakMap<object, Wirt[]>} */
const KANDIDATEN = new WeakMap();

/**
 * All walls an opening can sit in, with key and GUID (built once per model object).
 * @param {WirtModell} modell
 * @returns {Wirt[]}
 */
function kandidaten(modell) {
  const hit = KANDIDATEN.get(modell);
  if (hit) return hit;
  const gs = modell.geschosse;
  const pid = modell.projektId ?? null;
  /** @type {Wirt[]} */
  const out = [];
  const laenge = (/** @type {any} */ w) => Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
  // body offset from the axis, derived like 3D, plan and the IFC export (107-01 reference line; core values need the build-up, 107-03)
  const versatz = (/** @type {any} */ w, /** @type {number} */ dicke) => wandGeometrie({ a: w.a, b: w.b, refLine: w.refLine }, { dicke_m: dicke, kern: kernVon(w) }).versatz_m;
  for (const w of modell.customWalls || []) {
    if (!w?.a || !w?.b) continue;
    out.push({ familie: "gezeichnet", schluessel: `cw:${w._idx}`, guid: bauteilGuid(pid, "customWalls", w), roh: w, ref: { wallIdx: w._idx }, u: null,
      wand: { a: w.a, b: w.b, level: w.level || 0, laenge_m: laenge(w), dicke_m: wandDicke_m(w), hoehe_m: wandHoehe(w, gs), unterkante_m: unterkante(w, gs), versatz_m: versatz(w, wandDicke_m(w)), refLine: w.refLine } });
  }
  for (const w of modell.huelle || []) {
    if (!w?.a || !w?.b) continue;
    out.push({ familie: "huelle", schluessel: `env:${w.level}:${w.edge}`, guid: bauteilGuid(pid, "huelle", { id: `${w.level}:${w.edge}` }), roh: w, ref: { level: w.level, edge: w.edge }, u: null,
      wand: { a: w.a, b: w.b, level: w.level, laenge_m: laenge(w), dicke_m: w.thickness, hoehe_m: w.height, unterkante_m: w.elevation, versatz_m: versatz(w, w.thickness), refLine: w.refLine } });
  }
  for (const w of (modell.werkstatt?.waende || []).filter((/** @type {any} */ x) => !x.huelle)) {
    if (!w?.a || !w?.b) continue;
    out.push({ familie: "werkstatt", schluessel: `wt:${w.guid}`, guid: w.guid, roh: w, ref: { wirt_guid: w.guid }, u: null,
      wand: { a: w.a, b: w.b, level: w.level || 0, laenge_m: laenge(w), dicke_m: w.dicke_m, hoehe_m: w.hoehe_m || geschosshoehe(w.level || 0, gs), unterkante_m: elevationOf(w.level || 0, gs), versatz_m: 0, refLine: undefined } });
  }
  KANDIDATEN.set(modell, out);
  return out;
}

/**
 * Host wall of an opening or penetration — ONE resolver for all four kinds of binding (the three copies in BitBimStudio, ifcExport
 * and werkplanung/durchbrueche.js are gone):
 *  1. `wallIdx` → drawn wall (`customWalls[]._idx`)
 *  2. `level` + `edge` → hull wall of the model
 *  3. `a` + `b` (a workshop door with its two end points, `level`) → the workshop wall whose axis passes through the middle of the
 *     door within 1 cm (the rule the IFC export used)
 *  4. `bauteil_guid` (penetration of the openings planning) → the wall with this GUID
 *  and as the last resort `wirt_guid` → the wall with this GUID (a record whose live binding is missing or stale, e.g. after a wall was
 *  split by a change tool). A penetration also yields `u`: its x/y projected onto the wall axis.
 * @param {any} o opening, workshop door or penetration record
 * @param {WirtModell} modell the walls to look in
 * @returns {Wirt|null} null when no wall matches (the caller reports it; nothing is guessed)
 */
export function wirtVon(o, modell) {
  if (!o || !modell) return null;
  const alle = kandidaten(modell);
  /** @type {Wirt|undefined} */
  let w;
  if (o.wallIdx != null) w = alle.find((k) => k.familie === "gezeichnet" && k.roh._idx === o.wallIdx);
  else if (o.level != null && o.edge != null && !o.a) w = alle.find((k) => k.familie === "huelle" && k.roh.level === o.level && k.roh.edge === o.edge);
  else if (o.a && o.b && o.bauteil_guid == null) {
    const mx = (o.a.x + o.b.x) / 2, mz = (o.a.z + o.b.z) / 2;
    w = alle.find((k) => {
      if (k.familie !== "werkstatt" || k.wand.level !== o.level) return false;
      const dx = k.wand.b.x - k.wand.a.x, dz = k.wand.b.z - k.wand.a.z, l = Math.hypot(dx, dz) || 1;
      const s = ((mx - k.wand.a.x) * dx + (mz - k.wand.a.z) * dz) / l;
      return Math.abs(((mx - k.wand.a.x) * dz - (mz - k.wand.a.z) * dx) / l) < WERKSTATT_TOL_M && s >= -1e-6 && s <= l + 1e-6;
    });
  }
  if (!w && typeof o.bauteil_guid === "string" && o.bauteil_guid) w = alle.find((k) => k.guid === o.bauteil_guid);
  if (!w && typeof o.wirt_guid === "string" && o.wirt_guid) w = alle.find((k) => k.guid === o.wirt_guid);
  if (!w) return null;
  const { a, b } = w.wand;
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  const punkt = o.a && o.b ? { x: (o.a.x + o.b.x) / 2, z: (o.a.z + o.b.z) / 2 }
    : Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y)) && o.x !== null && o.y !== null && o.u == null ? { x: Number(o.x), z: Number(o.y) } : null;
  const u = punkt ? ((punkt.x - a.x) * dx + (punkt.z - a.z) * dz) / l : Number.isFinite(Number(o.u)) && o.u != null ? Number(o.u) : null;
  return { ...w, u };
}

/**
 * Does a penetration (Durchbruch record: x, y, z = middle in IFC model coordinates, Z up) lie inside its host wall? The test of check
 * 12 of pruefregeln.js and the position of the penetration in the IFC. The wall BODY is tested, not the axis a→b: with a reference line
 * other than "center" the body lies beside the axis by `wand.versatz_m` (107-04 review).
 * @param {any} d penetration record: x, y, z (m), b, h (m rectangle) or d (m diameter)
 * @param {Wirt} wirt host from wirtVon()
 * @param {{hoehe?: boolean}} [opt] hoehe: also test the height (default true; false when the storey heights of the caller are unknown)
 * @returns {{innen: boolean, grund: string|null, u: number, quer_m: number, koerperQuer_m: number}} u: along the wall from a (m), quer_m: signed
 *   distance of the point from the wall AXIS (m), koerperQuer_m: signed distance from the wall BODY middle (m); grund: German reason when outside
 */
export function durchbruchImWirt(d, wirt, opt = {}) {
  const { a, b, laenge_m, dicke_m, unterkante_m, hoehe_m } = wirt.wand;
  const dx = (b.x - a.x) / (laenge_m || 1), dz = (b.z - a.z) / (laenge_m || 1);
  const px = Number(d?.x) - a.x, pz = Number(d?.y) - a.z;
  const u = px * dx + pz * dz;
  const quer = px * -dz + pz * dx;
  const koerperQuer = quer - (wirt.wand.versatz_m || 0);
  const halbB = d?.form === "rund" ? (Number(d?.d) || 0) / 2 : (Number(d?.b) || 0) / 2;
  const halbH = d?.form === "rund" ? (Number(d?.d) || 0) / 2 : (Number(d?.h) || 0) / 2;
  const z = Number(d?.z);
  const tol = DURCHBRUCH_WIRT_TOL_M;
  if (![u, quer, z].every(Number.isFinite)) return { innen: false, grund: "Lage unvollständig", u, quer_m: quer, koerperQuer_m: koerperQuer };
  if (Math.abs(koerperQuer) > dicke_m / 2 + tol) return { innen: false, grund: `${Math.abs(koerperQuer).toFixed(2)} m neben der Wand (Wand ${dicke_m.toFixed(2)} m dick)`, u, quer_m: quer, koerperQuer_m: koerperQuer };
  if (u - halbB < -tol || u + halbB > laenge_m + tol) return { innen: false, grund: `${u.toFixed(2)} m entlang der Wand (Länge ${laenge_m.toFixed(2)} m)`, u, quer_m: quer, koerperQuer_m: koerperQuer };
  if (opt.hoehe !== false && (z - halbH < unterkante_m - tol || z + halbH > unterkante_m + hoehe_m + tol)) return { innen: false, grund: `Höhe ${z.toFixed(2)} m außerhalb der Wand (${unterkante_m.toFixed(2)} bis ${(unterkante_m + hoehe_m).toFixed(2)} m)`, u, quer_m: quer, koerperQuer_m: koerperQuer };
  return { innen: true, grund: null, u, quer_m: quer, koerperQuer_m: koerperQuer };
}

/**
 * Partial depth of a penetration ("Schlitz", slot): the stated depth `t` when it is smaller than the host thickness, else null (through).
 * The IFC void and the 3D view read this ONE rule: a slot is a recess from one wall face, not a hole through the wall.
 * @param {any} d penetration record (`t` = slot depth in m, null/0 = through)
 * @param {Wirt|null} wirt host from wirtVon()
 * @returns {number|null} depth in m, null = through the full thickness (or no host to compare with)
 */
export function durchbruchTiefe(d, wirt) {
  const t = Number(d?.t);
  return wirt && t > 0 && t < wirt.wand.dicke_m - 1e-6 ? t : null;
}

/**
 * Void of a slot in the wall body frame: it starts at the wall face NEAREST to the stated point and reaches `t` into the wall, plus
 * the 2 cm overshoot the export gives every void on the open face.
 * @param {number} t slot depth in m (durchbruchTiefe)
 * @param {number} koerperQuer_m signed distance of the stated point from the wall body middle in m (durchbruchImWirt)
 * @param {number} dicke_m wall thickness in m
 * @returns {{tiefe_m: number, quer_m: number}} void depth in m and the offset of the void middle from the body middle in m
 */
export function schlitzImKoerper(t, koerperQuer_m, dicke_m) {
  const seite = koerperQuer_m >= 0 ? 1 : -1;
  return { tiefe_m: t + 0.02, quer_m: seite * (dicke_m / 2 - t / 2 + 0.01) };
}

// ---- New opening (one setter for plan click and 3D click) -----------------------------------------------------------------

/**
 * The record of a NEW opening — one function for the click in the plan and the click on a wall face in 3D (107-04), so both set the
 * same fields: host binding (`wallIdx` or `level`+`edge`) plus `wirt_guid`, position, type, optional own sizes and anchor.
 * The position is kept inside the wall: a type click like the plan click always did (half the width plus 10 cm from both ends), a drawn rectangle
 * only by the edge clearance of the hole (OEFFNUNG_RAND_M), so it stays where it was drawn.
 * @param {{wirt: Wirt, u: number, kind: "window"|"door"|"oeffnung", typeId?: string, masse?: {width?: number, height?: number, sill?: number}|null, bezug?: string|null, idx: number}} p
 *   wirt: host (wirtVon); u: wanted middle in m from a; masse: own sizes in m (3D rectangle), null = type size; bezug: anchor of `masse.sill`;
 *   idx: free element number (`_idx`)
 * @returns {{scope: "custom"|"env", satz: Record<string, any>}} scope custom = customWindows, env = envOpenings; satz = the record
 */
export function neueOeffnung({ wirt, u, kind, typeId, masse = null, bezug = null, idx }) {
  const probe = { kind, typeId, ...(masse?.width != null ? { width: masse.width } : {}) };
  const half = oeffnungsMasse(probe).w / 2;
  const len = wirt.wand.laenge_m;
  // type click: half the width plus 10 cm from both ends (the plan click always did); rectangle of two clicks: only the 5 cm edge clearance of the
  // hole itself, so the rectangle sits where it was drawn (a stronger clamp would shift it by up to 5 cm without a word, 107-04 review)
  const lage = masse ? oeffnungMitte_m(u, half * 2, len) : Math.max(half + 0.1, Math.min(u, len - half - 0.1));
  const sizes = masse ? {
    ...(masse.width != null ? { width: masse.width } : {}),
    ...(masse.height != null ? { height: masse.height } : {}),
    ...(masse.sill != null ? { sill: masse.sill } : {}),
    ...(bezug && bezug !== BRUESTUNG_BEZUG_STANDARD ? { bruestung_bezug: bezug } : {}),
  } : {};
  const tid = typeId ?? openingTypeById(kind, undefined).id;
  if (wirt.familie === "huelle") return { scope: "env", satz: { level: wirt.wand.level, edge: /** @type {any} */ (wirt.ref).edge, u: lage, typeId: tid, kind, _idx: idx, wirt_guid: wirt.guid, ...sizes } };
  return { scope: "custom", satz: { wallIdx: /** @type {any} */ (wirt.ref).wallIdx, u: lage, typeId: tid, kind, _idx: idx, wirt_guid: wirt.guid, ...sizes } };
}
