// mcp-schreiben-11102.test.js — safe writing over MCP (plan 111-02, findings K-05, K-07, K-11, S-12): tools/mcp-server.mjs as a child
// process against the app's REAL routers (entitiesRouter + papierkorbRouter on a createDb() temp file, in this process; a small
// middleware in front records every request and can play "somebody wrote in between"). Covers:
//  - without ausfuehren no POST/PUT/DELETE reaches the app; the preview has {vorher, nachher, geaenderte_felder, probleme,
//    naechster_schritt, stand} (update: vorher = stored record, only really different values; create: vorher null),
//  - ausfuehren with the preview's stand writes; a stand that no longer holds (MCP check, and the app's 409 in a race) is
//    "nicht übernommen: inzwischen geändert — neue Vorschau holen", not an error,
//  - duplicates (case, umlaut, double spaces) → "nicht übernommen: mögliche Dublette von <id>"; doppelt_erlaubt creates;
//    the same idempotenz_schluessel twice → one record,
//  - locked entities in any spelling, person-only entities and the bin are refused in the preview, nothing is sent; protected
//    project fields are problems in the preview and never sent,
//  - delete_record → Papierkorb → papierkorb_lesen → wiederherstellen,
//  - the mirrored lists equal routes.js / entitaeten.js / papierkorbRouter.js, and no tool name contains "bestaetig".
// Neutral test data only ("Testprojekt A", "Kontakt Muster"); never server/db.json.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDb } from '../../packages/nova-core/server/db.js';
import { entitiesRouter, gesperrteEntitaet, projektFelderSchuetzen } from '../../packages/nova-core/server/routes.js';
import { PAPIERKORB_ENTITY, papierkorbRouter, papierkorbSperre } from '../../packages/nova-core/server/papierkorbRouter.js';
import { KI_EINSTELLUNG_ENTITY } from '../../packages/nova-core/server/llmLokal.js';
import { PERSONAL_ENTITAETEN } from '../../packages/nova-core/src/api/personalEntitaeten.js';
import { NUR_PERSON_SCHREIBT } from '../../packages/nova-core/src/lib/verlauf/entitaeten.js';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKRIPT = path.join(WURZEL, 'tools', 'mcp-server.mjs');
const QUELLE = fs.readFileSync(SKRIPT, 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-11102-'));

/** The app's routers on a free port; `anfragen` = "METHOD /path?query" of every request; `rennen` = ids whose next PUT meets a newer record. */
async function app() {
  const db = createDb(path.join(TMP, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.json`));
  const anfragen = [];
  const rennen = new Set();
  const a = express();
  a.use(express.json());
  a.use('/api', (req, _res, next) => {
    anfragen.push(`${req.method} ${req.originalUrl.replace(/^\/api/, '')}`);
    const m = /^\/entities\/([^/]+)\/([^/?]+)$/.exec(req.path);
    if (req.method === 'PUT' && m && rennen.has(m[2])) {
      // somebody else writes between the MCP server's read and its write (a later updated_date than the preview's stand)
      rennen.delete(m[2]);
      const neu = new Date(Date.parse(db.get(m[1], m[2]).updated_date) + 1000).toISOString();
      db._raw()[m[1]].find((r) => r.id === m[2]).updated_date = neu;
    }
    next();
  });
  a.get('/api/system/datenordner', (_req, res) => res.json({ ordner: TMP }));
  a.get('/api/auth/me', (_req, res) => res.json({ id: 'u1', full_name: 'Testperson' }));
  a.use('/api', papierkorbSperre());
  a.use('/api', entitiesRouter(db));
  a.use('/api', papierkorbRouter(db));
  const server = await new Promise((r) => { const s = a.listen(0, '127.0.0.1', () => r(s)); });
  return {
    db, anfragen, rennen, url: `http://127.0.0.1:${server.address().port}/api`,
    /** @returns {string[]} the writing requests since the start */
    schreibend: () => anfragen.filter((x) => !x.startsWith('GET ')),
    schliessen: () => new Promise((r) => server.close(r)),
  };
}

/** The MCP server with --schreiben; `werkzeug` returns {isError, text, json}. */
function starteMcp(apiUrl) {
  const kind = spawn(process.execPath, [SKRIPT, '--schreiben'], { env: { ...process.env, BIT_API_URL: apiUrl, BIT_DATA_DIR: TMP }, stdio: ['pipe', 'pipe', 'pipe'] });
  const warter = new Map();
  let rest = '';
  kind.stdout.setEncoding('utf8');
  kind.stdout.on('data', (s) => {
    rest += s;
    let i;
    while ((i = rest.indexOf('\n')) >= 0) { const m = JSON.parse(rest.slice(0, i)); rest = rest.slice(i + 1); warter.get(m.id)?.(m); }
  });
  let n = 1;
  const rpc = (method, params) => { const id = n++; const p = new Promise((r) => warter.set(id, r)); kind.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); return p; };
  return {
    rpc,
    async werkzeug(name, args) {
      const r = await rpc('tools/call', { name, arguments: args });
      assert.ok(r.result, `${name}: ${JSON.stringify(r.error)}`);
      const text = r.result.content[0].text;
      let json = null;
      try { json = JSON.parse(text); } catch { /* prose */ }
      return { isError: r.result.isError === true, text, json };
    },
    ende: () => new Promise((r) => { kind.on('exit', r); kind.stdin.end(); }),
  };
}

let A;
let M;
let projekt;
before(async () => {
  A = await app();
  M = starteMcp(A.url);
  projekt = A.db.create('Project', { name: 'Testprojekt A', status: 'design' });
});
after(async () => {
  await M.ende();
  await A.schliessen();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder */ }
});

describe('111-02 — preview is the default (K-05)', () => {
  it('create_record without ausfuehren: vorher null, nachher, fields, problems, next step - and nothing written', async () => {
    const vorher = A.schreibend().length;
    const v = await M.werkzeug('create_record', { entity: 'Contact', data: { name: 'Kontakt Muster', project_id: projekt.id, id: 'eigene-id', erstkontakt_am: 'gestern' } });
    assert.equal(v.isError, false, v.text);
    for (const feld of ['vorher', 'nachher', 'geaenderte_felder', 'probleme', 'naechster_schritt', 'stand']) assert.ok(feld in v.json, feld);
    assert.equal(v.json.vorher, null);
    assert.equal(v.json.stand, null);
    assert.deepEqual(v.json.nachher, { name: 'Kontakt Muster', project_id: projekt.id, erstkontakt_am: 'gestern' }, 'the id is the app\'s, never sent');
    assert.deepEqual(v.json.probleme.map((p) => p.art).sort(), ['datum', 'neue_sammlung', 'nicht_gesendet']);
    assert.deepEqual(v.json.naechster_schritt.argumente, { entity: 'Contact', data: v.json.nachher, ausfuehren: true });
    assert.equal(A.schreibend().length, vorher, 'no POST/PUT/DELETE reached the app');
    assert.ok(!('Contact' in A.db._raw()), 'the preview did not even create the empty collection');
  });

  it('update_record without ausfuehren: vorher = stored record, only really different values, the stand; nothing written', async () => {
    const k = A.db.create('Contact', { name: 'Kontakt Vorschau', rolle: 'Tragwerk', project_id: projekt.id });
    const vorher = A.schreibend().length;
    const v = await M.werkzeug('update_record', { entity: 'Contact', id: k.id, data: { rolle: 'Bauphysik', name: 'Kontakt Vorschau' } });
    assert.deepEqual(v.json.vorher, k);
    assert.equal(v.json.nachher.rolle, 'Bauphysik');
    assert.deepEqual(v.json.geaenderte_felder, ['rolle']);
    assert.equal(v.json.stand, k.updated_date);
    assert.deepEqual(v.json.naechster_schritt.argumente, { entity: 'Contact', id: k.id, data: { rolle: 'Bauphysik' }, ausfuehren: true, stand: k.updated_date });
    assert.equal(A.schreibend().length, vorher);
    // ausfuehren with that stand writes, with ?stand= for the app's own check
    const a = await M.werkzeug('update_record', v.json.naechster_schritt.argumente);
    assert.equal(a.json.uebernommen, true);
    assert.equal(A.db.get('Contact', k.id).rolle, 'Bauphysik');
    assert.match(A.schreibend().at(-1), new RegExp(`^PUT /entities/Contact/${k.id}\\?stand=`));
  });

  it('a stand that no longer holds: "nicht übernommen: inzwischen geändert — neue Vorschau holen" (MCP check and the app\'s 409)', async () => {
    const k = A.db.create('Contact', { name: 'Kontakt Stand', rolle: 'a' });
    const v = await M.werkzeug('update_record', { entity: 'Contact', id: k.id, data: { rolle: 'b' } });
    // (1) changed after the preview: the MCP server sees the newer updated_date and sends nothing
    await new Promise((r) => setTimeout(r, 5));
    A.db.update('Contact', k.id, { rolle: 'von Hand' });
    const n1 = A.schreibend().length;
    const r1 = await M.werkzeug('update_record', v.json.naechster_schritt.argumente);
    assert.equal(r1.isError, false);
    assert.equal(r1.json.uebernommen, false);
    assert.match(r1.json.grund, /inzwischen geändert — neue Vorschau holen/);
    assert.equal(A.schreibend().length, n1);
    // (2) changed between the MCP server's read and its write: the app answers 409 (routes.js standVeraltet), same text
    const v2 = await M.werkzeug('update_record', { entity: 'Contact', id: k.id, data: { rolle: 'c' } });
    A.rennen.add(k.id);
    const r2 = await M.werkzeug('update_record', v2.json.naechster_schritt.argumente);
    assert.equal(r2.isError, false);
    assert.equal(r2.json.uebernommen, false);
    assert.match(r2.json.grund, /inzwischen geändert — neue Vorschau holen/);
    assert.equal(A.db.get('Contact', k.id).rolle, 'von Hand', 'not overwritten');
    // without stand there is no blind write
    const r3 = await M.werkzeug('update_record', { entity: 'Contact', id: k.id, data: { rolle: 'd' }, ausfuehren: true });
    assert.equal(r3.isError, true);
    assert.match(r3.text, /stand fehlt/);
  });
});

describe('111-02 — duplicates and idempotency (K-11)', () => {
  it('same name in the same project (case, umlaut, double spaces) is "nicht übernommen"; doppelt_erlaubt creates; other projects do not count', async () => {
    const erster = A.db.create('Contact', { name: 'Büro Müller', project_id: projekt.id });
    for (const name of ['büro müller', 'BUERO   MUELLER', ' Büro-Müller ']) {
      const r = await M.werkzeug('create_record', { entity: 'Contact', data: { name, project_id: projekt.id }, ausfuehren: true });
      assert.equal(r.isError, false, 'a normal result, no error');
      assert.equal(r.json.uebernommen, false, name);
      assert.equal(r.json.grund, `nicht übernommen: mögliche Dublette von ${erster.id}`);
      assert.equal(r.json.naechster_schritt.argumente.doppelt_erlaubt, true);
    }
    const vorschau = await M.werkzeug('create_record', { entity: 'Contact', data: { name: 'büro müller', project_id: projekt.id } });
    assert.ok(vorschau.json.probleme.some((p) => p.art === 'dublette' && p.ids.includes(erster.id)));
    assert.equal(A.db.filter('Contact', { name: 'büro müller' }).length, 0);
    const anderes = await M.werkzeug('create_record', { entity: 'Contact', data: { name: 'Büro Müller', project_id: 'tp-b' }, ausfuehren: true });
    assert.equal(anderes.json.uebernommen, true, 'another project is no duplicate');
    const doch = await M.werkzeug('create_record', { entity: 'Contact', data: { name: 'büro müller', project_id: projekt.id }, ausfuehren: true, doppelt_erlaubt: true });
    assert.equal(doch.json.uebernommen, true);
    assert.equal(A.db.filter('Contact', { project_id: projekt.id }).filter((c) => /m(ü|ue)ller/i.test(c.name)).length, 2);
  });

  it('the same idempotenz_schluessel twice: one record, the second call returns the first', async () => {
    const args = { entity: 'Notiz', data: { text: 'Besprechung verschoben', project_id: projekt.id }, ausfuehren: true, idempotenz_schluessel: 'chat-42:notiz' };
    const [a, b] = await Promise.all([M.werkzeug('create_record', args), M.werkzeug('create_record', args)]);
    const c = await M.werkzeug('create_record', args);
    const status = [a, b, c].map((r) => r.json.status).sort();
    assert.deepEqual(status, ['angelegt', 'schon angelegt', 'schon angelegt']);
    assert.equal(new Set([a, b, c].map((r) => r.json.datensatz.id)).size, 1);
    const alle = A.db.filter('Notiz', { ki_vorgang: 'chat-42:notiz' });
    assert.equal(alle.length, 1);
    assert.equal((await M.werkzeug('create_record', { ...args, idempotenz_schluessel: 'kein schlüssel!' })).isError, true, 'key form checked');
  });

  it('review 111-02: the key "undefined" never matches records without a key; a key counts per project', async () => {
    // records without ki_vorgang exist (earlier tests); before the fix the server filter String(undefined) === "undefined" matched them
    const vorher = A.db.list('Notiz').length;
    const r = await M.werkzeug('create_record', { entity: 'Notiz', data: { text: 'Schlüssel undefined', project_id: projekt.id }, ausfuehren: true, idempotenz_schluessel: 'undefined' });
    assert.equal(r.json.status, 'angelegt', r.text);
    assert.equal(A.db.list('Notiz').length, vorher + 1);
    // same key in another project: a new record, not the one of project A
    const b = A.db.create('Project', { name: 'Testprojekt B', status: 'design' });
    const args = { entity: 'Notiz', ausfuehren: true, idempotenz_schluessel: 'chat-7:gleich' };
    const ra = await M.werkzeug('create_record', { ...args, data: { text: 'in A', project_id: projekt.id } });
    const rb = await M.werkzeug('create_record', { ...args, data: { text: 'in B', project_id: b.id } });
    assert.equal(rb.json.status, 'angelegt', rb.text);
    assert.notEqual(ra.json.datensatz.id, rb.json.datensatz.id);
    assert.equal(rb.json.datensatz.project_id, b.id);
  });
});

describe('111-02 — protected paths (S-12)', () => {
  it('locked entities in any spelling, person-only entities and the bin: refused in the preview, nothing sent', async () => {
    const vorher = A.anfragen.length;
    for (const entity of ['LlmConnection', 'llmconnection', 'KIEINSTELLUNG', 'mitarbeiter', 'Kostensatz', 'aenderungsschritt', 'Befehlsvorlage', 'papierkorb']) {
      for (const [name, args] of [['create_record', { entity, data: { x: 1 } }], ['update_record', { entity, id: 'a', data: { x: 1 } }], ['delete_record', { entity, id: 'a' }]]) {
        const r = await M.werkzeug(name, args);
        assert.equal(r.isError, true, `${name} ${entity}`);
        assert.match(r.text, /gesperrt|Handlungen der Person|Papierkorb ist nur lesbar/, `${name} ${entity}`);
      }
    }
    assert.equal(A.anfragen.length, vorher, `nothing reached the app: ${A.anfragen.slice(vorher).join(' | ')}`);
  });

  it('bild_freigabe and loosening nda: a problem in the preview, never sent; nda switched ON passes', async () => {
    const p = A.db.create('Project', { name: 'Testprojekt B', nda: true });
    const v = await M.werkzeug('update_record', { entity: 'Project', id: p.id, data: { nda: false, bild_freigabe: { am: '2026-01-01' }, status: 'design' } });
    assert.deepEqual(v.json.probleme.filter((x) => x.art === 'geschuetztes_feld').map((x) => x.feld).sort(), ['bild_freigabe', 'nda']);
    assert.deepEqual(v.json.naechster_schritt.argumente.data, { status: 'design' });
    const a = await M.werkzeug('update_record', { ...v.json.naechster_schritt.argumente, data: { nda: false, bild_freigabe: { am: '2026-01-01' }, status: 'design' } });
    assert.equal(a.json.uebernommen, true);
    assert.deepEqual(a.json.nicht_gesetzt.sort(), ['bild_freigabe', 'nda']);
    const gespeichert = A.db.get('Project', p.id);
    assert.equal(gespeichert.nda, true);
    assert.equal(gespeichert.bild_freigabe ?? null, null);
    const put = A.anfragen.filter((x) => x.startsWith(`PUT /entities/Project/${p.id}`));
    assert.equal(put.length, 1);
    const c = await M.werkzeug('create_record', { entity: 'Project', data: { name: 'Testprojekt C', nda: true }, ausfuehren: true });
    assert.equal(c.json.datensatz.nda, true, 'a program may make a project stricter');
  });

  it('the mirrored lists equal the app\'s (routes.js, entitaeten.js, papierkorbRouter.js)', () => {
    const liste = (name) => {
      const m = QUELLE.match(new RegExp(`const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]\\)`));
      assert.ok(m, `${name} found in tools/mcp-server.mjs`);
      return m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    };
    const gesperrt = liste('GESPERRTE_ENTITAETEN');
    assert.deepEqual([...gesperrt].sort(), ['LlmConnection', KI_EINSTELLUNG_ENTITY, ...PERSONAL_ENTITAETEN].sort());
    for (const e of gesperrt) assert.ok(gesperrteEntitaet(e), e);
    assert.equal(gesperrteEntitaet('Contact'), null);
    assert.deepEqual(liste('NUR_PERSON_ENTITAETEN'), [...NUR_PERSON_SCHREIBT]);
    const verworfen = [];
    projektFelderSchuetzen('Project', { bild_freigabe: {}, nda: false, name: 'x' }, false, verworfen);
    assert.deepEqual(liste('GESCHUETZTE_PROJEKTFELDER'), verworfen);
    assert.match(QUELLE, new RegExp(`const PAPIERKORB_ENTITY = '${PAPIERKORB_ENTITY}';`));
    assert.ok(!/from ['"][./]*packages\//.test(QUELLE), 'tools/mcp-server.mjs imports nothing from packages/');
  });

  it('no tool confirms: no name with "bestaetig" (D-IDEE-03)', async () => {
    const namen = (await M.rpc('tools/list')).result.tools.map((w) => w.name);
    assert.ok(namen.includes('delete_record') && namen.includes('papierkorb_lesen') && namen.includes('wiederherstellen'));
    assert.ok(!namen.some((n) => /bestaetig/i.test(n)), namen.join(', '));
  });
});

describe('111-02 — recycle bin over MCP (K-07)', () => {
  it('delete_record: preview, then into the bin; papierkorb_lesen; wiederherstellen with the same id; occupied id refused', async () => {
    const k = A.db.create('Contact', { name: 'Kontakt Muster', rolle: 'Bauphysik', project_id: projekt.id });
    const n0 = A.schreibend().length;
    const v = await M.werkzeug('delete_record', { entity: 'Contact', id: k.id, grund: 'doppelt angelegt' });
    assert.equal(v.json.vorschau, true);
    assert.deepEqual(v.json.vorher, k);
    assert.equal(v.json.nachher, null);
    assert.match(v.json.hinweis, /Papierkorb/);
    assert.equal(A.schreibend().length, n0, 'the preview wrote nothing');
    const d = await M.werkzeug('delete_record', v.json.naechster_schritt.argumente);
    assert.equal(d.json.status, 'im Papierkorb');
    assert.equal(A.db.get('Contact', k.id), null);
    const geschrieben = A.schreibend().slice(n0);
    assert.deepEqual(geschrieben.map((x) => x.split('?')[0]), [`POST /papierkorb/Contact/${k.id}`], 'never a DELETE');
    assert.match(geschrieben[0], /\?stand=/, 'the stand goes to the server as well (review 111-02)');

    const pk = await M.werkzeug('papierkorb_lesen', { entity: 'Contact', project_id: projekt.id });
    assert.equal(pk.json.anzahl, 1);
    const e = pk.json.datensaetze[0];
    assert.deepEqual([e.record_id, e.herkunft, e.grund], [k.id, 'mcp', 'doppelt angelegt']);

    const wv = await M.werkzeug('wiederherstellen', { id: e.id });
    assert.deepEqual(wv.json.nachher, k);
    assert.deepEqual(wv.json.probleme, []);
    const w = await M.werkzeug('wiederherstellen', wv.json.naechster_schritt.argumente);
    assert.equal(w.json.uebernommen, true);
    assert.deepEqual(A.db.get('Contact', k.id), k);
    assert.equal(A.db.list(PAPIERKORB_ENTITY).length, 0);

    // occupied id: the preview says so, ausfuehren is "nicht übernommen" with the reason
    const d2 = await M.werkzeug('delete_record', { entity: 'Contact', id: k.id, ausfuehren: true, stand: k.updated_date });
    A.db.create('Contact', { id: k.id, name: 'Belegt' });
    const wv2 = await M.werkzeug('wiederherstellen', { id: d2.json.papierkorb_id });
    assert.equal(wv2.json.naechster_schritt, null);
    assert.equal(wv2.json.probleme[0].art, 'id_belegt');
    const w2 = await M.werkzeug('wiederherstellen', { id: d2.json.papierkorb_id, ausfuehren: true });
    assert.equal(w2.isError, false);
    assert.equal(w2.json.uebernommen, false);
    assert.match(w2.json.grund, /^nicht übernommen: die id .* wieder belegt/);
    assert.equal(A.db.get('Contact', k.id).name, 'Belegt');
  });

  it('a project is never deleted by an agent; delete without stand is refused', async () => {
    const r = await M.werkzeug('delete_record', { entity: 'Project', id: projekt.id, ausfuehren: true });
    assert.equal(r.isError, true);
    assert.match(r.text, /Projekte löscht oder archiviert nur die Person/);
    const k = A.db.create('Notiz', { text: 'x' });
    const ohne = await M.werkzeug('delete_record', { entity: 'Notiz', id: k.id, ausfuehren: true });
    assert.equal(ohne.isError, true);
    assert.match(ohne.text, /stand fehlt/);
    assert.ok(A.db.get('Notiz', k.id));
  });
});
