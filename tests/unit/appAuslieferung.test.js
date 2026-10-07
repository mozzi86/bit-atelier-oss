// appAuslieferung.test.js — `npm start` serves the built client and the API on one
// port (plan 83-03, server/appAuslieferung.js). A REAL express app on an ephemeral
// port with a throwaway dist/ folder: static files with cache headers, the SPA
// fallback for BrowserRouter paths, JSON 404 for unknown API paths. Plus the
// entity overview GET /api/entities the MCP server's list_entity_types reads.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appAusliefern, istAppModus, istSpaPfad, CACHE_LANG, CACHE_KEIN } from '../../server/appAuslieferung.js';
import { createDb } from '../../packages/nova-core/server/db.js';
import { entitiesRouter, entitaetenUebersicht } from '../../packages/nova-core/server/routes.js';

/** @param {import('express').Express} app @returns {Promise<import('http').Server>} */
function starte(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('istAppModus / istSpaPfad', () => {
  it('--app, NODE_ENV=production oder BIT_APP=1 schalten den App-Modus ein', () => {
    assert.equal(istAppModus(['node', 'server/index.js'], {}), false);
    assert.equal(istAppModus(['node', 'server/index.js', '--app'], {}), true);
    assert.equal(istAppModus([], { NODE_ENV: 'production' }), true);
    assert.equal(istAppModus([], { BIT_APP: '1' }), true);
    assert.equal(istAppModus([], { NODE_ENV: 'development' }), false);
  });
  it('SPA-Pfade: ohne Dateiendung und nicht unter /api', () => {
    assert.equal(istSpaPfad('/'), true);
    assert.equal(istSpaPfad('/Projects'), true);
    assert.equal(istSpaPfad('/projekt/abc123/AVA'), true);
    assert.equal(istSpaPfad('/assets/index-abc.js'), false);
    assert.equal(istSpaPfad('/api'), false);
    assert.equal(istSpaPfad('/api/entities/Project'), false);
    assert.equal(istSpaPfad('/apiary'), true, 'only the /api segment is reserved');
  });
});

describe('appAusliefern — one port for app and API', () => {
  let tmp, dist, server, basis, db;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-app-'));
    dist = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'icons'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>BIT-Atelier</title><div id="root"></div>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dist, 'icons', 'icon-192.png'), 'png');
    fs.writeFileSync(path.join(dist, '.geheim'), 'x');

    db = createDb(path.join(tmp, 'db.json'));
    db.create('Project', { name: 'A' });
    db.create('Project', { name: 'B' });
    db.create('Din276Katalog', { kg: '300' });
    db.create('LlmConnection', { provider: 'anthropic', api_key: 'sk-geheim' });
    db.create('Mitarbeiter', { name: 'X' });

    const app = express();
    app.use(express.json());
    app.use('/api', entitiesRouter(db));
    app.get('/api/status', (_req, res) => res.json({ ok: true }));
    appAusliefern(app, dist);
    server = await starte(app);
    basis = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    db.flush();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('GET / → index.html, no-cache', async () => {
    const r = await fetch(`${basis}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), CACHE_KEIN);
    assert.match(await r.text(), /<title>BIT-Atelier<\/title>/);
  });

  it('GET /Projects (Client-Route) → index.html (SPA-Fallback)', async () => {
    const r = await fetch(`${basis}/Projects?tab=1`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /id="root"/);
  });

  it('gehashte Assets: ein Jahr, immutable', async () => {
    const r = await fetch(`${basis}/assets/index-abc123.js`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), CACHE_LANG);
    assert.match(r.headers.get('content-type'), /javascript/);
  });

  it('ungehashte Dateien: no-cache', async () => {
    const r = await fetch(`${basis}/icons/icon-192.png`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), CACHE_KEIN);
  });

  it('fehlende Datei mit Endung → 404, kein index.html', async () => {
    const r = await fetch(`${basis}/assets/fehlt.js`);
    assert.equal(r.status, 404);
  });

  it('Punktdateien werden nicht ausgeliefert', async () => {
    const r = await fetch(`${basis}/.geheim`);
    assert.notEqual(await r.text(), 'x');
  });

  it('API-Routen gehen vor, unbekannte API-Pfade → JSON 404', async () => {
    const ok = await fetch(`${basis}/api/status`);
    assert.deepEqual(await ok.json(), { ok: true });
    const r = await fetch(`${basis}/api/gibtsnicht`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.match((await r.json()).error, /Unbekannter API-Pfad/);
  });

  it('GET /api/entities: Sammlungen mit Anzahl, gesperrte nie', async () => {
    const r = await fetch(`${basis}/api/entities`);
    const body = await r.json();
    assert.deepEqual(body.entitaeten, [
      { name: 'Din276Katalog', anzahl: 1, katalog: true },
      { name: 'Project', anzahl: 2, katalog: false },
    ]);
    assert.ok(body.gesperrt.includes('LlmConnection'));
    assert.ok(body.gesperrt.includes('Mitarbeiter'));
    assert.deepEqual(entitaetenUebersicht(db), body);
  });

  it('ohne dist/index.html → klarer Fehler', () => {
    assert.throws(() => appAusliefern(express(), path.join(tmp, 'leer')), /npm run build/);
  });
});
