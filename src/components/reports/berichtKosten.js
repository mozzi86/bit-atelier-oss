// berichtKosten.js — the cost figures of a report (Berichte page, ReportDocument):
// cost estimate from the bill of quantities, award sum, change orders and the
// contract sum including approved change orders (72-15, N-15).
//
// Why: the interim and the final report left change orders out completely and
// computed estimate and award inline in the component, the final report's
// percentage came from toFixed (English decimal point) and compared the award of
// ONE tender with the estimate of the WHOLE bill of quantities (demo proj-1:
// "89.2 % ggü. Anschlag" for an award that is 3.5 % below its positions). One
// pure function keeps preview, PDF and test on the same numbers.
//
// In:  LV positions, tenders, bids and change orders of ONE project — the caller
//      scopes them (entities filtered by project_id, change orders through
//      nachtraegeDesProjekts from @core/lib/nachtraege).
// Out: sums in euros, counts, deviation in percent.
// Pure — no DOM, no React, no API — so it runs under Node.
import { gp, bidUnitPrice } from "@ava/components/avaUtils";
import { nachtragsSummen } from "@core/lib/nachtraege";

/**
 * @typedef {object} KostenUebersicht
 * @property {number} anschlag cost estimate in euros: sum of quantity × unit price
 *   over all LV positions
 * @property {number} vergabe award sum in euros: awarded bids' unit prices × LV quantities
 * @property {number} anschlagVergeben cost estimate in euros of only the positions
 *   that belong to an awarded tender — the fair reference for the award sum
 * @property {{anzahl: number, summe: number}} nachtraegeGenehmigt approved (and
 *   completed) change orders: count, sum in euros
 * @property {{anzahl: number, summe: number}} nachtraegeOffen undecided (pending,
 *   in_progress) change orders: count, sum in euros
 * @property {number|null} auftragssummeInklNachtraege contract sum in euros = award
 *   sum + approved change orders; null while nothing is awarded
 * @property {number|null} abweichungProzent deviation of the award sum from the
 *   estimate of the awarded positions in percent,
 *   (vergabe − anschlagVergeben) / anschlagVergeben × 100, negative = below the
 *   estimate; null without award or without estimate for the awarded positions
 */

/**
 * Cost figures of one project for the report.
 *
 * Estimate and award are taken over unchanged from the former inline code of
 * ReportDocument.jsx: only tenders with status "awarded" AND an awarded_bid_id
 * count, each priced with the awarded bid's unit price per position of that
 * tender (missing unit price or missing bid → 0 €).
 *
 * Change orders go through nachtragsSummen (one rule for every page): a change
 * order with cost_impact null (not quantified yet) counts with 0 €, rejected ones
 * are left out.
 *
 * @param {{lv?: object[]|null, tenders?: object[]|null, bids?: object[]|null,
 *   orders?: object[]|null}} [daten] LVPosition, Tender, Bid and ChangeOrder records
 *   of one project; missing lists count as empty
 * @returns {KostenUebersicht}
 */
export function kostenUebersicht({ lv, tenders, bids, orders } = {}) {
  const positionen = /** @type {any[]} */ (Array.isArray(lv) ? lv : []);
  const vergaben = /** @type {any[]} */ (Array.isArray(tenders) ? tenders : []);
  const angebote = /** @type {any[]} */ (Array.isArray(bids) ? bids : []);

  const anschlag = positionen.reduce((s, p) => s + gp(p), 0);
  let vergabe = 0;
  let anschlagVergeben = 0;
  for (const t of vergaben) {
    if (t.status !== "awarded" || !t.awarded_bid_id) continue;
    const bid = angebote.find((b) => b.id === t.awarded_bid_id);
    for (const p of positionen.filter((q) => t.position_ids?.includes(q.id))) {
      vergabe += bid ? (bidUnitPrice(bid, p.id) || 0) * (p.quantity || 0) : 0;
      anschlagVergeben += gp(p);
    }
  }

  const summen = nachtragsSummen(/** @type {any} */ (orders));
  const vergeben = vergabe > 0;
  return {
    anschlag,
    vergabe,
    anschlagVergeben,
    nachtraegeGenehmigt: summen.genehmigt,
    nachtraegeOffen: summen.offen,
    // Without an award there is no contract; approved change orders alone are
    // not a contract sum (demo proj-2: −23.000 € approved, nothing awarded).
    auftragssummeInklNachtraege: vergeben ? vergabe + summen.genehmigt.summe : null,
    abweichungProzent: vergeben && anschlagVergeben > 0
      ? ((vergabe - anschlagVergeben) / anschlagVergeben) * 100
      : null,
  };
}

/**
 * German percentage text with sign and at most one decimal (decimal comma):
 * "-3,5" below, "+3" above, "0" for no deviation.
 * @param {number} prozent percent
 * @returns {string} number text without the "%" sign
 */
export function prozentText(prozent) {
  return prozent.toLocaleString("de-DE", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
}
