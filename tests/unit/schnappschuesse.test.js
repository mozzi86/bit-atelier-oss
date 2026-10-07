// Phase 69-13: snapshot ring. Plan requires ≥ 6 tests: ring overflow (6th
// displaces 1st), restore = round-trip through parseProjektDatei, snapshot
// before reset, plain-text error on full storage.
//
// Storage is injected into BOTH modules (demoDb and schnappschuesse) — one
// fake, no browser. The fake mirrors demoIdb: entities() hides the snapshot
// store, so snapshots never enter the project cache/export.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setzeSpeicher,
  demoDb,
  demoDbAuslesen,
  demoDbZuruecksetzen,
} from '@core/api/demoDb.js';
import {
  schnappschussAnlegen,
  schnappschuesseListe,
  schnappschussWiederherstellen,
  setzeSchnappschussSpeicher,
  RING_GROESSE,
  SCHNAPP_STORE,
} from '@core/api/schnappschuesse.js';
import { parseProjektDatei, serialisiereProjekt } from '@core/api/projektDatei.js';

const SEED = { Project: [{ id: 'p-seed', name: 'Seed-Projekt' }], Contact: [] };

/** In-memory adapter shaped like demoIdb (entities() hides the snapshot store). */
function fake(start = {}) {
  const daten = structuredClone(start);
  let quotaAb = null; // entity whose writes fail with SpeicherVollError
  return {
    daten,
    quotaAbBei(entity) { quotaAb = entity; },
    async entities() {
      return Object.keys(daten).filter((n) => n !== '_meta' && n !== SCHNAPP_STORE);
    },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben(entity, datensatz) {
      if (quotaAb === entity) {
        const e = new Error(`Speicher voll — Schreibvorgang auf "${entity}" abgelehnt`);
        e.name = 'SpeicherVollError';
        throw e;
      }
      daten[entity] = daten[entity] || [];
      const i = daten[entity].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[entity].push(structuredClone(datensatz));
      else daten[entity][i] = structuredClone(datensatz);
    },
    async schreibeViele(entity, datensaetze) { daten[entity] = structuredClone(datensaetze); },
    async loeschen(entity, recordId) {
      daten[entity] = (daten[entity] || []).filter((r) => r.id !== recordId);
    },
    async leeren(entity) { delete daten[entity]; },
    async meta() { return null; },
  };
}

let speicher;
beforeEach(() => {
  speicher = fake(SEED);
  // One fake for both modules (demoDb deliberately does not forward — cycle).
  setzeSpeicher(speicher, async () => structuredClone(SEED));
  setzeSchnappschussSpeicher(speicher);
});

describe('schnappschuesse.js — Ring', () => {
  it('RING_GROESSE ist 5; der 6. Schnappschuss verdrängt den ältesten', async () => {
    for (let i = 0; i < 6; i += 1) {
      await demoDb.create('Project', { name: `P${i}` });
      await schnappschussAnlegen(`Grund ${i}`);
      await new Promise((r) => setTimeout(r, 2)); // strictly distinct zeit values
    }
    const liste = await schnappschuesseListe();
    assert.equal(liste.length, RING_GROESSE);
    assert.equal(liste.length, 5);
    const gründe = liste.map((s) => s.grund);
    assert.equal(gründe.includes('Grund 0'), false, 'ältester verdrängt');
    assert.equal(gründe.includes('Grund 5'), true, 'neuester bleibt');
  });

  it('Liste ist neueste zuerst und trägt Zeit + Datensatzzahl', async () => {
    await demoDb.create('Project', { name: 'A' });
    const erster = await schnappschussAnlegen('erster');
    await new Promise((r) => setTimeout(r, 5)); // distinct zeit
    const zweiter = await schnappschussAnlegen('zweiter');
    const liste = await schnappschuesseListe();
    assert.equal(liste[0].id, zweiter.id);
    assert.equal(liste[1].id, erster.id);
    assert.ok(liste[0].zeit >= liste[1].zeit);
    // SEED has 1 project record; after one create it is 2.
    assert.equal(erster.datensaetze, 2);
    assert.equal(zweiter.datensaetze, 2);
  });
});

describe('schnappschuesse.js — Snapshot vor Reset (must-have 1)', () => {
  it('demoDbZuruecksetzen legt VORHER einen Schnappschuss „vor Reset" an, der den eigenen Datensatz enthält', async () => {
    const neu = await demoDb.create('Project', { name: 'Meine Arbeit' });
    const vorReset = (await demoDbAuslesen()).Project.length;
    assert.equal(vorReset, 2, 'Seed + eigener Datensatz');

    await demoDbZuruecksetzen();

    // After reset the db is the seed again...
    const nachReset = await demoDbAuslesen();
    assert.equal(nachReset.Project.length, 1);
    assert.equal(nachReset.Project[0].id, 'p-seed');

    // ...and the snapshot holds the PREVIOUS state with the visitor's record.
    const liste = await schnappschuesseListe();
    assert.equal(liste.length, 1);
    assert.equal(liste[0].grund, 'vor Reset');
    assert.equal(liste[0].datensaetze, vorReset);
    assert.ok(
      liste[0].projekt.daten.Project.some((p) => p.id === neu.id),
      'eigener Datensatz im Schnappschuss',
    );
  });

  it('ein fehlgeschlagener Schnappschuss (Quota) bricht den Reset NICHT ab, meldet aber im Klartext', async () => {
    await demoDb.create('Project', { name: 'X' });
    speicher.quotaAbBei(SCHNAPP_STORE);
    const r = await demoDbZuruecksetzen();
    // The destructive action still ran (user confirmed it)...
    const nachReset = await demoDbAuslesen();
    assert.equal(nachReset.Project.length, 1);
    // ...and the failure is visible in plain text, not swallowed.
    assert.equal(r.schnappschuss, null);
    assert.ok(r.schnappschussFehler.includes('Speicher voll'), r.schnappschussFehler);
  });
});

describe('schnappschuesse.js — Wiederherstellen (must-have 2)', () => {
  it('Round-Trip: wiederhergestellter Stand == Stand vor dem Reset; parseProjektDatei akzeptiert das Format', async () => {
    const neu = await demoDb.create('Project', { name: 'Meine Arbeit' });
    await demoDb.create('Contact', { name: 'Kundin' });
    const vorReset = await demoDbAuslesen();

    await demoDbZuruecksetzen(); // schnappschuss „vor Reset"
    const snap = (await schnappschuesseListe())[0];

    // The snapshot's `projekt` is a real project file (schema 1) — the SAME
    // format the export uses, verified through the export parser.
    const bytes = new TextEncoder().encode(JSON.stringify(snap.projekt));
    const geparst = await parseProjektDatei(bytes);
    assert.equal(geparst.schema, serialisiereProjekt({}).schema);

    const { wiederhergestellt, sicherungsId } = await schnappschussWiederherstellen(snap.id);
    assert.equal(wiederhergestellt.id, snap.id);

    const jetzt = await demoDbAuslesen();
    assert.deepEqual(jetzt.Project, vorReset.Project);
    assert.deepEqual(jetzt.Contact, vorReset.Contact);
    assert.ok(jetzt.Project.some((p) => p.id === neu.id));

    // The restore itself snapshotted the (reset) state first — way back BOTH ways.
    const liste = await schnappschuesseListe();
    assert.equal(liste.length, 2);
    assert.equal(liste[0].grund, 'vor Wiederherstellung');
    assert.equal(liste[0].id, sicherungsId);
    assert.equal(liste[0].projekt.daten.Project.length, 1, 'Reset-Stand gesichert');
  });

  it('unbekannte Id → Fehler im Klartext, keine Änderung', async () => {
    await assert.rejects(() => schnappschussWiederherstellen('gibt-es-nicht'), /nicht gefunden/);
  });

  it('Wiederherstellen überschreibt NICHT den Ring: aktuellster Stand wird selbst zum Schnappschuss', async () => {
    await demoDb.create('Project', { name: 'A' });
    await schnappschussAnlegen('manuell');
    const snap = (await schnappschuesseListe())[0];
    await demoDb.create('Project', { name: 'B' }); // current state != snapshot
    await schnappschussWiederherstellen(snap.id);
    const jetzt = await demoDbAuslesen();
    assert.equal(jetzt.Project.some((p) => p.name === 'B'), false, 'B weg (wiederhergestellt)');
    const liste = await schnappschuesseListe();
    assert.equal(liste[0].grund, 'vor Wiederherstellung');
    assert.ok(liste[0].projekt.daten.Project.some((p) => p.name === 'B'), 'B im Sicherungs-Schnappschuss');
  });
});

describe('schnappschuesse.js — Quota-Opfer', () => {
  it('voller Speicher: ältester Schnappschuss wird geopfert, dann gelingt das Schreiben', async () => {
    for (let i = 0; i < 5; i += 1) {
      await schnappschussAnlegen(`S${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    // Fail the FIRST write attempt only (quota), then let the retry through.
    let versuche = 0;
    const originalSchreiben = speicher.schreiben.bind(speicher);
    speicher.schreiben = async (entity, ds) => {
      if (entity === SCHNAPP_STORE && versuche === 0) {
        versuche += 1;
        const e = new Error('Speicher voll');
        e.name = 'SpeicherVollError';
        throw e;
      }
      return originalSchreiben(entity, ds);
    };
    const neu = await schnappschussAnlegen('S5');
    const liste = await schnappschuesseListe();
    assert.equal(liste.length, RING_GROESSE);
    assert.ok(liste.some((s) => s.id === neu.id));
    assert.equal(liste.some((s) => s.grund === 'S0'), false, 'ältestes Opfer');
  });
});
