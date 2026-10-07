// Fee-contract billing (phase 79, BUCH-05; shared with phase 81, D-P79-27):
// the abschlagsVorschlag (progress-based instalment proposal) with its per-LP
// breakdown abschlagsVorlage, the restBisSchluss (net amount left until the
// Schlussrechnung) and the zahlungsplan (one planned invoice per commissioned
// work stage). All of them build on honorar.js's honorarVertrag — Phase 81
// adds Nachträge additively on top of the same zahlungsplan.
//
// In:  a Honorarvertrag, its already-issued invoices and (for the instalment
//      proposal) an execution stand per work stage. Out: an amount or a list
//      of planned invoice records ({status: "geplant"}), never written here.

import { plusMonate } from "../kalender/datum.js";
import { honorarVertrag } from "./honorar.js";

/**
 * Net revenue already issued for a fee contract, in cents (summed per
 * invoice in whole cents — the package boundary keeps src/lib/accounting/
 * geld.js out of reach, so the cent rule is applied here directly). Storno
 * documents are deliberately excluded (`art !== "storno"`) alongside the
 * cancelled original (`status !== "gestellt"` once it is "storniert") — a
 * wholly cancelled invoice must net to ZERO revenue, not to a negative amount
 * from the storno alone.
 * @param {Record<string, any>} vertrag
 * @param {ReadonlyArray<Record<string, any>>} rechnungen
 * @returns {number} cents
 */
function gestellteNettoCent(vertrag, rechnungen) {
  return (rechnungen || [])
    .filter((r) => r.honorarvertrag_id === vertrag.id && r.status === "gestellt" && r.art !== "storno")
    .reduce((n, r) => n + (typeof r.netto === "number" ? Math.round(r.netto * 100) : 0), 0);
}

/**
 * Instalment proposal broken down per work stage — the prefill of a new
 * Abschlag invoice (RechnungFormular's `vorlage`). Leistungsstand per
 * COMMISSIONED stage = its 100 %-position fee × the given stand percent
 * (rounded per stage); what has already been issued for the contract is
 * credited to the stages in their order (Abschläge follow the LP sequence,
 * and the stored invoices carry no reliable per-LP split to do better), and
 * only the uncovered rest of each stage becomes a proposal line.
 * @param {Record<string, any>} vertrag Honorarvertrag
 * @param {Record<number, number>} stand execution percent per work-stage number (missing = 0)
 * @param {ReadonlyArray<Record<string, any>>} rechnungen already-stored invoices (any status)
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables (honorar.js)
 * @returns {{netto: number, lp_pos: Array<{lp: number, stand: number, netto: number}>}}
 *   netto in Euro (never negative, = sum of lp_pos); lp_pos netto in Euro, stand in percent
 */
export function abschlagsVorlage(vertrag, stand, rechnungen, optionen = {}) {
  const berechnet = honorarVertrag(vertrag, optionen);
  if (!Array.isArray(berechnet.lph) || !berechnet.lph.length) return { netto: 0, lp_pos: [] };
  const standKarte = stand || {};
  let nochAnzurechnenCent = gestellteNettoCent(vertrag, rechnungen);
  let summeCent = 0;
  /** @type {Array<{lp: number, stand: number, netto: number}>} */
  const lpPos = [];
  for (const position of berechnet.lph) {
    if (!position.beauftragt) continue;
    const prozent = typeof standKarte[position.nr] === "number" ? standKarte[position.nr] : 0;
    const leistungsstandCent = Math.round(position.betrag * 100 * (prozent / 100));
    const angerechnetCent = Math.min(leistungsstandCent, Math.max(0, nochAnzurechnenCent));
    nochAnzurechnenCent -= angerechnetCent;
    const offenCent = leistungsstandCent - angerechnetCent;
    if (offenCent <= 0) continue;
    lpPos.push({ lp: position.nr, stand: prozent, netto: offenCent / 100 });
    summeCent += offenCent;
  }
  return { netto: summeCent / 100, lp_pos: lpPos };
}

/**
 * Instalment proposal (Abschlag): the execution-based Leistungsstand of every
 * COMMISSIONED work stage (its 100 %-position fee × the given stand percent,
 * rounded per stage) minus what has already been issued for this contract —
 * never negative (a stand behind what was already billed proposes nothing).
 * The total of abschlagsVorlage(), so the proposed amount and its per-LP
 * breakdown can never disagree.
 * @param {Record<string, any>} vertrag Honorarvertrag
 * @param {Record<number, number>} stand execution percent per work-stage number (missing = 0)
 * @param {ReadonlyArray<Record<string, any>>} rechnungen already-stored invoices (any status)
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables (honorar.js)
 * @returns {number} Euro, never negative
 */
export function abschlagsVorschlag(vertrag, stand, rechnungen, optionen = {}) {
  return abschlagsVorlage(vertrag, stand, rechnungen, optionen).netto;
}

/**
 * Net amount left until the Schlussrechnung: the contract's full net fee
 * minus everything already issued for it (storno-adjusted, see
 * gestellteNetto()). `null` when the fee itself cannot be computed (E-13:
 * "Tafel fehlt" or outside the table range) — never a misleading 0 €.
 * @param {Record<string, any>} vertrag Honorarvertrag
 * @param {ReadonlyArray<Record<string, any>>} rechnungen already-stored invoices (any status)
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables (honorar.js)
 * @returns {number|null} Euro
 */
export function restBisSchluss(vertrag, rechnungen, optionen = {}) {
  const berechnet = honorarVertrag(vertrag, optionen);
  if (typeof berechnet.netto !== "number") return null;
  return (Math.round(berechnet.netto * 100) - gestellteNettoCent(vertrag, rechnungen)) / 100;
}

/**
 * Payment plan: one PLANNED invoice (`status: "geplant"`) per commissioned
 * work stage, in work-stage order, dated `intervallMonate` months apart
 * starting at `start`. Phase 81 adds Nachträge to this list additively — it
 * never replaces a stage already planned here.
 * @param {Record<string, any>} vertrag Honorarvertrag
 * @param {{start: string, intervallMonate?: number}} zeitplan start 'YYYY-MM-DD'; intervallMonate default 1
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables (honorar.js)
 * @returns {Array<Record<string, any>>} planned Ausgangsrechnung drafts (no id — the caller saves them)
 */
export function zahlungsplan(vertrag, { start, intervallMonate = 1 }, optionen = {}) {
  const berechnet = honorarVertrag(vertrag, optionen);
  if (!Array.isArray(berechnet.lph)) return [];
  return berechnet.lph
    .filter((position) => position.beauftragt)
    .map((position, i) => ({
      project_id: vertrag.project_id,
      honorarvertrag_id: vertrag.id,
      art: "abschlag",
      lp_pos: [{ lp: position.nr, stand: 100, netto: position.betrag }],
      netto: position.betrag,
      ust_satz: typeof vertrag.ust_satz === "number" ? vertrag.ust_satz : 19,
      rechnungsdatum: /** @type {string} */ (plusMonate(start, i * intervallMonate)),
      status: "geplant",
    }));
}
