// Phase 94 (acceptance findings, stations 0–2): English texts of the fixes.
// Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // 94-02 (B-ABN-02): one office name, read from the letterhead
  "Büroname in den Briefkopf übernommen": "Office name moved to the letterhead",
  "noch nicht eingetragen": "not entered yet",
  "Kommt aus dem Briefkopf — eine Quelle für Rechnungen, XRechnung, Mahnungen und Berichte.": "Comes from the letterhead — one source for invoices, XRechnung, reminders and reports.",
  "Im Briefkopf ändern": "Change in the letterhead",
  "In den Briefkopf übernehmen": "Move to the letterhead",
  // 94-02 (B-ABN-01): tax and bank data in Settings › Office & letterhead
  "Steuer- und Bankdaten": "Tax and bank details",
  "Zur Buchhaltung": "To accounting",
  "Steuer- und Bankdaten gespeichert": "Tax and bank details saved",
  "Für Rechnungen, XRechnung und Mahnungen — dieselben Angaben wie in Buchhaltung › Einstellungen.": "For invoices, XRechnung and reminders — the same details as in Accounting › Settings.",
  // 94-03 (B-ABN-04/05): client from the address book, project created in the offer wizard
  "Projekt angelegt": "Project created",
  "Bitte ein Projekt wählen oder neu anlegen.": "Please choose a project or create a new one.",
  "Name des neuen Projekts": "Name of the new project",
  "Anlegen": "Create",
  "Bauherr aus dem Adressbuch": "Client from the address book",
  "— frei eingeben —": "— enter freely —",
  "Adressbuch ist leer": "Address book is empty",
  // 94-04 (B-ABN-07): invoice rows compute from the stand
  "Eine Zeile steht auf 0,00 € — Stand oder Betrag prüfen.": "One row is at €0.00 — check the stand or the amount.",
  "{n} Zeilen stehen auf 0,00 € — Stand oder Betrag prüfen.": "{n} rows are at €0.00 — check the stand or the amount.",
  // 94-04 (B-ABN-08): Leistungsstand kept in the contract account
  "Leistungsstand gespeichert": "Progress saved",
  "geschätzt aus der Projektphase": "estimated from the project phase",
  "Derselbe Leistungsstand wie im Designer-Reiter „Planer“ — eine Quelle für Controlling und Abschläge.": "The same progress as in the Designer tab “Planner” — one source for controlling and instalments.",
  // 96-01: personnel data encrypted at rest — where the key lives
  "Personaldaten sind verschlüsselt. Ihr Schlüssel liegt außerhalb des Datenordners:": "Personnel data are encrypted. Their key lives outside the data folder:",
  "— getrennt sichern; ohne ihn sind die Personaldaten einer Sicherung nicht lesbar.": "— back it up separately; without it the personnel data of a backup cannot be read.",
};
