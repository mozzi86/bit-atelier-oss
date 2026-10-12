// Fee breakdown of a fee offer or an architect's contract (phase 81-03, HON-01):
// every line with its legal source, on top of 79's ONE fee engine
// (@core/lib/hoai/honorar.js honorarVertrag). Nothing here reads a fee table
// itself except honorarAusTafel for the "basis / top / chosen" display.
//
// Additions of 81 (81-RESEARCH § Formeln): special services (Besondere
// Leistungen, flat or by hours × rate) are added to basic fee + conversion
// surcharge, incidental costs (§ 14 HOAI) are charged on them too. Amounts are
// computed in cents (D-P81-13) and returned in Euro with two decimals.
//
// "Tafel fehlt" ≠ "frei vereinbar" (E-13, pitfall 16): a profile without an
// official table never computes (only a flat fee does), a cost value outside the
// table is "freely negotiable" (§ 7 Abs. 2 HOAI) — neither is ever shown as 0 €.
//
// Every line carries `schluessel` (German i18n key with {platzhalter}) and
// `werte`, so the UI translates it; `text` is the filled German line for the PDF.
//
// In:  an offer or contract with the flat 79 fields (+ besondere_leistungen),
//      optionally `optionen.weitere` (injected tables, tests — like 79). Out: lines,
//      totals, flags.

import { anrechenbareKosten, honorarAusTafel, honorarVertrag } from "@core/lib/hoai/honorar.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";

/** @param {number} euro @returns {number} cents */
const cent = (euro) => Math.round((Number(euro) || 0) * 100);
/** @param {number} c cents @returns {number} Euro */
const euro = (c) => Math.round(c) / 100;

/**
 * Fee zone from points (§ 35 Abs. 6 HOAI, only buildings and interiors):
 * up to 10 → I, 18 → II, 26 → III, 34 → IV, 42 → V; above 42 or below 0 → null.
 * @param {number} punkte sum of the evaluation points
 * @returns {'I'|'II'|'III'|'IV'|'V'|null}
 */
export function honorarzoneAusPunkten(punkte) {
  const p = Number(punkte);
  if (!Number.isFinite(p) || p < 0 || p > 42) return null;
  if (p <= 10) return "I";
  if (p <= 18) return "II";
  if (p <= 26) return "III";
  if (p <= 34) return "IV";
  return "V";
}

/** Profiles whose fee zone § 35 Abs. 6 derives from points. */
export const PUNKTE_LEISTUNGSBILDER = Object.freeze(["gebaeude", "innenraeume"]);

/**
 * Fills a German key with values ({name} → value).
 * @param {string} schluessel
 * @param {Record<string, string|number>} werte
 * @returns {string}
 */
export function fuelle(schluessel, werte = {}) {
  return Object.entries(werte).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), schluessel);
}

/**
 * Euro amount as German text ("62.365,74 €") — document text, independent of the UI language.
 * @param {number} betrag Euro
 * @returns {string}
 */
export function euroText(betrag) {
  return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(betrag)} €`;
}

/**
 * Sum of the special services in Euro: flat amount, or hours × rate.
 * @param {ReadonlyArray<{art?: string, betrag_euro?: number, stunden?: number, satz_eur_h?: number}>|undefined} liste
 * @returns {number} cents
 */
function besondereCent(liste) {
  let summe = 0;
  for (const b of Array.isArray(liste) ? liste : []) {
    summe += b?.art === "stunden" ? Math.round((Number(b.stunden) || 0) * cent(Number(b.satz_eur_h) || 0)) : cent(Number(b?.betrag_euro) || 0);
  }
  return summe;
}

/**
 * @typedef {{art: string, schluessel: string, werte: Record<string, string|number>, text: string, betrag_eur: number|null, quelle: string}} AufstellungsZeile
 * @typedef {{grund: number|null, umbau: number|null, besondere: number, nebenkosten: number|null, netto: number|null, ust: number|null, brutto: number|null, quelle: string}} Summen
 */

/**
 * The breakdown of an offer or contract.
 * @param {Record<string, any>} vertrag flat 79 fields (+ besondere_leistungen)
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injected tables (tests)
 * @returns {{zeilen: AufstellungsZeile[], summen: Summen, ausserhalb: boolean, tafelFehlt: boolean,
 *   lph: Array<{nr: number, prozent: number, beauftragt: boolean, betrag: number}>,
 *   tafel: {bezugswert: number, basis: number|null, oben: number|null, gewaehlt: number|null}|null}}
 */
export function aufstellung(vertrag, optionen = {}) {
  const h = honorarVertrag(vertrag, optionen);
  const info = leistungsbildInfo(vertrag.leistungsbild, optionen);
  const tafelPar = info?.tafelParagraf ?? "";
  const lphPar = info?.lphParagraf ?? "";
  /** @type {AufstellungsZeile[]} */
  const zeilen = [];
  const zeile = (/** @type {string} */ art, /** @type {string} */ schluessel, /** @type {Record<string, any>} */ werte, /** @type {number|null} */ betrag, /** @type {string} */ quelle) => {
    zeilen.push({ art, schluessel, werte, text: fuelle(schluessel, werte), betrag_eur: betrag, quelle });
  };
  const p33 = info?.kostenregel === "p33";
  const bezugswert = p33
    ? anrechenbareKosten({ kg300_euro: vertrag.kg300_euro, kg400_euro: vertrag.kg400_euro, sonstige_euro: vertrag.sonstige_euro })
    : (typeof vertrag.bezugswert === "number" ? vertrag.bezugswert : 0);
  const nkProzent = typeof vertrag.nebenkosten_prozent === "number" ? vertrag.nebenkosten_prozent : 5;
  const ustSatz = typeof vertrag.ust_satz === "number" ? vertrag.ust_satz : 19;
  const besondere = besondereCent(vertrag.besondere_leistungen);

  // --- No amount: missing table (without flat fee) or outside the table ------------------
  if (h.quelle === "tafel_fehlt" || h.quelle === "frei") {
    const tafelFehlt = h.quelle === "tafel_fehlt";
    if (tafelFehlt) zeile("hinweis", "Tafel fehlt — HOAI § {nr} noch nicht amtlich übertragen", { nr: tafelPar }, null, `§ ${tafelPar} HOAI`);
    else zeile("hinweis", "frei vereinbar (§ 7 Abs. 2 HOAI)", {}, null, "§ 7 Abs. 2 HOAI");
    return {
      zeilen,
      summen: { grund: null, umbau: null, besondere: euro(besondere), nebenkosten: null, netto: null, ust: null, brutto: null, quelle: h.quelle },
      ausserhalb: !tafelFehlt, tafelFehlt, lph: [], tafel: null,
    };
  }

  // --- Basis of the table, chosen rate, stages -------------------------------------------
  /** @type {{bezugswert: number, basis: number|null, oben: number|null, gewaehlt: number|null}|null} */
  let tafel = null;
  if (h.quelle === "pauschal") {
    zeile("pauschal", "Pauschalhonorar", {}, h.grund, "§ 7 Abs. 1 HOAI");
  } else {
    const t = honorarAusTafel(bezugswert, vertrag.honorarzone, typeof vertrag.satz_position_prozent === "number" ? vertrag.satz_position_prozent : 0, vertrag.leistungsbild, optionen);
    tafel = { bezugswert, basis: t.basis, oben: t.oben, gewaehlt: t.honorar };
    if (p33) zeile("kosten", "Anrechenbare Kosten", {}, bezugswert, "§ 33 HOAI");
    else zeile("kosten", info?.einheit === "ha" ? "Fläche (ha)" : "Anrechenbare Kosten (€)", {}, bezugswert, `§ ${tafelPar} HOAI`);
    zeile("tafel", "Honorar nach Tafel, Zone {zone}, {position} % zwischen Basis- und oberem Honorarsatz", { zone: vertrag.honorarzone, position: vertrag.satz_position_prozent ?? 0 }, t.honorar, `§ ${tafelPar} Abs. 1 HOAI`);
    for (const l of h.lph) {
      if (!l.beauftragt) continue;
      const bez = info?.lph?.find((x) => x.nr === l.nr)?.bezeichnung || "";
      zeile("lph", "LPH {nr} {bezeichnung} ({prozent} %)", { nr: l.nr, bezeichnung: bez, prozent: l.prozent }, l.betrag, `§ ${lphPar} HOAI`);
    }
  }
  zeile("summe", "Grundhonorar", {}, h.grund, h.quelle === "pauschal" ? "§ 7 Abs. 1 HOAI" : `§ ${lphPar} HOAI`);
  if (h.umbau) zeile("umbau", "Umbauzuschlag {prozent} %", { prozent: Math.round(((h.umbau || 0) / (h.grund || 1)) * 1000) / 10 }, h.umbau, "§ 6 Abs. 2 HOAI");
  for (const b of Array.isArray(vertrag.besondere_leistungen) ? vertrag.besondere_leistungen : []) {
    const betrag = b?.art === "stunden" ? euro(Math.round((Number(b.stunden) || 0) * cent(Number(b.satz_eur_h) || 0))) : euro(cent(Number(b?.betrag_euro) || 0));
    zeile("besondere", b?.art === "stunden" ? "Besondere Leistung: {titel} ({stunden} h × {satz})" : "Besondere Leistung: {titel}",
      { titel: b?.titel || "", stunden: b?.stunden ?? 0, satz: euroText(Number(b?.satz_eur_h) || 0) }, betrag, "§ 3 Abs. 3 HOAI");
  }

  // --- Incidental costs on basic fee + conversion + special services, VAT ----------------
  const basisCent = cent(h.grund || 0) + cent(h.umbau || 0) + besondere;
  const nkCent = Math.round(basisCent * (nkProzent / 100));
  const nettoCent = basisCent + nkCent;
  const ustCent = Math.round(nettoCent * (ustSatz / 100));
  zeile("nebenkosten", "Nebenkosten {prozent} %", { prozent: nkProzent }, euro(nkCent), "§ 14 HOAI");
  zeile("netto", "Honorar netto", {}, euro(nettoCent), "");
  zeile("ust", "Umsatzsteuer {prozent} %", { prozent: ustSatz }, euro(ustCent), "§ 12 Abs. 1 UStG");
  zeile("brutto", "Honorar brutto", {}, euro(nettoCent + ustCent), "");
  return {
    zeilen,
    summen: { grund: h.grund, umbau: h.umbau, besondere: euro(besondere), nebenkosten: euro(nkCent), netto: euro(nettoCent), ust: euro(ustCent), brutto: euro(nettoCent + ustCent), quelle: h.quelle },
    ausserhalb: false, tafelFehlt: false, lph: h.lph, tafel,
  };
}
