// datenPfad.test.js — the data folder rule of plan 83-03 (server/datenPfad.js):
// without BIT_DATA_DIR everything stays in server/, with it every write file of
// the local API (db.json, blobs/, personal.json, personal-blobs/) moves into that
// folder, which is created when missing. Plus: server/index.js and server/seed.js
// really use the rule (no second path construction left).

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datenOrdner, datenPfad, SERVER_ORDNER } from '../../server/datenPfad.js';
import { createDb } from '../../packages/nova-core/server/db.js';
import { createBlobStore } from '../../packages/nova-core/server/blobs.js';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-datenpfad-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('datenOrdner / datenPfad', () => {
  it('ohne BIT_DATA_DIR → server/ wie bisher', () => {
    assert.equal(datenOrdner({}), path.join(WURZEL, 'server'));
    assert.equal(SERVER_ORDNER, path.join(WURZEL, 'server'));
    assert.equal(datenPfad('db.json', {}), path.join(WURZEL, 'server', 'db.json'));
  });

  it('leerer oder nur aus Leerzeichen bestehender Wert zählt als nicht gesetzt', () => {
    assert.equal(datenOrdner({ BIT_DATA_DIR: '   ' }), SERVER_ORDNER);
  });

  it('mit BIT_DATA_DIR → Ordner wird angelegt, Pfade liegen darin', () => {
    const ordner = path.join(tmp, 'neu', 'daten');
    assert.equal(fs.existsSync(ordner), false);
    const env = { BIT_DATA_DIR: ordner };
    assert.equal(datenPfad('db.json', env), path.join(ordner, 'db.json'));
    assert.equal(fs.statSync(ordner).isDirectory(), true);
  });

  it('relativer BIT_DATA_DIR wird gegen das Arbeitsverzeichnis aufgelöst', () => {
    const rel = path.relative(process.cwd(), path.join(tmp, 'relativ'));
    assert.equal(datenOrdner({ BIT_DATA_DIR: rel }), path.join(tmp, 'relativ'));
  });

  it('nur Datei- oder Ordnernamen, keine Pfade', () => {
    for (const falsch of ['', '../db.json', 'a/b', 'a\\b', '..', '.']) {
      assert.throws(() => datenPfad(falsch, {}), /ungültiger Name/, JSON.stringify(falsch));
    }
  });

  it('db.json, blobs, personal.json und personal-blobs landen im Datenordner', () => {
    const env = { BIT_DATA_DIR: path.join(tmp, 'voll') };
    const db = createDb(datenPfad('db.json', env));
    db.create('Project', { name: 'Probe' });
    db.flush();
    createBlobStore(datenPfad('blobs', env)).put('b1', { a: 1 });
    const pdb = createDb(datenPfad('personal.json', env));
    pdb.create('Mitarbeiter', { name: 'X' });
    pdb.flush();
    createBlobStore(datenPfad('personal-blobs', env)).put('p1', { b: 2 });
    const inhalt = fs.readdirSync(env.BIT_DATA_DIR).sort();
    assert.deepEqual(inhalt, ['blobs', 'db.json', 'personal-blobs', 'personal.json']);
  });
});

describe('server/ uses the rule — one path source', () => {
  for (const datei of ['server/index.js', 'server/seed.js']) {
    it(`${datei}: kein path.join(__dirname, '<datei>.json') mehr`, () => {
      const quelle = fs.readFileSync(path.join(WURZEL, datei), 'utf8');
      assert.doesNotMatch(quelle, /path\.join\(__dirname,\s*'(db|personal)\.json'\)/);
      assert.doesNotMatch(quelle, /path\.join\(__dirname,\s*'(blobs|personal-blobs)'\)/);
      assert.match(quelle, /datenPfad\('db\.json'\)/);
    });
  }
});
