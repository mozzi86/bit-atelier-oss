// Besitzer: 79-10 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Jahresuhr, Legende und Lage-Leiste (Spur A)".
// Decision list § 5: i18n.jsx is touched once per phase (79-01); every area plan
// writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
// Dates in English values are written "10 Mar" (en-GB reads "3.10" as 3 October).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Abfluss": "Outflow",
  "Ausgaben": "Expenses",
  "Betrag fehlt": "Amount missing",
  "Deckung gefährdet": "Coverage at risk",
  "Deckung unbekannt": "Coverage unknown",
  "ESt": "Income tax",
  "ESt 10.3., 10.6., 10.9. und 10.12.": "income tax 10 Mar, 10 Jun, 10 Sep and 10 Dec",
  "ESt-Vorauszahlungen laufen nicht über das Bürokonto — sie erscheinen weder als Abfluss noch als Steuertermin.":
    "Income-tax prepayments are not paid from the office account — they appear neither as an outflow nor as a tax date.",
  "Eingänge": "Receipts",
  "Entnahmen der Gesellschafter": "Partners' drawings",
  "Folgejahr": "Next year",
  "Für {jahr} ist kein Kontostand-Startwert hinterlegt — die Uhr rechnet ab {betrag}. Tragen Sie ihn unter „Planwerte“ ein.":
    "No starting balance is stored for {jahr} — the clock starts from {betrag}. Enter it under “Plan values”.",
  "GewSt 15.2., 15.5., 15.8. und 15.11.": "trade tax 15 Feb, 15 May, 15 Aug and 15 Nov",
  "GewSt-Vorauszahlungen": "Trade-tax prepayments",
  "KSt 10.3., 10.6., 10.9. und 10.12.": "corporate tax 10 Mar, 10 Jun, 10 Sep and 10 Dec",
  "KSt-Vorauszahlungen": "Corporate-tax prepayments",
  "Keine": "None",
  "Keine Fristen": "No deadlines",
  "Keine Steuertermine": "No tax dates",
  "Kontostand heute": "Balance today",
  "Kontostand-Startwert": "Starting balance",
  "Laufendes Jahr": "Current year",
  "Legende der Jahresuhr": "Year clock legend",
  "Liquiditätsplanung": "Liquidity plan",
  "Monatsdetails": "Month details",
  "Monatstabelle": "Monthly table",
  "Nächster Steuertermin": "Next tax date",
  "Planwerte": "Plan values",
  "Rechnung stellen": "Issue invoice",
  "Rechnungen raus bis": "Invoices due by",
  "Rechtsform, Zahlungsziel und Puffer ändern Sie über „Einstellungen“ oben auf der Seite.":
    "Change the legal form, payment term and buffer via “Settings” at the top of the page.",
  "Saldo Anfang": "Balance start",
  "Saldo Ende": "Balance end",
  "Schwarze Markierung: Steuerzahltag —": "Black mark: tax due date —",
  "Skala: voller Ring = {skala}": "Scale: a full ring = {skala}",
  "Spätester Rechnungsversand": "Latest invoice date",
  "Steuern": "Taxes",
  "Steuertag": "Tax date",
  "Steuertage": "Tax dates",
  "USt-Termine (monatlich)": "VAT dates (monthly)",
  "USt-Termine (vierteljährlich)": "VAT dates (quarterly)",
  "USt-Zeitraum": "VAT period",
  "eigene Frist": "own deadline",
  "erhalten": "received",
  "erwartet": "expected",
  "gebucht": "booked",
  "gedeckt": "covered",
  "in {n} Tagen": "in {n} days",
  "keine USt-Voranmeldung (Jahreserklärung)": "no VAT advance return (annual return only)",
  "knapp": "tight",
  "mit Dauerfristverlängerung": "with permanent extension",
  "noch {n} Tage": "{n} days left",
  "überfällig — zählt nicht zur Deckung": "overdue — does not count as cover",
  "überschritten": "overdue",
  "überschritten ohne Deckung": "passed without cover",
  "Graue Segmente: die 12 Monate — Januar oben, im Uhrzeigersinn": "Grey segments: the 12 months — January at the top, clockwise",
  "Füllstand: erwartete Zahlungseingänge des Monats (voller Ring = {skala}); reicht er über die Linie, ist der Monat gedeckt":
    "Fill level: expected receipts of the month (a full ring = {skala}); when it reaches past the line, the month is covered",
  "Linie: erwartete Ausgaben, Entnahmen und Steuern des Monats": "Line: expected expenses, drawings and taxes of the month",
  "Linie: erwartete Ausgaben einschließlich Geschäftsführergehalt und Steuern des Monats":
    "Line: expected expenses including the managing director's salary and taxes of the month",
  "Schraffur: ungedeckter Teil — Abflüsse höher als Eingänge": "Hatching: the uncovered part — outflows higher than receipts",
  "Rote Markierung: spätester Rechnungsversand = Steuertag − {ziel} Tage Zahlungsziel − {puffer} Tage Puffer":
    "Red mark: latest invoice date = tax date − {ziel} days payment term − {puffer} days buffer",
  "Haken: Steuertermin gedeckt": "Check mark: tax date covered",
  "Warndreieck: Deckung des Steuertermins gefährdet": "Warning triangle: the tax date's coverage is at risk",
  "Zeiger: heute (aktueller Monat)": "Pointer: today (current month)",
};
