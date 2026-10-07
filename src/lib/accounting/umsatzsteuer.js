// VAT preview of the accounting module (79-05, BUCH-09/BUCH-18): USt from outgoing
// invoices minus Vorsteuer from incoming invoices = Zahllast/Erstattung, one row
// per filing period (monat/quartal/jahr — E-09), plus the due-date contract
// (ustTermine) the year clock (79-10) reads.
//
// Ist-Versteuerung (§ 20 UStG, E-10): VAT counts per payment, prorated
// (ust × payment / gross), rounded per payment. Soll: full VAT at the invoice
// date, EXCEPT installment invoices (art "abschlag"), which count per payment
// regardless of the switch (Mindest-Ist, § 13 Abs. 1 Nr. 1 Buchst. a S. 4 UStG).
// Vorsteuer always counts at max(invoice date, service date) — never at
// payment, even under Ist-Versteuerung. § 13b (reverse charge): the office owes
// VAT on its own incoming invoice and deducts the same amount as Vorsteuer in
// the same period (net effect zero) — modelled as a VAT contribution equal to
// the Eingangsrechnung's own Vorsteuer entry (netto × 19 %, § 12 Abs. 1 UStG).
//
// Sign convention: a cancellation (storno) is its own Ausgangsrechnung record
// with negative amounts (ausgangsrechnungen.storniere) — the ordinary per-payment
// / per-invoice-date rules already net it out, no special case needed here.
//
// Sondervorauszahlung (SVZ, § 47 Abs. 1 UStDV): monthly filers with a permanent
// extension pay, by 10 February of year N, 1/11 of year N−1's total VAT as the
// SVZ FOR year N. It is credited in the return for the last period of year N
// (December N, filed 10 February N+1 — § 48 Abs. 4 UStDV), NOT in December N−1,
// whose extended return merely shares the SVZ's own due date. voranmeldungen(N)
// therefore lists December N−1 credited with the SVZ of N−1, while December N
// (with the SVZ of N) is listed by voranmeldungen(N+1) — see
// sondervorauszahlungCent().
//
// ustTermine() never drops a period for a negative Zahllast (an Erstattung): the
// count of periods (12/4 + optional SVZ, or 0 for "jahr") is a fixed contract
// 79-10 depends on (T4 below); a negative betragCent simply means the period is
// an inflow, not an outflow — the year clock decides how to draw that.
//
// In:  Ausgangsrechnung/Eingangsrechnung/Steuerzahlung records (datenmodell.js),
//      effective settings (wirksameEinstellungen), legal rates (saetzeZum).
// Out: pure functions; no side effects, no clock reads (heute is always passed in).

import { jahrVon, monatVon, parseTag, quartalVon, tag, tageImMonat } from "@core/lib/kalender/datum.js";
import { centZuEuro, euroZuCent, rundeCent, ustCent } from "./geld.js";
import { rechtsformWirkung } from "./rechtsform.js";
import { ustTerminDaten } from "./steuertermine.js";

/**
 * @typedef {{von: string, bis: string}} Zeitraum
 */

/**
 * One VAT filing period contract entry, as 79-10 (year clock) reads it.
 * @typedef {{
 *   art: "ust"|"ust_svz", nenn: string, faellig: string, betragCent: number,
 *   zeitraum: Zeitraum|null, prognose: boolean, bezahlt: Record<string, any>|null,
 * }} UstTermin
 */

/**
 * The `art` values whose Ausgangsrechnung/Eingangsrechnung amounts still count
 * (issued documents); "geplant"/"entwurf" have no legal VAT effect yet.
 * @param {{status?: string}|null|undefined} beleg
 * @returns {boolean}
 */
function gestelltOderStorniert(beleg) {
  return beleg?.status === "gestellt" || beleg?.status === "storniert";
}

/** @param {string|null} datum @param {Zeitraum} zeitraum @returns {boolean} */
function inZeitraum(datum, zeitraum) {
  return Boolean(datum) && /** @type {string} */ (datum) >= zeitraum.von && /** @type {string} */ (datum) <= zeitraum.bis;
}

/**
 * The twelve months, four quarters or one whole year of a business year.
 * @param {number} jahr
 * @param {"monat"|"quartal"|"jahr"} art
 * @returns {Zeitraum[]}
 */
export function zeitraeume(jahr, art) {
  if (art === "jahr") return [{ von: tag(jahr, 1, 1), bis: tag(jahr, 12, 31) }];
  if (art !== "monat" && art !== "quartal") return [];
  const schritt = art === "monat" ? 1 : 3;
  /** @type {Zeitraum[]} */
  const liste = [];
  for (let m = 1; m <= 12; m += schritt) {
    const endMonat = m + schritt - 1;
    liste.push({ von: tag(jahr, m, 1), bis: tag(jahr, endMonat, tageImMonat(jahr, endMonat)) });
  }
  return liste;
}

/**
 * The filing period (month/quarter/year) a date falls into.
 * @param {string} datum 'YYYY-MM-DD'
 * @param {"monat"|"quartal"|"jahr"} art
 * @returns {Zeitraum|null}
 */
export function zeitraumVon(datum, art) {
  const d = parseTag(datum);
  if (!d) return null;
  const jahr = /** @type {number} */ (jahrVon(d));
  if (art === "jahr") return { von: tag(jahr, 1, 1), bis: tag(jahr, 12, 31) };
  if (art !== "monat" && art !== "quartal") return null;
  const startMonat = art === "monat" ? /** @type {number} */ (monatVon(d)) : (/** @type {number} */ (quartalVon(d)) - 1) * 3 + 1;
  const endMonat = startMonat + (art === "monat" ? 0 : 2);
  return { von: tag(jahr, startMonat, 1), bis: tag(jahr, endMonat, tageImMonat(jahr, endMonat)) };
}

/**
 * VAT of outgoing invoices falling into one filing period.
 * @param {ReadonlyArray<Record<string, any>>} rechnungen Ausgangsrechnung[]
 * @param {Zeitraum} zeitraum
 * @param {"ist"|"soll"} versteuerung
 * @returns {{cent: number, belege: Array<{id: string, nummer?: string, datum: string, cent: number}>}}
 */
export function ustAusgang(rechnungen, zeitraum, versteuerung) {
  const liste = Array.isArray(rechnungen) ? rechnungen : [];
  let cent = 0;
  /** @type {Array<{id: string, nummer?: string, datum: string, cent: number}>} */
  const belege = [];
  for (const r of liste) {
    if (!gestelltOderStorniert(r)) continue;
    const ustGesamtCent = euroZuCent(r.ust);
    const bruttoGesamtCent = euroZuCent(r.brutto);
    if (versteuerung === "ist" || r.art === "abschlag") {
      // Cash basis, or an installment invoice under either basis (Mindest-Ist):
      // each payment carries its proportional share of the invoice's VAT.
      if (bruttoGesamtCent === 0) continue;
      for (const z of Array.isArray(r.zahlungen) ? r.zahlungen : []) {
        const datum = parseTag(z?.datum);
        if (!datum || !inZeitraum(datum, zeitraum)) continue;
        const anteil = rundeCent((ustGesamtCent * euroZuCent(z.betrag)) / bruttoGesamtCent);
        cent += anteil;
        belege.push({ id: r.id, nummer: r.nummer, datum, cent: anteil });
      }
    } else {
      // Accrual basis: the full VAT counts once, at the invoice date.
      const datum = parseTag(r.rechnungsdatum);
      if (!datum || !inZeitraum(datum, zeitraum)) continue;
      cent += ustGesamtCent;
      belege.push({ id: r.id, nummer: r.nummer, datum, cent: ustGesamtCent });
    }
  }
  return { cent, belege };
}

/**
 * Deductible Vorsteuer of incoming invoices falling into one filing period
 * (by max(rechnungsdatum, leistungsdatum), never by payment).
 * @param {ReadonlyArray<Record<string, any>>} eingangsrechnungen
 * @param {Zeitraum} zeitraum
 * @returns {{cent: number, cent13b: number, belege: Array<{id: string, lieferant?: string, datum: string, cent: number, steuerfall?: string}>}}
 *   cent13b: the portion that is § 13b reverse charge (also owed as VAT, same period — see voranmeldungen()).
 */
export function vorsteuer(eingangsrechnungen, zeitraum) {
  const liste = Array.isArray(eingangsrechnungen) ? eingangsrechnungen : [];
  let cent = 0;
  let cent13b = 0;
  /** @type {Array<{id: string, lieferant?: string, datum: string, cent: number, steuerfall?: string}>} */
  const belege = [];
  for (const e of liste) {
    const kandidaten = [parseTag(e?.rechnungsdatum), parseTag(e?.leistungsdatum)].filter(Boolean).sort();
    const datum = kandidaten.length ? /** @type {string} */ (kandidaten[kandidaten.length - 1]) : null;
    if (!datum || !inZeitraum(datum, zeitraum)) continue;
    const ist13b = e?.steuerfall === "reverse_charge_13b";
    let vstCent;
    if (e?.steuerfall === "steuerfrei" || e?.steuerfall === "versicherungsteuer") vstCent = 0;
    else if (ist13b) vstCent = ustCent(euroZuCent(e.netto), 19);
    else vstCent = euroZuCent(e?.vorsteuer);
    cent += vstCent;
    if (ist13b) cent13b += vstCent;
    belege.push({ id: e.id, lieferant: e.lieferant, datum, cent: vstCent, steuerfall: e?.steuerfall });
  }
  return { cent, cent13b, belege };
}

/**
 * Prior year's total VAT payable (§ 47 Abs. 1 UStDV basis for the special
 * prepayment): the sum of recorded Steuerzahlung{art:"ust"} of that year, else
 * the office's own entry `einst.ust_vorjahr_zahllast[jahr]`.
 * @param {number} jahr the PRIOR year itself (e.g. 2025 for the SVZ due in 2026)
 * @param {{Steuerzahlung?: ReadonlyArray<Record<string, any>>}} daten
 * @param {{ust_vorjahr_zahllast?: Record<string, number>}} einst
 * @returns {number} cents (0 when nothing is recorded)
 */
export function vorjahrZahllastCent(jahr, daten, einst) {
  const liste = Array.isArray(daten?.Steuerzahlung) ? daten.Steuerzahlung : [];
  const summe = liste
    .filter((s) => s?.art === "ust" && typeof s?.zeitraum?.von === "string" && s.zeitraum.von.slice(0, 4) === String(jahr))
    .reduce((n, s) => n + euroZuCent(s.betrag), 0);
  if (summe !== 0) return summe;
  const eingabe = einst?.ust_vorjahr_zahllast?.[String(jahr)];
  return typeof eingabe === "number" && Number.isFinite(eingabe) ? euroZuCent(eingabe) : 0;
}

/**
 * The special prepayment (SVZ) FOR calendar year `jahr` (§ 47 Abs. 1 UStDV),
 * due 10 February of `jahr` and credited in the December return of `jahr`
 * (§ 48 Abs. 4 UStDV). A recorded Steuerzahlung{art:"ust_svz"} due in `jahr`
 * wins — it is the amount the office actually declared and paid; otherwise
 * anteil_elftel/11 of the prior year's total VAT (vorjahrZahllastCent(jahr − 1)),
 * rounded to whole cents.
 * @param {number} jahr the calendar year the SVZ belongs to (e.g. 2026 for the SVZ due 2026-02-10)
 * @param {{Steuerzahlung?: ReadonlyArray<Record<string, any>>}} daten
 * @param {{ust_vorjahr_zahllast?: Record<string, number>}} einst
 * @param {Record<string, any>} saetze saetzeZum(…) (steuertermine.svz: anteil_elftel, faellig)
 * @returns {number} cents (0 when neither a payment nor a prior-year total is known)
 */
export function sondervorauszahlungCent(jahr, daten, einst, saetze) {
  const svz = saetze?.steuertermine?.svz;
  const erfasst = bezahltStatus(daten, "ust_svz", null, `${jahr}-${svz?.faellig || "02-10"}`);
  if (erfasst && typeof erfasst.betrag === "number" && Number.isFinite(erfasst.betrag)) return euroZuCent(erfasst.betrag);
  const anteilElftel = Number(svz?.anteil_elftel) || 1;
  return rundeCent((vorjahrZahllastCent(jahr - 1, daten, einst) * anteilElftel) / 11);
}

/**
 * Prior year's turnover for the Ist-Versteuerung threshold (§ 20 S. 1 Nr. 1
 * UStG): net payment receipts of the prior year, overridable per year through
 * `einst.umsatz_vorjahr[jahr]`.
 * @param {number} jahr the PRIOR year itself
 * @param {{Ausgangsrechnung?: ReadonlyArray<Record<string, any>>}} daten
 * @param {{umsatz_vorjahr?: Record<string, number>}} einst
 * @returns {number} cents
 */
export function umsatzVorjahrCent(jahr, daten, einst) {
  const eingabe = einst?.umsatz_vorjahr?.[String(jahr)];
  if (typeof eingabe === "number" && Number.isFinite(eingabe)) return euroZuCent(eingabe);
  const zeitraum = { von: tag(jahr, 1, 1), bis: tag(jahr, 12, 31) };
  const liste = Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : [];
  let cent = 0;
  for (const r of liste) {
    if (!gestelltOderStorniert(r)) continue;
    const bruttoGesamtCent = euroZuCent(r.brutto);
    if (bruttoGesamtCent === 0) continue;
    const nettoGesamtCent = euroZuCent(r.netto);
    for (const z of Array.isArray(r.zahlungen) ? r.zahlungen : []) {
      const datum = parseTag(z?.datum);
      if (!datum || !inZeitraum(datum, zeitraum)) continue;
      cent += rundeCent((nettoGesamtCent * euroZuCent(z.betrag)) / bruttoGesamtCent);
    }
  }
  return cent;
}

/**
 * Whether the currently configured filing rhythm is probably too infrequent
 * given last year's VAT payable (informational only — the office decides).
 * @param {"monat"|"quartal"|"jahr"} ustZeitraum
 * @param {number} vorjahrZahllastCentWert cents (may be negative for a refund year)
 * @param {Record<string, any>} saetze saetzeZum(…)
 * @returns {"monat_pflicht"|"voranmeldung_pflicht"|null}
 */
export function periodenHinweis(ustZeitraum, vorjahrZahllastCentWert, saetze) {
  const quartalsgrenzeCent = euroZuCent(saetze?.ust?.quartalsgrenze);
  const befreiungCent = euroZuCent(saetze?.ust?.befreiung_voranmeldung);
  if (ustZeitraum === "jahr" && vorjahrZahllastCentWert > befreiungCent) return "voranmeldung_pflicht";
  if (ustZeitraum === "quartal" && vorjahrZahllastCentWert > quartalsgrenzeCent) return "monat_pflicht";
  return null;
}

/**
 * Whether Ist-Versteuerung (cash basis) is allowed for the office's legal form
 * (E-04): sole proprietors and partnerships always may as freelancers
 * (§ 20 S. 1 Nr. 3 UStG); GmbH/UG only up to the turnover threshold (Nr. 1).
 * @param {Record<string, any>} einst effective settings (rechtsform, gewst_aktiv, umsatz_vorjahr)
 * @param {{Ausgangsrechnung?: ReadonlyArray<Record<string, any>>}} daten
 * @param {number} jahr the business year being checked
 * @param {Record<string, any>} saetze saetzeZum(…)
 * @returns {{zulaessig: boolean, grund: "freiberufler"|"umsatzgrenze"|"soll_pflicht", umsatzVorjahrCent: number}}
 */
export function istVersteuerungPruefen(einst, daten, jahr, saetze) {
  const wirkung = rechtsformWirkung(einst);
  const vorjahrUmsatzCent = umsatzVorjahrCent(jahr - 1, daten, einst);
  if (wirkung.istFreiberuflerRegel) return { zulaessig: true, grund: "freiberufler", umsatzVorjahrCent: vorjahrUmsatzCent };
  const grenzeCent = euroZuCent(saetze?.ust?.ist_grenze);
  if (vorjahrUmsatzCent <= grenzeCent) return { zulaessig: true, grund: "umsatzgrenze", umsatzVorjahrCent: vorjahrUmsatzCent };
  return { zulaessig: false, grund: "soll_pflicht", umsatzVorjahrCent: vorjahrUmsatzCent };
}

/**
 * The Steuerzahlung record that already settles one filing period, if any.
 * @param {{Steuerzahlung?: ReadonlyArray<Record<string, any>>}} daten
 * @param {"ust"|"ust_svz"} art
 * @param {Zeitraum|null} zeitraum null for the SVZ (which has none of its own)
 * @param {string} faellig the period's own due date (SVZ: matched by year)
 * @returns {Record<string, any>|null}
 */
function bezahltStatus(daten, art, zeitraum, faellig) {
  const liste = Array.isArray(daten?.Steuerzahlung) ? daten.Steuerzahlung : [];
  if (art === "ust_svz") {
    const jahr = faellig?.slice(0, 4);
    return liste.find((s) => s?.art === "ust_svz" && typeof s?.faellig_am === "string" && s.faellig_am.slice(0, 4) === jahr) || null;
  }
  return liste.find((s) => s?.art === "ust" && s?.zeitraum?.von === zeitraum?.von && s?.zeitraum?.bis === zeitraum?.bis) || null;
}

/**
 * One row of voranmeldungen(): a filing period, the SVZ, or (ust_zeitraum
 * "jahr") the single annual-return row.
 * svzAnrechnung: the SVZ credited in this row, in cents (December rows of
 * monthly filers with extension; 0 elsewhere) — zahllast = ust − vst − svzAnrechnung.
 * @typedef {{
 *   zeitraum: Zeitraum|null, ust: number, vst: number, zahllast: number, svzAnrechnung: number, nenn: string|null, faellig: string|null,
 *   prognose: boolean, bezahlt: Record<string, any>|null, art: "ust"|"ust_svz", jahreserklaerung: boolean,
 *   ustBelege: Array<{id: string, nummer?: string, datum: string, cent: number}>,
 *   vstBelege: Array<{id: string, lieferant?: string, datum: string, cent: number, steuerfall?: string}>,
 * }} VoranmeldungsZeile
 */

/**
 * One VAT filing period row for the "Umsatzsteuer" tab: USt, Vorsteuer,
 * Zahllast (negative = Erstattung), due dates, whether it is still a forecast
 * (period not yet over) and any recorded payment. "jahr" (no advance returns,
 * E-09): a single "Jahreserklärung (Vorschau)" row over the whole year, without
 * nenn/faellig (§ 18 Abs. 4 UStG has no fixed date for the annual return).
 * Monthly filers with a permanent extension: one SVZ row for the SVZ of `jahr`
 * (due 10.02. of `jahr`), and every December row is credited with the SVZ of
 * its OWN calendar year (§ 48 Abs. 4 UStDV) — in this list that is December of
 * `jahr − 1`; December of `jahr` and its credit appear in voranmeldungen(jahr + 1).
 * @param {number} jahr calendar year the filing periods are listed for
 * @param {{Ausgangsrechnung?: any[], Eingangsrechnung?: any[], Steuerzahlung?: any[]}} daten
 * @param {Record<string, any>} einst effective settings (ust_zeitraum, dauerfrist, versteuerung, ust_vorjahr_zahllast)
 * @param {Record<string, any>} saetze saetzeZum(…)
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {VoranmeldungsZeile[]} sorted by nenn (the "jahr" case: exactly one row)
 */
export function voranmeldungen(jahr, daten, einst, saetze, heute) {
  const versteuerung = einst?.versteuerung === "soll" ? "soll" : "ist";
  const ausgang = Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : [];
  const eingang = Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : [];

  /** @param {Zeitraum} zeitraum */
  const berechne = (zeitraum) => {
    const a = ustAusgang(ausgang, zeitraum, versteuerung);
    const v = vorsteuer(eingang, zeitraum);
    const ust = a.cent + v.cent13b; // § 13b: the office's own reverse-charge output tax
    const vst = v.cent; // already includes the matching § 13b deduction
    return { ust, vst, zahllast: ust - vst, ustBelege: a.belege, vstBelege: v.belege };
  };

  if (einst?.ust_zeitraum === "jahr") {
    const zeitraum = { von: tag(jahr, 1, 1), bis: tag(jahr, 12, 31) };
    const { ust, vst, zahllast, ustBelege, vstBelege } = berechne(zeitraum);
    return [{
      zeitraum, ust, vst, zahllast, svzAnrechnung: 0, nenn: null, faellig: null, ustBelege, vstBelege,
      prognose: zeitraum.bis >= heute, bezahlt: null, art: "ust", jahreserklaerung: true,
    }];
  }

  const termine = ustTerminDaten(jahr, einst, saetze);
  /** @type {VoranmeldungsZeile[]} */
  const zeilen = termine.filter((t) => t.art === "ust").map((termin) => {
    const { ust, vst, zahllast, ustBelege, vstBelege } = berechne(/** @type {Zeitraum} */ (termin.zeitraum));
    return {
      zeitraum: termin.zeitraum, ust, vst, zahllast, svzAnrechnung: 0, nenn: termin.nenn, faellig: termin.faellig, ustBelege, vstBelege,
      prognose: /** @type {Zeitraum} */ (termin.zeitraum).bis >= heute,
      bezahlt: bezahltStatus(daten, "ust", /** @type {Zeitraum} */ (termin.zeitraum), termin.faellig),
      art: /** @type {"ust"} */ ("ust"), jahreserklaerung: false,
    };
  });

  const svzTermin = termine.find((t) => t.art === "ust_svz");
  if (svzTermin) {
    // § 48 Abs. 4 UStDV: the SVZ of year N is credited in the last period of N.
    // The December row listed here (December jahr−1, due 10.02. of jahr like the
    // SVZ row below) gets the SVZ of jahr−1 — never this year's SVZ, whose
    // matching due date is a coincidence of the one-month extension.
    const anrechnungMonat = Number(saetze?.steuertermine?.svz?.anrechnung_monat) || 12;
    for (const z of zeilen) {
      if (monatVon(z.zeitraum.bis) !== anrechnungMonat) continue;
      z.svzAnrechnung = sondervorauszahlungCent(/** @type {number} */ (jahrVon(z.zeitraum.bis)), daten, einst, saetze);
      z.zahllast -= z.svzAnrechnung;
    }
    zeilen.push({
      zeitraum: null, ust: 0, vst: 0, zahllast: sondervorauszahlungCent(jahr, daten, einst, saetze), svzAnrechnung: 0,
      nenn: svzTermin.nenn, faellig: svzTermin.faellig,
      ustBelege: [], vstBelege: [],
      prognose: svzTermin.faellig >= heute, bezahlt: bezahltStatus(daten, "ust_svz", null, svzTermin.faellig),
      art: "ust_svz", jahreserklaerung: false,
    });
  }

  return zeilen.sort((a, b) => (a.nenn < b.nenn ? -1 : a.nenn > b.nenn ? 1 : (a.art < b.art ? -1 : 1)));
}

/**
 * The due-date contract for the year clock (79-10): every VAT date whose
 * statutory date (nenn) falls in `jahr`, with the amount actually due. "jahr"
 * (no advance returns, E-09): always empty — no clock marks. A negative
 * betragCent (Erstattung) still gets its own entry: 79-10 reads the sign, the
 * COUNT of entries is the fixed part of the contract (T4 below).
 * @param {number} jahr
 * @param {{Ausgangsrechnung?: any[], Eingangsrechnung?: any[], Steuerzahlung?: any[]}} daten
 * @param {Record<string, any>} einst effective settings
 * @param {Record<string, any>} saetze saetzeZum(…)
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {UstTermin[]} sorted by nenn
 */
export function ustTermine(jahr, daten, einst, saetze, heute) {
  if (einst?.ust_zeitraum === "jahr") return [];
  return voranmeldungen(jahr, daten, einst, saetze, heute)
    .map((z) => ({
      art: z.art, nenn: /** @type {string} */ (z.nenn), faellig: /** @type {string} */ (z.faellig),
      betragCent: z.zahllast, zeitraum: z.zeitraum, prognose: z.prognose, bezahlt: z.bezahlt,
    }))
    .sort((a, b) => (a.nenn < b.nenn ? -1 : a.nenn > b.nenn ? 1 : (a.art < b.art ? -1 : 1)));
}

/**
 * Short text label of one row (for the table and the export): "MM/YYYY",
 * "QN/YYYY", "SVZ YYYY" or the annual-return label.
 * @param {{art: string, nenn: string|null, zeitraum: Zeitraum|null}} zeile
 * @param {(k: string) => string} t
 * @returns {string}
 */
export function periodeLabel(zeile, t) {
  if (zeile.art === "ust_svz") return `${t("SVZ")} ${zeile.nenn ? zeile.nenn.slice(0, 4) : ""}`.trim();
  if (/** @type {any} */ (zeile).jahreserklaerung) return t("Jahreserklärung (Vorschau)");
  const { von, bis } = zeile.zeitraum;
  const monate = (/** @type {number} */ (jahrVon(bis)) * 12 + /** @type {number} */ (monatVon(bis)))
    - (/** @type {number} */ (jahrVon(von)) * 12 + /** @type {number} */ (monatVon(von))) + 1;
  if (monate === 1) return `${von.slice(5, 7)}/${von.slice(0, 4)}`;
  return `Q${quartalVon(von)}/${von.slice(0, 4)}`;
}

/**
 * Exportable table of one year's VAT filing periods (CSV/XLSX via ExportKnopf).
 * @param {ReturnType<typeof voranmeldungen>} zeilen
 * @param {(k: string) => string} t
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function umsatzsteuerTabelle(zeilen, t) {
  return {
    titel: t("Umsatzsteuer"),
    spalten: [
      { key: "zeitraum", label: t("Zeitraum"), typ: "text" },
      { key: "ust", label: t("Umsatzsteuer"), typ: "betrag" },
      { key: "vorsteuer", label: t("Vorsteuer"), typ: "betrag" },
      { key: "zahllast", label: t("Zahllast/Erstattung"), typ: "betrag" },
      { key: "faellig", label: t("Fällig am"), typ: "datum" },
      { key: "bezahlt", label: t("Bezahlt am"), typ: "datum" },
    ],
    zeilen: (Array.isArray(zeilen) ? zeilen : []).map((z) => ({
      zeitraum: periodeLabel(z, t),
      ust: centZuEuro(z.ust),
      vorsteuer: centZuEuro(z.vst),
      zahllast: centZuEuro(z.zahllast),
      faellig: z.faellig || "",
      bezahlt: z.bezahlt?.bezahlt_am || "",
    })),
  };
}
