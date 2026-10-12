// 88-08 (RE-22): cost stages DIN 276:2018-12 3.4 — recorded snapshots win over live
// values, delta to the previous stage, traffic light against the ceiling.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KOSTEN_STUFEN, ampel, juengsteJeStufe, kostenstaendeZusammenstellen, aktuellerStand, kostenStandRecord,
} from '@ava/lib/kostenstaende.js';

describe('88-08 Kostenstände DIN 276', () => {
  it('six stages in DIN order with norm source', () => {
    assert.deepEqual(KOSTEN_STUFEN.map((s) => s.key), ['kostenrahmen', 'kostenschaetzung', 'kostenberechnung', 'kostenvoranschlag', 'kostenanschlag', 'kostenfeststellung']);
    assert.ok(KOSTEN_STUFEN.every((s) => s.norm.startsWith('DIN 276 3.4.')));
  });

  it('traffic light: green < 95 %, yellow 95–100 %, red > 100 %, none without ceiling', () => {
    assert.equal(ampel(940000, 1000000), 'gruen');
    assert.equal(ampel(950000, 1000000), 'gelb');
    assert.equal(ampel(1000000, 1000000), 'gelb');
    assert.equal(ampel(1000001, 1000000), 'rot');
    assert.equal(ampel(1, null), null);
    assert.equal(ampel(null, 1), null);
  });

  it('latest record per stage wins; invalid stage/amount ignored', () => {
    const m = juengsteJeStufe([
      { stufe: 'kostenschaetzung', betrag: 100, datum: '2026-01-01' },
      { stufe: 'kostenschaetzung', betrag: 120, datum: '2026-02-01' },
      { stufe: 'quatsch', betrag: 5 },
      { stufe: 'kostenrahmen', betrag: 'x' },
    ]);
    assert.equal(m.get('kostenschaetzung')?.betrag, 120);
    assert.equal(m.has('kostenrahmen'), false);
  });

  it('rows: record over live, 0 € live = no value, delta and share of ceiling', () => {
    const z = kostenstaendeZusammenstellen({
      records: [{ stufe: 'kostenschaetzung', betrag: 900000, datum: '2026-01-10' }],
      obergrenze: 1000000,
      live: { kostenschaetzung: 500000, kostenberechnung: 960000, kostenvoranschlag: 0, kostenanschlag: 1020000 },
    });
    const k = Object.fromEntries(z.map((r) => [r.key, r]));
    assert.equal(k.kostenschaetzung.betrag, 900000);
    assert.equal(k.kostenschaetzung.herkunft, 'erfasst');
    assert.equal(k.kostenberechnung.herkunft, 'live');
    assert.equal(k.kostenberechnung.deltaVorstufe, 60000);
    assert.equal(k.kostenberechnung.ampel, 'gelb');
    assert.equal(k.kostenvoranschlag.betrag, null);
    assert.equal(k.kostenanschlag.deltaVorstufe, 60000, 'delta against the last stage WITH a value');
    assert.equal(k.kostenanschlag.ampel, 'rot');
    assert.equal(aktuellerStand(z)?.key, 'kostenanschlag');
  });

  it('final cost from live data is provisional', () => {
    const z = kostenstaendeZusammenstellen({ live: { kostenfeststellung: 10 } });
    assert.equal(z.find((r) => r.key === 'kostenfeststellung')?.vorlaeufig, true);
    const z2 = kostenstaendeZusammenstellen({ records: [{ stufe: 'kostenfeststellung', betrag: 10, datum: '2026-09-01' }] });
    assert.equal(z2.find((r) => r.key === 'kostenfeststellung')?.vorlaeufig, false);
  });

  it('record builder validates stage and amount, accepts comma decimals', () => {
    const r = kostenStandRecord({ projectId: 'p', stufe: 'kostenrahmen', betrag: '1234,5', datum: '2026-03-01' });
    assert.deepEqual(r, { project_id: 'p', stufe: 'kostenrahmen', betrag: 1234.5, datum: '2026-03-01', quelle: 'erfasst', notiz: '' });
    assert.throws(() => kostenStandRecord({ projectId: 'p', stufe: 'x', betrag: 1 }), /Unbekannte Kostenstufe/);
    assert.throws(() => kostenStandRecord({ projectId: 'p', stufe: 'kostenrahmen', betrag: '' }), /Betrag/);
  });
});
