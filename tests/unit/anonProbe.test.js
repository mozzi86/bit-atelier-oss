// Unit tests for scripts/anon-probe.mjs (57-06 Task 8). No network: probeLaufen
// gets a stub fetch. The live run against the project is a post-deploy step.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TABELLEN, bewerteRpc, bewerteSignup, bewerteTabelle, probeLaufen, umgebungLesen } from '../../scripts/anon-probe.mjs';

/** Stub fetch answering by path; records every call. */
function stubFetch(antworten) {
  const aufrufe = [];
  const fn = async (url, init = {}) => {
    const pfad = new URL(url).pathname;
    aufrufe.push({ pfad, init });
    const [status, body] = antworten[pfad] || [404, { message: 'unbekannt' }];
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, aufrufe };
}

describe('anon-probe — Bewertung', () => {
  it('Fehler = PASS, 0 Zeilen = WARN, Zeilen = FAIL — die drei Fälle bleiben getrennt', () => {
    assert.equal(bewerteTabelle(401, { code: '42501' }).urteil, 'PASS');
    assert.match(bewerteTabelle(401, { code: '42501' }).text, /42501/);
    assert.equal(bewerteTabelle(200, []).urteil, 'WARN');
    assert.equal(bewerteTabelle(200, [{ id: 'x' }]).urteil, 'FAIL');
  });
  it('rpc: Fehler PASS, false WARN, alles andere FAIL', () => {
    assert.equal(bewerteRpc(404, {}).urteil, 'PASS');
    assert.equal(bewerteRpc(200, false).urteil, 'WARN');
    assert.equal(bewerteRpc(200, true).urteil, 'FAIL');
  });
  it('signup: abgelehnt PASS, angelegt FAIL mit Adresse und Dashboard-Pfad', () => {
    assert.equal(bewerteSignup(422, { msg: 'Signups not allowed for this instance' }, 'p@example.de').urteil, 'PASS');
    const f = bewerteSignup(200, { id: 'u' }, 'p@example.de');
    assert.equal(f.urteil, 'FAIL');
    assert.match(f.text, /p@example\.de/);
    assert.match(f.text, /Allow new users to sign up/);
  });
});

describe('anon-probe — Ablauf', () => {
  it('fragt alle vier Tabellen und die rpc mit dem anon-Schlüssel ab, ohne Signup nichts Schreibendes', async () => {
    const antworten = Object.fromEntries(TABELLEN.map((t) => [`/rest/v1/${t}`, [401, { code: '42501' }]]));
    antworten['/rest/v1/rpc/ist_mitglied'] = [404, { code: 'PGRST202' }];
    const { fn, aufrufe } = stubFetch(antworten);
    const e = await probeLaufen({ url: 'https://p.example', anon: 'pub' }, { fetchFn: fn });
    assert.equal(e.length, 5);
    assert.ok(e.every((x) => x.urteil === 'PASS'));
    assert.ok(aufrufe.every((a) => a.init.headers.apikey === 'pub'));
    assert.ok(!aufrufe.some((a) => a.pfad.includes('signup')));
  });
  it('mit --signup: sechste Probe gegen /auth/v1/signup', async () => {
    const { fn, aufrufe } = stubFetch({ '/auth/v1/signup': [422, { msg: 'Signups not allowed' }] });
    const e = await probeLaufen({ url: 'https://p.example', anon: 'pub' }, { fetchFn: fn, signup: 'probe@example.de' });
    assert.equal(e.length, 6);
    assert.equal(e.at(-1).urteil, 'PASS');
    assert.equal(JSON.parse(aufrufe.at(-1).init.body).email, 'probe@example.de');
  });
});

describe('anon-probe — Umgebung', () => {
  it('liest auch die VITE_-Namen; fehlende Werte im Klartext', () => {
    assert.deepEqual(umgebungLesen({ VITE_SUPABASE_URL: 'https://p.example/', VITE_SUPABASE_ANON_KEY: 'k' }), { url: 'https://p.example', anon: 'k' });
    assert.throws(() => umgebungLesen({}), /SUPABASE_URL.*SUPABASE_ANON_KEY/);
  });
});
