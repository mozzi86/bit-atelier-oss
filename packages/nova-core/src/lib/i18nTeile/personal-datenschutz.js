// Besitzer: 80-10, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Personal — Betroffenenrechte, .bitpers und Anschlüsse an 79".
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
  // DatenschutzAktionen.jsx ("Datenschutz" is shared with the app footer: buchhaltung-fundament.js, shared block)
  "Auskunft herunterladen (JSON)": "Download information (JSON)",
  "Löschen / Sperren": "Delete / lock",
  "Löschen / Sperren?": "Delete / lock?",
  "{n} Datensätze werden gelöscht.": "{n} records will be deleted.",
  "{n} Datensätze werden gelöscht; {m} bleiben bis {bis} gesperrt ({grund}, {norm}).": "{n} records will be deleted; {m} stay locked until {bis} ({grund}, {norm}).",
  "Nichts zu tun — keine Datensätze mit Bezug auf diese Person.": "Nothing to do — no records reference this person.",
  "Erledigt: {n} Datensätze gelöscht.": "Done: {n} records deleted.",
  "Visitenkarte im Adressbuch ebenfalls löschen?": "Also delete the business card in the address book?",
  "Die dienstliche Visitenkarte im Adressbuch ist von der Personal-Löschung nicht betroffen.": "The business card in the address book is not affected by the personnel deletion.",
  "Auch löschen": "Also delete",
  "Im Adressbuch behalten": "Keep in the address book",
  "Löschlauf teilweise ausgeführt ({n} Schritte): {fehler}": "Deletion run partially completed ({n} steps): {fehler}",
  "Bereits heruntergeladene Dateien (Auskunft, Sicherungen) kann die App nicht löschen.": "The app cannot delete files already downloaded (information exports, backups).",
  "Diese Person ist noch beschäftigt — ohne Austrittsdatum gilt keine Aufbewahrungsfrist, alle verknüpften Datensätze wären sofort löschbar.": "This person is still employed — without a leaving date no retention period applies, every linked record would be deletable immediately.",

  // LoeschlaufDialog.jsx
  "Löschfristen prüfen ({n} fällig)": "Check deletion deadlines ({n} due)",
  "Löschfristen prüfen": "Check deletion deadlines",
  "Keine fälligen Löschungen.": "No deletions due.",
  "Diesen Plan ausführen?": "Run this plan?",
  "Ausführen": "Run",
  "Alle fälligen Löschungen ausführen?": "Run every deletion that is due?",
  "{n} Pläne werden nacheinander ausgeführt.": "{n} plans will run one after another.",
  "Alle ausführen": "Run all",
  "{n} Pläne ausgeführt.": "{n} plans completed.",
  "Heruntergeladene Dateien kann die App nicht löschen.": "The app cannot delete downloaded files.",

  // MitarbeiterTabelle.jsx (80-04-owned file, string updated by 80-10 — the
  // retention check it points to now actually exists in the Detail view)
  "Löschen mit Aufbewahrungsprüfung: Detail › Datenschutz": "Deletion with a retention check: Detail › Data protection",

  // PersonalSicherung.jsx (Task 6/7b)
  // "Personaldaten sichern" is shared with DatenBereich.jsx: buchhaltung-fundament.js (shared block).
  "Sicherung laden": "Load a backup",
  "Sicherung laden?": "Load this backup?",
  "Passphrase": "Passphrase",
  "Passphrase wiederholen": "Repeat passphrase",
  "Passphrase der Sicherung": "Backup passphrase",
  "Passphrase weg = Sicherung weg. Es gibt keine Wiederherstellung ohne sie.": "Lose the passphrase, lose the backup — there is no recovery without it.",
  "Mindestens {n} Zeichen.": "At least {n} characters.",
  "Die Passphrasen stimmen nicht überein.": "The passphrases do not match.",
  "Sicherung erstellen": "Create backup",
  "Sicherung gespeichert.": "Backup saved.",
  "Sicherung geladen.": "Backup loaded.",
  "Ersetzt den aktuellen Stand vollständig.": "Replaces the current data completely.",
  "Gerät sperren schützt zusätzlich (Art. 32 DSGVO)": "Locking the device adds protection (Art. 32 GDPR)",
  "Personaldaten sind nur so sicher wie die Sperre dieses Geräts (Art. 32 DSGVO).": "Personnel data is only as safe as this device's lock (Art. 32 GDPR).",
  "Weiter": "Continue",
  "Zurücksetzen": "Reset",

  // PersonalUebersicht.jsx (Task 6, Sicherung/Personalkosten-Kacheln)
  "Sicherung": "Backup",
  "noch nie gesichert": "never backed up",
  // "heute", "vor {n} Tagen": buchhaltung-fundament.js (shared block, also DatenBereich.jsx).
  "Personalkosten (Plan)": "Personnel cost (plan)",
  "brutto": "gross",
  "AG-Kosten": "employer cost",
  "Plan — das Ist kommt aus dem Lohnjournal": "Plan — actuals come from the payroll journal",

  // PersonalZaehlkarte.jsx / PersonalBereich.jsx (Task 7)
  "Personal: {n} Fristen fällig": "Personnel: {n} deadlines due",
  "{n} überfällig": "{n} overdue",
  "Zählkarte in der Projektübersicht anzeigen": "Show the counter tile on the dashboard",
  "„Personal: N Fristen fällig“ auf dem Dashboard — ohne Namen, ohne Beträge, kein Push, keine Mail.": "“Personnel: N deadlines due” on the dashboard — no names, no amounts, no push, no email.",

  // MonatsDetails.jsx (79-10-owned file, string added by 80-10 Task 7b)
  "Personal (Plan) — Ist aus dem Lohnjournal": "Personnel (plan) — actuals are in the payroll journal",

  // PersonAuswahl.jsx (Task 7b)
  "Person (Personal)": "Person (personnel)",
  "— nicht zugeordnet —": "— not assigned —",
};
