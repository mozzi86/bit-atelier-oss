// befundAbschnitt.js — finding ↔ construction section (66-15, register no. 135).
//
// Why: a finding had no urgency. A finding is exactly as urgent as the next section it
// blocks — the model of a section has to be clean by that section's delivery date. The
// model delivery plan (lieferung_layer, 71-03 lieferplan.js) already carries a date and a
// section name per delivery; this module builds the bridge finding → section.
//
// In:  the delivery plan as returned by lieferplan.sollIst (each delivery with `status`,
//      `termin` ISO day, `bauabschnitt`, `nr`, optional `geschosse` storey names), the
//      storey names of the model, the findings of a run and a storey lookup per finding.
// Out: abschnittsTermine() — the open sections in date order (max. 15);
//      abschnittVonBefund() — the section a storey belongs to;
//      ordneNachAbschnitt() — groups "what blocks the next section first";
//      befundeJeAbschnitt() — the per-section counts for the report cover page.
//
// Rules (plan 66-15):
//   * a section = an OPEN delivery (status "geplant") WITH a date; delivered ones block
//     nothing any more. Name = bauabschnitt, else "Lieferung <nr>".
//   * storeys of a section: the delivery's `geschosse` list; empty → a storey of the same
//     name as the section (case-insensitive) when the model has one; else the whole
//     building (null). [ASSUMED] most Rohbau sections are cut by storey; a section cut
//     by axis has to list its storeys by hand or counts as whole building.
//   * a finding belongs to the EARLIEST open section that covers its storey; a finding
//     without a storey only to whole-building sections.
//   * within a group: severity rank (befundkarte BEFUND_STIL, 1 = high), then report number.
//   * no dated section at all → ONE group sorted by severity (the roadmap's fallback).
//
// Pure, no DOM, no network. The BCF fields DueDate/Stage (66-09) are not written here;
// the section of a finding (name + date) is what they would carry.

import { stilVon } from "./befundkarte.js";
import { tageZwischen, isoTag } from "./lieferplan.js";

/** At most this many section dates are used (the roadmap's 5–15 sections). */
export const MAX_ABSCHNITTE = 15;

/** Label of the group of findings that block no dated section. */
export const OHNE_ABSCHNITT = "ohne Abschnittstermin";

/** Severity words by rank — same reading as befundListe.js (66-14). */
export const SCHWERE_WORT = Object.freeze({ 1: "hoch", 2: "mittel", 3: "niedrig" });

/**
 * @typedef {object} Abschnitt
 * @property {string} id      delivery id
 * @property {number} nr      delivery number
 * @property {string} name    section name (bauabschnitt, else "Lieferung <nr>")
 * @property {string} termin  delivery date, ISO day
 * @property {number} tage    days from `heute` to `termin` (negative = overdue)
 * @property {string[]|null} geschosse storeys covered; null = whole building
 * @property {number} log     LoG of the delivery
 */

/** Normalised storey key for comparisons. */
const schluessel = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Open, dated sections of a delivery plan in date order.
 * @param {Array<{id?: string, nr?: number, status?: string, termin?: string|null, bauabschnitt?: string,
 *   geschosse?: string[], log?: number}>|null|undefined} plan deliveries (lieferplan.sollIst output or raw)
 * @param {{heute?: string|Date, modellGeschosse?: string[]}} [opt]
 *   heute — reference day for `tage` (default today); modellGeschosse — storey names of the model.
 * @returns {Abschnitt[]} at most MAX_ABSCHNITTE entries
 */
export function abschnittsTermine(plan, { heute = new Date(), modellGeschosse = [] } = {}) {
  const h = isoTag(heute) || isoTag(new Date());
  const geschossNachSchluessel = new Map((modellGeschosse || []).map((g) => [schluessel(g), String(g)]));
  const liste = (Array.isArray(plan) ? plan : [])
    .filter((l) => l && (l.status || "geplant") === "geplant" && isoTag(l.termin))
    .map((l, i) => {
      const nr = Number.isInteger(l.nr) ? l.nr : i + 1;
      const name = String(l.bauabschnitt || "").trim() || `Lieferung ${nr}`;
      const eigene = (Array.isArray(l.geschosse) ? l.geschosse : []).map((g) => String(g).trim()).filter(Boolean);
      const gleichnamig = geschossNachSchluessel.get(schluessel(name));
      return {
        id: String(l.id || `L${nr}`),
        nr,
        name,
        termin: /** @type {string} */ (isoTag(l.termin)),
        tage: /** @type {number} */ (tageZwischen(h, l.termin)),
        geschosse: eigene.length ? eigene : gleichnamig ? [gleichnamig] : null,
        log: Number(l.log) || 300,
      };
    });
  liste.sort((a, b) => a.termin.localeCompare(b.termin) || a.nr - b.nr);
  return liste.slice(0, MAX_ABSCHNITTE);
}

/**
 * The earliest section that covers a storey.
 * @param {string|null|undefined} geschoss storey name of the finding (null = unknown)
 * @param {Abschnitt[]} abschnitte in date order (abschnittsTermine)
 * @returns {Abschnitt|null}
 */
export function abschnittVonBefund(geschoss, abschnitte) {
  const k = geschoss ? schluessel(geschoss) : null;
  for (const a of abschnitte || []) {
    if (a.geschosse === null) return a;
    if (k && a.geschosse.some((g) => schluessel(g) === k)) return a;
  }
  return null;
}

/**
 * Severity rank of a finding kind (1 = high … 3 = low), from the finding map styles.
 * @param {string} kind
 * @returns {number}
 */
export function schwereVon(kind) {
  return stilVon(kind).schwere;
}

/**
 * Findings grouped by the section they block, earliest section first.
 *
 * @template B
 * @param {B[]} befunde findings (clash.js objects with `kind`)
 * @param {{abschnitte?: Abschnitt[], geschossVon: (b: B) => string|null,
 *   nummer?: (b: B, index: number) => number}} opt
 *   abschnitte — sections in date order; geschossVon — storey of a finding;
 *   nummer — report number (default: position + 1) — the tie-breaker after severity.
 * @returns {Array<{key: string, abschnitt: Abschnitt|null, befunde: B[]}>}
 *   groups in date order, then the rest group (key OHNE_ABSCHNITT) when not empty.
 *   Without any section: one group (key OHNE_ABSCHNITT) with every finding.
 */
export function ordneNachAbschnitt(befunde, { abschnitte = [], geschossVon, nummer = (_b, i) => i + 1 }) {
  const liste = Array.isArray(befunde) ? befunde : [];
  const nr = new Map(liste.map((b, i) => [b, nummer(b, i)]));
  const nachSchwere = (a, b) => schwereVon(/** @type {any} */ (a).kind) - schwereVon(/** @type {any} */ (b).kind)
    || (nr.get(a) ?? 0) - (nr.get(b) ?? 0);
  /** @type {Map<string, B[]>} */
  const jeAbschnitt = new Map((abschnitte || []).map((a) => [a.id, []]));
  /** @type {B[]} */
  const rest = [];
  for (const b of liste) {
    const a = abschnittVonBefund(geschossVon(b), abschnitte);
    if (a) jeAbschnitt.get(a.id).push(b);
    else rest.push(b);
  }
  const gruppen = (abschnitte || [])
    .filter((a) => jeAbschnitt.get(a.id).length > 0)
    .map((a) => ({ key: `${a.name} · ${a.termin}`, abschnitt: a, befunde: jeAbschnitt.get(a.id).sort(nachSchwere) }));
  if (rest.length) gruppen.push({ key: OHNE_ABSCHNITT, abschnitt: null, befunde: rest.sort(nachSchwere) });
  return gruppen;
}

/**
 * Counts per section for the report cover page — sections WITHOUT findings are listed
 * too (a clean section is information), the rest group only when it holds findings.
 * @param {Array<{abschnitt: Abschnitt|null, befunde: Array<{kind: string}>}>} gruppen ordneNachAbschnitt output
 * @param {Abschnitt[]} abschnitte all sections in date order
 * @returns {Array<{name: string, termin: string|null, tage: number|null, anzahl: number,
 *   hoch: number, mittel: number, niedrig: number}>}
 */
export function befundeJeAbschnitt(gruppen, abschnitte) {
  const zaehle = (befunde) => {
    const z = { anzahl: befunde.length, hoch: 0, mittel: 0, niedrig: 0 };
    for (const b of befunde) z[SCHWERE_WORT[schwereVon(b.kind)] || "niedrig"] += 1;
    return z;
  };
  const nachId = new Map((gruppen || []).filter((g) => g.abschnitt).map((g) => [g.abschnitt.id, g.befunde]));
  const zeilen = (abschnitte || []).map((a) => ({ name: a.name, termin: a.termin, tage: a.tage, ...zaehle(nachId.get(a.id) || []) }));
  const rest = (gruppen || []).find((g) => !g.abschnitt);
  if (rest && rest.befunde.length) zeilen.push({ name: OHNE_ABSCHNITT, termin: null, tage: null, ...zaehle(rest.befunde) });
  return zeilen;
}
