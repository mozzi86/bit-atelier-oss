// The ONE settings file of the accounting module (phase 79): every legal rate,
// threshold and date the office books rely on, dated and with its source, plus
// the office defaults (BUERO_STANDARD) that Setting{key:"buchhaltung"} may override.
//
// Maintenance rule: when a law changes, add a NEW row with its `ab` date here (or
// in @core/lib/hoai/tafel2021.js for fee tables) — the old row stays, so books of
// earlier years keep computing with the rate that applied then.
//
// In:  the two HOAI data files of @core (the only imports; they are passed through
//      under GESETZ.HOAI so the app has one entry point for all rates).
// Out: GESETZ, KONTENRAHMEN, BUERO_STANDARD, BUERO_HERKUNFT, ANNAHMEN and the
//      helpers saetzeZum, wirksameEinstellungen, alsRegeln, eGrenzeFuer,
//      hybridReichweiteFuer, basiszinsAm, veralteteWerte. Everything is deep-frozen.
//
// Row shape of every table: { ab: 'YYYY-MM-DD', wert, quelle, annahme?: true, grund? }.
// Rows are picked by date with a plain string comparison of 'YYYY-MM-DD'.
// `annahme: true` marks an [ASSUMED] value: not fetched from the official text,
// listed in ANNAHMEN and shown with a marker in the UI.
//
// Every calculation receives `saetze` (saetzeZum(stichtag)) injected, so no test
// depends on today's law or today's date.

import { GEPRUEFT_AM, GILT_AB, QUELLE as HOAI_QUELLE, TAFEL_FREIANLAGEN, TAFEL_GEBAEUDE_INNENRAEUME } from "@core/lib/hoai/tafel2021.js";
import { KG400_REGEL, LPH, PUNKTE_ZONEN_P35, UMBAU_MAX_PROZENT } from "@core/lib/hoai/leistungsbilder.js";

/** Date this file was checked against the sources ('YYYY-MM-DD'). */
export const STAND = "2026-09-27";

/**
 * Earliest date the app models ('YYYY-MM-DD'). A row starting here was in force
 * before; its exact start date does not matter for books kept in this app.
 */
export const SEIT_JEHER = "2000-01-01";

/**
 * One dated table row.
 * @typedef {{ab: string, wert: any, quelle: string, annahme?: boolean, grund?: string}} Zeile
 */

/**
 * @param {string} ab 'YYYY-MM-DD'
 * @param {any} wert
 * @param {string} quelle
 * @param {{annahme?: boolean, grund?: string}} [extra]
 * @returns {Zeile}
 */
const z = (ab, wert, quelle, extra = {}) => ({ ab, wert, quelle, ...extra });

const BUNDESBANK = "Deutsche Bundesbank, Basiszinssatz nach § 247 BGB (abgerufen 27.09.2026)";

/**
 * Deep freeze for plain data.
 * @template T
 * @param {T} wert
 * @returns {T}
 */
function deepFreeze(wert) {
  if (wert && typeof wert === "object" && !Object.isFrozen(wert)) {
    for (const k of Object.keys(wert)) deepFreeze(/** @type {any} */ (wert)[k]);
    Object.freeze(wert);
  }
  return wert;
}

/**
 * Legal values — changeable only by commit, shown read-only in the UI with
 * source and date.
 */
export const GESETZ = deepFreeze({
  STEUERTERMINE: {
    // Due dates as 'MM-DD'; the year is added by steuertermine.js.
    est: [z(SEIT_JEHER, ["03-10", "06-10", "09-10", "12-10"], "§ 37 Abs. 1 EStG")],
    kst: [z(SEIT_JEHER, ["03-10", "06-10", "09-10", "12-10"], "§ 31 Abs. 1 KStG i. V. m. § 37 Abs. 1 EStG")],
    // Deliberately differs from the user's brief (10.3./6./9./12.): trade tax
    // prepayments are due on 15.2./15.5./15.8./15.11., § 19 Abs. 1 GewStG.
    gewst: [z(SEIT_JEHER, ["02-15", "05-15", "08-15", "11-15"], "§ 19 Abs. 1 GewStG")],
    // VAT return and payment: 10th day after the end of the return period (days).
    ust: [z(SEIT_JEHER, 10, "§ 18 Abs. 1 S. 1 UStG (abgerufen 27.09.2026)")],
    // Permanent extension of the VAT deadline (Dauerfristverlängerung), months.
    dauerfrist_monate: [z(SEIT_JEHER, 1, "§§ 46–48 UStDV")],
    // Special prepayment of monthly filers with extension: 1/11 of last year's
    // prepayments, due 10.02., credited in the December return.
    svz: [z(SEIT_JEHER, { anteil_elftel: 1, faellig: "02-10", anrechnung_monat: 12 }, "§ 47 Abs. 1 UStDV")],
    // Due date on Saturday, Sunday or public holiday → next working day.
    werktagsregel: [z(SEIT_JEHER, "naechster_werktag", "§ 108 Abs. 3 AO")],
  },
  // Nation-wide public holidays (keys as in @core/lib/kalender/feiertage.js).
  FEIERTAGE_BUND: [z(SEIT_JEHER, [
    "neujahr", "karfreitag", "ostermontag", "tag_der_arbeit", "christi_himmelfahrt",
    "pfingstmontag", "tag_der_deutschen_einheit", "weihnachtstag_1", "weihnachtstag_2",
  ], "Feiertagsgesetze der Länder (in allen Ländern gleich); Ostern nach Gauß", {
    annahme: true, grund: "nur bundeseinheitliche Feiertage; Landesfeiertage (z. B. 15.08. in Teilen Bayerns) fehlen — Länderwahl folgt",
  })],
  UST: {
    // Rates in percent.
    saetze: [z("2007-01-01", { regel: 19, ermaessigt: 7, nullsatz: 0 }, "§ 12 Abs. 1–3 UStG")],
    // Monthly returns when last year's VAT exceeded this amount (Euro). The value
    // was fetched; the start date 2025-01-01 (raised from 7,500 € by the
    // Wachstumschancengesetz) is [ASSUMED] from memory.
    quartalsgrenze: [z("2025-01-01", 9000, "§ 18 Abs. 2 S. 2 UStG (abgerufen 27.09.2026)")],
    // No returns at all when last year's VAT was at most this amount (Euro); start date as above.
    befreiung_voranmeldung: [z("2025-01-01", 2000, "§ 18 Abs. 2 S. 3 UStG (abgerufen 27.09.2026)")],
    // Cash accounting allowed up to this prior-year turnover (Euro); freelancers
    // may use it regardless (Nr. 3), GmbH/UG not (they keep books).
    ist_grenze: [z("2024-01-01", 800000, "§ 20 S. 1 Nr. 1 UStG", {
      annahme: true, grund: "Wert und Wortlaut von Nr. 3 (Freiberufler) nicht abgerufen — prüfen",
    })],
    // "jahr" = no advance returns, annual return only (final payment one month
    // after filing, § 18 Abs. 4 UStG — no fixed date, so no clock mark).
    zeitraeume: [z(SEIT_JEHER, ["monat", "quartal", "jahr"], "§ 18 Abs. 1–4 UStG")],
  },
  GEWST: {
    // Legal forms that are a trade by law (always subject to trade tax).
    kraft_rechtsform: [z(SEIT_JEHER, ["gmbh", "ug"], "§ 2 Abs. 2 GewStG")],
    // Allowance for natural persons and partnerships (Euro) — hint text only, no calculation.
    freibetrag: [z(SEIT_JEHER, 24500, "§ 11 Abs. 1 S. 3 Nr. 1 GewStG", {
      annahme: true, grund: "nicht abgerufen; nur Hinweistext, keine Berechnung",
    })],
  },
  BUCHFUEHRUNG: {
    // Bookkeeping thresholds for commercial sole traders/partnerships (Euro) — hint only.
    grenzen_141_ao: [z("2024-01-01", { umsatz: 800000, gewinn: 80000 }, "§ 141 Abs. 1 AO i. d. F. Wachstumschancengesetz", {
      annahme: true, grund: "Stand 2024 nicht abgerufen — prüfen",
    })],
  },
  VERZUG: {
    // Base rate in percent; changes on 01.01. and 01.07.
    basiszins: [
      z("2024-01-01", 3.62, BUNDESBANK),
      z("2024-07-01", 3.37, BUNDESBANK),
      z("2025-01-01", 2.27, BUNDESBANK),
      z("2025-07-01", 1.27, BUNDESBANK),
      z("2026-01-01", 1.27, BUNDESBANK),
      z("2026-07-01", 1.52, BUNDESBANK),
    ],
    // Next announced change of the base rate ('YYYY-MM-DD'); veralteteWerte() warns from then on.
    naechste_aenderung: "2027-01-01",
    // Default interest above the base rate, percentage points.
    pp_verbraucher: [z(SEIT_JEHER, 5, "§ 288 Abs. 1 S. 2 BGB")],
    pp_unternehmer: [z(SEIT_JEHER, 9, "§ 288 Abs. 2 BGB")],
    // Flat fee in Euro, only when the debtor is not a consumer (also for instalments).
    pauschale: [z(SEIT_JEHER, 40, "§ 288 Abs. 5 BGB")],
    // Default at the latest this many days after due date and receipt (consumers only with a notice on the invoice).
    verzug_30_tage: [z(SEIT_JEHER, 30, "§ 286 Abs. 3 BGB")],
    // Interest days per year (act/365), interest from the day after default began.
    tage_jahr: [z(SEIT_JEHER, 365, "Praxis (act/365)", {
      annahme: true, grund: "Zählweise gesetzlich nicht festgelegt",
    })],
  },
  DIENSTWAGEN: {
    // Private use per month in percent of the list price (1 % rule).
    pauschal_prozent: [z(SEIT_JEHER, 1, "§ 6 Abs. 1 Nr. 4 S. 2 EStG")],
    // Commute: percent of the list price per distance kilometre and month.
    entfernung_prozent: [z(SEIT_JEHER, 0.03, "§ 8 Abs. 2 S. 3 EStG")],
    // List price rounded down to full 100 € (Euro), after the reduction to ¼ or ½.
    blp_abrundung: [z(SEIT_JEHER, 100, "BMF-Schreiben vom 05.11.2021", {
      annahme: true, grund: "Reihenfolge Abrundung nach Minderung auf ¼ bzw. ½ prüfen",
    })],
    // ¼ rule for electric cars up to this list price (Euro), by ACQUISITION date.
    e_grenzen: [
      z("2019-01-01", 40000, "§ 52 Abs. 12 EStG (Staffel)", { annahme: true, grund: "Staffel vor 07/2025 nicht abgerufen" }),
      z("2020-01-01", 60000, "§ 52 Abs. 12 EStG (Staffel)", { annahme: true, grund: "Staffel vor 07/2025 nicht abgerufen" }),
      z("2024-01-01", 70000, "§ 52 Abs. 12 EStG (Staffel)", { annahme: true, grund: "Staffel vor 07/2025 nicht abgerufen" }),
      z("2025-07-01", 100000, "§ 6 Abs. 1 Nr. 4 S. 2 Nr. 3 EStG (abgerufen 27.09.2026)"),
    ],
    // Latest acquisition date for the reduced rates ('YYYY-MM-DD').
    e_bis: [z("2019-01-01", "2030-12-31", "§ 6 Abs. 1 Nr. 4 S. 2 Nr. 3 EStG")],
    // ½ rule for plug-in hybrids: minimum electric range in km, by acquisition date.
    hybrid_reichweite: [
      z("2019-01-01", 40, "§ 6 Abs. 1 Nr. 4 S. 2 Nr. 2 EStG", { annahme: true, grund: "40 km nicht abgerufen" }),
      z("2022-01-01", 60, "§ 6 Abs. 1 Nr. 4 S. 2 Nr. 5 EStG (abgerufen 27.09.2026)"),
      z("2025-01-01", 80, "§ 6 Abs. 1 Nr. 4 S. 2 Nr. 5 EStG (abgerufen 27.09.2026)"),
    ],
    // … or CO₂ emissions of at most this many g/km.
    hybrid_co2_max: [z("2019-01-01", 50, "§ 6 Abs. 1 Nr. 4 S. 2 Nr. 2 und 5 EStG")],
  },
  REISEKOSTEN: {
    // Business trip with a private car, Euro per km.
    km_satz: [z(SEIT_JEHER, 0.3, "§ 9 Abs. 1 S. 3 Nr. 4a EStG", { annahme: true, grund: "Stand 2026 nicht abgerufen" })],
  },
  AFA: {
    // Low-value assets: immediate write-off up to this net amount (Euro).
    gwg_grenze: [z("2018-01-01", 800, "§ 6 Abs. 2 S. 1 EStG")],
    // Up to this net amount no register is needed (Euro).
    sofort_grenze: [z("2018-01-01", 250, "§ 6 Abs. 2 S. 4 EStG")],
    // Pool item: net amount above `von` up to `bis` (Euro), written off over `jahre` years.
    sammelposten: [z("2018-01-01", { von: 250, bis: 1000, jahre: 5 }, "§ 6 Abs. 2a EStG")],
    // Useful life in years per asset category.
    nd_tabelle: [z("2021-01-01", {
      rechner: 1, software: 1, plotter: 7, bueromoebel: 13, bueroausstattung: 13, fahrzeug: 6, sonstiges: 5,
    }, "BMF-Schreiben vom 22.02.2022 (digitale Wirtschaftsgüter 1 Jahr), AfA-Tabelle AV", {
      annahme: true, grund: "nur 1 Jahr für Rechner/Software belegt; übrige Nutzungsdauern aus der AfA-Tabelle nicht abgerufen",
    })],
    // Straight-line, pro rata by month in the year of acquisition.
    pro_rata: [z(SEIT_JEHER, "monatsgenau", "§ 7 Abs. 1 S. 4 EStG")],
  },
  AUFBEWAHRUNG: {
    // Retention periods in years.
    buchungsbelege_jahre: [
      z(SEIT_JEHER, 10, "§ 147 Abs. 3 AO a. F.", { annahme: true, grund: "Übergangsregel BEG IV prüfen" }),
      z("2025-01-01", 8, "§ 147 Abs. 3 AO i. d. F. BEG IV", { annahme: true, grund: "Übergangsregel BEG IV prüfen" }),
    ],
    buecher_jahre: [z(SEIT_JEHER, 10, "§ 147 Abs. 3 AO i. d. F. BEG IV", { annahme: true, grund: "Übergangsregel BEG IV prüfen" })],
  },
  // HOAI 2021, passed through from @core/lib/hoai/* (shared with phase 81).
  HOAI: {
    fassung: [z(GILT_AB, "HOAI 2021", "https://www.gesetze-im-internet.de/hoai_2013/")],
    // Rows [anrechenbare Kosten in Euro, six zone bounds in Euro].
    tafel_gebaeude_innenraeume: [z(GILT_AB, TAFEL_GEBAEUDE_INNENRAEUME, HOAI_QUELLE.p35)],
    tafel_freianlagen: [z(GILT_AB, TAFEL_FREIANLAGEN, HOAI_QUELLE.p40)],
    // Work-stage shares in percent per profile.
    lph: [z(GILT_AB, LPH, "§ 34 Abs. 3, § 39 Abs. 3 HOAI")],
    kg400: [z(GILT_AB, KG400_REGEL, HOAI_QUELLE.p33)],
    umbau_max_prozent: [z(GILT_AB, UMBAU_MAX_PROZENT, HOAI_QUELLE.p36, {
      annahme: true, grund: "Freianlagen 33 % nicht abgerufen (§ 40 Abs. 6); Gebäude 33 %, Innenräume 50 % belegt",
    })],
    punkte_zonen_p35: [z(GILT_AB, PUNKTE_ZONEN_P35, "§ 35 Abs. 6 HOAI")],
    geprueft_am: GEPRUEFT_AM,
  },
  DATEV: {
    // Header constants of the EXTF booking batch (format 700).
    kopf: [z(SEIT_JEHER, {
      kennzeichen: "EXTF", versionsnummer: 700, formatkategorie: 21, formatname: "Buchungsstapel",
      formatversion: 13, herkunft: "BA", sachkontenlaenge: 4, festschreibung: 0, waehrung: "EUR", skr_position: 27,
    }, "DATEV-Format EXTF 700, öffentliches Beispiel (ledermann/datev)", {
      annahme: true, grund: "Spezifikation nicht lesbar; vor produktiver Nutzung Probeimport beim Steuerberater",
    })],
  },
});

/**
 * Charts of accounts (account numbers) for the DATEV export. All [ASSUMED]:
 * taken from a public example, overridable per office. Category `personal`
 * (wages, managing director's salary, E-04) only maps to an account — payroll
 * bookings come from the payroll office and are not part of the batch.
 */
export const KONTENRAHMEN = deepFreeze({
  SKR03: [z(SEIT_JEHER, {
    bank: 1200, kasse: 1000, debitoren_von: 10000, debitoren_bis: 69999, kreditoren_von: 70000, kreditoren_bis: 99999,
    erloese_19: 8400, erloese_7: 8300, miete: 4210, versicherung: 4360, kammer: 4380, software: 4964, fahrzeug: 4530,
    sonstiges: 4900, fremdleistungen: 3100, reisekosten_km: 4673, personal: 4120, gewst: 4320, afa: 4830, afa_kfz: 4832,
    gwg: 4855, privat: 1800, ust_19: 1776, ust_7: 1771, vst_19: 1576, vst_7: 1571, ust_vorauszahlung: 1780,
    bu_vst_19: "9", bu_vst_7: "8", bu_13b: "94",
  }, "DATEV SKR03, öffentliches Beispiel", { annahme: true, grund: "Kontenrahmen nicht amtlich; mit dem Steuerberater abstimmen" })],
  SKR04: [z(SEIT_JEHER, {
    bank: 1800, kasse: 1600, debitoren_von: 10000, debitoren_bis: 69999, kreditoren_von: 70000, kreditoren_bis: 99999,
    erloese_19: 4400, erloese_7: 4300, miete: 6310, versicherung: 6400, kammer: 6420, software: 6837, fahrzeug: 6520,
    sonstiges: 6300, fremdleistungen: 5900, reisekosten_km: 6668, personal: 6020, gewst: 7610, afa: 6220, afa_kfz: 6222,
    gwg: 6260, privat: 2100, ust_19: 3806, ust_7: 3801, vst_19: 1406, vst_7: 1401, ust_vorauszahlung: 3820,
    bu_vst_19: "9", bu_vst_7: "8", bu_13b: "94",
  }, "DATEV SKR04, aus SKR03 übertragen", { annahme: true, grund: "zweites Preset, vollständig ungeprüft; mit dem Steuerberater abstimmen" })],
});

/**
 * Office defaults. Setting{key:"buchhaltung"}.value overrides them through
 * wirksameEinstellungen(). The key list is the whitelist of the Setting row in
 * 79-RESEARCH "Datenmodell" (plus the technical receipt limits, which are not
 * overridable). Money in Euro, days as whole days, percentages in percent.
 */
export const BUERO_STANDARD = deepFreeze({
  rechtsform: "einzelunternehmen",
  ust_zeitraum: "quartal",
  dauerfrist: false,
  versteuerung: "ist",
  kontenrahmen: "SKR03",
  zahlungsziel_tage: 14,
  puffer_tage: 7,
  warn_tage_rest: 7,
  rechnungsnr_muster: "RE-{jahr}-{nr3}",
  nebenkosten_prozent: 5,
  ust_satz: 19,
  gewst_aktiv: false,
  est_ueber_buero: true,
  zahlungsziel_je_bauherr: {},
  kontostand_start: {},
  vorauszahlungen: {},
  schluessel: {},
  buero: { name: "", steuernr: "", ust_idnr: "", iban: "" },
  datev: { berater: "", mandant: "", wj_beginn: "01-01", personenkonten: {} },
  bank_profile: [],
  mahnstufen: [
    { stufe: 1, tage_nach_faellig: 7, frist_tage: 10 },
    { stufe: 2, tage_nach_vorstufe: 14, frist_tage: 7 },
    { stufe: 3, tage_nach_vorstufe: 14, frist_tage: 7 },
  ],
  vorjahr_euer: {},
  ust_vorjahr_zahllast: {},
  umsatz_vorjahr: {},
  gewinn_plan: {},
  ablauf_warn_tage: 60,
  beleg_max_bytes: 5242880,
  beleg_mime: ["application/pdf", "image/jpeg", "image/png", "application/xml", "text/xml"],
  beispiel: false,
  beispiel_entfernt: false,
});

const NUTZER = "Nutzerentscheidung 27.09.2026";

/**
 * Origin of each office default that alsRegeln() publishes: since when, source,
 * and whether it is an assumption ([ASSUMED] = a guideline value the office
 * should confirm). E-12/E-16 values are assumptions by the decision list itself.
 */
export const BUERO_HERKUNFT = deepFreeze({
  rechtsform: { ab: STAND, quelle: `${NUTZER} (E-04)` },
  ust_zeitraum: { ab: STAND, quelle: `${NUTZER} (E-09)` },
  dauerfrist: { ab: STAND, quelle: `${NUTZER} (E-09)` },
  versteuerung: { ab: STAND, quelle: `${NUTZER} (E-10)` },
  kontenrahmen: { ab: STAND, quelle: `${NUTZER} (E-11)`, annahme: true, grund: "vom Nutzer offen gelassen — mit dem Steuerberater klären" },
  zahlungsziel_tage: { ab: STAND, quelle: `${NUTZER} (E-12)`, annahme: true, grund: "Bürostandard, je Bauherr und Rechnung überschreibbar" },
  puffer_tage: { ab: STAND, quelle: `${NUTZER} (E-12)`, annahme: true, grund: "Puffer zwischen Zahlungseingang und Steuertermin" },
  warn_tage_rest: { ab: STAND, quelle: "79-RESEARCH Datenmodell", annahme: true, grund: "Richtwert" },
  rechnungsnr_muster: { ab: STAND, quelle: `${NUTZER} (E-16)`, annahme: true, grund: "passend zu HA-/AV-Nummern der Phase 81" },
  nebenkosten_prozent: { ab: STAND, quelle: `${NUTZER} (E-16)`, annahme: true, grund: "Vorbelegung des Honorarvertrags" },
  ust_satz: { ab: STAND, quelle: `${NUTZER} (E-16)`, annahme: true, grund: "nur die Vorbelegung ist Bürowert; der Satz selbst steht in § 12 Abs. 1 UStG" },
  gewst_aktiv: { ab: STAND, quelle: `${NUTZER} (E-04, Freiberufler)` },
  est_ueber_buero: { ab: STAND, quelle: "79-RESEARCH Datenmodell", annahme: true, grund: "Annahme: ESt-Vorauszahlungen gehen vom Bürokonto ab (= Entnahme)" },
  mahnstufen: { ab: STAND, quelle: "79-RESEARCH Mahnwesen", annahme: true, grund: "gesetzlich nicht geregelt" },
  ablauf_warn_tage: { ab: STAND, quelle: "79-RESEARCH Datenmodell", annahme: true, grund: "Richtwert für Versicherung und Bürgschaft" },
  beleg_max_bytes: { ab: STAND, quelle: "Technische Grenze (79-RESEARCH, Risiko 4)" },
});

/**
 * Rules published for "Einstellungen › Regelwerke" (phase 80, E-16) and shown
 * read-only in the accounting settings dialog. `pfad` points into GESETZ,
 * KONTENRAHMEN or BUERO_STANDARD; labels are German source strings for t()
 * (the i18n guard reads the `label` fields of this literal).
 * `typ`: how the value is displayed; `einheit`: unit of the value.
 */
const REGEL_TABELLE = [
  { name: "steuertermine_est", pfad: "GESETZ.STEUERTERMINE.est", label: "ESt-Vorauszahlungstermine", einheit: "Datum", typ: "termine", art: "gesetz" },
  { name: "steuertermine_kst", pfad: "GESETZ.STEUERTERMINE.kst", label: "KSt-Vorauszahlungstermine", einheit: "Datum", typ: "termine", art: "gesetz" },
  { name: "steuertermine_gewst", pfad: "GESETZ.STEUERTERMINE.gewst", label: "GewSt-Vorauszahlungstermine", einheit: "Datum", typ: "termine", art: "gesetz" },
  { name: "ust_frist_tag", pfad: "GESETZ.STEUERTERMINE.ust", label: "USt-Voranmeldung fällig am Tag nach Zeitraumende", einheit: "Tag", typ: "zahl", art: "gesetz" },
  { name: "dauerfrist_monate", pfad: "GESETZ.STEUERTERMINE.dauerfrist_monate", label: "Dauerfristverlängerung", einheit: "Monate", typ: "zahl", art: "gesetz" },
  { name: "sondervorauszahlung", pfad: "GESETZ.STEUERTERMINE.svz", label: "Sondervorauszahlung (1/11, fällig 10.02.)", einheit: "", typ: "objekt", art: "gesetz" },
  { name: "werktagsregel", pfad: "GESETZ.STEUERTERMINE.werktagsregel", label: "Fälligkeit am Wochenende oder Feiertag", einheit: "", typ: "text", art: "gesetz" },
  { name: "feiertage_bund", pfad: "GESETZ.FEIERTAGE_BUND", label: "Bundeseinheitliche Feiertage", einheit: "", typ: "liste", art: "gesetz" },
  { name: "ust_saetze", pfad: "GESETZ.UST.saetze", label: "Umsatzsteuersätze", einheit: "%", typ: "objekt", art: "gesetz" },
  { name: "ust_quartalsgrenze", pfad: "GESETZ.UST.quartalsgrenze", label: "Monatliche Voranmeldung ab Vorjahressteuer über", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "ust_befreiung", pfad: "GESETZ.UST.befreiung_voranmeldung", label: "Keine Voranmeldung bis Vorjahressteuer", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "ist_grenze", pfad: "GESETZ.UST.ist_grenze", label: "Ist-Versteuerung bis Vorjahresumsatz", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "ust_zeitraeume", pfad: "GESETZ.UST.zeitraeume", label: "Voranmeldungszeiträume", einheit: "", typ: "liste", art: "gesetz" },
  { name: "gewst_kraft_rechtsform", pfad: "GESETZ.GEWST.kraft_rechtsform", label: "Gewerbesteuer kraft Rechtsform", einheit: "", typ: "liste", art: "gesetz" },
  { name: "gewst_freibetrag", pfad: "GESETZ.GEWST.freibetrag", label: "Gewerbesteuer-Freibetrag", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "grenzen_141_ao", pfad: "GESETZ.BUCHFUEHRUNG.grenzen_141_ao", label: "Buchführungsgrenzen (Umsatz, Gewinn)", einheit: "EUR", typ: "objekt", art: "gesetz" },
  { name: "basiszins", pfad: "GESETZ.VERZUG.basiszins", label: "Basiszinssatz", einheit: "%", typ: "prozent", art: "gesetz" },
  { name: "verzug_pp_verbraucher", pfad: "GESETZ.VERZUG.pp_verbraucher", label: "Verzugszins Verbraucher über Basiszins", einheit: "Prozentpunkte", typ: "zahl", art: "gesetz" },
  { name: "verzug_pp_unternehmer", pfad: "GESETZ.VERZUG.pp_unternehmer", label: "Verzugszins Unternehmer über Basiszins", einheit: "Prozentpunkte", typ: "zahl", art: "gesetz" },
  { name: "verzug_pauschale", pfad: "GESETZ.VERZUG.pauschale", label: "Verzugspauschale", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "verzug_30_tage", pfad: "GESETZ.VERZUG.verzug_30_tage", label: "Verzug spätestens nach", einheit: "Tage", typ: "zahl", art: "gesetz" },
  { name: "zinstage_jahr", pfad: "GESETZ.VERZUG.tage_jahr", label: "Zinstage je Jahr", einheit: "Tage", typ: "zahl", art: "praxis" },
  { name: "dienstwagen_pauschal", pfad: "GESETZ.DIENSTWAGEN.pauschal_prozent", label: "Dienstwagen: Privatanteil je Monat", einheit: "%", typ: "prozent", art: "gesetz" },
  { name: "dienstwagen_entfernung", pfad: "GESETZ.DIENSTWAGEN.entfernung_prozent", label: "Dienstwagen: je Entfernungskilometer", einheit: "%", typ: "prozent", art: "gesetz" },
  { name: "blp_abrundung", pfad: "GESETZ.DIENSTWAGEN.blp_abrundung", label: "Bruttolistenpreis abrunden auf volle", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "e_grenze", pfad: "GESETZ.DIENSTWAGEN.e_grenzen", label: "E-Fahrzeug: Viertelregel bis Listenpreis", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "e_bis", pfad: "GESETZ.DIENSTWAGEN.e_bis", label: "E-Fahrzeug: Anschaffung bis", einheit: "Datum", typ: "datum", art: "gesetz" },
  { name: "hybrid_reichweite", pfad: "GESETZ.DIENSTWAGEN.hybrid_reichweite", label: "Hybrid: elektrische Mindestreichweite", einheit: "km", typ: "zahl", art: "gesetz" },
  { name: "hybrid_co2", pfad: "GESETZ.DIENSTWAGEN.hybrid_co2_max", label: "Hybrid: höchstens CO₂", einheit: "g/km", typ: "zahl", art: "gesetz" },
  { name: "km_satz", pfad: "GESETZ.REISEKOSTEN.km_satz", label: "Kilometersatz Dienstreise", einheit: "EUR/km", typ: "betrag", art: "gesetz" },
  { name: "gwg_grenze", pfad: "GESETZ.AFA.gwg_grenze", label: "GWG-Grenze (netto)", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "sofort_grenze", pfad: "GESETZ.AFA.sofort_grenze", label: "Sofortabzug ohne Verzeichnis bis (netto)", einheit: "EUR", typ: "betrag", art: "gesetz" },
  { name: "sammelposten", pfad: "GESETZ.AFA.sammelposten", label: "Sammelposten", einheit: "", typ: "objekt", art: "gesetz" },
  { name: "nutzungsdauern", pfad: "GESETZ.AFA.nd_tabelle", label: "Nutzungsdauern", einheit: "Jahre", typ: "objekt", art: "gesetz" },
  { name: "afa_pro_rata", pfad: "GESETZ.AFA.pro_rata", label: "AfA im Anschaffungsjahr", einheit: "", typ: "text", art: "gesetz" },
  { name: "aufbewahrung_belege", pfad: "GESETZ.AUFBEWAHRUNG.buchungsbelege_jahre", label: "Aufbewahrung Buchungsbelege", einheit: "Jahre", typ: "zahl", art: "gesetz" },
  { name: "aufbewahrung_buecher", pfad: "GESETZ.AUFBEWAHRUNG.buecher_jahre", label: "Aufbewahrung Bücher und Abschlüsse", einheit: "Jahre", typ: "zahl", art: "gesetz" },
  { name: "hoai_fassung", pfad: "GESETZ.HOAI.fassung", label: "HOAI-Fassung", einheit: "", typ: "text", art: "gesetz" },
  { name: "hoai_tafel_gebaeude_innenraeume", pfad: "GESETZ.HOAI.tafel_gebaeude_innenraeume", label: "HOAI-Honorartafel § 35 (Gebäude und Innenräume)", einheit: "EUR", typ: "tabelle", art: "gesetz" },
  { name: "hoai_tafel_freianlagen", pfad: "GESETZ.HOAI.tafel_freianlagen", label: "HOAI-Honorartafel § 40 (Freianlagen)", einheit: "EUR", typ: "tabelle", art: "gesetz" },
  { name: "hoai_umbau_max", pfad: "GESETZ.HOAI.umbau_max_prozent", label: "HOAI-Umbauzuschlag höchstens", einheit: "%", typ: "objekt", art: "gesetz" },
  { name: "datev_kopf", pfad: "GESETZ.DATEV.kopf", label: "DATEV-Kopfdaten", einheit: "", typ: "objekt", art: "praxis" },
  { name: "kontenrahmen_skr03", pfad: "KONTENRAHMEN.SKR03", label: "Kontenrahmen SKR03", einheit: "", typ: "objekt", art: "praxis" },
  { name: "kontenrahmen_skr04", pfad: "KONTENRAHMEN.SKR04", label: "Kontenrahmen SKR04", einheit: "", typ: "objekt", art: "praxis" },
  { name: "rechtsform", pfad: "BUERO_STANDARD.rechtsform", label: "Rechtsform (Standard)", einheit: "", typ: "text", art: "buero" },
  { name: "ust_zeitraum", pfad: "BUERO_STANDARD.ust_zeitraum", label: "USt-Voranmeldungszeitraum (Standard)", einheit: "", typ: "text", art: "buero" },
  { name: "dauerfrist", pfad: "BUERO_STANDARD.dauerfrist", label: "Dauerfristverlängerung (Standard)", einheit: "", typ: "ja_nein", art: "buero" },
  { name: "versteuerung", pfad: "BUERO_STANDARD.versteuerung", label: "Versteuerung (Standard)", einheit: "", typ: "text", art: "buero" },
  { name: "kontenrahmen", pfad: "BUERO_STANDARD.kontenrahmen", label: "Kontenrahmen (Standard)", einheit: "", typ: "text", art: "buero" },
  { name: "zahlungsziel_tage", pfad: "BUERO_STANDARD.zahlungsziel_tage", label: "Zahlungsziel (Standard)", einheit: "Tage", typ: "zahl", art: "buero" },
  { name: "puffer_tage", pfad: "BUERO_STANDARD.puffer_tage", label: "Puffer vor Steuerterminen", einheit: "Tage", typ: "zahl", art: "buero" },
  { name: "warn_tage_rest", pfad: "BUERO_STANDARD.warn_tage_rest", label: "Warnschwelle", einheit: "Tage", typ: "zahl", art: "buero" },
  { name: "rechnungsnr_muster", pfad: "BUERO_STANDARD.rechnungsnr_muster", label: "Nummernmuster Rechnungen", einheit: "", typ: "text", art: "buero" },
  { name: "nebenkosten_prozent", pfad: "BUERO_STANDARD.nebenkosten_prozent", label: "Nebenkosten (Vorbelegung)", einheit: "%", typ: "prozent", art: "buero" },
  { name: "ust_satz", pfad: "BUERO_STANDARD.ust_satz", label: "USt-Satz (Vorbelegung)", einheit: "%", typ: "prozent", art: "buero" },
  { name: "gewst_aktiv", pfad: "BUERO_STANDARD.gewst_aktiv", label: "Gewerbesteuer aktiv (Standard)", einheit: "", typ: "ja_nein", art: "buero" },
  { name: "est_ueber_buero", pfad: "BUERO_STANDARD.est_ueber_buero", label: "ESt über das Bürokonto (Standard)", einheit: "", typ: "ja_nein", art: "buero" },
  { name: "mahnstufen", pfad: "BUERO_STANDARD.mahnstufen", label: "Mahnstufen", einheit: "Tage", typ: "objekt", art: "buero" },
  { name: "ablauf_warn_tage", pfad: "BUERO_STANDARD.ablauf_warn_tage", label: "Warnung vor Ablauf von Versicherungen", einheit: "Tage", typ: "zahl", art: "buero" },
  { name: "beleg_max_bytes", pfad: "BUERO_STANDARD.beleg_max_bytes", label: "Größte Belegdatei", einheit: "Byte", typ: "zahl", art: "buero" },
];
deepFreeze(REGEL_TABELLE);

const WURZELN = { GESETZ, KONTENRAHMEN, BUERO_STANDARD };

/**
 * Value at a dotted path such as "GESETZ.VERZUG.basiszins".
 * @param {string} pfad
 * @returns {any}
 */
function anPfad(pfad) {
  const [wurzel, ...rest] = pfad.split(".");
  let wert = /** @type {any} */ (WURZELN)[wurzel];
  for (const teil of rest) wert = wert?.[teil];
  return wert;
}

/**
 * True for a dated table: a non-empty array of rows with `ab` and `wert`.
 * @param {unknown} wert
 * @returns {wert is Zeile[]}
 */
function istTabelle(wert) {
  return Array.isArray(wert) && wert.length > 0
    && wert.every((r) => r && typeof r === "object" && !Array.isArray(r) && "ab" in r && "wert" in r);
}

/**
 * The row of a dated table that applies on a date: the last row with ab ≤ datum.
 * @param {ReadonlyArray<Zeile>} zeilen rows sorted by `ab`
 * @param {string} datum 'YYYY-MM-DD'
 * @returns {Zeile|null} null before the first row
 */
function zeileAm(zeilen, datum) {
  let treffer = null;
  for (const zeile of zeilen) if (zeile.ab <= datum) treffer = zeile;
  return treffer;
}

/**
 * Flat snapshot of all legal values on a reference date: every dated table is
 * replaced by the value of the row that applies then (null before the first
 * row); section names in lower case (GESETZ.VERZUG.basiszins → .verzug.basiszins).
 * The charts of accounts come along under `kontenrahmen`.
 * @param {string} stichtag reference date 'YYYY-MM-DD'
 * @returns {Record<string, any> & {stichtag: string}} plain, unfrozen object
 */
export function saetzeZum(stichtag) {
  /** @param {any} knoten */
  const aufloesen = (knoten) => {
    if (istTabelle(knoten)) return zeileAm(knoten, stichtag)?.wert ?? null;
    if (knoten && typeof knoten === "object" && !Array.isArray(knoten)) {
      /** @type {Record<string, any>} */
      const aus = {};
      for (const [k, v] of Object.entries(knoten)) aus[k] = aufloesen(v);
      return aus;
    }
    return knoten;
  };
  /** @type {Record<string, any> & {stichtag: string}} */
  const saetze = { stichtag };
  for (const [abschnitt, inhalt] of Object.entries(GESETZ)) saetze[abschnitt.toLowerCase()] = aufloesen(inhalt);
  saetze.kontenrahmen = aufloesen(KONTENRAHMEN);
  return saetze;
}

/**
 * ¼-rule limit for an electric company car, by ACQUISITION date (§ 6 Abs. 1 Nr. 4
 * S. 2 Nr. 3 EStG with the staggering of § 52 Abs. 12 EStG).
 * @param {string} anschaffung acquisition date 'YYYY-MM-DD'
 * @returns {number|null} list price limit in Euro; null before 2019 or after 2030
 */
export function eGrenzeFuer(anschaffung) {
  if (typeof anschaffung !== "string" || anschaffung > GESETZ.DIENSTWAGEN.e_bis[0].wert) return null;
  return zeileAm(GESETZ.DIENSTWAGEN.e_grenzen, anschaffung)?.wert ?? null;
}

/**
 * Minimum electric range of a plug-in hybrid for the ½ rule, by acquisition date.
 * @param {string} anschaffung acquisition date 'YYYY-MM-DD'
 * @returns {number|null} range in km; null before 2019 or after 2030
 */
export function hybridReichweiteFuer(anschaffung) {
  if (typeof anschaffung !== "string" || anschaffung > GESETZ.DIENSTWAGEN.e_bis[0].wert) return null;
  return zeileAm(GESETZ.DIENSTWAGEN.hybrid_reichweite, anschaffung)?.wert ?? null;
}

/**
 * Base rate of § 247 BGB on a date.
 * @param {string} datum 'YYYY-MM-DD'
 * @returns {number|null} percent; null before the first recorded period (2024-01-01)
 */
export function basiszinsAm(datum) {
  return zeileAm(GESETZ.VERZUG.basiszins, datum)?.wert ?? null;
}

// Values with an announced change date: from that date on the table may be stale.
const AENDERUNGEN = deepFreeze([
  { pfad: "GESETZ.VERZUG.basiszins", regel: "buchhaltung.basiszins", am: GESETZ.VERZUG.naechste_aenderung,
    grund: "Der Basiszins wird zum 01.01. und 01.07. neu festgesetzt — neue Zeile mit dem Wert der Bundesbank nachtragen." },
]);

/**
 * Values that may be out of date on a given day (an announced change date has passed).
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {Array<{pfad: string, regel: string, am: string, grund: string}>} empty when all is current
 */
export function veralteteWerte(heute) {
  return AENDERUNGEN.filter((a) => typeof heute === "string" && heute >= a.am).map((a) => ({ ...a }));
}

/**
 * Every [ASSUMED] value: legal rows with `annahme: true` and office defaults whose
 * origin is an assumption. `pfad` is the dotted path, `ab` the row start.
 * @type {ReadonlyArray<{pfad: string, ab: string, quelle: string, grund: string}>}
 */
export const ANNAHMEN = deepFreeze((() => {
  /** @type {Array<{pfad: string, ab: string, quelle: string, grund: string}>} */
  const liste = [];
  /** @param {any} knoten @param {string} pfad */
  const laufe = (knoten, pfad) => {
    if (istTabelle(knoten)) {
      for (const r of knoten) if (r.annahme) liste.push({ pfad, ab: r.ab, quelle: r.quelle, grund: r.grund || "" });
      return;
    }
    if (knoten && typeof knoten === "object" && !Array.isArray(knoten)) {
      for (const [k, v] of Object.entries(knoten)) laufe(v, `${pfad}.${k}`);
    }
  };
  laufe(GESETZ, "GESETZ");
  laufe(KONTENRAHMEN, "KONTENRAHMEN");
  for (const [k, h] of Object.entries(BUERO_HERKUNFT)) {
    if (/** @type {any} */ (h).annahme) liste.push({ pfad: `BUERO_STANDARD.${k}`, ab: h.ab, quelle: h.quelle, grund: /** @type {any} */ (h).grund || "" });
  }
  return liste;
})());

/**
 * One rule in the rule shape of phase 80 ("Einstellungen › Regelwerke", E-16).
 * @typedef {{
 *   id: string, label: string, einheit: string, typ: string, art: "gesetz"|"buero"|"praxis",
 *   werte: Array<{ab: string, wert: any, quelle: string}>, stand: string, quelle: string,
 *   assumed: boolean, editierbar: boolean,
 * }} Regel
 */

/**
 * All legal and office values as rules for phase 80. Legal and practice values
 * are read-only (changeable by commit); office values are editable. HOAI tables
 * have typ "tabelle". Values sorted by `ab`.
 * @returns {Regel[]} fresh objects (the frozen sources stay untouched)
 */
export function alsRegeln() {
  return REGEL_TABELLE.map((d) => {
    const id = `buchhaltung.${d.name}`;
    if (d.art === "buero") {
      const schluessel = d.pfad.split(".")[1];
      const h = /** @type {any} */ (BUERO_HERKUNFT)[schluessel] || { ab: STAND, quelle: NUTZER };
      return {
        id, label: d.label, einheit: d.einheit, typ: d.typ, art: "buero",
        werte: [{ ab: h.ab, wert: structuredClone(/** @type {any} */ (BUERO_STANDARD)[schluessel]), quelle: h.quelle }],
        stand: STAND, quelle: h.quelle, assumed: Boolean(h.annahme), editierbar: true,
      };
    }
    const zeilen = /** @type {Zeile[]} */ ([...anPfad(d.pfad)]).sort((a, b) => (a.ab < b.ab ? -1 : a.ab > b.ab ? 1 : 0));
    return {
      id, label: d.label, einheit: d.einheit, typ: d.typ, art: /** @type {"gesetz"|"praxis"} */ (d.art),
      werte: zeilen.map((r) => ({ ab: r.ab, wert: r.wert, quelle: r.quelle })),
      stand: STAND, quelle: zeilen[zeilen.length - 1].quelle, assumed: zeilen.some((r) => Boolean(r.annahme)), editierbar: false,
    };
  });
}

// ---------------------------------------------------------------------------
// wirksameEinstellungen: whitelist merge of the stored Setting over BUERO_STANDARD.

// Keys that must never be copied from stored data (prototype pollution).
const GEFAEHRLICH = new Set(["__proto__", "constructor", "prototype"]);
// Same list as RECHTSFORMEN in rechtsform.js; this file may only import the HOAI
// data (single entry point), buchhaltung-rechtsform.test.js pins both lists equal.
const RECHTSFORM_SCHLUESSEL = ["einzelunternehmen", "gbr", "partg", "gmbh", "ug"];

/** @param {unknown} v @returns {v is Record<string, any>} */
const istObjekt = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v @returns {boolean} */
const istTag = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Whole number in [min, max], else the fallback.
 * @param {unknown} v @param {number} min @param {number} max @param {number} rueckfall
 * @returns {number}
 */
function ganzzahl(v, min, max, rueckfall) {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : rueckfall;
}

/**
 * Finite number in [min, max], else the fallback.
 * @param {unknown} v @param {number} min @param {number} max @param {number} rueckfall
 * @returns {number}
 */
function zahl(v, min, max, rueckfall) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : rueckfall;
}

/**
 * Map with safe keys only; values pass through `pruefe` (undefined drops the entry).
 * @param {unknown} v
 * @param {(wert: any, schluessel: string) => any} pruefe
 * @param {(schluessel: string) => boolean} [schluesselOk]
 * @returns {Record<string, any>}
 */
function karte(v, pruefe, schluesselOk = () => true) {
  /** @type {Record<string, any>} */
  const aus = {};
  if (!istObjekt(v)) return aus;
  for (const k of Object.keys(v)) {
    if (GEFAEHRLICH.has(k) || !schluesselOk(k)) continue;
    const w = pruefe(v[k], k);
    if (w !== undefined) aus[k] = w;
  }
  return aus;
}

/** Year maps only take 4-digit year keys. @param {string} k */
const jahrSchluessel = (k) => /^\d{4}$/.test(k);

/**
 * Plain JSON-like data without dangerous keys (for free-form parts such as bank profiles).
 * @param {unknown} v
 * @returns {any}
 */
function sauber(v) {
  if (Array.isArray(v)) return v.map(sauber);
  if (istObjekt(v)) return karte(v, sauber);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (["string", "boolean"].includes(typeof v) || v === null) return v;
  return undefined;
}

/** @param {unknown} v @returns {number|undefined} finite number or undefined */
const endlich = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Four quarterly amounts in Euro, or undefined.
 * @param {unknown} v
 * @returns {number[]|undefined}
 */
function vierBetraege(v) {
  return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? [...v] : undefined;
}

/**
 * Dunning levels: 1–3 objects with non-negative whole-day fields, else the default.
 * @param {unknown} v
 * @returns {any[]}
 */
function mahnstufen(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 3) return structuredClone(BUERO_STANDARD.mahnstufen);
  const ok = v.every((s, i) => istObjekt(s) && s.stufe === i + 1
    && ["tage_nach_faellig", "tage_nach_vorstufe", "frist_tage"].every((f) => s[f] === undefined || ganzzahl(s[f], 0, 365, -1) >= 0));
  return ok ? v.map((s) => karte(s, (w) => (typeof w === "number" ? w : undefined))) : structuredClone(BUERO_STANDARD.mahnstufen);
}

/**
 * Effective office settings: BUERO_STANDARD overridden by the stored
 * Setting{key:"buchhaltung"}.value, key by key through a whitelist. Unknown keys,
 * `__proto__`/`constructor`/`prototype`, NaN, negative days and wrong types are
 * dropped (the default applies). Year maps only accept 4-digit keys. An unknown
 * legal form falls back to "einzelunternehmen", an unknown VAT period to "quartal".
 * `kontenrahmen` is read on the top level only (not from `datev`).
 * @param {unknown} settingWert stored value (may be null, garbage or foreign)
 * @returns {Record<string, any>} a fresh, unfrozen object with every BUERO_STANDARD key
 */
export function wirksameEinstellungen(settingWert) {
  const s = istObjekt(settingWert) ? settingWert : {};
  const std = BUERO_STANDARD;
  /** @param {string} k @param {any[]} erlaubt @param {any} rueckfall */
  const eins = (k, erlaubt, rueckfall) => (erlaubt.includes(s[k]) ? s[k] : rueckfall);
  /** @param {string} k @param {boolean} rueckfall */
  const bool = (k, rueckfall) => (typeof s[k] === "boolean" ? s[k] : rueckfall);
  /** @param {string} k @param {string[]} felder */
  const texte = (k, felder) => {
    const quelle = istObjekt(s[k]) ? s[k] : {};
    /** @type {Record<string, any>} */
    const aus = {};
    for (const f of felder) aus[f] = typeof quelle[f] === "string" ? quelle[f] : /** @type {any} */ (std)[k][f];
    return aus;
  };
  const muster = typeof s.rechnungsnr_muster === "string" && /\{nr[34]\}/.test(s.rechnungsnr_muster)
    ? s.rechnungsnr_muster : std.rechnungsnr_muster;
  const datev = istObjekt(s.datev) ? s.datev : {};

  return {
    rechtsform: eins("rechtsform", RECHTSFORM_SCHLUESSEL, std.rechtsform),
    ust_zeitraum: eins("ust_zeitraum", ["monat", "quartal", "jahr"], std.ust_zeitraum),
    dauerfrist: bool("dauerfrist", std.dauerfrist),
    versteuerung: eins("versteuerung", ["ist", "soll"], std.versteuerung),
    kontenrahmen: eins("kontenrahmen", ["SKR03", "SKR04"], std.kontenrahmen),
    zahlungsziel_tage: ganzzahl(s.zahlungsziel_tage, 0, 365, std.zahlungsziel_tage),
    puffer_tage: ganzzahl(s.puffer_tage, 0, 365, std.puffer_tage),
    warn_tage_rest: ganzzahl(s.warn_tage_rest, 0, 365, std.warn_tage_rest),
    rechnungsnr_muster: muster,
    nebenkosten_prozent: zahl(s.nebenkosten_prozent, 0, 100, std.nebenkosten_prozent),
    ust_satz: zahl(s.ust_satz, 0, 100, std.ust_satz),
    gewst_aktiv: bool("gewst_aktiv", std.gewst_aktiv),
    est_ueber_buero: bool("est_ueber_buero", std.est_ueber_buero),
    zahlungsziel_je_bauherr: karte(s.zahlungsziel_je_bauherr, (w) => (ganzzahl(w, 0, 365, -1) >= 0 ? w : undefined)),
    kontostand_start: karte(s.kontostand_start, (w) => (istObjekt(w) && endlich(w.betrag) !== undefined
      ? { betrag: w.betrag, ...(istTag(w.datum) ? { datum: w.datum } : {}) } : undefined), jahrSchluessel),
    vorauszahlungen: karte(s.vorauszahlungen, (w) => {
      if (!istObjekt(w)) return undefined;
      /** @type {Record<string, number[]>} */
      const aus = {};
      for (const art of ["est", "kst", "gewst"]) { const b = vierBetraege(w[art]); if (b) aus[art] = b; }
      return aus;
    }, jahrSchluessel),
    schluessel: karte(s.schluessel, (w) => karte(w, (p) => zahl(p, 0, 100, -1) >= 0 ? p : undefined), jahrSchluessel),
    buero: texte("buero", ["name", "steuernr", "ust_idnr", "iban"]),
    datev: {
      berater: typeof datev.berater === "string" ? datev.berater : std.datev.berater,
      mandant: typeof datev.mandant === "string" ? datev.mandant : std.datev.mandant,
      wj_beginn: typeof datev.wj_beginn === "string" && /^\d{2}-\d{2}$/.test(datev.wj_beginn) ? datev.wj_beginn : std.datev.wj_beginn,
      personenkonten: karte(datev.personenkonten, (w) => (typeof w === "string" || endlich(w) !== undefined ? w : undefined)),
    },
    bank_profile: Array.isArray(s.bank_profile) ? s.bank_profile.filter(istObjekt).map(sauber) : [],
    mahnstufen: s.mahnstufen === undefined ? structuredClone(std.mahnstufen) : mahnstufen(s.mahnstufen),
    vorjahr_euer: karte(s.vorjahr_euer, (w) => (istObjekt(w) ? sauber(w) : undefined), jahrSchluessel),
    ust_vorjahr_zahllast: karte(s.ust_vorjahr_zahllast, endlich, jahrSchluessel),
    umsatz_vorjahr: karte(s.umsatz_vorjahr, endlich, jahrSchluessel),
    gewinn_plan: karte(s.gewinn_plan, endlich, jahrSchluessel),
    ablauf_warn_tage: ganzzahl(s.ablauf_warn_tage, 0, 3650, std.ablauf_warn_tage),
    beleg_max_bytes: std.beleg_max_bytes,
    beleg_mime: [...std.beleg_mime],
    beispiel: bool("beispiel", std.beispiel),
    beispiel_entfernt: bool("beispiel_entfernt", std.beispiel_entfernt),
  };
}
