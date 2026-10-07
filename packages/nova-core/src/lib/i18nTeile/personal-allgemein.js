// Besitzer: 80-04, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Personal — Überblick und gemeinsame Texte der Seite".
// Decision list § 5: i18n.jsx is touched once per phase (80-01); every plan of the
// phase writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
// Before adding a key, grep all dictionary files: an existing key is reused, never
// entered again. A word that both lanes need and that appears only after wave 1 is
// not entered twice; if the guard still finds one after merging a wave, the merge
// fix moves it once into the block "Words several tabs share" of
// buchhaltung-fundament.js (rule of c8858d0) — i18n.jsx stays closed after 80-01.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // Overview tile (PersonalUebersicht.jsx)
  "Team": "Team",
  "Recruiting": "Recruiting",
  "Eintritte": "New hires",
  "{n} aktiv": "{n} active",
  "{n} im Eintritt": "{n} onboarding",
  "{n} {wort}": "{n} {wort}",
  "Inhaber:in": "Owner",
  "Gesellschafter:innen": "Partners",
  "{n} VZÄ": "{n} FTE",
  "Kleinbetrieb (§ 23 KSchG) — das Kündigungsschutzgesetz gilt nicht, kein Rechtsrat.": "Small business (§ 23 KSchG) — the Dismissal Protection Act does not apply; not legal advice.",
  "Das Kündigungsschutzgesetz gilt (§ 23 KSchG), kein Rechtsrat.": "The Dismissal Protection Act applies (§ 23 KSchG); not legal advice.",
  "Mitarbeitende ansehen": "View staff",
  "{n} Stellen offen": "{n} open positions",
  "{n} Bewerbungen aktiv": "{n} active applications",
  "Keine laufenden Eintritte.": "No onboarding in progress.",
  "Eintritt {name}: {erledigt} von {gesamt} erledigt": "Onboarding {name}: {erledigt} of {gesamt} done",
  "{erledigt} von {gesamt} erledigt": "{erledigt} of {gesamt} done",
  "Unbekannt": "Unknown",
  "Neue Person": "New person",
  "Mitarbeitende anlegen": "Add staff",
  // Team tile link to the legal-form rule (PersonalUebersicht.jsx, merge follow-up 80)
  "Rechtsform ändern": "Change legal form",
  // Legal-form hints (mitarbeiter.js gesellschafterHinweise, D-P80-07 — shared
  // with the staff form's Gesellschafter-Auswahl block, not just the overview)
  "In der Buchhaltung pflegen": "Maintain in accounting",
  "Einzelunternehmen hat keine Gesellschafter — Rechtsform in Einstellungen › Regelwerke prüfen": "Sole proprietorship has no partners — check the legal form in Settings › Rule books",
  "Bei GbR/PartG sind die Beteiligten Gesellschafter bzw. Partner, nicht Inhaber": "For a GbR/PartG the people involved are partners, not owners",
  "Bei GmbH/UG meist gf_gmbh (Geschäftsführergehalt = Personalaufwand)": "For a GmbH/UG usually gf_gmbh (managing-director salary = personnel expense)",
  "Gewinnschlüssel unvollständig — in der Buchhaltung pflegen": "Profit-sharing key incomplete — maintain in accounting",

  // PERSONENARTEN labels (mitarbeiter.js) — shared across every HR tab that
  // shows a person's type (staff here, contracts/onboarding/recruiting later).
  "Angestellt": "Employed",
  "Minijob": "Mini job",
  "Midijob (Übergangsbereich)": "Midi job (transition zone)",
  "Werkstudent:in": "Working student",
  "Pflichtpraktikum": "Mandatory internship",
  "Freiwilliges Praktikum": "Voluntary internship",
  "Auszubildende:r": "Apprentice",
  "Geschäftsführung (GmbH)": "Management (GmbH)",
  "Freie Mitarbeit": "Freelance",
  "Gesellschafter:in": "Partner",
  // PERSONENARTEN hints (artInfo.hinweis)
  "Verdienstgrenze prüfen (Regelwerk personal.minijob_grenze)": "Check the earnings limit (rule book personal.minijob_grenze)",
  "Obergrenze prüfen (Regelwerk personal.midijob_obergrenze)": "Check the upper limit (rule book personal.midijob_obergrenze)",
  "Wochenstunden in der Vorlesungszeit begrenzt (personal.werkstudent_max_h)": "Weekly hours limited during term time (personal.werkstudent_max_h)",
  "ohne Mindestlohn": "no minimum wage",
  "ohne Mindestlohn bis 3 Monate (personal.praktikum_ohne_milo_monate)": "no minimum wage for up to 3 months (personal.praktikum_ohne_milo_monate)",
  "Personalaufwand, keine Entnahme": "Personnel expense, not a drawing",
  "Scheinselbstständigkeit prüfen — § 7a SGB IV Statusfeststellung": "Check for bogus self-employment — § 7a SGB IV status determination",
  "kein Arbeitsvertrag, Vergütung = Entnahme": "no employment contract, pay = drawing",

  // STATUS labels (mitarbeiter.js) — "Aktiv" already exists in i18n.jsx
  "Im Eintritt": "Onboarding",
  "Ruhend": "Dormant",
  "Ausgeschieden": "Left",
  "Gesperrt": "Locked",

  // validiereMitarbeiter() fail texts
  "Vorname fehlt": "First name missing",
  "Nachname fehlt": "Last name missing",
  "Personenart fehlt": "Person type missing",
  "Austritt liegt vor dem Eintritt": "Leaving date is before the start date",
};
