// personalRouter.test.js — Express side of the "personal" storage class
// (Plan 80-02, DS-05): the generic CRUD path rejects every Personal entity
// with 403 BEFORE the bulk path, the HR-only path lives on its own file, an
// unknown entity 404s, files outside loopback need an explicit opt-in, and a
// path-traversal attempt on the file store 400s.
//
// A REAL express app on app.listen(0) (an ephemeral port) — same pattern the
// plan's read_first points to (tests/unit/typesafe-server.test.js's server
// mock is not enough here: this behaviour lives in the Express ROUTING
// itself, not in a pure function). Both db.json AND personal.json live in a
// throwaway temp dir; neither ever touches the real server/*.json.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../packages/nova-core/server/db.js';
import { createBlobStore } from '../../packages/nova-core/server/blobs.js';
import { entitiesRouter } from '../../packages/nova-core/server/routes.js';
import { personalRouter } from '../../packages/nova-core/server/personalRouter.js';

/** @param {import('express').Express} app @returns {Promise<import('http').Server>} */
function starte(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('personalRouter — generisches CRUD 403, eigene Datei, unbekannte Entität (DS-05)', () => {
  let tmpDir, dbPfad, personalPfad, personalBlobsDir, server, port, db, pdb;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-personal-router-'));
    dbPfad = path.join(tmpDir, 'db.json');
    personalPfad = path.join(tmpDir, 'personal.json');
    personalBlobsDir = path.join(tmpDir, 'personal-blobs');
    fs.writeFileSync(dbPfad, '{}', 'utf-8');

    db = createDb(dbPfad);
    pdb = createDb(personalPfad);
    const blobs = createBlobStore(personalBlobsDir);
    const app = express();
    app.use(express.json());
    app.use('/api', entitiesRouter(db));
    app.use('/api', personalRouter(pdb, blobs, { lokalGebunden: true }));

    server = await starte(app);
    port = server.address().port;
  });

  after(() => {
    server.close();
    db.flush();
    pdb.flush(); // debounced persist() must land before the temp dir is removed
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const url = (pfad) => `http://127.0.0.1:${port}/api${pfad}`;

  it('GET /api/entities/Mitarbeiter → 403', async () => {
    const r = await fetch(url('/entities/Mitarbeiter'));
    assert.equal(r.status, 403);
  });

  it('POST /api/entities/Mitarbeiter/bulk → 403 (die Sperre muss vor dem Bulk-Pfad greifen)', async () => {
    const r = await fetch(url('/entities/Mitarbeiter/bulk'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [] }),
    });
    assert.equal(r.status, 403);
  });

  it('GET /api/personal/Mitarbeiter → 200 []', async () => {
    const r = await fetch(url('/personal/Mitarbeiter'));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });

  it('POST /api/personal/Mitarbeiter → 201; landet in personal.json, NICHT in db.json', async () => {
    const r = await fetch(url('/personal/Mitarbeiter'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vorname: 'Test' }),
    });
    assert.equal(r.status, 201);
    const angelegt = await r.json();
    assert.ok(angelegt.id);
    pdb.flush(); // db.js debounces persist() by 120ms — force it before reading the file
    db.flush();

    const personalJson = JSON.parse(fs.readFileSync(personalPfad, 'utf-8'));
    assert.equal(personalJson.Mitarbeiter?.length, 1);
    assert.equal(personalJson.Mitarbeiter[0].vorname, 'Test');

    const dbJson = fs.existsSync(dbPfad) ? JSON.parse(fs.readFileSync(dbPfad, 'utf-8')) : {};
    assert.ok(!dbJson.Mitarbeiter, 'Mitarbeiter darf nie in db.json auftauchen');
  });

  it('GET /api/personal/Project → 404 ("keine Personal-Entität")', async () => {
    const r = await fetch(url('/personal/Project'));
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.match(body.error, /keine Personal-Entität/);
  });

  it('GET /api/personal-dateien/..%2Fx → 400 (ID_MUSTER lehnt den Pfad ab)', async () => {
    const r = await fetch(url('/personal-dateien/..%2Fx'));
    assert.equal(r.status, 400);
  });

  it('PUT/GET/DELETE /api/personal-dateien/:id — Rundlauf über den Blob-Store', async () => {
    const put = await fetch(url('/personal-dateien/d1'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'application/pdf', name: 'v.pdf', data: 'data:…' }),
    });
    assert.equal(put.status, 200);
    const get = await fetch(url('/personal-dateien/d1'));
    assert.equal(get.status, 200);
    assert.equal((await get.json()).name, 'v.pdf');
    const del = await fetch(url('/personal-dateien/d1'), { method: 'DELETE' });
    assert.equal(del.status, 200);
    const nachDel = await fetch(url('/personal-dateien/d1'));
    assert.equal(nachDel.status, 404);
  });
});

describe('personalRouter — Loopback-Sperre (D-P80-05)', () => {
  let tmpDir, server, port, pdb;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-personal-router-lan-'));
    pdb = createDb(path.join(tmpDir, 'personal.json'));
    const blobs = createBlobStore(path.join(tmpDir, 'personal-blobs'));
    const app = express();
    app.use(express.json());
    app.use('/api', personalRouter(pdb, blobs, { lokalGebunden: false }));
    server = await starte(app);
    port = server.address().port;
  });

  after(() => {
    server.close();
    pdb.flush(); // debounced persist() must land before the temp dir is removed
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PERSONAL_LAN;
  });

  it('lokalGebunden:false, ohne PERSONAL_LAN → 403', async () => {
    delete process.env.PERSONAL_LAN;
    const r = await fetch(`http://127.0.0.1:${port}/api/personal/Mitarbeiter`);
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.match(body.error, /nur lokal erreichbar/);
  });

  it('lokalGebunden:false, mit PERSONAL_LAN=1 → 200', async () => {
    process.env.PERSONAL_LAN = '1';
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/personal/Mitarbeiter`);
      assert.equal(r.status, 200);
    } finally {
      delete process.env.PERSONAL_LAN;
    }
  });
});
