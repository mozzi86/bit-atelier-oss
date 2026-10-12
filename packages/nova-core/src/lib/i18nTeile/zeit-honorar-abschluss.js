// Besitzer: 81-06 — nur diese Datei ändern.
//
// English dictionary part of phase 81 "Durchstich: Löschschutz, Archiv, Exportzeile".
// Decision list § 5 / HANDOFF § 5: i18n.jsx is touched once per phase (81-01, menu
// and "Weiter mit" only); every plan writes its English texts only into its own
// part file under i18nTeile/. Only texts of this area here — a generic word that
// is missing after 81-01 goes here too and is named in the plan's SUMMARY (it
// moves to zeit-honorar-fundament.js when the lanes are merged, 79 pattern).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Export dialog row (79-12 registry, E-07)
  "Zeiten & Aufträge": "Time & orders",
  // Project deletion guard and archive (/Projects)
  "Zeitbuchungen": "Time bookings",
  "Projekt „{name}“ archiviert": "Project “{name}” archived",
  "Projekt „{name}“ wiederhergestellt": "Project “{name}” restored",
  "Archivieren fehlgeschlagen: {fehler}": "Archiving failed: {fehler}",
  "Löschprüfung fehlgeschlagen — nichts gelöscht: {fehler}": "Deletion check failed — nothing deleted: {fehler}",
  "„{name}“ kann nicht gelöscht werden": "“{name}” cannot be deleted",
  "Stundennachweise, Verträge und Rechnungen sind aufbewahrungspflichtig.": "Time records, contracts and invoices must be retained.",
  "Archivieren blendet das Projekt in der Projektwahl aus; alle Daten bleiben erhalten.": "Archiving hides the project from the project picker; all data is kept.",
  "Archivieren": "Archive",
  "Archiviert ({n})": "Archived ({n})",
  "archiviert am": "archived on",
};
