// mcp-schreibweg-11301.test.js — the write path of local Node tools against the REAL server (plan 113-01, finding B-111-01-01).
//
// Until 113-01 the session guard (server/sitzungsSchutz.js) took Node's global fetch for a browser, because undici sends
// "sec-fetch-mode: cors" on every request; every write of the MCP server was refused with 401. All MCP tests ran against fake APIs,
// so nothing noticed. This file therefore uses the real pieces:
//  1. a small Express app with the real sitzungsSchutz, called with the real Node fetch: a write without a session header passes,
//     a write with Origin (browser) is refused;
//  2. the real server/index.js (own temp data folder, free port, no Vite) and tools/mcp-server.mjs --schreiben as child processes:
//     a project created with plain fetch, create_record through MCP lands in the store, and a control-channel tool answers without
//     a 401 (no viewer is open, so "not-run" is the expected answer).

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { sitzungsSchutz } from '../../server/sitzungsSchutz.js';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A free TCP port on 127.0.0.1. @returns {Promise<number>} */
function freierPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = /** @type {net.AddressInfo} */ (s.address()); s.close(() => resolve(port)); });
  });
}

describe('113-01 — session guard with the real Node fetch', () => {
  it('a write without session header passes (Node fetch sends sec-fetch-mode only); a write with Origin is refused', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', sitzungsSchutz({ token: 'geheim-113' }));
    app.post('/api/ding', (req, res) => res.status(201).json({ ok: true, kopf: req.headers['sec-fetch-mode'] ?? null }));
    const port = await freierPort();
    const server = await new Promise((r) => { const s = app.listen(port, '127.0.0.1', () => r(s)); });
    try {
      const ohne = await fetch(`http://127.0.0.1:${port}/api/ding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(ohne.status, 201);
      // proof of the cause: Node's fetch really sends the Fetch-Metadata mode header
      assert.equal((await ohne.json()).kopf, 'cors');
      const browser = await fetch(`http://127.0.0.1:${port}/api/ding`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: '{}' });
      assert.equal(browser.status, 401);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('113-01 — MCP server against the real server/index.js', () => {
  const DATEN = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-11301-'));
  /** @type {import('node:child_process').ChildProcess|null} */
  let api = null;
  /** @type {import('node:child_process').ChildProcess|null} */
  let mcp = null;
  let apiLog = '';

  after(async () => {
    for (const p of [mcp, api]) {
      if (p && p.exitCode === null) {
        p.kill();
        await new Promise((r) => { p.once('exit', r); setTimeout(r, 5000); });
      }
    }
    try { fs.rmSync(DATEN, { recursive: true, force: true }); } catch { /* temp folder, leave it */ }
  });

  it('create_record lands in the store and the control channel answers without 401', { timeout: 90000 }, async () => {
    const port = await freierPort();
    const API = `http://127.0.0.1:${port}/api`;
    api = spawn(process.execPath, [path.join(WURZEL, 'server', 'index.js')], {
      cwd: WURZEL, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BIT_DATA_DIR: DATEN, BIT_PERSONAL_SCHLUESSEL: path.join(DATEN, 'personal.key'), API_PORT: String(port), BIT_STEUERUNG_TOKEN: '' },
    });
    api.stdout.on('data', (s) => { apiLog += s; });
    api.stderr.on('data', (s) => { apiLog += s; });
    let oben = false;
    for (let i = 0; i < 240 && !oben; i += 1) {
      try { oben = (await fetch(`${API}/status`)).ok; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    assert.ok(oben, `API did not start:\n${apiLog.slice(-1500)}`);

    // plain Node fetch, no session header — refused with 401 before 113-01
    const neu = await fetch(`${API}/entities/Project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Testprojekt A', status: 'design' }) });
    assert.equal(neu.status < 300, true, `POST Project → HTTP ${neu.status}`);
    const projekt = await neu.json();

    const env = { ...process.env, BIT_API_URL: API };
    delete env.BIT_STEUERUNG_TOKEN; // the token comes from <data folder>/steuerung.token of the real server
    mcp = spawn(process.execPath, [path.join(WURZEL, 'tools', 'mcp-server.mjs'), '--schreiben'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const warter = new Map();
    let rest = '';
    mcp.stdout.setEncoding('utf8');
    mcp.stdout.on('data', (s) => {
      rest += s;
      let i;
      while ((i = rest.indexOf('\n')) >= 0) { const m = JSON.parse(rest.slice(0, i)); rest = rest.slice(i + 1); warter.get(m.id)?.(m); }
    });
    let n = 1;
    const rpc = (method, params) => { const id = n++; const p = new Promise((r) => warter.set(id, r)); mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); return p; };
    const text = (r) => r.result?.content?.[0]?.text ?? JSON.stringify(r.error);

    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-113-01', version: '1' } });
    // 111-02: ausfuehren: true - without it create_record only answers the preview
    const c = await rpc('tools/call', { name: 'create_record', arguments: { entity: 'Notiz', data: { text: 'Schreibweg 113-01', project_id: projekt.id }, ausfuehren: true } });
    assert.notEqual(c.result.isError, true, text(c));
    const notizen = await (await fetch(`${API}/entities/Notiz`)).json();
    assert.ok(notizen.some((x) => x.text === 'Schreibweg 113-01'), JSON.stringify(notizen).slice(0, 300));

    const d = await rpc('tools/call', { name: 'zeichenflaeche_befehle', arguments: {} });
    assert.doesNotMatch(text(d), /\b401\b|Sitzung|Steuerungs-Token/, text(d));
    assert.match(text(d), /not-run/, text(d));
  });
});
