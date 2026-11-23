// 105-28 / 105-14 / 111-13: English texts of the command palette's record search and of the shortcut help built from
// the command registers. German source text = key.
//
// LAZY part (size budget of the entry chunk): NOT listed in ./index.js. Befehlspalette.jsx and KuerzelHilfe.jsx — both
// loaded lazily by Layout.jsx — import it and call englischErgaenzen() of ../i18n.jsx once when they load.
// The guard test (tests/unit/i18nAbdeckung.test.js) reads this file like every other part.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  // Befehlspalette.jsx — result groups and states
  "Module": "Modules",
  "Kontakte": "Contacts",
  "Datensätze werden geladen…": "Loading records…",
  "Modul, Projekt, Frist, Protokoll, Position, Dokument …": "Module, project, deadline, minutes, item, document …",
  // KuerzelHilfe.jsx / tastenhilfe.js — sections and the global commands
  "Überall": "Everywhere",
  "Massenmodell": "Massing model",
  "Suche und Befehle öffnen": "Open search and commands",
  "Kürzel und Aktionen anzeigen": "Show shortcuts and actions",
  "Fenster oder Befehl schließen": "Close window or command",
  "Kurzform in der Befehlszeile": "Short form in the command line",
  // command labels of the surface registers that had no English text yet
  "Duplizieren": "Duplicate",
  "Modell lesen": "Read model",
};
