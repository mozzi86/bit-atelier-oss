// Besitzer: 80-04, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Personal — Mitarbeitende".
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
  // Table (MitarbeiterTabelle.jsx)
  "Personalnummer": "Staff number",
  "Suche": "Search",
  "Name, Funktion oder Personalnummer": "Name, role or staff number",
  "Alle": "All",
  "Inhaber & Gesellschafter": "Owners & partners",
  "{n} von {m}": "{n} of {m}",
  // "Keine Treffer." is shared with EinstellungsSuche.jsx: buchhaltung-fundament.js (shared block).
  "Noch keine Mitarbeitenden angelegt.": "No staff added yet.",
  "„{name}“ bearbeiten": "Edit “{name}”",
  "„{name}“ entfernen": "Remove “{name}”",
  "„{name}“ entfernen?": "Remove “{name}”?",
  "Der Eintrag wird endgültig gelöscht — nur für Fehleingaben ohne Verträge oder Vorgänge.": "The entry is deleted permanently — only for mistaken entries without contracts or processes.",
  "Löschen mit Aufbewahrungsprüfung folgt unter Datenschutz": "Deletion with a retention check follows under Data protection",

  // Formular (MitarbeiterFormular.jsx)
  "Vorname": "First name",
  "Nachname": "Last name",
  "Dienstliche E-Mail": "Work email",
  "Dienstliches Telefon": "Work phone",
  "Beschäftigung": "Employment",
  "Personenart": "Person type",
  "Funktion": "Role",
  "Eintritt": "Start date",
  "Austritt": "Leaving date",
  "Vertrag, Urlaub und Kündigungsfrist werden im Reiter Verträge gepflegt.": "Contract, leave and notice period are maintained in the Contracts tab.",
  "Verknüpfter Gesellschafter (Buchhaltung)": "Linked partner (accounting)",
  "Verknüpfter Datensatz der Buchhaltung fehlt — Buchhaltung einmal öffnen": "Linked accounting record missing — open accounting once",
  "Buchhaltung öffnen": "Open accounting",
  "Auswählen": "Select",
  "100 % — Einzelunternehmen, kein Gewinnschlüssel": "100% — sole proprietorship, no profit-sharing key",
  "Kein Gewinnschlüssel für dieses Jahr hinterlegt — in der Buchhaltung pflegen": "No profit-sharing key on file for this year — maintain in accounting",
  "Versorgungswerk": "Pension scheme",
  "Befreiung beantragt am": "Exemption applied for on",
  "Bescheid am": "Decision on",
  "Privates Telefon": "Private phone",
  "Notfallkontakt": "Emergency contact",
  "Notizen": "Notes",
  "Keine Angaben zu Gesundheit, Religion, Gewerkschaft oder anderen besonderen Kategorien (Art. 9 DSGVO).": "No details on health, religion, union membership or other special categories (Art. 9 GDPR).",
  "An Lohnbüro übermittelt am": "Sent to payroll office on",
  "Dienstliche Visitenkarte im Adressbuch anlegen": "Add a work contact card to the address book",
  "Person bearbeiten": "Edit person",
  "Adresse": "Address",

  // KammerFeld.jsx
  "Fachrichtung": "Discipline",
  "Mitgliedsnummer": "Membership number",
  "Eingetragen seit": "Registered since",
  "Bauvorlageberechtigt": "Authorised to sign building applications",
  "Fortbildung dieses Jahr (UE)": "Continuing education this year (CE units)",

  // QualifikationenFeld.jsx
  "Qualifikationen": "Qualifications",
  "Qualifikation hinzufügen (Enter)": "Add qualification (Enter)",
  "z. B. Brandschutzbeauftragte:r": "e.g. fire safety officer",
  "gültig bis": "valid until",
  "{bezeichnung} entfernen": "Remove {bezeichnung}",

  // ProjektZuordnung.jsx
  "Projektzuordnungen": "Project assignments",
  "Projekt zuordnen": "Assign project",
  "Projektzuordnung entfernen": "Remove project assignment",
  "Anteil %": "Share %",

  // MitarbeiterDetail.jsx
  "Zurück zur Liste": "Back to the list",
  "Person nicht gefunden": "Person not found",
  "Der Eintrag wurde vielleicht entfernt oder gehört zu einem anderen Datenstand.": "The entry may have been removed or belongs to a different data state.",
};
