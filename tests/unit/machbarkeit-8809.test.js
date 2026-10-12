// 88-09 (RE-23…25): BauNVO §§ 19–21 target vs. actual, full-storey check, residual land value.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { vollgeschoss, massDerNutzung, barwertfaktor, residualwert } from '@/lib/machbarkeit/kennzahlen.js';

const G = (dok, a230 = 400) => ({ name: 'G', flaeche_m2: 400, flaeche_h230_m2: a230, doK_ueber_gelaende_m: dok, hoehe_m: 3 });

describe('88-09 Machbarkeit', () => {
  it('full storey: > 1.40 m above ground and ≥ 2/3 with 2.30 m clear height', () => {
    assert.equal(vollgeschoss(G(3)).voll, true);
    assert.equal(vollgeschoss(G(1.2)).voll, false, 'basement');
    assert.equal(vollgeschoss(G(9, 200)).voll, false, 'attic below 2/3');
    assert.equal(vollgeschoss(G(9, 270)).voll, true, '270/400 ≥ 2/3');
    assert.equal(vollgeschoss({}).voll, null);
  });

  it('GRZ, GRZ II cap 0.8, GFZ only from full storeys, BMZ from storey volume', () => {
    const e = massDerNutzung({ grundstueck_m2: 1000, grz_max: 0.4, gfz_max: 1.0, bmz_max: 3, grundflaeche_m2: 400, nebenanlagen_m2: 250,
      geschosse: [G(1.0), G(3), G(6), G(9, 200)] });
    assert.equal(e.grz, 0.4);
    assert.equal(e.grz2, 0.65);
    assert.equal(e.grz2_max, 0.6, '0.4 × 1.5');
    assert.equal(e.vollgeschosse, 2);
    assert.equal(e.gfz, 0.8);
    assert.equal(e.baumasse_m3, 2400);
    assert.equal(e.bmz, 2.4);
    const codes = e.hinweise.map((h) => h.code);
    assert.ok(codes.includes('grz2') && !codes.includes('grz') && !codes.includes('gfz'));
    assert.ok(e.hinweise.every((h) => h.stufe === 'warn' || h.stufe === 'hinweis'));
    assert.equal(massDerNutzung({ grz_max: 0.6 }).grz2_max, 0.8, 'cap 0.8');
    assert.equal(massDerNutzung({ grz_max: 0.9 }).grz2_max, 0.9, 'never below grz_max');
  });

  it('present value factor ImmoWertV § 34', () => {
    assert.ok(Math.abs(barwertfaktor(0.05, 20) - 12.4622) < 1e-4);
    assert.equal(barwertfaktor(0, 20), 0);
  });

  it('residual value, sale mode, default rates', () => {
    const r = residualwert({ modus: 'verkauf', flaeche_m2: 1000, preis_eur_m2: 5000, bgf_m2: 1300, baukosten_eur_m2_bgf: 2500 }, 1000);
    assert.equal(r.erloes, 5000000);
    assert.equal(r.baukosten, 3250000);
    assert.equal(r.nebenkosten, 650000);
    assert.equal(r.finanzierung, 195000);
    assert.equal(r.gewinn, 750000);
    assert.equal(r.residuum, 155000);
    assert.equal(r.bodenwert, 143518.52);
    assert.equal(r.bodenwert_je_m2, 143.52);
    assert.equal(residualwert({ modus: 'verkauf' }).bodenwert, null);
  });

  it('residual value, income mode uses net annual income × present value factor', () => {
    const r = residualwert({ modus: 'ertrag', flaeche_m2: 100, miete_eur_m2_monat: 10, bgf_m2: 0, baukosten_eur_m2_bgf: 0 });
    assert.equal(r.jahresreinertrag, 9600);
    assert.ok(r.erloes !== null && r.erloes > 9600 * 20);
  });
});
