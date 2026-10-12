// 88-03 (RE-16): change order review path VOB/B § 2 Abs. 5/6 — effective amount,
// findings (warn/hinweis, never fail), sums, form fields and approval patch.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NACHTRAG_ARTEN, betragOderNull, hatPruefpfad, wirksamerBetrag, pruefHinweise,
  pruefpfadSummen, pruefpfadFelder, freigabeFelder, nachtragArtLabel,
} from '@core/lib/nachtragPruefpfad.js';
import { nachtragsSummen } from '@core/lib/nachtraege.js';

const codes = (o) => pruefHinweise(o).map((h) => h.code).sort();

describe('88-03 Nachtrags-Prüfpfad', () => {
  it('amounts: empty and garbage are null, 0 stays 0, comma decimal accepted', () => {
    assert.equal(betragOderNull(''), null);
    assert.equal(betragOderNull(null), null);
    assert.equal(betragOderNull('abc'), null);
    assert.equal(betragOderNull(0), 0);
    assert.equal(betragOderNull('1234,5'), 1234.5);
  });

  it('legacy records keep cost_impact and have no review path', () => {
    const alt = { status: 'approved', cost_impact: 145000 };
    assert.equal(hatPruefpfad(alt), false);
    assert.equal(wirksamerBetrag(alt), 145000);
    assert.deepEqual(pruefHinweise(alt), []);
    assert.deepEqual(freigabeFelder(alt, 'approved'), {});
  });

  it('effective amount: open = checked ?? demanded, approved = released ?? checked ?? demanded', () => {
    const o = { betrag_gefordert: 10000, betrag_geprueft: 8000, betrag_freigegeben: null };
    assert.equal(wirksamerBetrag({ ...o, status: 'pending' }), 8000);
    assert.equal(wirksamerBetrag({ ...o, status: 'approved' }), 8000);
    assert.equal(wirksamerBetrag({ ...o, status: 'approved', betrag_freigegeben: 7500 }), 7500);
    assert.equal(wirksamerBetrag({ status: 'pending', betrag_gefordert: 10000 }), 10000);
  });

  it('§ 2 Abs. 6 without announcement before execution warns (not fail)', () => {
    const o = { status: 'pending', art: 'zusatzleistung', betrag_gefordert: 5000, urkalkulation_ref: 'Pos. 1' };
    const h = pruefHinweise(o);
    assert.deepEqual(h.map((x) => x.code), ['ankuendigung_fehlt']);
    assert.equal(h[0].stufe, 'warn');
    assert.ok(!h.some((x) => /** @type {string} */ (x.stufe) === 'fail'));
    assert.deepEqual(codes({ ...o, angekuendigt_am: '2026-03-01', ankuendigung_vor_ausfuehrung: false }), ['ankuendigung_fehlt']);
    assert.deepEqual(codes({ ...o, angekuendigt_am: '2026-03-01' }), ['ankuendigung_zeitpunkt']);
    assert.deepEqual(codes({ ...o, angekuendigt_am: '2026-03-01', ankuendigung_vor_ausfuehrung: true }), []);
  });

  it('price basis, kind, amount order and approval findings', () => {
    assert.deepEqual(codes({ status: 'pending', art: 'leistungsaenderung', betrag_gefordert: 1 }), ['urkalkulation_fehlt']);
    assert.deepEqual(codes({ status: 'pending', betrag_geprueft: 1 }), ['art_fehlt', 'forderung_fehlt']);
    assert.deepEqual(codes({ status: 'pending', art: 'sonstige', betrag_gefordert: 100, betrag_geprueft: 120 }), ['geprueft_ueber_forderung']);
    assert.deepEqual(codes({ status: 'approved', art: 'sonstige', betrag_gefordert: 100, betrag_geprueft: 90, betrag_freigegeben: 95 }), ['freigabe_ueber_pruefung']);
    assert.deepEqual(codes({ status: 'approved', art: 'sonstige', betrag_gefordert: 100 }), ['freigabe_ohne_pruefung']);
    assert.deepEqual(codes({ status: 'rejected', art: 'zusatzleistung', betrag_gefordert: 100 }), []);
  });

  it('sums: three amounts, reduction and quote; legacy records counted apart; rejected left out', () => {
    const s = pruefpfadSummen([
      { status: 'approved', art: 'sonstige', betrag_gefordert: 10000, betrag_geprueft: 8000, betrag_freigegeben: 8000 },
      { status: 'pending', art: 'sonstige', betrag_gefordert: 5000, betrag_geprueft: 4500 },
      { status: 'rejected', art: 'sonstige', betrag_gefordert: 99999 },
      { status: 'approved', cost_impact: 3000 },
    ]);
    assert.equal(s.gefordert, 15000);
    assert.equal(s.geprueft, 12500);
    assert.equal(s.freigegeben, 8000);
    assert.equal(s.kuerzung, 2500);
    assert.equal(s.quote, 0.8333);
    assert.equal(s.mitPruefpfad, 2);
    assert.equal(s.ohnePruefpfad, 1);
  });

  it('form fields: derived cost_impact only when an amount is given; unknown kind → null', () => {
    const f = pruefpfadFelder({ art: 'zusatzleistung', betrag_gefordert: '12000', betrag_geprueft: '10500', ankuendigung_vor_ausfuehrung: 'ja', angekuendigt_am: '2026-03-02' }, 'pending');
    assert.equal(f.cost_impact, 10500);
    assert.equal(f.ankuendigung_vor_ausfuehrung, true);
    assert.equal(f.angekuendigt_am, '2026-03-02');
    const leer = pruefpfadFelder({ art: 'quatsch' });
    assert.equal(leer.art, null);
    assert.equal(Object.prototype.hasOwnProperty.call(leer, 'cost_impact'), false);
  });

  it('approval releases checked ?? demanded and the existing sums follow cost_impact', () => {
    const o = { id: 'x', status: 'pending', art: 'sonstige', betrag_gefordert: 12000, betrag_geprueft: 10500, cost_impact: 10500 };
    const patch = freigabeFelder(o, 'approved');
    assert.deepEqual(patch, { betrag_freigegeben: 10500, cost_impact: 10500 });
    assert.deepEqual(freigabeFelder(o, 'rejected'), {});
    const summen = nachtragsSummen([{ ...o, status: 'approved', ...patch }]);
    assert.equal(summen.genehmigt.summe, 10500);
  });

  it('every kind has a label; § sources on the two VOB/B kinds', () => {
    assert.equal(nachtragArtLabel('zusatzleistung'), 'Zusätzliche Leistung');
    assert.equal(nachtragArtLabel(null), '');
    assert.ok(NACHTRAG_ARTEN.filter((a) => a.quelle.startsWith('VOB/B § 2')).length === 2);
  });
});
