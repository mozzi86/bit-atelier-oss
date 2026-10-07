// Besitzer: 79-12 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Exportdialog mit Häkchen je Bereich (Spur B)".
// Decision list § 5: i18n.jsx is touched once per phase (79-01); every area plan
// writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // Export dialog (SpeicherStatus.jsx): one checkbox per office area, off by
  // default; "Buchhaltung" itself already has an EN entry in i18n.jsx (menu
  // label), not repeated here (the duplicate-key guard forbids it).
  "Projektdatei exportieren": "Export project file",
  "Ohne Häkchen: Datei für Planer und Bauherr — ohne Büro-Daten.": "Without a checkmark: a file for specialist planners and the client — without office data.",
  "Projektdaten (immer)": "Project data (always)",
  "Sicherung speichern (alles)": "Save backup (everything)",
  "Projektdatei speichern": "Save project file",
  // Import preview, one line per area — composed as "<label> <segment>" so a
  // future area (Personal, Zeiten & Aufträge) reuses the same two segments.
  "enthalten — ersetzt Ihre": "included — replaces your",
  "nicht enthalten — Ihre": "not included — your",
  "bleibt erhalten": "stays as it is",
  "Die Datei enthält einen leeren Bereich, der hier gefüllt ist — dieser Import löscht die vorhandenen Daten.": "The file has an empty area that is filled here — this import deletes the existing data.",
  "Trotzdem ersetzen": "Replace anyway",
};
