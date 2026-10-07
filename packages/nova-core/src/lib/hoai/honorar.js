// HOAI 2021 fee engine, generic over the LEISTUNGSBILDER registry (phase 79,
// decision E-13, BUCH-05): anrechenbare Kosten (§ 33), the § 13 table
// interpolation (bilinear: between two zone bounds AND between two table
// rows), the full fee contract (Grundhonorar, Umbauzuschlag, Nebenkosten, VAT)
// and the LPH work-stage split. Shared with phase 81 (offers/contracts) —
// D-P79-27: one engine, not two.
//
// In:  the registry (./leistungsbilder.js) plus the fee-contract fields of
//      datenmodell.js's Honorarvertrag typedef. Out: pure numbers, never a
//      hard-coded service profile — a new table registered in
//      ./tafeln/index.js (79-14) computes without touching this file.
//
// Package boundary: this file may only import from @core (its own package);
// src/lib/accounting/geld.js is app-only and therefore duplicated here in
// miniature (rundeCent) — see 79-02-SUMMARY "Abweichungen".

import { normalisiereHoaiPhase } from "../labels.js";
import { KG400_REGEL, leistungsbildInfo } from "./leistungsbilder.js";

/**
 * Commercial rounding to whole cents, then back to Euro (mirrors
 * src/lib/accounting/geld.js#rundeCent — duplicated, see file header).
 * @param {number} betragEuro
 * @returns {number} Euro, two decimals
 */
function rundeCent(betragEuro) {
  if (!Number.isFinite(betragEuro)) return 0;
  const cent = Math.round(Number((Math.abs(betragEuro) * 100).toPrecision(15)));
  return ((betragEuro < 0 ? -cent : cent) || 0) / 100;
}

/**
 * § 33 Abs. 2 HOAI: anrechenbare Kosten of the technical-systems cost group
 * (KG 400) the architect did not plan themselves count in full up to 25 % of
 * the other anrechenbare Kosten, and by half above that.
 * @param {{kg300_euro?: number, kg400_euro?: number, sonstige_euro?: number}} kosten
 * @returns {number} anrechenbare Kosten in Euro
 */
export function anrechenbareKosten({ kg300_euro = 0, kg400_euro = 0, sonstige_euro = 0 } = {}) {
  const andere = (Number(kg300_euro) || 0) + (Number(sonstige_euro) || 0);
  const kg400 = Number(kg400_euro) || 0;
  const schwelle = andere * KG400_REGEL.voll_bis_anteil;
  const kg400Genutzt = kg400 > schwelle ? schwelle + (kg400 - schwelle) * KG400_REGEL.darueber_faktor : kg400;
  return rundeCent(andere + kg400Genutzt);
}

/**
 * A raw HoaiTafel record injected through `optionen.weitere` for a leistungsbild
 * key that is NOT one of the 14 fixed registry keys (test-only escape hatch:
 * proves the § 13 interpolation is generic before 79-14 registers real tables).
 * @param {string} leistungsbild
 * @param {ReadonlyArray<any>} weitere
 * @returns {any|null} the record, or null when absent or not computable
 */
function tafelDirekt(leistungsbild, weitere = []) {
  const treffer = [...weitere].reverse().find((t) => t && t.leistungsbild === leistungsbild);
  return treffer && treffer.status === "amtlich" && !treffer.annahme ? treffer : null;
}

/**
 * The HoaiTafel that applies to a leistungsbild: through the registry
 * (leistungsbildInfo, which already prefers `optionen.weitere` for a KNOWN
 * key) for the 14 fixed keys, or directly from `optionen.weitere` for an
 * unregistered key (so a brand-new profile can be proven before it is
 * registered). Null when nothing computable is found.
 * @param {string} leistungsbild
 * @param {{weitere?: ReadonlyArray<any>}} optionen
 * @returns {any|null}
 */
function tafelFuer(leistungsbild, optionen) {
  const info = leistungsbildInfo(leistungsbild, optionen);
  if (info) return info.status === "amtlich" ? info.tafel : null;
  return tafelDirekt(leistungsbild, optionen?.weitere);
}

/**
 * § 13 HOAI table interpolation, generic over any zone count and any number
 * of table rows: bilinear between the two zone bounds that bracket
 * `positionProzent` (0 = Basissatz/`basis`, 100 = Höchstsatz/`oben`) AND
 * between the two table rows that bracket `bezugswert`. Outside the table's
 * bezugswert range the fee is "frei vereinbar" (no extrapolation, § 13 does
 * not cover it); an unlisted zone or a profile without an "amtlich" table
 * (E-13) each refuse instead.
 * @param {number} bezugswert anrechenbare Kosten (or ha for a flaechen-based table)
 * @param {string} zone e.g. "III"
 * @param {number} positionProzent 0 (Basissatz) … 100 (Höchstsatz), § 7 Abs. 1
 * @param {string} [leistungsbild] registry key, default "gebaeude" (Phase 81 calls with 3 args)
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables
 * @returns {{basis: number|null, oben: number|null, honorar: number|null, ausserhalb: boolean, tafelFehlt: boolean, zoneUngueltig: boolean}}
 */
export function honorarAusTafel(bezugswert, zone, positionProzent, leistungsbild = "gebaeude", optionen = {}) {
  const leer = { basis: null, oben: null, honorar: null, ausserhalb: false, tafelFehlt: false, zoneUngueltig: false };
  const tafel = tafelFuer(leistungsbild, optionen);
  if (!tafel) return { ...leer, tafelFehlt: true };
  const zoneIndex = tafel.zonen.indexOf(zone);
  if (zoneIndex < 0) return { ...leer, zoneUngueltig: true };
  const zeilen = tafel.zeilen;
  const erste = zeilen[0][0];
  const letzte = zeilen[zeilen.length - 1][0];
  if (!(bezugswert >= erste) || !(bezugswert <= letzte)) return { ...leer, ausserhalb: true };

  let unten = zeilen[0];
  let obenZeile = zeilen[zeilen.length - 1];
  for (let i = 0; i < zeilen.length - 1; i++) {
    if (bezugswert >= zeilen[i][0] && bezugswert <= zeilen[i + 1][0]) { unten = zeilen[i]; obenZeile = zeilen[i + 1]; break; }
  }
  const spanne = obenZeile[0] - unten[0];
  const anteil = spanne === 0 ? 0 : (bezugswert - unten[0]) / spanne;
  /** Value of one zone bound, interpolated over bezugswert between the two bracketing rows. @param {number} i */
  const wertBei = (i) => unten[1][i] + anteil * (obenZeile[1][i] - unten[1][i]);
  const basisWert = wertBei(zoneIndex);
  const obenWert = wertBei(zoneIndex + 1);
  const honorarWert = basisWert + (positionProzent / 100) * (obenWert - basisWert);
  return { ...leer, basis: rundeCent(basisWert), oben: rundeCent(obenWert), honorar: rundeCent(honorarWert) };
}

/**
 * DIN 276 first-digit grouping of LV positions into KG 300 / KG 400 anrechenbare
 * Kosten (mirrors packages/nova-ausschreibung/src/components/avaUtils.js:18's
 * `gp = quantity × unit_price`, deliberately not imported — package boundary).
 * @param {ReadonlyArray<{din276?: string, quantity?: number, unit_price?: number}>} positionen
 * @returns {{kg300_euro: number, kg400_euro: number}}
 */
export function kostenAusLv(positionen) {
  let kg300 = 0;
  let kg400 = 0;
  for (const p of positionen || []) {
    const erste = String(p?.din276 ?? "").charAt(0);
    const betrag = (Number(p?.quantity) || 0) * (Number(p?.unit_price) || 0);
    if (erste === "3") kg300 += betrag;
    else if (erste === "4") kg400 += betrag;
  }
  return { kg300_euro: rundeCent(kg300), kg400_euro: rundeCent(kg400) };
}

/**
 * Rebuilds the work-stage (LPH) list for a NEWLY selected service profile —
 * needed whenever the Leistungsbild changes inside an OPEN fee-contract form
 * (H-2, BEFUNDE-79 §1 (H-2, behoben in §7): HonorarvertragFormular.jsx used to seed `lph` once via
 * `useState` from the profile shown at mount and never rebuild it, so a
 * Gebäude percentage stayed positionally attached to a stage NUMBER that
 * meant something else under the newly picked profile). Every stage reseeds
 * to the new profile's own official table percentage and starts
 * `beauftragt: true` — a caller must never carry the previous profile's
 * percentages over positionally, they belong to a work-stage list of a
 * different length and meaning. Concretely: Tragwerksplanung, Zone III,
 * 425.000 €, Basissatz gave 24.306,81 € with the stale Gebäude percentages
 * ([2,7,15,3,25,10] read to LP 1–6) instead of the correct 39.204,51 € with
 * Tragwerksplanung's own [3,10,15,30,40,2] (§ 51 Abs. 1) — see the unit test.
 * @param {string} leistungsbild registry key of the newly selected profile
 * @returns {Array<{beauftragt: boolean, prozent: number}>} same length/order as
 *   leistungsbildInfo(leistungsbild).lph, or a 9-entry 0 %-per-stage fallback
 *   for a profile whose table is not yet transferred ("Tafel fehlt")
 */
export function lphFuerLeistungsbild(leistungsbild) {
  const info = leistungsbildInfo(leistungsbild);
  const zeilen = info?.lph?.length ? info.lph : Array.from({ length: 9 }, (_, i) => ({ nr: i + 1, prozent: 0 }));
  return zeilen.map((z) => ({ beauftragt: true, prozent: z.prozent }));
}

/**
 * Suggested execution stand (Leistungsstand) per work stage, read-only: from
 * the project's HoaiPlan.progress (index 0 = LP1) when it exists, otherwise a
 * coarse guess from the project's current HOAI phase (every stage before it
 * 100 %, the current one 50 %, later ones 0 %) — only ever a proposal, never
 * written back. Only meaningful for a profile with the nine work stages of the
 * Objektplanung (§ 34/§ 39); everything else is manual (null).
 * @param {{progress?: Array<number|null>}|null|undefined} hoaiPlan
 * @param {{hoai_phase?: string|number}|null|undefined} projekt
 * @param {string} [leistungsbild] registry key, default "gebaeude"
 * @returns {{stand: Record<number, number>, quelle: "hoaiplan"|"projektphase"|"unbekannt"}|null} stand keyed by LP number (1..9)
 */
export function lpStand(hoaiPlan, projekt, leistungsbild = "gebaeude") {
  const info = leistungsbildInfo(leistungsbild);
  if (!info || info.lph.length !== 9) return null;
  if (hoaiPlan && Array.isArray(hoaiPlan.progress)) {
    /** @type {Record<number, number>} */
    const stand = {};
    info.lph.forEach((stufe, i) => { stand[stufe.nr] = typeof hoaiPlan.progress[i] === "number" ? hoaiPlan.progress[i] : 0; });
    return { stand, quelle: "hoaiplan" };
  }
  const aktuell = normalisiereHoaiPhase(projekt?.hoai_phase);
  if (aktuell == null) return { stand: {}, quelle: "unbekannt" };
  /** @type {Record<number, number>} */
  const stand = {};
  for (let nr = 1; nr <= 9; nr++) stand[nr] = nr < aktuell ? 100 : nr === aktuell ? 50 : 0;
  return { stand, quelle: "projektphase" };
}

/**
 * The fee contract's amounts and LPH split — the one calculator behind both
 * phase 79 (invoices) and phase 81 (offers/contracts). A Pauschale takes
 * precedence and computes even without a table (E-13); otherwise a profile
 * without an "amtlich" table or outside the table's bezugswert range refuses
 * with `netto: null` rather than showing 0 €.
 * @param {Record<string, any>} vertrag Honorarvertrag fields (src/lib/accounting/datenmodell.js;
 *   not imported here — package boundary, this file may only import @core)
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables (honorarAusTafel)
 * @returns {{
 *   grund: number|null, umbau: number|null, nebenkosten: number|null, netto: number|null,
 *   ust: number|null, brutto: number|null,
 *   lph: Array<{nr: number, prozent: number, beauftragt: boolean, betrag: number}>,
 *   quelle: "tafel"|"pauschal"|"frei"|"tafel_fehlt",
 * }}
 */
export function honorarVertrag(vertrag, optionen = {}) {
  const nebenkostenProzent = typeof vertrag.nebenkosten_prozent === "number" ? vertrag.nebenkosten_prozent : 5;
  const ustSatz = typeof vertrag.ust_satz === "number" ? vertrag.ust_satz : 19;

  // A Pauschale rechnet auch ohne Tafel (E-13) — kein LPH-Aufschlüsseln, keine
  // Bezugswert-Ermittlung nötig; Nebenkosten gelten trotzdem laut Vertrag.
  if (typeof vertrag.pauschal_euro === "number") {
    const grund = rundeCent(vertrag.pauschal_euro);
    const nebenkosten = rundeCent(grund * (nebenkostenProzent / 100));
    const netto = rundeCent(grund + nebenkosten);
    const ust = rundeCent(netto * (ustSatz / 100));
    return { grund, umbau: 0, nebenkosten, netto, ust, brutto: rundeCent(netto + ust), lph: [], quelle: "pauschal" };
  }

  const info = leistungsbildInfo(vertrag.leistungsbild, optionen);
  const kostenregel = info?.kostenregel === "p33" ? "p33" : "manuell";
  const bezugswert = kostenregel === "p33"
    ? anrechenbareKosten({ kg300_euro: vertrag.kg300_euro, kg400_euro: vertrag.kg400_euro, sonstige_euro: vertrag.sonstige_euro })
    : (typeof vertrag.bezugswert === "number" ? vertrag.bezugswert : 0);
  const positionProzent = typeof vertrag.satz_position_prozent === "number" ? vertrag.satz_position_prozent : 0;
  const basis = honorarAusTafel(bezugswert, vertrag.honorarzone, positionProzent, vertrag.leistungsbild, optionen);

  if (basis.honorar === null) {
    return { grund: null, umbau: null, nebenkosten: null, netto: null, ust: null, brutto: null, lph: [], quelle: basis.tafelFehlt ? "tafel_fehlt" : "frei" };
  }

  const lphEingabe = Array.isArray(vertrag.lph) ? vertrag.lph : [];
  let grund = 0;
  const lph = /** @type {any} */ (info).lph.map((stufe, i) => {
    const eingabe = lphEingabe[i] || {};
    const prozent = typeof eingabe.prozent === "number" ? eingabe.prozent : stufe.prozent;
    const beauftragt = eingabe.beauftragt === true;
    // Rundung je Position auf Cent (Plan-Vorgabe), nicht erst auf die Summe.
    const betrag = rundeCent((/** @type {number} */ (basis.honorar) * prozent) / 100);
    if (beauftragt) grund += betrag;
    return { nr: stufe.nr, prozent, beauftragt, betrag };
  });
  grund = rundeCent(grund);

  const umbauMax = typeof info?.umbau_max_prozent === "number" ? info.umbau_max_prozent : Infinity;
  const umbauProzent = Math.min(typeof vertrag.umbauzuschlag_prozent === "number" ? vertrag.umbauzuschlag_prozent : 0, umbauMax);
  const umbau = rundeCent(grund * (umbauProzent / 100));
  const nebenkosten = rundeCent((grund + umbau) * (nebenkostenProzent / 100));
  const netto = rundeCent(grund + umbau + nebenkosten);
  const ust = rundeCent(netto * (ustSatz / 100));
  return { grund, umbau, nebenkosten, netto, ust, brutto: rundeCent(netto + ust), lph, quelle: "tafel" };
}
