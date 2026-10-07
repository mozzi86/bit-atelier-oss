// Besitzer: 79-07 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Bank-Abgleich (Spur A)".
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
  // abgleich.js: entity names used both in status text and the search dialog
  "Ausgangsrechnung": "Outgoing invoice",
  "Eingangsrechnung": "Incoming invoice",
  "Steuerzahlung": "Tax payment",
  "Entnahme": "Drawing",
  // abgleich.js / BankReiter.jsx: table columns and status
  "Buchungstag": "Booking date",
  "Verwendungszweck": "Purpose",
  "Gegenpartei": "Counterparty",
  "Zuordnung": "Assignment",
  "Zugeordnet": "Assigned",
  "Ignoriert": "Ignored",
  // BankReiter.jsx: import flow
  "Kontoauszug importieren (CSV)": "Import bank statement (CSV)",
  "Keine Kopfzeile mit Buchungstag/-datum und Betrag gefunden.": "No header row with a booking date and an amount was found.",
  "Bank nicht automatisch erkannt — Spalten bitte zuordnen.": "Bank not recognised automatically — please map the columns.",
  "{n} Zeilen in der Datei": "{n} rows in the file",
  "Importieren": "Import",
  "{neu} neu · {dubletten} Dubletten · {auto} automatisch zugeordnet": "{neu} new · {dubletten} duplicates · {auto} automatically assigned",
  "{n} Unstimmigkeiten im Bank-Abgleich": "{n} inconsistencies in the bank reconciliation",
  // BankReiter.jsx: filter and row actions
  "Filter": "Filter",
  "alle": "all",
  "Zuordnen": "Assign",
  "Ignorieren": "Ignore",
  "Zuordnung lösen": "Undo assignment",
  "Wieder öffnen": "Reopen",
  "Zuordnung gelöst": "Assignment undone",
  "Keine Bankumsätze": "No bank transactions",
  // SpaltenZuordnung.jsx: manual column mapping
  "Gespeichertes Profil verwenden": "Use a saved profile",
  "Profil wählen …": "Select a profile …",
  "Trenner": "Separator",
  "Zahlformat": "Number format",
  "Deutsch (1.234,56)": "German (1.234,56)",
  "Englisch (1,234.56)": "English (1,234.56)",
  "Datumsformat": "Date format",
  "Zeichensatz": "Character encoding",
  "Tabulator": "Tab",
  "Betragsspalte": "Amount column",
  "eine Spalte (Vorzeichen)": "one column (signed)",
  "Betrag + Soll/Haben-Spalte": "Amount + debit/credit column",
  "getrennte Soll-/Haben-Spalten": "separate debit/credit columns",
  "Spalte Soll": "Debit column",
  "Spalte Haben": "Credit column",
  "Spalte Betrag": "Amount column",
  "Spalte Soll/Haben": "Debit/credit column",
  "Valuta (optional)": "Value date (optional)",
  "Profilname": "Profile name",
  "Als Bankprofil speichern": "Save as bank profile",
  "Bitte einen Namen für das Profil eingeben.": "Please enter a name for the profile.",
  "Bankprofil gespeichert": "Bank profile saved",
  "Vorschau übernehmen": "Apply mapping",
  "Eigenes Profil": "Custom profile",
  // ZuordnungDialog.jsx: candidates, search
  "Umsatz zuordnen": "Assign transaction",
  "Umsatz zugeordnet": "Transaction assigned",
  "Vorschläge": "Suggestions",
  "Rechnungsnummer und Betrag passen": "Invoice number and amount match",
  "Rechnungsnummer im Verwendungszweck": "Invoice number in the purpose text",
  "Betrag weicht ab": "Amount differs",
  "Rechnungsnummer des Lieferanten im Verwendungszweck": "Supplier's reference number in the purpose text",
  "Lieferant erkannt": "Supplier recognised",
  "Finanzamt und Betrag passen": "Tax office and amount match",
  "IBAN gehört einem Gesellschafter": "IBAN belongs to an owner or partner",
  "Suche über Rechnungen, Ausgaben, Entnahmen, Steuerzahlungen": "Search invoices, expenses, drawings, tax payments",
  "Keine Treffer": "No matches",
  // BANK_PROFILE labels (bankCsv.js) — shown in the import preview
  "Sparkasse (CSV-CAMT V2)": "Sparkasse (CSV-CAMT V2)",
  "VR-Bank / Sparda / GLS": "VR-Bank / Sparda / GLS",
  "VR-Bank (alt, Soll/Haben)": "VR-Bank (old, debit/credit)",
  "DKB (neu)": "DKB (new)",
  "Postbank / Deutsche Bank": "Postbank / Deutsche Bank",
  "N26 / Finom / Vivid": "N26 / Finom / Vivid",
  "Generisch (manuelle Zuordnung)": "Generic (manual mapping)",
};
