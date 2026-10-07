// Besitzer: 79-06 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Entnahmen (Spur B)".
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
  "Entnahmen je Partner": "Drawings per partner",
  "Privatentnahmen": "Owner's drawings",
  "Gesellschafter/in": "Partner",
  "Partner/in": "Partner",
  "Inhaber/in": "Owner",
  "Neu": "New",
  "Bar": "Cash",
  "Überweisung": "Bank transfer",
  "Sachentnahme": "In kind",
  "Steuerentnahme": "Tax withdrawal",
  "Gewinnanteil": "Profit share",
  "Ein Einzelunternehmen hat genau eine Inhaberin/einen Inhaber — Rechtsform prüfen.": "A sole proprietorship has exactly one owner — check the legal form.",
  "Gewinnschlüssel fehlt": "Profit-sharing key missing",
  "Entnahmen (Ist + Plan)": "Drawings (actual + planned)",
  "Bei einer GmbH/UG gibt es keine Privatentnahmen: das Geschäftsführergehalt läuft über die Lohnabrechnung (wiederkehrende Ausgabe, Kategorie „Personal“), Gewinnausschüttungen nur per Gesellschafterbeschluss.":
    "A GmbH/UG has no owner's drawings: the managing director's salary runs through payroll (a recurring expense, category \"Personnel\"), profit distributions only by shareholder resolution.",
  "Zusätzlich: 25 % des Jahresüberschusses in die gesetzliche Rücklage (§ 5a Abs. 3 GmbHG).": "In addition: 25 % of the annual surplus goes into the statutory reserve (§ 5a para. 3 GmbHG).",
  "Geschäftsführergehalt": "Managing director's salary",
  "Keine wiederkehrende Ausgabe der Kategorie „Personal“ erfasst.": "No recurring expense of category \"Personnel\" recorded.",
  "je Monat": "per month",
  "Zu den wiederkehrenden Ausgaben": "Go to recurring expenses",
  "Frühere Entnahmen": "Earlier drawings",
  "Schlüssel gespeichert": "Key saved",
  "Person hinzufügen": "Add person",
  "inaktiv": "inactive",
  "Gewinnschlüssel": "Profit-sharing key",
  "Schlüssel speichern": "Save key",
  "statt 100 %": "instead of 100 %",
  "Neue Entnahme": "New drawing",
  "Keine Entnahmen für dieses Jahr.": "No drawings for this year.",
  "Person": "Person",
  "Plan-Gewinn": "Planned profit",
  "Anteil (%)": "Share (%)",
  "Ist": "Actual",
  "Plan-Rest": "Remaining plan",
  "Differenz": "Difference",
  "Überentnahme": "Excess drawing",
  "Bitte einen Namen eingeben.": "Please enter a name.",
  "Person gespeichert": "Person saved",
  "Person angelegt": "Person created",
  "Geplante Entnahme je Monat": "Planned drawing per month",
  "Bitte eine Person wählen.": "Please choose a person.",
  "Bitte ein Datum eingeben.": "Please enter a date.",
  "Entnahme gespeichert": "Drawing saved",
  "Entnahme erfasst": "Drawing recorded",
  "Entnahme bearbeiten": "Edit drawing",
  "Neue Entnahme erfassen": "Record a new drawing",
  "— keine Person angelegt —": "— no person created —",
};
