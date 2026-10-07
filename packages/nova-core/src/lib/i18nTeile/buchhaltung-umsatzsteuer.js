// Besitzer: 79-05 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Umsatzsteuer-Vorschau (Spur A)".
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
  // UmsatzsteuerReiter.jsx: switches, status line, hints
  "Versteuerung": "Basis of taxation",
  "Ist (nach Zahlungseingang)": "Cash (on payment)",
  "Soll (nach Rechnungsdatum)": "Accrual (on invoice date)",
  "Voranmeldung": "Filing period",
  "monatlich": "monthly",
  "vierteljährlich": "quarterly",
  "keine (nur Jahreserklärung)": "none (annual return only)",
  "entfällt ohne Voranmeldung": "not applicable without a filing period",
  "Vorschau, keine Voranmeldung (ELSTER)": "Preview only — not a filing with the tax office (ELSTER)",
  "Ist-Versteuerung zulässig als Freiberufler (§ 20 S. 1 Nr. 3 UStG)": "Cash accounting allowed as a freelancer (§ 20 (1) no. 3 UStG)",
  "Ist-Versteuerung nur bis 800.000 € Vorjahresumsatz (§ 20 S. 1 Nr. 1 UStG) — Vorjahr: {betrag}":
    "Cash accounting only up to €800,000 prior-year turnover (§ 20 (1) no. 1 UStG) — prior year: {betrag}",
  "Soll-Versteuerung Pflicht": "Accrual accounting is mandatory",
  "Voranmeldung wahrscheinlich Pflicht (> 2.000 €)": "A filing period is probably mandatory (> €2,000)",
  "Monatliche Voranmeldung wahrscheinlich Pflicht (> 9.000 €)": "Monthly filing is probably mandatory (> €9,000)",
  // umsatzsteuer.js: period label (SVZ row, annual-return row)
  "SVZ": "Special prepayment",
  "Jahreserklärung (Vorschau)": "Annual return (preview)",
  // Table
  "Zeitraum": "Period",
  "Zahllast/Erstattung": "Payable / refund",
  "Erstattung": "Refund",
  "Nenntermin": "Statutory date",
  "Prognose": "Forecast",
  "Keine Belege in diesem Zeitraum": "No records in this period",
  "Anrechnung Sondervorauszahlung {jahr} (§ 48 Abs. 4 UStDV)": "Special prepayment {jahr} credited (§ 48 (4) UStDV)",
  // "als bezahlt markieren"
  "Als bezahlt markieren": "Mark as paid",
  "Steuerzahlung gespeichert": "Tax payment saved",
  // Link to the year clock
  "Steuertermine erscheinen als schwarze Markierung in der Jahresuhr.": "Tax dates appear as a black mark on the year clock.",
  "Zur Jahresuhr": "Go to the year clock",
};
