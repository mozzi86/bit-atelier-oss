// 74-01: the pure parts of the three check scripts — no network, no project.
// scripts/supabase-zugriff-check.mjs (target lock, case runner),
// scripts/grants-pruefen.mjs (matrix comparison), scripts/supabase-bestand.mjs
// (counting, comparison).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { Lauf, zielPruefen } from '../../scripts/supabase-zugriff-check.mjs';
import { SOLL, vergleicheGrants } from '../../scripts/grants-pruefen.mjs';
import { umgebungLesen, vergleicheBestand, zaehleEntitaeten } from '../../scripts/supabase-bestand.mjs';

const WURZEL = path.resolve(import.meta.dirname, '..', '..');
const ZIEL = { ZUGRIFF_URL: 'https://wegwerf.supabase.co', ZUGRIFF_ANON: 'a', ZUGRIFF_SERVICE: 's' };

describe('supabase-zugriff-check — Zielsperre', () => {
  it('ohne --wegwerf, ohne Variablen → Abbruch', () => {
    assert.match(zielPruefen(ZIEL, []).grund, /--wegwerf/);
    assert.match(zielPruefen({}, ['--wegwerf']).grund, /ZUGRIFF_URL, ZUGRIFF_ANON, ZUGRIFF_SERVICE/);
  });
  it('verweigert jede URL, die einer Echtsystem-Variable gleicht — auch SUPABASE_URL_DEV (das Echtsystem heißt historisch dev)', () => {
    for (const name of ['SUPABASE_URL_DEV', 'SUPABASE_URL_PROD', 'SUPABASE_URL', 'VITE_SUPABASE_URL']) {
      const r = zielPruefen({ ...ZIEL, [name]: 'https://WEGWERF.supabase.co/' }, ['--wegwerf']);
      assert.equal(r.ok, false, name);
      assert.match(r.grund, new RegExp(name));
    }
    assert.equal(zielPruefen({ ...ZIEL, ZUGRIFF_URL: 'https://prod-x.supabase.co' }, ['--wegwerf']).ok, false);
  });
  it('Wegwerf-Projekt mit Flagge → ok', () => {
    assert.equal(zielPruefen({ ...ZIEL, SUPABASE_URL_DEV: 'https://live.supabase.co' }, ['--wegwerf']).ok, true);
  });
  it('die Schlüsselnamen des Echtsystems kommen im Skript nur in der Sperre vor', () => {
    const q = fs.readFileSync(path.join(WURZEL, 'scripts/supabase-zugriff-check.mjs'), 'utf8');
    assert.doesNotMatch(q, /env\.SUPABASE_SERVICE|SUPABASE_ANON_DEV|SUPABASE_SERVICE_DEV/);
  });
});

describe('supabase-zugriff-check — Fallzähler', () => {
  it('PASS/FAIL/SKIP und Exit-Code: FAIL → 1, nur SKIP → 2, alles grün → 0', async () => {
    const zeilen = [];
    const l = new Lauf((z) => zeilen.push(z));
    await l.fall('A-1', 'ok', async () => true);
    await l.fall('A-2', 'skip', async () => 'SKIP Function nicht deployt');
    assert.deepEqual(l.summe(), { pass: 1, fail: 0, skip: 1, code: 2 });
    await l.fall('A-3', 'wirft', async () => { throw new Error('kaputt'); });
    await l.fall('A-4', 'falsch', async () => false);
    assert.equal(l.summe().code, 1);
    assert.match(zeilen[2], /^\[FAIL\] A-3 wirft — kaputt$/);
    assert.match(zeilen[1], /^\[SKIP\] A-2 skip — Function nicht deployt$/);
    const gruen = new Lauf(() => {});
    await gruen.fall('A-1', 'x', async () => true);
    assert.equal(gruen.summe().code, 0);
  });
});

describe('grants-pruefen — Matrix', () => {
  const ist = () => SOLL.map((k) => {
    const [rolle, art, objekt, recht] = k.split('|');
    return { rolle, art, objekt, recht };
  });
  it('Soll gegen sich selbst: keine Abweichung; anon kommt im Soll nicht vor', () => {
    assert.deepEqual(vergleicheGrants(ist()), { zuviel: [], fehlt: [] });
    assert.equal(SOLL.some((k) => k.startsWith('anon|')), false);
  });
  it('ein zusätzliches Recht und ein fehlendes werden beide genannt', () => {
    const r = vergleicheGrants([
      ...ist().filter((z) => !(z.objekt === 'records' && z.recht === 'DELETE')),
      { rolle: 'anon', art: 'table', objekt: 'records', recht: 'SELECT' },
      { rolle: 'authenticated', art: 'function', objekt: 'protokoll_schreiben(p_org uuid, p_projekt text, p_aktion text, p_entity text, p_record text, p_detail jsonb, p_akteur uuid)', recht: 'EXECUTE' },
    ]);
    assert.deepEqual(r.fehlt, ['authenticated|table|records|DELETE']);
    assert.equal(r.zuviel.length, 2);
  });
  it('Funktionen werden nach Name und Typen verglichen, nicht nach Parameternamen', () => {
    const r = vergleicheGrants([...ist().filter((z) => !z.objekt.startsWith('rolle_in(')),
      { rolle: 'authenticated', art: 'function', objekt: 'rolle_in(org uuid)', recht: 'EXECUTE' }]);
    assert.deepEqual(r, { zuviel: [], fehlt: [] });
  });
  it('jede Funktion, die 0014 für authenticated freigibt, steht im Soll', () => {
    const sql = fs.readFileSync(path.join(WURZEL, 'supabase/migrations/0014_grants_zugriff.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('grant execute on function\n'), sql.indexOf('to authenticated;'));
    const namen = [...block.matchAll(/public\.([a-z_]+)\(/g)].map((m) => m[1]).sort();
    const imSoll = [...new Set(SOLL.filter((k) => k.includes('|function|')).map((k) => k.split('|')[2].split('(')[0]))].sort();
    assert.deepEqual(namen, imSoll);
  });
});

describe('supabase-bestand — Zählung', () => {
  it('zählt je Entität und vergleicht beidseitig', () => {
    const a = { records: zaehleEntitaeten([{ entity: 'Project' }, { entity: 'Tender' }, { entity: 'Project' }]), objekte: { blobs: 3, gebote: null } };
    assert.deepEqual(a.records, { Project: 2, Tender: 1 });
    assert.deepEqual(vergleicheBestand(a, a), []);
    const b = { records: { Project: 2 }, objekte: { blobs: 2, gebote: null } };
    assert.deepEqual(vergleicheBestand(a, b), ['records Tender: 1 → 0', 'objekte blobs: 3 → 2']);
  });
  it('fehlende Anmeldedaten im Klartext, Werte nie in der Meldung', () => {
    assert.throws(() => umgebungLesen({ BESTAND_URL: 'u', BESTAND_PASSWORT: 'geheim' }), (e) => /BESTAND_ANON, BESTAND_EMAIL/.test(e.message) && !e.message.includes('geheim'));
  });
});
