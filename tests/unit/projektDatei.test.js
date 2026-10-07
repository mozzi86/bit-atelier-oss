// Phase 65-02: the .bitproj project file. Only the pure half is covered here —
// serialise, parse (plain and gzipped), preview, and every rejection path. The
// download/upload halves need a browser and are verified headless.
//
// The rejection paths matter most: an import replaces the entire database, so a
// file that is not understood must be refused whole, never applied in part.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA,
  serialisiereProjekt,
  parseProjektDatei,
  vorschau,
} from '@core/api/projektDatei.js';

const DATEN = {
  Project: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }],
  Contact: [{ id: 'c1', name: 'Muster' }],
  Leer: [],
};

function alsBytes(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

async function alsGzip(obj) {
  const strom = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

describe('projektDatei — serialisieren', () => {
  it('setzt Schema, App-Kennung und ein ISO-Datum', () => {
    const obj = serialisiereProjekt(DATEN, 'Mein Projekt');
    assert.equal(obj.schema, SCHEMA);
    assert.equal(obj.app, 'bit-atelier-demo');
    assert.equal(obj.projektname, 'Mein Projekt');
    assert.match(obj.exportiert, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(obj.daten, DATEN);
  });

  it('ohne Namen einen Vorgabenamen', () => {
    assert.equal(serialisiereProjekt(DATEN).projektname, 'BIT-Atelier-Demo');
  });
});

describe('projektDatei — Vorschau', () => {
  it('zählt je Sammlung und gesamt', () => {
    const v = vorschau(serialisiereProjekt(DATEN, 'Alpha'));
    assert.equal(v.projektname, 'Alpha');
    assert.deepEqual(v.anzahl, { Project: 2, Contact: 1, Leer: 0 });
    assert.equal(v.gesamt, 3);
  });

  it('kommt mit einem kaputten Objekt klar, statt zu werfen', () => {
    const v = vorschau(null);
    assert.equal(v.gesamt, 0);
    assert.equal(v.projektname, '(ohne Namen)');
  });
});

describe('projektDatei — lesen', () => {
  it('liest die Klartextfassung', async () => {
    const obj = serialisiereProjekt(DATEN, 'Klartext');
    const gelesen = await parseProjektDatei(alsBytes(obj));
    assert.equal(gelesen.projektname, 'Klartext');
    assert.deepEqual(gelesen.daten, DATEN);
  });

  it('liest die gzip-Fassung — Erkennung am ersten Byte', async () => {
    const obj = serialisiereProjekt(DATEN, 'Gepackt');
    const bytes = await alsGzip(obj);
    assert.equal(bytes[0], 0x1f, 'gzip-Magie steht am Anfang');
    const gelesen = await parseProjektDatei(bytes);
    assert.equal(gelesen.projektname, 'Gepackt');
    assert.deepEqual(gelesen.daten, DATEN);
  });

  it('Rundlauf über den ArrayBuffer erhält die Daten', async () => {
    const bytes = alsBytes(serialisiereProjekt(DATEN, 'Rund'));
    const gelesen = await parseProjektDatei(bytes.buffer);
    assert.deepEqual(gelesen.daten, DATEN);
  });
});

describe('projektDatei — was abgelehnt wird', () => {
  it('leere Datei', async () => {
    await assert.rejects(() => parseProjektDatei(new Uint8Array()), /leer/i);
  });

  it('kein JSON', async () => {
    await assert.rejects(
      () => parseProjektDatei(new TextEncoder().encode('das ist kein json')),
      /nicht lesbar/i,
    );
  });

  it('fremde Datei mit gültigem JSON', async () => {
    await assert.rejects(
      () => parseProjektDatei(alsBytes({ app: 'etwas-anderes', schema: 1, daten: {} })),
      /nicht aus der BIT-Atelier-Demo/i,
    );
  });

  it('unbekannte Schema-Version — nennt beide Nummern', async () => {
    await assert.rejects(
      () => parseProjektDatei(alsBytes({ app: 'bit-atelier-demo', schema: 99, daten: {} })),
      /99[\s\S]*erwartet: 1|erwartet: 1[\s\S]*99/,
    );
  });

  it('richtige Kennung, aber keine Daten', async () => {
    await assert.rejects(
      () => parseProjektDatei(alsBytes({ app: 'bit-atelier-demo', schema: SCHEMA })),
      /keine Daten/i,
    );
  });
});
