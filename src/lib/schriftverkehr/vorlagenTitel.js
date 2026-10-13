// Display names of the letter templates (phase 82, 82-05): German labels as
// t() source strings, one per key of vorlagen.alleVorlagen(). Kept in the app
// (UI strings), not in @core's template module (document content).
//
// In:  nothing (import-free). Out: VORLAGEN_TITEL, vorlageTitel.

/** Label per template key (German, i18n key). */
export const VORLAGEN_TITEL = Object.freeze({
  brief: "Freier Brief",
  antwort: "Antwort auf Posteingang",
  anschreiben_honorarangebot: "Anschreiben zum Honorarangebot",
  protokoll: "Protokoll mit Verteiler",
  behinderungsanzeige: "Behinderungsanzeige",
  behinderung_bauherr: "Behinderung an Bauherrn melden",
  mahnung: "Mahnung",
  honorarangebot: "Honorarangebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  honorarnachtrag: "Honorarnachtrag",
});

/**
 * Label of a template key (the key itself when unknown).
 * @param {string} key
 * @returns {string}
 */
export function vorlageTitel(key) {
  return /** @type {Record<string, string>} */ (VORLAGEN_TITEL)[key] || key;
}
