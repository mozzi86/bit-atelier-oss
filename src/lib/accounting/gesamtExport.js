// Overall workbook of the accounting module (79-13, D-P79-26, BUCH-15): ONE
// XLSX file with one sheet per area in tab order plus the annual statement,
// built from exactly the table builders the tabs use for their own CSV/XLSX
// buttons — so the workbook and the nine tabs can never disagree. The writer
// (tabellenExport.tabellenAlsXlsx) stores amounts as numbers, dates as Excel
// serial numbers with dd.mm.yyyy, no formulas, and protects text that starts
// with "=".
//
// Sheet order (tab order of reiter.js; the sheet name is the builder's title,
// the dunning table stays a section of the invoices tab without a sheet):
//   1 Ausgangsrechnungen  ausgangTabelle      invoices with an invoice date in the year
//                                             (planned ones without a date have no year yet)
//   2 Eingangsrechnungen  ausgabenTabelle     invoice date in the year
//   3 Liquiditätsplanung  liquiditaetTabelle  monatsModell of the year
//   4 Umsatzsteuer        umsatzsteuerTabelle voranmeldungen of the year
//   5 Entnahmen           entnahmenTabelle    drawings of the year
//   6 Bank-Abgleich       bankTabelle         transactions booked in the year
//   7 Fuhrpark            fuhrparkTabelle     value of the year per car
//   8 Anlagenverzeichnis  anlagenTabelle      depreciation of the year
//   9 Jahresübersicht     euerTabelle         the EÜR; GmbH/UG: the balance-sheet hint row
//
// In:  bh.daten (13 collections), effective settings, legal rates (saetzeZum),
//      the business year, a translator and {heute, projekte} — heute always
//      comes from the caller (no wall-clock read in src/lib/accounting).
// Out: the nine table models, the XLSX bytes, the file name, the year choice.

import { ausgangTabelle } from "./ausgangsrechnungen.js";
import { ausgabenTabelle } from "./ausgaben.js";
import { liquiditaetTabelle, monatsModell } from "./liquiditaet.js";
import { umsatzsteuerTabelle, voranmeldungen } from "./umsatzsteuer.js";
import { entnahmenTabelle } from "./entnahmen.js";
import { bankTabelle } from "./abgleich.js";
import { fuhrparkTabelle } from "./fuhrpark.js";
import { anlagenTabelle } from "./anlagen.js";
import { euerTabelle } from "./euer.js";
import { tabellenAlsXlsx } from "./tabellenExport.js";

/**
 * Keys of the nine sheets in workbook order (tab keys of reiter.js, "annual"
 * last). Tests and the headless proof read the order from here.
 */
export const GESAMT_BLAETTER = Object.freeze([
  "invoices", "expenses", "liquidity", "vat", "drawings", "bank", "fleet", "assets", "annual",
]);

/** MIME type of an XLSX download. */
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** @param {unknown} v @returns {any[]} */
const liste = (v) => (Array.isArray(v) ? v : []);

/** @param {unknown} datum @param {string} jahr @returns {boolean} 'YYYY-MM-DD' lies in the year */
const imJahr = (datum, jahr) => typeof datum === "string" && datum.slice(0, 4) === jahr;

/**
 * The nine table models of one business year, in tab order.
 * @param {Record<string, any[]>} daten bh.daten
 * @param {Record<string, any>} einst effective settings (wirksameEinstellungen)
 * @param {Record<string, any>} saetze legal rates (saetzeZum)
 * @param {number|string} jahr business year, e.g. 2026
 * @param {(key: string) => string} t translator (sheet titles, column labels, enum texts)
 * @param {{heute: string, projekte?: ReadonlyArray<{id: string, name?: string}>}} kontext
 *   heute: reference day 'YYYY-MM-DD' (status of invoices, forecast of the clock and VAT);
 *   projekte: project list for project names (bh.projekte)
 * @returns {import("./tabellenExport.js").Tabellenmodell[]} exactly nine models
 * @throws {Error} plain text when jahr or heute is invalid
 */
export function gesamtModelle(daten, einst, saetze, jahr, t, kontext) {
  const jahrZahl = Number(jahr);
  if (!Number.isInteger(jahrZahl) || jahrZahl < 1900 || jahrZahl > 9999) throw new Error(`Gesamt-Export: ungültiges Jahr „${jahr}“.`);
  const heute = kontext?.heute;
  if (typeof heute !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(heute)) throw new Error(`Gesamt-Export: ungültiges Datum „${heute}“.`);
  const projekte = liste(kontext?.projekte);
  const d = daten && typeof daten === "object" ? daten : {};
  const jahrText = String(jahrZahl);

  return [
    ausgangTabelle(liste(d.Ausgangsrechnung), t, { heute, projekte }, { jahr: jahrText }),
    ausgabenTabelle(d, t, { jahr: jahrText }),
    liquiditaetTabelle(monatsModell({ daten: d, einst, saetze, jahr: jahrZahl, heute }), t),
    umsatzsteuerTabelle(voranmeldungen(jahrZahl, d, einst, saetze, heute), t),
    entnahmenTabelle(d, jahrZahl, t, einst),
    // The tab exports every transaction; a year workbook takes the transactions
    // booked in that year. The other collections stay whole, because the column
    // "Zuordnung" names the matched invoice even when it dates from another year.
    bankTabelle({ ...d, Bankumsatz: liste(d.Bankumsatz).filter((b) => imJahr(b?.buchungstag, jahrText)) }, t),
    fuhrparkTabelle(d, jahrZahl, t, saetze),
    anlagenTabelle(d, jahrZahl, t, saetze),
    euerTabelle({ daten: d, einst, saetze, jahr: jahrZahl }, t),
  ];
}

/**
 * The overall workbook of one business year as XLSX bytes (nine sheets).
 * Arguments as gesamtModelle.
 * @param {Record<string, any[]>} daten
 * @param {Record<string, any>} einst
 * @param {Record<string, any>} saetze
 * @param {number|string} jahr
 * @param {(key: string) => string} t
 * @param {{heute: string, projekte?: ReadonlyArray<{id: string, name?: string}>}} kontext
 * @returns {Uint8Array} XLSX bytes
 */
export function gesamtArbeitsmappe(daten, einst, saetze, jahr, t, kontext) {
  return tabellenAlsXlsx(gesamtModelle(daten, einst, saetze, jahr, t, kontext));
}

/**
 * File name of the overall workbook: "Buchhaltung_<Jahr>.xlsx" (the same in
 * both languages — it names the module, not a text of the page).
 * @param {number|string} jahr business year
 * @returns {string}
 */
export function gesamtDateiname(jahr) {
  return `Buchhaltung_${Number(jahr)}.xlsx`;
}

/**
 * Years the export menu offers: every year that carries a booking in the books
 * (invoice and payment dates, expenses, drawings, bank, tax payments, assets)
 * plus the year of `heute`, newest first.
 * @param {Record<string, any[]>} daten bh.daten
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number[]}
 */
export function exportJahre(daten, heute) {
  const jahre = new Set();
  /** @param {unknown} datum */
  const nimm = (datum) => { if (typeof datum === "string" && /^\d{4}-\d{2}-\d{2}/.test(datum)) jahre.add(Number(datum.slice(0, 4))); };
  const d = daten && typeof daten === "object" ? daten : {};
  for (const r of liste(d.Ausgangsrechnung)) {
    nimm(r?.rechnungsdatum);
    for (const z of liste(r?.zahlungen)) nimm(z?.datum);
  }
  for (const e of liste(d.Eingangsrechnung)) { nimm(e?.rechnungsdatum); nimm(e?.bezahlt_am); }
  for (const e of liste(d.Entnahme)) nimm(e?.datum);
  for (const b of liste(d.Bankumsatz)) nimm(b?.buchungstag);
  for (const s of liste(d.Steuerzahlung)) nimm(s?.bezahlt_am);
  for (const a of liste(d.Anlagegut)) nimm(a?.anschaffung_datum);
  nimm(heute);
  return [...jahre].filter((j) => Number.isInteger(j)).sort((a, b) => b - a);
}
