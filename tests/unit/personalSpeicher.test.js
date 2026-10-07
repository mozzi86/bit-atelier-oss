// personalSpeicher.test.js — the personal (HR) storage class end to end
// (Plan 80-02, D-P80-A): personalEntitaeten.js's pure rules (Behavior 1, 13),
// demoIdb.js's fehlendeStores (Behavior 6), personalDb.js's CRUD/seed/no-cache
// contract (Behavior 6a, 7, 8, 9) against a shared in-memory adapter, the
// three data-protection invariants DS-01/DS-02/DS-03 (Behavior 3, 4, 5) and
// bitApi.personal's cloud/express split (Behavior 12).
//
// The adapter attrappe below plays BOTH demoIdb's and personalDb's roles at
// once — the SAME object is injected into demoDb.js (setzeSpeicher) and
// personalDb.js (setzePersonalSpeicher) for the DS-0x tests, exactly as the
// plan specifies ("gemeinsame Attrappe … deren entities() dieselbe
// exportierte Regel istPersonalStore anwendet").

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONAL_ENTITAETEN,
  personalStoreName,
  istPersonalEntitaet,
  istPersonalStore,
  personalWeg,
  PERSONAL_NUR_LOKAL,
} from '@core/api/personalEntitaeten.js';
import { fehlendeStores } from '@core/api/demoIdb.js';
import {
  personalDb,
  personalDbAuslesen,
  setzePersonalSpeicher,
  personalMeta,
} from '@core/api/personalDb.js';
import { demoDb, demoDbAuslesen, demoDbErsetzen, demoDbZuruecksetzen, setzeSpeicher } from '@core/api/demoDb.js';
import { serialisiereProjekt } from '@core/api/projektDatei.js';
import { schnappschussAnlegen, setzeSchnappschussSpeicher, SCHNAPP_STORE } from '@core/api/schnappschuesse.js';
import { bitApi } from '@core/api/bitApi.js';

/**
 * A single adapter double satisfying BOTH demoIdb's shape (entities/alle/
 * schreiben/schreibeViele/loeschen/leeren/meta) and personalDb's extra
 * stelleStoresSicher — same store-name keyed object either module reads, so
 * DS-01/DS-02/DS-03 can prove Personal never crosses into the demoDb side.
 * @param {Record<string, object[]>} [start]
 */
function attrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  let blockiereNaechste = 0;
  return {
    daten,
    metaWerte,
    /** The next call to stelleStoresSicher rejects `n` times with "IndexedDB blockiert" before succeeding. */
    blockiereStoresSicherNaechste(n) {
      blockiereNaechste = n;
    },
    async entities() {
      // Same filter demoIdb.js's real entities() applies: hide _meta,
      // the snapshot ring AND every personal.* store.
      return Object.keys(daten).filter((n) => n !== '_meta' && n !== SCHNAPP_STORE && !istPersonalStore(n));
    },
    async alle(store) {
      return structuredClone(daten[store] || []);
    },
    async schreiben(store, datensatz) {
      daten[store] = daten[store] || [];
      const i = daten[store].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[store].push(structuredClone(datensatz));
      else daten[store][i] = structuredClone(datensatz);
    },
    async schreibeViele(store, datensaetze) {
      daten[store] = structuredClone(datensaetze);
    },
    async loeschen(store, id) {
      daten[store] = (daten[store] || []).filter((r) => r.id !== id);
    },
    async leeren(store) {
      daten[store] = [];
    },
    async meta(key, wert) {
      if (arguments.length === 1) return metaWerte[key];
      metaWerte[key] = wert;
      return wert;
    },
    async stelleStoresSicher(namen) {
      if (blockiereNaechste > 0) {
        blockiereNaechste -= 1;
        throw new Error('IndexedDB blockiert — ein anderer Tab hält eine ältere Version offen');
      }
      for (const n of namen) if (!daten[n]) daten[n] = [];
    },
  };
}

describe('personalEntitaeten — reine Regeln (Behavior 1, 13)', () => {
  it('PERSONAL_ENTITAETEN: 9, eingefroren', () => {
    assert.equal(PERSONAL_ENTITAETEN.length, 9);
    assert.throws(() => { PERSONAL_ENTITAETEN.push('X'); });
  });

  it('istPersonalEntitaet', () => {
    assert.equal(istPersonalEntitaet('Mitarbeiter'), true);
    assert.equal(istPersonalEntitaet('Project'), false);
  });

  it('istPersonalStore', () => {
    assert.equal(istPersonalStore('personal.Mitarbeiter'), true);
    assert.equal(istPersonalStore('personal.dateien'), true);
    assert.equal(istPersonalStore('Project'), false);
    assert.equal(istPersonalStore('schnappschuesse'), false);
  });

  it('personalWeg / PERSONAL_NUR_LOKAL', () => {
    assert.equal(personalWeg('supabase'), 'gesperrt');
    assert.equal(personalWeg('serverlos'), 'serverlos');
    assert.equal(personalWeg('express'), 'express');
    assert.match(PERSONAL_NUR_LOKAL, /bleiben lokal/);
  });
});

describe('demoIdb.fehlendeStores — rein (Behavior 6, erster Teil)', () => {
  it('nur die fehlenden Namen, in gewünschter Reihenfolge', () => {
    assert.deepEqual(
      fehlendeStores(['Project', 'personal.Mitarbeiter'], ['personal.Mitarbeiter', 'personal.Stelle', 'personal.dateien']),
      ['personal.Stelle', 'personal.dateien']
    );
    assert.deepEqual(fehlendeStores(['a', 'b'], ['a', 'b']), []);
  });
});

describe('DS-01/DS-02/DS-03 — Personal ist nie in demoDbAuslesen, Schnappschuss, Export; Import/Reset lassen es unberührt', () => {
  /** @type {ReturnType<typeof attrappe>} */
  let speicher;

  beforeEach(() => {
    speicher = attrappe();
    setzeSpeicher(speicher, async () => ({}));
    setzeSchnappschussSpeicher(speicher);
    setzePersonalSpeicher(speicher, async () => ({}), { istDemo: false });
  });

  it('DS-01: personalDb.create hinterlässt 0 personal.*-Schlüssel in demoDbAuslesen/serialisiereProjekt', async () => {
    await personalDb.create('Mitarbeiter', { vorname: 'Erika' });
    const alles = await demoDbAuslesen();
    assert.deepEqual(Object.keys(alles).filter((k) => k.startsWith('personal.')), []);
    for (const name of PERSONAL_ENTITAETEN) assert.ok(!(name in alles));
    const projekt = serialisiereProjekt(alles);
    assert.deepEqual(Object.keys(projekt.daten).filter((k) => k.startsWith('personal.')), []);
  });

  it('DS-03: demoDbErsetzen lässt Personal unberührt', async () => {
    await personalDb.create('Mitarbeiter', { id: 'p1', vorname: 'Erika' });
    assert.equal((await personalDb.list('Mitarbeiter')).length, 1);

    await demoDb.list('Project'); // demoDb lädt (leerer Seed)
    await demoDbErsetzen({ Project: [{ id: 'p1' }] });
    assert.equal((await personalDb.list('Mitarbeiter')).length, 1);

    await demoDbZuruecksetzen();
    assert.equal((await personalDb.list('Mitarbeiter')).length, 1);
  });

  it('DS-02: schnappschussAnlegen trägt 0 Personal-Schlüssel im eingebetteten Projekt', async () => {
    await personalDb.create('Mitarbeiter', { vorname: 'Erika' });
    await demoDb.create('Project', { name: 'Testprojekt' });
    const kopf = await schnappschussAnlegen('Test');
    const alle = await speicher.alle(SCHNAPP_STORE);
    const eintrag = alle.find((e) => e.id === kopf.id);
    assert.ok(eintrag, 'Schnappschuss wurde angelegt');
    assert.deepEqual(Object.keys(eintrag.projekt.daten).filter((k) => k.startsWith('personal.')), []);
  });
});

describe('personalDb — CRUD, unbekannte Entität, Dateien (Behavior 7, 8)', () => {
  /** @type {ReturnType<typeof attrappe>} */
  let speicher;
  beforeEach(() => {
    speicher = attrappe();
    setzePersonalSpeicher(speicher, async () => ({}), { istDemo: false });
  });

  it('create auf eine unbekannte Entität wirft "… keine Personal-Entität"', async () => {
    await assert.rejects(() => personalDb.create('Project', {}), /keine Personal-Entität/);
  });

  it('dateien.put/get/delete — Rundlauf, list() einer Entität bleibt unverändert', async () => {
    await personalDb.dateien.put('d1', { mime: 'application/pdf', name: 'v.pdf', data: 'data:…' });
    const gelesen = await personalDb.dateien.get('d1');
    assert.equal(gelesen.name, 'v.pdf');
    assert.equal((await personalDb.list('Personaldokument')).length, 0);
    await personalDb.dateien.delete('d1');
    assert.equal(await personalDb.dateien.get('d1'), null);
  });

  it('create/update/remove/list — bitApi-gleiche Semantik', async () => {
    const angelegt = await personalDb.create('Mitarbeiter', { vorname: 'Erika' });
    assert.ok(angelegt.id && angelegt.created_date && angelegt.updated_date);
    const aktualisiert = await personalDb.update('Mitarbeiter', angelegt.id, { funktion: 'Architektin' });
    assert.equal(aktualisiert.funktion, 'Architektin');
    assert.equal(aktualisiert.vorname, 'Erika', 'nicht genannte Felder bleiben');
    assert.equal(await personalDb.update('Mitarbeiter', 'weg', {}), null);
    assert.equal(await personalDb.remove('Mitarbeiter', angelegt.id), true);
    assert.equal((await personalDb.list('Mitarbeiter')).length, 0);
  });
});

describe('personalDb — stelleStoresSicher-Wiederholung bei "IndexedDB blockiert" (Behavior 6, zweiter Teil)', () => {
  it('ein blockierter erster Versuch führt zu genau einem zweiten Versuch, danach vorhandene Stores', async () => {
    const speicher = attrappe();
    speicher.blockiereStoresSicherNaechste(1);
    setzePersonalSpeicher(speicher, async () => ({}), { istDemo: false });
    const liste = await personalDb.list('Mitarbeiter'); // muss trotz einer Blockade durchlaufen
    assert.deepEqual(liste, []);
    assert.ok(speicher.daten[personalStoreName('Mitarbeiter')], 'der Store existiert nach der Wiederholung');
  });

  it('ein anderer Fehler als "IndexedDB blockiert" wird sofort weitergeworfen, ohne Wiederholung', async () => {
    const speicher = attrappe();
    let aufrufe = 0;
    speicher.stelleStoresSicher = async () => {
      aufrufe += 1;
      throw new Error('Ein ganz anderer Fehler');
    };
    setzePersonalSpeicher(speicher, async () => ({}), { istDemo: false });
    await assert.rejects(() => personalDb.list('Mitarbeiter'), /ganz anderer Fehler/);
    assert.equal(aufrufe, 1);
  });
});

describe('personalDb — N-17: kein tab-weiter Cache', () => {
  it('eine Änderung, die "im anderen Tab" direkt im Adapter geschrieben wurde, ist sofort sichtbar', async () => {
    const speicher = attrappe();
    setzePersonalSpeicher(speicher, async () => ({}), { istDemo: false });
    await personalDb.create('Mitarbeiter', { id: 'P-001', vorname: 'Erika' });
    assert.equal((await personalDb.list('Mitarbeiter')).length, 1);

    // Simuliert einen zweiten Tab, der denselben Speicher direkt schreibt —
    // ohne über DIESE personalDb-Instanz zu laufen. Ein Cache würde das nicht sehen.
    speicher.daten[personalStoreName('Mitarbeiter')].push({ id: 'P-006', vorname: 'Neu' });

    const listeNachher = await personalDb.list('Mitarbeiter');
    assert.equal(listeNachher.length, 2);
    const alle = await personalDbAuslesen();
    assert.ok(alle.Mitarbeiter.some((m) => m.id === 'P-006'));
  });
});

describe('personalDb — Seed (Behavior 9)', () => {
  const MINI_SEED = {
    Mitarbeiter: [
      { id: 'm1', vorname: 'A' }, { id: 'm2', vorname: 'B' }, { id: 'm3', vorname: 'C' }, { id: 'm4', vorname: 'D' },
    ],
    Arbeitsvertrag: [], Gehaltsaenderung: [], Stelle: [], Bewerbung: [], Personalvorgang: [], Personaldokument: [], Fristquittung: [], Loeschprotokoll: [],
  };

  it('istDemo:true, leerer Speicher → 4 Personen beim ersten list(), Meta gesetzt; nach Leeren + neuem "Seitenleben" kein zweites Seeden', async () => {
    const speicher = attrappe();
    const neueSeite = () => setzePersonalSpeicher(speicher, async () => structuredClone(MINI_SEED), { istDemo: true });

    neueSeite();
    assert.equal((await personalDb.list('Mitarbeiter')).length, 4);
    assert.ok(await personalMeta('geseedet'));

    for (const e of PERSONAL_ENTITAETEN) speicher.daten[personalStoreName(e)] = [];
    neueSeite(); // simuliert Reload/neuen Tab — bereitPromise wird neu aufgebaut, die Meta-Marke bleibt im geteilten Speicher
    assert.equal((await personalDb.list('Mitarbeiter')).length, 0, 'die Meta-Marke verhindert ein zweites Seeden');
  });

  it('istDemo:false → nie Seeden', async () => {
    const speicher = attrappe();
    setzePersonalSpeicher(speicher, async () => structuredClone(MINI_SEED), { istDemo: false });
    assert.equal((await personalDb.list('Mitarbeiter')).length, 0);
  });
});

describe('bitApi.personal — eigener Namensraum, generischer Weg gesperrt (Behavior 12)', () => {
  let vorherFetch;
  const aufrufe = [];

  beforeEach(() => {
    aufrufe.length = 0;
    vorherFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      aufrufe.push(String(url));
      return { ok: true, status: 201, json: async () => ({ id: 'x' }) };
    };
  });
  afterEach(() => {
    globalThis.fetch = vorherFetch;
  });

  it('bitApi.personal.Mitarbeiter.list() ruft /api/personal/Mitarbeiter auf', async () => {
    await bitApi.personal.Mitarbeiter.list();
    assert.equal(aufrufe.length, 1);
    assert.match(aufrufe[0], /\/api\/personal\/Mitarbeiter(\?.*)?$/);
  });

  it('bitApi.entities.Mitarbeiter.list() lehnt ab, ohne fetch aufzurufen', async () => {
    await assert.rejects(() => bitApi.entities.Mitarbeiter.list(), /bitApi\.personal/);
    assert.equal(aufrufe.length, 0);
  });

  it('bitApi.personal.Project.list() lehnt mit "keine Personal-Entität" ab', async () => {
    await assert.rejects(() => bitApi.personal.Project.list(), /keine Personal-Entität/);
  });
});
