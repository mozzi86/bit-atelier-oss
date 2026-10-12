// 88-01 (RE-01): openings planning — numbering, review order structure → architect,
// findings (warn only), BCF topic with selection, comments and camera; bcf.js camera additive.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  naechsteNr, masseText, durchbruchHinweise, pruefSchritt, ausgefuehrtPatch, neuerDurchbruch,
  alsBcfTopic, DURCHBRUCH_GEWERKE,
} from '@/lib/werkplanung/durchbrueche.js';
import { buildBcfZip } from '@ifc/lib/bcf.js';
import { parseBcfZip } from '@ifc/lib/bcfImport.js';

const GUID = '2O2Fr$t4X7Zf8NOew3FLOH';
const seq = () => { let i = 0; return () => ((i += 1) % 97) / 97; };
const basis = (w = {}) => neuerDurchbruch({ art: 'durchbruch', form: 'rechteck', b_mm: '200', h_mm: '300', x: '1', y: '2', z: '3', bauteil_guid: GUID, gewerk: 'GH', ...w }, { projectId: 'p', alle: [], rng: seq() });

describe('88-01 Durchbruchsplanung', () => {
  it('numbers continue after the highest; sizes are stored in metres and shown in mm', () => {
    assert.equal(naechsteNr([]), 'D-001');
    assert.equal(naechsteNr([{ nr: 'D-007' }, { nr: 'X' }]), 'D-008');
    const d = basis();
    assert.equal(d.b, 0.2);
    assert.equal(d.h, 0.3);
    assert.equal(masseText(d), '200 × 300 mm');
    assert.equal(masseText(basis({ art: 'kernbohrung', d_mm: '150' })), 'Ø 150 mm');
    assert.match(d.bcf_topic_guid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(d.status, 'beantragt');
  });

  it('trades come from the discipline catalogue (TGA/E/F + AX/TX)', () => {
    const codes = DURCHBRUCH_GEWERKE.map((g) => g.wert);
    assert.ok(codes.includes('GH') && codes.includes('EX') && codes.includes('FF') && codes.includes('TX'));
    assert.ok(!codes.includes('AM'));
  });

  it('review: structure first, then architect; rejection is final; name required', () => {
    const d = basis();
    assert.equal(pruefSchritt(d, 'architekt', 'ok', 'A'), null, 'architect before structure');
    assert.equal(pruefSchritt(d, 'statik', 'ok', ' '), null, 'name');
    const s = pruefSchritt(d, 'statik', 'ok', 'Tragwerksplanung', '', new Date('2026-10-12T00:00:00Z'));
    assert.equal(s?.status, 'statik_geprueft');
    const a = pruefSchritt({ ...d, ...s }, 'architekt', 'ok', 'Architektin');
    assert.equal(a?.status, 'freigegeben');
    assert.equal(a?.pruefung.statik?.von, 'Tragwerksplanung');
    assert.deepEqual(ausgefuehrtPatch({ ...d, ...a }), { status: 'ausgefuehrt' });
    assert.equal(pruefSchritt(d, 'statik', 'abgelehnt', 'T')?.status, 'abgelehnt');
    assert.equal(ausgefuehrtPatch(d), null);
  });

  it('findings: fire stop missing, no element, overlap in the same element — warn/hinweis only', () => {
    const d = { ...basis({ feuerwiderstand: 'EI 90' }), id: 'a' };
    assert.deepEqual(durchbruchHinweise(d).map((h) => h.code), ['abschottung_fehlt']);
    assert.ok(durchbruchHinweise({ ...d, bauteil_guid: '' }).some((h) => h.code === 'bauteil_fehlt'));
    const nah = { ...basis(), id: 'b', x: 1.1 };
    assert.ok(durchbruchHinweise(d, [d, nah]).some((h) => h.code === 'ueberlappung'));
    const fern = { ...basis(), id: 'c', x: 5 };
    assert.ok(!durchbruchHinweise(d, [d, fern]).some((h) => h.code === 'ueberlappung'));
    assert.ok(durchbruchHinweise(d, [d, nah]).every((h) => h.stufe === 'warn' || h.stufe === 'hinweis'));
  });

  it('BCF topic: element selection, review comments, status mapping, camera at the opening; round trip', () => {
    const d = basis();
    const s = pruefSchritt(d, 'statik', 'ok', 'Tragwerksplanung', 'Sturz nicht nötig', new Date('2026-10-12T00:00:00Z'));
    const topic = alsBcfTopic({ ...d, ...s, nr: 'D-001' });
    assert.deepEqual(topic.ifcGuids, [GUID]);
    assert.equal(topic.topicStatus, 'InProgress');
    assert.deepEqual(topic.kamera, { pos: [4, -1, 6], ziel: [1, 2, 3] });
    const zip = buildBcfZip([topic], { datum: '2026-10-12T00:00:00.000Z' });
    const text = new TextDecoder().decode(zip);
    assert.match(text, /<CameraViewPoint><X>4<\/X><Y>-1<\/Y><Z>6<\/Z><\/CameraViewPoint>/);
    assert.match(text, /Component IfcGuid="2O2Fr\$t4X7Zf8NOew3FLOH"/);
    const parse = parseBcfZip(zip);
    assert.equal(parse.topics.length, 1);
    assert.match(parse.topics[0].titel || parse.topics[0].title || '', /D-001/);
  });

  it('bcf.js without kamera stays byte-identical (neutral camera)', () => {
    const t = { guid: '0b9a3c1e-1111-4222-8333-444455556666', titel: 'x' };
    const ohne = new TextDecoder().decode(buildBcfZip([t], { datum: '2026-01-01T00:00:00.000Z' }));
    assert.match(ohne, /<CameraViewPoint><X>10\.0<\/X><Y>-10\.0<\/Y><Z>10\.0<\/Z><\/CameraViewPoint>/);
    const kaputt = new TextDecoder().decode(buildBcfZip([{ ...t, kamera: { pos: [1, 1, 1], ziel: [1, 1, 1] } }], { datum: '2026-01-01T00:00:00.000Z' }));
    assert.equal(kaputt, ohne, 'degenerate camera falls back to neutral');
  });
});
