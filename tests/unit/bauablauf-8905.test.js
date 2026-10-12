// 89-05 (BW-07/08): construction sequence chain — predecessor checks (EA/AA/EE, cycles, trade
// order), award units with latest award date, coverage report element → trade/BoQ/task, form fields.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GEWERKE_KATALOG, vorgaengerPruefung, vergabeeinheiten, deckungsreport, deckungCsv, taskFelder, elementGuid,
} from '@/lib/planung/bauablauf.js';

const T = (id, start, end, extra = {}) => ({ id, name: id, start_date: `${start}T07:00:00Z`, end_date: `${end}T17:00:00Z`, ...extra });
const codes = (m, id) => (m.get(id) || []).map((h) => h.code).sort();

describe('89-05 Bauablauf-Kette', () => {
  it('catalogue covers the 16 STLB work sections of the seed with a unique order', () => {
    assert.equal(GEWERKE_KATALOG.length, 16);
    assert.equal(new Set(GEWERKE_KATALOG.map((g) => g.folge)).size, 16);
  });

  it('finish-to-start violation warns; lag respected; AA and EE', () => {
    const a = T('a', '2026-03-01', '2026-03-10');
    assert.deepEqual(codes(vorgaengerPruefung([a, T('b', '2026-03-05', '2026-03-20', { vorgaenger: [{ id: 'a' }] })]), 'b'), ['termin']);
    assert.deepEqual(codes(vorgaengerPruefung([a, T('b', '2026-03-11', '2026-03-20', { vorgaenger: [{ id: 'a' }] })]), 'b'), []);
    assert.deepEqual(codes(vorgaengerPruefung([a, T('b', '2026-03-11', '2026-03-20', { vorgaenger: [{ id: 'a', abstand_tage: 3 }] })]), 'b'), ['termin']);
    assert.deepEqual(codes(vorgaengerPruefung([a, T('b', '2026-03-02', '2026-03-20', { vorgaenger: [{ id: 'a', art: 'AA' }] })]), 'b'), []);
    assert.deepEqual(codes(vorgaengerPruefung([a, T('b', '2026-03-02', '2026-03-09', { vorgaenger: [{ id: 'a', art: 'EE' }] })]), 'b'), ['termin']);
    const all = vorgaengerPruefung([a, T('b', '2026-03-05', '2026-03-20', { vorgaenger: [{ id: 'a' }] })]);
    assert.ok([...all.values()].flat().every((h) => h.stufe === 'warn' || h.stufe === 'hinweis'));
  });

  it('cycle, missing predecessor, unusual trade order', () => {
    const m = vorgaengerPruefung([
      T('x', '2026-01-01', '2026-01-02', { vorgaenger: [{ id: 'y' }] }),
      T('y', '2026-01-03', '2026-01-04', { vorgaenger: [{ id: 'x' }] }),
    ]);
    assert.ok(codes(m, 'x').includes('zyklus') && codes(m, 'y').includes('zyklus'));
    assert.deepEqual(codes(vorgaengerPruefung([T('z', '2026-01-01', '2026-01-02', { vorgaenger: [{ id: 'weg' }] })]), 'z'), ['vorgaenger_fehlt']);
    const maler = T('m', '2026-01-01', '2026-01-02', { gewerk_lb: '034' });
    const putz = T('p', '2026-01-03', '2026-01-04', { gewerk_lb: '023', vorgaenger: [{ id: 'm' }] });
    assert.deepEqual(codes(vorgaengerPruefung([maler, putz]), 'p'), ['reihenfolge']);
  });

  it('award units: grouped, earliest start, latest award 42 days before', () => {
    const v = vergabeeinheiten([
      T('a', '2026-05-15', '2026-06-01', { vergabeeinheit: 'VE 02', gewerk_lb: '013', lv_position_ids: ['p1', 'p2'] }),
      T('b', '2026-05-01', '2026-05-20', { vergabeeinheit: 'VE 02', gewerk_lb: '012', lv_position_ids: ['p2'] }),
      T('c', '2026-04-01', '2026-04-02'),
    ]);
    assert.equal(v.length, 1);
    assert.equal(v[0].start, '2026-05-01');
    assert.equal(v[0].vergabeSpaetestens, '2026-03-20');
    assert.equal(v[0].positionen, 2);
    assert.deepEqual(v[0].gewerke.sort(), ['012 Mauerarbeiten', '013 Betonarbeiten']);
  });

  it('coverage: trade from element or task, position via bim_element_ids/nachweis, task via GUID or position', () => {
    const elemente = [{ guid: 'G1', name: 'Wand 1', gewerk: 'Rohbau' }, { globalId: 'G2', name: 'Decke' }, { id: 'G3', name: 'Stütze' }];
    const positionen = [{ id: 'p1', oz: '01.0010', bim_element_ids: ['G1'] }, { id: 'p2', oz: '01.0020', nachweis_element_ids: ['G2'] }];
    const tasks = [{ id: 't1', name: 'Decken', gewerk_lb: '013', lv_position_ids: ['p2'] }, { id: 't2', name: 'Wände', bauteil_guids: ['G1'] }];
    const r = deckungsreport({ elemente, tasks, positionen });
    assert.equal(r.gesamt, 3);
    assert.equal(r.vollstaendig, 2);
    assert.equal(r.zeilen[1].gewerk, '013 Betonarbeiten');
    assert.deepEqual(r.zeilen[2], { guid: 'G3', name: 'Stütze', gewerk: null, positionen: [], vorgaenge: [] });
    assert.match(deckungCsv(r).split('\n')[3], /^G3;Stütze;;;;nein$/);
    assert.equal(elementGuid({ GlobalId: 'X' }), 'X');
  });

  it('form fields: catalogue name fills an empty trade, GUIDs split and deduplicated', () => {
    const f = taskFelder({ gewerk_lb: '013', trade: '', bauteil_guids: 'A, B\nA', vorgaenger: [{ id: 'a', art: 'XX' }], lv_position_ids: ['p1', 'p1'] });
    assert.equal(f.trade, 'Betonarbeiten');
    assert.deepEqual(f.bauteil_guids, ['A', 'B']);
    assert.deepEqual(f.vorgaenger, [{ id: 'a', art: 'EA', abstand_tage: 0 }]);
    assert.deepEqual(f.lv_position_ids, ['p1']);
    assert.equal(taskFelder({ gewerk_lb: '013', trade: 'Rohbau' }).trade, 'Rohbau');
  });
});
