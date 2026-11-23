// briefkopfBrief.js — the letterhead as a LETTER uses it (wave 1, B-81-05 / BEFUNDE-82 M-2, W1-BUERO-F2).
//
// Built only on @core/lib/briefkopf.js (defaults, normalisation, placeholder): no second copy of either.
// A separate file only for the size budget — briefkopf.js is in the entry chunk (sidebar), these helpers
// are needed by lazy pages only (letters, dunning letters, fee PDFs, job ads, invoices).
//
// In:  a raw or normalised letterhead (and the legacy accounting office name). Out: eigenerBueroName,
//      briefkopfZeilen, briefkopfFuerBrief.

import { DEFAULT_BRIEFKOPF, normalisiereBriefkopf } from "./briefkopf.js";

/**
 * The office name the office itself entered: "" while the letterhead is empty
 * or still holds the shipped placeholder (DEFAULT_BRIEFKOPF.office). Callers that
 * must never print the placeholder (invoice seller, job ads) start from this.
 * @param {any} wert raw or normalised letterhead
 * @returns {string} trimmed office name, "" when unset
 */
export function eigenerBueroName(wert) {
  const name = String(normalisiereBriefkopf(wert).office || "").trim();
  return name && name !== DEFAULT_BRIEFKOPF.office ? name : "";
}

/**
 * Letterhead as sender lines of a letter: the office name, then the free-text
 * address one line per non-empty part (the tagline and contact are no address
 * lines — a letter puts them in its footer, if at all). Normalises first, so a
 * raw stored value and useBriefkopf()'s normalised one give the same lines.
 * @param {any} wert raw or normalised letterhead (null/undefined = nothing saved)
 * @returns {string[]} non-empty lines, in print order
 */
export function briefkopfZeilen(wert) {
  const bk = normalisiereBriefkopf(wert);
  const adresse = String(bk.address || "").split("\n").map((z) => z.trim()).filter(Boolean);
  return [String(bk.office || "").trim(), ...adresse].filter(Boolean);
}

/**
 * W1-BUERO-F2: the letterhead a LETTER prints — the one rule for the sender of the
 * dunning letter (accounting/mahnwesen.js) and of every correspondence letter
 * (Correspondence.jsx → briefModell, placeholders, footer). The office name is the
 * one the office entered in the letterhead; while that is empty or the shipped
 * placeholder, the legacy accounting name (Setting{key:"buchhaltung"}.value.buero.name,
 * 94-02) — the name the invoice of the same office prints; with neither, the stored
 * value stays (a letter needs a sender line). Nothing is written back.
 * @param {any} wert raw or normalised letterhead (null/undefined = nothing saved)
 * @param {unknown} [altName] legacy accounting office name, untrimmed
 * @returns {{office: string, tagline: string, address: string, contact: string}} normalised letterhead
 */
export function briefkopfFuerBrief(wert, altName) {
  const bk = normalisiereBriefkopf(wert);
  const office = eigenerBueroName(bk) || String(altName ?? "").trim() || bk.office;
  return office === bk.office ? bk : { ...bk, office };
}
