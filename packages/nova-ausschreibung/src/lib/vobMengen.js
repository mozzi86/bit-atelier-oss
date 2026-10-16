// VOB/B § 2 Abs. 3 — rating the current quantity of an LV position against
// its CONTRACTED quantity (plan 96-02).
//
// The quantity run (regelLauf.js) compares the model quantity with the LAST
// stored quantity ("model has changed", 5 % lamp in mengenregeln.js). That says
// nothing about the contract: the unit-price contract is priced on the
// quantity at award, and § 2 Abs. 3 VOB/B ties price adjustment to the
// deviation from THAT quantity. This module rates exactly that deviation.
//
// In:  the contracted quantity (frozen at award as `vertragsmenge` on the
//      LV position, same unit as `quantity`), the current quantity and the
//      contract unit price in Euro.
// Out: a plain rating object (status, deviation in percent, excess quantity
//      above 110 %, shortfall quantity below 90 %, money values in Euro).
//      Plus `vertragsmengenEinfrieren`, which builds the freeze patches for
//      the positions of an awarded tender.
//
// Pure and isomorphic: no browser globals, no app aliases, no I/O.

/** Tolerance band of § 2 Abs. 3 Nr. 1 VOB/B: ±10 % of the contracted quantity (fraction, 0.1 = 10 %). */
export const VOB_TOLERANZ = 0.1;

/**
 * The named rating states. `ohne_vertragsmenge` and `ohne_istmenge` mean "not
 * rated", never "in tolerance" — a missing input must not look like a result.
 */
export const VOB_STATUS = Object.freeze({
  IM_TOLERANZBEREICH: 'im_toleranzbereich',
  MEHRMENGE: 'mehrmenge',
  MINDERMENGE: 'mindermenge',
  OHNE_VERTRAGSMENGE: 'ohne_vertragsmenge',
  OHNE_ISTMENGE: 'ohne_istmenge',
});

// Comparisons run on quantities that went through rounding (2 decimals in
// mengenregeln.js) — 36.3 / 33 is 1.0999999999999999 in floating point. A
// relative epsilon keeps "exactly 110 %" inside the band.
const EPS = 1e-9;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Number or null: finite numbers pass, everything else (null, '', NaN, text) is null.
 * @param {unknown} v
 * @returns {number|null}
 */
function zahlOderNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @typedef {{
 *   status: string,
 *   abweichungProzent: number|null,
 *   spitzenmenge: number,
 *   mindermenge: number,
 *   geldwert: number|null,
 *   vertragsmenge: number|null,
 *   istmenge: number|null,
 *   schwere: 'warn'|null,
 *   norm: string|null,
 * }} VobBewertung
 */

/**
 * Rates ONE position according to § 2 Abs. 3 VOB/B.
 *
 * - `im_toleranzbereich`: 90 % ≤ ist ≤ 110 % of the contracted quantity —
 *   § 2 Abs. 3 Nr. 1: the contract unit price applies unchanged.
 * - `mehrmenge`: ist > 110 % — § 2 Abs. 3 Nr. 2: for the quantity EXCEEDING
 *   110 % a new unit price is to be agreed on request. That excess is reported
 *   separately as `spitzenmenge` (= ist − 1.1 × vertragsmenge); the first 110 %
 *   stay at the contract price.
 * - `mindermenge`: ist < 90 % — § 2 Abs. 3 Nr. 3: shortfall of MORE than 10 %;
 *   on request the unit price for the quantity actually performed is to be
 *   increased. `mindermenge` reports the shortfall (vertragsmenge − ist).
 *   (The order text said "< −90 %"; the norm means ist < 0.9 × vertragsmenge.)
 *
 * Severity is `warn`, never a hard block: the adjustment happens only on
 * request of a party ("auf Verlangen"), and Nr. 3 additionally allows offsets
 * against other positions. Whether and how much is a contractual decision of
 * the parties, not something software may enforce — blocking would put the
 * office in a liability position it does not hold.
 *
 * @param {{vertragsmenge?: unknown, istmenge?: unknown, einheitspreis?: unknown}} eingabe
 *        vertragsmenge and istmenge in the unit of the position (m², m³, Stk, …);
 *        einheitspreis = contract unit price in Euro per unit (optional)
 * @returns {VobBewertung} abweichungProzent in percent (1 decimal, signed);
 *          spitzenmenge / mindermenge in the unit of the position (3 decimals,
 *          0 when not applicable); geldwert in Euro = affected quantity ×
 *          unit price (null without a valid price or outside mehr/mindermenge)
 */
export function vobMengenBewertung({ vertragsmenge, istmenge, einheitspreis } = {}) {
  const v = zahlOderNull(vertragsmenge);
  const ist = zahlOderNull(istmenge);
  const ep = zahlOderNull(einheitspreis);
  const leer = {
    abweichungProzent: null,
    spitzenmenge: 0,
    mindermenge: 0,
    geldwert: null,
    vertragsmenge: v,
    istmenge: ist,
    schwere: null,
    norm: null,
  };

  // No (or a non-positive) contracted quantity: there is no reference, so no
  // rating at all. 0 would divide by zero; a negative quantity is a data error.
  if (v === null || v <= 0) return { ...leer, status: VOB_STATUS.OHNE_VERTRAGSMENGE };
  // A negative current quantity comes from broken rules (Σadd < Σsub) and is
  // flagged by the run itself; rating it would invent a >100 % shortfall.
  if (ist === null || ist < 0) return { ...leer, status: VOB_STATUS.OHNE_ISTMENGE };

  const abweichungProzent = Math.round((ist / v - 1) * 1000) / 10;
  const oben = (1 + VOB_TOLERANZ) * v;
  const unten = (1 - VOB_TOLERANZ) * v;
  const preisGueltig = ep !== null && ep >= 0;

  // § 2 Abs. 3 Nr. 2 VOB/B — excess above 110 %.
  if (ist - oben > EPS * v) {
    const spitzenmenge = r3(ist - oben);
    return {
      ...leer,
      status: VOB_STATUS.MEHRMENGE,
      abweichungProzent,
      spitzenmenge,
      geldwert: preisGueltig ? r2(spitzenmenge * /** @type {number} */ (ep)) : null,
      schwere: 'warn',
      norm: '§ 2 Abs. 3 Nr. 2 VOB/B',
    };
  }
  // § 2 Abs. 3 Nr. 3 VOB/B — shortfall of more than 10 %.
  if (unten - ist > EPS * v) {
    const mindermenge = r3(v - ist);
    return {
      ...leer,
      status: VOB_STATUS.MINDERMENGE,
      abweichungProzent,
      mindermenge,
      geldwert: preisGueltig ? r2(mindermenge * /** @type {number} */ (ep)) : null,
      schwere: 'warn',
      norm: '§ 2 Abs. 3 Nr. 3 VOB/B',
    };
  }
  // § 2 Abs. 3 Nr. 1 VOB/B — within ±10 %, contract unit price applies.
  return { ...leer, status: VOB_STATUS.IM_TOLERANZBEREICH, abweichungProzent, norm: '§ 2 Abs. 3 Nr. 1 VOB/B' };
}

/**
 * True when the position carries a usable contracted quantity (finite, > 0).
 * @param {{vertragsmenge?: unknown}|null|undefined} position
 * @returns {boolean}
 */
export function hatVertragsmenge(position) {
  const v = zahlOderNull(position?.vertragsmenge);
  return v !== null && v > 0;
}

/**
 * Freeze patches for the award (Zuschlag): every position of the tender gets
 * `vertragsmenge` = its current `quantity` and `vertragsmenge_am` = award date,
 * unless it already has a `vertragsmenge` (a second award or a re-award must
 * not overwrite the contract basis). Positions without a numeric quantity get
 * no patch — no rating is better than a rating against 0.
 *
 * @param {{position_ids?: Array<any>}|null|undefined} tender the awarded tender
 * @param {Array<{id?: any, quantity?: unknown, vertragsmenge?: unknown}>} positionen all LV positions of the project
 * @param {string} datum award date as ISO date (YYYY-MM-DD)
 * @returns {Array<{id: any, patch: {vertragsmenge: number, vertragsmenge_am: string}}>}
 *          no side effects; the caller writes the patches
 */
export function vertragsmengenEinfrieren(tender, positionen, datum) {
  const ids = new Set(Array.isArray(tender?.position_ids) ? tender.position_ids : []);
  const ergebnis = [];
  for (const p of Array.isArray(positionen) ? positionen : []) {
    if (p?.id == null || !ids.has(p.id)) continue;
    if (p.vertragsmenge !== undefined && p.vertragsmenge !== null) continue;
    const menge = zahlOderNull(p.quantity);
    if (menge === null) continue;
    ergebnis.push({ id: p.id, patch: { vertragsmenge: menge, vertragsmenge_am: datum } });
  }
  return ergebnis;
}
