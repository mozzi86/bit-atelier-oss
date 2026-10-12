// 88-06 (RE-17): plan management — index letters, number scheme (plankopf 90-01),
// forward-only status, release only from "geprüft" with a name, index change, audit entry.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  naechsterIndex, planNummer, planUebergangErlaubt, planPruefung, statusPatch, freigabePatch,
  indexPatch, auditEintrag, neuerPlan,
} from '@/lib/werkplanung/plaene.js';

const P = { id: 'p1', projekt_kurz: 'mus', lph: '5', gewerk: 'ar', nr: '12', titel: 'Grundriss EG', massstab: '1:50', status: 'in_arbeit', index: '' };

describe('88-06 Planverwaltung', () => {
  it('index letters: first issue → A, Z → AA, AZ → BA; non-letters rejected', () => {
    assert.equal(naechsterIndex(''), 'A');
    assert.equal(naechsterIndex('A'), 'B');
    assert.equal(naechsterIndex('Z'), 'AA');
    assert.equal(naechsterIndex('AZ'), 'BA');
    assert.throws(() => naechsterIndex('3'), /Buchstabenindex/);
  });

  it('number follows the plankopf scheme, index only in the full number', () => {
    assert.deepEqual(planNummer(P), { basis: 'MUS-LP5-AR-012', voll: 'MUS-LP5-AR-012' });
    assert.equal(planNummer({ ...P, index: 'B' }).voll, 'MUS-LP5-AR-012-B');
  });

  it('status forward only; release only from geprueft and with a name', () => {
    assert.equal(planUebergangErlaubt('in_arbeit', 'vorabzug'), true);
    assert.equal(planUebergangErlaubt('geprueft', 'in_arbeit'), false);
    assert.equal(statusPatch(P, 'freigegeben'), null, 'release has its own patch');
    assert.equal(freigabePatch(P, 'A. Muster'), null, 'not from in_arbeit');
    assert.equal(freigabePatch({ ...P, status: 'geprueft' }, '  '), null, 'name required');
    const f = freigabePatch({ ...P, status: 'geprueft' }, 'A. Muster', new Date('2026-10-12T10:00:00Z'));
    assert.deepEqual(f, { status: 'freigegeben', freigabe: { von: 'A. Muster', am: '2026-10-12T10:00:00.000Z' } });
  });

  it('new index resets status, clears release and file, appends history', () => {
    const alt = { ...P, status: 'freigegeben', index: 'A', indizes: [{ index: 'A', datum: '2026-09-01', aenderung: 'x' }], freigabe: { von: 'v', am: 'a' }, datei_ref: 'doc-1' };
    const patch = indexPatch(alt, 'Türen angepasst', new Date('2026-10-12T00:00:00Z'));
    assert.equal(patch?.index, 'B');
    assert.equal(patch?.status, 'in_arbeit');
    assert.equal(patch?.freigabe, null);
    assert.equal(patch?.datei_ref, null);
    assert.deepEqual(patch?.indizes.at(-1), { index: 'B', datum: '2026-10-12', aenderung: 'Türen angepasst' });
    assert.equal(indexPatch(alt, ''), null);
  });

  it('findings: duplicate number warns, scale format, release without file', () => {
    const b = { ...P, id: 'p2' };
    assert.deepEqual(planPruefung(P, [P, b]).map((h) => h.code), ['nummer_doppelt']);
    assert.deepEqual(planPruefung({ ...P, massstab: '50' }, [P]).map((h) => h.code), ['massstab']);
    assert.deepEqual(planPruefung({ ...P, status: 'freigegeben' }, [P]).map((h) => h.code), ['freigabe_ohne_datei']);
    assert.ok(planPruefung({ ...P, projekt_kurz: '', lph: '', gewerk: '', nr: '' }, []).some((h) => h.code === 'nummer_fehlt'));
  });

  it('audit entry carries the full number, plan id and actor', () => {
    const a = auditEintrag({ projectId: 'proj', plan: { ...P, index: 'A' }, aktion: 'freigabe', actor: 'A. Muster', jetzt: new Date('2026-10-12T00:00:00Z') });
    assert.equal(a.action, 'Plan freigegeben');
    assert.equal(a.unit_id, 'p1');
    assert.equal(a.unit_name, 'MUS-LP5-AR-012-A');
    assert.match(a.detail, /Grundriss EG/);
  });

  it('new plan starts in progress as first issue; unknown format dropped', () => {
    const n = neuerPlan({ ...P, format: 'B7' }, 'proj');
    assert.equal(n.status, 'in_arbeit');
    assert.equal(n.index, '');
    assert.equal(n.format, '');
    assert.equal(n.project_id, 'proj');
  });
});
