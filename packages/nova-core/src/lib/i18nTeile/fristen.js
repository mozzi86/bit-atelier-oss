// Besitzer: 82-03, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 82 "Fristen & Termine (Agenda, Monat, Gewährleistung)".
// A word both lanes need is not entered twice: if the duplicate guard reports
// one after a wave merge, the merge fix moves it once into the block "Words
// several tabs share" of buero-orga-fundament.js (79 lesson 4a726bb/c8858d0).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) refuses a key that
// already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Page and loader
  "Als erledigt vermerkt": "Marked as done",
  "Konnte nicht als erledigt vermerkt werden": "Could not be marked as done",
  "Termin gespeichert": "Appointment saved",
  "Termin gelöscht": "Appointment deleted",
  "Abnahme gespeichert": "Acceptance saved",
  "Termine werden geladen …": "Loading appointments …",
  "Termine aus {quelle} konnten nicht geladen werden: {meldung}": "Appointments from {quelle} could not be loaded: {meldung}",
  "erst nach Zugriffstrennung (Phase 74)": "only after access separation (phase 74)",
  // Agenda and rows
  "Termin anlegen": "Add appointment",
  ".ics exportieren": "Export .ics",
  "Liste als PDF": "List as PDF",
  "Keine Einträge.": "No entries.",
  "{n} Tage überfällig": "{n} days overdue",
  "Richtwert": "Guide value",
  "Bearbeiten: {titel}": "Edit: {titel}",
  "Erledigt: {titel}": "Done: {titel}",
  "Erledigt": "Done",
  "Öffnen: {titel}": "Open: {titel}",
  "Öffnen": "Open",
  // Filter
  "Quellen": "Sources",
  "nur Fristen": "deadlines only",
  "Vorlaufzeiten und Gewährleistungsfristen einstellen": "Set lead times and warranty periods",
  // Month
  "Vorheriger Monat": "Previous month",
  "Nächster Monat": "Next month",
  "Termine im Monat": "Appointments in the month",
  // Warranty and acceptance dialog
  "Abnahme erfassen": "Record acceptance",
  "Abnahmedatum": "Acceptance date",
  "Regelwerk (Pflicht, keine Voreinstellung)": "Rule set (mandatory, no default)",
  "Wartungsvertrag": "Maintenance contract",
  "Teilabnahme": "Partial acceptance",
  "eigene Architektenleistung (§ 650s BGB)": "own architectural services (§ 650s BGB)",
  "Sicherheit": "Security",
  "Sicherheit zurückgegeben am": "Security returned on",
  "Noch keine Abnahme erfasst.": "No acceptance recorded yet.",
  "Gewährleistung aus Abnahmen": "Warranty from acceptances",
  "Abnahme": "Acceptance",
  "Regelwerk": "Rule set",
  "Begehung": "Inspection",
  "eigene Leistung": "own work",
  "Frist fehlt": "Period missing",
  "Fällt auf ein Wochenende — § 193 BGB ggf. anwendbar (ungeprüft)": "Falls on a weekend — § 193 BGB may apply (unchecked)",
  // Appointment dialog
  "Termin löschen?": "Delete appointment?",
  "Termin bearbeiten": "Edit appointment",
  "Uhrzeit": "Time",
  "Dauer (Minuten)": "Duration (minutes)",
  "ohne Projekt": "without project",
  "Terminart": "Type of appointment",
  "Genehmigt am": "Approved on",
  "Geltungsdauer ab Genehmigungsdatum + 4 Jahre (BayBO Art. 69, Richtwert – prüfen)": "Validity from approval date + 4 years (BayBO Art. 69, guide value – check)",
  "Wiederholung": "Repetition",
  "bis": "until",
  "wöchentlich": "weekly",
  "zweiwöchentlich": "every two weeks",
};
