// DATEV booking-batch export — format EXTF 700 (phase 79, plan 79-11, E-11):
// header + 125-column line + one row per outgoing/incoming invoice
// ("Rechnungsbuchungen" mode — no bank bookings, see module header of
// umsatzsteuer.js for why: the tax advisor pulls bank data separately, a
// second copy here would double it). CP1252, CRLF, `;`-separated, via the
// shared encoder `kodiereCp1252` (packages/nova-core/src/lib/brief/winAnsi.js,
// 79-03) — no second encoder in this repo.
//
// SPALTEN below is the REAL 125 column names of the public reference file
// (see the header comment on the constant for source/date) — not typed by
// hand, per T3's instruction; datev-spalten-abruf.mjs re-fetches it.
//
// In:  Ausgangsrechnung/Eingangsrechnung records (datenmodell.js, Euro),
//      effective settings (datev.berater/mandant/wj_beginn, kontenrahmen),
//      a chart of accounts (einstellungen.KONTENRAHMEN), a date range.
// Out: pure functions; `exportiere()` returns bytes + file name + warnings +
//      any new client/supplier account assignments for the caller to persist
//      (this module never writes settings itself).

import { plusMonate, plusTage } from "@core/lib/kalender/datum.js";
import { kodiereCp1252 } from "@core/lib/brief/winAnsi.js";
import { KATEGORIEN, STEUERFAELLE } from "./ausgaben.js";
import { KONTENRAHMEN } from "./einstellungen.js";
import { euroZuCent } from "./geld.js";

/**
 * The 125 column names of row 2 (format version 13), decoded from the
 * public reference file's real CP1252 bytes (a plain UTF-8 fetch mangles
 * ü/ß — see datev-spalten-abruf.mjs).
 * Quelle: https://raw.githubusercontent.com/ledermann/datev/master/examples/EXTF_Buchungsstapel.csv
 * Abgerufen: 2026-09-28.
 * @type {ReadonlyArray<string>}
 */
export const SPALTEN = Object.freeze([
  "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basisumsatz", "WKZ Basisumsatz",
  "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto",
  "Buchungstext", "Postensperre", "Diverse Adressnummer", "Geschäftspartnerbank", "Sachverhalt", "Zinssperre",
  "Beleglink", "Beleginfo – Art 1", "Beleginfo – Inhalt 1", "Beleginfo – Art 2", "Beleginfo – Inhalt 2",
  "Beleginfo – Art 3", "Beleginfo – Inhalt 3", "Beleginfo – Art 4", "Beleginfo – Inhalt 4", "Beleginfo – Art 5",
  "Beleginfo – Inhalt 5", "Beleginfo – Art 6", "Beleginfo – Inhalt 6", "Beleginfo – Art 7", "Beleginfo – Inhalt 7",
  "Beleginfo – Art 8", "Beleginfo – Inhalt 8", "KOST1 – Kostenstelle", "KOST2 – Kostenstelle", "Kost Menge",
  "EU-Land u. USt-IdNr.", "EU-Steuersatz", "Abw. Versteuerungsart", "Sachverhalt L+L", "Funktionsergänzung L+L",
  "BU 49 Hauptfunktionstyp", "BU 49 Hauptfunktionsnummer", "BU 49 Funktionsergänzung", "Zusatzinformation – Art 1",
  "Zusatzinformation – Inhalt 1", "Zusatzinformation – Art 2", "Zusatzinformation – Inhalt 2",
  "Zusatzinformation – Art 3", "Zusatzinformation – Inhalt 3", "Zusatzinformation – Art 4",
  "Zusatzinformation – Inhalt 4", "Zusatzinformation – Art 5", "Zusatzinformation – Inhalt 5",
  "Zusatzinformation – Art 6", "Zusatzinformation – Inhalt 6", "Zusatzinformation – Art 7",
  "Zusatzinformation – Inhalt 7", "Zusatzinformation – Art 8", "Zusatzinformation – Inhalt 8",
  "Zusatzinformation – Art 9", "Zusatzinformation – Inhalt 9", "Zusatzinformation – Art 10",
  "Zusatzinformation – Inhalt 10", "Zusatzinformation – Art 11", "Zusatzinformation – Inhalt 11",
  "Zusatzinformation – Art 12", "Zusatzinformation – Inhalt 12", "Zusatzinformation – Art 13",
  "Zusatzinformation – Inhalt 13", "Zusatzinformation – Art 14", "Zusatzinformation – Inhalt 14",
  "Zusatzinformation – Art 15", "Zusatzinformation – Inhalt 15", "Zusatzinformation – Art 16",
  "Zusatzinformation – Inhalt 16", "Zusatzinformation – Art 17", "Zusatzinformation – Inhalt 17",
  "Zusatzinformation – Art 18", "Zusatzinformation – Inhalt 18", "Zusatzinformation – Art 19",
  "Zusatzinformation – Inhalt 19", "Zusatzinformation – Art 20", "Zusatzinformation – Inhalt 20", "Stück", "Gewicht",
  "Zahlweise", "Forderungsart", "Veranlagungsjahr", "Zugeordnete Fälligkeit", "Skontotyp", "Auftragsnummer",
  "Buchungstyp", "USt-Schlüssel (Anzahlungen)", "EU-Mitgliedstaat (Anzahlungen)", "Sachverhalt L+L (Anzahlungen)",
  "EU-Steuersatz (Anzahlungen)", "Erlöskonto (Anzahlungen)", "Herkunft-Kz", "Leerfeld", "KOST-Datum",
  "SEPA-Mandatsreferenz", "Skontosperre", "Gesellschaftername", "Beteiligtennummer", "Identifikationsnummer",
  "Zeichnernummer", "Postensperre bis", "Bezeichnung", "Kennzeichen", "Festschreibung", "Leistungsdatum",
  "Datum Zuord.", "Fälligkeit", "Generalumkehr", "Steuersatz", "Land", "Abrechnungsreferent", "BVV-Position",
  "EU-Mitgliedstaat u. UStID (Ursprung)", "EU-Steuersatz (Ursprung)", "Abw. Skontokonto",
]);

/** Field count contract (never touch without re-checking every row builder below). */
const FELDANZAHL = 125;

/** @param {string} iso 'YYYY-MM-DD' @returns {string} "JJJJMMTT" (no separators) */
const kompakt = (iso) => iso.replace(/-/g, "");

/** @param {string} iso 'YYYY-MM-DD' @returns {string} "TTMM" (day, month — the reference file's own order, year from the header) */
const belegdatum = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;

/** German decimal-comma amount with two places, no thousands separator (e.g. 1234.5 → "1234,50"). @param {number} betragCent */
const umsatzText = (betragCent) => (Math.abs(betragCent) / 100).toFixed(2).replace(".", ",");

/** Allowed Belegfeld-1 charset (DATEV EXTF spec, `[ASSUMED]` — not read from an official field list). */
const BELEGFELD_ZEICHEN = /[^A-Z0-9$&%*+\-/]/g;

/**
 * Belegfeld 1 (invoice number as the booking's own reference), sanitised and
 * capped at 36 characters — an unusual character silently drops rather than
 * blocking the whole export (this is a reference number, not money).
 * @param {unknown} text
 * @returns {string}
 */
function belegfeld1(text) {
  return String(text ?? "").toUpperCase().replace(BELEGFELD_ZEICHEN, "").slice(0, 36);
}

/** Buchungstext, capped at 60 characters (field 14). @param {unknown} text */
const buchungstext = (text) => String(text ?? "").slice(0, 60);

/** KOST1 (project id), capped at 36 characters (field 37). @param {unknown} text */
const kost1 = (text) => String(text ?? "").slice(0, 36);

/**
 * Next free account number in a range that is not yet used by `vergeben`.
 * @param {number} von range start (inclusive)
 * @param {Set<number>} vergeben already-assigned numbers (any range)
 * @returns {number}
 */
function naechsteNummer(von, vergeben) {
  let n = von;
  while (vergeben.has(n)) n++;
  return n;
}

/**
 * The 31-field header line ("Kopfzeile"). All `[ASSUMED]` beyond the format
 * constants themselves (GESETZ.DATEV.kopf, einstellungen.js) — the office
 * confirms field 9 ("exportiert von") and 27 (chart-of-accounts marker) with
 * its tax advisor before productive use (comment mirrors GESETZ.DATEV.kopf's
 * own annahme note).
 * @param {{kopf: Record<string, any>, exportiertVon: string, berater: string, mandant: string,
 *   wjBeginn: string, von: string, bis: string, skr: "03"|"04", zeitstempel: string}} meta
 *   `wjBeginn` 'YYYY-MM-DD' (the fiscal year's own start, already resolved to a calendar date);
 *   `zeitstempel` 'JJJJMMTTHHMMSSmmm' (17 digits, injectable for a reproducible golden file)
 * @returns {string} the header line, `;`-joined, no trailing CRLF
 */
export function kopfzeile(meta) {
  const k = meta.kopf;
  const bezeichnung = `Buchungsstapel ${meta.von}–${meta.bis}`.slice(0, 30);
  const exportiertVon = String(meta.exportiertVon || "").slice(0, 30);
  const felder = [
    `"${k.kennzeichen}"`, String(k.versionsnummer), String(k.formatkategorie), `"${k.formatname}"`, String(k.formatversion),
    meta.zeitstempel, "", `"${k.herkunft}"`, `"${exportiertVon}"`, "",
    meta.berater, meta.mandant, kompakt(meta.wjBeginn), String(k.sachkontenlaenge), kompakt(meta.von), kompakt(meta.bis),
    `"${bezeichnung}"`, "", "1", "", String(k.festschreibung), `"${k.waehrung}"`, "", "", "", "", `"${meta.skr}"`, "", "", "", "",
  ];
  return felder.join(";");
}

/**
 * Booking rows ("Rechnungsbuchungen" mode): one row per outgoing invoice
 * (Debitor an Erlöskonto) and one per incoming invoice except category
 * "personal" (Aufwandskonto an Kreditor — payroll bookings are the payroll
 * office's job, KATEGORIEN.personal.datev === false keeps them out of the
 * batch, only counted as a warning). Filtered by INVOICE date (accrual —
 * DATEV bookkeeping is not tied to the office's own Ist/Soll VAT choice),
 * not by payment date. No AfA, no 1 %-rule values, no bank bookings.
 * @param {Record<string, any[]>} daten bh.daten
 * @param {{von: string, bis: string, einst: Record<string, any>, kontenrahmen: Record<string, any>}} eingabe
 * @returns {{zeilen: string[], warnungLohnbuchungen: number, personenkontenNeu: Record<string, number>}}
 *   `zeilen`: each already `;`-joined with exactly 125 fields, no CRLF;
 *   `personenkontenNeu`: only the NEWLY assigned client/supplier accounts —
 *   the caller persists them into `einst.datev.personenkonten` (this module
 *   never writes settings itself, see module header)
 */
export function buchungszeilen(daten, { von, bis, einst, kontenrahmen: k }) {
  const bekannt = { ...(einst?.datev?.personenkonten || {}) };
  /** @type {Record<string, number>} */
  const neu = {};
  const vergebenDebitor = new Set(Object.entries(bekannt).filter(([key]) => key.startsWith("debitor:")).map(([, v]) => Number(v)));
  const vergebenKreditor = new Set(Object.entries(bekannt).filter(([key]) => key.startsWith("kreditor:")).map(([, v]) => Number(v)));

  /** @param {string} name @returns {number} */
  const debitorKonto = (name) => {
    const key = `debitor:${name}`;
    if (bekannt[key] != null) return Number(bekannt[key]);
    const konto = naechsteNummer(k.debitoren_von, vergebenDebitor);
    vergebenDebitor.add(konto); bekannt[key] = konto; neu[key] = konto;
    return konto;
  };
  /** @param {string} name @returns {number} */
  const kreditorKonto = (name) => {
    const key = `kreditor:${name}`;
    if (bekannt[key] != null) return Number(bekannt[key]);
    const konto = naechsteNummer(k.kreditoren_von, vergebenKreditor);
    vergebenKreditor.add(konto); bekannt[key] = konto; neu[key] = konto;
    return konto;
  };

  /** @param {number} n @returns {string[]} n empty fields */
  const leer = (n) => Array.from({ length: n }, () => "");

  /** @type {string[]} */
  const zeilen = [];

  for (const r of Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : []) {
    if (r?.status !== "gestellt" && r?.status !== "storniert") continue;
    const datum = r?.rechnungsdatum;
    if (!datum || datum < von || datum > bis) continue;
    const bruttoCent = euroZuCent(r.brutto);
    if (bruttoCent === 0) continue;
    const storno = bruttoCent < 0;
    const konto = debitorKonto(r?.empfaenger?.name || r.id);
    const gegenkonto = Number(r?.ust_satz) === 7 ? k.erloese_7 : k.erloese_19;
    // Fields 1–14 explicit (Umsatz…Buchungstext), 15–36 unused by this mode, 37 KOST1, 38–125 unused.
    const felder = [
      umsatzText(bruttoCent), storno ? '"H"' : '"S"', "", "", "", "", String(konto), String(gegenkonto), "",
      belegdatum(datum), `"${belegfeld1(r.nummer || r.id)}"`, "", "", `"${buchungstext(r.project_name || r?.empfaenger?.name)}"`,
      ...leer(22), kost1(r.project_id), ...leer(FELDANZAHL - 37),
    ];
    zeilen.push(felder.join(";"));
  }

  let warnungLohnbuchungen = 0;
  for (const e of Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : []) {
    if (e?.anlage_id) continue; // capitalised — only its AfA counts, not a batch row
    const datum = e?.rechnungsdatum || e?.leistungsdatum;
    if (!datum || datum < von || datum > bis) continue;
    if (e?.kategorie === "personal") { warnungLohnbuchungen++; continue; } // KATEGORIEN.personal.datev === false
    const bruttoCent = euroZuCent(e.brutto);
    if (bruttoCent === 0) continue;
    const storno = bruttoCent < 0;
    const kontoSchluessel = KATEGORIEN[e?.kategorie]?.konto || "sonstiges";
    const konto = k[kontoSchluessel] ?? k.sonstiges;
    const gegenkonto = kreditorKonto(e?.lieferant || e.id);
    const bu = STEUERFAELLE[e?.steuerfall]?.bu;
    const felder = [
      umsatzText(bruttoCent), storno ? '"H"' : '"S"', "", "", "", "", String(konto), String(gegenkonto),
      bu ? `"${bu}"` : "", belegdatum(datum), `"${belegfeld1(e.fremd_nr || "")}"`, "", "", `"${buchungstext(e.lieferant)}"`,
      ...leer(22), kost1(e.project_id), ...leer(FELDANZAHL - 37),
    ];
    zeilen.push(felder.join(";"));
  }

  return { zeilen, warnungLohnbuchungen, personenkontenNeu: neu };
}

/**
 * Blocking reasons that must clear before a download is offered.
 * @param {{berater?: string, mandant?: string, wjBeginn?: string}} meta
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {string[]} "berater_fehlt" | "mandant_fehlt" | "zeitraum_wirtschaftsjahr"
 */
export function pruefe(meta, von, bis) {
  /** @type {string[]} */
  const gruende = [];
  if (!meta?.berater) gruende.push("berater_fehlt");
  if (!meta?.mandant) gruende.push("mandant_fehlt");
  const wjBeginn = typeof meta?.wjBeginn === "string" && /^\d{2}-\d{2}$/.test(meta.wjBeginn) ? meta.wjBeginn : "01-01";
  const vonJahr = von.slice(0, 4);
  let wjStart = `${vonJahr}-${wjBeginn}`;
  if (wjStart > von) wjStart = `${Number(vonJahr) - 1}-${wjBeginn}`;
  const wjEnde = /** @type {string} */ (plusTage(/** @type {string} */ (plusMonate(wjStart, 12)), -1));
  if (von < wjStart || bis > wjEnde) gruende.push("zeitraum_wirtschaftsjahr");
  return gruende;
}

/**
 * The full export: header, column line, booking rows, CP1252 bytes. Runs
 * even when `pruefe()` would block — the CALLER (DatevExportAbschnitt.jsx)
 * decides whether to offer the download; this function stays a pure builder.
 * @param {{daten: Record<string, any[]>, einst: Record<string, any>, saetze: Record<string, any>,
 *   von: string, bis: string, exportiertVon: string, zeitstempel: string}} eingabe
 *   `saetze`: saetzeZum(…) (reads `.datev.kopf` and the resolved `.kontenrahmen.SKR03/04`);
 *   `zeitstempel`: 'JJJJMMTTHHMMSSmmm' (injectable so a golden-file test is reproducible;
 *   production callers build it from `new Date()`)
 * @returns {{bytes: Uint8Array, dateiname: string, warnungen: {ersetzt: number, lohnbuchungen: number},
 *   personenkontenNeu: Record<string, number>}}
 */
export function exportiere({ daten, einst, saetze, von, bis, exportiertVon, zeitstempel }) {
  const skrName = einst?.kontenrahmen === "SKR04" ? "SKR04" : "SKR03";
  const kontenrahmen = saetze?.kontenrahmen?.[skrName];
  const kopfzeileText = kopfzeile({
    kopf: saetze?.datev?.kopf, exportiertVon, berater: einst?.datev?.berater || "", mandant: einst?.datev?.mandant || "",
    wjBeginn: `${von.slice(0, 4)}-${einst?.datev?.wj_beginn || "01-01"}`, von, bis, skr: skrName === "SKR04" ? "04" : "03", zeitstempel,
  });
  const { zeilen, warnungLohnbuchungen, personenkontenNeu } = buchungszeilen(daten, { von, bis, einst, kontenrahmen });
  const zeilenText = [kopfzeileText, SPALTEN.map((s) => `"${s}"`).join(";"), ...zeilen];
  // Every LINE is encoded on its own (kodiereCp1252 only maps printable ASCII/Latin-1/the
  // CP1252 high range — CR/LF are control characters below 0x20 and would themselves be
  // replaced with "?" if fed through the encoder as part of one long string); the CRLF line
  // ending is appended afterwards as its own two raw bytes (0x0D 0x0A — the same value in
  // CP1252 as in ASCII, so this never corrupts the encoding).
  let ersetzt = 0;
  const teile = zeilenText.map((zeile) => {
    const codiert = kodiereCp1252(zeile);
    ersetzt += codiert.ersetzt;
    return codiert.bytes;
  });
  const crlf = Uint8Array.of(0x0d, 0x0a);
  const gesamtlaenge = teile.reduce((n, t) => n + t.length + crlf.length, 0);
  const bytes = new Uint8Array(gesamtlaenge);
  let pos = 0;
  for (const teil of teile) { bytes.set(teil, pos); pos += teil.length; bytes.set(crlf, pos); pos += crlf.length; }
  return {
    bytes, dateiname: `EXTF_Buchungsstapel_${von}_${bis}.csv`,
    warnungen: { ersetzt, lohnbuchungen: warnungLohnbuchungen }, personenkontenNeu,
  };
}

/**
 * German text of one pruefe() blocking reason (literal t() calls for the i18n guard).
 * @param {string} schluessel
 * @param {(k: string) => string} t
 * @returns {string}
 */
export function sperrgrundText(schluessel, t) {
  if (schluessel === "berater_fehlt") return t("Beraternummer fehlt");
  if (schluessel === "mandant_fehlt") return t("Mandantennummer fehlt");
  if (schluessel === "zeitraum_wirtschaftsjahr") return t("Zeitraum überschreitet das Wirtschaftsjahr");
  return schluessel;
}

// Re-exported so callers (DatevExportAbschnitt.jsx) need only this module for the chart-of-
// accounts choice, without importing einstellungen.js's KONTENRAHMEN separately.
export { KONTENRAHMEN };
