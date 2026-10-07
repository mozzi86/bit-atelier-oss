// Working scale and level of detail per station (Phase 75-05, MS-05).
//
// A scale is a DETAIL LEVEL, not a zoom: what gets drawn and labelled depends
// on it (Loesungskatalog Blatt 01). The massing studio offers 1:500 and 1:200;
// 1:1000 belongs to the site tab, 1:50 to the WohnungsFokus. Thresholds and
// scale-bar lengths are [ASSUMED] from Blatt 01.
//
// In:  site diagonal (m), zones of the building model ([{points, level, name, we, raumart}]),
//      label rectangles in screen px.
// Out: scale, LOD flags, label groups per unit, visible label indices.
// Pure module, no DOM, node-testable.

import { polygonAreaM } from "@core/lib/useBuildingProgram";

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
 * Level of detail per scale.
 * @param {number} massstab denominator (1000|500|200|50)
 * @returns {{zonen:boolean, weLabel:boolean, raumnamen:boolean, balkenM:number}}
 *   zonen = draw unit/room polygons, weLabel = one label per unit, raumnamen = room names,
 *   balkenM = scale-bar length in m
 */
export function lodFuer(massstab) {
  switch (Number(massstab)) {
    case 1000: return { zonen: false, weLabel: false, raumnamen: false, balkenM: 100 };
    case 500: return { zonen: false, weLabel: false, raumnamen: false, balkenM: 50 };
    case 50: return { zonen: true, weLabel: true, raumnamen: true, balkenM: 5 };
    case 200:
    default: return { zonen: true, weLabel: true, raumnamen: false, balkenM: 20 };
  }
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
