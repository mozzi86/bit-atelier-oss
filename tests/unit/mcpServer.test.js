// mcpServer.test.js — tools/mcp-server.mjs (plan 83-03) as a real child process,
// speaking newline-delimited JSON-RPC 2.0 over stdio against a FAKE BIT-Atelier
// API (node:http on an ephemeral port). Covers: protocol version negotiation,
// notifications without answer, tools/list without/with write permission, the
// read tools, the refused write attempt, the API-down message, protocol errors
// and the 50,000-character limit.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKRIPT = path.join(WURZEL, 'tools', 'mcp-server.mjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8')).version;

const PROJEKTE = [
  { id: 'p1', name: 'Wohnhaus Nord', client: 'Bauherr A', status: 'design', location: { city: 'Musterstadt' }, updated_date: '2026-10-02', grosses_feld: 'x' },
  { id: 'p2', name: 'Schule Süd', client: 'Stadt', status: 'construction', updated_date: '2026-10-01' },
  { id: 'p3', name: 'Halle', status: 'feasibility', updated_date: '2026-09-01' },
];

/** Fake API: records every request; answers like server/index.js + routes.js. */
function fakeApi() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      anfragen.push({ methode: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
      const json = (status, wert) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(wert)); };
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/status') return json(200, { name: 'bit-atelier', version: '9.9.9', modus: 'app' });
      if (req.method === 'GET' && url.pathname === '/api/entities') return json(200, { entitaeten: [{ name: 'Project', anzahl: 3, katalog: false }], gesperrt: ['LlmConnection'] });
      if (url.pathname === '/api/entities/LlmConnection') return json(403, { error: 'LlmConnection nur über /api/llm/connections verwaltbar' });
      if (req.method === 'GET' && url.pathname === '/api/entities/Project') return json(200, PROJEKTE);
      if (req.method === 'GET' && url.pathname === '/api/entities/Project/p1') return json(200, PROJEKTE[0]);
      if (req.method === 'GET' && url.pathname === '/api/entities/ChangeOrder') {
        return json(200, [{ id: 'c1', status: 'approved' }, { id: 'c2', status: 'approved' }, { id: 'c3', status: 'approved' }]);
      }
      if (req.method === 'GET' && url.pathname === '/api/entities/Gross') {
        return json(200, Array.from({ length: 150 }, (_, i) => ({ id: `g${i}`, text: 'x'.repeat(1000) })));
      }
      if (req.method === 'POST' && url.pathname === '/api/entities/Notiz') return json(201, { id: 'n1', ...JSON.parse(body) });
      if (req.method === 'PUT' && url.pathname === '/api/entities/Notiz/n1') return json(200, { id: 'n1', ...JSON.parse(body) });
      return json(404, { error: 'Not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, anfragen, url: `http://127.0.0.1:${server.address().port}/api` })));
}

/**
 * Starts the MCP server as a child process.
 * @param {string} apiUrl BIT_API_URL
 * @param {string[]} [args] extra arguments (--schreiben / --write)
 */
function starteMcp(apiUrl, args = []) {
  const kind = spawn(process.execPath, [SKRIPT, ...args], { env: { ...process.env, BIT_API_URL: apiUrl }, stdio: ['pipe', 'pipe', 'pipe'] });
  const zeilen = [];
  const warter = new Map();
  let rest = '';
  kind.stdout.setEncoding('utf8');
  kind.stdout.on('data', (stueck) => {
    rest += stueck;
    let i;
    while ((i = rest.indexOf('\n')) >= 0) {
      const zeile = rest.slice(0, i);
      rest = rest.slice(i + 1);
      const nachricht = JSON.parse(zeile); // stdout must carry JSON only
      zeilen.push(nachricht);
      const w = warter.get(nachricht.id);
      if (w) { warter.delete(nachricht.id); w(nachricht); }
    }
  });
  let naechsteId = 1;
  return {
    zeilen,
    /** Sends a request and resolves with its response. */
    rpc(method, params) {
      const id = naechsteId++;
      const p = new Promise((resolve) => warter.set(id, resolve));
      kind.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return p;
    },
    /** Sends a raw line (notification, broken JSON …). */
    roh(zeile) { kind.stdin.write(`${zeile}\n`); },
    /** Calls a tool and returns { text, json, isError }. */
    async werkzeug(name, args = {}) {
      const r = await this.rpc('tools/call', { name, arguments: args });
      assert.ok(r.result, `tools/call ${name}: ${JSON.stringify(r.error)}`);
      const text = r.result.content[0].text;
      let json = null;
      try { json = JSON.parse(text); } catch { /* error texts are prose */ }
      return { text, json, isError: r.result.isError === true };
    },
    ende() {
      return new Promise((resolve) => { kind.on('exit', resolve); kind.stdin.end(); });
    },
  };
}

describe('MCP server — protocol', () => {
  let api, mcp;
  before(async () => { api = await fakeApi(); mcp = starteMcp(api.url); });
  after(async () => { await mcp.ende(); api.server.close(); });

  it('initialize: verlangte Version wird übernommen, unbekannte → 2025-06-18', async () => {
    for (const v of ['2025-06-18', '2025-03-26', '2024-11-05']) {
      const r = await mcp.rpc('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      assert.equal(r.result.protocolVersion, v);
    }
    const r = await mcp.rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    assert.equal(r.result.protocolVersion, '2025-06-18');
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.deepEqual(r.result.serverInfo, { name: 'bit-atelier', version: VERSION });
  });

  it('notifications/initialized bekommt keine Antwort, ping antwortet {}', async () => {
    const vorher = mcp.zeilen.length;
    mcp.roh(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    const r = await mcp.rpc('ping');
    assert.deepEqual(r.result, {});
    assert.equal(mcp.zeilen.length, vorher + 1, 'only the ping answer arrived');
  });

  it('unbekannte Methode → -32601, unbekanntes Werkzeug → -32602, kaputtes JSON → -32700', async () => {
    assert.equal((await mcp.rpc('resources/list')).error.code, -32601);
    assert.equal((await mcp.rpc('tools/call', { name: 'gibts_nicht', arguments: {} })).error.code, -32602);
    const vorher = mcp.zeilen.length;
    mcp.roh('{kein json');
    await mcp.rpc('ping');
    assert.equal(mcp.zeilen[vorher].error.code, -32700);
  });

  it('tools/list ohne Schreibrecht: sechs Lesewerkzeuge, nichts zum Schreiben', async () => {
    const r = await mcp.rpc('tools/list');
    const namen = r.result.tools.map((w) => w.name);
    assert.deepEqual(namen, ['bit_status', 'list_entity_types', 'list_projects', 'get_project', 'list_records', 'get_record']);
    for (const w of r.result.tools) {
      assert.equal(w.inputSchema.type, 'object', w.name);
      assert.ok(w.description.includes(' / '), `${w.name}: description DE / EN`);
    }
  });
});

describe('MCP server — read tools', () => {
  let api, mcp;
  before(async () => { api = await fakeApi(); mcp = starteMcp(api.url); });
  after(async () => { await mcp.ende(); api.server.close(); });

  it('bit_status: erreichbar, Version der App, lesend', async () => {
    const { json, isError } = await mcp.werkzeug('bit_status');
    assert.equal(isError, false);
    assert.equal(json.erreichbar, true);
    assert.equal(json.app.version, '9.9.9');
    assert.deepEqual(json.mcp_server, { version: VERSION, schreiben: false });
  });

  it('list_entity_types liest GET /api/entities', async () => {
    const { json } = await mcp.werkzeug('list_entity_types');
    assert.equal(json.entitaeten[0].name, 'Project');
  });

  it('list_projects: Kurzform, neueste zuerst angefragt, limit', async () => {
    const { json } = await mcp.werkzeug('list_projects', { limit: 2 });
    assert.equal(json.gesamt, 3);
    assert.equal(json.anzahl, 2);
    assert.deepEqual(json.datensaetze[0], { id: 'p1', name: 'Wohnhaus Nord', client: 'Bauherr A', status: 'design', ort: 'Musterstadt', updated_date: '2026-10-02' });
    assert.ok(api.anfragen.some((a) => a.url === '/api/entities/Project?sort=-updated_date'));
  });

  it('get_project / get_record: voller Datensatz; 404 → isError', async () => {
    assert.equal((await mcp.werkzeug('get_project', { id: 'p1' })).json.grosses_feld, 'x');
    assert.equal((await mcp.werkzeug('get_record', { entity: 'Project', id: 'p1' })).json.name, 'Wohnhaus Nord');
    const fehlt = await mcp.werkzeug('get_record', { entity: 'Project', id: 'p9' });
    assert.equal(fehlt.isError, true);
    assert.match(fehlt.text, /HTTP 404/);
  });

  it('list_records: Filter und Sortierung als Query, limit ≤ 200', async () => {
    const { json } = await mcp.werkzeug('list_records', { entity: 'ChangeOrder', filter: { status: 'approved' }, sort: '-updated_date', limit: 2 });
    assert.equal(json.gesamt, 3);
    assert.equal(json.anzahl, 2);
    assert.ok(api.anfragen.some((a) => a.url === '/api/entities/ChangeOrder?status=approved&sort=-updated_date'));
    const viele = await mcp.werkzeug('list_records', { entity: 'ChangeOrder', limit: 5000 });
    assert.equal(viele.json.anzahl, 3, 'limit is clamped, not an error');
  });

  it('ungültige Entität und gesperrte Entität → isError mit Klartext', async () => {
    const falsch = await mcp.werkzeug('list_records', { entity: '../auth/me' });
    assert.equal(falsch.isError, true);
    assert.match(falsch.text, /Ungültige Entität/);
    const gesperrt = await mcp.werkzeug('list_records', { entity: 'LlmConnection' });
    assert.equal(gesperrt.isError, true);
    assert.match(gesperrt.text, /403/);
  });

  it('große Antwort: gültiges JSON unter 50.000 Zeichen mit Hinweis', async () => {
    const { text, json } = await mcp.werkzeug('list_records', { entity: 'Gross', limit: 150 });
    assert.ok(text.length <= 50_000, `${text.length} Zeichen`);
    assert.ok(json, 'still valid JSON');
    assert.ok(json.anzahl < 150);
    assert.match(json.hinweis, /gekürzt/);
  });

  it('Schreibversuch ohne Schreibrecht wird abgelehnt, die API sieht nichts', async () => {
    const r = await mcp.werkzeug('create_record', { entity: 'Notiz', data: { text: 'hallo' } });
    assert.equal(r.isError, true);
    assert.match(r.text, /Schreibrecht fehlt/);
    const u = await mcp.werkzeug('update_record', { entity: 'Notiz', id: 'n1', data: { text: 'x' } });
    assert.equal(u.isError, true);
    assert.equal(api.anfragen.filter((a) => a.methode !== 'GET').length, 0);
  });
});

describe('MCP server — write permission', () => {
  for (const schalter of ['--schreiben', '--write']) {
    it(`${schalter}: create_record und update_record erscheinen und schreiben`, async () => {
      const api = await fakeApi();
      const mcp = starteMcp(api.url, [schalter]);
      try {
        const namen = (await mcp.rpc('tools/list')).result.tools.map((w) => w.name);
        assert.ok(namen.includes('create_record') && namen.includes('update_record'));
        const neu = await mcp.werkzeug('create_record', { entity: 'Notiz', data: { text: 'hallo' } });
        assert.deepEqual(neu.json, { id: 'n1', text: 'hallo' });
        const geaendert = await mcp.werkzeug('update_record', { entity: 'Notiz', id: 'n1', data: { text: 'neu' } });
        assert.equal(geaendert.json.text, 'neu');
        assert.deepEqual(api.anfragen.filter((a) => a.methode !== 'GET').map((a) => `${a.methode} ${a.url}`), ['POST /api/entities/Notiz', 'PUT /api/entities/Notiz/n1']);
        const ohneDaten = await mcp.werkzeug('create_record', { entity: 'Notiz', data: 'kein objekt' });
        assert.equal(ohneDaten.isError, true);
      } finally {
        await mcp.ende();
        api.server.close();
      }
    });
  }
});

describe('MCP server — API down', () => {
  it('bit_status und list_projects melden "BIT-Atelier läuft nicht" mit isError', async () => {
    // A port that was just free: open and close a server to get one.
    const frei = await new Promise((resolve) => {
      const s = http.createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
    const mcp = starteMcp(`http://127.0.0.1:${frei}/api`);
    try {
      for (const name of ['bit_status', 'list_projects']) {
        const r = await mcp.werkzeug(name);
        assert.equal(r.isError, true, name);
        assert.match(r.text, /BIT-Atelier läuft nicht — starten Sie die App \(start-windows\.cmd \/ npm start\)/);
      }
    } finally {
      await mcp.ende();
    }
  });
});
