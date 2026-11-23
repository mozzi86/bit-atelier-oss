// Template versions of the fee letters (phase 115, user finding 15.11.2026) — the NUMBERS only, apart from the
// builders in vorlagen.js. Why a file of its own: the offer and amendment rules (src/lib/honorar/angebot.js,
// honorarNachtrag.js) stamp the version on a record when it leaves the draft state, and those rules sit on the
// app's start path (deadlines overview). Importing vorlagen.js there would pull every letter text into the entry
// script; this file costs a few bytes.
//
// In:  a fee record (Honorarangebot / Honorarnachtrag). Out: the template version its letter is built with.

/**
 * Current template version per fee letter. 1 = everything in the text, the amount table after the greeting
 * (81-03/81-04); 2 = amount table before closing text and greeting (115); 3 (105-19 follow-up) = the wording of 2,
 * the fixed PDF also carries the document language (/Lang) and DisplayDocTitle. vorlagen.js keeps a builder for every
 * version up to the one named here (tests/unit/briefSchluss.test.js checks that).
 */
export const HONORAR_BRIEF_VERSION = Object.freeze({ honorarangebot: 3, auftragsbestaetigung: 3, honorarnachtrag: 3 });

/**
 * First template version of the fee letters whose fixed PDF carries /Lang and DisplayDocTitle. A letter frozen with
 * an older version is rebuilt without them, so it still gives the bytes of its stored SHA-256.
 */
export const HONORAR_BRIEF_VERSION_MIT_SPRACHE = 3;

/**
 * The template version a fee record's letter is built with. A draft is not frozen and always gets the current
 * version; a record that left the draft state keeps the version stamped on it when it did (`vorlage_version`, the
 * field name of the correspondence letters). A frozen record WITHOUT the stamp was frozen before versions were
 * stamped (before 15.11.2026) and is version 1 — so an offer that was already sent is built again as it was sent.
 * @param {keyof typeof HONORAR_BRIEF_VERSION} key
 * @param {{status?: string, vorlage_version?: number}|null|undefined} datensatz Honorarangebot / Honorarnachtrag
 * @returns {number}
 */
export function honorarBriefVersion(key, datensatz) {
  if ((datensatz?.status || "entwurf") === "entwurf") return HONORAR_BRIEF_VERSION[key];
  const gestempelt = Number(datensatz?.vorlage_version);
  return Number.isInteger(gestempelt) && gestempelt >= 1 ? gestempelt : 1;
}
