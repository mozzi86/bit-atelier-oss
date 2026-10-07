// Besitzer: 79-11 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Jahresübersicht, EÜR und DATEV (Spur B)".
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
  "Zeile": "Line",
  "Gewinn": "Profit",
  // "Vorjahr" is shared with the year clock (79-10) and lives in buchhaltung-fundament.js.
  "Keine Vorjahreswerte erfasst": "No prior-year figures on file",
  "Vorjahresgewinn": "Prior-year profit",
  "Gewinnzuordnung": "Profit allocation",
  "Gewinn der Inhaberin: 100 %": "Owner's profit: 100 %",
  "Zu den Entnahmen": "Go to drawings",
  "Brutto-Methode wie Anlage EÜR (§ 4 Abs. 3 EStG, Zufluss/Abfluss § 11 EStG)":
    "Gross method as in the official Anlage EÜR (§ 4 (3) EStG, cash basis § 11 EStG)",
  "bilanziert, keine EÜR (§§ 238, 242 HGB i. V. m. § 13 Abs. 3 GmbHG) — die Bilanz erstellt der Steuerberater":
    "Keeps books, no EÜR (§§ 238, 242 HGB in conjunction with § 13 (3) GmbHG) — the tax advisor prepares the balance sheet",
  // "Zusätzlich: 25 % … GmbHG)." already has an English entry in buchhaltung-entnahmen.js (79-06's own UG
  // rücklage hint, same wording) — reused as-is, not repeated here.

  // euer.js line and hint labels
  "Betriebseinnahmen (netto)": "Business income (net)",
  "vereinnahmte Umsatzsteuer": "VAT collected",
  "Nutzungsentnahme Kfz (netto)": "Car private-use withdrawal (net)",
  "Nutzungsentnahme Kfz, USt": "Car private-use withdrawal, VAT",
  "Umsatzsteuererstattungen": "VAT refunds",
  "Löhne und Gehälter": "Wages and salaries",
  // "Kilometergeld" already has an English entry in buchhaltung-fuhrpark.js — reused as-is.
  "gezahlte Umsatzsteuer": "VAT paid",
  "Gewerbesteuer (nicht abziehbar, § 4 Abs. 5b EStG)": "Trade tax (non-deductible, § 4 (5b) EStG)",
  "Abschreibungen (AfA)": "Depreciation",
  "netto": "net",
  "Der Gewinn wird gesondert und einheitlich festgestellt (§ 180 Abs. 1 S. 1 Nr. 2 Buchst. a AO).":
    "The profit is assessed separately and uniformly (§ 180 (1) sentence 1 no. 2(a) AO).",
  "Umsatz oder Gewinn über der Buchführungsgrenze — Buchführungspflicht mit dem Steuerberater prüfen (§ 141 AO).":
    "Turnover or profit above the bookkeeping threshold — check the bookkeeping duty with the tax advisor (§ 141 AO).",
  "Bilanzierungspflicht — keine EÜR (UG zusätzlich: 25 % Rücklage, § 5a Abs. 3 GmbHG)":
    "Balance-sheet duty — no EÜR (UG additionally: 25 % reserve, § 5a (3) GmbHG)",
  "Bilanzierungspflicht — keine EÜR (§§ 238, 242 HGB i. V. m. § 13 Abs. 3 GmbHG)":
    "Balance-sheet duty — no EÜR (§§ 238, 242 HGB in conjunction with § 13 (3) GmbHG)",

  // DatevExportAbschnitt.jsx
  "DATEV-Export für den Steuerberater": "DATEV export for the tax advisor",
  "Beraternummer": "Consultant number",
  "Mandantennummer": "Client number",
  "Wirtschaftsjahr-Beginn (MM-TT)": "Fiscal-year start (MM-DD)",
  "Ganzes Jahr": "Whole year",
  "Quartal": "Quarter",
  // "Monat" already has an English entry in buchhaltung-fuhrpark.js — reused as-is, not repeated here.
  "{n} Buchungen, {m} Warnungen": "{n} bookings, {m} warnings",
  "DATEV-Buchungsstapel herunterladen": "Download DATEV booking batch",
  "Vor produktiver Nutzung Probeimport beim Steuerberater; keine Bankbuchungen im Stapel.":
    "Before productive use, run a trial import with the tax advisor; no bank bookings in the batch.",
  "ersetzte Zeichen": "characters replaced",
  "Lohnbuchungen nicht im Stapel": "payroll bookings not in the batch",
  "DATEV-Export erstellt": "DATEV export created",
  "Beraternummer fehlt": "Consultant number missing",
  "Mandantennummer fehlt": "Client number missing",
  "Zeitraum überschreitet das Wirtschaftsjahr": "Period exceeds the fiscal year",
};
