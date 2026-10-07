// 70-07 (register no. 76): the report behind the route error boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { istLadefehler, meldungVon, fehlerBerichtText, STACK_ZEILEN } from '@core/lib/fehlerbericht.js';

describe('istLadefehler', () => {
  it('erkennt die Browsermeldungen eines fehlenden Chunks', () => {
    assert.equal(istLadefehler(new TypeError('Failed to fetch dynamically imported module: https://x/assets/ModelCheck-abc.js')), true);
    assert.equal(istLadefehler(new TypeError('Importing a module script failed.')), true);
    assert.equal(istLadefehler(new Error('error loading dynamically imported module')), true);
    // Vite's preload helper (vite/dist, "Unable to preload CSS for ${dep}"): chunk CSS missing.
    assert.equal(istLadefehler(new Error('Unable to preload CSS for /assets/ComplexDesigner-abc.css')), true);
  });
  it('erkennt ChunkLoadError am Namen', () => {
    const e = new Error('x'); e.name = 'ChunkLoadError';
    assert.equal(istLadefehler(e), true);
  });
  it('Programmfehler und leere Werte sind keine Ladefehler', () => {
    assert.equal(istLadefehler(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
    assert.equal(istLadefehler(null), false);
    assert.equal(istLadefehler(undefined), false);
  });
});

describe('meldungVon', () => {
  it('liest Error, String und Objekt, wirft nie', () => {
    assert.equal(meldungVon(new Error('kaputt')), 'kaputt');
    assert.equal(meldungVon('nur Text'), 'nur Text');
    assert.equal(meldungVon(null), 'Unbekannter Fehler');
    assert.equal(meldungVon({ toString() { throw new Error('x'); } }), 'Unbekannter Fehler');
  });
});

describe('fehlerBerichtText', () => {
  const zeit = new Date('2026-09-23T21:00:00Z');
  it('enthält Zeit, Seite, Art und Meldung', () => {
    const t = fehlerBerichtText({ fehler: new Error('kaputt'), pfad: '/ModelCheck', zeit });
    assert.match(t, /Zeit: 2026-09-23T21:00:00.000Z/);
    assert.match(t, /Seite: \/ModelCheck/);
    assert.match(t, /Art: Programmfehler/);
    assert.match(t, /Meldung: kaputt/);
  });
  it('Ladefehler wird so benannt', () => {
    const t = fehlerBerichtText({ fehler: new TypeError('Failed to fetch dynamically imported module: a.js'), zeit });
    assert.match(t, /Art: Modul konnte nicht geladen werden/);
  });
  it(`kürzt den Stack auf ${STACK_ZEILEN} Zeilen`, () => {
    const e = new Error('tief');
    e.stack = ['Error: tief', ...Array.from({ length: 30 }, (_, i) => `    at f${i} (x.js:${i}:1)`)].join('\n');
    const t = fehlerBerichtText({ fehler: e, zeit });
    const stackTeil = t.split('Stack:\n')[1].split('\n');
    assert.equal(stackTeil.length, STACK_ZEILEN);
  });
  it('ohne Stack kein Stack-Abschnitt', () => {
    assert.doesNotMatch(fehlerBerichtText({ fehler: 'Text', zeit }), /Stack:/);
  });
});
