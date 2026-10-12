// 70-03: the file storage adapter. Same facade cases as demoDb.test.js, run
// through demoDb with dateiSpeicher injected (setzeSpeicher), plus what only a
// file store can get wrong: atomic writes, damaged files, file layout.
// The file interface is an in-memory fake, so nothing here touches the disk.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dateiSpeicher, ortFuer, ORDNER } from '@core/api/dateiSpeicher.js';
import { demoDb, demoDbAuslesen, demoDbErsetzen, setzeSpeicher } from '@core/api/demoDb.js';
import { schnappschussAnlegen, schnappschuesseListe, setzeSchnappschussSpeicher } from '@core/api/schnappschuesse.js';

/**
 * In-memory file interface. `scheitern` lets a test break one operation for one path.
 * @returns {import('@core/api/dateiSpeicher.js').DateiSchnittstelle & {dateien: Map<string,string>, ordner: Set<string>, scheitern: (op: string, pfad: string) => void}}
 */
function fakeFs() {
  const dateien = new Map();
  const ordner = new Set();
  /** @type {{op: string, pfad: string}|null} */
  let bruch = null;
  const pruefe = (op, pfad) => {
    if (bruch && bruch.op === op && bruch.pfad === pfad) throw new Error(`Testabbruch: ${op} ${pfad}`);
  };
  return {
    dateien,
    ordner,
    scheitern(op, pfad) { bruch = { op, pfad }; },
    async lesen(pfad) { pruefe('lesen', pfad); return dateien.has(pfad) ? dateien.get(pfad) : null; },
    async schreiben(pfad, text) { pruefe('schreiben', pfad); dateien.set(pfad, text); },
    async umbenennen(von, nach) {
      pruefe('umbenennen', von);
      if (!dateien.has(von)) throw new Error(`fehlt: ${von}`);
      dateien.set(nach, dateien.get(von));
      dateien.delete(von);
    },
    async loeschen(pfad) { dateien.delete(pfad); },
    async liste(o) {
      const praefix = `${o}/`;
      return [...dateien.keys()].filter((k) => k.startsWith(praefix) && !k.slice(praefix.length).includes('/')).map((k) => k.slice(praefix.length));
    },
    async ordnerAnlegen(o) { ordner.add(o); },
  };
}

const SEED = {
  Project: [
    { id: 'p1', name: 'Alpha', status: 'aktiv', created_date: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: 'Beta', status: 'ruht', created_date: '2026-02-01T00:00:00.000Z' },
  ],
  Contact: [{ id: 'c1', name: 'Muster', project_id: 'p1' }],
};

describe('dateiSpeicher — Fassade über demoDb (Fälle aus demoDb.test.js)', () => {
  /** @type {ReturnType<typeof fakeFs>} */
  let fs;
  beforeEach(() => {
    fs = fakeFs();
    setzeSpeicher(/** @type {any} */ (dateiSpeicher('ablage', fs)), async () => structuredClone(SEED));
  });

  it('Erststart: Seed landet in daten/<Entity>.json, meta.json trägt das Schema', async () => {
    const liste = await demoDb.list('Project');
    assert.equal(liste.length, 2);
    assert.deepEqual(JSON.parse(fs.dateien.get('ablage/daten/Project.json')).map((r) => r.id), ['p1', 'p2']);
    const meta = JSON.parse(fs.dateien.get('ablage/meta.json'));
    assert.equal(meta.dateiSchema, 1);
    assert.equal(meta.schema, 1);
    for (const o of ORDNER) assert.ok(fs.ordner.has(`ablage/${o}`), o);
  });

  it('sort, filter und get wie server/db.js', async () => {
    assert.deepEqual((await demoDb.list('Project', '-created_date')).map((p) => p.id), ['p2', 'p1']);
    assert.deepEqual((await demoDb.filter('Project', { status: 'aktiv' })).map((p) => p.id), ['p1']);
    assert.equal((await demoDb.get('Contact', 'c1')).name, 'Muster');
    assert.equal(await demoDb.get('Contact', 'gibtsnicht'), null);
  });

  it('create/update/remove landen in der Datei und überstehen einen Neustart', async () => {
    const neu = await demoDb.create('Project', { name: 'Gamma' });
    await demoDb.update('Project', 'p1', { status: 'fertig' });
    assert.equal(await demoDb.remove('Contact', 'c1'), true);
    // "Neustart": frischer Adapter auf denselben Dateien, demoDb ohne Cache.
    setzeSpeicher(/** @type {any} */ (dateiSpeicher('ablage', fs)), async () => ({}));
    const projekte = await demoDb.list('Project');
    assert.equal(projekte.length, 3);
    assert.ok(projekte.some((p) => p.id === neu.id && p.name === 'Gamma'));
    assert.equal((await demoDb.get('Project', 'p1')).status, 'fertig');
    assert.deepEqual(await demoDb.list('Contact'), []);
  });

  it('demoDbErsetzen tauscht den Bestand und leert verschwundene Sammlungen', async () => {
    await demoDb.list('Project');
    await demoDbErsetzen({ Task: [{ id: 't1', titel: 'x' }] }, null);
    const alles = await demoDbAuslesen();
    assert.deepEqual(Object.keys(alles).sort(), ['Task']);
    assert.equal(fs.dateien.has('ablage/daten/Project.json'), false);
  });
});

describe('dateiSpeicher — atomar, defekte Dateien, Ablageform', () => {
  it('Abbruch nach dem Temporärschreiben: die alte Datei bleibt unversehrt', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    await s.schreiben('Project', { id: 'p1', name: 'alt' });
    const vorher = fs.dateien.get('daten/Project.json');
    fs.scheitern('umbenennen', 'daten/Project.json.tmp');
    await assert.rejects(s.schreiben('Project', { id: 'p1', name: 'neu' }), /Testabbruch/);
    assert.equal(fs.dateien.get('daten/Project.json'), vorher);
    // Speicher und Platte bleiben gleich: der abgelehnte Stand ist nicht "da".
    assert.equal((await s.alle('Project'))[0].name, 'alt');
    // Neuer Adapter liest weiter die alte Fassung; die liegengebliebene .tmp stört nicht.
    assert.equal((await dateiSpeicher('', fs).alle('Project'))[0].name, 'alt');
    assert.deepEqual(await dateiSpeicher('', fs).entities(), ['Project']);
  });

  it('defekte JSON-Datei wird mit Dateinamen gemeldet, nicht als leer gelesen', async () => {
    const fs = fakeFs();
    fs.dateien.set('daten/Project.json', '[{"id":"p1",');
    await assert.rejects(dateiSpeicher('', fs).alle('Project'), /Datei beschädigt: daten\/Project\.json/);
    fs.dateien.set('daten/Project.json', '{"id":"p1"}');
    await assert.rejects(dateiSpeicher('', fs).alle('Project'), /erwartet wird eine Liste/);
  });

  it('defekte meta.json wird ebenfalls gemeldet', async () => {
    const fs = fakeFs();
    fs.dateien.set('meta.json', 'kein json');
    await assert.rejects(dateiSpeicher('', fs).meta('schema'), /Datei beschädigt: meta\.json/);
  });

  it('unbekannte Sammlung → leere Liste, keine Datei', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    assert.deepEqual(await s.alle('GibtEsNicht'), []);
    assert.equal(fs.dateien.has('daten/GibtEsNicht.json'), false);
  });

  it('meta lesen und schreiben', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    assert.equal(await s.meta('letzteSicherung'), undefined);
    await s.meta('letzteSicherung', { zeit: '2026-10-12T10:00:00.000Z', datensaetze: 3 });
    assert.deepEqual(await dateiSpeicher('', fs).meta('letzteSicherung'), { zeit: '2026-10-12T10:00:00.000Z', datensaetze: 3 });
  });

  it('gleichzeitige meta-Schreibvorgänge verlieren keinen Schlüssel (Befund Headless 70-03)', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    await s.vorbereiten();
    await Promise.all([s.meta('uebernahme', { ergebnis: 'uebernommen' }), s.meta('persist', false), s.meta('schema', 1)]);
    const datei = JSON.parse(fs.dateien.get('meta.json'));
    assert.deepEqual(datei.uebernahme, { ergebnis: 'uebernommen' });
    assert.equal(datei.persist, false);
    assert.equal(datei.schema, 1);
  });

  it('abgelehnter meta-Schreibvorgang hinterlässt den Schlüssel nicht im Speicher', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    await s.vorbereiten();
    fs.scheitern('umbenennen', 'meta.json.tmp');
    await assert.rejects(s.meta('letzteSicherung', { zeit: 'x' }), /Testabbruch/);
    assert.equal(await s.meta('letzteSicherung'), undefined);
  });

  it('Sammlungs- und Datensatznamen mit Pfadteilen werden abgelehnt', async () => {
    const s = dateiSpeicher('', fakeFs());
    await assert.rejects(s.alle('../geheim'), /nicht zulässig/);
    await assert.rejects(s.schreiben('Project/x', { id: 'a' }), /nicht zulässig/);
    await assert.rejects(s.blobs.put('..\\x', {}), /nicht zulässig/);
  });

  it('Personal und Schnappschüsse liegen getrennt und erscheinen nicht in entities()', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    await s.schreiben('Project', { id: 'p1' });
    await s.schreiben('personal.Mitarbeiter', { id: 'm1' });
    await s.schreiben('personal.dateien', { id: 'd1', daten: 'xyz' });
    await s.schreiben('schnappschuesse', { id: 'snap-1', zeit: 1 });
    assert.ok(fs.dateien.has('personal/Mitarbeiter.json'));
    assert.ok(fs.dateien.has('personal/dateien/d1.json'));
    assert.ok(fs.dateien.has('schnappschuesse/snap-1.json'));
    assert.deepEqual(await s.entities(), ['Project']);
    assert.deepEqual(ortFuer('schnappschuesse'), { art: 'einzeln', ordner: 'schnappschuesse' });
  });

  it('Schnappschuss-Ring schreibt je Schnappschuss eine Datei und hält fünf', async () => {
    const fs = fakeFs();
    const s = /** @type {any} */ (dateiSpeicher('', fs));
    setzeSpeicher(s, async () => structuredClone(SEED));
    setzeSchnappschussSpeicher(s);
    for (let i = 0; i < 7; i++) await schnappschussAnlegen(`Test ${i}`);
    assert.equal((await schnappschuesseListe()).length, 5);
    assert.equal((await fs.liste('schnappschuesse')).length, 5);
  });

  it('gleichzeitige Schreibvorgänge auf eine Sammlung verlieren nichts', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.schreiben('Task', { id: `t${i}` })));
    assert.equal(JSON.parse(fs.dateien.get('daten/Task.json')).length, 20);
  });

  it('Blobs: ablegen, lesen, löschen; fehlender Blob → null', async () => {
    const fs = fakeFs();
    const s = dateiSpeicher('', fs);
    await s.blobs.put('ava-123', { positionen: [1, 2] });
    assert.deepEqual(await s.blobs.get('ava-123'), { positionen: [1, 2] });
    await s.blobs.delete('ava-123');
    assert.equal(await s.blobs.get('ava-123'), null);
  });
});
