// Phase 65-02: the demo database moved from one localStorage JSON blob to
// IndexedDB with one row per record. These tests pin the FACADE CONTRACT first
// (it must keep mirroring server/db.js exactly), then the three things the move
// could break: per-record writes, the one-time migration of an existing blob,
// and a quota failure staying visible instead of being swallowed.
//
// Storage is injected, so nothing here needs a browser.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  demoDb,
  demoDbAuslesen,
  demoDbErsetzen,
  demoDbZuruecksetzen,
  setzeSpeicher,
  sicherungFaellig,
  letzteSicherungSetzen,
  letzteSicherungLesen,
} from '@core/api/demoDb.js';

/** Records the calls so a test can assert a write touched ONE row. */
function speicherAttrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  const rufe = [];
  let quotaAb = null; // Entity, deren Schreibvorgang scheitern soll
  return {
    rufe,
    daten,
    metaWerte,
    quotaAbBei(entity) {
      quotaAb = entity;
    },
    async entities() {
      return Object.keys(daten);
    },
    async alle(entity) {
      return structuredClone(daten[entity] || []);
    },
    async schreiben(entity, datensatz) {
      rufe.push(['schreiben', entity, datensatz.id]);
      if (quotaAb === entity) {
        const e = new Error('Speicher voll');
        e.name = 'SpeicherVollError';
        throw e;
      }
      daten[entity] = daten[entity] || [];
      const i = daten[entity].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[entity].push(structuredClone(datensatz));
      else daten[entity][i] = structuredClone(datensatz);
    },
    async schreibeViele(entity, datensaetze) {
      rufe.push(['schreibeViele', entity, datensaetze.length]);
      daten[entity] = structuredClone(datensaetze);
    },
    async loeschen(entity, recordId) {
      rufe.push(['loeschen', entity, recordId]);
      daten[entity] = (daten[entity] || []).filter((r) => r.id !== recordId);
    },
    async leeren(entity) {
      rufe.push(['leeren', entity]);
      delete daten[entity];
    },
    async meta(key, wert) {
      if (arguments.length === 1) return metaWerte[key];
      metaWerte[key] = wert;
      return wert;
    },
  };
}

const SEED = {
  Project: [
    { id: 'p1', name: 'Alpha', status: 'aktiv', created_date: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: 'Beta', status: 'ruht', created_date: '2026-02-01T00:00:00.000Z' },
  ],
  Contact: [{ id: 'c1', name: 'Muster', project_id: 'p1' }],
};

/** localStorage stub — the migration path reads and clears the legacy key. */
function lagerAttrappe(start = {}) {
  const werte = { ...start };
  return {
    getItem: (k) => (k in werte ? werte[k] : null),
    setItem: (k, v) => {
      werte[k] = String(v);
    },
    removeItem: (k) => {
      delete werte[k];
    },
    _werte: werte,
  };
}

let alterLocalStorage;

beforeEach(() => {
  alterLocalStorage = globalThis.localStorage;
});

afterEach(() => {
  if (alterLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = alterLocalStorage;
});

describe('demoDb — Fassaden-Vertrag (spiegelt server/db.js)', () => {
  let speicher;
  beforeEach(() => {
    speicher = speicherAttrappe(SEED);
    setzeSpeicher(speicher, async () => structuredClone(SEED));
  });

  it('list liefert alle Datensätze der Sammlung', async () => {
    const rows = await demoDb.list('Project');
    assert.equal(rows.length, 2);
  });

  it('sort "-feld" absteigend, "feld" aufsteigend', async () => {
    const auf = await demoDb.list('Project', 'name');
    assert.deepEqual(auf.map((r) => r.name), ['Alpha', 'Beta']);
    const ab = await demoDb.list('Project', '-name');
    assert.deepEqual(ab.map((r) => r.name), ['Beta', 'Alpha']);
  });

  it('filter ist strikte Gleichheit, toleriert aber Zahl-als-String', async () => {
    await demoDb.create('Messwert', { wert: 42 });
    const treffer = await demoDb.filter('Messwert', { wert: '42' });
    assert.equal(treffer.length, 1, 'String "42" muss die Zahl 42 finden (req.query-Verhalten)');
    const keine = await demoDb.filter('Project', { status: 'gibt-es-nicht' });
    assert.equal(keine.length, 0);
  });

  it('get liefert den Datensatz oder null', async () => {
    assert.equal((await demoDb.get('Project', 'p1')).name, 'Alpha');
    assert.equal(await demoDb.get('Project', 'weg'), null);
  });

  it('create ergänzt id, created_date und updated_date', async () => {
    const r = await demoDb.create('Project', { name: 'Gamma' });
    assert.ok(r.id, 'id wird vergeben');
    assert.ok(r.created_date && r.updated_date, 'beide Zeitstempel gesetzt');
    assert.equal(r.created_date, r.updated_date);
    assert.equal((await demoDb.list('Project')).length, 3);
  });

  it('update merged flach, erhält die id und setzt updated_date neu', async () => {
    const vorher = await demoDb.get('Project', 'p1');
    const r = await demoDb.update('Project', 'p1', { status: 'fertig' });
    assert.equal(r.id, 'p1');
    assert.equal(r.name, 'Alpha', 'nicht genannte Felder bleiben');
    assert.equal(r.status, 'fertig');
    assert.notEqual(r.updated_date, vorher.updated_date ?? null);
  });

  it('update auf unbekannte id liefert null', async () => {
    assert.equal(await demoDb.update('Project', 'weg', { name: 'x' }), null);
  });

  it('remove entfernt genau einen Datensatz und meldet den Erfolg', async () => {
    assert.equal(await demoDb.remove('Project', 'p1'), true);
    assert.equal((await demoDb.list('Project')).length, 1);
    assert.equal(await demoDb.remove('Project', 'p1'), false);
  });
});

describe('demoDb — ein Schreibvorgang berührt EINEN Datensatz', () => {
  let speicher;
  beforeEach(() => {
    speicher = speicherAttrappe(SEED);
    setzeSpeicher(speicher, async () => structuredClone(SEED));
  });

  it('create schreibt genau einmal, nicht die ganze Datenbank', async () => {
    await demoDb.list('Project'); // Laden abschließen
    speicher.rufe.length = 0;
    const r = await demoDb.create('Project', { name: 'Gamma' });
    assert.deepEqual(speicher.rufe, [['schreiben', 'Project', r.id]]);
  });

  it('update schreibt genau einmal', async () => {
    await demoDb.list('Project');
    speicher.rufe.length = 0;
    await demoDb.update('Project', 'p1', { status: 'fertig' });
    assert.deepEqual(speicher.rufe, [['schreiben', 'Project', 'p1']]);
  });

  it('remove löscht genau einmal', async () => {
    await demoDb.list('Project');
    speicher.rufe.length = 0;
    await demoDb.remove('Project', 'p2');
    assert.deepEqual(speicher.rufe, [['loeschen', 'Project', 'p2']]);
  });
});

describe('demoDb — Migration und Erststart', () => {
  it('leerer Speicher + Altstand im localStorage → übernommen, Key entfernt', async () => {
    const alt = {
      Project: [{ id: 'alt1', name: 'Aus localStorage' }],
      Contact: [{ id: 'altc', name: 'Kontakt' }],
    };
    globalThis.localStorage = lagerAttrappe({
      'bit-atelier-demo-db-v1': JSON.stringify(alt),
    });
    const speicher = speicherAttrappe({});
    setzeSpeicher(speicher, async () => structuredClone(SEED));

    const rows = await demoDb.list('Project');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Aus localStorage', 'der Altstand gewinnt gegen den Seed');
    assert.equal(speicher.daten.Contact.length, 1, 'alle Sammlungen wandern mit');
    assert.equal(await speicher.meta('migriert_von'), 'localStorage-v1');
    assert.equal(
      globalThis.localStorage.getItem('bit-atelier-demo-db-v1'),
      null,
      'Altstand wird nach erfolgreicher Übernahme entfernt',
    );
  });

  it('leerer Speicher ohne Altstand → Seed', async () => {
    globalThis.localStorage = lagerAttrappe({});
    const speicher = speicherAttrappe({});
    setzeSpeicher(speicher, async () => structuredClone(SEED));
    const rows = await demoDb.list('Project');
    assert.deepEqual(rows.map((r) => r.id).sort(), ['p1', 'p2']);
    assert.equal(await speicher.meta('schema'), 1);
  });

  it('gefüllter Speicher schlägt Altstand und Seed', async () => {
    globalThis.localStorage = lagerAttrappe({
      'bit-atelier-demo-db-v1': JSON.stringify({ Project: [{ id: 'alt1', name: 'Alt' }] }),
    });
    const speicher = speicherAttrappe({ Project: [{ id: 'idb1', name: 'Aus IndexedDB' }] });
    setzeSpeicher(speicher, async () => structuredClone(SEED));
    const rows = await demoDb.list('Project');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Aus IndexedDB');
    assert.notEqual(
      globalThis.localStorage.getItem('bit-atelier-demo-db-v1'),
      null,
      'ohne Migration wird der Altstand nicht angefasst',
    );
  });

  it('gesperrter localStorage bricht den Start nicht', async () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    };
    setzeSpeicher(speicherAttrappe({}), async () => structuredClone(SEED));
    const rows = await demoDb.list('Project');
    assert.equal(rows.length, 2, 'fällt auf den Seed zurück');
  });
});

describe('demoDb — Speicherfehler bleibt sichtbar', () => {
  it('Quota-Fehler wird geworfen, nicht verschluckt', async () => {
    globalThis.localStorage = lagerAttrappe({});
    const speicher = speicherAttrappe(SEED);
    setzeSpeicher(speicher, async () => structuredClone(SEED));
    await demoDb.list('Project');
    speicher.quotaAbBei('Project');
    await assert.rejects(
      () => demoDb.create('Project', { name: 'Zu viel' }),
      /Speicher voll/,
      'die Oberfläche darf nicht weiter „gespeichert" behaupten',
    );
  });

  it('meldet demo:speicher-fehler und bei Erfolg demo:gespeichert', async () => {
    const ereignisse = [];
    globalThis.window = {
      dispatchEvent: (e) => ereignisse.push(e.type),
    };
    globalThis.CustomEvent = class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    globalThis.localStorage = lagerAttrappe({});
    const speicher = speicherAttrappe(SEED);
    setzeSpeicher(speicher, async () => structuredClone(SEED));
    await demoDb.list('Project');

    await demoDb.create('Project', { name: 'Geht' });
    assert.ok(ereignisse.includes('demo:gespeichert'));

    speicher.quotaAbBei('Project');
    await assert.rejects(() => demoDb.create('Project', { name: 'Geht nicht' }));
    assert.ok(ereignisse.includes('demo:speicher-fehler'));

    delete globalThis.window;
    delete globalThis.CustomEvent;
  });
});

describe('demoDb — Auslesen, Ersetzen, Zurücksetzen', () => {
  beforeEach(() => {
    globalThis.localStorage = lagerAttrappe({});
    setzeSpeicher(speicherAttrappe(SEED), async () => structuredClone(SEED));
  });

  it('demoDbAuslesen liefert eine Kopie, keine Referenz', async () => {
    const a = await demoDbAuslesen();
    a.Project[0].name = 'verändert';
    const rows = await demoDb.list('Project');
    assert.equal(rows[0].name, 'Alpha', 'die Datenbank darf sich nicht mitverändern');
  });

  it('demoDbErsetzen tauscht den gesamten Bestand', async () => {
    await demoDbErsetzen({ Project: [{ id: 'neu', name: 'Importiert' }] });
    const rows = await demoDb.list('Project');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Importiert');
    assert.equal((await demoDb.list('Contact')).length, 0, 'alte Sammlungen sind weg');
  });

  it('demoDbZuruecksetzen stellt den Seed wieder her', async () => {
    await demoDb.create('Project', { name: 'Wegwerf' });
    await demoDbZuruecksetzen();
    const rows = await demoDb.list('Project');
    assert.deepEqual(rows.map((r) => r.id).sort(), ['p1', 'p2']);
  });
});

describe('demoDb — Sicherungs-Anstoß (69-07)', () => {
  let speicher;
  beforeEach(() => {
    speicher = speicherAttrappe(SEED);
    setzeSpeicher(speicher, async () => structuredClone(SEED));
  });

  it('sicherungFaellig: nie gesichert + >= 20 Datensätze → fällig', () => {
    assert.equal(sicherungFaellig(null, 20), true);
    assert.equal(sicherungFaellig(null, 94), true);
  });

  it('sicherungFaellig: unter 20 Datensätzen nie fällig (leere Spielwiese)', () => {
    assert.equal(sicherungFaellig(null, 19), false);
    assert.equal(sicherungFaellig(null, 0), false);
  });

  it('sicherungFaellig: frisch gesichert → nicht fällig; +50 Datensätze → wieder fällig', () => {
    const sicherung = { zeit: '2026-09-25T08:00:00.000Z', datensaetze: 94 };
    assert.equal(sicherungFaellig(sicherung, 94), false);
    assert.equal(sicherungFaellig(sicherung, 143), false, 'Delta 49 < 50');
    assert.equal(sicherungFaellig(sicherung, 144), true, 'Delta 50 = Schwelle');
  });

  it('sicherungFaellig: kaputtes Metadatum zählt wie nie gesichert', () => {
    assert.equal(sicherungFaellig({ zeit: 'x' }, 50), true);
    assert.equal(sicherungFaellig('unsinn', 50), true);
  });

  it('letzteSicherungSetzen schreibt {zeit, datensaetze} in den Meta-Store; letzteSicherungLesen liest es', async () => {
    assert.equal(await letzteSicherungLesen(), null);
    const wert = await letzteSicherungSetzen();
    assert.equal(wert.datensaetze, 3, 'SEED hat 2 Projekte + 1 Kontakt');
    assert.match(wert.zeit, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(speicher.metaWerte.letzteSicherung, wert);
    const gelesen = await letzteSicherungLesen();
    assert.deepEqual(gelesen, wert);
    assert.equal(sicherungFaellig(gelesen, 3), false, 'direkt nach der Sicherung nicht fällig');
    await demoDb.create('Project', { name: 'Zuwachs' });
    assert.equal(sicherungFaellig(await letzteSicherungLesen(), 4), false, 'Delta 1 < 50');
  });
});
