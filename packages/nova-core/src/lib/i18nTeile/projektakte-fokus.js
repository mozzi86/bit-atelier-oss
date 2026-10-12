// Besitzer: 72-07 und 72-20 — nur diese Datei ändern.
//
// English dictionary part of 72-07 "Projektakte / Chronik" (recent projects in the
// project select, timeline per project) and 72-20 "Arbeitsfokus" (sidebar focus
// "Wofür sind Sie hier?").
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) refuses a key that
// already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // 72-07 project file
  "Projektakte": "Project file",
  "Projektakte: {name}": "Project file: {name}",
  "Projektakte wird geladen …": "Loading project file …",
  "Noch keine Ereignisse in diesem Projekt.": "No events in this project yet.",
  "{n} Befunde": "{n} findings",
  "Alle {n} Ereignisse anzeigen": "Show all {n} events",
  "Nicht geladen": "Not loaded",
  "Prüflauf": "Check run",
  "Dokument": "Document",
  "Projektstand": "Project state",
  "Zuletzt geöffnet": "Recently opened",
  // 72-20 work focus
  "Wofür sind Sie hier?": "What are you here for?",
  "Alle Module": "All modules",
  "Ausschreibung & Vergabe": "Tendering & award",
  "Bauleitung": "Site supervision",
};
