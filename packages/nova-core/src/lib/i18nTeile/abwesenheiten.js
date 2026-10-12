// Besitzer: 82-04, Spur A — nur diese Datei ändern.
//
// English dictionary part of phase 82 "Abwesenheiten (Teamkalender, Anträge, Urlaubskonto, Feiertage)".
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
  // Team calendar
  "abwesend": "absent",
  "Halbtag": "half day",
  "Wochenende": "weekend",
  "Legende": "Legend",
  // Requests
  "Von": "From",
  "Bis": "To",
  "erster Tag halb": "first day half",
  "letzter Tag halb": "last day half",
  "Vertretung": "Stand-in",
  "{n} Arbeitstage": "{n} working days",
  "Eintragen": "Record",
  "Abwesenheit gespeichert": "Absence saved",
  "Genehmigen?": "Approve?",
  "Ablehnen?": "Reject?",
  "Stornieren?": "Cancel?",
  "Konflikt": "Conflict",
  "Vertretung {kuerzel} ist {von}–{bis} selbst abwesend": "Stand-in {kuerzel} is absent {von}–{bis} too",
  "Überschneidet sich mit einem eigenen Eintrag {von}–{bis}": "Overlaps an own entry {von}–{bis}",
  "Am {datum} wären {anzahl} Personen abwesend (Richtwert höchstens {max})": "On {datum} {anzahl} people would be absent (guide value at most {max})",
  "Beantragt {tage} Tage, Resturlaub {rest} Tage": "Requests {tage} days, remaining leave {rest} days",
  "Betriebsruhe {von}–{bis} im Zeitraum": "Office closure {von}–{bis} within the period",
  // Leave balance
  "Anspruch": "Entitlement",
  "Übertrag": "Carry-over",
  "genommen": "taken",
  "nach Genehmigung": "after approval",
  "Rest": "Remaining",
  "Verfall": "Lapse",
  "verfällt am {datum}": "lapses on {datum}",
  "übertragen – Hinweis fehlt": "carried over – notice missing",
  "manuell prüfen": "check manually",
  "kein Urlaubskonto (ohne Arbeitsrecht)": "no leave account (no employment law)",
  "kein aktiver Arbeitsvertrag": "no active employment contract",
  "Resturlaub-Hinweis quittieren": "Acknowledge the remaining-leave notice",
  // Time tracking (81, target hours)
  "An diesem Tag ist eine Abwesenheit eingetragen": "An absence is recorded on this day",
  // Holidays
  "Feiertage einstellen": "Set public holidays",
  "regional": "regional",
  "Mariä Himmelfahrt gilt nur in Gemeinden mit überwiegend katholischer Bevölkerung — Status der eigenen Gemeinde beim Bayerischen Landesamt für Statistik prüfen.": "Assumption Day applies only in municipalities with a predominantly Catholic population — check your municipality's status with the Bavarian State Office for Statistics.",
  "Kalender {jahr}: {n} Feiertage, davon {m} an Wochentagen · Kalkulationsbasis Kostensatz: {k} Tage": "Calendar {jahr}: {n} public holidays, {m} of them on weekdays · cost-rate calculation basis: {k} days",
  "Kalkulationsbasis weicht vom Kalender ab — in Einstellungen › Regelwerke prüfen": "Calculation basis differs from the calendar — check in Settings › Rule books",
  "Neujahr": "New Year's Day",
  "Heilige Drei Könige": "Epiphany",
  "Karfreitag": "Good Friday",
  "Ostermontag": "Easter Monday",
  "Tag der Arbeit": "Labour Day",
  "Christi Himmelfahrt": "Ascension Day",
  "Pfingstmontag": "Whit Monday",
  "Fronleichnam": "Corpus Christi",
  "Augsburger Friedensfest": "Augsburg Peace Festival",
  "Mariä Himmelfahrt": "Assumption Day",
  "Tag der Deutschen Einheit": "Day of German Unity",
  "Allerheiligen": "All Saints' Day",
  "1. Weihnachtstag": "Christmas Day",
  "2. Weihnachtstag": "Boxing Day",
};
