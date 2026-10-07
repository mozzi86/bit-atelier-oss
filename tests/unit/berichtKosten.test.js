// 72-15 (N-15): cost figures of the report — estimate, award, change orders,
// contract sum including approved change orders (berichtKosten.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { kostenUebersicht, prozentText } from '@/components/reports/berichtKosten.js';

// Shaped like the demo seed (proj-1): lv-1…lv-3 with the seed prices, one awarded
// tender over them, positions outside the award, a tender that is not awarded.
const LV = [
  { id: 'lv-1', quantity: 320, unit_price: 165 },
  { id: 'lv-2', quantity: 1450, unit_price: 92 },
  { id: 'lv-3', quantity: 78, unit_price: 1450 },
  { id: 'lv-4', quantity: 100, unit_price: 50 },
  { id: 'lv-5', quantity: 10 }, // no unit price → 0 €
];
const TENDERS = [
  { id: 'td-1', status: 'awarded', awarded_bid_id: 'bid-1', position_ids: ['lv-1', 'lv-2', 'lv-3'] },
  { id: 'td-2', status: 'published', awarded_bid_id: null, position_ids: ['lv-4'] },
  // awarded without a bid id does not count (same rule as before)
  { id: 'td-3', status: 'awarded', awarded_bid_id: null, position_ids: ['lv-5'] },
];
const BIDS = [
  { id: 'bid-1', line_items: [
    { position_id: 'lv-1', unit_price: 158 },
    { position_id: 'lv-2', unit_price: 88 },
    { position_id: 'lv-3', unit_price: 1420 },
  ] },
];
// Seed change orders of proj-1 plus the edge cases.
const ORDERS = [
  { id: 'co-1', status: 'approved', cost_impact: 145000 },
  { id: 'co-2', status: 'pending', cost_impact: 68000 },
];

describe('kostenUebersicht — estimate and award (unchanged logic)', () => {
  it('sums quantity × unit price over all positions as the estimate', () => {
    const k = kostenUebersicht({ lv: LV, tenders: TENDERS, bids: BIDS, orders: [] });
    assert.equal(k.anschlag, 52800 + 133400 + 113100 + 5000);
  });

  it('prices only awarded tenders with an awarded bid, with the bid unit prices', () => {
    const k = kostenUebersicht({ lv: LV, tenders: TENDERS, bids: BIDS, orders: [] });
    assert.equal(k.vergabe, 320 * 158 + 1450 * 88 + 78 * 1420); // 288.920 €
    assert.equal(k.anschlagVergeben, 52800 + 133400 + 113100); // 299.300 €
  });

  it('counts a missing unit price or a missing bid with 0 €', () => {
    const k = kostenUebersicht({
      lv: LV,
      tenders: [{ id: 't', status: 'awarded', awarded_bid_id: 'bid-x', position_ids: ['lv-1'] },
        { id: 'u', status: 'awarded', awarded_bid_id: 'bid-2', position_ids: ['lv-2'] }],
      bids: [{ id: 'bid-2', line_items: [] }],
    });
    assert.equal(k.vergabe, 0);
    assert.equal(k.anschlagVergeben, 52800 + 133400);
  });

  it('deviation compares the award with the estimate of the awarded positions only', () => {
    const k = kostenUebersicht({ lv: LV, tenders: TENDERS, bids: BIDS, orders: [] });
    assert.ok(Math.abs(k.abweichungProzent - ((288920 - 299300) / 299300) * 100) < 1e-9);
    assert.equal(prozentText(k.abweichungProzent), '-3,5');
  });
});

describe('kostenUebersicht — change orders and contract sum', () => {
  it('reports approved and open change orders with count and sum (seed proj-1)', () => {
    const k = kostenUebersicht({ lv: LV, tenders: TENDERS, bids: BIDS, orders: ORDERS });
    assert.deepEqual(k.nachtraegeGenehmigt, { anzahl: 1, summe: 145000 });
    assert.deepEqual(k.nachtraegeOffen, { anzahl: 1, summe: 68000 });
  });

  it('contract sum = award + approved change orders; open ones are not part of it', () => {
    const k = kostenUebersicht({ lv: LV, tenders: TENDERS, bids: BIDS, orders: ORDERS });
    assert.equal(k.auftragssummeInklNachtraege, 288920 + 145000);
  });

  it('counts cost_impact null as a change order with 0 €, completed as approved, rejected not at all', () => {
    const k = kostenUebersicht({
      lv: LV, tenders: TENDERS, bids: BIDS,
      orders: [
        { status: 'approved', cost_impact: null },
        { status: 'completed', cost_impact: 10000 },
        { status: 'in_progress', cost_impact: null },
        { status: 'pending', cost_impact: -2500 },
        { status: 'rejected', cost_impact: 91500 },
        { status: 'unbekannt', cost_impact: 1 },
      ],
    });
    assert.deepEqual(k.nachtraegeGenehmigt, { anzahl: 2, summe: 10000 });
    assert.deepEqual(k.nachtraegeOffen, { anzahl: 2, summe: -2500 });
    assert.equal(k.auftragssummeInklNachtraege, 288920 + 10000);
  });
});

describe('kostenUebersicht — nothing awarded, nothing there', () => {
  it('without an award: no contract sum and no deviation, change orders still counted', () => {
    const k = kostenUebersicht({
      lv: LV, tenders: [TENDERS[1]], bids: BIDS,
      orders: [{ status: 'approved', cost_impact: -23000 }],
    });
    assert.equal(k.vergabe, 0);
    assert.equal(k.abweichungProzent, null);
    assert.equal(k.auftragssummeInklNachtraege, null);
    assert.deepEqual(k.nachtraegeGenehmigt, { anzahl: 1, summe: -23000 });
  });

  it('missing or broken lists count as empty and never throw', () => {
    for (const daten of [undefined, {}, { lv: null, tenders: null, bids: null, orders: null },
      { lv: 'x', tenders: 5, bids: {}, orders: 'y' }]) {
      const k = kostenUebersicht(daten);
      assert.equal(k.anschlag, 0);
      assert.equal(k.vergabe, 0);
      assert.equal(k.anschlagVergeben, 0);
      assert.deepEqual(k.nachtraegeGenehmigt, { anzahl: 0, summe: 0 });
      assert.deepEqual(k.nachtraegeOffen, { anzahl: 0, summe: 0 });
      assert.equal(k.auftragssummeInklNachtraege, null);
      assert.equal(k.abweichungProzent, null);
    }
  });
});

describe('prozentText', () => {
  it('uses the German decimal comma, a sign and at most one decimal', () => {
    assert.equal(prozentText(-89.2222), '-89,2');
    assert.equal(prozentText(3), '+3');
    assert.equal(prozentText(12.34), '+12,3');
    assert.equal(prozentText(0), '0');
  });
});
