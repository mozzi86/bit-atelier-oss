// One office name for the whole app (94-02, B-ABN-02). The letterhead
// (Setting{key:"briefkopf"}.office, Einstellungen › Büro & Briefkopf) is the
// source; the accounting settings used to keep a second copy in
// Setting{key:"buchhaltung"}.value.buero.name, which drifted apart from it.
//
// That old field is not removed (stores are only ever extended): it stays the
// fallback for installations whose letterhead still holds the shipped
// placeholder, so an office that only ever typed its name into the accounting
// dialog keeps it on invoices until the name is moved to the letterhead.
//
// In:  the normalised letterhead ({office, …}, see useBriefkopf) and the
//      accounting settings ({buero: {name}}). Out: plain strings.

import { DEFAULT_BRIEFKOPF } from "@core/lib/briefkopf.js";

/**
 * The letterhead's office name, or "" while it is empty or still the shipped
 * placeholder ("Architekturbüro").
 * @param {{office?: string}|null|undefined} briefkopf normalised letterhead
 * @returns {string} office name from the letterhead, trimmed; "" when unset
 */
export function briefkopfName(briefkopf) {
  const name = String(briefkopf?.office || "").trim();
  return name && name !== DEFAULT_BRIEFKOPF.office ? name : "";
}

/**
 * The office name to print on invoices, exports and dunning letters.
 * Order: letterhead > legacy accounting field. The shipped placeholder is
 * never returned — an invoice must not name "Architekturbüro" as its seller,
 * the XRechnung check reports the missing name (BR-06) instead.
 * @param {{office?: string}|null|undefined} briefkopf normalised letterhead
 * @param {{buero?: {name?: string}}|null|undefined} einst accounting settings
 * @returns {string} office name, trimmed; "" when neither source has a real one
 */
export function bueroNameAus(briefkopf, einst) {
  return briefkopfName(briefkopf) || String(einst?.buero?.name || "").trim();
}

/**
 * Whether only the legacy accounting field holds a real name — the case where
 * the settings dialog offers "In den Briefkopf übernehmen".
 * @param {{office?: string}|null|undefined} briefkopf normalised letterhead
 * @param {{buero?: {name?: string}}|null|undefined} einst accounting settings
 * @returns {boolean} true when the letterhead is unset and the old field is not
 */
export function nurAlterBueroName(briefkopf, einst) {
  return !briefkopfName(briefkopf) && Boolean(String(einst?.buero?.name || "").trim());
}
