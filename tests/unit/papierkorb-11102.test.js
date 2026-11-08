// papierkorb-11102.test.js — the recycle bin of plan 111-02 (finding K-07) on a real createDb() store in a temp file:
// moving a record in (copy with time, reason, origin, then removed from its collection), restoring it with the same id and fields,
// refusing a restore onto an occupied id (409, nothing overwritten), the cleanup after 90 days (clock injected), the locks of the
// generic CRUD (the bin is read-only there; locked and person-only entities stay refused) and the HTTP routes with the real
// entitiesRouter in front. Neutral test data only; never server/db.json.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createDb } from '../../packages/nova-core/server/db.js';
import { entitiesRouter, GESPERRT_TEXT, NUR_PERSON_TEXT } from '../../packages/nova-core/server/routes.js';
import {
  AUFBEWAHRUNG_TAGE, PAPIERKORB_ENTITY, PAPIERKORB_GESPERRT_TEXT, ausPapierkorb, inPapierkorb, papierkorbAufraeumen, papierkorbListe,
  papierkorbRouter, papierkorbSperre,
} from '../../packages/nova-core/server/papierkorbRouter.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'papierkorb-11102-'));
let n = 0;
/** A fresh store in its own temp file. */
const neueDb = () => createDb(path.join(TMP, `db-${n += 1}.json`));
after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp folder */ } });

const TAG_MS = 24 * 60 * 60 * 1000;

describe('111-02 Papierkorb — store functions', () => {
  it('moves a record in: copy with time, reason and origin, then gone from its collection', () => {
    const db = neueDb();
    const k = db.create('Contact', { name: 'Kontakt Muster', project_id: 'tp-a' });
    const jetzt = new Date('2026-11-08T12:00:00.000Z');
    const r = inPapierkorb(db, 'Contact', k.id, { grund: '  doppelt  ', herkunft: 'mcp', jetzt });
    assert.equal(r.ok, true);
    assert.equal(r.status, 201);
    assert.equal(db.get('Contact', k.id), null, 'no longer in its collection');
    const e = db.list(PAPIERKORB_ENTITY)[0];
    assert.deepEqual({ entity: e.entity, record_id: e.record_id, project_id: e.project_id, geloescht_am: e.geloescht_am, grund: e.grund, herkunft: e.herkunft },
      { entity: 'Contact', record_id: k.id, project_id: 'tp-a', geloescht_am: jetzt.toISOString(), grund: 'doppelt', herkunft: 'mcp' });
    assert.deepEqual(e.datensatz, k, 'the record as it was stored');
  });

  it('restores with the same id and fields; the entry leaves the bin', () => {
    const db = neueDb();
    const k = db.create('Contact', { name: 'Kontakt Muster', rolle: 'Bauphysik', project_id: 'tp-a' });
    const { eintrag } = /** @type {any} */ (inPapierkorb(db, 'Contact', k.id, { herkunft: 'app' }));
    const r = /** @type {any} */ (ausPapierkorb(db, eintrag.id));
    assert.equal(r.ok, true);
    assert.equal(r.entity, 'Contact');
    assert.deepEqual(db.get('Contact', k.id), k, 'same id, same fields (dates included)');
    assert.equal(db.list('Contact').length, 1);
    assert.equal(db.list(PAPIERKORB_ENTITY).length, 0);
  });

  it('an occupied id is "nicht übernommen" (409): nothing overwritten, the entry stays', () => {
    const db = neueDb();
    const k = db.create('Contact', { name: 'Kontakt Muster' });
    const { eintrag } = /** @type {any} */ (inPapierkorb(db, 'Contact', k.id, { herkunft: 'mcp' }));
    db.create('Contact', { id: k.id, name: 'Anderer Kontakt' }); // the id came back meanwhile (db.create takes a given id, B-111-02-01)
    const r = /** @type {any} */ (ausPapierkorb(db, eintrag.id));
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.fehler, /^nicht übernommen: die id .* wieder belegt/);
    assert.equal(db.get('Contact', k.id).name, 'Anderer Kontakt');
    assert.equal(db.list(PAPIERKORB_ENTITY).length, 1);
  });

  it('refuses unknown records, unknown origins, locked and person-only entities and the bin itself', () => {
    const db = neueDb();
    assert.equal(inPapierkorb(db, 'Contact', 'gibts-nicht', { herkunft: 'mcp' }).status, 404);
    const k = db.create('Contact', { name: 'x' });
    assert.equal(inPapierkorb(db, 'Contact', k.id, { herkunft: 'jemand' }).status, 400);
    assert.deepEqual(inPapierkorb(db, 'llmconnection', 'a', { herkunft: 'mcp' }), { ok: false, status: 403, fehler: GESPERRT_TEXT.llm });
    assert.deepEqual(inPapierkorb(db, 'Mitarbeiter', 'a', { herkunft: 'mcp' }), { ok: false, status: 403, fehler: GESPERRT_TEXT.personal });
    assert.deepEqual(inPapierkorb(db, 'AenderungsSchritt', 'a', { herkunft: 'mcp' }), { ok: false, status: 403, fehler: NUR_PERSON_TEXT });
    assert.equal(inPapierkorb(db, 'papierkorb', 'a', { herkunft: 'mcp' }).status, 400);
    assert.equal(inPapierkorb(db, '../x', 'a', { herkunft: 'mcp' }).status, 400);
    assert.equal(ausPapierkorb(db, 'gibts-nicht').status, 404);
  });

  it(`cleans up entries older than ${AUFBEWAHRUNG_TAGE} days (clock injected); undatable entries stay; no empty bin is created`, () => {
    const db = neueDb();
    assert.equal(papierkorbAufraeumen(db), 0);
    assert.ok(!(PAPIERKORB_ENTITY in db._raw()), 'a store that never deleted keeps no Papierkorb collection');
    const jetzt = new Date('2026-11-08T12:00:00.000Z');
    for (const [name, tage] of [['alt', AUFBEWAHRUNG_TAGE + 1], ['grenze', AUFBEWAHRUNG_TAGE - 1], ['neu', 0]]) {
      const k = db.create('Contact', { name });
      inPapierkorb(db, 'Contact', k.id, { herkunft: 'app', jetzt: new Date(jetzt.getTime() - Number(tage) * TAG_MS) });
    }
    db.create(PAPIERKORB_ENTITY, { entity: 'Contact', record_id: 'q', geloescht_am: 'kaputt', datensatz: { id: 'q' } });
    assert.equal(papierkorbAufraeumen(db, jetzt), 1);
    assert.deepEqual(papierkorbListe(db, {}, jetzt).map((e) => e.datensatz.name ?? e.geloescht_am).sort(), ['grenze', 'kaputt', 'neu']);
  });

  it('lists newest first, filtered by entity and project', () => {
    const db = neueDb();
    const t = (h) => new Date(`2026-11-08T${h}:00:00.000Z`);
    const a = db.create('Contact', { name: 'a', project_id: 'tp-a' });
    const b = db.create('Notiz', { text: 'b', project_id: 'tp-b' });
    const c = db.create('Contact', { name: 'c', project_id: 'tp-b' });
    inPapierkorb(db, 'Contact', a.id, { herkunft: 'mcp', jetzt: t('09') });
    inPapierkorb(db, 'Notiz', b.id, { herkunft: 'mcp', jetzt: t('10') });
    inPapierkorb(db, 'Contact', c.id, { herkunft: 'mcp', jetzt: t('11') });
    const jetzt = t('12');
    assert.deepEqual(papierkorbListe(db, {}, jetzt).map((e) => e.record_id), [c.id, b.id, a.id]);
    assert.deepEqual(papierkorbListe(db, { entity: 'Contact' }, jetzt).map((e) => e.record_id), [c.id, a.id]);
    assert.deepEqual(papierkorbListe(db, { project_id: 'tp-b' }, jetzt).map((e) => e.record_id), [c.id, b.id]);
  });
});

describe('111-02 Papierkorb — HTTP routes next to the generic CRUD', () => {
  /** Real routers on a free port; `jetzt` is the injected clock. */
  async function mitServer(fn, jetzt = () => new Date()) {
    const db = neueDb();
    const gemeldet = [];
    const app = express();
    app.use(express.json());
    app.use('/api', papierkorbSperre());
    app.use('/api', entitiesRouter(db));
    app.use('/api', papierkorbRouter(db, { jetzt, nachAenderung: (w) => gemeldet.push(`${w.methode} ${w.entitaet} ${w.id}`) }));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const basis = `http://127.0.0.1:${server.address().port}/api`;
    const rufe = async (pfad, methode = 'GET', body) => {
      const res = await fetch(basis + pfad, { method: methode, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    try { await fn({ db, rufe, gemeldet }); } finally { await new Promise((r) => server.close(r)); }
  }

  it('the generic CRUD reads the bin but never writes it, in any spelling', async () => {
    await mitServer(async ({ db, rufe }) => {
      const k = db.create('Contact', { name: 'Kontakt Muster' });
      inPapierkorb(db, 'Contact', k.id, { herkunft: 'app' });
      assert.equal((await rufe('/entities/Papierkorb')).json.length, 1, 'readable');
      for (const [pfad, methode] of [['/entities/Papierkorb', 'POST'], ['/entities/papierkorb', 'POST'], ['/entities/Papier%6Borb', 'POST'],
        ['/entities/Papierkorb/bulk', 'POST'], ['/entities/Papierkorb/bulk', 'PUT'], [`/entities/Papierkorb/${db.list(PAPIERKORB_ENTITY)[0].id}`, 'PUT'],
        [`/entities/Papierkorb/${db.list(PAPIERKORB_ENTITY)[0].id}`, 'DELETE']]) {
        const r = await rufe(pfad, methode, methode === 'DELETE' ? undefined : { records: [{ x: 1 }], x: 1 });
        assert.equal(r.status, 403, `${methode} ${pfad}`);
        assert.equal(r.json.error, PAPIERKORB_GESPERRT_TEXT);
      }
      assert.equal(db.list(PAPIERKORB_ENTITY).length, 1, 'nothing added, changed or removed');
      // the generic CRUD of other entities behaves as before
      assert.equal((await rufe('/entities/Contact', 'POST', { name: 'Kontakt Zwei' })).status, 201);
    });
  });

  it('POST in, GET list, POST wiederherstellen; 409 on an occupied id; the change hook is called', async () => {
    await mitServer(async ({ db, rufe, gemeldet }) => {
      const k = db.create('Contact', { name: 'Kontakt Muster', project_id: 'tp-a' });
      const rein = await rufe(`/papierkorb/Contact/${k.id}`, 'POST', { grund: 'Probe', herkunft: 'mcp' });
      assert.equal(rein.status, 201);
      assert.equal(rein.json.record_id, k.id);
      assert.equal((await rufe(`/entities/Contact/${k.id}`)).status, 404);
      const liste = await rufe('/papierkorb?entity=Contact&project_id=tp-a');
      assert.deepEqual(liste.json.map((e) => e.id), [rein.json.id]);
      assert.equal((await rufe(`/papierkorb/Contact/${k.id}`, 'POST', { herkunft: 'mcp' })).status, 404, 'already in the bin');
      const zurueck = await rufe(`/papierkorb/${rein.json.id}/wiederherstellen`, 'POST', {});
      assert.equal(zurueck.status, 200);
      assert.deepEqual(zurueck.json.datensatz, k);
      assert.deepEqual(gemeldet, [`DELETE Contact ${k.id}`, `POST Contact ${k.id}`]);

      const rein2 = await rufe(`/papierkorb/Contact/${k.id}`, 'POST', { herkunft: 'app' });
      db.create('Contact', { id: k.id, name: 'belegt' });
      const nein = await rufe(`/papierkorb/${rein2.json.id}/wiederherstellen`, 'POST', {});
      assert.equal(nein.status, 409);
      assert.equal(nein.json.uebernommen, false);
      assert.match(nein.json.error, /nicht übernommen/);
      assert.equal(db.get('Contact', k.id).name, 'belegt');
    });
  });

  it('locked and person-only entities: the same 403 texts as the generic CRUD', async () => {
    await mitServer(async ({ rufe }) => {
      assert.deepEqual(await rufe('/papierkorb/LlmConnection/x', 'POST', { herkunft: 'mcp' }), { status: 403, json: { error: GESPERRT_TEXT.llm } });
      assert.deepEqual(await rufe('/papierkorb/KiEinstellung/x', 'POST', { herkunft: 'mcp' }), { status: 403, json: { error: GESPERRT_TEXT.ki } });
      assert.deepEqual(await rufe('/papierkorb/Befehlsvorlage/x', 'POST', { herkunft: 'mcp' }), { status: 403, json: { error: NUR_PERSON_TEXT } });
    });
  });

  it('review 111-02: a stale stand refuses the delete (409, nothing moves); an unknown entity leaves no empty collection', async () => {
    await mitServer(async ({ db, rufe }) => {
      const k = db.create('Kontakt', { name: 'Kontakt Muster' });
      const alt = '2000-01-01T00:00:00.000Z';
      const r = await rufe(`/papierkorb/Kontakt/${k.id}?stand=${encodeURIComponent(alt)}`, 'POST', { herkunft: 'mcp' });
      assert.equal(r.status, 409);
      assert.ok(db.get('Kontakt', k.id), 'record still there');
      const ok = await rufe(`/papierkorb/Kontakt/${k.id}?stand=${encodeURIComponent(k.updated_date)}`, 'POST', { herkunft: 'mcp' });
      assert.equal(ok.status, 201);
      const tipp = await rufe('/papierkorb/Kontackt/x1', 'POST', { herkunft: 'mcp' });
      assert.equal(tipp.status, 404);
      assert.equal(Array.isArray(db._raw().Kontackt), false, 'no empty collection for a typo');
    });
  });

  it('the list cleans up before it answers (clock of the router)', async () => {
    let uhr = new Date('2026-11-08T12:00:00.000Z');
    await mitServer(async ({ db, rufe }) => {
      const k = db.create('Contact', { name: 'alt' });
      assert.equal((await rufe(`/papierkorb/Contact/${k.id}`, 'POST', { herkunft: 'mcp' })).status, 201);
      assert.equal((await rufe('/papierkorb')).json.length, 1);
      uhr = new Date(uhr.getTime() + (AUFBEWAHRUNG_TAGE + 1) * TAG_MS);
      assert.equal((await rufe('/papierkorb')).json.length, 0);
    }, () => uhr);
  });
});
