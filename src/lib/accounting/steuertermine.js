// Tax dates of the office (phase 79): income/corporate/trade tax prepayments and
// the VAT return dates according to the VAT switch (E-09). Only dates — the
// amounts are set by 79-05 (VAT preview) and 79-10 (year clock).
//
// Two dates per entry: `nenn` is the statutory date (the red "send invoices by"
// mark counts back from it), `faellig` the date moved to the next working day
// (§ 108 Abs. 3 AO), which the liquidity check uses.
//
// In:  year, effective settings (wirksameEinstellungen), rates (saetzeZum).
// Out: vorauszahlungsTermine, ustTerminDaten, steuerartenFuer.

import { naechsterArbeitstag, naechsterWerktag } from "@core/lib/kalender/arbeitstage.js";
import { feiertage } from "@core/lib/kalender/feiertage.js";
import { plusMonate, plusTage, tag, tageImMonat } from "@core/lib/kalender/datum.js";
import { saetzeZum } from "./einstellungen.js";
import { rechtsformWirkung } from "./rechtsform.js";

/**
 * One tax date.
 * @typedef {{
 *   art: "est"|"kst"|"gewst"|"ust"|"ust_svz",
 *   nenn: string,
 *   faellig: string,
 *   quartal?: number,
 *   zeitraum?: {von: string, bis: string}|null,
 * }} Steuertermin
 */

/**
 * Due day of a tax date under § 108 Abs. 3 AO: the statutory day, or the next
 * working day when it falls on a weekend or public holiday. The holidays that
 * count are those at the seat of the tax office — the office calendar
 * (Regelwerk "kalender": state and the two switchable Bavarian days), the same
 * one Fristen, absences and controlling use (94/96: one calendar). Without a
 * calendar only the nation-wide holidays apply (GESETZ.FEIERTAGE_BUND).
 * @param {string} nenn statutory day 'YYYY-MM-DD'
 * @param {{bundesland?: string, mariae_himmelfahrt?: boolean, augsburger_friedensfest?: boolean}|null|undefined} [kalender]
 *   office calendar (kalenderEinstellung); null → nation-wide holidays only
 * @returns {string} due day 'YYYY-MM-DD'
 */
export function steuerFaellig(nenn, kalender = null) {
  if (!kalender) return /** @type {string} */ (naechsterWerktag(nenn));
  const jahr = Number(String(nenn).slice(0, 4));
  return /** @type {string} */ (naechsterArbeitstag(nenn, [...feiertage(jahr, kalender), ...feiertage(jahr + 1, kalender)]));
}

/**
 * Prepayment dates of one tax in a year (§ 37 Abs. 1 EStG, § 31 KStG,
 * § 19 Abs. 1 GewStG — dates from GESETZ.STEUERTERMINE).
 * @param {number} jahr year
 * @param {"est"|"kst"|"gewst"} art tax
 * @param {Record<string, any>} [saetze] saetzeZum(…); default: rates of 1 January of `jahr`
 * @param {{bundesland?: string, mariae_himmelfahrt?: boolean, augsburger_friedensfest?: boolean}|null} [kalender] office calendar (steuerFaellig); null → nation-wide holidays
 * @returns {Steuertermin[]} four dates, quarter 1–4
 */
export function vorauszahlungsTermine(jahr, art, saetze = saetzeZum(`${jahr}-01-01`), kalender = null) {
  const termine = /** @type {string[]|undefined} */ (saetze?.steuertermine?.[art]);
  if (!Array.isArray(termine)) return [];
  return termine.map((mmtt, i) => {
    const nenn = `${jahr}-${mmtt}`;
    return { art, nenn, faellig: steuerFaellig(nenn, kalender), quartal: i + 1 };
  });
}

/**
 * VAT return dates whose statutory date falls in `jahr` — including the period
 * of the previous year that is filed in January/February. Statutory date: the
 * 10th day after the end of the period (§ 18 Abs. 1 UStG), one month later with
 * the permanent extension (§§ 46–48 UStDV). Monthly filers with extension also
 * pay the special prepayment on 10.02. (§ 47 UStDV). `ust_zeitraum: "jahr"`
 * means no advance returns at all (E-09): empty list, the extension has no effect.
 * @param {number} jahr year
 * @param {{ust_zeitraum?: string, dauerfrist?: boolean, kalender?: {bundesland?: string, mariae_himmelfahrt?: boolean, augsburger_friedensfest?: boolean}|null}} einst effective settings (kalender: office calendar, steuerFaellig)
 * @param {Record<string, any>} [saetze] saetzeZum(…); default: rates of 1 January of `jahr`
 * @returns {Steuertermin[]} sorted by statutory date
 */
export function ustTerminDaten(jahr, einst, saetze = saetzeZum(`${jahr}-01-01`)) {
  const zeitraum = einst?.ust_zeitraum;
  if (zeitraum !== "monat" && zeitraum !== "quartal") return [];
  const fristTag = Number(saetze?.steuertermine?.ust) || 10;
  const dfv = einst?.dauerfrist === true ? Number(saetze?.steuertermine?.dauerfrist_monate) || 1 : 0;
  const schritt = zeitraum === "monat" ? 1 : 3;

  /** @type {Steuertermin[]} */
  const liste = [];
  // Periods from two years back cover every period whose date can land in `jahr`.
  for (let beginnMonat = 1; beginnMonat <= 36; beginnMonat += schritt) {
    const y = jahr - 2 + Math.floor((beginnMonat - 1) / 12);
    const m = ((beginnMonat - 1) % 12) + 1;
    const von = tag(y, m, 1);
    const endMonat = m + schritt - 1;
    const bis = tag(y, endMonat, tageImMonat(y, endMonat));
    // 10th day after the end of the period = day `fristTag` of the following month (+ extension).
    const nenn = /** @type {string} */ (plusTage(/** @type {string} */ (plusMonate(tag(y, endMonat, 1), 1 + dfv)), fristTag - 1));
    if (Number(nenn.slice(0, 4)) !== jahr) continue;
    liste.push({ art: "ust", nenn, faellig: steuerFaellig(nenn, einst?.kalender), zeitraum: { von, bis } });
  }
  if (zeitraum === "monat" && dfv > 0) {
    const svz = saetze?.steuertermine?.svz;
    const nenn = `${jahr}-${svz?.faellig || "02-10"}`;
    liste.push({ art: "ust_svz", nenn, faellig: steuerFaellig(nenn, einst?.kalender), zeitraum: null });
  }
  return liste.sort((a, b) => (a.nenn < b.nenn ? -1 : a.nenn > b.nenn ? 1 : a.art < b.art ? -1 : 1));
}

/**
 * Taxes the office pays, from the legal form (E-04) and the VAT switch (E-09):
 * income tax for sole proprietors and partnerships, corporate tax for GmbH/UG;
 * trade tax for GmbH/UG always, otherwise only with `gewst_aktiv`; VAT unless
 * `ust_zeitraum` is "jahr" (no advance returns).
 * @param {{rechtsform?: string, gewst_aktiv?: boolean, ust_zeitraum?: string, kalender?: any}} einst effective settings
 * @returns {Array<"est"|"kst"|"gewst"|"ust">} in the order prepayment, trade tax, VAT
 */
export function steuerartenFuer(einst) {
  const wirkung = rechtsformWirkung(einst);
  /** @type {Array<"est"|"kst"|"gewst"|"ust">} */
  const arten = [wirkung.vorauszahlung];
  if (wirkung.gewst) arten.push("gewst");
  if (einst?.ust_zeitraum !== "jahr") arten.push("ust");
  return arten;
}
