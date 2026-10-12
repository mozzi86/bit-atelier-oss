// raumbuch.js — room book (Raumbuch) per room type of the space programme (88-05, RE-12):
// finishes floor / skirting / wall / ceiling, clear height, remark — stored additively as
// `items[i].raumbuch` on the SpaceProgram record (no new entity, no second editor).
//
// Data contract (additive on SpaceProgram.items[i]):
//   raumbuch: {boden, sockel, wand, decke (free text, e.g. "Linoleum 2,5 mm"),
//              lichte_hoehe_m (m, number|null), bemerkung}
// Items without `raumbuch` are legacy and stay valid (empty room book row).
//
// In:  SpaceProgram items ({use, area (m² per unit), count, raumbuch?}).
// Out: normalised room book, findings on the clear height, CSV text. Pure.

/** Room book fields in display order; labels double as i18n keys. */
export const RAUMBUCH_FELDER = Object.freeze([
  Object.freeze({ key: "boden", label: "Boden" }),
  Object.freeze({ key: "sockel", label: "Sockel" }),
  Object.freeze({ key: "wand", label: "Wand" }),
  Object.freeze({ key: "decke", label: "Decke" }),
]);

/**
 * @typedef {object} Raumbuch
 * @property {string} boden
 * @property {string} sockel
 * @property {string} wand
 * @property {string} decke
 * @property {number|null} lichte_hoehe_m metres
 * @property {string} bemerkung
 */

/**
 * Normalised room book of an item (missing fields → '' / null).
 * @param {{raumbuch?: any}|null|undefined} item
 * @returns {Raumbuch}
 */
export function raumbuchVon(item) {
  const r = item?.raumbuch || {};
  const h = r.lichte_hoehe_m === "" || r.lichte_hoehe_m == null ? null : Number(String(r.lichte_hoehe_m).replace(",", "."));
  return {
    boden: String(r.boden || ""), sockel: String(r.sockel || ""), wand: String(r.wand || ""), decke: String(r.decke || ""),
    lichte_hoehe_m: Number.isFinite(h) ? /** @type {number} */ (h) : null,
    bemerkung: String(r.bemerkung || ""),
  };
}

/**
 * Minimum clear height for a use and a room size, with its source.
 * - wohnen: habitable rooms 2.40 m (MBO § 47 Abs. 1; most state codes the same).
 * - buero/gewerbe/handel/gastronomie/gemeinschaft (work rooms): ASR A1.2 Abschn. 5 —
 *   ≤ 50 m² 2.50 m, > 50 m² 2.75 m, > 100 m² 3.00 m, > 2000 m² 3.25 m.
 * - parken/technik/other: none here (garage codes differ per state) → null.
 * @param {string} use SpaceProgram use key
 * @param {number} flaecheM2 area of ONE room/unit in m²
 * @returns {{min_m: number, quelle: string}|null}
 */
export function lichteHoeheMindest(use, flaecheM2) {
  if (use === "wohnen") return { min_m: 2.4, quelle: "MBO § 47 Abs. 1" };
  if (["buero", "gewerbe", "handel", "gastronomie", "gemeinschaft"].includes(use)) {
    const a = Number(flaecheM2) || 0;
    const min_m = a > 2000 ? 3.25 : a > 100 ? 3.0 : a > 50 ? 2.75 : 2.5;
    return { min_m, quelle: "ASR A1.2 Abschn. 5" };
  }
  return null;
}

/**
 * Findings of one room book row. warn, never fail: the state building code, the
 * workplace rules' exceptions (e.g. ASR A1.2 allows less with sufficient air volume)
 * and attic rooms decide — the program only flags the gap.
 * @param {{use: string, area?: number, raumbuch?: any}} item
 * @returns {Array<{code: string, stufe: 'warn'|'hinweis', text: string, min_m?: number, quelle?: string}>}
 */
export function raumbuchHinweise(item) {
  const r = raumbuchVon(item);
  /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string, min_m?: number, quelle?: string}>} */
  const h = [];
  const min = lichteHoeheMindest(item.use, Number(item.area) || 0);
  if (min && r.lichte_hoehe_m !== null && r.lichte_hoehe_m < min.min_m) {
    h.push({ code: "lichte_hoehe", stufe: "warn", text: "Lichte Höhe unter dem Richtwert", min_m: min.min_m, quelle: min.quelle });
  }
  const leer = RAUMBUCH_FELDER.filter((f) => !r[/** @type {keyof Raumbuch} */ (f.key)]).length;
  if (leer > 0 && leer < RAUMBUCH_FELDER.length) h.push({ code: "unvollstaendig", stufe: "hinweis", text: "Raumbuch unvollständig" });
  return h;
}

/**
 * Room book as CSV (semicolon, German headers, UTF-8 with BOM added by the caller if needed).
 * @param {Array<{use: string, area?: number, count?: number, raumbuch?: any}>} items
 * @param {(use: string) => string} [nutzungLabel] label of a use key
 * @returns {string}
 */
export function raumbuchCsv(items, nutzungLabel = (u) => u) {
  const zelle = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const zeilen = [["Raumtyp", "Fläche je Einheit (m²)", "Anzahl", "Boden", "Sockel", "Wand", "Decke", "Lichte Höhe (m)", "Bemerkung"]];
  for (const it of items || []) {
    const r = raumbuchVon(it);
    zeilen.push([nutzungLabel(it.use), String(it.area ?? ""), String(it.count ?? ""), r.boden, r.sockel, r.wand, r.decke,
      r.lichte_hoehe_m === null ? "" : r.lichte_hoehe_m.toFixed(2).replace(".", ","), r.bemerkung]);
  }
  return zeilen.map((z) => z.map(zelle).join(";")).join("\n");
}
