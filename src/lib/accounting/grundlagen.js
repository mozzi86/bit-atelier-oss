// Basic functions of the accounting module that at least two areas read
// (phase 79): invoice status, payment-term chain, expected receipts, recurring
// occurrences, straight-line depreciation and the GoBD write protection.
//
// In:  records of the data contract (datenmodell.js), effective settings, a
//      reference date `stichtag`/`heute` passed in (never read from the clock here).
// Out: pure, deterministic functions.

import { parseTag, plusMonate, plusTage } from "@core/lib/kalender/datum.js";
import { BUERO_STANDARD } from "./einstellungen.js";
import { euroZuCent } from "./geld.js";

/**
 * Sum of the payments of an invoice.
 * @param {{zahlungen?: Array<{datum?: string, betrag?: number}>}|null|undefined} rechnung
 * @param {string} [bis] only payments dated on or before this day count ('YYYY-MM-DD')
 * @returns {number} cents
 */
export function bezahltCent(rechnung, bis) {
  const zahlungen = Array.isArray(rechnung?.zahlungen) ? rechnung.zahlungen : [];
  return zahlungen
    .filter((z) => !bis || !z?.datum || z.datum <= bis)
    .reduce((n, z) => n + euroZuCent(z?.betrag), 0);
}

/**
 * Open amount of an invoice (gross minus payments).
 * @param {{brutto?: number, zahlungen?: Array<{datum?: string, betrag?: number}>}|null|undefined} rechnung
 * @param {string} [bis] only payments up to this day count
 * @returns {number} cents (negative when overpaid)
 */
export function offenerBetragCent(rechnung, bis) {
  return euroZuCent(rechnung?.brutto) - bezahltCent(rechnung, bis);
}

/**
 * Due date of an invoice: the frozen `faellig_am`, otherwise invoice date (or
 * planned sending date) plus the payment term.
 * @param {{faellig_am?: string, rechnungsdatum?: string, versand_geplant_am?: string, zahlungsziel_tage?: number}} rechnung
 * @param {number} [zielTage] payment term in days (default: the invoice's own, else 14)
 * @returns {string|null} 'YYYY-MM-DD'
 */
export function faelligAm(rechnung, zielTage) {
  const fest = parseTag(rechnung?.faellig_am);
  if (fest) return fest;
  const basis = parseTag(rechnung?.rechnungsdatum) || parseTag(rechnung?.versand_geplant_am);
  if (!basis) return null;
  const tage = Number.isInteger(zielTage) ? zielTage
    : Number.isInteger(rechnung?.zahlungsziel_tage) ? rechnung.zahlungsziel_tage : BUERO_STANDARD.zahlungsziel_tage;
  return plusTage(basis, /** @type {number} */ (tage));
}

/**
 * Computed status of an outgoing invoice on a day (never stored).
 * Order for issued invoices: paid > overdue > partly paid > open — overdue wins
 * over partly paid because it is the state that needs action (dunning).
 * Planned invoices and drafts never become overdue.
 * @param {{status?: string, brutto?: number, faellig_am?: string, rechnungsdatum?: string,
 *   zahlungsziel_tage?: number, zahlungen?: Array<{datum?: string, betrag?: number}>}} rechnung
 * @param {string} stichtag 'YYYY-MM-DD'
 * @returns {"geplant"|"entwurf"|"offen"|"teilbezahlt"|"ueberfaellig"|"bezahlt"|"storniert"}
 */
export function rechnungsStatus(rechnung, stichtag) {
  const status = rechnung?.status;
  if (status === "storniert") return "storniert";
  if (status === "geplant") return "geplant";
  if (status !== "gestellt") return "entwurf";
  const bezahlt = bezahltCent(rechnung, stichtag);
  const brutto = euroZuCent(rechnung?.brutto);
  if (bezahlt >= brutto) return "bezahlt";
  const faellig = faelligAm(rechnung);
  if (faellig && stichtag > faellig) return "ueberfaellig";
  return bezahlt > 0 ? "teilbezahlt" : "offen";
}

/**
 * Client key for the per-client payment term: the contact id of the fee
 * contract, otherwise the normalised free-text client of the project (lower
 * case, trimmed, runs of spaces collapsed).
 * @param {{bauherr_contact_id?: string}|null|undefined} vertrag
 * @param {{client?: string}|null|undefined} projekt
 * @returns {string|null}
 */
export function bauherrSchluessel(vertrag, projekt) {
  if (vertrag?.bauherr_contact_id) return String(vertrag.bauherr_contact_id);
  const client = typeof projekt?.client === "string" ? projekt.client.trim().replace(/\s+/g, " ").toLowerCase() : "";
  return client || null;
}

/** @param {unknown} v @returns {v is number} */
const tageOk = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Payment term in days, by precedence (E-12): the invoice (frozen) > the fee
 * contract > the per-client map of the settings > the office default > 14.
 * @param {{rechnung?: {zahlungsziel_tage?: number}|null, vertrag?: {zahlungsziel_tage?: number}|null,
 *   einst?: {zahlungsziel_tage?: number, zahlungsziel_je_bauherr?: Record<string, number>}|null,
 *   bauherrSchluessel?: string|null}} quellen
 * @returns {number} days
 */
export function zahlungszielTage({ rechnung, vertrag, einst, bauherrSchluessel: schluessel } = {}) {
  if (tageOk(rechnung?.zahlungsziel_tage)) return rechnung.zahlungsziel_tage;
  if (tageOk(vertrag?.zahlungsziel_tage)) return vertrag.zahlungsziel_tage;
  const karte = einst?.zahlungsziel_je_bauherr;
  if (schluessel && karte && Object.prototype.hasOwnProperty.call(karte, schluessel) && tageOk(karte[schluessel])) return karte[schluessel];
  if (tageOk(einst?.zahlungsziel_tage)) return einst.zahlungsziel_tage;
  return BUERO_STANDARD.zahlungsziel_tage;
}

/**
 * Expected receipt of an invoice for the liquidity plan. Conservative (D-P79-18):
 * overdue receivables do not count (a `warn`, not a promise — liability choice),
 * planned invoices and drafts only while their sending date has not passed.
 * @param {object} rechnung Ausgangsrechnung
 * @param {object} einst effective settings
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {{datum: string, cent: number, sicher: boolean}|null} `sicher` = issued invoice
 */
export function erwarteterEingang(rechnung, einst, heute) {
  const r = /** @type {any} */ (rechnung);
  const status = rechnungsStatus(r, heute);
  if (status === "offen" || status === "teilbezahlt") {
    const datum = faelligAm(r);
    return datum ? { datum, cent: offenerBetragCent(r, heute), sicher: true } : null;
  }
  if (status === "geplant" || status === "entwurf") {
    const versand = parseTag(r?.versand_geplant_am) || parseTag(r?.rechnungsdatum) || heute;
    if (versand < heute) return null;
    const ziel = zahlungszielTage({ rechnung: r, einst: /** @type {any} */ (einst) });
    return { datum: /** @type {string} */ (plusTage(versand, ziel)), cent: euroZuCent(r?.brutto), sicher: false };
  }
  return null;
}

/**
 * Period label of an occurrence.
 * @param {string} datum 'YYYY-MM-DD'
 * @param {"monat"|"quartal"|"jahr"} rhythmus
 * @returns {string} "2026-02", "2026-Q1" or "2026"
 */
function periodeVon(datum, rhythmus) {
  if (rhythmus === "jahr") return datum.slice(0, 4);
  if (rhythmus === "quartal") return `${datum.slice(0, 4)}-Q${Math.ceil(Number(datum.slice(5, 7)) / 3)}`;
  return datum.slice(0, 7);
}

/**
 * Occurrences of a recurring expense between two days (both inclusive). Each
 * occurrence is computed from the start date (not from the previous one), so a
 * start on the 31st lands on every month end (2026-01-31 → 2026-02-28 → 2026-03-31).
 * The key `wa:<id>:<periode>` is the id of the Eingangsrechnung created when it is paid.
 * @param {{id: string, rhythmus?: string, start?: string, bis?: string, aktiv?: boolean}} vorlage
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {Array<{schluessel: string, datum: string, periode: string}>}
 */
export function wiederkehrendeVorkommen(vorlage, von, bis) {
  const start = parseTag(vorlage?.start);
  if (!start || vorlage?.aktiv === false || !parseTag(von) || !parseTag(bis)) return [];
  const rhythmus = vorlage.rhythmus === "jahr" || vorlage.rhythmus === "quartal" ? vorlage.rhythmus : "monat";
  const schritt = rhythmus === "jahr" ? 12 : rhythmus === "quartal" ? 3 : 1;
  const ende = parseTag(vorlage.bis) && /** @type {string} */ (vorlage.bis) < bis ? /** @type {string} */ (vorlage.bis) : bis;
  const liste = [];
  // 1200 steps = 100 years of monthly occurrences; a safe bound for any template.
  for (let k = 0; k < 1200; k++) {
    const datum = /** @type {string} */ (plusMonate(start, k * schritt));
    if (datum > ende) break;
    if (datum < von) continue;
    const periode = periodeVon(datum, rhythmus);
    liste.push({ schluessel: `wa:${vorlage.id}:${periode}`, datum, periode });
  }
  return liste;
}

/**
 * Straight-line depreciation of one year, pro rata by month (§ 7 Abs. 1 S. 4
 * EStG: the month of acquisition counts in full). Computed from the cumulative
 * amount, rounded, so the years sum exactly to the acquisition cost and the
 * rest falls into the last year. In the year of disposal the months up to and
 * including the disposal month count; afterwards nothing.
 * @param {number} akCent acquisition cost in cents (net)
 * @param {number} ndJahre useful life in whole years (≥ 1)
 * @param {string} anschaffung acquisition date 'YYYY-MM-DD'
 * @param {number} jahr business year
 * @param {{datum: string}|null} [abgang] disposal
 * @returns {number} depreciation of that year in cents
 * @throws {Error} for a useful life below one year or an invalid date
 */
export function afaLinearCent(akCent, ndJahre, anschaffung, jahr, abgang = null) {
  const start = parseTag(anschaffung);
  if (!start) throw new Error(`AfA: ungültiges Anschaffungsdatum „${anschaffung}“.`);
  if (!Number.isInteger(ndJahre) || ndJahre < 1) throw new Error(`AfA: Nutzungsdauer muss mindestens ein ganzes Jahr sein (${ndJahre}).`);
  const gesamtMonate = ndJahre * 12;
  const startIndex = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const abgangTag = parseTag(abgang?.datum);
  const abgangIndex = abgangTag ? Number(abgangTag.slice(0, 4)) * 12 + Number(abgangTag.slice(5, 7)) - 1 : Infinity;
  /** Depreciation accumulated up to the end of year y, in cents. @param {number} y */
  const kumuliert = (y) => {
    const letzterIndex = Math.min(y * 12 + 11, abgangIndex);
    const monate = Math.max(0, Math.min(gesamtMonate, letzterIndex - startIndex + 1));
    return monate >= gesamtMonate ? akCent : Math.round((akCent * monate) / gesamtMonate);
  };
  return Math.max(0, kumuliert(jahr) - kumuliert(jahr - 1));
}

// Fields an issued invoice may still change (GoBD): payments, dunning, storno.
// Technical fields are written by the storage layer itself.
const NACH_STELLUNG_ERLAUBT = new Set(["zahlungen", "mahnungen", "updated_date", "created_date", "id"]);

/**
 * GoBD write protection (liability choice, § 14 Abs. 4 UStG — an issued invoice
 * is a document: correcting it means a cancellation invoice, not an edit).
 * An issued or cancelled outgoing invoice may only change `zahlungen`,
 * `mahnungen` and the status gestellt → storniert. Other entities are not guarded.
 * @param {string} entitaet entity name
 * @param {Record<string, any>|null|undefined} alt stored record
 * @param {Record<string, any>|null|undefined} neu record as it would be stored
 * @returns {boolean} true when the write must be refused
 */
export function schreibschutzVerletzt(entitaet, alt, neu) {
  if (entitaet !== "Ausgangsrechnung" || !alt || !neu) return false;
  if (alt.status !== "gestellt" && alt.status !== "storniert") return false;
  const schluessel = new Set([...Object.keys(alt), ...Object.keys(neu)]);
  for (const k of schluessel) {
    if (NACH_STELLUNG_ERLAUBT.has(k)) continue;
    if (k === "status") {
      if (alt.status === neu.status) continue;
      if (alt.status === "gestellt" && neu.status === "storniert") continue;
      return true;
    }
    if (JSON.stringify(alt[k]) !== JSON.stringify(neu[k])) return true;
  }
  return false;
}
