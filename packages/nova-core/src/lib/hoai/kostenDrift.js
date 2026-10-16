// Frozen anrechenbare Kosten of a fee contract and their drift against the LV
// (plan 96-03). Taking KG 300/400 over from the LV is a deliberate freeze, not a
// live link: HOAI/GoBD — instalment invoices already issued on a contract must
// never change retroactively, so a changed LV is only REPORTED (yellow notice)
// and turned into a fee amendment by agreement (§ 10 HOAI), never copied
// silently into the contract.
//
// In:  a Honorarvertrag (or offer) record with the optional, backward-compatible
//      fields `kosten_eingefroren_am` ('YYYY-MM-DD') and `kosten_eingefroren`
//      ({kg300_cent, kg400_cent, sonstige_cent}, integer cents), plus the LV
//      positions of its project. Out: the freeze patch and the drift report —
//      pure values, no I/O. A record without a snapshot yields no drift (null)
//      and behaves exactly as before 96-03.

import { kostenAusLv } from "./honorar.js";

/**
 * Drift threshold in percent of the frozen total. 1 % because the LV is
 * re-priced continuously (rounding, small quantity corrections) and a notice on
 * every cent would be noise; 1 % of the eligible costs is roughly the point
 * where the fee itself moves by a noticeable amount (the § 13 table is roughly
 * proportional within a row band). [ASSUMED] — no statutory value; tune here.
 * Exactly 1 % is NOT over the threshold (strictly greater).
 * @type {number} percent
 */
export const KOSTEN_DRIFT_SCHWELLE_PROZENT = 1;

/**
 * Euro → integer cents with commercial rounding (toPrecision guards against
 * binary artefacts such as 1.005 × 100 = 100.49999…).
 * @param {unknown} euro amount in Euro
 * @returns {number} cents (0 for non-numbers)
 */
function zuCent(euro) {
  const n = Number(euro);
  if (!Number.isFinite(n)) return 0;
  const c = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
  return (n < 0 ? -c : c) || 0;
}

/**
 * @param {unknown} c stored cents
 * @returns {number} integer cents (0 for anything else)
 */
function ganzCent(c) {
  const n = Number(c);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * The patch that takes LV costs over AND freezes them: the existing Euro fields
 * keep their meaning (kg300_euro, kg400_euro, sonstige_euro,
 * anrechenbare_quelle "lv"), plus the snapshot in integer cents and its date.
 * @param {{kg300_euro?: number, kg400_euro?: number, sonstige_euro?: number}} kosten Euro, e.g. from kostenAusLv
 * @param {string} heuteIso day of the freeze, 'YYYY-MM-DD'
 * @returns {{kg300_euro: number, kg400_euro: number, sonstige_euro: number, anrechenbare_quelle: "lv",
 *   kosten_eingefroren_am: string, kosten_eingefroren: {kg300_cent: number, kg400_cent: number, sonstige_cent: number}}}
 */
export function kostenEinfrieren(kosten, heuteIso) {
  const kg300 = zuCent(kosten?.kg300_euro);
  const kg400 = zuCent(kosten?.kg400_euro);
  const sonstige = zuCent(kosten?.sonstige_euro);
  return {
    kg300_euro: kg300 / 100,
    kg400_euro: kg400 / 100,
    sonstige_euro: sonstige / 100,
    anrechenbare_quelle: "lv",
    kosten_eingefroren_am: heuteIso,
    kosten_eingefroren: { kg300_cent: kg300, kg400_cent: kg400, sonstige_cent: sonstige },
  };
}

/**
 * Patch that drops the snapshot — used when KG 300/400 are typed in by hand:
 * the record no longer describes an LV stand, so there is nothing to drift from.
 * @type {Readonly<{kosten_eingefroren_am: null, kosten_eingefroren: null}>}
 */
export const KOSTEN_SNAPSHOT_LEER = Object.freeze({ kosten_eingefroren_am: null, kosten_eingefroren: null });

/**
 * @typedef {{eingefrorenCent: number, aktuellCent: number, differenzCent: number}} KgDrift
 *   all integer cents; differenz = aktuell − eingefroren
 */

/**
 * Drift of the LV against the frozen snapshot of a fee contract. The current
 * values come from kostenAusLv (DIN 276 first digit × quantity × unit price),
 * i.e. exactly the computation that produced the snapshot. "Sonstige" has no
 * LV source, so its current value IS the frozen value (it never drifts here).
 * @param {Record<string, any>|null|undefined} vertrag Honorarvertrag (or offer) record
 * @param {ReadonlyArray<{din276?: string, quantity?: number, unit_price?: number}>|null|undefined} lvPositionen
 *   LV positions of the contract's project
 * @returns {null | {
 *   abweichungProzent: number|null, aktuellCent: number, eingefrorenCent: number, differenzCent: number,
 *   jeKg: {kg300: KgDrift, kg400: KgDrift, sonstige: KgDrift},
 *   ueberSchwelle: boolean, eingefrorenAm: string|null,
 * }} null without a snapshot. abweichungProzent: signed percent of the frozen
 *   total, two decimals; null when the frozen total is 0 € but the LV now has
 *   costs (no finite percentage — that case is always over the threshold).
 */
export function kostenDrift(vertrag, lvPositionen) {
  const snap = vertrag?.kosten_eingefroren;
  if (!snap || typeof snap !== "object") return null;
  const lv = kostenAusLv(lvPositionen || []);
  /** @param {number} ein @param {number} akt @returns {KgDrift} */
  const kg = (ein, akt) => ({ eingefrorenCent: ein, aktuellCent: akt, differenzCent: akt - ein });
  const sonstige = ganzCent(snap.sonstige_cent);
  const jeKg = {
    kg300: kg(ganzCent(snap.kg300_cent), zuCent(lv.kg300_euro)),
    kg400: kg(ganzCent(snap.kg400_cent), zuCent(lv.kg400_euro)),
    sonstige: kg(sonstige, sonstige),
  };
  const eingefrorenCent = jeKg.kg300.eingefrorenCent + jeKg.kg400.eingefrorenCent + jeKg.sonstige.eingefrorenCent;
  const aktuellCent = jeKg.kg300.aktuellCent + jeKg.kg400.aktuellCent + jeKg.sonstige.aktuellCent;
  const differenzCent = aktuellCent - eingefrorenCent;

  let abweichungProzent;
  let ueberSchwelle;
  if (eingefrorenCent === 0) {
    // Nothing was frozen (0 €): any LV cost now is a change without a finite ratio.
    abweichungProzent = differenzCent === 0 ? 0 : null;
    ueberSchwelle = differenzCent !== 0;
  } else {
    abweichungProzent = Math.round((differenzCent / eingefrorenCent) * 10000) / 100;
    // Integer comparison (|Δ| × 100 > frozen × threshold) — no float edge at exactly 1 %.
    ueberSchwelle = Math.abs(differenzCent) * 100 > Math.abs(eingefrorenCent) * KOSTEN_DRIFT_SCHWELLE_PROZENT;
  }
  return {
    abweichungProzent, aktuellCent, eingefrorenCent, differenzCent, jeKg, ueberSchwelle,
    eingefrorenAm: typeof vertrag?.kosten_eingefroren_am === "string" ? vertrag.kosten_eingefroren_am : null,
  };
}
