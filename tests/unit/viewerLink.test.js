// Phase 65-05: shareable viewer links. The round trip is the contract — a link
// that comes back as a slightly different camera is worse than no link, because
// the person who receives it believes they are looking at the same thing.
//
// The rejection cases matter too: a link carries user-editable text, and a
// half-parsed state would put the camera somewhere arbitrary.
//
// 72-16 (N-18): the full link follows the router of the build. Serverless
// (HashRouter) keeps the 65-05 form basis + "#/" + route; Express and cloud
// (BrowserRouter) get origin + base path + route without "#/". Under node the
// build is not serverless, so the hash-form cases name { serverlos: true }.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serialisiereZustand, parseZustand, viewerLink } from '@ifc/lib/viewerLink.js';

const ZUSTAND = {
  cam: { pos: [12.345, -3.2, 40.0], target: [0, 1.5, 0] },
  sel: '3_VBElciFeIeExQx_$ZOnK',
  filter: { kollision: true, ids: true, versteckt: false },
};

describe('viewerLink — serialisieren', () => {
  it('rundet auf Zentimeter', () => {
    const s = serialisiereZustand(ZUSTAND);
    assert.match(s, /cam=12\.35%2C-3\.2%2C40|cam=12\.35,-3\.2,40/);
  });

  it('nimmt nur gesetzte Filter, alphabetisch', () => {
    const p = new URLSearchParams(serialisiereZustand(ZUSTAND));
    assert.equal(p.get('f'), 'ids,kollision', 'nicht gesetzte Flags fallen weg, Reihenfolge stabil');
  });

  it('ist stabil: gleicher Zustand, gleiche Zeichenkette', () => {
    assert.equal(serialisiereZustand(ZUSTAND), serialisiereZustand(structuredClone(ZUSTAND)));
  });

  it('Reihenfolge der Filter-Schlüssel im Objekt ändert den Link nicht', () => {
    const a = serialisiereZustand({ filter: { b: true, a: true } });
    const b = serialisiereZustand({ filter: { a: true, b: true } });
    assert.equal(a, b);
  });

  it('leerer Zustand ergibt eine leere Zeichenkette', () => {
    assert.equal(serialisiereZustand({}), '');
    assert.equal(serialisiereZustand(), '');
  });
});

describe('viewerLink — Rundlauf', () => {
  it('parse(serialisiere(z)) ergibt denselben Zustand', () => {
    const zurueck = parseZustand(serialisiereZustand(ZUSTAND));
    assert.deepEqual(zurueck.cam.pos, [12.35, -3.2, 40]);
    assert.deepEqual(zurueck.cam.target, [0, 1.5, 0]);
    assert.equal(zurueck.sel, ZUSTAND.sel);
    assert.deepEqual(zurueck.filter, { ids: true, kollision: true });
  });

  it('GlobalId mit $ und _ übersteht die URL-Kodierung', () => {
    const id = '3_VBElciFeIeExQx_$ZOnK';
    const zurueck = parseZustand(serialisiereZustand({ sel: id }));
    assert.equal(zurueck.sel, id);
  });

  it('nur eine Auswahl, ohne Kamera, ist ein gültiger Zustand', () => {
    const zurueck = parseZustand(serialisiereZustand({ sel: 'abc' }));
    assert.deepEqual(zurueck, { sel: 'abc' });
  });
});

describe('viewerLink — was abgelehnt wird', () => {
  it('leere Eingabe', () => {
    assert.equal(parseZustand(''), null);
    assert.equal(parseZustand(null), null);
    assert.equal(parseZustand(undefined), null);
  });

  it('Unsinn statt Zahlen: die Kamera bleibt weg statt auf NaN zu springen', () => {
    assert.equal(parseZustand('cam=abc'), null);
    assert.equal(parseZustand('cam=1,2'), null, 'zu wenige Achsen');
    assert.equal(parseZustand('cam=1,2,3,4'), null, 'zu viele Achsen');
  });

  it('Kamera ohne Ziel ist erlaubt, das Ziel bleibt null', () => {
    const z = parseZustand('cam=1,2,3');
    assert.deepEqual(z.cam.pos, [1, 2, 3]);
    assert.equal(z.cam.target, null);
  });

  it('NaN in einer Achse verwirft die ganze Kamera', () => {
    assert.equal(parseZustand('cam=1,NaN,3'), null);
  });
});

const HASH = { serverlos: true };
const EXPRESS = { serverlos: false, base: '/' };

describe('viewerLink — vollständiger Link (serverlos, HashRouter)', () => {
  it('setzt Route und Query hinter den Hash', () => {
    const l = viewerLink('https://bit-atelier.de/demo/', 'IfcViewer', { sel: 'abc' }, HASH);
    assert.equal(l, 'https://bit-atelier.de/demo/#/IfcViewer?sel=abc');
  });

  it('ohne Zustand kein Fragezeichen', () => {
    assert.equal(
      viewerLink('https://bit-atelier.de/demo/', 'IfcViewer', {}, HASH),
      'https://bit-atelier.de/demo/#/IfcViewer',
    );
  });

  it('die Basis bleibt unverändert, auch mit Suchteil', () => {
    assert.equal(
      viewerLink('https://bit-atelier.de/demo/?projekt=proj-1', 'IfcViewer', { sel: 'abc' }, HASH),
      'https://bit-atelier.de/demo/?projekt=proj-1#/IfcViewer?sel=abc',
    );
  });
});

describe('viewerLink — vollständiger Link (Express/Cloud, BrowserRouter)', () => {
  it('liefert …/IfcViewer?sel=… ohne "#/"', () => {
    const l = viewerLink('http://localhost:3000/BimViewer', 'IfcViewer', { sel: 'abc' }, EXPRESS);
    assert.equal(l, 'http://localhost:3000/IfcViewer?sel=abc');
    assert.ok(!l.includes('#'), 'kein Hash');
  });

  it('der aktuelle Routenpfad der Basis klebt nicht davor', () => {
    // Callers pass origin + pathname; in the BrowserRouter the pathname IS the
    // current page ("/BimViewer") - the old form produced "/BimViewer#/IfcViewer".
    const l = viewerLink('https://app.example/BimViewer', 'IfcViewer', { sel: 'abc' }, EXPRESS);
    assert.ok(!l.includes('/BimViewer'), l);
    assert.equal(l, 'https://app.example/IfcViewer?sel=abc');
  });

  it('Basispfad des Builds wird vorangestellt', () => {
    assert.equal(
      viewerLink('https://app.example/app/BimViewer', 'IfcViewer', { sel: 'abc' }, { serverlos: false, base: '/app/' }),
      'https://app.example/app/IfcViewer?sel=abc',
    );
  });

  it('ohne Zustand kein Fragezeichen', () => {
    assert.equal(viewerLink('https://app.example/', 'IfcViewer', {}, EXPRESS), 'https://app.example/IfcViewer');
  });

  it('der Zustand übersteht den Rundlauf auch hier', () => {
    const l = viewerLink('https://app.example/BimViewer', 'IfcViewer', ZUSTAND, EXPRESS);
    const zurueck = parseZustand(new URL(l).search);
    assert.equal(zurueck.sel, ZUSTAND.sel);
    assert.deepEqual(zurueck.cam.pos, [12.35, -3.2, 40]);
    assert.deepEqual(zurueck.filter, { ids: true, kollision: true });
  });

  it('ohne Angabe folgt der Modus dem Build (unter node: kein serverloser Build)', () => {
    const l = viewerLink('https://app.example/BimViewer', 'IfcViewer', { sel: 'abc' });
    assert.equal(l, 'https://app.example/IfcViewer?sel=abc');
  });
});
