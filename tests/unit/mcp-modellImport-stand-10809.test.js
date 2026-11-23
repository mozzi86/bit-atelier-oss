// mcp-modellImport-stand-10809.test.js — review finding R-GJ-1: modell_importieren (tools/mcp-server.mjs) as a child process against the
// real modellImportRouter on a createDb() temp file. With ausfuehren: true the tool must send the apply only with the exact stand of
// its own dry run; any other stand ('egal', an old or a future date) is "nicht übernommen: inzwischen geändert" and nothing is sent.
// Neutral test data only; never server/db.json.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDb } from '../../packages/nova-core/server/db.js';
import { modellImportRouter } from '../../server/modellImportRouter.js';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKRIPT = path.join(WURZEL, 'tools', 'mcp-server.mjs');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(WURZEL, 'tests', 'unit', 'fixtures', 'efh-108-import.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-modellimport-'));

/** @type {any} */ let db;
/** @type {string[]} */ const anfragen = [];
/** @type {any} */ let server;
/** @type {any} */ let kind;
/** @type {Map<number, (m: any) => void>} */ const warter = new Map();
let n = 1;

/** One tool call; returns {isError, text, json}. @param {string} name @param {any} args */
async function werkzeug(name, args) {
  const id = n++;
  const p = new Promise((r) => warter.set(id, r));
  kind.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
  const r = /** @type {any} */ (await p);
  assert.ok(r.result, `${name}: ${JSON.stringify(r.error)}`);
  const text = r.result.content[0].text;
  let json = null;
  try { json = JSON.parse(text); } catch { /* prose */ }
  return { isError: r.result.isError === true, text, json };
}

before(async () => {
  db = createDb(path.join(TMP, 'db.json'));
  const a = express();
  a.use(express.json({ limit: '10mb' }));
  a.use('/api', (req, _res, next) => { anfragen.push(`${req.method} ${req.originalUrl.replace(/^\/api/, '')}`); next(); });
  a.get('/api/system/datenordner', (_req, res) => res.json({ ordner: TMP }));
  a.get('/api/auth/me', (_req, res) => res.json({ id: 'u1', full_name: 'Testperson' }));
  a.use('/api', modellImportRouter(db));
  server = await new Promise((r) => { const s = a.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api`;
  kind = spawn(process.execPath, [SKRIPT, '--schreiben'], { env: { ...process.env, BIT_API_URL: url, BIT_DATA_DIR: TMP }, stdio: ['pipe', 'pipe', 'pipe'] });
  let rest = '';
  kind.stdout.setEncoding('utf8');
  kind.stdout.on('data', (/** @type {string} */ s) => {
    rest += s;
    let i;
    while ((i = rest.indexOf('\n')) >= 0) { const m = JSON.parse(rest.slice(0, i)); rest = rest.slice(i + 1); warter.get(m.id)?.(m); }
  });
  db.create('Project', { id: 'P1', name: 'Testprojekt Import' }, { kennungUebernehmen: true });
});

after(async () => {
  await new Promise((r) => { kind.on('exit', r); kind.stdin.end(); });
  await new Promise((r) => server.close(r));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder */ }
});

test('R-GJ-1: modell_importieren applies only with the exact stand of its dry run', async () => {
  const erst = await werkzeug('modell_importieren', { projekt_id: 'P1', modell: FIXTURE, ausfuehren: true });
  assert.equal(erst.json?.uebernommen, true, erst.text);
  const neu = structuredClone(FIXTURE);
  neu.customWalls = neu.customWalls.slice(0, 1);
  neu.customWindows = [neu.customWindows[0]];
  for (const stand of ['egal', '2020-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z']) {
    const vorher = anfragen.length;
    const r = await werkzeug('modell_importieren', { projekt_id: 'P1', modell: neu, ausfuehren: true, stand });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.uebernommen, false, `stand ${stand} must not write`);
    assert.match(r.json.grund, /inzwischen geändert/);
    assert.ok(!anfragen.slice(vorher).some((x) => x.includes('modus=anwenden')), `no apply sent for stand ${stand}`);
  }
  assert.equal(db.filter('BimModel', { project_id: 'P1' })[0].customWalls.length, 3, 'nothing overwritten');
  // the stand of the dry run writes
  const v = await werkzeug('modell_importieren', { projekt_id: 'P1', modell: neu });
  const ok = await werkzeug('modell_importieren', { projekt_id: 'P1', modell: neu, ausfuehren: true, stand: v.json.stand });
  assert.equal(ok.json.uebernommen, true, ok.text);
  assert.equal(db.filter('BimModel', { project_id: 'P1' })[0].customWalls.length, 1);
});
