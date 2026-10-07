// Phase 57-03, Task 2: unit tests for the Supabase import building blocks.
//
// What is pinned here (per plan):
//   - leseDbJson on a fixture (3 entities; a row WITHOUT id must fail with a
//     plain-text error — ids are the contract for upsert and cross-references)
//   - inBatches: 1201 rows → 3 batches (500/500/201)
//   - blobIdsPruefen: blobs.js whitelist split (valid vs. invalid names)
//   - zeileAusDatensatz (from @core abfrage.js — the ONE mapping shared by
//     client and import): id preserved, timestamps stripped from `data`
//   - importiere() end-to-end with a MOCKED supabase client: dry-run writes
//     nothing, real run upserts in batches, deviations are counted.
//
// No network calls anywhere: the client is a hand-rolled mock.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  leseDbJson,
  inBatches,
  blobIdsPruefen,
  importiere,
} from '../../scripts/supabase-import.mjs';
import { zeileAusDatensatz, neueId } from '@core/api/abfrage.js';

// --- Fixtures in a temp dir (never touch server/db.json) ---------------------

/** @type {string} */
let tmpDir;

/**
 * Writes a fixture db.json and an optional blob directory.
 * @param {object} db the db.json content
 * @param {Record<string, object>} [blobs] blob id → JSON content
 * @returns {{ dbPfad: string, blobVerzeichnis: string }}
 */
function fixture(db, blobs = {}) {
  const dbPfad = path.join(tmpDir, `db-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(dbPfad, JSON.stringify(db, null, 2), 'utf-8');
  const blobVerzeichnis = path.join(tmpDir, `blobs-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(blobVerzeichnis, { recursive: true });
  for (const [id, inhalt] of Object.entries(blobs)) {
    fs.writeFileSync(path.join(blobVerzeichnis, `${id}.json`), JSON.stringify(inhalt), 'utf-8');
  }
  return { dbPfad, blobVerzeichnis };
}

/**
 * Hand-rolled supabase client mock: records every call, answers counts from
 * an in-memory `records` table. NO network — assert() checks the call log.
 * @param {{ orgId: string }} setup the org the mock "contains"
 * @returns {object} client mock with a `.rufe` log and `.tabelle` rows
 */
function clientMock(setup = {}) {
  const tabelle = []; // rows inserted/upserted via the mock
  const rufe = []; // ['upsert', entity, count] / ['upload', path] / ['count', entity] / ['list', prefix]
  const orgId = setup.orgId || '11111111-2222-3333-4444-555555555555';
  const from = (t) => ({
    select: (_cols, opts) => ({
      eq: (col, val) => ({
        eq: (col2, val2) => {
          rufe.push(['count', val2]);
          const count = tabelle.filter((r) => r[col] === val && r[col2] === val2).length;
          return Promise.resolve(opts?.head ? { count, error: null } : { data: [], count, error: null });
        },
      }),
    }),
    upsert: (rows, opts) => {
      rufe.push(['upsert', rows[0]?.entity, rows.length]);
      if (opts?.onConflict !== 'id') {
        return Promise.resolve({ error: { message: `onConflict fehlt: ${JSON.stringify(opts)}` } });
      }
      for (const row of rows) {
        const idx = tabelle.findIndex((r) => r.id === row.id);
        if (idx >= 0) tabelle[idx] = row; // upsert semantics
        else tabelle.push(row);
      }
      return Promise.resolve({ error: null });
    },
  });
  const storageFrom = () => ({
    upload: (pfad, _bytes, opts) => {
      rufe.push(['upload', pfad]);
      if (!opts?.upsert) return Promise.resolve({ error: { message: 'upsert flag fehlt' } });
      return Promise.resolve({ error: null });
    },
    list: (prefix) => {
      rufe.push(['list', prefix]);
      // Answer with the uploads that went to this org prefix.
      const daten = rufe
        .filter((r) => r[0] === 'upload' && r[1].startsWith(`${prefix}/`))
        .map((r) => ({ name: r[1].slice(prefix.length + 1) }));
      return Promise.resolve({ data: daten, error: null });
    },
  });
  return {
    rufe,
    tabelle,
    orgId,
    from,
    storage: { from: storageFrom },
  };
}

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-import-test-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- leseDbJson ---------------------------------------------------------------

describe('leseDbJson — db.json lesen und validieren', () => {
  it('liest 3 Entitäten in Datei-Reihenfolge und zählt insgesamt', () => {
    const { dbPfad } = fixture({
      Project: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      Contact: [{ id: 'c1', name: 'X' }],
      Document: [],
    });
    const { entitaeten, gesamt } = leseDbJson(dbPfad);
    assert.deepEqual(entitaeten.map((e) => e.name), ['Project', 'Contact', 'Document']);
    assert.equal(gesamt, 3);
    assert.equal(entitaeten[2].zeilen.length, 0); // empty collection stays visible
  });

  it('Zeile ohne id → Klartext-Fehler, der die Entität nennt', () => {
    const { dbPfad } = fixture({
      Project: [{ id: 'p1' }],
      Contact: [{ name: 'ohne id' }],
    });
    assert.throws(
      () => leseDbJson(dbPfad),
      (err) => {
        assert.match(err.message, /ohne id|Datensatz ohne id/);
        assert.match(err.message, /Contact/); // the entity is named
        assert.match(err.message, /Querverweise/); // why it matters is stated
        return true;
      }
    );
  });

  it('unlesbare Datei → Klartext-Fehler mit Pfad', () => {
    const dbPfad = path.join(tmpDir, 'kaputt.json');
    fs.writeFileSync(dbPfad, '{ kein json', 'utf-8');
    assert.throws(() => leseDbJson(dbPfad), /unlesbar/);
    assert.throws(() => leseDbJson(path.join(tmpDir, 'gibt-es-nicht.json')), /unlesbar/);
  });

  // Plan 80-02 (D-P80-A #5): eine Personal-Entität darf nie in die
  // Cloud-Tabelle `records` gelangen (vor Phase 74 ohne Organisations-Allowlist).
  it('Personal-Entität in der Datei → Klartext-Fehler „Personal-Entität … bleibt lokal", Import bricht ab', () => {
    const { dbPfad } = fixture({
      Project: [],
      Mitarbeiter: [{ id: 'm1' }],
    });
    assert.throws(
      () => leseDbJson(dbPfad),
      (err) => {
        assert.match(err.message, /Personal-Entität/);
        assert.match(err.message, /bleibt lokal/);
        assert.match(err.message, /Mitarbeiter/);
        return true;
      }
    );
  });
});

// --- inBatches ----------------------------------------------------------------

describe('inBatches — 500er-Batches', () => {
  it('1.201 Zeilen → 3 Batches (500/500/201)', () => {
    const liste = Array.from({ length: 1201 }, (_, i) => ({ id: `r${i}` }));
    const batches = inBatches(liste, 500);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches.map((b) => b.length), [500, 500, 201]);
    // Order preserved across batches.
    assert.equal(batches[0][0].id, 'r0');
    assert.equal(batches[2][200].id, 'r1200');
  });

  it('leere Liste → keine Batches; exakte Größe → 1 Batch', () => {
    assert.deepEqual(inBatches([]), []);
    assert.equal(inBatches(new Array(500).fill(0), 500).length, 1);
  });
});

// --- blobIdsPruefen -------------------------------------------------------------

describe('blobIdsPruefen — dieselbe Whitelist wie blobs.js', () => {
  it('teilt gültige und ungültige Namen', () => {
    const { gueltig, ungueltig } = blobIdsPruefen([
      'bauteile_2024-01', 'Aa1_-ok', 'pfad/traversal', 'mit punkt', '', 'auch;schlecht',
    ]);
    assert.deepEqual(gueltig, ['bauteile_2024-01', 'Aa1_-ok']);
    assert.deepEqual(ungueltig, ['pfad/traversal', 'mit punkt', '', 'auch;schlecht']);
  });
});

// --- zeileAusDatensatz (abfrage.js — die EINE Abbildung) -----------------------

describe('zeileAusDatensatz — Datensatz → records-Zeile', () => {
  const ORG = '11111111-2222-3333-4444-555555555555';

  it('behält id, entity, org_id; Zeitstempel fliegen aus data', () => {
    const zeile = zeileAusDatensatz('Project', ORG, {
      id: 'p1',
      created_date: '2026-09-01T00:00:00.000Z',
      updated_date: '2026-09-02T00:00:00.000Z',
      name: 'Referenzprojekt',
      project_id: null,
    });
    assert.equal(zeile.id, 'p1'); // id preserved verbatim (cross-references!)
    assert.equal(zeile.entity, 'Project');
    assert.equal(zeile.org_id, ORG);
    assert.deepEqual(zeile.data, { name: 'Referenzprojekt', project_id: null });
    assert.ok(!('created_date' in zeile.data), 'created_date gehört nicht ins jsonb');
    assert.ok(!('updated_date' in zeile.data), 'updated_date gehört nicht ins jsonb');
    assert.ok(!('id' in zeile.data), 'id gehört nicht ins jsonb (echte Spalte)');
  });

  it('ohne id → neueId() im db.js-Format; Felder bleiben erhalten', () => {
    const zeile = zeileAusDatensatz('Issue', ORG, { titel: 'Riss' });
    assert.match(zeile.id, /^[0-9a-z]{6,}$/, 'id wie db.js: base36-Timestamp + Suffix');
    assert.deepEqual(zeile.data, { titel: 'Riss' });
  });

  it('neueId erzeugt zwei verschiedene Ids', () => {
    assert.notEqual(neueId(), neueId());
  });

  it('ändert den Eingabe-Datensatz NICHT (keine Mutation)', () => {
    const datensatz = { id: 'p1', name: 'X', created_date: 'c', updated_date: 'u' };
    zeileAusDatensatz('Project', ORG, datensatz);
    assert.deepEqual(datensatz, { id: 'p1', name: 'X', created_date: 'c', updated_date: 'u' });
  });
});

// --- importiere() gegen den Mock -------------------------------------------------

describe('importiere — Ablauf gegen gemockten Client', () => {
  const ORG = '11111111-2222-3333-4444-555555555555';

  /** Small 3-entity db + 2 blobs for the end-to-end mock runs. */
  function miniDb() {
    return {
      entitaeten: [
        { name: 'Project', zeilen: [{ id: 'p1', name: 'A', created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-02T00:00:00.000Z' }] },
        { name: 'Contact', zeilen: [{ id: 'c1', name: 'X' }] },
        { name: 'Document', zeilen: [] },
      ],
      gesamt: 2,
    };
  }

  it('Dry-Run: KEINE Schreibvorgänge, nur Counts', async () => {
    const { blobVerzeichnis } = fixture({}, { blob1: { a: 1 }, blob2: { b: 2 } });
    const client = clientMock({ orgId: ORG });
    const bericht = await importiere(client, {
      orgId: ORG, dryRun: true, db: miniDb(), blobVerzeichnis,
    });
    const writes = client.rufe.filter((r) => r[0] === 'upsert' || r[0] === 'upload');
    assert.deepEqual(writes, [], 'Dry-Run darf nie schreiben');
    assert.ok(client.rufe.some((r) => r[0] === 'count'), 'Verbindungstest = select count');
    assert.equal(bericht.blobs.lokal, 2);
    assert.equal(bericht.erfolge, true);
  });

  it('echter Lauf: Upsert mit onConflict id, Zeitstempel als Spalten, Blobs unter <org>/<id>.json', async () => {
    const { blobVerzeichnis } = fixture({}, { blob1: { a: 1 } });
    const client = clientMock({ orgId: ORG });
    const bericht = await importiere(client, {
      orgId: ORG, dryRun: false, db: miniDb(), blobVerzeichnis,
    });
    assert.equal(bericht.erfolge, true);
    assert.equal(bericht.abweichungen, 0);
    // Rows arrived with preserved ids and lifted timestamps.
    const p1 = client.tabelle.find((r) => r.id === 'p1');
    assert.ok(p1, 'p1 upserted');
    assert.equal(p1.org_id, ORG);
    assert.equal(p1.entity, 'Project');
    assert.equal(p1.created_date, '2026-01-01T00:00:00.000Z'); // original kept
    assert.deepEqual(p1.data, { name: 'A' });
    // Blob path convention <org_id>/<id>.json (0003 storage policy).
    assert.ok(client.rufe.some((r) => r[0] === 'upload' && r[1] === `${ORG}/blob1.json`));
    assert.equal(bericht.blobs.storage, 1);
  });

  it('Wiederholbarkeit: zweiter Lauf upsertet dieselben ids (keine Duplikate)', async () => {
    const { blobVerzeichnis } = fixture({}, {});
    const client = clientMock({ orgId: ORG });
    const db = miniDb();
    await importiere(client, { orgId: ORG, dryRun: false, db, blobVerzeichnis });
    const bericht2 = await importiere(client, { orgId: ORG, dryRun: false, db, blobVerzeichnis });
    assert.equal(bericht2.abweichungen, 0, 'Zählung bleibt gleich — upsert statt insert');
    assert.equal(client.tabelle.filter((r) => r.id === 'p1').length, 1);
  });

  it('ungültiger Blob-Name → Klartext-Fehler VOR jedem Schreibvorgang', async () => {
    const { blobVerzeichnis } = fixture({}, {});
    fs.writeFileSync(path.join(blobVerzeichnis, 'schlechter name.json'), '{}', 'utf-8');
    const client = clientMock({ orgId: ORG });
    await assert.rejects(
      () => importiere(client, { orgId: ORG, dryRun: false, db: miniDb(), blobVerzeichnis }),
      /Ungültige Blob-Namen/
    );
    const writes = client.rufe.filter((r) => r[0] === 'upsert' || r[0] === 'upload');
    assert.deepEqual(writes, [], 'bei Namensfehler darf nichts geschrieben sein');
  });

  it('Upsert-Fehler kommt als Klartext durch (kein stilles catch)', async () => {
    const { blobVerzeichnis } = fixture({}, {});
    const client = clientMock({ orgId: ORG });
    client.from = () => ({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }),
      upsert: () => Promise.resolve({ error: { message: 'permission denied (Mock)' } }),
    });
    await assert.rejects(
      () => importiere(client, { orgId: ORG, dryRun: false, db: miniDb(), blobVerzeichnis }),
      /permission denied \(Mock\)/
    );
  });
});
