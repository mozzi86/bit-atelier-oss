// Entity list of phase 81 (81-01): the collections time tracking and fee offers
// own, the Setting keys that belong to them, and the fields phase 81 adds to
// 79's Honorarvertrag. One table for the storage layer (cloud lock E-03), the
// export dialog row "Zeiten & Aufträge" (81-06, E-07) and phase 82 (rights).
//
// Kostensatz is NOT here: it is derived from the salary and lives in the
// personnel storage class of phase 80 (E-14).
//
// In:  the rule list of the phase. Out: ZEIT_HONORAR_ENTITAETEN,
//      ZEIT_HONORAR_LESEND, ZEIT_HONORAR_SETTING_KEY, ZEIT_HONORAR_SETTING_KEYS,
//      HONORARVERTRAG_81_FELDER.

import { ZEIT_HONORAR_REGELN } from "./regeln.js";

/** The four collections phase 81 owns (bitApi.entities). */
export const ZEIT_HONORAR_ENTITAETEN = Object.freeze(["Zeitbuchung", "Arbeitszeit", "Honorarangebot", "Honorarnachtrag"]);

/**
 * Collections of phase 79 that phase 81 reads (never writes through the generic
 * path): the contracts, the invoices and the work-stage progress. 79's loader
 * ladeAlles() has no HoaiPlan, and the chip / the delete guard need these
 * without loading the whole books. Honorarvertrag is written by 81 only through
 * speichereZH's guarded paths (81 fields, or a full create on acceptance).
 */
export const ZEIT_HONORAR_LESEND = Object.freeze(["Honorarvertrag", "Ausgangsrechnung", "HoaiPlan"]);

/** Key of the phase's own Setting row (marker of the sample data). */
export const ZEIT_HONORAR_SETTING_KEY = "zeit_honorar";

/**
 * Every Setting key that belongs to phase 81: the marker plus one override row
 * "regel:zeit_honorar.*" per rule. The export row "Zeiten & Aufträge" (81-06)
 * carries them: overhead and charge-out rates are the office's calculation basis
 * and must not leave the office with a project hand-over (E-07).
 * @type {ReadonlyArray<string>}
 */
export const ZEIT_HONORAR_SETTING_KEYS = Object.freeze([ZEIT_HONORAR_SETTING_KEY, ...ZEIT_HONORAR_REGELN.map((r) => "regel:" + r.id)]);

/**
 * Fields phase 81 adds to 79's Honorarvertrag (additive, 81-RESEARCH §
 * Entitäten). speichereZH writes only these (plus the `beauftragt` flags in
 * `lph[]`) into an existing contract; 79's form keeps writing everything else.
 */
export const HONORARVERTRAG_81_FELDER = Object.freeze([
  "nummer", "angebot_id", "status", "vertragsdatum", "stufen", "termine", "haftung", "verguetung_snapshot", "bestaetigung_dokument_id",
]);
