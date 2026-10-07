// English dictionary part of plan 66-14 (check suite: findings list as CSV / Excel).
// Decision list § 5: new UI texts go here, i18n.jsx stays closed. The guard
// (tests/unit/i18nAbdeckung.test.js) refuses a key that exists elsewhere — grep all
// dictionary files before adding one. The FILE content (column headers, cell texts)
// stays German on purpose, like the AVA exports; only the buttons and messages are
// translated.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // --- 66-14: ModelCheck export buttons, palette entries and messages.
  "Befundliste (CSV)": "Findings list (CSV)",
  "Befundliste (Excel)": "Findings list (Excel)",
  "Alle Befunde als CSV-Datei für Excel (Semikolon, UTF-8); Nr. = laufende Nummer im Prüfbericht und auf der Befundkarte": "All findings as a CSV file for Excel (semicolon, UTF-8); No. = running number in the check report and on the finding map",
  "Alle Befunde als Excel-Datei mit Filter und fixierter Kopfzeile; Nr. = laufende Nummer im Prüfbericht und auf der Befundkarte": "All findings as an Excel file with filter and frozen header row; No. = running number in the check report and on the finding map",
  "Keine Befunde — es gibt nichts zu exportieren.": "No findings — there is nothing to export.",
  "Befundliste „{{datei}}“ heruntergeladen (Zeilen: {{n}})": "Findings list “{{datei}}” downloaded (rows: {{n}})",
  "Befundliste fehlgeschlagen: ": "Findings list failed: ",
};
