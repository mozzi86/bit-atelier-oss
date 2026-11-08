// mcp-aufrufprotokoll-11101.test.js — the call log of the MCP server (plan 111-01, K-03): tools/mcp-aufrufprotokoll.mjs
// as a module, plus the server as a real child process against a fake API. Covers:
//  - redaction (sk-…, Bearer, *_TOKEN=, x-api-key, the control token in raw and header form, secret-looking keys, known values),
//  - the redaction patterns are the SAME texts as in harness/harness/jsonlog.py (text comparison of the regex sources),
//  - shortening per argument (2,000 characters), rotation at a small size limit, clean-up of old files with an injected date,
//  - a log that cannot be written (the log folder is a file) leaves the tool answer unchanged and says so ONCE on stderr.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AufrufProtokoll, HARNESS_MUSTER, MAX_ARGUMENT_ZEICHEN, NEU_VERSUCH_MS, PROTOKOLL_UNTERORDNER, ZUSATZ_MUSTER,
  alsRegExp, aufraeumen, kuerzen, protokollLesen, schwaerzen, tagText, zeileAnhaengen,
} from '../../tools/mcp-aufrufprotokoll.mjs';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKRIPT = path.join(WURZEL, 'tools', 'mcp-server.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-11101-log-'));
let zaehler = 0;
/** A fresh empty folder below TMP. */
const neuerOrdner = () => { const o = path.join(TMP, `o${zaehler += 1}`); fs.mkdirSync(o, { recursive: true }); return o; };

/** A control token of the app's form: 24 random bytes as lowercase hex (server/steuerungRouter.js). */
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678abcdef01';

describe('111-01 — redaction', () => {
  it('hides keys, bearer tokens, NAME_TOKEN=, x-api-key and the control token, also in nested values', () => {
    const roh = {
      text: 'Schlüssel sk-abcdefgh12345678 und Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc und OPENAI_API_KEY=geheim1 BIT_STEUERUNG_TOKEN=xyz',
      kopf: 'x-api-key: 1234567890 x-bit-steuerung: zz-token-zz',
      liste: [`token im Text ${TOKEN} Ende`],
      tief: { api_key: 'wert-a', passwort: 'wert-b', name: 'Testprojekt A', leer: '' },
    };
    const s = /** @type {any} */ (schwaerzen(roh));
    assert.match(s.text, /sk-\*\*\*/);
    assert.match(s.text, /Bearer \*\*\*/);
    assert.match(s.text, /OPENAI_API_KEY=\*\*\*/);
    assert.match(s.text, /BIT_STEUERUNG_TOKEN=\*\*\*/);
    assert.match(s.kopf, /x-api-key: \*\*\*/);
    assert.match(s.kopf, /x-bit-steuerung: \*\*\*/);
    assert.equal(s.liste[0], 'token im Text *** Ende');
    assert.deepEqual(s.tief, { api_key: '***', passwort: '***', name: 'Testprojekt A', leer: '' });
    for (const geheim of ['abcdefgh12345678', 'eyJhbGciOiJIUzI1NiJ9', 'geheim1', 'xyz', '1234567890', 'zz-token-zz', TOKEN, 'wert-a', 'wert-b']) {
      assert.ok(!JSON.stringify(s).includes(geheim), geheim);
    }
  });

  it('a known secret value is hidden whatever form it has; short or empty values are ignored', () => {
    assert.equal(schwaerzen('vorher GEHEIM-WERT-42 nachher', ['GEHEIM-WERT-42', '', 'kurz']), 'vorher *** nachher');
    assert.equal(schwaerzen(5), 5);
    assert.equal(schwaerzen(null), null);
  });

  it('the harness patterns are the same texts as in harness/harness/jsonlog.py', () => {
    const py = fs.readFileSync(path.join(WURZEL, 'harness', 'harness', 'jsonlog.py'), 'utf8');
    const block = py.slice(py.indexOf('REDACTIONS'), py.indexOf('def redact('));
    const muster = [...block.matchAll(/\(re\.compile\(r"(.*?)"\),\s*r?"(.*?)"\)/g)].map((m) => [m[1], m[2]]);
    assert.equal(muster.length, 4, 'four patterns found in jsonlog.py');
    assert.deepEqual(muster, HARNESS_MUSTER.map((x) => [...x]));
    // the extra patterns are only additions, never a replacement of a harness pattern
    assert.ok(ZUSATZ_MUSTER.every(([q]) => !muster.some(([p]) => p === q)));
  });

  it('the Python sources work as JavaScript RegExps (inline (?i) becomes the i flag)', () => {
    assert.equal(alsRegExp('(?i)abc').flags, 'gi');
    assert.equal(alsRegExp('abc').flags, 'g');
    assert.equal(schwaerzen('bearer abcdefghij'), 'Bearer ***');
    assert.equal(schwaerzen('my_password = hunter2'), 'my_password=***');
  });
});

describe('111-01 — shortening, rotation, clean-up', () => {
  it('cuts each argument to 2,000 characters with a note; short values and numbers stay', () => {
    const lang = 'x'.repeat(2500);
    const k = kuerzen({ text: lang, data: { feld: 'y'.repeat(3000) }, zahl: 3, kurz: 'ok', klein: { a: 1 } });
    assert.equal(MAX_ARGUMENT_ZEICHEN, 2000);
    assert.ok(String(k.text).startsWith('x'.repeat(2000)));
    assert.match(String(k.text), /gekürzt: 2500 Zeichen/);
    assert.equal(typeof k.data, 'string');
    assert.match(String(k.data), /gekürzt: \d+ Zeichen JSON/);
    assert.deepEqual([k.zahl, k.kurz, k.klein], [3, 'ok', { a: 1 }]);
    assert.deepEqual(kuerzen(null), {});
    assert.deepEqual(kuerzen([1, 2]), {});
  });

  it('rotates at the size limit (-1, -2 …) and reads all entries back in order, newest last', () => {
    const ordner = neuerOrdner();
    const jetzt = new Date(2026, 10, 8, 12, 0, 0);
    for (let i = 0; i < 12; i += 1) zeileAnhaengen(ordner, { nr: i, werkzeug: i % 2 ? 'get_record' : 'list_projects', ergebnis: 'ok' }, { jetzt, maxBytes: 200 });
    const namen = fs.readdirSync(ordner).sort();
    assert.ok(namen.includes('mcp-2026-11-08.jsonl'));
    assert.ok(namen.includes('mcp-2026-11-08-1.jsonl') && namen.includes('mcp-2026-11-08-2.jsonl'), namen.join(', '));
    for (const n of namen) assert.ok(fs.statSync(path.join(ordner, n)).size <= 200, n);
    assert.deepEqual(protokollLesen(ordner, { anzahl: 100 }).map((e) => e.nr), [...Array(12).keys()]);
    assert.deepEqual(protokollLesen(ordner, { anzahl: 3 }).map((e) => e.nr), [9, 10, 11]);
    assert.deepEqual(protokollLesen(ordner, { anzahl: 100, werkzeug: 'get_record' }).map((e) => e.nr), [1, 3, 5, 7, 9, 11]);
  });

  it('removes files older than 30 days (date injected), keeps the rest and foreign files', () => {
    const ordner = neuerOrdner();
    const jetzt = new Date(2026, 10, 8, 9, 0, 0);
    const tag = (vor) => tagText(new Date(2026, 10, 8 - vor));
    const namen = [`mcp-${tag(40)}.jsonl`, `mcp-${tag(31)}-1.jsonl`, `mcp-${tag(30)}.jsonl`, `mcp-${tag(1)}.jsonl`, 'notiz.txt', 'mcp-kaputt.jsonl'];
    for (const n of namen) fs.writeFileSync(path.join(ordner, n), '{}\n');
    const weg = aufraeumen(ordner, { tage: 30, jetzt });
    assert.deepEqual(weg.sort(), [`mcp-${tag(31)}-1.jsonl`, `mcp-${tag(40)}.jsonl`].sort());
    assert.deepEqual(fs.readdirSync(ordner).sort(), [`mcp-${tag(30)}.jsonl`, `mcp-${tag(1)}.jsonl`, 'notiz.txt', 'mcp-kaputt.jsonl'].sort());
  });
});

describe('111-01 — the log never disturbs a call', () => {
  it('a log folder that cannot be written: schreiben() answers false, never throws, and reports once', async () => {
    const daten = neuerOrdner();
    fs.writeFileSync(path.join(daten, PROTOKOLL_UNTERORDNER), 'ich bin eine Datei, kein Ordner');
    const meldungen = [];
    const p = new AufrufProtokoll({ ordnerFinden: async () => daten, melden: (t) => meldungen.push(t) });
    assert.equal(await p.schreiben({ werkzeug: 'a', argumente: {} }), false);
    assert.equal(await p.schreiben({ werkzeug: 'b', argumente: {} }), false);
    assert.equal(meldungen.filter((m) => /could not be written/.test(m)).length, 1, meldungen.join(' | '));
  });

  it('no data folder, a relative one, or a failing finder: no log, one line each, never a throw', async () => {
    for (const ordnerFinden of [async () => null, async () => '.', async () => { throw new Error('weg'); }]) {
      const meldungen = [];
      const p = new AufrufProtokoll({ ordnerFinden, melden: (t) => meldungen.push(t) });
      assert.equal(await p.schreiben({ werkzeug: 'a' }), false);
      assert.equal(await p.schreiben({ werkzeug: 'a' }), false);
      assert.ok(meldungen.length >= 1 && meldungen.length <= 2, meldungen.join(' | '));
      assert.equal(new Set(meldungen).size, meldungen.length, 'no line twice');
    }
  });

  it('the control token from the data folder is hidden in arguments, reason and message', async () => {
    const daten = neuerOrdner();
    fs.writeFileSync(path.join(daten, 'steuerung.token'), 'Kein-Hex-Aber-Geheim-123\n');
    const p = new AufrufProtokoll({ ordnerFinden: async () => daten, melden: () => {} });
    assert.equal(await p.schreiben({ werkzeug: 'create_record', argumente: { data: { text: 'Kein-Hex-Aber-Geheim-123' } },
      begruendung: { grund: 'Kein-Hex-Aber-Geheim-123' }, meldung: 'Fehler Kein-Hex-Aber-Geheim-123' }), true);
    const text = fs.readFileSync(path.join(daten, PROTOKOLL_UNTERORDNER, fs.readdirSync(path.join(daten, PROTOKOLL_UNTERORDNER))[0]), 'utf8');
    assert.ok(!text.includes('Kein-Hex-Aber-Geheim-123'), text);
    assert.equal(text.split('***').length - 1, 3);
  });
});

// --- the server as a child process ----------------------------------------------------------------------

/** Fake API: projects, the person, the data folder (of the app, not used when BIT_DATA_DIR is set). */
function fakeApi() {
  const server = http.createServer((req, res) => {
    const json = (status, wert) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(wert)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/entities/Project') return json(200, [{ id: 'tp-a', name: 'Testprojekt A', updated_date: '2026-11-08' }]);
    if (url.pathname === '/api/auth/me') return json(200, { id: 'u1', full_name: 'Testperson' });
    return json(404, { error: 'Not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/api` })));
}

/**
 * Runs a few calls against a fresh server and returns the answers plus stderr.
 * @param {string} apiUrl @param {string} daten BIT_DATA_DIR
 */
async function lauf(apiUrl, daten) {
  const kind = spawn(process.execPath, [SKRIPT], { env: { ...process.env, BIT_API_URL: apiUrl, BIT_DATA_DIR: daten }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  kind.stderr.setEncoding('utf8');
  kind.stderr.on('data', (s) => { stderr += s; });
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
  const antworten = [];
  antworten.push((await rpc('tools/call', { name: 'list_projects', arguments: { limit: 5 } })).result);
  antworten.push((await rpc('tools/call', { name: 'create_record', arguments: { entity: 'Notiz', data: {} } })).result);
  antworten.push((await rpc('tools/call', { name: 'gibts_nicht', arguments: {} })).error);
  await new Promise((r) => { kind.on('exit', r); kind.stdin.end(); });
  return { antworten, stderr };
}

describe('111-01 — server: a log error changes no answer', () => {
  it('log folder blocked: the same answers as with a working log, and one stderr line for three calls', async () => {
    const api = await fakeApi();
    try {
      const gut = neuerOrdner();
      const gesperrt = neuerOrdner();
      fs.writeFileSync(path.join(gesperrt, PROTOKOLL_UNTERORDNER), 'Datei statt Ordner');
      const a = await lauf(api.url, gut);
      const b = await lauf(api.url, gesperrt);
      assert.deepEqual(b.antworten, a.antworten);
      assert.equal(a.antworten[0].isError, undefined);
      assert.equal(JSON.parse(a.antworten[0].content[0].text).datensaetze[0].name, 'Testprojekt A');
      assert.equal((b.stderr.match(/call log could not be written/g) || []).length, 1, b.stderr);
      assert.ok(!/call log could not be written/.test(a.stderr), a.stderr);
      const zeilen = fs.readFileSync(path.join(gut, PROTOKOLL_UNTERORDNER, fs.readdirSync(path.join(gut, PROTOKOLL_UNTERORDNER))[0]), 'utf8').trim().split('\n');
      assert.deepEqual(zeilen.map((z) => JSON.parse(z).ergebnis), ['ok', 'abgelehnt', 'unbekannt']);
    } finally {
      api.server.close();
    }
  });
});

describe('111-01 — review fixes', () => {
  it('hides Authorization: Basic, "password: x", apikey= and user:password@host; plain text stays', () => {
    assert.equal(schwaerzen('Authorization: Basic dXNlcjpwYXNz'), 'Authorization: ***');
    assert.equal(schwaerzen('password: geheim123'), 'password: ***');
    assert.equal(schwaerzen('Kennwort=abc12345'), 'Kennwort=***');
    assert.equal(schwaerzen('apikey=abcdef12345'), 'apikey=***');
    assert.equal(schwaerzen('https://max:pw123@host/x'), 'https://max:***@host/x');
    assert.equal(schwaerzen('Wand 2,5 m hoch, Testprojekt A'), 'Wand 2,5 m hoch, Testprojekt A');
  });

  it('bereinigen redacts with the known secrets, so a reason can be cut after redaction', () => {
    const p = new AufrufProtokoll({ ordnerFinden: async () => null, melden: () => {}, geheimnisse: ['geheim-wert-1'] });
    assert.deepEqual(p.bereinigen({ grund: 'mit sk-abcdefgh12345678 und geheim-wert-1' }), { grund: 'mit sk-*** und ***' });
  });

  it('a failed folder lookup is not repeated within NEU_VERSUCH_MS, but after it', async () => {
    let jetzt = new Date('2026-11-08T10:00:00Z');
    let fragen = 0;
    const p = new AufrufProtokoll({ ordnerFinden: async () => { fragen += 1; return null; }, melden: () => {}, jetzt: () => jetzt });
    assert.equal(await p.ordner(), null);
    assert.equal(await p.ordner(), null);
    assert.equal(fragen, 1);
    jetzt = new Date(jetzt.getTime() + NEU_VERSUCH_MS + 1);
    await p.ordner();
    assert.equal(fragen, 2);
  });
});

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder, leave it */ } });
