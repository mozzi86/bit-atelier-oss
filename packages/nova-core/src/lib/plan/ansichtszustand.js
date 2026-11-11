// View state ("Ansichtszustand", plan 107-12, spec part III, BK-56…62/73): ONE state object that drives floor plan, section, 3D,
// PDF and DXF — six parameters: layers and their combination, scale (→ level of detail), structure display, lens / renovation
// status, view options, graphic rules. A saved view ("Ausschnitt") lives in the fachlayer `ansicht_layer` (Version 1, one writer:
// BitBimStudio); the lens choice in localStorage stays only the last used value.
//
// The fields keep the names under which the session-only view of the BIM studio already lived (`type`, `level`, `scale`, `combo`,
// `cutHeight`) — no second name generation, no migration; new fields are German (`brille`, `sw`, `strukturdarstellung`, `optionen`,
// `regeln`, `ki_vermerk`). `level` may be negative (basements, 107-13; negative levels are an interpretation of D-BK-20 the user
// still confirms).
//
// D-BK-08a: the view state stores PARAMETERS ONLY. Normalising drops every unknown field, and a guard (enthaeltGeometrie) refuses
// geometry keys (meshes, triangles, cut loops, polygons) — plan, section, PDF and DXF derive their geometry again on every export
// (solid of the CSG core with fallback to the bands, 107-09/10). This module never reads or writes the csg_cache_layer.
//
// Graphic rules (D-BK-23 / Phase 55): data form, evaluation (elementDarstellung 2D, dreiDElementDarstellung 3D) and project
// presets (`regel_vorlagen` on ansicht_layer). The RegelEditor (designer) writes this form — no second override core.
// In renovation lenses the status wins against a rule (97-KONZEPT); the "Grafische Regeln" switch feeds the same list to plan and 3D.
//
// In:  raw view objects / layer blobs, lens, element values, layer bands. Out: normalised views and layer, structure filter,
//      options, rule look (elementDarstellung / dreiDElementDarstellung), presets, export helpers. Pure, no I/O, node-testable.

import { BRILLEN, STANDARD_BRILLE, planDarstellung, dreiDDarstellung, dunkler } from "./brillen.js";
import { DETAILGRAD_STUFEN } from "./massstab.js";
import { BAUTEIL_TYPEN, typFuerWand } from "../bauteil/steckbrief.js";
import { aufbauById, aufbauVon } from "../bauteil/aufbauten.js";
import { wandGeometrie } from "../bauteil/referenz.js";

/** View types (the studio's `view`): floor plan, section, 3D. */
export const AUSSCHNITT_TYPEN = Object.freeze(["grundriss", "schnitt", "3d"]);

/**
 * Structure display (spec III.3 PartialStructureDisplay): which layers by FUNCTION (107-03 `funktion`) stay visible.
 * gesamt = all; ohne-bekleidung = without finishes; nur-kern = core layers only; nur-kern-tragend = core layers of load-bearing
 * elements only (formwork plan). Display only — quantities and the IFC export always see the whole model.
 */
export const STRUKTURDARSTELLUNGEN = Object.freeze(["gesamt", "ohne-bekleidung", "nur-kern", "nur-kern-tragend"]);

/** Switchable view options (spec III.5 ModelViewOptions); missing = default from the level of detail (optionenFuer). */
export const OPTIONEN_FELDER = Object.freeze(["tuerAufschlag", "fensterSymbol", "durchbruchSymbol", "schraffurMaterial", "schraffurStatus"]);

/** Operators of a rule condition. "gesetzt" = the field has a value (not null/empty/false), "enthaelt" = text contains. */
export const OPERATOREN = Object.freeze(["=", "!=", ">", ">=", "<", "<=", "gesetzt", "enthaelt"]);

/** Element fields a rule may test (darstellungsWerte reads them). */
export const REGEL_FELDER = Object.freeze(["status", "tragend", "feuerwiderstand", "bauteil_typ", "material", "schallschutz_rw_db", "u_wert"]);

/**
 * Rule colours as print hex of the app tokens (packages/nova-core/src/index.css :root; skill bit-farbsehen FARB-06: tokens, not loose
 * values): warnung = hsl(23 83% 18%) (the same print value as planStand.js VERMERK_DRUCK.linie), hinweis = hsl(201 90% 36%),
 * erfolg = hsl(163 94% 20%), vordergrund = the plan's dark grey. "dunkler" is no colour but "the base fill, 35 % darker".
 * A rule always adds FORM to colour (FARB-01): the fire-resistance rule draws a dash-dot outline.
 * @type {Readonly<Record<string, string>>}
 */
export const REGEL_FARBEN = Object.freeze({ warnung: "#542508", hinweis: "#0974ae", erfolg: "#036348", vordergrund: "#18181b" });

/** Share of black of the fill "dunkler" (0..1) [ASSUMED: visibly darker in colour and in grey print, poché stays readable]. */
export const DUNKLER_ANTEIL = 0.35;

/**
 * @typedef {{feld: string, operator: string, wert?: string|number|boolean|null}} RegelWenn
 * @typedef {{fuellung?: string, kontur?: string, strich?: string, strichbreite_mm?: number, deckkraft?: number}} RegelDann
 *   deckkraft: opacity 0..1 (55-01, 3D and optional plan fade); strichbreite_mm: outline width on paper, mm
 * @typedef {{wenn: RegelWenn, dann: RegelDann}} Regel
 * @typedef {{id: string, name: string, regeln: Regel[]}} RegelVorlage  project or built-in preset (UEB-04)
 */

/**
 * The two standard rules (107-12 Task 4). Order = precedence (the FIRST matching rule wins): a stated fire resistance (107-08
 * `feuerwiderstand`) draws a warning-coloured dash-dot outline; a load-bearing element gets a darker fill.
 * [ASSUMED] fire resistance before load-bearing: it is the more specific statement (fire walls are mostly load-bearing anyway).
 * @type {ReadonlyArray<Regel>}
 */
export const STANDARD_REGELN = Object.freeze([
  Object.freeze({ wenn: Object.freeze({ feld: "feuerwiderstand", operator: "gesetzt" }), dann: Object.freeze({ kontur: "warnung", strich: "4 1 1 1", strichbreite_mm: 0.5 }) }),
  Object.freeze({ wenn: Object.freeze({ feld: "tragend", operator: "=", wert: true }), dann: Object.freeze({ fuellung: "dunkler" }) }),
]);

/**
 * Built-in graphic-rule presets (55-01 / UEB-04). Same schema as project `regel_vorlagen`; the editor offers them without storing
 * a copy until the user saves one into ansicht_layer. Each preset carries FORM with colour (FARB-01).
 * @type {ReadonlyArray<Readonly<RegelVorlage>>}
 */
export const STANDARD_VORLAGEN = Object.freeze(/** @type {RegelVorlage[]} */ ([
  Object.freeze({
    id: "brandschutz",
    name: "Brandschutz-Prüfung",
    regeln: Object.freeze([
      Object.freeze({ wenn: Object.freeze({ feld: "feuerwiderstand", operator: "gesetzt" }), dann: Object.freeze({ kontur: "warnung", strich: "4 1 1 1", strichbreite_mm: 0.5 }) }),
    ]),
  }),
  Object.freeze({
    id: "tragend",
    name: "Tragende Bauteile",
    regeln: Object.freeze([
      Object.freeze({ wenn: Object.freeze({ feld: "tragend", operator: "=", wert: true }), dann: Object.freeze({ fuellung: "dunkler" }) }),
    ]),
  }),
  Object.freeze({
    id: "steckbrief-offen",
    name: "Unvollständiger Steckbrief",
    regeln: Object.freeze([
      // status === null → no renovation decision yet (D-BW-03 "ohne"); warn fill + dotted outline + slight fade (FARB-01)
      Object.freeze({ wenn: Object.freeze({ feld: "status", operator: "=", wert: null }), dann: Object.freeze({ fuellung: "warnung", strich: "2 2", strichbreite_mm: 0.35, deckkraft: 0.85 }) }),
    ]),
  }),
]));

/** Most project rule presets stored on ansicht_layer [ASSUMED: enough for office packs, keeps the layer small]. */
export const MAX_REGEL_VORLAGEN = 50;

/**
 * Keys that hold geometry (meshes, triangles, cut loops, polygons). A view never stores them (D-BK-08a); normalising drops them and
 * enthaeltGeometrie finds them anywhere in an object.
 */
export const GEOMETRIE_FELDER = Object.freeze(["positionen", "indizes", "normalen", "mesh", "geometrie", "dreiecke", "polygone", "polygon", "ringe", "schnittschleifen", "baender", "punkte", "points", "vertices", "faces", "solid", "inhalt"]);

/** Size limit of ONE stored view with all parameters, bytes of its JSON [ASSUMED: parameters only; a geometry leak would exceed it]. */
export const AUSSCHNITT_MAX_BYTES = 8192;

/** How long an export waits for the solids of the CSG core before it falls back to the bands, ms [ASSUMED: generous for a storey]. */
export const SOLID_ZEITGRENZE_MS = 10000;

/** Most views kept per project [ASSUMED: guard against an endless list in the record]. */
export const MAX_AUSSCHNITTE = 200;
/** Most rules per view [ASSUMED]. */
export const MAX_REGELN = 20;
/** Most visible layer ids of an own combination stored in a view [ASSUMED: the studio has 10 layers; room for later ones]. */
export const MAX_EBENEN = 64;

/**
 * Name of the layer combination "own switches" (the studio's `combo` after a single layer click). A view with it stores its visible
 * layers in `ebenen_sichtbar` (review 107-12): the named combinations are fixed sets, an own one is not.
 */
export const EIGENE_KOMBINATION = "Eigene";

/** Note on the sheet / in the DXF when walls of the export come from the bands instead of the solid (never silent). */
export const RUECKFALL_VERMERK = "Wände aus Bändern abgeleitet, Solid nicht verfügbar";

/** Empty `ansicht_layer` (default of useFachlayer): no views, the studio's DEFAULT_LAYERS and LAYER_COMBOS apply; no project presets. */
export const ANSICHT_LEER = Object.freeze({
  ausschnitte: Object.freeze([]),
  ebenen: Object.freeze([]),
  kombinationen: Object.freeze({}),
  regel_vorlagen: Object.freeze([]),
});

/**
 * @typedef {object} Ausschnitt
 * @property {string} id
 * @property {string} name
 * @property {"grundriss"|"schnitt"|"3d"} type
 * @property {number} level           storey level (integer, negative = basement)
 * @property {number} scale           scale denominator (100 = 1:100)
 * @property {string} combo           layer combination name ("Eigene" = own switches, see ebenen_sichtbar)
 * @property {string[]|null} ebenen_sichtbar  ids of the visible layers when combo is "Eigene" (sorted), else null — review 107-12: an
 *                                    own combination is reproducible only with its layers (a parameter, no geometry)
 * @property {number} cutHeight       cut height above the storey level, m (input of the horizontal cut, 107-09)
 * @property {string} brille          lens id (plan/brillen.js)
 * @property {boolean} sw             black-and-white variant of the permit lens
 * @property {string} strukturdarstellung  one of STRUKTURDARSTELLUNGEN
 * @property {Partial<Record<string, boolean>>|null} optionen  view options, null = from the level of detail
 * @property {Regel[]|null} regeln    graphic rules, null = none
 * @property {boolean|null} ki_vermerk  "enthält ungeprüfte KI-Änderungen" when the view was saved (106-11 planStand.vermerkNoetig), null = unknown; no logic here
 */

const istText = (/** @type {any} */ v) => typeof v === "string" && v.trim() !== "";
const zahl = (/** @type {any} */ v, /** @type {number} */ standard) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : standard);

/**
 * One normalised rule, or null when it cannot be evaluated (unknown field or operator). Unknown keys are dropped.
 * @param {any} r raw rule
 * @returns {Regel|null}
 */
export function regelNormalisieren(r) {
  const w = r?.wenn, d = r?.dann;
  if (!w || !REGEL_FELDER.includes(w.feld) || !OPERATOREN.includes(w.operator)) return null;
  /** @type {RegelWenn} */
  const wenn = { feld: w.feld, operator: w.operator };
  if (w.operator !== "gesetzt") {
    const t = typeof w.wert;
    if (!(t === "string" || t === "number" || t === "boolean" || w.wert === null)) return null;
    wenn.wert = w.wert;
  }
  /** @type {RegelDann} */
  const dann = {};
  if (d?.fuellung === "dunkler" || Object.prototype.hasOwnProperty.call(REGEL_FARBEN, d?.fuellung)) dann.fuellung = d.fuellung;
  if (Object.prototype.hasOwnProperty.call(REGEL_FARBEN, d?.kontur)) dann.kontur = d.kontur;
  if (typeof d?.strich === "string" && /^\d+(\.\d+)?(\s+\d+(\.\d+)?)*$/.test(d.strich.trim())) dann.strich = d.strich.trim();
  const sb = Number(d?.strichbreite_mm);
  if (Number.isFinite(sb) && sb >= 0.05 && sb <= 2) dann.strichbreite_mm = sb;
  // 55-01: opacity 0..1 (3D fade; plan may read it later). Reject 0 (= invisible via a rule) and values outside the unit interval.
  const dk = Number(d?.deckkraft);
  if (Number.isFinite(dk) && dk > 0 && dk <= 1) dann.deckkraft = Math.round(dk * 1000) / 1000;
  return Object.keys(dann).length ? { wenn, dann } : null;
}

/**
 * One normalised project rule preset, or null when unusable. Unknown keys dropped; at most MAX_REGELN rules.
 * @param {any} v raw preset
 * @returns {RegelVorlage|null}
 */
export function regelVorlageNormalisieren(v) {
  if (!v || !istText(v.id) || !istText(v.name)) return null;
  const regeln = Array.isArray(v.regeln) ? v.regeln.map(regelNormalisieren).filter(Boolean).slice(0, MAX_REGELN) : [];
  if (!regeln.length) return null;
  return { id: String(v.id).slice(0, 64), name: String(v.name).trim().slice(0, 80), regeln: /** @type {Regel[]} */ (regeln) };
}

/**
 * Deep-clone a rule list for editing (frozen STANDARD_REGELN / STANDARD_VORLAGEN stay untouched).
 * @param {ReadonlyArray<Regel>|null|undefined} regeln
 * @returns {Regel[]}
 */
export function regelnKlonen(regeln) {
  return (Array.isArray(regeln) ? regeln : []).map((r) => {
    const n = regelNormalisieren(r);
    return n ? { wenn: { ...n.wenn }, dann: { ...n.dann } } : null;
  }).filter(Boolean);
}

/**
 * Reorder rules: move index `von` to `nach` (0-based). First match wins — order is the precedence.
 * @param {ReadonlyArray<Regel>} regeln
 * @param {number} von source index
 * @param {number} nach destination index
 * @returns {Regel[]}
 */
export function regelnUmordnen(regeln, von, nach) {
  const list = regelnKlonen(regeln);
  if (!Number.isInteger(von) || !Number.isInteger(nach) || von < 0 || nach < 0 || von >= list.length || nach >= list.length || von === nach) return list;
  const [item] = list.splice(von, 1);
  list.splice(nach, 0, item);
  return list;
}

/**
 * Next free preset id ("rv1", "rv2", …).
 * @param {ReadonlyArray<{id?: string}>} liste
 * @returns {string}
 */
export function naechsteVorlageId(liste) {
  let max = 0;
  for (const a of liste || []) { const m = /^rv(\d+)$/.exec(String(a?.id ?? "")); if (m) max = Math.max(max, Number(m[1])); }
  return `rv${max + 1}`;
}

/**
 * Normalises a view: known fields only (unknown and geometry fields are dropped and never stored), types checked, defaults set.
 * Accepts the session views of the BIM studio before 107-12 ({id, name, type, level, scale, combo, cutHeight}) unchanged.
 * @param {any} roh raw view (stored record, session view, studio state)
 * @returns {Ausschnitt}
 */
export function ausschnittNormalisieren(roh) {
  const r = roh && typeof roh === "object" ? roh : {};
  const type = AUSSCHNITT_TYPEN.includes(r.type) ? r.type : "grundriss";
  const scale = zahl(r.scale, 100);
  const cut = zahl(r.cutHeight, 1.1);
  /** @type {Partial<Record<string, boolean>>|null} */
  let optionen = null;
  if (r.optionen && typeof r.optionen === "object") {
    optionen = {};
    for (const k of OPTIONEN_FELDER) if (typeof r.optionen[k] === "boolean") optionen[k] = r.optionen[k];
    if (!Object.keys(optionen).length) optionen = null;
  }
  const regeln = Array.isArray(r.regeln) ? r.regeln.map(regelNormalisieren).filter(Boolean).slice(0, MAX_REGELN) : null;
  return {
    id: r.id != null && r.id !== "" ? String(r.id) : "",
    name: istText(r.name) ? String(r.name).trim().slice(0, 80) : "",
    type,
    level: Math.trunc(zahl(r.level, 0)),
    scale: scale > 0 && scale <= 100000 ? scale : 100,
    combo: istText(r.combo) ? String(r.combo) : "Alle zeigen",
    ebenen_sichtbar: r.combo === EIGENE_KOMBINATION && Array.isArray(r.ebenen_sichtbar)
      ? [...new Set(r.ebenen_sichtbar.filter(istText).map(String))].sort().slice(0, MAX_EBENEN) : null,
    // the studio's cut-height input allows 0.5 … 2.5 m; stored values outside a sane band fall back to the default 1.1 m
    cutHeight: cut > 0 && cut < 20 ? cut : 1.1,
    brille: BRILLEN.some((b) => b.id === r.brille) ? r.brille : STANDARD_BRILLE,
    sw: r.sw === true,
    strukturdarstellung: STRUKTURDARSTELLUNGEN.includes(r.strukturdarstellung) ? r.strukturdarstellung : "gesamt",
    optionen,
    regeln: regeln && regeln.length ? /** @type {Regel[]} */ (regeln) : null,
    ki_vermerk: typeof r.ki_vermerk === "boolean" ? r.ki_vermerk : null,
  };
}

/**
 * A complete view with defaults (floor plan of level 0, 1:100, all layers, cut height 1.1 m, input lens, whole structure, options
 * from the level of detail, no rules), overridden by `teil`.
 * @param {Partial<Ausschnitt>} [teil]
 * @returns {Ausschnitt}
 */
export function ausschnittStandard(teil = {}) {
  return ausschnittNormalisieren(teil);
}

/**
 * True when two views show the same thing (all parameters equal; id, name and the AI note are not compared). The studio exports
 * from a saved view only while its state still equals it. The storey `level` counts only for a floor plan (review 107-12): a section
 * or 3D view does not depend on it, and applying one does not move the studio's plan storey.
 * @param {any} a @param {any} b raw or normalised views
 * @returns {boolean}
 */
export function ausschnittGleich(a, b) {
  const p = (/** @type {any} */ x) => {
    const { id: _i, name: _n, ki_vermerk: _k, ...rest } = ausschnittNormalisieren(x);
    if (rest.type !== "grundriss") rest.level = 0;
    return JSON.stringify(rest);
  };
  return p(a) === p(b);
}

/**
 * Layer visibility a view prints with: a named combination gives its fixed set, an own combination ("Eigene") the stored
 * `ebenen_sichtbar`; null = neither (an own view saved without layers) — the caller then keeps its current switches.
 * @param {any} ausschnitt normalised view
 * @param {ReadonlyArray<{id: string}>} ebenen the studio's layer list (DEFAULT_LAYERS)
 * @param {Record<string, ReadonlyArray<string>>} kombinationen the studio's named combinations (LAYER_COMBOS)
 * @returns {Record<string, boolean>|null} layer id → visible
 */
export function ebenenSichtbarkeit(ausschnitt, ebenen, kombinationen) {
  const benannt = kombinationen && Object.prototype.hasOwnProperty.call(kombinationen, ausschnitt?.combo) ? kombinationen[ausschnitt.combo] : null;
  const an = benannt ?? (ausschnitt?.combo === EIGENE_KOMBINATION && Array.isArray(ausschnitt?.ebenen_sichtbar) ? ausschnitt.ebenen_sichtbar : null);
  if (!an) return null;
  return Object.fromEntries((ebenen || []).map((l) => [l.id, an.includes(l.id)]));
}

/**
 * The saved views after an undo / redo step of the drawing history (review 107-12): only the views a LOCAL step of this session
 * saved or deleted (`betroffen`) follow the snapshot; every other view — e.g. one that came from another device meanwhile — stays as
 * it is now. Order: the current list, views brought back by the step appended in snapshot order.
 * @param {ReadonlyArray<any>} jetzt views now
 * @param {ReadonlyArray<any>} ziel views of the snapshot that is restored
 * @param {Iterable<string>} betroffen ids of views saved or deleted by local steps
 * @returns {any[]}
 */
export function ausschnitteWiederherstellen(jetzt, ziel, betroffen) {
  const b = new Set(betroffen);
  const zielJe = new Map((ziel || []).map((v) => [v?.id, v]));
  const jetztIds = new Set((jetzt || []).map((v) => v?.id));
  const out = [];
  for (const v of jetzt || []) {
    if (!b.has(v?.id)) out.push(v);
    else if (zielJe.has(v.id)) out.push(zielJe.get(v.id));
  }
  for (const v of ziel || []) if (b.has(v?.id) && !jetztIds.has(v.id)) out.push(v);
  return out;
}

/**
 * True when the object holds a geometry key at any depth (GEOMETRIE_FELDER) — the guard of D-BK-08a for stored views and layers.
 * @param {any} obj
 * @returns {boolean}
 */
export function enthaeltGeometrie(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some(enthaeltGeometrie);
  for (const [k, v] of Object.entries(obj)) {
    if (GEOMETRIE_FELDER.includes(k)) return true;
    if (enthaeltGeometrie(v)) return true;
  }
  return false;
}

/**
 * Layer properties as stored: {id, visible, locked, farbe?, linientyp?, drucken?}. `visible`/`locked` are the existing names of the
 * studio's DEFAULT_LAYERS; the new properties are German. Invalid entries → null.
 * @param {any} e
 * @returns {{id: string, visible: boolean, locked: boolean, farbe?: string, linientyp?: string, drucken?: boolean}|null}
 */
export function ebeneNormalisieren(e) {
  if (!e || !istText(e.id)) return null;
  /** @type {{id: string, visible: boolean, locked: boolean, farbe?: string, linientyp?: string, drucken?: boolean}} */
  const out = { id: String(e.id), visible: e.visible !== false, locked: e.locked === true };
  if (typeof e.farbe === "string" && /^#[0-9a-fA-F]{6}$/.test(e.farbe)) out.farbe = e.farbe;
  if (istText(e.linientyp)) out.linientyp = String(e.linientyp);
  if (typeof e.drucken === "boolean") out.drucken = e.drucken;
  return out;
}

/**
 * The fachlayer `ansicht_layer` in normal form: {ausschnitte, ebenen, kombinationen, regel_vorlagen}. A missing blob (old project)
 * gives the empty layer; duplicate view / preset ids keep the first; at most MAX_AUSSCHNITTE views and MAX_REGEL_VORLAGEN presets.
 * `regel_vorlagen` is additive (55-01 / UEB-04): absent on v1 blobs → []. `kombinationen` = own combinations {name: [layer ids]}.
 * @param {any} layer stored blob (may carry v / updatedAt; they are not returned)
 * @returns {{ausschnitte: Ausschnitt[], ebenen: Array<NonNullable<ReturnType<typeof ebeneNormalisieren>>>, kombinationen: Record<string, string[]>, regel_vorlagen: RegelVorlage[]}}
 */
export function ansichtLayerNormalisieren(layer) {
  const l = layer && typeof layer === "object" ? layer : {};
  const gesehen = new Set();
  /** @type {Ausschnitt[]} */
  const ausschnitte = [];
  for (const a of Array.isArray(l.ausschnitte) ? l.ausschnitte : []) {
    const n = ausschnittNormalisieren(a);
    if (!n.id || gesehen.has(n.id)) continue;
    gesehen.add(n.id);
    ausschnitte.push(n);
    if (ausschnitte.length >= MAX_AUSSCHNITTE) break;
  }
  const ebenen = (Array.isArray(l.ebenen) ? l.ebenen : []).map(ebeneNormalisieren).filter((x) => x !== null);
  /** @type {Record<string, string[]>} */
  const kombinationen = {};
  if (l.kombinationen && typeof l.kombinationen === "object" && !Array.isArray(l.kombinationen)) {
    for (const [name, ids] of Object.entries(l.kombinationen)) if (istText(name) && Array.isArray(ids)) kombinationen[name] = ids.filter(istText).map(String);
  }
  const gesehenV = new Set();
  /** @type {RegelVorlage[]} */
  const regel_vorlagen = [];
  for (const v of Array.isArray(l.regel_vorlagen) ? l.regel_vorlagen : []) {
    const n = regelVorlageNormalisieren(v);
    if (!n || gesehenV.has(n.id)) continue;
    gesehenV.add(n.id);
    regel_vorlagen.push(n);
    if (regel_vorlagen.length >= MAX_REGEL_VORLAGEN) break;
  }
  return { ausschnitte, ebenen: /** @type {any} */ (ebenen), kombinationen, regel_vorlagen };
}

/**
 * The studio's layer list with the stored properties applied by id (unknown stored ids are ignored, missing ones keep the default).
 * @template {{id: string, visible: boolean, locked: boolean}} T
 * @param {ReadonlyArray<T>} standard DEFAULT_LAYERS of the studio
 * @param {ReadonlyArray<any>} gespeichert ansicht_layer.ebenen
 * @returns {T[]}
 */
export function ebenenAnwenden(standard, gespeichert) {
  const je = new Map((Array.isArray(gespeichert) ? gespeichert : []).map(ebeneNormalisieren).filter((x) => x !== null).map((e) => [e.id, e]));
  return standard.map((s) => {
    const g = je.get(s.id);
    if (!g) return s;
    const { id: _id, ...props } = g;
    return { ...s, ...props };
  });
}

/**
 * Next free view id ("a1", "a2", …) — own numbering, independent of the element counter of the studio.
 * @param {ReadonlyArray<{id?: string}>} liste
 * @returns {string}
 */
export function naechsteAusschnittId(liste) {
  let max = 0;
  for (const a of liste || []) { const m = /^a(\d+)$/.exec(String(a?.id ?? "")); if (m) max = Math.max(max, Number(m[1])); }
  return `a${max + 1}`;
}

/**
 * Size of a view as stored, bytes of its UTF-8 JSON.
 * @param {any} ausschnitt
 * @returns {number}
 */
export function ausschnittBytes(ausschnitt) {
  return new TextEncoder().encode(JSON.stringify(ausschnittNormalisieren(ausschnitt))).length;
}

// ---- structure display ---------------------------------------------------------------------------------------------------

/**
 * Whether an element is load-bearing: explicit `tragend` on the element, else the type table (steckbrief BAUTEIL_TYPEN, walls typed by
 * typFuerWand). Columns are load-bearing.
 * @param {any} el element record
 * @param {"wand"|"stuetze"|"decke"|string} [art] element kind
 * @returns {boolean}
 */
export function tragendVon(el, art = "wand") {
  if (typeof el?.tragend === "boolean") return el.tragend;
  if (el?.bauteil_typ && /** @type {any} */ (BAUTEIL_TYPEN)[el.bauteil_typ]) return !!/** @type {any} */ (BAUTEIL_TYPEN)[el.bauteil_typ].tragend;
  if (art === "stuetze" || art === "decke") return true;
  return !!/** @type {any} */ (BAUTEIL_TYPEN)[typFuerWand(el).typ]?.tragend;
}

/**
 * Whether a layer of this function stays visible under the structure display.
 * @param {string|null|undefined} funktion layer function ("kern" | "bekleidung" | "sonstig"; unknown counts as "sonstig")
 * @param {string|null|undefined} strukturdarstellung one of STRUKTURDARSTELLUNGEN (missing = gesamt)
 * @param {boolean} [tragend] the element is load-bearing (only nur-kern-tragend reads it)
 * @returns {boolean}
 */
export function schichtSichtbar(funktion, strukturdarstellung, tragend = true) {
  switch (strukturdarstellung) {
    case "ohne-bekleidung": return funktion !== "bekleidung";
    case "nur-kern": return funktion === "kern";
    case "nur-kern-tragend": return funktion === "kern" && tragend === true;
    default: return true;
  }
}

/**
 * Filters the layer bands of ONE element by the structure display — the same rule for the four-point layer strips of the plan and
 * for the material groups of a solid cut (107-09/10): every band names its layer by `schicht` (index outside → inside) or by its
 * position; the function comes from the build-up (aufbauVon(el).schichten[i].funktion), never from the mesh. Nothing is moved: the
 * reference line and the offsets stay on the whole thickness, only bands drop out.
 * @template {{schicht?: number}} B
 * @param {ReadonlyArray<B>} baender bands of the element
 * @param {ReadonlyArray<string|null|undefined>} funktionen function per layer index
 * @param {string|null|undefined} strukturdarstellung
 * @param {boolean} [tragend]
 * @returns {B[]} the visible bands (same objects, same order); "gesamt" returns a copy of all
 */
export function baenderNachStruktur(baender, funktionen, strukturdarstellung, tragend = true) {
  const liste = Array.isArray(baender) ? baender : [];
  if (!strukturdarstellung || strukturdarstellung === "gesamt") return [...liste];
  return liste.filter((b, i) => schichtSichtbar(funktionen[Number.isInteger(b?.schicht) ? /** @type {number} */ (b.schicht) : i], strukturdarstellung, tragend));
}

/**
 * Layer strips of a multi-layer wall (composite build-up) as four-point polygons, outside → inside — the strips the screen plan drew
 * before 107-12 (BimPlan2D wallSkinBands, now delegating here) plus `schicht` (layer index) and `funktion` (107-03), so plan, PDF and
 * DXF filter the same strips. Offset and normal from the ONE reference-line derivation (bauteil/referenz.js).
 * @param {any} w wall {a, b, composite, refLine, …} (m)
 * @returns {Array<{schicht: number, color: string, name: string, hatch?: string, funktion: string, aussen_m: number, innen_m: number, pts: Array<{x: number, z: number}>}>|null}
 *   null = no composite; aussen_m / innen_m = offsets of the strip's faces along the wall normal from the reference line (m)
 */
export function wandSchichtStreifen(w) {
  const comp = w?.composite ? aufbauById(w.composite) : null;
  if (!comp) return null;
  const { normale: { x: nx, z: nz }, dicke_m: total, versatz_m: o } = wandGeometrie(w);
  const funktionen = wandFunktionen(w);
  let cur = o + total / 2; // outer face
  return comp.skins.map((/** @type {any} */ sk, /** @type {number} */ i) => {
    const tk = sk.thickness / 1000; const a1 = cur, a2 = cur - tk; cur = a2;
    return {
      schicht: i, color: sk.color, name: sk.name, hatch: sk.hatch, funktion: funktionen[i] ?? "sonstig", aussen_m: a1, innen_m: a2,
      pts: [
        { x: w.a.x + nx * a1, z: w.a.z + nz * a1 },
        { x: w.b.x + nx * a1, z: w.b.z + nz * a1 },
        { x: w.b.x + nx * a2, z: w.b.z + nz * a2 },
        { x: w.a.x + nx * a2, z: w.a.z + nz * a2 },
      ],
    };
  });
}

/**
 * Section groups (cut layers of the section, key "env:<level>:<edge>" + layer index `schicht`) filtered by the structure display —
 * review 107-12: the function of a group comes from the build-up of ITS wall (basement walls carry their own build-up), the same rule
 * as the floor plan; screen section and PDF section call this one function. Hull walls count as load-bearing; groups of other keys
 * and of walls not in the list stay.
 * @template {{schluessel?: string, schicht?: number}} G
 * @param {ReadonlyArray<G>|null|undefined} gruppen section groups
 * @param {ReadonlyArray<any>|null|undefined} waende the model's hull walls ({level, edge, composite, thickness, …})
 * @param {string|null|undefined} strukturdarstellung
 * @returns {G[]} the visible groups (same objects, same order)
 */
export function schnittGruppenNachStruktur(gruppen, waende, strukturdarstellung) {
  const liste = Array.isArray(gruppen) ? gruppen : [];
  if (!strukturdarstellung || strukturdarstellung === "gesamt") return [...liste];
  const je = new Map((waende || []).map((w) => [`env:${w.level}:${w.edge}`, w]));
  /** @type {Map<string, string[]>} */
  const funktionen = new Map();
  return liste.filter((f) => {
    const k = String(f?.schluessel ?? "");
    const w = k.startsWith("env:") ? je.get(k) : null;
    if (!w) return true;
    if (!funktionen.has(k)) funktionen.set(k, wandFunktionen(w));
    return schichtSichtbar(/** @type {string[]} */ (funktionen.get(k))[Number.isInteger(f.schicht) ? /** @type {number} */ (f.schicht) : 0], strukturdarstellung, true);
  });
}

/**
 * Structure display on a 3D mesh (review 107-12; duck-typed, no three import): a mesh with one material per layer group
 * (`userData.mitSchichtMaterial`, intersected solid) hides the groups; a mesh of ONE layer (`userData.schicht`, layer boxes of
 * buildSchichtWand without intersection) or of a wall without build-up (schicht 0, function "kern") hides its own material. Only
 * meshes whose material is their own (`userData.eigenesMaterial`) are touched — shared materials and mesh.visible (layer switches)
 * stay with their owners. Side effect: sets `material.visible`.
 * @param {{userData?: any, material?: any}} mesh
 * @param {string|null|undefined} strukturdarstellung
 * @returns {boolean} the mesh was handled
 */
export function strukturAufMeshAnwenden(mesh, strukturdarstellung) {
  const u = mesh?.userData;
  if (!u || !Array.isArray(u.schichtFunktionen)) return false;
  const tragend = u.tragend !== false;
  if (u.mitSchichtMaterial && Array.isArray(mesh.material)) {
    mesh.material.forEach((/** @type {any} */ mat, /** @type {number} */ i) => { mat.visible = schichtSichtbar(u.schichtFunktionen[i], strukturdarstellung, tragend); });
    return true;
  }
  if (u.eigenesMaterial && mesh.material && !Array.isArray(mesh.material)) {
    mesh.material.visible = schichtSichtbar(u.schichtFunktionen[Number.isInteger(u.schicht) ? u.schicht : 0], strukturdarstellung, tragend);
    return true;
  }
  return false;
}

/**
 * Function per layer index of a wall (stated, element override or proposal; aufbauVon of 107-03). A wall without build-up is one
 * layer of thickness → ["kern"] (funktionVorschlag: a single layer of unknown material is the core).
 * @param {any} w wall record
 * @returns {string[]}
 */
export function wandFunktionen(w) {
  return aufbauVon(w).schichten.map((s) => s.funktion);
}

// ---- options and rules ---------------------------------------------------------------------------------------------------

/**
 * The effective view options: stated values win, the rest comes from the level of detail (door swing from tuerBogen, material hatch
 * from schraffur, symbols and the status hatch on).
 * @param {{tuerBogen: boolean, schraffur: boolean}} detailgrad result of detailgradFuer
 * @param {Partial<Record<string, boolean>>|null|undefined} optionen stated options of the view
 * @returns {{tuerAufschlag: boolean, fensterSymbol: boolean, durchbruchSymbol: boolean, schraffurMaterial: boolean, schraffurStatus: boolean}}
 */
export function optionenFuer(detailgrad, optionen) {
  const o = optionen || {};
  const b = (/** @type {string} */ k, /** @type {boolean} */ s) => (typeof o[k] === "boolean" ? /** @type {boolean} */ (o[k]) : s);
  return {
    tuerAufschlag: b("tuerAufschlag", !!detailgrad?.tuerBogen),
    fensterSymbol: b("fensterSymbol", true),
    durchbruchSymbol: b("durchbruchSymbol", true),
    schraffurMaterial: b("schraffurMaterial", !!detailgrad?.schraffur),
    schraffurStatus: b("schraffurStatus", true),
  };
}

/**
 * Stated view options without the values that equal the default of the level of detail (review 107-12): switching an option on and
 * off again gives back null ("from the level of detail"), so the same parameters never yield two different sheets.
 * @param {Partial<Record<string, boolean>>|null|undefined} optionen
 * @param {{tuerBogen: boolean, schraffur: boolean}} detailgrad result of detailgradFuer
 * @returns {Partial<Record<string, boolean>>|null}
 */
export function optionenOhneStandard(optionen, detailgrad) {
  if (!optionen || typeof optionen !== "object") return null;
  const std = /** @type {Record<string, boolean>} */ (optionenFuer(detailgrad, null));
  /** @type {Partial<Record<string, boolean>>} */
  const out = {};
  for (const k of OPTIONEN_FELDER) if (typeof optionen[k] === "boolean" && optionen[k] !== std[k]) out[k] = optionen[k];
  return Object.keys(out).length ? out : null;
}

/**
 * The values a rule tests, read from an element record: status, load-bearing, fire resistance (107-08), type, material.
 * @param {any} el element record
 * @param {string} [art] "wand" | "stuetze" | "decke"
 * @param {Record<string, any>} [extra] values that override the record (hull walls: status of the attribute layer, tragend)
 * @returns {Record<string, any>}
 */
export function darstellungsWerte(el, art = "wand", extra = {}) {
  return {
    status: el?.status ?? null,
    tragend: tragendVon(el, art),
    feuerwiderstand: typeof el?.feuerwiderstand === "string" && el.feuerwiderstand.trim() && el.feuerwiderstand.trim() !== "ohne" ? el.feuerwiderstand.trim() : null,
    bauteil_typ: el?.bauteil_typ ?? null,
    material: el?.material ?? el?.composite ?? null,
    schallschutz_rw_db: Number.isFinite(Number(el?.schallschutz_rw_db)) && el?.schallschutz_rw_db !== null ? Number(el.schallschutz_rw_db) : null,
    u_wert: Number.isFinite(Number(el?.u_wert)) && el?.u_wert !== null ? Number(el.u_wert) : null,
    ...extra,
  };
}

/**
 * Whether a condition holds for the values. Numbers compare numerically, everything else as text ("=" also matches true/"true").
 * @param {RegelWenn} wenn
 * @param {Record<string, any>} werte
 * @returns {boolean}
 */
export function regelPasst(wenn, werte) {
  if (!wenn) return false;
  const v = werte?.[wenn.feld];
  const gesetzt = v !== null && v !== undefined && v !== "" && v !== false;
  switch (wenn.operator) {
    case "gesetzt": return gesetzt;
    case "=": return v === wenn.wert || (v != null && wenn.wert != null && String(v) === String(wenn.wert));
    case "!=": return !(v === wenn.wert || (v != null && wenn.wert != null && String(v) === String(wenn.wert)));
    case "enthaelt": return gesetzt && String(v).toLowerCase().includes(String(wenn.wert ?? "").toLowerCase());
    case ">": case ">=": case "<": case "<=": {
      const a = Number(v), b = Number(wenn.wert);
      if (!gesetzt || !Number.isFinite(a) || !Number.isFinite(b)) return false;
      return wenn.operator === ">" ? a > b : wenn.operator === ">=" ? a >= b : wenn.operator === "<" ? a < b : a <= b;
    }
    default: return false;
  }
}

/**
 * Whether a lens is a renovation lens (status is its message, the status wins against a rule): every lens except the input lens.
 * @param {{id?: string}|null|undefined} brille
 * @returns {boolean}
 */
export function istUmbauBrille(brille) {
  return !!brille && brille.id !== STANDARD_BRILLE;
}

/**
 * @typedef {{fill: string, stroke: string, dash: string|undefined, opacity: number, strokeWidth: number, sicht: string, schraffur?: boolean, leer?: boolean, regel?: number, breite_mm?: number}} Darstellung
 */

/**
 * Plan look of an element under lens and rules (107-12 Task 4): first the status look of the lens (planDarstellung), then the FIRST
 * matching rule — except in a renovation lens where the element has a status look: there the status wins (97-KONZEPT). Without rules
 * the result is exactly planDarstellung (byte-identical plans). An element without status and without matching rule → null (today's
 * look of the caller).
 * Rule effects: fuellung "dunkler" darkens the base fill (status fill or the caller's default) by DUNKLER_ANTEIL, a token name sets
 * the token colour; kontur sets the outline colour; strich the dash pattern; strichbreite_mm the outline width on paper (`breite_mm`,
 * the screen scales it ×1.2 to SVG units); deckkraft (55-01) sets opacity 0..1.
 * @param {any} brille lens object (plan/brillen.js) or null
 * @param {Record<string, any>} werte element values (darstellungsWerte)
 * @param {ReadonlyArray<Regel>|null|undefined} regeln
 * @param {{sw?: boolean, standard?: {fill: string, stroke: string, strokeWidth?: number}}} [opt] sw variant; default look of the caller
 * @returns {Darstellung|null}
 */
export function elementDarstellung(brille, werte, regeln, { sw = false, standard = { fill: "#3f3f46", stroke: "#18181b", strokeWidth: 0.6 } } = {}) {
  const basis = /** @type {Darstellung|null} */ (planDarstellung(brille, werte?.status, { sw }));
  if (!Array.isArray(regeln) || !regeln.length) return basis;
  if (basis && istUmbauBrille(brille)) return basis;
  const i = regeln.findIndex((r) => regelPasst(r?.wenn, werte));
  if (i < 0) return basis;
  const d = regeln[i].dann || {};
  /** @type {Darstellung} */
  const out = basis ? { ...basis } : { fill: standard.fill, stroke: standard.stroke, dash: undefined, opacity: 1, strokeWidth: standard.strokeWidth ?? 0.6, sicht: "normal" };
  if (d.fuellung === "dunkler") out.fill = dunkler(out.fill || standard.fill, DUNKLER_ANTEIL);
  else if (d.fuellung && REGEL_FARBEN[d.fuellung]) out.fill = REGEL_FARBEN[d.fuellung];
  if (d.kontur && REGEL_FARBEN[d.kontur]) out.stroke = REGEL_FARBEN[d.kontur];
  if (d.strich) out.dash = d.strich;
  if (Number.isFinite(d.strichbreite_mm)) { out.breite_mm = /** @type {number} */ (d.strichbreite_mm); out.strokeWidth = Math.round(/** @type {number} */ (d.strichbreite_mm) * 1.2 * 100) / 100; }
  if (Number.isFinite(d.deckkraft)) out.opacity = /** @type {number} */ (d.deckkraft);
  out.regel = i;
  return out;
}

/** Fallback mesh colour when a 3D rule darkens without a status/material colour, hex [ASSUMED: slate, readable on the studio ground]. */
export const DREID_REGEL_STANDARD_FARBE = "#94a3b8";

/**
 * 3D look of an element under lens and graphic rules (55-01) — the 3D counterpart of elementDarstellung (which extends
 * planDarstellung). Basis = dreiDDarstellung(brille, status). Without rules → basis. In a renovation lens with a DECIDED
 * status the LBauVorlV status wins (97-KONZEPT), same gate as elementDarstellung. Otherwise the FIRST matching rule paints:
 * fuellung/kontur → farbe (token or dunkler of the material fallback), deckkraft → opacity, kontur/strich kept for form
 * (EdgesGeometry in the studio; FARB-01).
 * @param {any} brille lens object (plan/brillen.js) or null
 * @param {Record<string, any>} werte element values (darstellungsWerte); status drives the lens
 * @param {ReadonlyArray<Regel>|null|undefined} regeln
 * @param {{standardFarbe?: string}} [opt] material fallback hex for "dunkler" when the basis has no farbe
 * @returns {{sichtbar: boolean, deckkraft: number, farbe: string|null, sicht: string, regel?: number, kontur?: string, strich?: string, strichbreite_mm?: number}}
 *   deckkraft: opacity 0..1; farbe: "#rrggbb" or null = leave material; kontur/strich: form hints for the mesh helper
 */
export function dreiDElementDarstellung(brille, werte, regeln, { standardFarbe = DREID_REGEL_STANDARD_FARBE } = {}) {
  const status = werte?.status;
  const basis = dreiDDarstellung(brille, status);
  if (!basis.sichtbar) return basis;
  if (!Array.isArray(regeln) || !regeln.length) return basis;
  const entschieden = status === "bestand" || status === "abbruch" || status === "neubau" || status === "temporaer";
  // renovation lens + decided status → status colour/visibility wins (mirror of elementDarstellung's `basis && istUmbauBrille`)
  if (entschieden && istUmbauBrille(brille)) return basis;
  const i = regeln.findIndex((r) => regelPasst(r?.wenn, werte));
  if (i < 0) return basis;
  const d = regeln[i].dann || {};
  /** @type {{sichtbar: boolean, deckkraft: number, farbe: string|null, sicht: string, regel?: number, kontur?: string, strich?: string, strichbreite_mm?: number}} */
  const out = { ...basis, regel: i };
  const basisFarbe = basis.farbe || standardFarbe;
  if (d.fuellung === "dunkler") out.farbe = dunkler(basisFarbe, DUNKLER_ANTEIL);
  else if (d.fuellung && REGEL_FARBEN[d.fuellung]) out.farbe = REGEL_FARBEN[d.fuellung];
  else if (d.kontur && REGEL_FARBEN[d.kontur] && !d.fuellung) out.farbe = basis.farbe; // outline-only rule: keep fill, form via kontur
  if (d.kontur && REGEL_FARBEN[d.kontur]) out.kontur = REGEL_FARBEN[d.kontur];
  if (d.strich) out.strich = d.strich;
  if (Number.isFinite(d.strichbreite_mm)) out.strichbreite_mm = /** @type {number} */ (d.strichbreite_mm);
  if (Number.isFinite(d.deckkraft)) out.deckkraft = /** @type {number} */ (d.deckkraft);
  return out;
}

// ---- export: wait for the derivation, never fall back silently ----------------------------------------------------------

/**
 * Awaits a promise for at most `ms` milliseconds.
 * @template T
 * @param {Promise<T>|T} promise
 * @param {number} ms time limit in ms
 * @returns {Promise<{wert: T|null, zeitUeber: boolean}>}  zeitUeber = the limit was reached first (wert null)
 */
export async function mitZeitgrenze(promise, ms) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let uhr;
  const grenze = new Promise((res) => { uhr = setTimeout(() => res({ wert: null, zeitUeber: true }), Math.max(0, ms)); });
  try {
    return /** @type {{wert: T|null, zeitUeber: boolean}} */ (await Promise.race([Promise.resolve(promise).then((wert) => ({ wert, zeitUeber: false })), grenze]));
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * Number of components whose outlines come from the bands instead of the solid (entries of planFlaechen / schnittFlaechen with
 * quelle "baender").
 * @param {Map<string, {quelle?: string}>|ReadonlyArray<{quelle?: string}>|null|undefined} flaechen
 * @returns {number}
 */
export function rueckfallAnzahl(flaechen) {
  if (!flaechen) return 0;
  const werte = flaechen instanceof Map ? [...flaechen.values()] : Array.isArray(flaechen) ? flaechen : [];
  return werte.filter((f) => f?.quelle === "baender").length;
}

/**
 * The derivation of an export (107-12 Task 5): waits until the solids of the components in the view are computed (at most
 * `zeitgrenze_ms`), then builds the outlines from the finished solids. After the time limit, or where a solid failed the volume
 * comparison, the outlines come from the bands — and `rueckfall` says so, so the sheet carries RUECKFALL_VERMERK. The result is
 * not stored. The same view with the same base hash gives the same outlines, however long the solids took.
 * @template S, F
 * @param {() => Promise<S|null>|S|null} solidsBereit resolves with the solids of the view (null = intersection off)
 * @param {(solids: S|null) => F} ableiten synchronous outline builder (planFlaechen / schnittFlaechen with fallback)
 * @param {{zeitgrenze_ms?: number, flaechenVon?: (f: F) => any}} [opt] time limit (ms); which part of F holds the outlines
 * @returns {Promise<{flaechen: F, solids: S|null, rueckfall: boolean, zeitUeber: boolean}>}
 */
export async function ableitungFuerAusgabe(solidsBereit, ableiten, { zeitgrenze_ms = SOLID_ZEITGRENZE_MS, flaechenVon = (f) => f } = {}) {
  const r = await mitZeitgrenze(solidsBereit(), zeitgrenze_ms);
  const solids = r.zeitUeber ? null : /** @type {S|null} */ (r.wert);
  const flaechen = ableiten(solids);
  const rueckfall = r.zeitUeber || rueckfallAnzahl(flaechenVon(flaechen)) > 0;
  return { flaechen, solids, rueckfall, zeitUeber: r.zeitUeber };
}

/** Scale stages the view offers (denominators); the studio's scale select lists them, 1:20 included since the 107-12 review. */
export const ANSICHT_MASSSTAEBE = DETAILGRAD_STUFEN;
