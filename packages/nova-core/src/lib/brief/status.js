// brief/status.js — labels and states of letters and the mail register
// (phase 82, 82-01 contract; the rules of writing and filing are 82-05's).
//
// A letter goes entwurf → festgeschrieben → versendet; a fixed letter never
// returns to draft (its PDF and SHA-256 are the record). Areas: a letter or
// register entry belongs to a project, the office or the books — never to
// personnel in v1 (E-14, D-P82-32: personnel letters stay with phase 80).
// Documents of phase 82 get distinct Document.bereich values; 'buero' belongs
// to the fee PDFs of phase 81 and is never written by 82.
//
// Pure. Out: SCHREIBEN_STATUS, schreibenStatusWechsel, POST_RICHTUNG, POST_KANAL,
// BEREICHE, DOKUMENT_BEREICH.

/** States of a letter (German labels = i18n keys). */
export const SCHREIBEN_STATUS = Object.freeze({
  entwurf: Object.freeze({ label: "Entwurf" }),
  festgeschrieben: Object.freeze({ label: "Festgeschrieben" }),
  versendet: Object.freeze({ label: "Versendet" }),
});

const UEBERGAENGE = Object.freeze({ entwurf: ["festgeschrieben"], festgeschrieben: ["versendet"], versendet: [] });

/**
 * Whether a letter may change to a state.
 * @param {string} von
 * @param {string} nach
 * @returns {boolean}
 */
export function schreibenStatusWechsel(von, nach) {
  return (/** @type {any} */ (UEBERGAENGE)[von] || []).includes(nach);
}

/** Direction of a register entry. */
export const POST_RICHTUNG = Object.freeze({
  eingang: Object.freeze({ label: "Eingang", kuerzel: "PE" }),
  ausgang: Object.freeze({ label: "Ausgang", kuerzel: "PA" }),
});

/** Channel of a register entry. */
export const POST_KANAL = Object.freeze({
  brief: Object.freeze({ label: "Brief" }),
  email: Object.freeze({ label: "E-Mail" }),
  fax: Object.freeze({ label: "Fax" }),
  bote: Object.freeze({ label: "Bote" }),
  portal: Object.freeze({ label: "Portal" }),
});

/** Areas of letters and register entries (no 'personal' in v1, E-14). */
export const BEREICHE = Object.freeze({
  projekt: Object.freeze({ label: "Projekt" }),
  buero: Object.freeze({ label: "Büro" }),
  buchhaltung: Object.freeze({ label: "Buchhaltung" }),
});

/** Document.bereich written for each area ('buero' of phase 81 is never used here). */
export const DOKUMENT_BEREICH = Object.freeze({ projekt: "projekt", buero: "schriftverkehr", buchhaltung: "buchhaltung" });
