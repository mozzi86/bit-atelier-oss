// Besitzer: 90-07 — nur diese Datei ändern.
//
// English dictionary part of the project participant list (BeteiligtePanel in the address book) and its
// role catalogue (src/lib/people/beteiligte.js). The PDF stays German. Existing keys ("Rolle", "Bauherr",
// "Tragwerksplanung" …) are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "(Kontakt gelöscht)": "(contact deleted)",
  "Ansprechpartner": "Contact person",
  "Ausführende Firma": "Contractor",
  "Bauaufsicht / Behörde": "Building authority",
  "Baugrundgutachten": "Geotechnical survey",
  "Bauherrenvertretung": "Client representative",
  "Bauphysik": "Building physics",
  "Brandschutz": "Fire protection",
  "Firma / Behörde": "Company / authority",
  "Freianlagenplanung": "Landscape planning",
  "Noch keine Beteiligten eingetragen.": "No participants entered yet.",
  "Objektplanung (Architektur)": "Architecture",
  "PDF A4 quer": "PDF A4 landscape",
  "Projektbeteiligte": "Project participants",
  "Projektsteuerung": "Project management",
  "Prüfingenieur / Prüfstatik": "Checking engineer",
  "SiGeKo": "Health and safety coordinator",
  "TGA Elektro": "Electrical services",
  "TGA Heizung, Lüftung, Sanitär": "HVAC and plumbing",
  "Vermessung": "Surveying",
  "Versorger": "Utility company",
  "Wer in welcher Rolle an diesem Projekt beteiligt ist — Kontakte aus dem Adressbuch.": "Who is involved in this project in which role — contacts from the address book.",
  "z. B. Gewerk, Zuständigkeit": "e.g. trade, responsibility",
};
