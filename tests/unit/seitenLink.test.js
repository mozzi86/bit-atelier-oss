// Unit tests for packages/nova-core/src/lib/seitenLink.js (72-16, N-18).
//
// The contract: one absolute link per page that works in the router of the
// running build. Serverless builds (demo, lokal) use a HashRouter below their
// document path, Express and cloud a BrowserRouter at the base path. A link built
// for the wrong family leaves the app - that is the dead end this item closes.
// The environment is injected, so both families are testable under node.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seitenUrl, rechtsRueckweg, PROJEKT_PARAMETER } from '@core/lib/seitenLink.js';

const DEMO = {
  serverlos: true,
  origin: 'https://bit-atelier.de',
  pathname: '/demo/',
  search: '',
  base: '/demo/',
};

const SERVER = {
  serverlos: false,
  origin: 'https://buero.example',
  pathname: '/BimViewer',
  search: '',
  base: '/app/',
};

describe('seitenUrl — HashRouter (serverlos, /demo/)', () => {
  it('setzt die Route hinter "#/" unter dem Dokumentpfad', () => {
    assert.equal(seitenUrl('IfcViewer', { sel: 'abc' }, DEMO), 'https://bit-atelier.de/demo/#/IfcViewer?sel=abc');
  });

  it('führender Schrägstrich der Route ändert nichts', () => {
    assert.equal(seitenUrl('/IfcViewer', {}, DEMO), seitenUrl('IfcViewer', {}, DEMO));
  });

  it('übernimmt ?projekt= vor die Raute, wo ProjectContext es liest', () => {
    const url = seitenUrl('IfcViewer', { sel: 'abc' }, { ...DEMO, search: '?projekt=proj-1&foo=bar' });
    assert.equal(url, 'https://bit-atelier.de/demo/?projekt=proj-1#/IfcViewer?sel=abc');
    assert.ok(!url.includes('foo=bar'), 'nur das Projekt reist mit, keine fremden Parameter');
  });

  it('ein ausdrückliches projekt in der Query gewinnt und steht vor der Raute', () => {
    const url = seitenUrl('BimViewer', { projekt: 'proj-3', ticket: 'iss-1' }, { ...DEMO, search: '?projekt=proj-1' });
    assert.equal(url, 'https://bit-atelier.de/demo/?projekt=proj-3#/BimViewer?ticket=iss-1');
  });

  it('die Route darf eine eigene Query tragen', () => {
    assert.equal(
      seitenUrl('ComplexDesigner?tab=bim', {}, DEMO),
      'https://bit-atelier.de/demo/#/ComplexDesigner?tab=bim',
    );
  });
});

describe('seitenUrl — BrowserRouter (Express/Cloud, Basis /app/)', () => {
  it('Basis + Route ohne Raute, der Pfad der aktuellen Seite zählt nicht', () => {
    const url = seitenUrl('IfcViewer', { sel: 'abc' }, SERVER);
    assert.equal(url, 'https://buero.example/app/IfcViewer?sel=abc');
    assert.ok(!url.includes('#'), 'kein Hash im BrowserRouter-Link');
    assert.ok(!url.includes('/BimViewer'), 'der aktuelle Routenpfad klebt nicht davor');
  });

  it('kein doppelter Schrägstrich, egal wie Basis und Route geschrieben sind', () => {
    for (const base of ['/app/', '/app', 'app/', 'app']) {
      assert.equal(seitenUrl('/IfcViewer', {}, { ...SERVER, base }), 'https://buero.example/app/IfcViewer');
    }
    assert.equal(seitenUrl('IfcViewer', {}, { ...SERVER, base: '/' }), 'https://buero.example/IfcViewer');
    assert.equal(seitenUrl('IfcViewer', {}, { ...SERVER, base: '' }), 'https://buero.example/IfcViewer');
  });

  it('übernimmt ?projekt= in die Query der Seite', () => {
    const url = seitenUrl('IfcViewer', { sel: 'abc' }, { ...SERVER, search: '?projekt=proj-1' });
    assert.equal(url, 'https://buero.example/app/IfcViewer?sel=abc&projekt=proj-1');
  });

  it('ein ausdrückliches projekt in der Query gewinnt', () => {
    const url = seitenUrl('Finance', { projekt: 'proj-2' }, { ...SERVER, search: '?projekt=proj-1' });
    assert.equal(url, 'https://buero.example/app/Finance?projekt=proj-2');
  });

  it('ohne origin bleibt der Link relativ zur Basis', () => {
    assert.equal(seitenUrl('IfcViewer', {}, { ...SERVER, origin: '' }), '/app/IfcViewer');
  });
});

describe('seitenUrl — Query-Formen und leere Werte', () => {
  it('leere Query: kein Fragezeichen, in beiden Formen', () => {
    assert.equal(seitenUrl('IfcViewer', {}, DEMO), 'https://bit-atelier.de/demo/#/IfcViewer');
    assert.equal(seitenUrl('IfcViewer', undefined, DEMO), 'https://bit-atelier.de/demo/#/IfcViewer');
    assert.equal(seitenUrl('IfcViewer', '', SERVER), 'https://buero.example/app/IfcViewer');
  });

  it('undefined, null und leere Zeichenkette fallen weg, 0 und false bleiben', () => {
    const url = seitenUrl('IfcViewer', { a: undefined, b: null, c: '', d: 0, e: false }, SERVER);
    assert.equal(url, 'https://buero.example/app/IfcViewer?d=0&e=false');
  });

  it('Query als Zeichenkette oder URLSearchParams wie als Objekt', () => {
    const erwartet = seitenUrl('IfcViewer', { sel: 'abc', f: 'ids' }, SERVER);
    assert.equal(seitenUrl('IfcViewer', 'sel=abc&f=ids', SERVER), erwartet);
    assert.equal(seitenUrl('IfcViewer', new URLSearchParams({ sel: 'abc', f: 'ids' }), SERVER), erwartet);
  });

  it('kodiert Sonderzeichen der Werte (GlobalId mit $, URL mit & und #)', () => {
    const url = seitenUrl('IfcViewer', { sel: '3_VBElciFeIeExQx_$ZOnK', url: 'http://h/a?b=1&c=2#x' }, DEMO);
    const query = new URLSearchParams(url.split('#/IfcViewer?')[1]);
    assert.equal(query.get('sel'), '3_VBElciFeIeExQx_$ZOnK');
    assert.equal(query.get('url'), 'http://h/a?b=1&c=2#x');
    assert.equal(url.split('#').length, 2, 'nur die Router-Raute bleibt unkodiert');
  });

  it('kaputte search bricht nichts', () => {
    assert.equal(seitenUrl('IfcViewer', {}, { ...SERVER, search: '?%E0%A4%A' }), 'https://buero.example/app/IfcViewer');
  });

  it('der Parametername ist der von ProjectContext', () => {
    assert.equal(PROJEKT_PARAMETER, 'projekt');
  });
});

describe('rechtsRueckweg — kein Weg aus der App hinaus', () => {
  it('Cloud: unverändert zurück zur Anmeldung', () => {
    assert.deepEqual(rechtsRueckweg('supabase'), { ziel: '/anmeldung', text: 'Zurück zur Anmeldung' });
  });

  it('Demo, Client und Express: zurück in die App statt auf die Cloud-Anmeldung', () => {
    for (const quelle of ['serverlos', 'express']) {
      assert.deepEqual(rechtsRueckweg(quelle), { ziel: '/', text: 'Zurück zur App' });
    }
  });
});

describe('seitenUrl — Standardumgebung unter node', () => {
  it('ohne Angabe gilt der laufende Build: unter node kein serverloser Build, Basis "/"', () => {
    // node has no window.location and no import.meta.env: SERVERLOS is false,
    // the base path falls back to "/" and the link is relative.
    assert.equal(seitenUrl('IfcViewer', { sel: 'abc' }), '/IfcViewer?sel=abc');
  });
});
