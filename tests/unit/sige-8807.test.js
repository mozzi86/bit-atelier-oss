// 88-07 (RE-06, D-RE-04): BaustellV duties as hints, hazard matrix, prior notice PDF draft.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { ANHANG_I, ANHANG_II, sigePflichten, gefaehrdungsMatrix, anhangIWert, vorankuendigungPdf } from '@/lib/werkplanung/sige.js';

const codes = (s) => sigePflichten(s).hinweise.map((h) => h.code);

describe('88-07 SiGe', () => {
  it('annexes: 9 fields of Anhang I, 10 rows of Anhang II', () => {
    assert.equal(ANHANG_I.length, 9);
    assert.deepEqual(ANHANG_II.map((z) => z.nr), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('prior notice: > 30 days AND > 20 workers, or > 500 person-days', () => {
    assert.equal(sigePflichten({ arbeitstage: 31, max_beschaeftigte: 21 }).vorankuendigung, true);
    assert.equal(sigePflichten({ arbeitstage: 31, max_beschaeftigte: 20 }).vorankuendigung, false);
    assert.equal(sigePflichten({ personentage: 501 }).vorankuendigung, true);
    assert.equal(sigePflichten({}).vorankuendigung, null);
  });

  it('coordinator with several employers; SiGe plan with prior notice or Annex II works', () => {
    assert.ok(codes({ arbeitgeber_anzahl: 2, personentage: 100 }).includes('sigeko'));
    assert.ok(!codes({ arbeitgeber_anzahl: 2, personentage: 100 }).includes('sige_plan'));
    assert.ok(codes({ arbeitgeber_anzahl: 2, personentage: 100, gefaehrdungen: { 1: { zutreffend: true } } }).includes('sige_plan'));
    assert.ok(codes({ arbeitgeber_anzahl: 3, personentage: 600 }).includes('vorankuendigung'));
  });

  it('never fail; liability disclaimer always present', () => {
    const p = sigePflichten({ arbeitgeber_anzahl: 5, personentage: 900 });
    assert.ok(p.hinweise.every((h) => h.stufe === 'warn' || h.stufe === 'hinweis'));
    assert.ok(p.hinweise.some((h) => h.code === 'haftung'));
  });

  it('matrix marks typical rows by trade keywords and keeps own marking', () => {
    const m = gefaehrdungsMatrix(['Rohbau', 'Abbruch', 'Maler'], { 9: { zutreffend: false } });
    assert.deepEqual(m.find((z) => z.nr === 1)?.typisch, ['Rohbau', 'Abbruch']);
    assert.deepEqual(m.find((z) => z.nr === 2)?.typisch, ['Abbruch']);
    assert.equal(m.find((z) => z.nr === 9)?.zutreffend, false);
    assert.equal(m.find((z) => z.nr === 7)?.typisch.length, 0);
  });

  it('prior notice PDF draft counts open fields', async () => {
    assert.equal(anhangIWert({ beginn: '2026-11-02', dauer_text: '14 Monate' }, 'beginn_dauer'), 'Beginn 2.11.2026, 14 Monate');
    const r = await vorankuendigungPdf({ s: { ort: 'Musterstadt', bauherr: 'Bauherr Muster' }, projektName: 'Testprojekt' });
    assert.equal(r.offen, 7);
    assert.equal(r.dateiname, 'Vorankuendigung_Testprojekt_Entwurf.pdf');
    assert.equal(Buffer.from(r.bytes.subarray(0, 4)).toString('latin1'), '%PDF');
  });
});
