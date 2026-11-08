// mcp-konvention-11101.test.js — plan 111-01 (K-02, K-03, K-04, K-06, K-18) in tools/mcp-server.mjs, as a real child process
// against a FAKE BIT-Atelier API (pattern of mcp-server-10604.test.js, own copy). Covers:
//  - the convention: every tool has a kind (`art`), `sofort` only in SOFORT_AUSNAHMEN, the transition list of 111-02 by name,
//    and konventionPruefen() turns red for a write tool without kind, an unlisted `sofort`, a preview without switch …,
//  - initialize answers `instructions` (German): the rule that an agent never confirms, write permission, the working project;
//    with the app off or hanging it still answers in under 2 s with "App nicht erreichbar — bit_status prüft das",
//  - EVERY tool call leaves exactly one log line (an unknown name and a write tool without --schreiben too), with client,
//    person, result kind and duration; BIT_DATA_DIR wins over the app's data folder,
//  - begruendung: in the schema of every write tool (and only there), never sent to the app, written to the log,
//  - aufrufprotokoll_lesen only with --protokoll-lesen.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARTEN, SOFORT_AUSNAHMEN, UEBERGANG_111_02, konventionPruefen, begruendungAus } from '../../tools/mcp-konvention.mjs';
import { PROTOKOLL_UNTERORDNER } from '../../tools/mcp-aufrufprotokoll.mjs';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKRIPT = path.join(WURZEL, 'tools', 'mcp-server.mjs');
const DOKU = fs.readFileSync(path.join(WURZEL, 'docs', 'KI-ANBINDUNG.md'), 'utf8').replace(/\r\n/g, '\n');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-11101-'));
let zaehler = 0;
const neuerOrdner = () => { const o = path.join(TMP, `d${zaehler += 1}`); fs.mkdirSync(o, { recursive: true }); return o; };
/** Data folder the APP reports; the log must not land here while BIT_DATA_DIR is set. */
const APP_DATEN = neuerOrdner();
/** Control token in the app's form (48 hex characters). */
const TOKEN = '00112233445566778899aabbccddeeff0011223344556677';

/** Fake API: neutral test data only; records every request with its body. */
function fakeApi() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      anfragen.push({ methode: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
      const json = (status, wert) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(wert)); };
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/api/system/datenordner') return json(200, { ordner: APP_DATEN });
      if (p === '/api/auth/me') return json(200, { id: 'u1', full_name: 'Testperson' });
      if (p === '/api/status') return json(200, { name: 'bit-atelier', version: '9.9.9', modus: 'app' });
      if (p === '/api/entities') return json(200, { entitaeten: [{ name: 'Project', anzahl: 2 }] });
      if (p === '/api/entities/Project') return json(200, [{ id: 'tp-a', name: 'Testprojekt A', updated_date: '2026-11-08' }, { id: 'tp-b', name: 'Testprojekt B', updated_date: '2026-11-01' }]);
      if (p === '/api/steuerung') {
        if (req.headers['x-bit-steuerung'] !== TOKEN) return json(401, { ok: false });
        const a = JSON.parse(body);
        return json(200, { id: a.id, ok: true, result: { befehl: a.params?.befehl ?? a.method } });
      }
      // 111-02: the recycle bin (list and one entry) for papierkorb_lesen and the preview of wiederherstellen
      // (since the review of 111-02 wiederherstellen reads the entry from the list, never through the generic CRUD)
      if (p === '/api/papierkorb') return json(200, [{ id: 'pk1', entity: 'Notiz', record_id: 'n9', datensatz: { id: 'n9', text: 'x' } }]);
      const m = /^\/api\/entities\/([A-Za-z]+)(?:\/([^/]+))?$/.exec(p);
      if (m && req.method === 'GET') return json(200, m[2] ? { id: m[2] } : []);
      if (m && (req.method === 'POST' || req.method === 'PUT')) return json(200, { id: m[2] || 'n1', ...JSON.parse(body) });
      return json(404, { error: 'Not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, anfragen, url: `http://127.0.0.1:${server.address().port}/api` })));
}

/**
 * Starts the MCP server; `rpc` returns the whole JSON-RPC response.
 * @param {string} apiUrl @param {string[]} flags @param {Record<string, string>} [env]
 */
function starteMcp(apiUrl, flags = [], env = {}) {
  const kind = spawn(process.execPath, [SKRIPT, ...flags], {
    env: { ...process.env, BIT_API_URL: apiUrl, BIT_STEUERUNG_TOKEN: TOKEN, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });
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
  return {
    get stderr() { return stderr; },
    rpc(method, params) { const id = n++; const p = new Promise((r) => warter.set(id, r)); kind.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); return p; },
    async liste() { return (await this.rpc('tools/list')).result.tools; },
    ende() { return new Promise((r) => { kind.on('exit', r); kind.stdin.end(); }); },
  };
}

/** All log lines of a data folder, oldest first. @param {string} daten */
function logZeilen(daten) {
  const ordner = path.join(daten, PROTOKOLL_UNTERORDNER);
  if (!fs.existsSync(ordner)) return [];
  return fs.readdirSync(ordner).sort().flatMap((n) => fs.readFileSync(path.join(ordner, n), 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)));
}

/** tools/list → the form konventionPruefen reads (kind and write flag from _meta). */
const alsKurz = (liste) => liste.map((w) => ({ ...w, art: w._meta?.['bit-atelier/art'], schreibt: w._meta?.['bit-atelier/schreibt'] }));

/** Example calls of the doc ({name, args}), the same block mcp-server-10604.test.js reads. */
function dokuBeispiele() {
  const von = DOKU.indexOf('**Beispielaufrufe**');
  const block = DOKU.slice(von).match(/```text\n([\s\S]*?)```/);
  return block[1].split('\n').filter(Boolean).map((z) => { const i = z.indexOf(' '); return { name: z.slice(0, i), args: JSON.parse(z.slice(i + 1)) }; });
}

describe('111-01 — one convention (K-06, K-18)', () => {
  it('every tool has a kind; sofort only for the exceptions; the transition list of 111-02 by name; no violation', async () => {
    const api = await fakeApi();
    const mcp = starteMcp(api.url, ['--schreiben', '--protokoll-lesen'], { BIT_DATA_DIR: neuerOrdner() });
    try {
      const liste = alsKurz(await mcp.liste());
      for (const w of liste) assert.ok(ARTEN.includes(w.art), `${w.name}: ${w.art}`);
      assert.deepEqual(konventionPruefen(liste, { mitBegruendung: true }), []);
      assert.deepEqual(liste.filter((w) => w.art === 'sofort').map((w) => w.name), ['zeichenflaeche_ausfuehren']);
      assert.ok(SOFORT_AUSNAHMEN.zeichenflaeche_ausfuehren.includes('Massing-Studio'), 'the exception names its reason');
      // 111-02 gave create_record and update_record the switch and emptied the transition list
      assert.deepEqual([...UEBERGANG_111_02], [], '111-02 empties this list');
      assert.deepEqual(liste.filter((w) => w.art === 'vorschau-dann-ausfuehren').map((w) => w.name), ['create_record', 'update_record', 'delete_record', 'wiederherstellen']);
      assert.deepEqual(liste.filter((w) => w.art === 'vorschlag').map((w) => w.name), ['eigenschaft_setzen', 'transformieren', 'teilen', 'vorschlag_verwerfen']);
      assert.ok(!liste.some((w) => /bestaetig/.test(w.name)), 'no tool confirms (D-IDEE-03)');
      assert.ok(!/convention violated/.test(mcp.stderr), mcp.stderr);
    } finally { await mcp.ende(); api.server.close(); }
  });

  it('the check turns red: write tool without kind, unlisted sofort, preview without switch, read kind on a write tool, destructive proposal, missing begruendung', () => {
    const lesen = { name: 'a_lesen', art: 'lesen', schreibt: false, inputSchema: { properties: {} } };
    const faelle = [
      [{ name: 'neu_schreiben', schreibt: true, inputSchema: { properties: { begruendung: {} } } }, /art fehlt/],
      [{ name: 'neu_sofort', art: 'sofort', schreibt: true, inputSchema: { properties: { begruendung: {} } } }, /SOFORT_AUSNAHMEN/],
      [{ name: 'neu_vorschau', art: 'vorschau-dann-ausfuehren', schreibt: true, inputSchema: { properties: { begruendung: {} } } }, /ausfuehren/],
      [{ name: 'neu_falsch', art: 'lesen', schreibt: true, inputSchema: { properties: { begruendung: {} } } }, /schreibt, aber art "lesen"/],
      [{ name: 'neu_vorschlag', art: 'vorschlag', schreibt: true, annotations: { destructiveHint: true }, inputSchema: { properties: { begruendung: {} } } }, /destructiveHint/],
      [{ name: 'neu_ohne', art: 'vorschlag', schreibt: true, annotations: { destructiveHint: false }, inputSchema: { properties: {} } }, /begruendung/],
      [{ name: 'neu_lesend', art: 'vorschlag', schreibt: false, annotations: { destructiveHint: false }, inputSchema: { properties: {} } }, /ohne Schreibrecht/],
    ];
    for (const [w, muster] of faelle) {
      const fehler = konventionPruefen([lesen, w], { mitBegruendung: true });
      assert.ok(fehler.some((f) => muster.test(f)), `${w.name}: ${fehler.join(' | ')}`);
    }
    // a preview tool WITH the switch is fine, and a stale exception is named
    assert.deepEqual(konventionPruefen([{ name: 'v', art: 'vorschau-dann-ausfuehren', schreibt: true, inputSchema: { properties: { ausfuehren: { type: 'boolean' }, begruendung: {} } } }], { mitBegruendung: true }), []);
    assert.ok(konventionPruefen([{ name: 'zeichenflaeche_ausfuehren', art: 'vorschlag', schreibt: true, annotations: { destructiveHint: false } }]).some((f) => /Eintrag entfernen/.test(f)));
  });
});

describe('111-01 — working context in initialize (K-02)', () => {
  it('instructions in German: language, read-preview-run, an agent never confirms, write permission, working project', async () => {
    const api = await fakeApi();
    for (const [flags, schreiben] of [[[], /Schreibrecht: aus/], [['--schreiben'], /Schreibrecht: an/]]) {
      const mcp = starteMcp(api.url, flags, { BIT_DATA_DIR: neuerOrdner() });
      try {
        const r = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } });
        const t = r.result.instructions;
        assert.equal(typeof t, 'string');
        assert.match(t, /Deutsch/);
        assert.match(t, /erst lesen, dann Vorschau, dann ausführen/);
        assert.match(t, /Ein Agent bestätigt nie selbst/);
        assert.match(t, schreiben);
        assert.match(t, /„Testprojekt A“ \(id tp-a\)/);
        assert.match(t, /Annahme: das zuletzt geänderte Projekt/);
        assert.doesNotMatch(t, /Noch ohne Vorschau/, '111-02: no tool writes without preview any more');
        assert.match(t, /geschrieben wird erst mit ausfuehren: true/);
        assert.deepEqual(r.result.serverInfo.name, 'bit-atelier');
      } finally { await mcp.ende(); }
    }
    assert.ok(api.anfragen.some((a) => a.url === '/api/entities/Project?sort=-updated_date'));
    api.server.close();
  });

  it('app off or hanging: initialize still answers in under 2 s, with a hint instead of a project', async () => {
    const frei = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const offen = new Set();
    const haengt = http.createServer((req) => { offen.add(req); }); // never answers
    await new Promise((r) => haengt.listen(0, '127.0.0.1', r));
    try {
      for (const url of [`http://127.0.0.1:${frei}/api`, `http://127.0.0.1:${haengt.address().port}/api`]) {
        const mcp = starteMcp(url, [], { BIT_DATA_DIR: neuerOrdner() });
        try {
          await mcp.rpc('ping'); // the server is up: the start of Node does not count against initialize
          const start = Date.now();
          const r = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
          const dauer = Date.now() - start;
          assert.ok(dauer < 2000, `${url}: ${dauer} ms`);
          assert.match(r.result.instructions, /App nicht erreichbar — bit_status prüft das/);
          assert.match(r.result.instructions, /Ein Agent bestätigt nie selbst/);
        } finally { await mcp.ende(); }
      }
    } finally {
      for (const req of offen) req.socket.destroy();
      haengt.close();
    }
  });
});

describe('111-01 — every call leaves exactly one log line (K-03)', () => {
  it('each visible tool once, then an unknown name: one line per call, in order, with client, person, kind, duration', async () => {
    const api = await fakeApi();
    const daten = neuerOrdner();
    const mcp = starteMcp(api.url, ['--schreiben', '--protokoll-lesen'], { BIT_DATA_DIR: daten });
    try {
      await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } });
      const namen = (await mcp.liste()).map((w) => w.name);
      const beispiele = new Map(dokuBeispiele().map((b) => [b.name, b.args]));
      const aufrufe = [];
      for (const name of namen) {
        const args = beispiele.get(name) ?? {};
        const r = await mcp.rpc('tools/call', { name, arguments: args });
        assert.ok(r.result, `${name}: ${JSON.stringify(r.error)}`);
        aufrufe.push(name);
        assert.equal(logZeilen(daten).length, aufrufe.length, `after ${name}: one new line`);
      }
      const r = await mcp.rpc('tools/call', { name: 'gibts_nicht', arguments: { x: 1 } });
      assert.equal(r.error?.code, -32602);
      aufrufe.push('gibts_nicht');
      const zeilen = logZeilen(daten);
      assert.deepEqual(zeilen.map((z) => z.werkzeug), aufrufe);
      assert.ok(namen.includes('aufrufprotokoll_lesen') && namen.length >= 21, namen.join(', '));
      for (const z of zeilen) {
        assert.equal(z.client, 'test-client 1.0');
        assert.equal(z.person, 'Testperson');
        assert.ok(Number.isInteger(z.dauer_ms) && z.dauer_ms >= 0, JSON.stringify(z));
        assert.ok(!Number.isNaN(Date.parse(z.zeit)));
        assert.equal(typeof z.argumente, 'object');
      }
      assert.equal(zeilen.at(-1).ergebnis, 'unbekannt');
      assert.ok(zeilen.slice(0, -1).every((z) => z.ergebnis === 'ok'), JSON.stringify(zeilen.filter((z) => z.ergebnis !== 'ok')));
      assert.ok(!fs.existsSync(path.join(APP_DATEN, PROTOKOLL_UNTERORDNER)), 'BIT_DATA_DIR wins over the app folder');
    } finally { await mcp.ende(); api.server.close(); }
  });

  it('without --schreiben: a write tool is refused with one line "abgelehnt"; refusals by rule as well; the app sees nothing', async () => {
    const api = await fakeApi();
    const daten = neuerOrdner();
    const mcp = starteMcp(api.url, [], { BIT_DATA_DIR: daten });
    try {
      const r = await mcp.rpc('tools/call', { name: 'create_record', arguments: { entity: 'Notiz', data: { text: 'x' } } });
      assert.equal(r.result.isError, true);
      const lesen = await mcp.rpc('tools/call', { name: 'aufrufprotokoll_lesen', arguments: {} });
      assert.match(lesen.result.content[0].text, /--protokoll-lesen/);
      assert.ok(!(await mcp.liste()).some((w) => w.name === 'aufrufprotokoll_lesen'), 'not listed without the flag');
      const z = logZeilen(daten);
      assert.deepEqual(z.map((x) => [x.werkzeug, x.ergebnis]), [['create_record', 'abgelehnt'], ['aufrufprotokoll_lesen', 'abgelehnt']]);
      assert.match(z[0].meldung, /Schreibrecht fehlt/);
      assert.equal(api.anfragen.filter((a) => a.methode !== 'GET').length, 0);
    } finally { await mcp.ende(); api.server.close(); }

    const api2 = await fakeApi();
    const daten2 = neuerOrdner();
    const mcp2 = starteMcp(api2.url, ['--schreiben'], { BIT_DATA_DIR: daten2 });
    try {
      await mcp2.rpc('tools/call', { name: 'zeichenflaeche_ausfuehren', arguments: { befehl: 'bestaetigen' } });
      await mcp2.rpc('tools/call', { name: 'create_record', arguments: { entity: 'AenderungsSchritt', data: {} } });
      await mcp2.rpc('tools/call', { name: 'get_record', arguments: { entity: 'Project', id: '../x' } });
      assert.deepEqual(logZeilen(daten2).map((x) => x.ergebnis), ['abgelehnt', 'abgelehnt', 'fehler']);
      assert.equal(api2.anfragen.filter((a) => a.url === '/api/steuerung').length, 0, 'no confirmation reached the app');
    } finally { await mcp2.ende(); api2.server.close(); }
  });
});

describe('111-01 — begruendung (K-04)', () => {
  it('in the schema of every write tool and only there; taken out before the app; written to the log, redacted', async () => {
    const api = await fakeApi();
    const daten = neuerOrdner();
    const mcp = starteMcp(api.url, ['--schreiben'], { BIT_DATA_DIR: daten });
    try {
      for (const w of alsKurz(await mcp.liste())) {
        assert.equal('begruendung' in (w.inputSchema.properties || {}), w.schreibt === true, w.name);
      }
      const begruendung = { grund: 'Die Person bat im Chat darum', quelle: 'Chat', aussenwirkung: 'intern' };
      // 111-02: ausfuehren: true, otherwise create_record only answers the preview
      const r = await mcp.rpc('tools/call', { name: 'create_record', arguments: { entity: 'Notiz', data: { text: `Token ${TOKEN}` }, ausfuehren: true, begruendung } });
      assert.equal(r.result.isError, undefined);
      const post = api.anfragen.find((a) => a.methode === 'POST');
      assert.deepEqual(post.body, { text: `Token ${TOKEN}` }, 'the app gets the record, never the reason');
      await mcp.rpc('tools/call', { name: 'eigenschaft_setzen', arguments: { name: 'Feuerwiderstand', wert: 'F90', begruendung: { grund: 'Prüfbericht', aussenwirkung: 'extern' } } });
      const steuer = api.anfragen.find((a) => a.url === '/api/steuerung');
      assert.ok(!('begruendung' in steuer.body.params.params), 'not over the control channel either');
      const zeilen = logZeilen(daten);
      assert.deepEqual(zeilen[0].begruendung, begruendung);
      assert.equal(zeilen[1].begruendung.aussenwirkung, 'extern');
      assert.ok(!JSON.stringify(zeilen).includes(TOKEN), 'the control token never stands in the log');
      assert.ok(!('begruendung' in zeilen[0].argumente));
    } finally { await mcp.ende(); api.server.close(); }
  });

  it('a malformed reason never refuses a call: unknown fields and values are marked, texts cut', () => {
    assert.equal(begruendungAus(undefined), null);
    assert.deepEqual(begruendungAus({ grund: 'g', aussenwirkung: 'weltweit', extra: 1 }), { grund: 'g', ungueltig: true });
    assert.equal(begruendungAus({ grund: 'x'.repeat(900) }).grund.length, 500);
    assert.deepEqual(begruendungAus('nur Text'), { grund: 'nur Text', ungueltig: true });
  });
});

describe('111-01 — aufrufprotokoll_lesen (only with --protokoll-lesen)', () => {
  it('reads the last entries back, filtered by tool or kind; the doc names the tool and its flag', async () => {
    const api = await fakeApi();
    const daten = neuerOrdner();
    const mcp = starteMcp(api.url, ['--protokoll-lesen'], { BIT_DATA_DIR: daten });
    try {
      await mcp.rpc('tools/call', { name: 'list_projects', arguments: {} });
      await mcp.rpc('tools/call', { name: 'create_record', arguments: { entity: 'Notiz', data: {} } });
      await mcp.rpc('tools/call', { name: 'get_project', arguments: { id: 'tp-a' } });
      const alle = JSON.parse((await mcp.rpc('tools/call', { name: 'aufrufprotokoll_lesen', arguments: { anzahl: 10 } })).result.content[0].text);
      assert.deepEqual(alle.eintraege.map((e) => e.werkzeug), ['list_projects', 'create_record', 'get_project']);
      const abgelehnt = JSON.parse((await mcp.rpc('tools/call', { name: 'aufrufprotokoll_lesen', arguments: { ergebnis: 'abgelehnt' } })).result.content[0].text);
      assert.deepEqual(abgelehnt.eintraege.map((e) => e.werkzeug), ['create_record']);
      const zwei = JSON.parse((await mcp.rpc('tools/call', { name: 'aufrufprotokoll_lesen', arguments: { anzahl: 2, werkzeug: 'aufrufprotokoll_lesen' } })).result.content[0].text);
      assert.equal(zwei.anzahl, 2);
    } finally { await mcp.ende(); api.server.close(); }
    assert.match(DOKU, /\| `aufrufprotokoll_lesen` \(nur mit `--protokoll-lesen`\) \|/);
    assert.match(DOKU, /Arbeitskontext, Aufrufprotokoll, Begründung, Konvention/);
  });
});

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder, leave it */ } });
