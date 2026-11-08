// mcp-schreiben-real-11102.test.js — the write path of plan 111-02 against the REAL app: server/index.js (own temp data folder,
// free port, no Vite) and tools/mcp-server.mjs --schreiben as child processes. A neutral contact goes the whole way:
// create_record preview → ausfuehren (with idempotenz_schluessel) → delete_record (into the Papierkorb) → papierkorb_lesen →
// wiederherstellen; then app AND MCP server are restarted on the same data folder and the same idempotenz_schluessel still
// returns the first record (the key lives in the store, field ki_vorgang). The stub tests (mcp-schreiben-11102) cannot show that
// the real composition root mounts the bin, its lock and the session guard in the right order - this one does.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATEN = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-real-11102-'));
// BIT_PERSONAL_SCHLUESSEL is the PATH of the key file (ruheVerschluesselung.js) - a bare value would land as a file in the cwd (repo root)
const SCHLUESSEL = path.join(DATEN, 'personal.key');

/** A free TCP port on 127.0.0.1. @returns {Promise<number>} */
function freierPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = /** @type {net.AddressInfo} */ (s.address()); s.close(() => resolve(port)); });
  });
}

/** @type {import('node:child_process').ChildProcess[]} every process this file started */
const gestartet = [];

/** @param {import('node:child_process').ChildProcess} p */
async function beenden(p) {
  if (p && p.exitCode === null && p.signalCode === null) {
    p.kill();
    await new Promise((r) => { p.once('exit', r); setTimeout(r, 5000); });
  }
}

after(async () => {
  for (const p of gestartet.reverse()) await beenden(p);
  try { fs.rmSync(DATEN, { recursive: true, force: true }); } catch { /* temp folder, leave it */ }
});

/** Starts server/index.js on the temp data folder; resolves when /api/status answers. @param {number} port */
async function appStarten(port) {
  const api = spawn(process.execPath, [path.join(WURZEL, 'server', 'index.js')], {
    cwd: WURZEL, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BIT_DATA_DIR: DATEN, BIT_PERSONAL_SCHLUESSEL: SCHLUESSEL, API_PORT: String(port), BIT_STEUERUNG_TOKEN: '' },
  });
  gestartet.push(api);
  let log = '';
  api.stdout.on('data', (s) => { log += s; });
  api.stderr.on('data', (s) => { log += s; });
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) return api; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`API did not start:\n${log.slice(-1500)}`);
}

/** The MCP server with --schreiben against the API. @param {string} apiUrl */
function mcpStarten(apiUrl) {
  const env = { ...process.env, BIT_API_URL: apiUrl, BIT_DATA_DIR: DATEN };
  delete env.BIT_STEUERUNG_TOKEN;
  const kind = spawn(process.execPath, [path.join(WURZEL, 'tools', 'mcp-server.mjs'), '--schreiben'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  gestartet.push(kind);
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
    kind,
    async werkzeug(name, args) {
      const r = await rpc('tools/call', { name, arguments: args });
      const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
      assert.notEqual(r.result?.isError, true, `${name}: ${text}`);
      return JSON.parse(text);
    },
    ende: () => new Promise((r) => { kind.on('exit', r); kind.stdin.end(); }),
  };
}

describe('111-02 — MCP write path against the real server/index.js', () => {
  it('preview → ausfuehren → Papierkorb → papierkorb_lesen → wiederherstellen; idempotency survives a restart of app and MCP server', { timeout: 120000 }, async () => {
    let port = await freierPort();
    let api = await appStarten(port);
    let API = `http://127.0.0.1:${port}/api`;
    const neu = await fetch(`${API}/entities/Project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Testprojekt A', status: 'design' }) });
    assert.equal(neu.status, 201);
    const projekt = await neu.json();
    const lies = async (pfad) => (await fetch(`${API}${pfad}`)).json();

    let mcp = mcpStarten(API);
    const kontakt = { name: 'Kontakt Muster', rolle: 'Tragwerksplanung', project_id: projekt.id };
    const v = await mcp.werkzeug('create_record', { entity: 'Contact', data: kontakt, idempotenz_schluessel: 'real-11102' });
    assert.equal(v.vorschau, true);
    assert.equal(v.vorher, null);
    assert.deepEqual(await lies('/entities/Contact'), [], 'the preview wrote nothing');

    const a = await mcp.werkzeug('create_record', v.naechster_schritt.argumente);
    assert.equal(a.status, 'angelegt');
    const id = a.datensatz.id;
    assert.equal((await lies(`/entities/Contact/${id}`)).ki_vorgang, 'real-11102');

    const dv = await mcp.werkzeug('delete_record', { entity: 'Contact', id, grund: 'Probe' });
    const d = await mcp.werkzeug('delete_record', dv.naechster_schritt.argumente);
    assert.equal(d.status, 'im Papierkorb');
    assert.deepEqual(await lies('/entities/Contact'), []);
    const generisch = await fetch(`${API}/entities/Papierkorb`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(generisch.status, 403, 'the composition root mounts the lock before the generic CRUD');

    const pk = await mcp.werkzeug('papierkorb_lesen', { entity: 'Contact' });
    assert.equal(pk.anzahl, 1);
    assert.deepEqual([pk.datensaetze[0].record_id, pk.datensaetze[0].herkunft, pk.datensaetze[0].grund], [id, 'mcp', 'Probe']);

    const wv = await mcp.werkzeug('wiederherstellen', { id: pk.datensaetze[0].id });
    assert.deepEqual(wv.probleme, []);
    const w = await mcp.werkzeug('wiederherstellen', wv.naechster_schritt.argumente);
    assert.equal(w.status, 'wiederhergestellt');
    const zurueck = await lies(`/entities/Contact/${id}`);
    assert.deepEqual([zurueck.id, zurueck.name, zurueck.rolle], [id, 'Kontakt Muster', 'Tragwerksplanung']);
    assert.deepEqual(await lies('/papierkorb'), []);

    // restart both: the key is in the store, not in a process
    await new Promise((r) => setTimeout(r, 400)); // the store writes with a 120 ms debounce; a killed process on Windows does not flush
    await mcp.ende();
    await beenden(api);
    port = await freierPort();
    api = await appStarten(port);
    API = `http://127.0.0.1:${port}/api`;
    mcp = mcpStarten(API);
    const nochmal = await mcp.werkzeug('create_record', { entity: 'Contact', data: kontakt, ausfuehren: true, idempotenz_schluessel: 'real-11102' });
    assert.equal(nochmal.status, 'schon angelegt');
    assert.equal(nochmal.datensatz.id, id);
    assert.equal((await lies('/entities/Contact')).length, 1);
    await mcp.ende();
  });
});
