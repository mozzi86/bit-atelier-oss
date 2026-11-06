// Working scale and level of detail per station (Phase 75-05, MS-05); moved from @designer/lib/massstab.js to @core in 107-12
// (package boundary: the view state of @core/lib/plan/ansichtszustand.js needs the level of detail). The designer file stays as a
// re-export.
//
// A scale is a DETAIL LEVEL, not a zoom: what gets drawn and labelled depends
// on it (Loesungskatalog Blatt 01). The massing studio offers 1:500 and 1:200;
// 1:1000 belongs to the site tab, 1:50 to the WohnungsFokus. Thresholds and
// scale-bar lengths are [ASSUMED] from Blatt 01.
// 107-12 (BK-57): ONE level-of-detail function detailgradFuer(massstab, brille) replaces the two definitions that existed side by
// side (lodFuer here and the lens depth `brille.tiefe` read directly in BimPlan2D); lodFuer stays as a thin view of it with the
// same values. New stage 1:20 ("1:20 Detail", 97-KONZEPT.md). The lens wins as an override of the layer depth.
//
// In:  site diagonal (m), zones of the building model ([{points, level, name, we, raumart}]),
//      label rectangles in screen px, scale denominator and lens.
// Out: scale, LOD flags, level of detail, label groups per unit, visible label indices.
// Pure module, no DOM, node-testable.

import { polygonAreaM } from "@core/lib/useBuildingProgram.js";

/** All working scales (denominators). */
export const MASSSTAEBE = [1000, 500, 200, 50];
/** Scales the massing studio renders itself. */
export const MASSING_MASSSTAEBE = [500, 200];
/** Suffix of quick-mode unit zones (Phase 21 ApartmentPlanner). */
const GEN_MARKER = " ·W";
/** Suffix of workshop zones (Phase 61 tesselierung). */
const WT_MARKER = " ·WT";

/**
 * Automatic scale from the site diagonal [ASSUMED] Blatt 01.
 * > 400 m -> 1:1000, 150-400 m -> 1:500, < 150 m -> 1:200.
 * Hand check: 55 x 60 m site -> 81 m -> 200.
 * @param {number} diagonaleM site diagonal in m
 * @returns {1000|500|200}
 */
export function autoMassstab(diagonaleM) {
  if (!Number.isFinite(diagonaleM)) return 200;
  if (diagonaleM > 400) return 1000;
  if (diagonaleM >= 150) return 500;
  return 200;
}

/**
 * @typedef {object} Detailgrad
 * @property {1000|500|200|100|50|20} stufe  scale stage the flags belong to (denominator)
 * @property {boolean} zonen       draw unit/room polygons
 * @property {boolean} weLabel     one label per unit
 * @property {boolean} raumnamen   room names
 * @property {number} balkenM      scale-bar length in m
 * @property {boolean} schichten   wall layers stay visible under a status colour (layer depth)
 * @property {boolean} schraffur   material hatch of the layers (DIN ISO 128-50)
 * @property {boolean} tuerBlatt   door leaf line
 * @property {boolean} tuerBogen   door swing arc
 * @property {boolean} zarge       door frame / rebate drawn (1:20 detail)
 * @property {{schnitt: number, ansicht: number, duenn: number}} linienGruppe  line widths in mm on paper (ISO 128-23 line group)
 * @property {"massstab"|"brille"} quelle  "brille" = the lens set the layer depth (override)
 */

/** Scale stages of the level of detail (denominators), coarse → fine. 1:20 is new in 107-12. */
export const DETAILGRAD_STUFEN = Object.freeze([1000, 500, 200, 100, 50, 20]);

/**
 * Stage of a scale: the next coarser listed stage for a value between two stages (1:75 → 1:100, 1:30 → 1:50); invalid → 1:100.
 * @param {number} massstab denominator
 * @returns {1000|500|200|100|50|20}
 */
function stufeVon(massstab) {
  const m = Number(massstab);
  if (!Number.isFinite(m) || m <= 0) return 100;
  for (const s of /** @type {Array<20|50|100|200|500|1000>} */ ([20, 50, 100, 200, 500])) if (m <= s) return s;
  return 1000;
}

/**
 * Line group of a scale stage after DIN 1356-1 / ISO 128-23: 0.5 up to 1:100, 0.7 at 1:50, 1.0 at 1:20 [ASSUMED: the usual table
 * of the line groups; check against DIN 1356-1 Tab. 2 before shipping a 1:20 sheet]. Cut edges = group width, visible edges = half,
 * thin lines = quarter (mm on paper).
 * @param {number} stufe denominator
 * @returns {{schnitt: number, ansicht: number, duenn: number}}
 */
function linienGruppeFuer(stufe) {
  const g = stufe <= 20 ? 1.0 : stufe <= 50 ? 0.7 : 0.5;
  return { schnitt: g, ansicht: g / 2, duenn: g / 4 };
}

/**
 * The ONE level of detail of plan, PDF and DXF (107-12 Task 2): what a scale draws, with the lens as override of the layer depth.
 * Values per stage [ASSUMED from Blatt 01 and 97-KONZEPT.md §1]: 1:1000/1:500 masses only; 1:200 zones and unit labels, doors as
 * openings only; 1:100 room names, door leaf and swing; 1:50 layers with material hatch; 1:20 additionally the door frame.
 * The scale bar lengths of 1:1000/500/200/50 are the 75-05 values; 1:100 = 10 m and 1:20 = 2 m [ASSUMED].
 * Lens override: a lens with `tiefe: "schichten"` shows layers and hatch, any other depth hides both — so a 1:100 sheet under the
 * 1:50 lens draws layers, and the screen keeps its pre-107-12 look (which only read `brille.tiefe`).
 * @param {number} massstab scale denominator (100 = 1:100)
 * @param {{tiefe?: string}|null} [brille] lens of the view (plan/brillen.js), null = scale alone
 * @returns {Detailgrad}
 */
export function detailgradFuer(massstab, brille = null) {
  const stufe = stufeVon(massstab);
  const grob = stufe >= 500, fein = stufe <= 50;
  const balken = /** @type {Record<number, number>} */ ({ 1000: 100, 500: 50, 200: 20, 100: 10, 50: 5, 20: 2 });
  /** @type {Detailgrad} */
  const d = {
    stufe,
    zonen: !grob,
    weLabel: !grob,
    raumnamen: stufe <= 100,
    balkenM: balken[stufe],
    schichten: fein,
    schraffur: fein,
    tuerBlatt: stufe <= 100,
    tuerBogen: stufe <= 100,
    zarge: stufe <= 20,
    linienGruppe: linienGruppeFuer(stufe),
    quelle: "massstab",
  };
  if (brille && typeof brille.tiefe === "string") {
    const schichten = brille.tiefe === "schichten";
    d.schichten = schichten;
    d.schraffur = schichten;
    d.quelle = "brille";
  }
  return d;
}

/**
 * Level of detail per scale (75-05) — since 107-12 a view of detailgradFuer with the unchanged values: unknown scales behave like
 * 1:200 as before (1:100 is not a massing scale and kept the 1:200 flags).
 * @param {number} massstab denominator (1000|500|200|50)
 * @returns {{zonen:boolean, weLabel:boolean, raumnamen:boolean, balkenM:number}}
 *   zonen = draw unit/room polygons, weLabel = one label per unit, raumnamen = room names,
 *   balkenM = scale-bar length in m
 */
export function lodFuer(massstab) {
  const m = Number(massstab);
  const d = detailgradFuer(m === 1000 || m === 500 || m === 50 ? m : 200);
  return { zonen: d.zonen, weLabel: d.weLabel, raumnamen: d.raumnamen, balkenM: d.balkenM };
}

/**
 * Roman numeral for storey counts (1..39).
 * @param {number} n
 * @returns {string}
 */
export function roemisch(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v === 0) return "0";
  /** @type {Array<[number, string]>} */
  const t = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let rest = v, out = "";
  for (const [w, s] of t) while (rest >= w) { out += s; rest -= w; }
  return out;
}

/**
 * Groups zones per unit. Workshop zones (·WT) group by `zone.we`; quick-mode
 * zones (·W) are one zone = one unit, keyed by their name without the marker;
 * corridor/core zones (raumart "flur") and plain rooms go under key null.
 * @param {Array<{points?: {x:number,z:number}[], name?: string, we?: string, raumart?: string}>} zones
 * @returns {Map<string|null, {zonen: object[], flaecheM2: number, mitte: {x:number,z:number}, typ: "wt"|"w"|null, we: string|null}>}
 */
export function weGruppen(zones) {
  const map = new Map();
  for (const z of Array.isArray(zones) ? zones : []) {
    const pts = Array.isArray(z?.points) ? z.points : [];
    if (pts.length < 3) continue;
    let key = null, typ = null;
    // 75-13: stair enclosure / lift shaft are circulation like the corridor; a
    // balcony belongs to a unit but is outside the envelope → not in its label area.
    if (z.raumart === "balkon") continue;
    if (z.raumart === "flur" || z.raumart === "treppenraum" || z.raumart === "aufzug") key = null;
    else if (z.we) { key = String(z.we); typ = "wt"; }
    else if (typeof z.name === "string" && z.name.endsWith(GEN_MARKER)) { key = z.name.slice(0, -GEN_MARKER.length); typ = "w"; }
    else if (typeof z.name === "string" && z.name.endsWith(WT_MARKER)) key = null; // core/corridor without we
    const g = map.get(key) || { zonen: [], flaecheM2: 0, sx: 0, sz: 0, typ, we: key };
    const a = polygonAreaM(pts);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    g.zonen.push(z);
    g.flaecheM2 += a;
    g.sx += cx * a;
    g.sz += cz * a;
    map.set(key, g);
  }
  for (const g of map.values()) {
    g.mitte = g.flaecheM2 > 0 ? { x: g.sx / g.flaecheM2, z: g.sz / g.flaecheM2 } : { x: 0, z: 0 };
    delete g.sx; delete g.sz;
  }
  return map;
}

/**
 * Greedy label collision: a rectangle is visible when it overlaps none of the
 * already visible ones (input order = priority). Rectangles in screen px.
 * @param {Array<{x0:number,y0:number,x1:number,y1:number}>} rects
 * @returns {number[]} indices of visible rectangles
 */
export function labelKollision(rects) {
  const sichtbar = [];
  const trifft = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (!r) continue;
    if (!sichtbar.some((j) => trifft(r, rects[j]))) sichtbar.push(i);
  }
  return sichtbar;
}

/**
 * Label text for a unit group (de-DE, no decimals).
 * @param {{zonen: object[], flaecheM2: number, typ: "wt"|"w"|null, we: string|null}} gruppe
 * @param {(s: string) => string} t i18n
 * @returns {string} e.g. "WE 3 · 4 Räume · 78 m²" or "3-Zi 0-1 · 62 m²"
 */
/**
 * "WE <key>" unless the key already starts with "WE" (tesselierung names units "WE 0-1").
 * @param {string|null} we unit key
 * @param {(s: string) => string} t i18n
 * @returns {string}
 */
export function weName(we, t) {
  const k = String(we ?? "");
  return k === "WE" || k.startsWith("WE ") ? k : `${t("WE")} ${k}`;
}

/**
 * Label text for a unit group (de-DE, no decimals).
 * @param {{zonen: object[], flaecheM2: number, typ: "wt"|"w"|null, we: string|null}} gruppe
 * @param {(s: string) => string} t i18n
 * @returns {string}
 */
export function weLabelText(gruppe, t) {
  const m2 = Math.round(gruppe.flaecheM2).toLocaleString("de-DE");
  if (gruppe.typ === "wt") return `${weName(gruppe.we, t)} · ${gruppe.zonen.length} ${t("Räume")} · ${m2} m²`;
  return `${gruppe.we ?? ""} · ${m2} m²`;
}

/**
 * Short room name for plan labels (75-11 Task 4, MSB-12): drops the ·WT /
 * ·W workshop/quick-mode marker and the "(WE 0-1)" suffix — markers and unit
 * keys do not belong in the plan label (user finding 21.09.). Empty remainder
 * → the ORIGINAL name (a label is never empty).
 * @param {string} name zone/room name (e.g. "Wohnen/Essen (WE 0-3) ·WT")
 * @returns {string} short name (e.g. "Wohnen/Essen"), never empty
 */
export function kurzRaumname(name) {
  const n = String(name ?? "");
  let out = n.replace(/ ·W$/, "").replace(/ ·WT$/, ""); // markers (apartments.js / tesselierung.js)
  out = out.replace(/\s*\(WE [^)]*\)\s*$/i, "");        // unit suffix "(WE 0-1)"
  out = out.trim();
  return out || n; // never an empty label
}

/**
 * Two short label lines for the plan at 1:200: identity on top, area below.
 * (The long form weLabelText goes into the tooltip / palette.)
 * @param {{zonen: object[], flaecheM2: number, typ: "wt"|"w"|null, we: string|null}} gruppe
 * @param {(s: string) => string} t i18n
 * @returns {[string, string]} e.g. ["WE 3", "78 m²"]
 */
export function weLabelZeilen(gruppe, t) {
  const m2 = `${Math.round(gruppe.flaecheM2).toLocaleString("de-DE")} m²`;
  return [gruppe.typ === "wt" ? weName(gruppe.we, t) : String(gruppe.we ?? ""), m2];
}
