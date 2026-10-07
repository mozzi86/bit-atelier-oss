// Incoming invoices and expenses (phase 79, plan 79-04): categories and tax
// cases, recurring expenses (idempotent booking) and insurance/guarantees
// (due dates, cancellation warnings, pro-rata bond commission). Delivers the
// pure functions `offeneVorkommen`, `versicherungFaelligkeiten`,
// `erwarteteAusgaben`, `STEUERFAELLE` and `KATEGORIEN` the year clock (79-10)
// and the EÜR/DATEV export (79-11) build on — they stay in this file.
//
// In:  records of the data contract (datenmodell.js Eingangsrechnung,
//      WiederkehrendeAusgabe, Versicherung), a reference date range and the
//      DATEV account-chart constants of einstellungen.js.
// Out: pure, deterministic functions and two frozen registries.

import { parseTag, plusMonate, plusTage, tageZwischen } from "@core/lib/kalender/datum.js";
import { KONTENRAHMEN } from "./einstellungen.js";
import { wiederkehrendeVorkommen } from "./grundlagen.js";
import { ausBruttoCent, euroZuCent, rundeCent, ustCent } from "./geld.js";

/**
 * Category registry (Eingangsrechnung.kategorie, E-04): default tax case and
 * the DATEV account-CHART KEY (not the account number — that depends on the
 * office's chosen chart, einst.kontenrahmen, resolved by 79-11 through
 * saetze.kontenrahmen[…][konto]). `personal` = wages/salaries including the
 * managing director's salary at GmbH/UG; payroll bookings come from the
 * payroll office, so `datev: false` keeps this category out of the DATEV batch.
 * @type {Readonly<Record<string, {steuerfall: string, konto: string, datev: boolean}>>}
 */
export const KATEGORIEN = Object.freeze({
  miete: Object.freeze({ steuerfall: "regel19", konto: "miete", datev: true }),
  software: Object.freeze({ steuerfall: "regel19", konto: "software", datev: true }),
  versicherung: Object.freeze({ steuerfall: "versicherungsteuer", konto: "versicherung", datev: true }),
  kammer: Object.freeze({ steuerfall: "steuerfrei", konto: "kammer", datev: true }),
  fahrzeug: Object.freeze({ steuerfall: "regel19", konto: "fahrzeug", datev: true }),
  personal: Object.freeze({ steuerfall: "steuerfrei", konto: "personal", datev: false }),
  sonstiges: Object.freeze({ steuerfall: "regel19", konto: "sonstiges", datev: true }),
});

// DATEV posting keys (Buchungsschlüssel) for input VAT are identical in SKR03
// and SKR04 (einstellungen.js KONTENRAHMEN) and have not changed since they
// were introduced, so this pure registry reads the SKR03 row directly instead
// of taking a dated `saetze` snapshot for a value that never varies by date.
const BU = KONTENRAHMEN.SKR03[0].wert;

/**
 * Tax case registry (Eingangsrechnung.steuerfall). `vorsteuerSatz` in percent;
 * `bu` is the DATEV input-VAT posting key (79-11), null where no VAT posting
 * applies. § 13b (reverse charge): the supplier's invoice carries no VAT, the
 * recipient owes and deducts the same amount (79-05 VAT return) — `rc13b`
 * marks this so the return can book USt and VSt equally high.
 * @type {Readonly<Record<string, {vorsteuerSatz: number, bu: string|null, rc13b?: boolean}>>}
 */
export const STEUERFAELLE = Object.freeze({
  regel19: Object.freeze({ vorsteuerSatz: 19, bu: BU.bu_vst_19 }),
  regel7: Object.freeze({ vorsteuerSatz: 7, bu: BU.bu_vst_7 }),
  steuerfrei: Object.freeze({ vorsteuerSatz: 0, bu: null }),
  versicherungsteuer: Object.freeze({ vorsteuerSatz: 0, bu: null }),
  reverse_charge_13b: Object.freeze({ vorsteuerSatz: 0, bu: BU.bu_13b, rc13b: true }),
});

/**
 * Net/VAT/gross split from a gross amount, by tax case. Zero-rate tax cases
 * (steuerfrei, versicherungsteuer, reverse_charge_13b) return net = gross and
 * VAT = 0 — insurance tax is already inside the premium, § 13b shows no VAT on
 * the supplier's invoice at all.
 * @param {number} bruttoCent gross amount in cents
 * @param {string} steuerfall key of STEUERFAELLE (falls back to "regel19")
 * @returns {{netto: number, vorsteuer: number, brutto: number, rc13b: boolean}} cents
 */
export function betraegeAusBrutto(bruttoCent, steuerfall) {
  const info = STEUERFAELLE[steuerfall] || STEUERFAELLE.regel19;
  const brutto = rundeCent(bruttoCent);
  const rc13b = info.rc13b === true;
  if (info.vorsteuerSatz === 0) return { netto: brutto, vorsteuer: 0, brutto, rc13b };
  const { netto, ust } = ausBruttoCent(brutto, info.vorsteuerSatz);
  return { netto, vorsteuer: ust, brutto, rc13b };
}

/**
 * Net/VAT/gross split from a net amount, by tax case (see betraegeAusBrutto).
 * @param {number} nettoCent net amount in cents
 * @param {string} steuerfall key of STEUERFAELLE (falls back to "regel19")
 * @returns {{netto: number, vorsteuer: number, brutto: number, rc13b: boolean}} cents
 */
export function betraegeAusNetto(nettoCent, steuerfall) {
  const info = STEUERFAELLE[steuerfall] || STEUERFAELLE.regel19;
  const netto = rundeCent(nettoCent);
  const rc13b = info.rc13b === true;
  if (info.vorsteuerSatz === 0) return { netto, vorsteuer: 0, brutto: netto, rc13b };
  const vorsteuer = ustCent(netto, info.vorsteuerSatz);
  return { netto, vorsteuer, brutto: netto + vorsteuer, rc13b };
}

/**
 * Suggested tax case for a new incoming invoice of a category, with an
 * optional hint (a German source string — translate with t() at the call
 * site, like einstellungen.js REGEL_TABELLE labels) for the two categories
 * where 19 % is not automatic.
 * @param {string} kategorie key of KATEGORIEN
 * @returns {{steuerfall: string, hinweis: string|null}}
 */
export function steuerfallVorschlag(kategorie) {
  if (kategorie === "miete") {
    return { steuerfall: "regel19", hinweis: "Vorsteuerabzug nur bei wirksamer Option zur Umsatzsteuer (§ 9 UStG)" };
  }
  if (kategorie === "software") {
    return { steuerfall: "regel19", hinweis: "Bei Anbietern aus dem EU-Ausland ggf. § 13b (Reverse Charge) prüfen" };
  }
  const eintrag = KATEGORIEN[kategorie] || KATEGORIEN.sonstiges;
  return { steuerfall: eintrag.steuerfall, hinweis: null };
}

/**
 * German label of a category (literal t() calls, so the i18n guard sees them
 * — same pattern as StatusMarke.standardText).
 * @param {string} kategorie key of KATEGORIEN
 * @param {(schluessel: string) => string} t translator
 * @returns {string}
 */
export function kategorieText(kategorie, t) {
  switch (kategorie) {
    case "miete": return t("Miete");
    case "software": return t("Software");
    case "versicherung": return t("Versicherung");
    case "kammer": return t("Kammer");
    case "fahrzeug": return t("Fahrzeug");
    case "personal": return t("Personal");
    case "sonstiges": return t("Sonstiges");
    default: return kategorie;
  }
}

/**
 * Date input VAT becomes deductible on (§ 15 UStG): invoice received AND
 * service rendered, so the later of the two dates.
 * @param {{rechnungsdatum?: string, leistungsdatum?: string}} er
 * @returns {string|null} 'YYYY-MM-DD'
 */
export function vorsteuerDatum(er) {
  const r = parseTag(er?.rechnungsdatum);
  const l = parseTag(er?.leistungsdatum);
  if (r && l) return r > l ? r : l;
  return r || l || null;
}

/**
 * Occurrences of active recurring-expense templates in a date range that have
 * no recorded Eingangsrechnung yet (id `wa:<id>:<periode>` unused).
 * @param {{WiederkehrendeAusgabe?: any[], Eingangsrechnung?: any[]}} daten bh.daten
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {Array<{schluessel: string, datum: string, periode: string, vorlage: object}>}
 */
export function offeneVorkommen(daten, von, bis) {
  const vorlagen = Array.isArray(daten?.WiederkehrendeAusgabe) ? daten.WiederkehrendeAusgabe : [];
  const erfasst = new Set((Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : []).map((e) => e?.id));
  const aus = [];
  for (const vorlage of vorlagen) {
    for (const vk of wiederkehrendeVorkommen(vorlage, von, bis)) {
      if (!erfasst.has(vk.schluessel)) aus.push({ ...vk, vorlage });
    }
  }
  return aus;
}

/**
 * Occurrence date of one period label of a template — periodeVon() run
 * backwards, by scanning the same generator grundlagen.wiederkehrendeVorkommen
 * uses (the one source of truth for occurrence dates).
 * @param {Record<string, any>} vorlage a WiederkehrendeAusgabe (id, rhythmus, start, bis)
 * @param {string} periode e.g. "2026-02", "2026-Q1", "2026"
 * @returns {string|null}
 */
function vorkommenDatum(vorlage, periode) {
  const treffer = wiederkehrendeVorkommen(/** @type {any} */ (vorlage), vorlage?.start, "9999-12-31").find((v) => v.periode === periode);
  return treffer ? treffer.datum : null;
}

/**
 * Books one occurrence of a recurring expense as paid: an Eingangsrechnung
 * with the fixed id `wa:<id>:<periode>`. Idempotent through speicher.speichere
 * (get → update|create by id) — calling this twice for the same period
 * updates the same record instead of creating a second one.
 * @param {Record<string, any>} vorlage WiederkehrendeAusgabe
 * @param {string} periode period label as produced by wiederkehrendeVorkommen
 * @param {string} bezahltAm 'YYYY-MM-DD'
 * @returns {Record<string, any>} an Eingangsrechnung record (without a fresh id — speichere assigns one)
 * @throws {Error} when the period does not belong to the template
 */
export function vorkommenBezahlen(vorlage, periode, bezahltAm) {
  const datum = vorkommenDatum(vorlage, periode);
  if (!datum) throw new Error(`Wiederkehrende Ausgabe: Periode „${periode}“ liegt außerhalb der Vorlage.`);
  // Template-only fields (rhythmus/start/bis/aktiv) do not belong on the invoice.
  const rest = { ...vorlage };
  const vorlagenId = rest.id;
  delete rest.id; delete rest.rhythmus; delete rest.start; delete rest.bis; delete rest.aktiv;
  return {
    ...rest,
    id: `wa:${vorlagenId}:${periode}`,
    rechnungsdatum: datum,
    leistungsdatum: datum,
    faellig_am: datum,
    bezahlt_am: bezahltAm,
    wiederkehrend_id: vorlagenId,
    periode,
  };
}

/** Occurrences per year by payment interval (Versicherung.zahlweise). */
const SCHRITT_MONATE = Object.freeze({ monat: 1, quartal: 3, halbjahr: 6, jahr: 12 });

/**
 * Due dates of an insurance premium (or bond fee) in a date range, from
 * `naechste_faelligkeit` by the payment interval. `praemie` is the ANNUAL
 * premium; the per-occurrence amount is the annual premium divided by the
 * occurrences per year (monthly 1/12, quarterly 1/4, half-yearly 1/2, yearly
 * the whole amount). The schedule stops at the contract end (`ende`) when set.
 * @param {{naechste_faelligkeit?: string, zahlweise?: string, praemie?: number, ende?: string}} v Versicherung
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {Array<{datum: string, betrag: number}>} betrag in Euro
 */
export function versicherungFaelligkeiten(v, von, bis) {
  const start = parseTag(v?.naechste_faelligkeit);
  if (!start) return [];
  const schrittMonate = SCHRITT_MONATE[v?.zahlweise] || 12;
  const jeJahr = 12 / schrittMonate;
  const betragCent = Math.round(euroZuCent(v?.praemie) / jeJahr);
  const endeVertrag = parseTag(v?.ende);
  const ende = endeVertrag && endeVertrag < bis ? endeVertrag : bis;
  const aus = [];
  // 400 steps = 100 years even at the shortest (quarterly) interval; a safe bound.
  for (let k = 0; k < 400; k++) {
    const datum = /** @type {string} */ (plusMonate(start, k * schrittMonate));
    if (datum > ende) break;
    if (datum >= von) aus.push({ datum, betrag: betragCent / 100 });
  }
  return aus;
}

/**
 * Expected expenses for the liquidity plan and the year clock (79-06/79-10):
 * recorded, unpaid incoming invoices due in the window, plus open occurrences
 * of recurring templates, plus insurance/bond due dates that have no recorded
 * invoice of the same month yet. An occurrence already booked as an
 * Eingangsrechnung counts once (via the first group), never twice.
 * @param {{Eingangsrechnung?: any[], WiederkehrendeAusgabe?: any[], Versicherung?: any[]}} daten bh.daten
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {Array<{datum: string, cent: number, quelle: "eingangsrechnung"|"wiederkehrend"|"versicherung", id: string, lieferant: string, kategorie: string}>}
 */
export function erwarteteAusgaben(daten, von, bis) {
  const eingang = Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : [];
  /** @type {Array<{datum: string, cent: number, quelle: "eingangsrechnung"|"wiederkehrend"|"versicherung", id: string, lieferant: string, kategorie: string}>} */
  const posten = [];

  for (const e of eingang) {
    if (e?.bezahlt_am) continue;
    const faellig = parseTag(e?.faellig_am) || vorsteuerDatum(e);
    if (!faellig || faellig < von || faellig > bis) continue;
    posten.push({ datum: faellig, cent: euroZuCent(e.brutto), quelle: "eingangsrechnung", id: e.id, lieferant: e.lieferant || "", kategorie: e.kategorie || "sonstiges" });
  }

  for (const vk of offeneVorkommen(daten, von, bis)) {
    posten.push({ datum: vk.datum, cent: euroZuCent(vk.vorlage?.brutto), quelle: "wiederkehrend", id: vk.schluessel, lieferant: vk.vorlage?.lieferant || "", kategorie: vk.vorlage?.kategorie || "sonstiges" });
  }

  const versicherungen = Array.isArray(daten?.Versicherung) ? daten.Versicherung : [];
  // A recorded insurance invoice of the same month (rechnungsdatum) covers that due date.
  const erledigteMonate = new Set(
    eingang.filter((e) => e?.versicherung_id).map((e) => `${e.versicherung_id}:${String(e.rechnungsdatum || "").slice(0, 7)}`)
  );
  for (const v of versicherungen) {
    for (const f of versicherungFaelligkeiten(v, von, bis)) {
      if (erledigteMonate.has(`${v.id}:${f.datum.slice(0, 7)}`)) continue;
      posten.push({ datum: f.datum, cent: euroZuCent(f.betrag), quelle: "versicherung", id: v.id, lieferant: v.versicherer || "", kategorie: "versicherung" });
    }
  }

  return posten.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
}

/**
 * Status of a performance bond (Bürgschaft) on a day: term, days left, return
 * date, and the year's bond commission (Avalprovision) pro rata by days
 * act/365 within the term ∩ the calendar year of `heute`.
 * @param {{beginn?: string, ende?: string, buergschaft_betrag?: number, aval_prozent?: number, rueckgabe_am?: string}} v Versicherung (typ "buergschaft")
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {{beginn: string|null, ende: string|null, resttageBisEnde: number|null, rueckgabeAm: string|null, avalprovisionJahrCent: number, jahr: number}}
 */
export function buergschaftStatus(v, heute) {
  const beginn = parseTag(v?.beginn);
  const ende = parseTag(v?.ende);
  const jahr = Number(String(heute).slice(0, 4));
  const jahresAnfang = `${jahr}-01-01`;
  const jahresEnde = `${jahr}-12-31`;
  const von = beginn && beginn > jahresAnfang ? beginn : jahresAnfang;
  const bis = ende && ende < jahresEnde ? ende : jahresEnde;
  const tage = von <= bis ? /** @type {number} */ (tageZwischen(von, bis)) + 1 : 0;
  const betragCent = euroZuCent(v?.buergschaft_betrag) * ((v?.aval_prozent || 0) / 100) * (tage / 365);
  return {
    beginn,
    ende,
    resttageBisEnde: ende ? tageZwischen(heute, ende) : null,
    rueckgabeAm: v?.rueckgabe_am || ende || null,
    avalprovisionJahrCent: rundeCent(betragCent),
    jahr,
  };
}

/**
 * Insurance/bond policies expiring soon, or whose cancellation deadline
 * (`ende` − `kuendigung_tage`) is soon, within `tage` days of `heute`
 * (`ablauf_warn_tage`, [ASSUMED] BUERO_STANDARD). An already-past end date is
 * not a "coming due" warning any more.
 * @param {{Versicherung?: any[]}} daten bh.daten
 * @param {string} heute 'YYYY-MM-DD'
 * @param {number} tage warning window in days
 * @returns {Array<{id: string, typ: string, grund: "ablauf"|"kuendigungsfrist", datum: string}>}
 */
export function ablaufWarnungen(daten, heute, tage) {
  const versicherungen = Array.isArray(daten?.Versicherung) ? daten.Versicherung : [];
  const schwelle = plusTage(heute, tage);
  /** @type {Array<{id: string, typ: string, grund: "ablauf"|"kuendigungsfrist", datum: string}>} */
  const aus = [];
  for (const v of versicherungen) {
    const ende = parseTag(v?.ende);
    if (ende && ende >= heute && ende <= /** @type {string} */ (schwelle)) {
      aus.push({ id: v.id, typ: v.typ, grund: "ablauf", datum: ende });
    }
    if (ende && Number.isInteger(v?.kuendigung_tage)) {
      const kFrist = plusTage(ende, -v.kuendigung_tage);
      if (kFrist && kFrist >= heute && kFrist <= /** @type {string} */ (schwelle)) {
        aus.push({ id: v.id, typ: v.typ, grund: "kuendigungsfrist", datum: kFrist });
      }
    }
  }
  return aus;
}

/**
 * Table model of incoming invoices for CSV/XLSX export (79-RESEARCH
 * "CSV/XLSX-Export"; feeds ExportKnopf).
 * @param {{Eingangsrechnung?: any[]}} daten bh.daten
 * @param {(schluessel: string) => string} t translator (column labels, category text)
 * @param {{kategorie?: string, jahr?: number|string, nurOffen?: boolean}} [filter]
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function ausgabenTabelle(daten, t, filter = {}) {
  const alle = Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : [];
  const liste = alle.filter((e) => {
    if (filter.kategorie && e?.kategorie !== filter.kategorie) return false;
    if (filter.jahr && String(e?.rechnungsdatum || "").slice(0, 4) !== String(filter.jahr)) return false;
    if (filter.nurOffen && e?.bezahlt_am) return false;
    return true;
  });
  return {
    titel: t("Eingangsrechnungen"),
    spalten: [
      { key: "lieferant", label: t("Lieferant"), typ: "text" },
      { key: "kategorie", label: t("Kategorie"), typ: "text" },
      { key: "netto", label: t("Netto"), typ: "betrag" },
      { key: "vorsteuer", label: t("Vorsteuer"), typ: "betrag" },
      { key: "brutto", label: t("Brutto"), typ: "betrag" },
      { key: "rechnungsdatum", label: t("Rechnungsdatum"), typ: "datum" },
      { key: "faellig_am", label: t("Fällig am"), typ: "datum" },
      { key: "bezahlt_am", label: t("Bezahlt am"), typ: "datum" },
    ],
    zeilen: liste.map((e) => ({ ...e, kategorie: kategorieText(e.kategorie, t) })),
  };
}
