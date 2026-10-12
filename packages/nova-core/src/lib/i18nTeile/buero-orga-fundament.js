// Besitzer: 82-01 (Fundament) — nur diese Datei ändern; der Block „Words several
// tabs share“ nimmt Wörter auf, die beide Spuren brauchen.
//
// English dictionary part of phase 82 "Kalender, Schriftverkehr & Rechte":
// shell texts of /Deadlines, /Absences and /Correspondence, the label tables
// (termin.js, rechte.js, abnahme.js, abwesenheit.js, brief/status.js), the tab
// registries, the rule groups fristen and kalender, the term sources, the export
// rows and the settings area "Nutzer & Rechte". Menu titles and "Weiter mit"
// texts stay in i18n.jsx (navigation.test.js reads them there).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) refuses a key that
// already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Pages and shell
  "Alle Fristen und Termine aus Projekten, Verträgen, Buchhaltung, Personal und Postbuch.": "All deadlines and appointments from projects, contracts, accounting, HR and the mail register.",
  "Erinnerungen erscheinen nur bei geöffneter App – für Outlook als .ics exportieren.": "Reminders appear only while the app is open – export as .ics for Outlook.",
  "Bereiche von Fristen & Termine": "Areas of deadlines & appointments",
  "Urlaub, Krankheit und Fortbildung – Gründe sieht nur, wer Personal verwalten darf.": "Leave, sickness and training – reasons are visible only to those who manage HR.",
  "Bereiche der Abwesenheiten": "Areas of absences",
  "Briefe aus Vorlagen, Postbuch Ein- und Ausgang.": "Letters from templates, mail register incoming and outgoing.",
  "Bereiche des Schriftverkehrs": "Areas of correspondence",
  "Diese Büro-Daten sähen sonst alle Mitglieder einer Organisation. Nutzen Sie bis dahin die lokale Version.": "Otherwise every member of an organisation would see these office data. Use the local version until then.",
  "Daten konnten nicht geladen werden": "Data could not be loaded",
  "Noch keine Einträge.": "No entries yet.",
  // Tabs
  "Agenda": "Agenda",
  "Teamkalender": "Team calendar",
  "Anträge": "Requests",
  "Urlaubskonto": "Leave account",
  "Feiertage": "Public holidays",
  "Schreiben": "Letters",
  "Postbuch": "Mail register",
  "Briefvorlagen": "Letter templates",
  // Kinds of terms and agenda groups
  "Fertigstellung": "Completion",
  "Termin": "Appointment",
  "Baugenehmigung": "Building permit",
  "Jour fixe": "Regular meeting",
  "Begehung vor Gewährleistungsende": "Inspection before end of warranty",
  "Gewährleistungsende": "End of warranty",
  "Rückgabe der Sicherheit": "Return of the security",
  "Ende der Architektenhaftung": "End of the architect's liability",
  "USt-Voranmeldung": "VAT return",
  "Steuervorauszahlung": "Tax prepayment",
  "Personalfrist": "HR deadline",
  "Vertragsmeilenstein": "Contract milestone",
  "Vertragsfrist": "Contract deadline",
  "Abschlagsrate": "Instalment",
  "Angebot läuft ab": "Offer expires",
  "Bauzeitenplan": "Construction schedule",
  "Submission": "Bid opening",
  "Modelllieferung": "Model delivery",
  "Förderfrist": "Funding deadline",
  "Antwort fällig": "Reply due",
  "Abwesenheit": "Absence",
  "Diese Woche": "This week",
  // Roles, modules, levels
  "Projektleitung": "Project lead",
  "Mitarbeiter/in": "Staff member",
  "Zeiterfassung › Freigabe & Export": "Time tracking › approval & export",
  "Nutzer & Rechte": "Users & rights",
  "Kein Zugriff": "No access",
  "Lesen": "Read",
  "Wer welche Module und Projekte sieht": "Who sees which modules and projects",
  // Acceptance and warranty
  "VOB/B": "VOB/B",
  "BGB": "BGB",
  "Individuell vereinbart": "Individually agreed",
  "Bauwerk": "Building",
  "Andere Werke": "Other works",
  "Wartungsrelevante Anlage": "System requiring maintenance",
  "Keine Sicherheit": "No security",
  "Einbehalt": "Retention",
  "Regel fehlt": "Rule missing",
  "Datum fehlt": "Date missing",
  // Letters and mail register
  "Festgeschrieben": "Fixed",
  "Ausgang": "Outgoing",
  "Brief": "Letter",
  "Fax": "Fax",
  "Bote": "Courier",
  "Portal": "Portal",
  // Absences
  "Krank": "Sick",
  "Abwesend": "Absent",
  "Sonderurlaub": "Special leave",
  "Überstundenausgleich": "Overtime compensation",
  "Elternzeit": "Parental leave",
  "Betriebsruhe": "Office closure",
  "storniert": "cancelled",
  // Rule groups
  "Fristen & Gewährleistung": "Deadlines & warranty",
  "Vorlauf für Fristen": "Lead time for deadlines",
  "Vorlauf für Termine": "Lead time for appointments",
  "Vorlauf für Hinweise": "Lead time for notices",
  "Agenda-Zeitraum": "Agenda period",
  "Gewährleistung VOB/B Bauwerk": "Warranty VOB/B building",
  "Gewährleistung VOB/B andere Werke": "Warranty VOB/B other works",
  "Gewährleistung VOB/B wartungsrelevante Anlagen ohne Wartungsvertrag": "Warranty VOB/B systems requiring maintenance without maintenance contract",
  "Gewährleistung BGB Bauwerk": "Warranty BGB building",
  "Gewährleistung BGB sonstige Werke": "Warranty BGB other works",
  "Haftung der Architektin": "Architect's liability",
  "Objektbegehung vor Gewährleistungsende": "Site inspection before end of warranty",
  "Rückgabe der Sicherheit nach": "Return of the security after",
  "Kalender & Abwesenheiten": "Calendar & absences",
  "Bundesland der Feiertage": "Federal state of the public holidays",
  "Land": "State",
  "Bayern": "Bavaria",
  "Mariä Himmelfahrt (15.08.) ist Feiertag": "Assumption Day (15 Aug) is a holiday",
  "ja/nein": "yes/no",
  "Augsburger Friedensfest (08.08.) ist Feiertag": "Augsburg Peace Festival (8 Aug) is a holiday",
  "Heiligabend und Silvester": "Christmas Eve and New Year's Eve",
  "Arbeitstag": "Working day",
  "halber Tag": "half day",
  "frei": "free",
  "Höchstens gleichzeitig abwesend": "Maximum absent at the same time",
  "Arbeitstage bei Teilzeit": "Working days in part-time",
  "die ersten n Wochentage ab Montag": "the first n weekdays from Monday",
  // Term sources and export rows
  "Projekttermine": "Project dates",
  "Eigene Termine": "Own appointments",
  "Abnahmen & Gewährleistung": "Acceptances & warranty",
  "Steuertermine": "Tax dates",
  "Personalfristen": "HR deadlines",
  "Modelllieferungen": "Model deliveries",
  "Förderfristen": "Funding deadlines",
  "Termine & Gewährleistung": "Appointments & warranty",
  "Schriftverkehr & Postbuch": "Correspondence & mail register",
  // Words several tabs share (merge fixes of both lanes go here)
};
