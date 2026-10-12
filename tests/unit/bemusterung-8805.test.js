// 88-05 (RE-11/12): room book per room type (clear height guide values, CSV) and
// sampling (colour formats, submit/decide, suggestions from the room book, protocol PDF).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { raumbuchVon, lichteHoeheMindest, raumbuchHinweise, raumbuchCsv } from '@designer/lib/raumbuch.js';
import {
  farbeGueltig, bemusterungHinweise, vorlagePatch, entscheidungPatch, neueBemusterung,
  vorschlaegeAusRaumbuch, bemusterungsProtokollPdf, naechsteBemusterungNr,
} from '@/lib/werkplanung/bemusterung.js';

describe('88-05 Raumbuch', () => {
  it('legacy items without raumbuch normalise to empty values', () => {
    assert.deepEqual(raumbuchVon({ use: 'buero' }), { boden: '', sockel: '', wand: '', decke: '', lichte_hoehe_m: null, bemerkung: '' });
    assert.equal(raumbuchVon({ raumbuch: { lichte_hoehe_m: '2,6' } }).lichte_hoehe_m, 2.6);
  });

  it('clear height guide values: MBO § 47 for housing, ASR A1.2 steps for work rooms', () => {
    assert.deepEqual(lichteHoeheMindest('wohnen', 70), { min_m: 2.4, quelle: 'MBO § 47 Abs. 1' });
    assert.equal(lichteHoeheMindest('buero', 25)?.min_m, 2.5);
    assert.equal(lichteHoeheMindest('buero', 80)?.min_m, 2.75);
    assert.equal(lichteHoeheMindest('handel', 150)?.min_m, 3.0);
    assert.equal(lichteHoeheMindest('gewerbe', 2500)?.min_m, 3.25);
    assert.equal(lichteHoeheMindest('parken', 25), null);
  });

  it('finding below the guide value is warn; partial row is hinweis', () => {
    const h = raumbuchHinweise({ use: 'buero', area: 25, raumbuch: { boden: 'Linoleum', lichte_hoehe_m: 2.4 } });
    assert.deepEqual(h.map((x) => [x.code, x.stufe]), [['lichte_hoehe', 'warn'], ['unvollstaendig', 'hinweis']]);
    assert.deepEqual(raumbuchHinweise({ use: 'buero', area: 25, raumbuch: { lichte_hoehe_m: 2.5 } }), []);
  });

  it('CSV with semicolons, German decimal comma and quoting', () => {
    const csv = raumbuchCsv([{ use: 'buero', area: 25, count: 4, raumbuch: { boden: 'Linoleum; 2,5 mm', lichte_hoehe_m: 2.75 } }], () => 'Büro');
    assert.equal(csv.split('\n')[1], 'Büro;25;4;"Linoleum; 2,5 mm";;;;2,75;');
  });
});

describe('88-05 Bemusterung', () => {
  it('colour formats RAL Classic/Design and NCS', () => {
    assert.ok(farbeGueltig('RAL', 'RAL 9010'));
    assert.ok(farbeGueltig('RAL', 'RAL 210 50 20'));
    assert.ok(!farbeGueltig('RAL', '9010 weiß'));
    assert.ok(farbeGueltig('NCS', 'S 0502-Y'));
    assert.ok(farbeGueltig('NCS', 'NCS S 2030-Y90R'));
    assert.ok(farbeGueltig('NCS', 'S 0500-N'));
    assert.ok(!farbeGueltig('NCS', 'RAL 9010'));
    assert.ok(farbeGueltig('sonstig', 'eichefarben'));
  });

  it('submit, then decide with a name; numbering B-001', () => {
    const b = neueBemusterung({ gegenstand: 'Boden: Linoleum', fabrikat: 'Hersteller A', farbe_system: 'RAL', farbe: 'RAL 7035' }, { projectId: 'p', alle: [] });
    assert.equal(b.nr, 'B-001');
    assert.equal(naechsteBemusterungNr([{ nr: 'B-004' }]), 'B-005');
    assert.equal(entscheidungPatch(b, 'freigegeben', 'Bauherr'), null, 'not submitted yet');
    const v = vorlagePatch(b, new Date('2026-10-12T00:00:00Z'));
    assert.deepEqual(v, { status: 'vorgelegt', vorgelegt_am: '2026-10-12' });
    const e = entscheidungPatch({ ...b, ...v }, 'freigegeben', 'Bauherr Muster', 'wie Muster', new Date('2026-10-13T00:00:00Z'));
    assert.equal(e?.status, 'freigegeben');
    assert.equal(e?.freigabe.von, 'Bauherr Muster');
    assert.equal(entscheidungPatch({ ...b, ...v }, 'freigegeben', ' '), null);
    assert.deepEqual(bemusterungHinweise({ ...b, ...v, ...e }).map((h) => h.code), ['ohne_position']);
  });

  it('suggestions: one per distinct finish, room types joined, existing samples skipped', () => {
    const items = [
      { use: 'buero', raumbuch: { boden: 'Linoleum', wand: 'Dispersion weiß' } },
      { use: 'gemeinschaft', raumbuch: { boden: 'linoleum' } },
    ];
    const v = vorschlaegeAusRaumbuch(items, [{ gegenstand: 'Wand: Dispersion weiß' }]);
    assert.deepEqual(v, [{ gegenstand: 'Boden: Linoleum', raum_bezug: 'Büro, Gemeinschaft' }]);
  });

  it('protocol PDF contains only decided samples', async () => {
    const muster = [
      { nr: 'B-001', gegenstand: 'Boden: Linoleum', status: 'freigegeben', farbe: 'RAL 7035', freigabe: { von: 'Bauherr Muster', am: '2026-10-13T00:00:00Z' } },
      { nr: 'B-002', gegenstand: 'Wand', status: 'offen' },
    ];
    const r = await bemusterungsProtokollPdf({ projekt: { name: 'Testprojekt' }, muster, jetzt: new Date('2026-10-13T00:00:00Z') });
    assert.equal(r.anzahl, 1);
    assert.equal(r.dateiname, 'Bemusterungsprotokoll_Testprojekt_2026-10-13.pdf');
    assert.equal(Buffer.from(r.bytes.subarray(0, 4)).toString('latin1'), '%PDF');
  });
});
