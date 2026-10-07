// Sample data of the accounting module (phase 79, E-05): a living demo office,
// always relative to "today" — the year clock shows the running month, invoices
// are overdue by days, not by years. Deterministic: the same `heute` gives the
// same records (ids "bsp-*", every record `beispiel: true`).
//
// The sample office is a sole proprietor (freelance architect, E-04/E-17) with
// ONE owner, "Inhaberin A", no employees and no profit shares. Only neutral names
// (tests/unit/projektneutral.test.js scans this file). Projects are the four demo
// projects proj-1 … proj-4 of the demo seed.
//
// Import-free on purpose (own ten-line UTC helper below): server/seed.js imports
// this file directly and runs without the alias hook.
//
// In:  heute 'YYYY-MM-DD'; optionally the projects that already have a HoaiPlan.
// Out: { Setting, Honorarvertrag, Ausgangsrechnung, …, HoaiPlan } — arrays of
//      plain records ready for bitApi create (amounts in Euro, dates 'YYYY-MM-DD').

// --- UTC date helper (no local getters; same rules as @core/lib/kalender) ---
const TAG = 86400000;
/** @param {string} s @returns {number} */
const ms = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
/** @param {number} x @returns {string} */
const iso = (x) => { const d = new Date(x); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };
/** @param {string} s @param {number} n @returns {string} */
const plusTage = (s, n) => iso(ms(s) + n * TAG);
/** @param {number} y @param {number} m @returns {number} days in month (m 1–12) */
const tageIm = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** @param {string} s @param {number} n @returns {string} months added, day capped at month end */
const plusMonate = (s, n) => {
  const i = Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1 + n;
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return iso(Date.UTC(y, m - 1, Math.min(Number(s.slice(8, 10)), tageIm(y, m))));
};
/** @param {string} s @returns {string} Saturday/Sunday → Monday (holidays ignored: sample data only) */
const werktag = (s) => { const w = new Date(ms(s)).getUTCDay(); return w === 6 ? plusTage(s, 2) : w === 0 ? plusTage(s, 1) : s; };

const PROJEKTE = {
  "proj-1": "Stadtquartier Nordhang",
  "proj-2": "Bürocampus Parkseite",
  "proj-3": "Wohnpark am See",
  "proj-4": "Sanierung Altstadthof",
};
const ANSCHRIFT = "Musterstraße 1, 00000 Musterstadt";

/**
 * VAT and gross of a net amount at 19 % (VAT rounded per invoice).
 * @param {number} netto Euro, whole euros in the sample data
 * @returns {{netto: number, ust_satz: number, ust: number, brutto: number}} Euro
 */
function betraege(netto) {
  const ust = Math.round(netto * 19) / 100;
  return { netto, ust_satz: 19, ust, brutto: Math.round((netto + ust) * 100) / 100 };
}

/**
 * Keys of the Setting value the sample data sets. "Beispieldaten entfernen"
 * removes exactly these keys again (speicher.beispielEntfernen).
 */
export const BEISPIEL_EINSTELLUNG_SCHLUESSEL = Object.freeze([
  "rechtsform", "ust_zeitraum", "dauerfrist", "versteuerung", "kontostand_start", "vorauszahlungen",
  "ust_vorjahr_zahllast", "buero", "datev", "beispiel",
]);

/** Id of the sample Setting record. */
export const BEISPIEL_SETTING_ID = "bsp-setting-buchhaltung";

/**
 * All sample records relative to `heute` (year Y = year of heute).
 * @param {string} heute 'YYYY-MM-DD'
 * @param {{vorhandeneHoaiPlaene?: string[]}} [optionen] project ids that already have a HoaiPlan (no sample plan then)
 * @returns {Record<string, any[]>} records per entity (Setting, the 13 accounting entities, HoaiPlan)
 */
export function beispielDatensaetze(heute, optionen = {}) {
  if (typeof heute !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(heute)) throw new Error(`Beispieldaten: ungültiges Datum „${heute}“.`);
  const Y = Number(heute.slice(0, 4));
  const bsp = { beispiel: true };

  // --- Setting: sole proprietor, VAT monthly with extension ------------------
  // Monthly returns because the sample office's VAT of last year exceeds
  // 9,000 € (§ 18 Abs. 2 S. 2 UStG); the OFFICE default stays quarterly without
  // extension (E-09). Cash accounting (E-10): the samples count by receipt.
  // No `schluessel`: a sole proprietor has no profit shares (E-04).
  const setting = {
    id: BEISPIEL_SETTING_ID,
    key: "buchhaltung",
    value: {
      rechtsform: "einzelunternehmen",
      ust_zeitraum: "monat",
      dauerfrist: true,
      versteuerung: "ist",
      kontostand_start: { [Y]: { betrag: 48000, datum: `${Y}-01-01` } },
      vorauszahlungen: { [Y]: { est: [9000, 9000, 9000, 9000] } },
      ust_vorjahr_zahllast: { [Y - 1]: 26400 },
      buero: { name: "Architekturbüro Beispiel", steuernr: "000/000/00000", ust_idnr: "DE000000000", iban: "DE89370400440532013000" },
      datev: { berater: "", mandant: "" },
      beispiel: true,
    },
  };

  // --- Fee contracts (one per demo project) -----------------------------------
  const lph = (bis) => [2, 7, 15, 3, 25, 10, 4, 32, 2].map((prozent, i) => ({ beauftragt: i < bis, prozent }));
  /** @type {any[]} */
  const vertraege = [
    { id: "bsp-hv-1", project_id: "proj-1", leistungsbild: "gebaeude", bauherr_name: "Stadtwerke Musterstadt", bauherr_anschrift: ANSCHRIFT,
      bauherr_art: "oeffentlich", zahlungsziel_tage: 30, zahlungsziel_vertraglich: true, anrechenbare_quelle: "lv",
      kg300_euro: 2399716, kg400_euro: 281000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph(8),
      umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, pauschal_euro: null, ust_satz: 19, textform_am: `${Y - 1}-02-10`, ...bsp },
    { id: "bsp-hv-2", project_id: "proj-2", leistungsbild: "gebaeude", bauherr_name: "Beispiel Immobilien GmbH", bauherr_anschrift: ANSCHRIFT,
      bauherr_art: "unternehmer", zahlungsziel_tage: 21, zahlungsziel_vertraglich: true, anrechenbare_quelle: "manuell",
      kg300_euro: 1800000, kg400_euro: 0, sonstige_euro: 0, honorarzone: "IV", satz_position_prozent: 0, lph: lph(5),
      umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, pauschal_euro: null, ust_satz: 19, textform_am: `${Y - 1}-04-02`, ...bsp },
    { id: "bsp-hv-3", project_id: "proj-3", leistungsbild: "gebaeude", bauherr_name: "Wohnbau Süd eG", bauherr_anschrift: ANSCHRIFT,
      bauherr_art: "unternehmer", zahlungsziel_vertraglich: false, anrechenbare_quelle: "manuell",
      kg300_euro: 3200000, kg400_euro: 0, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph(4),
      umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, pauschal_euro: null, ust_satz: 19, textform_am: `${Y - 1}-06-20`, ...bsp },
    { id: "bsp-hv-4", project_id: "proj-4", leistungsbild: "gebaeude", bauherr_name: "Bauherrschaft A", bauherr_anschrift: ANSCHRIFT,
      bauherr_art: "verbraucher", zahlungsziel_tage: 14, zahlungsziel_vertraglich: true, anrechenbare_quelle: "manuell",
      kg300_euro: 450000, kg400_euro: 0, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0, lph: lph(8),
      umbauzuschlag_prozent: 20, nebenkosten_prozent: 5, pauschal_euro: null, ust_satz: 19, textform_am: `${Y - 1}-09-05`, ...bsp },
  ];
  const vertragVon = Object.fromEntries(vertraege.map((v) => [v.id, v]));
  const zielVon = (hv) => vertragVon[hv].zahlungsziel_tage ?? 14;

  // --- Outgoing invoices: 4 older, 9 within the last 12 months, 3 planned -----
  // [contract, net Euro, invoice date, kind]; payments 3 days before the due date.
  const gestellt = /** @type {Array<[string, number, string, string]>} */ ([
    ["bsp-hv-1", 12400, plusTage(plusMonate(heute, -15), 5), "abschlag"],
    ["bsp-hv-2", 18600, plusMonate(heute, -14), "abschlag"],
    ["bsp-hv-1", 9800, plusTage(plusMonate(heute, -13), -10), "abschlag"],
    ["bsp-hv-3", 24500, plusMonate(heute, -13), "schluss"],
    ["bsp-hv-1", 15200, plusTage(heute, -330), "abschlag"],
    ["bsp-hv-2", 31800, plusTage(heute, -280), "abschlag"],
    ["bsp-hv-3", 7400, plusTage(heute, -230), "abschlag"],
    ["bsp-hv-1", 22600, plusTage(heute, -180), "abschlag"],
    ["bsp-hv-2", 38000, plusTage(heute, -130), "abschlag"],
    ["bsp-hv-4", 11900, plusTage(heute, -80), "abschlag"],
  ]);
  /** @type {any[]} */
  const rechnungen = gestellt.map(([hv, netto, rechnungsdatum, art], i) => {
    const ziel = zielVon(hv);
    const faellig = plusTage(rechnungsdatum, ziel);
    return { id: `bsp-ar-${String(i + 1).padStart(2, "0")}`, hv, netto, rechnungsdatum, art, ziel, faellig,
      zahlungen: [{ datum: plusTage(faellig, -3), betrag: betraege(netto).brutto }], mahnungen: [] };
  });
  // Open and not yet due.
  rechnungen.push({ id: "bsp-ar-11", hv: "bsp-hv-2", netto: 16750, rechnungsdatum: plusTage(heute, -5), art: "abschlag",
    ziel: 21, faellig: plusTage(heute, 16), zahlungen: [], mahnungen: [] });
  // Overdue: due 45 days ago with first reminder 30 days ago, and due 12 days ago.
  rechnungen.push({ id: "bsp-ar-12", hv: "bsp-hv-3", netto: 27300, rechnungsdatum: plusTage(heute, -59), art: "abschlag",
    ziel: 14, faellig: plusTage(heute, -45), zahlungen: [], mahnungen: [{ stufe: 1, datum: plusTage(heute, -30), frist: plusTage(heute, -20) }] });
  rechnungen.push({ id: "bsp-ar-13", hv: "bsp-hv-4", netto: 4800, rechnungsdatum: plusTage(heute, -26), art: "abschlag",
    ziel: 14, faellig: plusTage(heute, -12), zahlungen: [], mahnungen: [] });

  // Consecutive numbers per invoice year (§ 14 Abs. 4 Nr. 4 UStG), by invoice date.
  const zaehler = {};
  [...rechnungen].sort((a, b) => (a.rechnungsdatum < b.rechnungsdatum ? -1 : a.rechnungsdatum > b.rechnungsdatum ? 1 : 0)).forEach((r) => {
    const jahr = r.rechnungsdatum.slice(0, 4);
    zaehler[jahr] = (zaehler[jahr] || 0) + 1;
    r.nummer = `RE-${jahr}-${String(zaehler[jahr]).padStart(3, "0")}`;
  });

  /** @type {any[]} */
  const ausgangsrechnungen = rechnungen.map((r) => {
    const v = vertragVon[r.hv];
    return {
      id: r.id, project_id: v.project_id, project_name: PROJEKTE[v.project_id], honorarvertrag_id: v.id, nummer: r.nummer,
      art: r.art, lp_pos: [], ...betraege(r.netto), rechnungsdatum: r.rechnungsdatum, zahlungsziel_tage: r.ziel, faellig_am: r.faellig,
      status: "gestellt", empfaenger: { name: v.bauherr_name, anschrift: v.bauherr_anschrift },
      verzugshinweis: v.bauherr_art === "verbraucher", zahlungen: r.zahlungen, mahnungen: r.mahnungen, ...bsp,
    };
  });
  for (const [i, [hv, netto, tage]] of /** @type {Array<[string, number, number]>} */ ([
    ["bsp-hv-1", 21000, 12], ["bsp-hv-2", 14500, 40], ["bsp-hv-4", 33250, 75],
  ]).entries()) {
    const v = vertragVon[hv];
    ausgangsrechnungen.push({
      id: `bsp-ar-${14 + i}`, project_id: v.project_id, project_name: PROJEKTE[v.project_id], honorarvertrag_id: v.id,
      art: "abschlag", lp_pos: [], ...betraege(netto), status: "geplant", versand_geplant_am: plusTage(heute, tage),
      verzugshinweis: v.bauherr_art === "verbraucher", zahlungen: [], mahnungen: [], ...bsp,
    });
  }

  // --- Bank: 6 receipts of paid invoices + 2 paid expenses (assigned), 4 open --
  const bank = [];
  const bankId = (n) => `bsp-bu-${String(n).padStart(2, "0")}`;
  const bankSatz = (n, buchungstag, betrag, zweck, gegenpartei, zuordnung) => ({
    id: bankId(n), buchungstag, valuta: buchungstag, betrag, zweck, gegenpartei, iban: "DE00000000000000000000",
    import_id: "bsp-import-1", hash: `bsp:${buchungstag}:${Math.round(betrag * 100)}:${n}`,
    status: zuordnung ? "zugeordnet" : "offen", zuordnung: zuordnung || null, ...bsp,
  });
  ausgangsrechnungen.slice(4, 10).forEach((r, i) => {
    const zahlung = r.zahlungen[0];
    zahlung.bankumsatz_id = bankId(i + 1);
    bank.push(bankSatz(i + 1, zahlung.datum, zahlung.betrag, `${r.nummer} ${r.project_name}`, r.empfaenger.name,
      { typ: "Ausgangsrechnung", id: r.id, modus: "auto" }));
  });

  // --- Fixed assets and the incoming invoices of three of them ---------------
  const anlagen = [
    { id: "bsp-ag-1", bezeichnung: "Großformatdrucker", kategorie: "plotter", anschaffung_datum: `${Y - 1}-05-10`, ak_netto: 8900, nutzungsdauer: 7, methode: "linear", eingangsrechnung_id: "bsp-er-2", abgang: null, ...bsp },
    { id: "bsp-ag-2", bezeichnung: "Büromöbel Arbeitsplätze", kategorie: "bueroausstattung", anschaffung_datum: `${Y - 2}-02-01`, ak_netto: 6400, nutzungsdauer: 13, methode: "linear", abgang: null, ...bsp },
    { id: "bsp-ag-3", bezeichnung: "Laptop CAD", kategorie: "rechner", anschaffung_datum: plusMonate(heute, -6), ak_netto: 2400, nutzungsdauer: 1, methode: "linear", eingangsrechnung_id: "bsp-er-3", abgang: null, ...bsp },
    { id: "bsp-ag-4", bezeichnung: "Monitor", kategorie: "rechner", anschaffung_datum: plusMonate(heute, -3), ak_netto: 690, nutzungsdauer: 1, methode: "gwg", eingangsrechnung_id: "bsp-er-4", abgang: null, ...bsp },
    { id: "bsp-ag-5", bezeichnung: "Pkw elektrisch", kategorie: "fahrzeug", anschaffung_datum: `${Y - 1}-03-15`, ak_netto: 49500, nutzungsdauer: 6, methode: "linear", fahrzeug_id: "bsp-fz-1", abgang: null, ...bsp },
  ];
  const eingang = (id, lieferant, kategorie, netto, rechnungsdatum, faellig, bezahlt, extra = {}) => ({
    id, lieferant, kategorie, steuerfall: "regel19", fremd_nr: `F-${id.slice(-1)}01`, rechnungsdatum, leistungsdatum: rechnungsdatum,
    ...(() => { const b = betraege(netto); return { netto: b.netto, vorsteuer: b.ust, brutto: b.brutto }; })(),
    faellig_am: faellig, bezahlt_am: bezahlt, ...extra, ...bsp,
  });
  // The big item: structural engineer's final invoice, due on the 1st of the
  // month after next — the year clock shows a deficit and an uncovered tax date (79-10).
  const grossFaellig = plusMonate(`${heute.slice(0, 7)}-01`, 2);
  const eingangsrechnungen = [
    eingang("bsp-er-1", "Ingenieurbüro Beispiel", "sonstiges", 45000, plusTage(heute, -2), grossFaellig, null,
      { project_id: "proj-1", fremd_nr: "Tragwerksplanung Schlussrechnung" }),
    eingang("bsp-er-2", "Bürotechnik Beispiel", "sonstiges", 8900, anlagen[0].anschaffung_datum, plusTage(anlagen[0].anschaffung_datum, 14),
      plusTage(anlagen[0].anschaffung_datum, 10), { anlage_id: "bsp-ag-1" }),
    eingang("bsp-er-3", "Computerhandel Beispiel", "sonstiges", 2400, anlagen[2].anschaffung_datum, plusTage(anlagen[2].anschaffung_datum, 14),
      plusTage(anlagen[2].anschaffung_datum, 7), { anlage_id: "bsp-ag-3" }),
    eingang("bsp-er-4", "Computerhandel Beispiel", "sonstiges", 690, anlagen[3].anschaffung_datum, plusTage(anlagen[3].anschaffung_datum, 14),
      plusTage(anlagen[3].anschaffung_datum, 7), { anlage_id: "bsp-ag-4" }),
  ];
  eingangsrechnungen.slice(2).forEach((e, i) => {
    bank.push(bankSatz(7 + i, e.bezahlt_am, -e.brutto, `${e.fremd_nr} ${e.lieferant}`, e.lieferant,
      { typ: "Eingangsrechnung", id: e.id, modus: "manuell" }));
  });
  // Four open transactions for the reconciliation tab.
  bank.push(bankSatz(9, plusTage(heute, -3), -18.9, "Kontoführungsentgelt", "Hausbank Beispiel", null));
  bank.push(bankSatz(10, plusTage(heute, -9), 250, "Gutschrift ohne Verwendungszweck", "Unbekannt", null));
  bank.push(bankSatz(11, plusTage(heute, -16), -86.4, "Kartenzahlung Bürobedarf", "Papierhandel Beispiel", null));
  bank.push(bankSatz(12, plusTage(heute, -24), -77.35, "Lastschrift Telefon", "Telefonanbieter Beispiel", null));

  // --- Recurring expenses -----------------------------------------------------
  const wiederkehrend = (id, lieferant, kategorie, steuerfall, netto, rhythmus, start) => {
    const b = betraege(netto);
    const vorsteuer = steuerfall === "regel19" ? b.ust : 0;
    return { id, lieferant, kategorie, steuerfall, netto, vorsteuer, brutto: Math.round((netto + vorsteuer) * 100) / 100,
      rhythmus, start, aktiv: true, ...bsp };
  };
  const wiederkehrende = [
    wiederkehrend("bsp-wa-1", "Vermietung Beispiel GmbH", "miete", "regel19", 2000, "monat", `${Y - 1}-01-03`),
    wiederkehrend("bsp-wa-2", "CAD-Software Beispiel", "software", "regel19", 290, "monat", `${Y - 1}-01-15`),
    wiederkehrend("bsp-wa-3", "Bürosoftware Beispiel", "software", "regel19", 38, "monat", `${Y - 1}-01-20`),
    wiederkehrend("bsp-wa-4", "Telefonanbieter Beispiel", "sonstiges", "regel19", 65, "monat", `${Y - 1}-01-28`),
    wiederkehrend("bsp-wa-5", "Architektenkammer Beispiel", "kammer", "steuerfrei", 480, "jahr", `${Y - 1}-03-01`),
    wiederkehrend("bsp-wa-6", "Steuerberatung Beispiel", "sonstiges", "regel19", 1200, "quartal", `${Y - 1}-01-31`),
  ];

  // --- Insurance and one performance bond ----------------------------------------
  const versicherungen = [
    { id: "bsp-vs-1", typ: "berufshaftpflicht", versicherer: "Beispiel Versicherung AG", police: "BH-000001", deckung: 3000000,
      beginn: `${Y - 3}-01-01`, ende: `${Y + 1}-12-31`, kuendigung_tage: 90, praemie: 2800, zahlweise: "jahr",
      naechste_faelligkeit: `${Y + 1}-01-01`, ...bsp },
    { id: "bsp-vs-2", typ: "buergschaft", versicherer: "Beispiel Kreditversicherung AG", police: "VB-000002", project_id: "proj-1",
      beginn: `${Y - 1}-03-01`, ende: `${Y + 2}-03-01`, buergschaft_betrag: 25000, aval_prozent: 1.5, zahlweise: "jahr",
      praemie: 375, naechste_faelligkeit: `${Y}-03-01` > heute ? `${Y}-03-01` : `${Y + 1}-03-01`, ...bsp },
  ];

  // --- Owner and drawings (9,500 € on the 25th of every past month of Y) -------
  const gesellschafter = [{ id: "bsp-g1", name: "Inhaberin A", rolle: "inhaber", aktiv: true, entnahme_plan_monat: 9500, ...bsp }];
  const entnahmen = [];
  for (let m = 1; m <= 12; m++) {
    const datum = `${Y}-${String(m).padStart(2, "0")}-25`;
    if (datum > heute) break;
    entnahmen.push({ id: `bsp-en-${String(m).padStart(2, "0")}`, gesellschafter_id: "bsp-g1", datum, betrag: 9500, art: "ueberweisung", ...bsp });
  }

  // --- Tax payments of the past: income tax prepayments and the special VAT prepayment
  const steuerzahlungen = [];
  ["03-10", "06-10", "09-10", "12-10"].forEach((mmtt, q) => {
    const faellig = werktag(`${Y}-${mmtt}`);
    if (faellig > heute) return;
    steuerzahlungen.push({ id: `bsp-st-est-${q + 1}`, art: "est", zeitraum: { von: `${Y}-${String(q * 3 + 1).padStart(2, "0")}-01`,
      bis: plusTage(plusMonate(`${Y}-${String(q * 3 + 1).padStart(2, "0")}-01`, 3), -1) }, betrag: 9000, faellig_am: faellig, bezahlt_am: faellig, ...bsp });
  });
  const svzFaellig = werktag(`${Y}-02-10`);
  if (svzFaellig <= heute) {
    // 1/11 of last year's VAT (26,400 € → 2,400 €), § 47 UStDV.
    steuerzahlungen.push({ id: "bsp-st-svz", art: "ust_svz", zeitraum: null, betrag: 2400, faellig_am: svzFaellig, bezahlt_am: svzFaellig, ...bsp });
  }

  // --- Vehicles and trips --------------------------------------------------------
  // E-car bought in Y−1: ¼ rule (list price 58,800 € ≤ limit at acquisition), 12 km commute.
  const fahrzeuge = [
    { id: "bsp-fz-1", kennzeichen: "BSP-A 100E", nutzer: "Inhaberin A", nutzer_art: "gesellschafter", blp: 58800, antrieb: "elektro",
      co2_g_km: 0, e_reichweite_km: 420, anschaffung_datum: `${Y - 1}-03-15`, entfernung_km: 12, nutzung_ab: `${Y - 1}-03-15`,
      methode: "pauschal", kauf_leasing: "kauf", ...bsp },
    // Leased pool car with a logbook and business trips only (no private use).
    { id: "bsp-fz-2", kennzeichen: "BSP-A 200", nutzer: "", nutzer_art: "gesellschafter", blp: 42000, antrieb: "verbrenner",
      co2_g_km: 145, anschaffung_datum: `${Y - 1}-09-01`, entfernung_km: 0, nutzung_ab: `${Y - 1}-09-01`,
      methode: "fahrtenbuch", kauf_leasing: "leasing", ...bsp },
  ];
  const ziele = /** @type {Array<[string, string, string, number]>} */ ([
    ["Baustelle Nordhang", "Baubesprechung", "proj-1", 42], ["Bauamt Musterstadt", "Genehmigungsplanung", "proj-4", 18],
    ["Baustelle Parkseite", "Bauüberwachung", "proj-2", 36], ["Wohnpark am See", "Bestandsaufnahme", "proj-3", 58],
    ["Baustelle Nordhang", "Abnahme Rohbau", "proj-1", 42], ["Fachplaner Termin", "Koordination TGA", "proj-2", 24],
    ["Baustelle Parkseite", "Bemusterung Fassade", "proj-2", 36], ["Altstadthof", "Bestandsaufnahme", "proj-4", 12],
    ["Baustelle Nordhang", "Jour fixe", "proj-1", 42], ["Wohnpark am See", "Bauherrengespräch", "proj-3", 58],
  ]);
  let kmStand = 18400;
  /** @type {any[]} */
  const fahrten = ziele.map(([ziel, zweck, project_id, km], i) => {
    const km_start = kmStand;
    kmStand += km;
    return { id: `bsp-ft-${String(i + 1).padStart(2, "0")}`, fahrzeug_id: "bsp-fz-2", person: "Inhaberin A",
      datum: plusTage(heute, -8 * (10 - i)), ziel, zweck, km, km_start, km_ende: kmStand, art: "dienstlich", project_id, ...bsp };
  });
  // Mileage allowance with the private car.
  /** @type {Array<[string, string, string, number]>} */ ([["Baustelle Nordhang", "Mängelbegehung", "proj-1", 38], ["Bauamt Musterstadt", "Akteneinsicht", "proj-4", 54],
    ["Wohnpark am See", "Aufmaß", "proj-3", 22], ["Baustelle Parkseite", "Abnahme", "proj-2", 76]]).forEach(([ziel, zweck, project_id, km], i) => {
    fahrten.push({ id: `bsp-ft-${11 + i}`, fahrzeug_id: null, person: "Inhaberin A", datum: plusTage(heute, -11 * (4 - i) - 3),
      ziel, zweck, km, art: "dienstlich", project_id, ...bsp });
  });

  // --- Progress per work stage for two projects (only if none exists) ----------
  const vorhanden = new Set(Array.isArray(optionen.vorhandeneHoaiPlaene) ? optionen.vorhandeneHoaiPlaene : []);
  const hoaiPlaene = [
    { id: "bsp-hoai-proj-1", project_id: "proj-1", progress: [100, 100, 100, 100, 80, 45, 30, 10, 0], ...bsp },
    { id: "bsp-hoai-proj-2", project_id: "proj-2", progress: [100, 100, 90, 60, 20, 0, 0, 0, 0], ...bsp },
  ].filter((p) => !vorhanden.has(p.project_id));

  return {
    Setting: [setting],
    Honorarvertrag: vertraege,
    Ausgangsrechnung: ausgangsrechnungen,
    Eingangsrechnung: eingangsrechnungen,
    WiederkehrendeAusgabe: wiederkehrende,
    Versicherung: versicherungen,
    Steuerzahlung: steuerzahlungen,
    Gesellschafter: gesellschafter,
    Entnahme: entnahmen,
    Bankumsatz: bank,
    Fahrzeug: fahrzeuge,
    Fahrt: fahrten,
    Anlagegut: anlagen,
    Beleg: [],
    HoaiPlan: hoaiPlaene,
  };
}
