// DXF export of the plans (plan 104-06): site plan (Lageplan) and floor plan (Grundriss) as
// DXF R12 through the own writer @core/lib/plan/dxfR12.js. This module only translates the
// app's data into layers + elements in METRES; the file format lives in the writer.
//
// Coordinate frames:
//  - site plan: canvas units (site_parcel / designated_areas / buildings, y down, centre
//    600/400 = project location) × m_per_px → metres with the ORIGIN AT THE PROJECT LOCATION,
//    x east, y NORTH (screen y mirrored). The location goes into a machine-readable comment
//    line (BEZUG_KENNUNG) so the own parcel import (flurstueckImport.js) places a re-imported
//    boundary exactly where it was — round trip export → import gives the same boundary.
//  - floor plan: planGrafik() of vektorPlan.js (x/z in metres, z down on screen) → (x, −z).
//
// 106-11: the floor plan carries the model state (comment lines: readable text + the machine line of planStand.js) and, while
// AI changes are unreleased or the state is unknown, the visible note "Enthält ungeprüfte KI-Änderungen" as TEXT on layer
// A_KI_VERMERK above the drawing; the marks of planGrafik (ebene "ki_vermerk") land on the same layer, dashed.
//
// 107-12: opening symbols of a saved view (planGrafik `ebene: "oeffnung"`) land on the additive layer A_OEFFNUNG — outlines only, the
// white cut of the PDF never becomes a poché SOLID; a fallback of the walls to the bands is written as visible text on A_PLANKOPF
// ("Wände aus Bändern abgeleitet, Solid nicht verfügbar") plus a comment line. Without them the output is unchanged.
// In:  complexData (site plan) or planGrafik() output (floor plan), scale, project name, model state.
// Out: {ebenen, elemente, linientypen, kommentar} for dxfR12(); dxfDatei() → text + bytes.
// Pure module: no DOM, no React, node-testable.
import { dxfR12, dxfBytes, linientypenFuer, stiftFarbe } from "@core/lib/plan/dxfR12.js";
import { alsBlock, ecken } from "@core/lib/massing/bloecke";
import { riegelLayout } from "@core/lib/massing/riegel";
import { metersPerPixel, polygonAreaM2, centroid } from "@core/lib/geo";
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from "@designer/lib/maplibreStyles";
import { modellstandMetadaten, modellstandText, vermerkZeilen } from "@core/lib/zeigen/planStand.js";

/**
 * Marker of the georeference comment line: "BIT-ATELIER-BEZUG <lat> <lng>" (degrees, WGS84 /
 * ETRS89) = the geographic position of the DXF origin 0/0. Read by flurstueckImport.js.
 * @type {string}
 */
export const BEZUG_KENNUNG = "BIT-ATELIER-BEZUG";

/** MIME type of the download (no registered type exists; application/dxf is the common one). */
export const DXF_MIME = "application/dxf";

/** Text height on paper, mm (DIN 6776-1 series 2.5 mm) [ASSUMED usual label size]. */
const TEXT_MM = 2.5;

/**
 * @typedef {import("@core/lib/plan/dxfR12.js").DxfEbene} DxfEbene
 * @typedef {import("@core/lib/plan/dxfR12.js").DxfElement} DxfElement
 * @typedef {import("@core/lib/plan/dxfR12.js").DxfLinientyp} DxfLinientyp
 * @typedef {{ebenen: DxfEbene[], elemente: DxfElement[], linientypen: DxfLinientyp[], kommentar: string[]}} DxfDaten
 */

/**
 * Layers of the site plan with line widths in mm on paper (pen colour via stiftFarbe).
 * [ASSUMED] widths after common Lageplan practice (boundary and buildings 0.5, envelope 0.35,
 * apartment outlines 0.25, corridors / parcels 0.18), not a normative table.
 * @type {Readonly<Record<string, {breite_mm: number, linientyp?: string}>>}
 */
export const LAGEPLAN_EBENEN = Object.freeze({
  GRUNDSTUECK: { breite_mm: 0.5 },
  FLURSTUECKE: { breite_mm: 0.18, linientyp: "STRICH" },
  BAUFELD: { breite_mm: 0.35, linientyp: "STRICHPUNKT" },
  BAUKOERPER: { breite_mm: 0.5 },
  RIEGEL_FLUR: { breite_mm: 0.18 },
  RIEGEL_WE: { breite_mm: 0.25 },
  BESCHRIFTUNG: { breite_mm: 0.25 },
});

/** Layer of each planGrafik `ebene` value of the floor plan. Unknown / missing → A_PLAN. */
const GRUNDRISS_EBENE = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
  wand: "A_WAND", stuetze: "A_STUETZE", decke: "A_DECKE", dach: "A_DACH", schraffur: "A_SCHRAFFUR", raum_text: "A_RAUM_TEXT",
  ki_vermerk: "A_KI_VERMERK", oeffnung: "A_OEFFNUNG",
  treppe: "A_TREPPE", gaube: "A_GAUBE", // 108-06 / 108-13: stair symbol, dormer outline (additive layers)
}));
/** Line types of the floor plan layers (the screen shows slabs dashed, roofs dash-dot; 106-11: AI marks dashed). */
const GRUNDRISS_LINIENTYP = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({ A_DECKE: "STRICH", A_DACH: "STRICHPUNKT", A_KI_VERMERK: "STRICH", A_GAUBE: "STRICH" }));
/** 106-11: layer of the visible model state line under the drawing. */
const PLANKOPF_EBENE = "A_PLANKOPF";

/**
 * ASCII form of a German text for DXF comment lines (the existing comments are ASCII; some readers show 999 groups raw).
 * @param {string} s @returns {string}
 */
function ascii(s) {
  const tab = /** @type {Record<string, string>} */ ({ "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss", "„": "\"", "“": "\"", "—": "-", "–": "-", "·": "-", "…": "..." });
  return String(s ?? "").replace(/[äöüÄÖÜß„“—–·…]/g, (c) => tab[c]).replace(/[^\x20-\x7e]/g, "?");
}
/** Layer of the poché (filled cut walls and columns, SOLID entities). Pen colour 8 = grey [ASSUMED]. */
const POCHE_EBENE = "A_WAND_POCHE";

const fz = (/** @type {number} */ v, /** @type {number} */ n = 7) => Number(v).toFixed(n);

/**
 * Site plan → DXF data. The estimated plot (assumed: true, the generic start square) is NOT
 * drawn — it is no boundary (user decision 19.10.2026); every other site object is.
 * @param {any} complexData BuildingComplex record (site_parcel, designated_areas, buildings, riegel, grundstueck.flurstuecke, location)
 * @param {{massstab?: number, projekt?: string, t?: (s: string) => string}} [opt]
 *   massstab = intended print scale denominator (text heights, dash lengths; default 1:500);
 *   projekt = name for the comment; t = translator for the labels in the drawing
 * @returns {DxfDaten & {leer: boolean}} leer = nothing to draw (no plot, no areas, no buildings)
 */
export function lageplanDxfDaten(complexData, { massstab = 500, projekt = "", t = (s) => s } = {}) {
  const cd = complexData || {};
  const parcel = cd.site_parcel;
  const mpp = metersPerPixel(parcel);
  const textH = (TEXT_MM * massstab) / 1000; // m in the model
  // canvas units → metres around the project location, y north
  const vonPx = (/** @type {{x: number, y: number}} */ p, m = mpp) => ({ x: (Number(p.x) - CANVAS_CENTER_X) * m, y: -(Number(p.y) - CANVAS_CENTER_Y) * m });
  // site metres (canvas units × mpp, origin top-left) → metres around the project location
  const vonM = (/** @type {{x: number, y: number}} */ p) => ({ x: p.x - CANVAS_CENTER_X * mpp, y: -(p.y - CANVAS_CENTER_Y * mpp) });
  /** @type {DxfElement[]} */
  const el = [];
  const istPoly = (/** @type {any} */ pts) => Array.isArray(pts) && pts.length >= 3;

  if (parcel && parcel.assumed !== true && istPoly(parcel.points)) {
    el.push({ art: "polylinie", ebene: "GRUNDSTUECK", punkte: parcel.points.map((p) => vonPx(p)), geschlossen: true });
    const m = vonPx(centroid(parcel.points));
    el.push({ art: "text", ebene: "BESCHRIFTUNG", x: m.x, y: m.y - 2 * textH, hoehe: textH,
      text: `${t("Grundstück")} ${polygonAreaM2(parcel.points, parcel).toLocaleString("de-DE")} m²` });
  }
  for (const f of Array.isArray(cd.grundstueck?.flurstuecke) ? cd.grundstueck.flurstuecke : []) {
    if (!istPoly(f?.polygon)) continue;
    const fm = Number(f.m_per_px) > 0 ? Number(f.m_per_px) : mpp;
    el.push({ art: "polylinie", ebene: "FLURSTUECKE", punkte: f.polygon.map((/** @type {any} */ p) => vonPx(p, fm)), geschlossen: true });
    const m = vonPx(centroid(f.polygon), fm);
    if (f.nummer) el.push({ art: "text", ebene: "FLURSTUECKE", x: m.x, y: m.y, hoehe: textH, text: String(f.nummer) });
  }
  for (const a of Array.isArray(cd.designated_areas) ? cd.designated_areas : []) {
    if (!istPoly(a?.points)) continue;
    el.push({ art: "polylinie", ebene: a.type === "baufeld" ? "BAUFELD" : "BAUKOERPER", punkte: a.points.map((/** @type {any} */ p) => vonPx(p)), geschlossen: true });
  }
  (Array.isArray(cd.buildings) ? cd.buildings : []).forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    if (!b || !(Number(b.width) > 0) || !(Number(b.height) > 0)) return;
    const k = alsBlock(b, mpp);
    el.push({ art: "polylinie", ebene: "BAUKOERPER", punkte: ecken(k).map(vonM), geschlossen: true });
    const m = vonM({ x: k.cx, y: k.cy });
    el.push({ art: "text", ebene: "BESCHRIFTUNG", x: m.x, y: m.y, hoehe: textH, drehung_grad: k.drehung ? -k.drehung : 0,
      text: `${t("Baukörper")} ${i + 1} · ${k.geschosse} G` });
  });
  for (const r of Array.isArray(cd.riegel) ? cd.riegel : []) {
    if (!Array.isArray(r?.punkte) || r.punkte.length < 2) continue;
    let l;
    try {
      l = riegelLayout(r.punkte.map((/** @type {any} */ q) => ({ x: q.x * mpp, y: q.y * mpp })), { ...r.opt, geschlossen: !!r.geschlossen });
    } catch { continue; } // a broken path is not drawn on screen either (SiteDesigner riegelLayouts)
    for (const f of l.flur) el.push({ art: "polylinie", ebene: "RIEGEL_FLUR", punkte: f.map(vonM), geschlossen: true });
    for (const e of l.einheiten) el.push({ art: "polylinie", ebene: "RIEGEL_WE", punkte: e.profil.map(vonM), geschlossen: true });
  }

  const loc = cd.location;
  const hatOrt = Number.isFinite(Number(loc?.lat)) && Number.isFinite(Number(loc?.lng)) && loc?.lat != null && loc?.lng != null;
  const kommentar = [
    `BIT-Atelier Lageplan${projekt ? ` - ${projekt}` : ""}`,
    `Einheit Meter ($INSUNITS 6), x = Osten, y = Norden; Vorgabe-Massstab 1:${massstab} (Texthoehen, Linientypen)`,
    hatOrt
      ? `Ursprung 0/0 = Projektstandort lat ${fz(loc.lat, 6)} lng ${fz(loc.lng, 6)} (WGS84/ETRS89), Nord = geografisch Nord`
      : "Ursprung 0/0 = Planmitte (kein Projektstandort gesetzt)",
  ];
  if (hatOrt) kommentar.push(`${BEZUG_KENNUNG} ${fz(loc.lat)} ${fz(loc.lng)}`);

  const ebenen = Object.entries(LAGEPLAN_EBENEN).map(([name, e]) => ({ name, farbe: stiftFarbe(e.breite_mm), linientyp: e.linientyp }));
  return { ebenen, elemente: el, linientypen: linientypenFuer(massstab), kommentar, leer: el.length === 0 };
}

/**
 * Floor plan → DXF data from the primitives of planGrafik() (vektorPlan.js): outlines as closed
 * polylines on their layer, fills (poché) as SOLID on A_WAND_POCHE, hatch strokes as lines, room
 * labels as centred text. Line widths become pen colours per layer (widest element wins).
 * Fills with more than four corners are not filled (R12 SOLID has at most four) — walls and
 * columns always have four.
 * 106-11: `modellstand` (planStand.js ModellStand; null = could not be determined) adds the state to the comment lines, a visible
 * state line under the drawing (layer A_PLANKOPF) and - when AI changes are unreleased or the state is unknown - the note above
 * the drawing (layer A_KI_VERMERK). Left out entirely (undefined) the function stays the pure translation of 104-06 (the comment
 * then says "nicht ermittelt"); the BIM studio always passes it.
 * @param {{elemente: any[], bbox: any, markiert?: string[]}} grafik output of planGrafik(), metres (x, z down)
 * @param {{massstab?: number, geschoss?: string, projekt?: string, modellstand?: import("@core/lib/zeigen/planStand.js").ModellStand|null, ableitungsVermerk?: string|null}} [opt]
 *   scale denominator (default 1:100), storey name, project name, model state; ableitungsVermerk (107-12): note of a fallback to the
 *   bands, written under the drawing (A_PLANKOPF) and as a comment line, null = none
 * @returns {DxfDaten & {leer: boolean, vermerk: boolean}}  vermerk: the drawing carries the visible note.
 */
export function grundrissDxfDaten(grafik, { massstab = 100, geschoss = "", projekt = "", modellstand, ableitungsVermerk = null } = {}) {
  const p = (/** @type {{x: number, z: number}} */ q) => ({ x: Number(q.x), y: -Number(q.z) });
  /** @type {DxfElement[]} */
  const el = [];
  /** @type {Map<string, number>} */
  const breite = new Map();
  const merke = (/** @type {string} */ eb, /** @type {number} */ b) => breite.set(eb, Math.max(breite.get(eb) || 0, Number(b) || 0));
  let poche = false;
  for (const e of Array.isArray(grafik?.elemente) ? grafik.elemente : []) {
    const eb = GRUNDRISS_EBENE[e?.ebene] || "A_PLAN";
    if (e?.art === "poly" && Array.isArray(e.pts) && e.pts.length >= 2) {
      merke(eb, e.breite_mm);
      const pts = e.pts.map(p);
      // A dashed element on a continuous layer (status "Abbruch" etc.) keeps its dashes.
      const linientyp = e.dash && !GRUNDRISS_LINIENTYP[eb] ? "STRICH" : undefined;
      if (e.offen && pts.length === 2) el.push({ art: "linie", ebene: eb, a: pts[0], b: pts[1], linientyp });
      else el.push({ art: "polylinie", ebene: eb, punkte: pts, geschlossen: !e.offen, linientyp });
      // 107-12: an opening's white fill only cuts the poché in the PDF — in the DXF the opening is its outline on A_OEFFNUNG
      if (e.fill && e.ebene !== "oeffnung" && !e.offen && pts.length >= 3 && pts.length <= 4) { el.push({ art: "flaeche", ebene: POCHE_EBENE, punkte: pts }); poche = true; }
    } else if (e?.art === "text" && e.text) {
      merke(eb, 0.25);
      el.push({ art: "text", ebene: eb, x: Number(e.x), y: -Number(e.z), hoehe: ((Number(e.groesse_mm) || TEXT_MM) * massstab) / 1000, text: String(e.text),
        ...(e.ausrichtung === "links" ? { ausrichtung: /** @type {"links"} */ ("links") } : {}) });
    }
  }
  // 106-11: visible model state and note (only when the caller handed a state, see above)
  let vermerk = false;
  const b = grafik?.bbox;
  if (modellstand !== undefined && b && el.length) {
    const k = massstab / 1000; // metres per mm on paper
    const h = TEXT_MM * k;
    el.push({ art: "text", ebene: PLANKOPF_EBENE, x: Number(b.x0), y: -Number(b.z1) - 8 * k, hoehe: h, ausrichtung: "links", text: `Modellstand: ${modellstandText(modellstand)}` });
    merke(PLANKOPF_EBENE, 0.25);
    const v = vermerkZeilen(modellstand, undefined, { markiert: grafik.markiert ? grafik.markiert.length : undefined });
    if (v) {
      vermerk = true;
      // above the drawing, title first (3.5 mm), then the lines (2.5 mm), 1.6 × text height apart
      const zeilen = [`${v.zeichen}  ${v.titel}`, ...v.zeilen];
      zeilen.forEach((t, i) => el.push({ art: "text", ebene: GRUNDRISS_EBENE.ki_vermerk, x: Number(b.x0), y: -Number(b.z0) + (6 + (zeilen.length - 1 - i) * 1.6 * TEXT_MM) * k,
        hoehe: i === 0 ? 3.5 * k : h, ausrichtung: "links", text: t }));
      merke(GRUNDRISS_EBENE.ki_vermerk, 0.5);
    }
  }
  // 107-12: fallback note (never silent) under the drawing, below the model state line
  if (ableitungsVermerk && b && el.length) {
    const k = massstab / 1000;
    el.push({ art: "text", ebene: PLANKOPF_EBENE, x: Number(b.x0), y: -Number(b.z1) - 12 * k, hoehe: TEXT_MM * k, ausrichtung: "links", text: `! ${ableitungsVermerk}` });
    merke(PLANKOPF_EBENE, 0.25);
  }
  /** @type {DxfEbene[]} */
  const ebenen = [...breite.entries()].map(([name, b]) => ({ name, farbe: stiftFarbe(b), linientyp: GRUNDRISS_LINIENTYP[name] }));
  if (poche) ebenen.push({ name: POCHE_EBENE, farbe: 8 });
  const kommentar = [
    `BIT-Atelier Grundriss${geschoss ? ` ${geschoss}` : ""}${projekt ? ` - ${projekt}` : ""}`,
    `Einheit Meter ($INSUNITS 6), Ursprung = Modellursprung, y = -z des Modells; Vorgabe-Massstab 1:${massstab}`,
    "Linienstaerken als Stiftfarben (ACI) je Ebene, Poche als SOLID auf A_WAND_POCHE",
    ascii(`Modellstand: ${modellstandText(modellstand ?? null)}`),
    modellstandMetadaten(modellstand ?? null),
  ];
  if (vermerk) kommentar.push(ascii(`ACHTUNG: ${vermerkZeilen(modellstand)?.titel ?? ""} - Vermerk und Markierung auf Ebene A_KI_VERMERK`));
  if (ableitungsVermerk) kommentar.push(ascii(`ACHTUNG: ${ableitungsVermerk}`));
  return { ebenen, elemente: el, linientypen: linientypenFuer(massstab), kommentar, leer: el.length === 0, vermerk };
}

/**
 * DXF file from the data of lageplanDxfDaten / grundrissDxfDaten.
 * @param {DxfDaten} daten
 * @returns {{text: string, bytes: Uint8Array, uebersprungen: number}} CRLF text, Windows-1252 bytes, skipped elements
 */
export function dxfDatei(daten) {
  const { text, uebersprungen } = dxfR12(daten);
  return { text, bytes: dxfBytes(text), uebersprungen };
}

/**
 * File name "<Projekt>_<Teil>.dxf" with every character outside [A-Za-z0-9_-] replaced (the
 * same rule as the PDF plan file name in BitBimStudio).
 * @param {string} projekt project name ("" → "Projekt")
 * @param {string} teil e.g. "Lageplan" or "Grundriss_EG"
 * @returns {string}
 */
export function dxfDateiname(projekt, teil) {
  const sauber = (/** @type {string} */ s) => String(s || "").trim().replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${sauber(projekt) || "Projekt"}_${sauber(teil) || "Plan"}.dxf`;
}
