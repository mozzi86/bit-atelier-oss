// 79-12 (E-07): the generic `ohne`/`behalte` options of projektDatei.js and
// demoDb.js, exercised together with the real accounting registry
// (src/lib/exportBereiche.js). Pins the <behavior> block "Datei und Import"
// of 79-12-PLAN.md. Storage is injected (speicherAttrappe, from demoDb.test.js),
// nothing here needs a browser — download/upload themselves are proven
// headless in tmp-e2e/b-12-exportdialog.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serialisiereProjekt,
  projektAlsBlob,
  exportProjekt,
  uebernehmeProjekt,
  vorschau,
  parseProjektDatei,
} from '@core/api/projektDatei.js';
import { setzeSpeicher, letzteSicherungLesen } from '@core/api/demoDb.js';
import { exportOptionen, importOptionen } from '@/lib/exportBereiche.js';
import { BUCHHALTUNG_ENTITAETEN, SETTING_KEY } from '@/lib/accounting/datenmodell.js';
// 80-10 (E-07/E-14): die Registry trägt jetzt auch "personal" (separat, nie im
// .bitproj) — dieselbe registry-allgemeine Anpassung wie in exportBereiche.test.js.
import { PERSONAL_EXPORT_BEREICH } from '@/lib/people/exportBereich.js';

/** Same fake adapter as tests/unit/demoDb.test.js — a synchronous in-memory store. */
function speicherAttrappe(start = {}) {
  const daten = structuredClone(start);
  const metaWerte = {};
  return {
    daten,
    async entities() { return Object.keys(daten); },
    async alle(entity) { return structuredClone(daten[entity] || []); },
    async schreiben(entity, datensatz) {
      daten[entity] = daten[entity] || [];
      const i = daten[entity].findIndex((r) => r.id === datensatz.id);
      if (i === -1) daten[entity].push(structuredClone(datensatz));
      else daten[entity][i] = structuredClone(datensatz);
    },
    async schreibeViele(entity, datensaetze) { daten[entity] = structuredClone(datensaetze); },
    async loeschen(entity, recordId) { daten[entity] = (daten[entity] || []).filter((r) => r.id !== recordId); },
    async leeren(entity) { delete daten[entity]; },
    async meta(key, wert) {
      if (arguments.length === 1) return metaWerte[key];
      metaWerte[key] = wert;
      return wert;
    },
  };
}

/** A minimal but complete accounting seed: one row in every one of the 13 collections. */
function buchhaltungsSeed() {
  const daten = { Project: [{ id: 'p1', name: 'Alpha' }] };
  for (const e of BUCHHALTUNG_ENTITAETEN) daten[e] = [{ id: `${e}-1` }];
  daten.Setting = [
    { id: 'set-briefkopf', key: 'briefkopf', value: { office: 'Büro Muster' } },
    { id: 'set-buchhaltung', key: SETTING_KEY, value: { rechtsform: 'einzelunternehmen' } },
  ];
  return daten;
}

/** Fakes browser download plumbing (URL/anchor) so exportProjekt() runs under Node. */
function mitDomAttrappe(arbeit) {
  const anker = { click() {}, remove() {}, setAttribute() {} };
  const vorherDoc = globalThis.document;
  const vorherUrl = globalThis.URL;
  globalThis.document = {
    createElement: () => anker,
    body: { appendChild() {}, removeChild() {} },
  };
  globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  return Promise.resolve(arbeit()).finally(() => {
    globalThis.document = vorherDoc;
    globalThis.URL = vorherUrl;
  });
}

describe('projektAlsBlob/exportProjekt — Häkchen aus (weitergabe)', () => {
  it('keine der 13 Sammlungen, keine Setting-Zeile buchhaltung, briefkopf und Project bleiben, art weitergabe', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    const optionen = exportOptionen([]);
    const { obj } = await projektAlsBlob('Test', optionen);
    for (const e of BUCHHALTUNG_ENTITAETEN) assert.ok(!(e in obj.daten), `${e} sollte fehlen`);
    assert.deepEqual((obj.daten.Setting || []).map((s) => s.key), ['briefkopf']);
    assert.ok(obj.daten.Project?.length === 1);
    assert.equal(obj.art, 'weitergabe');
    assert.deepEqual(obj.bereiche, []);
  });

  it('letzteSicherung bleibt unverändert (eine Weitergabe ist keine Sicherung)', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    assert.equal(await letzteSicherungLesen(), null);
    await mitDomAttrappe(() => exportProjekt('Test', exportOptionen([])));
    assert.equal(await letzteSicherungLesen(), null);
  });
});

describe('projektAlsBlob/exportProjekt — alle Häkchen (sicherung)', () => {
  // 80-10 (E-18): "alle Häkchen" heißt jetzt buchhaltung UND personal — nur
  // "buchhaltung" wäre seit der zweiten Registry-Zeile eine "weitergabe"
  // (exportBereiche.test.js prüft das schon direkt); dieser Test bleibt bei
  // "alles enthalten" hängen und braucht deshalb beide Häkchen.
  it('alles enthalten, art sicherung, bereiche nennt buchhaltung (Personal bleibt separat, nie im .bitproj)', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    const { obj } = await projektAlsBlob('Test', exportOptionen(['buchhaltung', 'personal']));
    for (const e of BUCHHALTUNG_ENTITAETEN) assert.ok(Array.isArray(obj.daten[e]), `${e} sollte enthalten sein`);
    for (const e of PERSONAL_EXPORT_BEREICH.entitaeten) assert.ok(!(e in obj.daten), `${e} (Personal) sollte NIE im .bitproj stehen`);
    assert.deepEqual((obj.daten.Setting || []).map((s) => s.key).sort(), ['briefkopf', 'buchhaltung']);
    assert.equal(obj.art, 'sicherung');
    assert.deepEqual(obj.bereiche, ['buchhaltung']); // separat-Bereiche stehen nie in bereiche
  });

  it('letzteSicherung wird gestempelt', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    assert.equal(await letzteSicherungLesen(), null);
    await mitDomAttrappe(() => exportProjekt('Test', exportOptionen(['buchhaltung', 'personal'])));
    assert.ok(await letzteSicherungLesen());
  });
});

describe('uebernehmeProjekt — Import einer Weitergabe-Datei', () => {
  it('Projekte ersetzt, 16 Ausgangsrechnungen und Setting buchhaltung unverändert vorhanden', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    // Datei ohne Buchhaltung, aber mit einem anderen Projektstand.
    const fremdeDatei = { schema: 1, app: 'bit-atelier-demo', exportiert: new Date().toISOString(), projektname: 'Fremd', art: 'weitergabe', bereiche: [], daten: { Project: [{ id: 'p2', name: 'Beta' }] } };
    const opt = importOptionen(fremdeDatei);
    await uebernehmeProjekt(fremdeDatei, opt);
    const { demoDbAuslesen } = await import('@core/api/demoDb.js');
    const nachher = await demoDbAuslesen();
    assert.deepEqual(nachher.Project, [{ id: 'p2', name: 'Beta' }]);
    assert.equal(nachher.Honorarvertrag.length, 1); // eine der 13 Sammlungen, stellvertretend
    assert.ok(nachher.Setting.find((s) => s.key === 'buchhaltung'));
  });
});

describe('uebernehmeProjekt — Import einer Sicherung', () => {
  it('ersetzt alles wie bisher', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    const voll = { schema: 1, app: 'bit-atelier-demo', exportiert: new Date().toISOString(), projektname: 'Sicherung', art: 'sicherung', bereiche: ['buchhaltung'], daten: { Project: [] } };
    for (const e of BUCHHALTUNG_ENTITAETEN) voll.daten[e] = [];
    voll.daten.Setting = [];
    const opt = importOptionen(voll);
    // Personal ist ein separat-Bereich (E-14): eine .bitproj nennt "personal"
    // nie in bereiche und trägt seine Sammlungen nie — importOptionen behält
    // sie deshalb IMMER lokal, unabhängig vom Dateiinhalt (registry-allgemein).
    assert.deepEqual(opt.behalte, [...PERSONAL_EXPORT_BEREICH.entitaeten]);
    await uebernehmeProjekt(voll, opt);
    const { demoDbAuslesen } = await import('@core/api/demoDb.js');
    const nachher = await demoDbAuslesen();
    assert.deepEqual(nachher.Project, []);
    assert.deepEqual(nachher.Honorarvertrag, []);
  });
});

describe('Rückwärtskompatibilität — Aufrufe ohne Optionen', () => {
  it('projektAlsBlob(name)/exportProjekt(name) exakt wie vor dem Plan', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    const { obj } = await projektAlsBlob('Test');
    for (const e of BUCHHALTUNG_ENTITAETEN) assert.ok(Array.isArray(obj.daten[e]));
    assert.equal(obj.art, undefined);
    assert.equal(JSON.stringify(obj).includes('"art"'), false, 'art darf ohne Optionen gar nicht im JSON stehen');
    await mitDomAttrappe(() => exportProjekt('Test'));
    assert.ok(await letzteSicherungLesen(), 'ohne Optionen stempelt exportProjekt wie bisher immer');
  });

  it('uebernehmeProjekt(obj) ohne Optionen ersetzt weiterhin alles', async () => {
    setzeSpeicher(speicherAttrappe(buchhaltungsSeed()));
    await uebernehmeProjekt({ daten: { Project: [{ id: 'neu' }] } });
    const { demoDbAuslesen } = await import('@core/api/demoDb.js');
    assert.deepEqual((await demoDbAuslesen()).Project, [{ id: 'neu' }]);
  });

  it('eine alte Datei ohne art gilt in der Vorschau als Sicherung', () => {
    const v = vorschau({ projektname: 'Alt', daten: { Project: [] } });
    assert.equal(v.art, 'sicherung');
    assert.deepEqual(v.bereiche, []);
  });
});

describe('parseProjektDatei — art/bereiche kommen unverändert mit', () => {
  it('Rundlauf über serialisiereProjekt behält art und bereiche', async () => {
    const obj = serialisiereProjekt({ Project: [] }, 'Test', { art: 'weitergabe', bereiche: [] });
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const gelesen = await parseProjektDatei(bytes);
    assert.equal(gelesen.art, 'weitergabe');
    assert.deepEqual(gelesen.bereiche, []);
  });
});
