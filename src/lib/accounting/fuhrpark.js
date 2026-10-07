// Fleet: company cars, the 1 % rule, logbook comparison and mileage allowance
// (phase 79, plan 79-08, BUCH-12/BUCH-18). Private use of a car is either a
// flat rate (1 % of the reduced list price per month + 0.03 % per commute km,
// § 6 Abs. 1 Nr. 4 EStG) or a logbook comparison against the actual costs; a
// business trip with a PRIVATE car is a separate, simpler mileage allowance
// (0.30 €/km, § 9 Abs. 1 S. 3 Nr. 4a EStG, `Fahrt.fahrzeug_id === null`).
//
// Legal-form dependency (E-04, rechtsformWirkung().dienstwagen): a vehicle
// user with `nutzer_art: "gesellschafter"` is the owner/partner whose private
// use is a WITHDRAWAL (Nutzungsentnahme, EÜR) for every legal form except
// GmbH/UG — there the same person is a managing director, i.e. an EMPLOYEE,
// so the identical yearly value becomes a benefit in kind (geldwerter
// Vorteil, § 8 Abs. 2 EStG, informational only — booked through payroll, not
// this module). A vehicle user with `nutzer_art: "arbeitnehmer"` is always a
// benefit in kind, in every legal form.
//
// In:  Fahrzeug/Fahrt/Anlagegut/Eingangsrechnung records (datenmodell.js,
//      amounts in EURO), `saetze` (einstellungen.saetzeZum, GESETZ.DIENSTWAGEN/
//      REISEKOSTEN resolved for a reference date) and the effective settings
//      (wirksameEinstellungen, for the legal-form switch).
// Out: pure functions in CENTS (geld.js convention), plus literal t() text
//      helpers for enum labels and warnings (pattern of ausgaben.js
//      kategorieText / entnahmen.js artText).

import { jahrVon, monatVon, parseTag } from "@core/lib/kalender/datum.js";
import { eGrenzeFuer, hybridReichweiteFuer } from "./einstellungen.js";
import { centZuEuro, euroZuCent, rundeCent } from "./geld.js";
import { afaLinearCent } from "./grundlagen.js";
import { rechtsformWirkung } from "./rechtsform.js";

/** German amount, no thousands separator needed at these sizes (list prices, limits). @param {number} euro */
const euroText = (euro) => euro.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** @param {number} wert @returns {number} rounded to two decimals (percent, not money — geld.rundeCent is for cents) */
const rundeProzent = (wert) => Math.round(wert * 100) / 100;

/**
 * Reduction factor of the 1 % rule for one car, by DRIVETRAIN and ACQUISITION
 * date (never the start-of-use date — § 6 Abs. 1 Nr. 4 S. 2 Nr. 3–5 EStG ties
 * the reduced rates to when the car was bought). Electric cars up to the list-
 * price limit of their acquisition year get ¼; electric cars above it, and
 * plug-in hybrids meeting either the CO₂ or the range condition, get ½;
 * everything else (petrol/diesel cars, hybrids meeting neither condition, or
 * an electric car acquired outside the legislated staggering 2019–2030) is
 * the full rate. `grund` is the German sentence with the actual numbers (list
 * price / limit, or CO₂ / range); faktorGrund() gives the same sentence in the
 * page's language (79-13: the fleet tab and the car form show that one).
 * @param {{antrieb?: string, blp?: number, co2_g_km?: number, e_reichweite_km?: number, anschaffung_datum?: string}} fahrzeug
 * @param {{dienstwagen?: {hybrid_co2_max?: number}}} saetze einstellungen.saetzeZum(stichtag)
 * @returns {{faktor: 0.25|0.5|1, grund: string}}
 */
export function faktor(fahrzeug, saetze) {
  const befund = faktorBefund(fahrzeug, saetze);
  return { faktor: befund.faktor, grund: grundText(befund, (k) => k, "de") };
}

/**
 * The reason of faktor() as a sentence in the page's language (literal t()
 * calls with placeholders; numbers formatted for the language). With the
 * identity translator and "de" it is exactly faktor().grund.
 * @param {Parameters<typeof faktor>[0]} fahrzeug
 * @param {Parameters<typeof faktor>[1]} saetze
 * @param {(k: string) => string} t translator
 * @param {string} [sprache] "de" (default) or "en" — number format of the amounts
 * @returns {string}
 */
export function faktorGrund(fahrzeug, saetze, t, sprache = "de") {
  return grundText(faktorBefund(fahrzeug, saetze), t, sprache);
}

/**
 * @typedef {{faktor: 0.25|0.5|1, art: "e_ausserhalb"|"e_bis"|"e_ueber"|"hybrid_co2"|"hybrid_ausserhalb"|"reichweite_ok"|"reichweite_kurz"|"verbrenner",
 *   werte: {anschaffung?: string, grenze?: number, blp?: number, co2?: number, co2Max?: number, reichweite?: number}}} FaktorBefund
 */

/**
 * The one classification behind faktor() and faktorGrund().
 * @param {Parameters<typeof faktor>[0]} fahrzeug
 * @param {Parameters<typeof faktor>[1]} saetze
 * @returns {FaktorBefund}
 */
function faktorBefund(fahrzeug, saetze) {
  const anschaffung = fahrzeug?.anschaffung_datum || "?";
  const blp = Number(fahrzeug?.blp) || 0;

  if (fahrzeug?.antrieb === "elektro") {
    const grenze = eGrenzeFuer(fahrzeug?.anschaffung_datum);
    if (grenze === null) return { faktor: 1, art: "e_ausserhalb", werte: { anschaffung } };
    if (blp <= grenze) return { faktor: 0.25, art: "e_bis", werte: { grenze, blp } };
    return { faktor: 0.5, art: "e_ueber", werte: { grenze, blp } };
  }

  if (fahrzeug?.antrieb === "hybrid") {
    const co2Max = Number(saetze?.dienstwagen?.hybrid_co2_max) || 0;
    const co2 = Number(fahrzeug?.co2_g_km);
    if (Number.isFinite(co2) && co2 <= co2Max) return { faktor: 0.5, art: "hybrid_co2", werte: { co2, co2Max } };
    const grenze = hybridReichweiteFuer(fahrzeug?.anschaffung_datum);
    const reichweite = Number(fahrzeug?.e_reichweite_km) || 0;
    if (grenze === null) return { faktor: 1, art: "hybrid_ausserhalb", werte: { anschaffung } };
    if (reichweite >= grenze) return { faktor: 0.5, art: "reichweite_ok", werte: { reichweite, grenze } };
    return { faktor: 1, art: "reichweite_kurz", werte: { reichweite, grenze } };
  }

  return { faktor: 1, art: "verbrenner", werte: {} };
}

/**
 * Sentence of one classification (literal t() keys for the i18n guard).
 * @param {FaktorBefund} befund
 * @param {(k: string) => string} t
 * @param {string} sprache "de" | "en"
 * @returns {string}
 */
function grundText(befund, t, sprache) {
  const w = befund.werte;
  const betrag = (/** @type {number|undefined} */ euro) => (sprache === "en"
    ? Number(euro).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : euroText(Number(euro)));
  /** @param {string} text @param {Record<string, string|number|undefined>} werte */
  const fuelle = (text, werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
  switch (befund.art) {
    case "e_ausserhalb": return fuelle(t("Elektrofahrzeug außerhalb der gesetzlichen Staffel (Anschaffung {datum})"), { datum: w.anschaffung });
    case "e_bis": return fuelle(t("Elektrofahrzeug bis {grenze} € (BLP {blp} €)"), { grenze: betrag(w.grenze), blp: betrag(w.blp) });
    case "e_ueber": return fuelle(t("Elektrofahrzeug über {grenze} € (BLP {blp} €)"), { grenze: betrag(w.grenze), blp: betrag(w.blp) });
    case "hybrid_co2": return fuelle(t("Hybrid: CO₂ {co2} g/km ≤ {max} g/km"), { co2: w.co2, max: w.co2Max });
    case "hybrid_ausserhalb": return fuelle(t("Hybrid außerhalb der gesetzlichen Staffel (Anschaffung {datum})"), { datum: w.anschaffung });
    case "reichweite_ok": return fuelle(t("Reichweite {km} km ≥ {grenze} km"), { km: w.reichweite, grenze: w.grenze });
    case "reichweite_kurz": return fuelle(t("Reichweite {km} km < {grenze} km"), { km: w.reichweite, grenze: w.grenze });
    default: return t("Verbrenner");
  }
}

/**
 * Assessment base of the 1 % rule: list price × the reduction factor of
 * faktor(), rounded down to full 100 € — order `[ASSUMED]` (BMF-Schreiben
 * vom 05.11.2021, GESETZ.DIENSTWAGEN.blp_abrundung, annahme: true): the
 * rounding step happens AFTER the ¼/½ reduction, not before.
 * @param {{blp?: number, antrieb?: string, co2_g_km?: number, e_reichweite_km?: number, anschaffung_datum?: string}} fahrzeug
 * @param {{dienstwagen?: {hybrid_co2_max?: number, blp_abrundung?: number}}} saetze
 * @returns {number} cents
 */
export function bemessung(fahrzeug, saetze) {
  const blpCent = euroZuCent(fahrzeug?.blp);
  const geminderteCent = rundeCent(blpCent * faktor(fahrzeug, saetze).faktor);
  const rundungCent = euroZuCent(saetze?.dienstwagen?.blp_abrundung) || 10000;
  return Math.floor(geminderteCent / rundungCent) * rundungCent;
}

/**
 * Flat-rate monthly value of one car: the private-use share (1 % of the
 * assessment base) plus the commute share (0.03 % per distance km).
 * @param {{blp?: number, antrieb?: string, co2_g_km?: number, e_reichweite_km?: number,
 *   anschaffung_datum?: string, entfernung_km?: number}} fahrzeug
 * @param {{dienstwagen?: {hybrid_co2_max?: number, blp_abrundung?: number, pauschal_prozent?: number, entfernung_prozent?: number}}} saetze
 * @returns {{privat: number, fahrten: number, summe: number}} cents
 */
export function pauschalWertMonat(fahrzeug, saetze) {
  const bemessungCent = bemessung(fahrzeug, saetze);
  const privatProzent = Number(saetze?.dienstwagen?.pauschal_prozent) || 0;
  const entfernungProzent = Number(saetze?.dienstwagen?.entfernung_prozent) || 0;
  const entfernungKm = Number(fahrzeug?.entfernung_km) || 0;
  const privat = rundeCent((bemessungCent * privatProzent) / 100);
  const fahrten = rundeCent(((bemessungCent * entfernungProzent) / 100) * entfernungKm);
  return { privat, fahrten, summe: privat + fahrten };
}

/**
 * Months of `jahr` the car was actually in use, clipped to the year (an
 * unfinished month counts in full at both ends — § 7 Abs. 1 S. 4 EStG's AfA
 * rule applied the same way here, no legal provision of its own but the same
 * "whole month" convention as the rest of this app, grundlagen.afaLinearCent).
 * @param {{nutzung_ab?: string, nutzung_bis?: string, anschaffung_datum?: string}} fahrzeug
 * @param {number|string} jahr business year
 * @returns {number} whole months, 0–12
 */
export function monateInNutzung(fahrzeug, jahr) {
  const start = parseTag(fahrzeug?.nutzung_ab) || parseTag(fahrzeug?.anschaffung_datum);
  if (!start) return 0;
  const jahrZahl = Number(jahr);
  const startIndex = jahrVon(start) * 12 + /** @type {number} */ (monatVon(start)) - 1;
  const endeTag = parseTag(fahrzeug?.nutzung_bis);
  const endeIndex = endeTag ? jahrVon(endeTag) * 12 + /** @type {number} */ (monatVon(endeTag)) - 1 : Infinity;
  const von = Math.max(startIndex, jahrZahl * 12);
  const bis = Math.min(endeIndex, jahrZahl * 12 + 11);
  return Math.max(0, bis - von + 1);
}

/**
 * Flat-rate value of a whole business year: the monthly value times the
 * months actually in use.
 * @param {Parameters<typeof pauschalWertMonat>[0] & Parameters<typeof monateInNutzung>[0]} fahrzeug
 * @param {Parameters<typeof pauschalWertMonat>[1]} saetze
 * @param {number|string} jahr business year
 * @returns {{privat: number, fahrten: number, summe: number, monate: number}} cents
 */
export function pauschalJahr(fahrzeug, saetze, jahr) {
  const monate = monateInNutzung(fahrzeug, jahr);
  const monatswert = pauschalWertMonat(fahrzeug, saetze);
  return { privat: monatswert.privat * monate, fahrten: monatswert.fahrten * monate, summe: monatswert.summe * monate, monate };
}

/**
 * One warning of fahrtenbuchAuswertung(): a required field missing on one
 * trip, or a gap/overlap between the odometer readings of two consecutive
 * trips (sorted by `km_start`). `differenzKm` is the size of the gap/overlap.
 * @typedef {{typ: "pflichtfeld", fahrt_id: string, feld: string}
 *   | {typ: "luecke"|"ueberlappung", fahrt_id: string, differenzKm: number}} FahrtWarnung
 */

/**
 * Evaluates the logbook of one car: kilometres per trip purpose, the private
 * share and the commute ("Wohnung–Arbeitsstätte") share as percentages of the
 * total, and data-quality warnings. The two shares stay separate because
 * fahrtenbuchWert() needs their SUM (both are private use for tax purposes)
 * while the UI shows them apart.
 * @param {Array<{fahrzeug_id?: string|null, art?: string, km?: number, datum?: string, ziel?: string,
 *   zweck?: string, km_start?: number, km_ende?: number, id?: string}>} fahrten Fahrt records (any car — filtered here)
 * @param {{id?: string}} fahrzeug
 * @returns {{km: {dienstlich: number, privat: number, wohnung_arbeit: number, gesamt: number},
 *   privatanteil: number, wohnungArbeitAnteil: number, warnungen: FahrtWarnung[]}} km in km, shares in percent
 */
export function fahrtenbuchAuswertung(fahrten, fahrzeug) {
  const meine = (Array.isArray(fahrten) ? fahrten : []).filter((f) => f?.fahrzeug_id === fahrzeug?.id);
  const km = { dienstlich: 0, privat: 0, wohnung_arbeit: 0 };
  for (const f of meine) {
    const art = ["dienstlich", "privat", "wohnung_arbeit"].includes(f?.art) ? f.art : "dienstlich";
    km[/** @type {"dienstlich"|"privat"|"wohnung_arbeit"} */ (art)] += Number(f?.km) || 0;
  }
  const gesamt = km.dienstlich + km.privat + km.wohnung_arbeit;
  const anteil = (/** @type {number} */ n) => (gesamt > 0 ? rundeProzent((n / gesamt) * 100) : 0);

  /** @type {FahrtWarnung[]} */
  const warnungen = [];
  for (const f of meine) {
    for (const feld of ["datum", "ziel", "zweck", "km"]) {
      const wert = /** @type {any} */ (f)?.[feld];
      if (wert === undefined || wert === null || wert === "") warnungen.push({ typ: "pflichtfeld", fahrt_id: f?.id || "", feld });
    }
  }
  const mitKmStand = meine
    .filter((f) => Number.isFinite(f?.km_start) && Number.isFinite(f?.km_ende))
    .slice()
    .sort((a, b) => /** @type {number} */ (a.km_start) - /** @type {number} */ (b.km_start));
  for (let i = 1; i < mitKmStand.length; i++) {
    const vorher = mitKmStand[i - 1];
    const jetzt = mitKmStand[i];
    const differenz = /** @type {number} */ (jetzt.km_start) - /** @type {number} */ (vorher.km_ende);
    if (differenz > 0) warnungen.push({ typ: "luecke", fahrt_id: jetzt.id || "", differenzKm: differenz });
    else if (differenz < 0) warnungen.push({ typ: "ueberlappung", fahrt_id: jetzt.id || "", differenzKm: -differenz });
  }

  return { km: { ...km, gesamt }, privatanteil: anteil(km.privat), wohnungArbeitAnteil: anteil(km.wohnung_arbeit), warnungen };
}

/**
 * Yearly running cost of one car for the logbook comparison: incoming
 * invoices booked against it (net) plus the depreciation of the fixed asset
 * linked to it (grundlagen.afaLinearCent — the data contract of 79-01: a
 * purchased car's AfA lives in Anlagegut.fahrzeug_id, not in this module). A
 * leased car with no such Anlagegut simply has 0 AfA; its incoming invoices
 * (the leasing rate) still count.
 * @param {{Eingangsrechnung?: Array<Record<string, any>>, Anlagegut?: Array<Record<string, any>>}} daten bh.daten
 * @param {{id?: string}} fahrzeug
 * @param {number|string} jahr business year
 * @returns {number} cents
 */
export function fahrzeugKosten(daten, fahrzeug, jahr) {
  const rechnungenCent = (Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : [])
    .filter((e) => e?.fahrzeug_id === fahrzeug?.id && String(e?.rechnungsdatum || "").slice(0, 4) === String(jahr))
    .reduce((n, e) => n + euroZuCent(e?.netto), 0);
  const afaCent = (Array.isArray(daten?.Anlagegut) ? daten.Anlagegut : [])
    .filter((a) => a?.fahrzeug_id === fahrzeug?.id)
    .reduce((n, a) => {
      try {
        return n + afaLinearCent(euroZuCent(a.ak_netto), a.nutzungsdauer, a.anschaffung_datum, Number(jahr), a.abgang || null);
      } catch {
        return n; // malformed asset record — do not let one bad row break the whole comparison
      }
    }, 0);
  return rechnungenCent + afaCent;
}

/**
 * Logbook value of one car for `jahr`: its running cost times the combined
 * private + commute share (fahrtenbuchAuswertung — both count as private use
 * for the withdrawal/benefit-in-kind assessment).
 * @param {{Eingangsrechnung?: Array<Record<string, any>>, Anlagegut?: Array<Record<string, any>>, Fahrt?: Array<Record<string, any>>}} daten bh.daten
 * @param {{id?: string}} fahrzeug
 * @param {number|string} jahr business year
 * @returns {number} cents
 */
export function fahrtenbuchWert(daten, fahrzeug, jahr) {
  const auswertung = fahrtenbuchAuswertung(daten?.Fahrt, fahrzeug);
  const kostenCent = fahrzeugKosten(daten, fahrzeug, jahr);
  const anteilProzent = auswertung.privatanteil + auswertung.wohnungArbeitAnteil;
  return rundeCent((kostenCent * anteilProzent) / 100);
}

/**
 * Compares the two methods for one car and names the cheaper one (ties go to
 * the flat rate — the simpler method, nothing to gain from switching).
 * @param {number} pauschalCent flat-rate yearly value, cents
 * @param {number} fahrtenbuchCent logbook yearly value, cents
 * @returns {{pauschal: number, fahrtenbuch: number, guenstiger: "pauschal"|"fahrtenbuch"}}
 */
export function vergleich(pauschalCent, fahrtenbuchCent) {
  return { pauschal: pauschalCent, fahrtenbuch: fahrtenbuchCent, guenstiger: fahrtenbuchCent < pauschalCent ? "fahrtenbuch" : "pauschal" };
}

/**
 * Yearly value of one car under ITS OWN chosen method (Fahrzeug.methode) —
 * the figure actually booked, as opposed to vergleich()'s "which would be
 * cheaper" advisory. `monatCent` is only meaningful for the flat rate (a
 * logbook has no fixed monthly figure of its own); it is null for a logbook car.
 * @param {Parameters<typeof fahrzeugKosten>[0] & Parameters<typeof pauschalWertMonat>[1]} daten bh.daten, doubling as `saetze` fields read by pauschalWertMonat — see call sites (passed separately in practice)
 * @param {{id?: string, methode?: string} & Parameters<typeof pauschalJahr>[0]} fahrzeug
 * @param {number|string} jahr business year
 * @param {Parameters<typeof pauschalWertMonat>[1]} saetze
 * @returns {{monatCent: number|null, jahrCent: number}}
 */
export function fahrzeugJahreswert(daten, fahrzeug, jahr, saetze) {
  if (fahrzeug?.methode === "fahrtenbuch") return { monatCent: null, jahrCent: fahrtenbuchWert(daten, fahrzeug, jahr) };
  return { monatCent: pauschalWertMonat(fahrzeug, saetze).summe, jahrCent: pauschalJahr(fahrzeug, saetze, jahr).summe };
}

/**
 * One row of nutzungsentnahme()/geldwerterVorteil(): one car's booked yearly
 * value under its own method.
 * @typedef {{fahrzeug_id: string, kennzeichen: string, jahreswertCent: number, ustBemessungCent?: number}} FuhrparkZeile
 */

/**
 * Owner's/partner's withdrawal for private car use (E-04): every car whose
 * user is `nutzer_art: "gesellschafter"`, but ONLY while the legal form
 * treats that as a withdrawal (rechtsformWirkung().dienstwagen ===
 * "nutzungsentnahme" — sole proprietor, GbR, PartG). A GmbH/UG's "partner" is
 * really its managing director, an employee — there the identical value
 * moves to geldwerterVorteil() instead, this function then returns nothing.
 * `ustBemessungCent` is `[ASSUMED]` 80 % of the yearly value (informational
 * only, no VAT return is filed by this app — a common simplification when the
 * exact private-use VAT split per car has not been surveyed).
 * @param {{Fahrzeug?: Array<Record<string, any>>} & Parameters<typeof fahrzeugKosten>[0]} daten bh.daten
 * @param {number|string} jahr business year
 * @param {Parameters<typeof pauschalWertMonat>[1]} saetze
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown}} einst effective settings
 * @returns {{zeilen: FuhrparkZeile[], summeCent: number}}
 */
export function nutzungsentnahme(daten, jahr, saetze, einst) {
  if (rechtsformWirkung(einst).dienstwagen !== "nutzungsentnahme") return { zeilen: [], summeCent: 0 };
  const zeilen = (Array.isArray(daten?.Fahrzeug) ? daten.Fahrzeug : [])
    .filter((f) => f?.nutzer_art === "gesellschafter")
    .map((f) => {
      const jahreswertCent = fahrzeugJahreswert(daten, f, jahr, saetze).jahrCent;
      return { fahrzeug_id: f.id, kennzeichen: f.kennzeichen, jahreswertCent, ustBemessungCent: rundeCent(jahreswertCent * 0.8) };
    });
  return { zeilen, summeCent: zeilen.reduce((n, z) => n + z.jahreswertCent, 0) };
}

/**
 * Benefit in kind (§ 8 Abs. 2 EStG, informational only — booked through
 * payroll, not this module): every car whose user is `nutzer_art:
 * "arbeitnehmer"` (any legal form), PLUS every `"gesellschafter"` car when the
 * legal form makes that person a managing director/employee instead (GmbH/UG
 * — see nutzungsentnahme()).
 * @param {{Fahrzeug?: Array<Record<string, any>>} & Parameters<typeof fahrzeugKosten>[0]} daten bh.daten
 * @param {number|string} jahr business year
 * @param {Parameters<typeof pauschalWertMonat>[1]} saetze
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown}} einst effective settings
 * @returns {{zeilen: FuhrparkZeile[], summeCent: number}}
 */
export function geldwerterVorteil(daten, jahr, saetze, einst) {
  const wirkung = rechtsformWirkung(einst);
  const zeilen = (Array.isArray(daten?.Fahrzeug) ? daten.Fahrzeug : [])
    .filter((f) => f?.nutzer_art === "arbeitnehmer" || (f?.nutzer_art === "gesellschafter" && wirkung.dienstwagen === "geldwerter_vorteil"))
    .map((f) => ({ fahrzeug_id: f.id, kennzeichen: f.kennzeichen, jahreswertCent: fahrzeugJahreswert(daten, f, jahr, saetze).jahrCent }));
  return { zeilen, summeCent: zeilen.reduce((n, z) => n + z.jahreswertCent, 0) };
}

/**
 * Mileage allowance for business trips with a PRIVATE car (§ 9 Abs. 1 S. 3
 * Nr. 4a EStG, `Fahrt.fahrzeug_id === null`), grouped by month, person and
 * project (a trip without a project groups under `project_id: null`).
 * @param {Array<{fahrzeug_id?: string|null, person?: string, datum?: string, km?: number, project_id?: string}>} fahrten Fahrt records (any car — filtered here)
 * @param {{reisekosten?: {km_satz?: number}}} saetze
 * @returns {{zeilen: Array<{monat: string, person: string, project_id: string|null, km: number, betragCent: number}>,
 *   summeCent: number, summeKm: number}} `monat` 'YYYY-MM'
 */
export function kilometergeld(fahrten, saetze) {
  const kmSatz = Number(saetze?.reisekosten?.km_satz) || 0;
  const liste = (Array.isArray(fahrten) ? fahrten : []).filter((f) => f?.fahrzeug_id === null || f?.fahrzeug_id === undefined);
  /** @type {Map<string, {monat: string, person: string, project_id: string|null, km: number}>} */
  const gruppen = new Map();
  for (const f of liste) {
    const monat = String(f?.datum || "").slice(0, 7);
    const person = f?.person || "";
    const projectId = f?.project_id || null;
    const schluessel = `${monat}|${person}|${projectId}`;
    const bestehend = gruppen.get(schluessel) || { monat, person, project_id: projectId, km: 0 };
    bestehend.km += Number(f?.km) || 0;
    gruppen.set(schluessel, bestehend);
  }
  const zeilen = [...gruppen.values()]
    .map((z) => ({ ...z, betragCent: rundeCent(z.km * kmSatz * 100) }))
    .sort((a, b) => (a.monat < b.monat ? -1 : a.monat > b.monat ? 1 : 0));
  return { zeilen, summeCent: zeilen.reduce((n, z) => n + z.betragCent, 0), summeKm: liste.reduce((n, f) => n + (Number(f?.km) || 0), 0) };
}

/**
 * Table model of the fleet for CSV/XLSX export (ExportKnopf): one row per car
 * with its master data and this year's booked value under its own method.
 * @param {{Fahrzeug?: Array<Record<string, any>>} & Parameters<typeof fahrzeugKosten>[0]} daten bh.daten
 * @param {number|string} jahr business year
 * @param {(schluessel: string) => string} t translator (column labels, enum text)
 * @param {Parameters<typeof pauschalWertMonat>[1]} saetze needed to price flat-rate cars — not part of the plan's
 *   literal 3-argument signature, added because the table cannot show a Euro value without it (see 79-08-SUMMARY)
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function fuhrparkTabelle(daten, jahr, t, saetze) {
  const liste = Array.isArray(daten?.Fahrzeug) ? daten.Fahrzeug : [];
  return {
    titel: t("Fuhrpark"),
    spalten: [
      { key: "kennzeichen", label: t("Kennzeichen"), typ: "text" },
      { key: "nutzer", label: t("Nutzer"), typ: "text" },
      { key: "antrieb", label: t("Antrieb"), typ: "text" },
      { key: "blp", label: t("Bruttolistenpreis"), typ: "betrag" },
      { key: "methode", label: t("Methode"), typ: "text" },
      { key: "jahreswert", label: t("Jahreswert"), typ: "betrag" },
    ],
    zeilen: liste.map((f) => ({
      kennzeichen: f.kennzeichen, nutzer: f.nutzer || "", antrieb: antriebText(f.antrieb, t),
      blp: f.blp || 0, methode: methodeText(f.methode, t),
      jahreswert: centZuEuro(fahrzeugJahreswert(daten, f, jahr, saetze).jahrCent),
    })),
  };
}

/**
 * Label of a "gesellschafter"-type user, by legal form (the plan's own 3
 * forms — distinct from entnahmen.js personTitel, which also spells out
 * "Partner/in" for a PartG; here GbR and PartG share one wording because a
 * partner's car is still just a partner's car, not a role the fee side cares
 * to distinguish).
 * @param {string} rechtsform key of RECHTSFORMEN
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function nutzerLabel(rechtsform, t) {
  if (rechtsform === "gmbh" || rechtsform === "ug") return t("Gesellschafter-Geschäftsführer/in");
  if (rechtsform === "gbr" || rechtsform === "partg") return t("Gesellschafter/in");
  return t("Inhaber/in");
}

/** @param {string} antrieb @param {(k: string) => string} t */
export function antriebText(antrieb, t) {
  switch (antrieb) {
    case "elektro": return t("Elektro");
    case "hybrid": return t("Hybrid");
    default: return t("Verbrenner");
  }
}

/** @param {string} methode @param {(k: string) => string} t */
export function methodeText(methode, t) {
  return methode === "fahrtenbuch" ? t("Fahrtenbuch") : t("1 %-Regel");
}

/** @param {string} kaufLeasing @param {(k: string) => string} t */
export function kaufLeasingText(kaufLeasing, t) {
  return kaufLeasing === "leasing" ? t("Leasing") : t("Kauf");
}

/** @param {string} nutzerArt @param {(k: string) => string} t */
export function nutzerArtText(nutzerArt, t) {
  return nutzerArt === "arbeitnehmer" ? t("Arbeitnehmer/in") : t("Gesellschafter/in");
}

/**
 * Text of one fahrtenbuchAuswertung() warning (literal t() calls for the i18n
 * guard — pattern of ausgaben.js ablaufWarnungen's key + VersicherungenAbschnitt).
 * @param {FahrtWarnung} warnung
 * @param {(k: string) => string} t
 * @returns {string}
 */
export function warnungText(warnung, t) {
  switch (warnung.typ) {
    case "luecke": return `${t("Lücke im Kilometerstand")}: ${warnung.differenzKm} km`;
    case "ueberlappung": return `${t("Überlappung im Kilometerstand")}: ${warnung.differenzKm} km`;
    case "pflichtfeld": return `${t("Pflichtfeld fehlt")}: ${pflichtfeldText(warnung.feld, t)}`;
    default: return String(/** @type {any} */ (warnung).typ); // exhaustive by typedef — defensive only
  }
}

/** @param {string} feld "datum"|"ziel"|"zweck"|"km" @param {(k: string) => string} t */
function pflichtfeldText(feld, t) {
  switch (feld) {
    case "datum": return t("Datum");
    case "ziel": return t("Ziel");
    case "zweck": return t("Zweck");
    case "km": return t("Kilometer");
    default: return feld;
  }
}
