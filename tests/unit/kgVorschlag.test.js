// kgVorschlaege orchestration (Phase 76-03): blocks in sequence, answers merged,
// errors passed through unchanged, empty catalog refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kgVorschlaege } from '@ava/lib/kgVorschlag.js';
import { TYPESAFE_BLOCK } from '@ava/lib/kgVerdichtung.js';

const DIN = [
  { fassung: '2018', code: '341', name: 'Tragende Innenwände' },
  { fassung: '2018', code: '391', name: 'Baustelleneinrichtung' },
];

function stub() {
  const aufrufe = [];
  return {
    aufrufe,
    fn: async (block) => {
      aufrufe.push(block);
      const answers = {};
      for (const id of Object.keys(block.questions)) {
        answers[id] = { type: 'choice', choice: '391', probabilities: { 391: 0.9, 341: 0.08, unbekannt: 0.02 }, confidence: 0.9 };
      }
      return { model: 'jev-test', answers, usage: { input_tokens: 1 } };
    },
  };
}

test('kgVorschlaege: 41 Kurztexte → 2 Blöcke, 41 Vorschläge, Modell gesetzt', async () => {
  const s = stub();
  const texte = Array.from({ length: TYPESAFE_BLOCK + 1 }, (_, i) => `Position ${i + 1}`);
  const r = await kgVorschlaege(texte, DIN, '004 Rohbau', { urteileFn: s.fn });
  assert.equal(s.aufrufe.length, 2);
  // 83-02: the demo answer key is gone — the block goes to TypeSafe unchanged.
  assert.equal('demoKennung' in s.aufrufe[0], false);
  assert.equal(s.aufrufe[0].state.gewerk, '004 Rohbau');
  assert.equal(r.vorschlaege.length, 41);
  assert.equal(r.vorschlaege[40].nr, 41);
  assert.equal(r.vorschlaege[40].kurztext, 'Position 41');
  assert.equal(r.vorschlaege[0].kg2018, '391');
  // Gemessene Konstante (76-04): Stufen hoch/mittel abgeschaltet → immer niedrig, p bleibt sichtbar.
  assert.equal(r.vorschlaege[0].confidence, 'niedrig');
  assert.equal(r.vorschlaege[0].wahrscheinlichkeit, 0.9);
  assert.equal(r.modell, 'jev-test');
  for (const v of r.vorschlaege) assert.equal(v.angenommen, false);
});

test('kgVorschlaege: Fehler des Clients kommen unverändert an', async () => {
  const kaputt = async () => { throw new Error('TYPESAFE_API_KEY fehlt in .env — Urteile werden nicht simuliert'); };
  await assert.rejects(kgVorschlaege(['x'], DIN, null, { urteileFn: kaputt }), /TYPESAFE_API_KEY fehlt/);
});

test('kgVorschlaege: leerer Katalog → Klartext, kein Aufruf', async () => {
  const s = stub();
  await assert.rejects(kgVorschlaege(['x'], [], null, { urteileFn: s.fn }), /Din276Katalog leer/);
  assert.equal(s.aufrufe.length, 0);
});

test('kgVorschlaege: keine Kurztexte → keine Aufrufe, leeres Ergebnis', async () => {
  const s = stub();
  const r = await kgVorschlaege([], DIN, null, { urteileFn: s.fn });
  assert.equal(s.aufrufe.length, 0);
  assert.deepEqual(r.vorschlaege, []);
});
