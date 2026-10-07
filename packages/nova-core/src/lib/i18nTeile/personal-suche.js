// Besitzer: 80-08, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Personal — Mitarbeitersuche".
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
  // SucheReiter.jsx
  "Bereich": "Section",
  // "Stellen" allein kollidiert mit buchhaltung-rechnungen.js ("Issue" — eine
  // Rechnung stellen); eigene Beschriftung, siehe SucheReiter.jsx-Kommentar.
  "Stellenangebote": "Job postings",
  "Bewerbungen": "Applications",
  "Neue Stelle": "New job posting",
  "Neue Stelle erfassen": "Record a new job posting",
  "Bewerbung erfassen": "Record an application",
  "Neue Bewerbung erfassen": "Record a new application",
  "Mitarbeitersuche ansehen": "View recruiting",
  "{n} Löschung überfällig": "{n} deletion(s) overdue",

  // StellenListe.jsx
  "Noch keine Stellen erfasst.": "No job postings recorded yet.",
  "{n} Std./Woche": "{n} h/week",
  // "{n} Bewerbungen aktiv" bereits in personal-allgemein.js (identische Bedeutung, wiederverwendet).
  "Anzeigentext": "Posting text",
  "Neue Bewerbung": "New application",

  // StellenFormular.jsx / STELLEN_STATUS
  "Stelle bearbeiten": "Edit job posting",
  "Stelle anlegen": "Add job posting",
  "Titel und Status": "Title and status",
  "Stellentitel": "Job title",
  "z. B. Architekt:in (m/w/d) LPH 5–8": "e.g. Architect (m/f/d), service phases 5–8",
  // "Stellenentwurf" statt "Entwurf" — Kollision mit i18n.jsx ("Entwurf" = "Design").
  "Stellenentwurf": "Job posting draft",
  "Pausiert": "Paused",
  "Besetzt": "Filled",
  "Geschlossen": "Closed",
  "Beginn ab": "Start from",
  "Befristet": "Fixed-term",
  "Aufgaben": "Tasks",
  "Anforderungen": "Requirements",
  "Anforderung hinzufügen (Enter)": "Add requirement (Enter)",
  "Hinzufügen": "Add",
  "Muss (sonst Kann)": "Must-have (otherwise nice-to-have)",
  "Gehaltsspanne": "Salary range",
  "Von (€)": "From (€)",
  "Bis (€)": "To (€)",
  "Einheit": "Unit",
  "€/Monat": "€/month",
  "€/Stunde": "€/hour",
  // AGG-Hinweise (aggHinweise.js) — dynamische t(h.hinweis)-Aufrufe
  "(m/w/d) fehlt — geschlechtsneutrale Fassung nötig": "\"(m/f/d)\" missing — a gender-neutral wording is required",
  "Altersbezug gefunden — Diskriminierung wegen des Alters vermeiden": "Age reference found — avoid age discrimination",
  "„Muttersprache“ gefunden — Sprachniveau nennen, nicht die Herkunft": "\"Native speaker\" found — state the language level, not the origin",
  "„belastbar“ ohne Tätigkeitsbezug — konkret auf die Aufgabe beziehen": "\"resilient\" without a task reference — tie it to the specific role",

  // AnzeigentextDialog (StellenFormular.jsx)
  "Kopieren": "Copy",
  "In die Zwischenablage kopiert.": "Copied to the clipboard.",
  "Als PDF": "As PDF",

  // BewerbungFormular.jsx (Stammdaten/Quelle/Vorname/Nachname/Datum/Schließen
  // bereits vorhanden — i18n.jsx bzw. personal-mitarbeitende.js, wiederverwendet)
  "Bewerbung bearbeiten": "Edit application",
  "Stelle": "Job posting",
  "Initiativ (keine Stelle)": "Unsolicited (no job posting)",
  "Initiativbewerbung": "Unsolicited application",
  "Stellenanzeige": "Job advertisement",
  "Hochschulportal": "University portal",
  "E-Mail": "Email",
  "Telefon": "Phone",
  "Eingang am": "Received on",
  "Gehaltswunsch (€)": "Desired salary (€)",
  "Verfügbar ab": "Available from",
  "Datenschutzhinweis (Art. 13) übergeben am": "Privacy notice (Art. 13) handed over on",
  "Talentpool (Einwilligung, Art. 6 Abs. 1 lit. a, Art. 7 DSGVO)": "Talent pool (consent, Art. 6 (1)(a), Art. 7 GDPR)",
  "Einwilligung erteilt am": "Consent given on",
  "Textversion": "Text version",
  "Keine Einwilligung.": "No consent.",
  "Talentpool bis {datum}": "Talent pool until {datum}",
  "Einwilligung widerrufen": "Withdraw consent",
  "Widerrufen am {datum}": "Withdrawn on {datum}",
  "Löschen ab": "Deletion from",
  "Anhänge": "Attachments",
  "Entscheidung": "Decision",
  "Ergebnis": "Outcome",
  "Zusage": "Offer accepted",
  "Absage": "Rejected",
  "Zurückgezogen": "Withdrawn",
  "Absagetext kopieren": "Copy rejection text",
  "Absage versandt am": "Rejection sent on",

  // GespraechsNotizen.jsx
  "Gespräche": "Interviews",
  "Nur tätigkeitsbezogene Angaben — keine Merkmale nach § 1 AGG (Herkunft, Geschlecht, Religion, Behinderung, Alter, sexuelle Identität).":
    "Task-related information only — no characteristics under § 1 AGG (origin, sex, religion, disability, age, sexual identity).",
  "Telefonisch": "By phone",
  "Video": "Video call",
  "Vor Ort": "On site",
  "Teilnehmende": "Participants",
  "Notiz": "Note",
  "Gespräch entfernen": "Remove interview",
  "Gespräch hinzufügen": "Add interview",
  "Bewertung": "Rating",
  "Fachliche Eignung": "Professional suitability",
  "Erfahrung im Projekttyp": "Experience with this project type",
  "Software-Kenntnisse": "Software skills",
  "Verfügbarkeit": "Availability",

  // LoeschfristHinweis.jsx — dynamischer fuellen(t(...), {n})-Aufruf
  "Löschung überfällig": "Deletion overdue",
  "Löschung fällig": "Deletion due",
  "Löschung in {n} Tagen": "Deletion in {n} days",

  // BewerbungsPipeline.jsx / bewerbung.js STUFEN
  "Eingang": "Received",
  "Sichtung": "Screening",
  "Gespräch 1": "Interview 1",
  "Arbeitsprobe": "Work sample",
  "Gespräch 2": "Interview 2",
  "Angebot": "Offer",
  "Abgeschlossen": "Closed",
  "Nächste Stufe": "Next stage",
  "Zurück": "Back",
  "Stufe wechseln": "Change stage",
  "Stufe wechseln…": "Change stage…",
  "Initiativ": "Unsolicited",
  "Noch keine Bewerbungen erfasst.": "No applications recorded yet.",
};
