// Brandschutz auf dem Grundriss — Logik des Plan-Editors (Phase 38, BSP-01…05).
//
// In:  brandschutz_layer = { fluchtwege: [{id, level, points}], brandabschnitte: [{id, level, name, points}],
//        symbole: [{id, level, typ, x, z}], melder: { aktiv, flaecheJeMelder } }  (metres, level 0 = EG),
//      footprint of the storey [{x,z}], concept values of the Brandschutz panel (maxFluchtweg m,
//      flaecheJeMelder m²).
// Out: symbol catalogue, hardened layer, editor helpers, fire-compartment areas, detector grid points,
//      legend rows and concept checks (pass | warn | offen — never fail: concept aid, no proof).
// Pure functions, no React. Escape-route length and detector count come from fire.js (Phase 18).

import { fluchtwegLaenge, melderAnzahl, DEFAULT_FLAECHE_JE_MELDER, DEFAULT_MAX_FLUCHTWEG } from "@designer/lib/fire";
import { punktImPolygon } from "@designer/lib/moebel";
import { polygonAreaM } from "@core/lib/useBuildingProgram";

// ---- Symbolkatalog -------------------------------------------------------------------------

/**
 * Fire-protection symbols for the plan. [ASSUMED] The exact pictograms of DIN 14034-6 / ISO 7010
 * are licensed artwork and not in the repo — these are schematic approximations in the norm's
 * colour families (red/white for fire equipment, green/white for rescue). groesseM = drawn size (m).
 */
export const SYMBOLE_DIN14034 = {
  bmz: { label: "Brandmeldezentrale", kurz: "BMZ", farbe: "#dc2626", form: "quadrat", groesseM: 0.9, norm: "DIN 14034-6 (Näherung) [ASSUMED]" },
  rauchmelder: { label: "Rauchmelder", kurz: "RM", farbe: "#dc2626", form: "kreis", groesseM: 0.6, norm: "DIN 14034-6 (Näherung) [ASSUMED]" },
  feuerloescher: { label: "Feuerlöscher", kurz: "F", farbe: "#dc2626", form: "quadrat", groesseM: 0.7, norm: "DIN 14034-6 / ISO 7010 F001 (Näherung) [ASSUMED]" },
  wandhydrant: { label: "Wandhydrant", kurz: "H", farbe: "#dc2626", form: "quadrat", groesseM: 0.7, norm: "DIN 14034-6 / ISO 7010 F002 (Näherung) [ASSUMED]" },
  steigleitung: { label: "Steigleitung trocken", kurz: "T", farbe: "#dc2626", form: "kreis", groesseM: 0.7, norm: "DIN 14034-6 (Näherung) [ASSUMED]" },
  sammelstelle: { label: "Sammelstelle", kurz: "S", farbe: "#16a34a", form: "quadrat", groesseM: 1.2, norm: "ISO 7010 E007 (Näherung) [ASSUMED]" },
  feuerwehrzugang: { label: "Feuerwehrzugang", kurz: "FW", farbe: "#dc2626", form: "pfeil", groesseM: 1.2, norm: "DIN 14034-6 (Näherung) [ASSUMED]" },
};
/** Symbol keys in catalogue order. */
export const SYMBOL_KEYS = Object.keys(SYMBOLE_DIN14034);
/** Catalogue shape for KatalogPanel ([{ gruppe, typen: [{ id, name, … }] }]). */
export const SYMBOL_KATALOG = [{
  gruppe: "Brandschutz-Symbole (DIN 14034-6, schematisch)",
  typen: SYMBOL_KEYS.map((id) => ({ id, name: SYMBOLE_DIN14034[id].label, ...SYMBOLE_DIN14034[id] })),
}];

/**
 * Largest fire compartment before a fire wall is due (m²). [ASSUMED] MBO § 30 (2): inner fire walls
 * at most 40 m apart → 40 × 40 m = 1.600 m²; Landesbauordnungen differ.
 */
export const BRANDABSCHNITT_MAX_M2 = 1600;

/** Colours of the plan layers (Fluchtweg green/red from FluchtwegPlan, compartments red hatch, detectors orange). */
export const PLAN_FARBEN = { fluchtweg: "#16a34a", fluchtwegZuLang: "#dc2626", brandabschnitt: "#dc2626", melder: "#ea580c", draft: "#d97706" };

/** Empty layer (value of BimModel.brandschutz_layer before anything is drawn). */
export const LAYER_DEFAULT = { fluchtwege: [], brandabschnitte: [], symbole: [], melder: { aktiv: false, flaecheJeMelder: null } };

const isPt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
const rnd2 = (v) => Math.round(v * 100) / 100;

// ---- Härtung und Editor-Helfer --------------------------------------------------------------

/**
 * Always returns a valid layer: escape routes with ≥ 2 points, compartments with ≥ 3 points,
 * symbols of known type with finite coordinates, detector settings normalised.
 * @param {object|null|undefined} layer raw brandschutz_layer
 */
export function layerHardened(layer) {
  const src = layer && typeof layer === "object" ? layer : {};
  const lvl = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
  const pts = (arr) => (Array.isArray(arr) ? arr.filter(isPt).map((p) => ({ x: p.x, z: p.z })) : []);
  const fluchtwege = (Array.isArray(src.fluchtwege) ? src.fluchtwege : [])
    .map((f, i) => ({ id: typeof f?.id === "string" ? f.id : `fw_${i + 1}`, level: lvl(f?.level), points: pts(f?.points) }))
    .filter((f) => f.points.length >= 2);
  const brandabschnitte = (Array.isArray(src.brandabschnitte) ? src.brandabschnitte : [])
    .map((b, i) => ({ id: typeof b?.id === "string" ? b.id : `ba_${i + 1}`, level: lvl(b?.level), name: typeof b?.name === "string" ? b.name : "", points: pts(b?.points) }))
    .filter((b) => b.points.length >= 3);
  const symbole = (Array.isArray(src.symbole) ? src.symbole : [])
    .filter((s) => s && SYMBOLE_DIN14034[s.typ] && isPt(s))
    .map((s, i) => ({ id: typeof s.id === "string" ? s.id : `sy_${i + 1}`, level: lvl(s.level), typ: s.typ, x: s.x, z: s.z }));
  const m = src.melder && typeof src.melder === "object" ? src.melder : {};
  const melder = { aktiv: !!m.aktiv, flaecheJeMelder: Number.isFinite(m.flaecheJeMelder) && m.flaecheJeMelder > 0 ? m.flaecheJeMelder : null };
  return { fluchtwege, brandabschnitte, symbole, melder };
}

const naechsteId = (prefix, liste) => {
  let max = 0;
  for (const it of liste) { const m = new RegExp(`^${prefix}_(\\d+)$`).exec(String(it.id || "")); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}_${max + 1}`;
};

/**
 * Add a fire compartment polygon (≥ 3 points).
 * @param {object} layer
 * @param {{ level?: number, points?: Array<{x:number,z:number}>, name?: string }} [attrs] metres
 * @returns {{layer: object, abschnitt: object|null}}
 */
export function neuerAbschnitt(layer, { level = 0, points = [], name = "" } = {}) {
  const base = layerHardened(layer);
  const p = points.filter(isPt).map((q) => ({ x: q.x, z: q.z }));
  if (p.length < 3) return { layer: base, abschnitt: null };
  const abschnitt = { id: naechsteId("ba", base.brandabschnitte), level: Math.round(level), name: name || `Brandabschnitt ${base.brandabschnitte.length + 1}`, points: p };
  return { layer: { ...base, brandabschnitte: [...base.brandabschnitte, abschnitt] }, abschnitt };
}

/**
 * Add a symbol of a known type.
 * @param {object} layer
 * @param {{ level?: number, typ?: string, x?: number, z?: number }} [attrs] metres
 * @returns {{layer: object, symbol: object|null}}
 */
export function neuesSymbol(layer, { level = 0, typ, x, z } = {}) {
  const base = layerHardened(layer);
  if (!SYMBOLE_DIN14034[typ] || !isPt({ x, z })) return { layer: base, symbol: null };
  const symbol = { id: naechsteId("sy", base.symbole), level: Math.round(level), typ, x, z };
  return { layer: { ...base, symbole: [...base.symbole, symbol] }, symbol };
}

/** Move a symbol to p (metres). */
export function verschiebeSymbol(layer, id, p) {
  const base = layerHardened(layer);
  if (!isPt(p)) return base;
  return { ...base, symbole: base.symbole.map((s) => (s.id === id ? { ...s, x: p.x, z: p.z } : s)) };
}

/**
 * Remove an element.
 * @param {"fluchtweg"|"brandabschnitt"|"symbol"} art
 */
export function loescheElement(layer, art, id) {
  const base = layerHardened(layer);
  if (art === "fluchtweg") return { ...base, fluchtwege: base.fluchtwege.filter((f) => f.id !== id) };
  if (art === "brandabschnitt") return { ...base, brandabschnitte: base.brandabschnitte.filter((b) => b.id !== id) };
  if (art === "symbol") return { ...base, symbole: base.symbole.filter((s) => s.id !== id) };
  return base;
}

/** Set detector-grid options ({ aktiv?, flaecheJeMelder? }). */
export function setzeMelder(layer, patch) {
  const base = layerHardened(layer);
  return layerHardened({ ...base, melder: { ...base.melder, ...(patch || {}) } });
}

// ---- Brandabschnitte -------------------------------------------------------------------------

/** Area of a compartment polygon in m² (shoelace). */
export function brandabschnittFlaeche(points) {
  return polygonAreaM(points || []);
}

// ---- Melder-Raster (BSP-04) ------------------------------------------------------------------

/**
 * Detector grid: one point per cell of pitch s = √(flaecheJeMelder) at the cell centre, kept when
 * inside the footprint polygon. The count approximates melderAnzahl(A, f) (grid rounding ±).
 * @param {Array<{x:number,z:number}>} footprint storey polygon (metres)
 * @param {number} flaecheJeMelder m² per detector (> 0)
 * @returns {Array<{x:number,z:number}>}
 */
export function melderRaster(footprint, flaecheJeMelder = DEFAULT_FLAECHE_JE_MELDER) {
  if (!Array.isArray(footprint) || footprint.length < 3 || !(flaecheJeMelder > 0)) return [];
  const s = Math.sqrt(flaecheJeMelder);
  const xs = footprint.map((p) => p.x), zs = footprint.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  // centre the grid on the bbox so both edges get equal margins
  const nx = Math.max(1, Math.round((maxX - minX) / s)), nz = Math.max(1, Math.round((maxZ - minZ) / s));
  const sx = (maxX - minX) / nx, sz = (maxZ - minZ) / nz;
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const p = { x: rnd2(minX + sx * (i + 0.5)), z: rnd2(minZ + sz * (j + 0.5)) };
      if (punktImPolygon(p.x, p.z, footprint)) out.push(p);
    }
  }
  return out;
}

// ---- Legende ---------------------------------------------------------------------------------

/**
 * Legend rows for a storey: only symbol types actually placed, with counts.
 * @returns {Array<{typ:string,label:string,farbe:string,anzahl:number}>}
 */
export function symbolLegende(layer, level) {
  const base = layerHardened(layer);
  const counts = new Map();
  base.symbole.filter((s) => s.level === level).forEach((s) => counts.set(s.typ, (counts.get(s.typ) || 0) + 1));
  return SYMBOL_KEYS.filter((k) => counts.has(k)).map((k) => ({ typ: k, label: SYMBOLE_DIN14034[k].label, farbe: SYMBOLE_DIN14034[k].farbe, anzahl: counts.get(k) }));
}

// ---- Checks (nur pass / warn / offen) ---------------------------------------------------------

/**
 * Concept checks for one storey. Never "fail": the plan is a concept aid, not a Brandschutznachweis
 * (T-18 liability rule of the Brandschutz tab).
 * @param {object} layer
 * @param {{footprint?:Array<{x:number,z:number}>, level?:number, maxFluchtweg?:number, flaecheJeMelder?:number}} [ctx]
 * @returns {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>}
 */
export function brandschutzPlanChecks(layer, ctx = {}) {
  const base = layerHardened(layer);
  const level = ctx.level ?? 0;
  const maxF = ctx.maxFluchtweg ?? DEFAULT_MAX_FLUCHTWEG;
  const footprint = Array.isArray(ctx.footprint) ? ctx.footprint : [];
  const footArea = polygonAreaM(footprint);
  /** @type {Array<{key:string,label:string,status:"pass"|"warn"|"offen",detail:string}>} */
  const items = [];
  const de = (n) => Math.round(n).toLocaleString("de-DE");

  const wege = base.fluchtwege.filter((f) => f.level === level);
  const zuLang = wege.filter((f) => fluchtwegLaenge(f.points) > maxF);
  items.push({ key: "fluchtwege", label: "Fluchtweglängen", status: wege.length === 0 ? "offen" : zuLang.length ? "warn" : "pass",
    detail: wege.length === 0 ? "Kein Fluchtweg gezeichnet." : zuLang.length ? `${zuLang.length} Weg(e) über ${de(maxF)} m.` : `${wege.length} Weg(e) ≤ ${de(maxF)} m.` });

  const abschnitte = base.brandabschnitte.filter((b) => b.level === level);
  const gross = abschnitte.filter((b) => brandabschnittFlaeche(b.points) > BRANDABSCHNITT_MAX_M2);
  items.push({ key: "abschnitt_groesse", label: "Brandabschnitte ≤ 1.600 m²", status: abschnitte.length === 0 ? "offen" : gross.length ? "warn" : "pass",
    detail: abschnitte.length === 0 ? "Kein Brandabschnitt gezeichnet." : gross.length ? `${gross.length} Abschnitt(e) über ${de(BRANDABSCHNITT_MAX_M2)} m² (MBO § 30 Richtwert).` : `${abschnitte.length} Abschnitt(e) innerhalb des Richtwerts.` });

  const brauchtTeilung = footArea > BRANDABSCHNITT_MAX_M2;
  items.push({ key: "abschnitt_noetig", label: "Geschoss in Brandabschnitte geteilt", status: footArea <= 0 ? "offen" : brauchtTeilung && abschnitte.length === 0 ? "warn" : "pass",
    detail: footArea <= 0 ? "Kein Footprint." : brauchtTeilung ? (abschnitte.length ? `Geschoss ${de(footArea)} m² mit ${abschnitte.length} Abschnitt(en).` : `Geschoss ${de(footArea)} m² > ${de(BRANDABSCHNITT_MAX_M2)} m² ohne Brandabschnitt.`) : `Geschoss ${de(footArea)} m² — ein Abschnitt genügt (Richtwert).` });

  const symbole = base.symbole.filter((s) => s.level === level);
  items.push({ key: "symbole", label: "Symbole gesetzt", status: symbole.length ? "pass" : "offen",
    detail: symbole.length ? `${symbole.length} Symbol(e) im Geschoss.` : "Noch keine Symbole (Löscher, Melder, Hydranten …)." });

  const sammel = base.symbole.some((s) => s.typ === "sammelstelle");
  items.push({ key: "sammelstelle", label: "Sammelstelle festgelegt", status: sammel ? "pass" : "offen",
    detail: sammel ? "Sammelstelle im Plan." : "Keine Sammelstelle gesetzt (Empfehlung für den Feuerwehrplan)." });

  const f = base.melder.flaecheJeMelder ?? ctx.flaecheJeMelder ?? DEFAULT_FLAECHE_JE_MELDER;
  items.push({ key: "melder", label: "Melder-Raster", status: base.melder.aktiv ? "pass" : "offen",
    detail: base.melder.aktiv ? `Raster aktiv, ${de(f)} m² je Melder → ${melderAnzahl(footArea, f)} Melder (Überschlag).` : "Melder-Raster ausgeschaltet." });

  return items;
}
