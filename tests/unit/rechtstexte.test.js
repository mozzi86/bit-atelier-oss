// 57-06 Task 8: the legal texts exist exactly once and are reachable without a
// session. Reads the source tree, not the bundle and not `git grep` (which does
// not see unstaged files). It fails as soon as someone copies a legal text
// instead of using the component, or routes a public page without listing it
// in @core/lib/oeffentlicheWege.js - the mismatch that would put the imprint
// behind the login in the cloud build.
//
// Node cannot load rechtstexte.jsx (JSX), so the checks on that file are
// source checks. The rendered result is measured in
// tests/e2e/rechtstexte-57-06.spec.js against a local cloud build.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { OEFFENTLICHE_WEGE, RECHTSSEITEN, istOeffentlicherWeg } from '@core/lib/oeffentlicheWege';

const WURZEL = path.resolve(import.meta.dirname, '..', '..');
// CRLF → LF: Windows checkouts of public/_headers and the docs carry CRLF.
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n');

/** Every .js/.jsx file under src/ and packages/<pkg>/src (node_modules excluded). */
function quelldateien() {
  const dateien = [];
  const lauf = (ordner) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) lauf(p);
      else if (/\.jsx?$/.test(e.name)) dateien.push(p);
    }
  };
  lauf(path.join(WURZEL, 'src'));
  for (const paket of fs.readdirSync(path.join(WURZEL, 'packages'))) {
    const src = path.join(WURZEL, 'packages', paket, 'src');
    if (fs.existsSync(src)) lauf(src);
  }
  return dateien;
}

/** Files and line numbers where `satz` occurs. */
function fundstellen(satz) {
  const treffer = [];
  for (const d of quelldateien()) {
    fs.readFileSync(d, 'utf8').split('\n').forEach((z, i) => {
      if (z.includes(satz)) treffer.push(`${path.relative(WURZEL, d)}:${i + 1}`);
    });
  }
  return treffer;
}

/** Value of `export const NAME = '…' + '…';` in a source file. */
function stringKonstante(quelle, name) {
  const m = new RegExp(`export const ${name} =([\\s\\S]*?);\\n`).exec(quelle);
  assert.ok(m, `${name} nicht gefunden`);
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]).join('');
}

describe('Rechtstexte — eine Quelle', () => {
  it('"Angaben gemäß § 5 DDG" steht genau einmal im Quellbaum, in rechtstexte.jsx', () => {
    const treffer = fundstellen('Angaben gemäß § 5 DDG');
    assert.equal(treffer.length, 1, treffer.join(', '));
    assert.match(treffer[0], /packages[\\/]nova-core[\\/]src[\\/]lib[\\/]rechtstexte\.jsx:/);
  });

  it('der Widerspruchs-Absatz der Datenschutzerklärung steht genau einmal', () => {
    const treffer = fundstellen('Widerspruchsrecht nach Art. 21 DSGVO');
    assert.equal(treffer.length, 1, treffer.join(', '));
  });

  it('rechtstexte.jsx bleibt rein: kein Router, keine Umgebung, kein Netz', () => {
    const q = lies('packages/nova-core/src/lib/rechtstexte.jsx');
    // Imports only: the file header names umgebung.js to say it is NOT used.
    const importe = q.split('\n').filter((z) => /^import /.test(z)).join('\n');
    assert.doesNotMatch(importe, /react-router|umgebung|supabase/i);
    const code = q.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\(|createClient|useState/);
  });

  it('kein Feld in den Rechtstexten trägt einen Platzhalter', () => {
    const q = lies('packages/nova-core/src/lib/rechtstexte.jsx') + lies('packages/nova-core/src/lib/anbieter.js');
    assert.doesNotMatch(q.replace(/^\s*(\/\/|\*).*$/gm, ''), /platzhalter|\bTBD\b|\bXXX\b|musterstr/i);
  });
});

describe('Vergabe-Abgrenzung (E1) und Zielgruppe', () => {
  const q = lies('packages/nova-core/src/lib/rechtstexte.jsx');
  const satz = stringKonstante(q, 'VERGABE_SATZ');

  it('trägt den tragenden zweiten Halbsatz', () => {
    assert.match(satz, /nicht für förmliche öffentliche Vergabeverfahren nach VgV\/UVgO/);
    assert.match(satz, /ein Verschluss der Angebote gegenüber dem Betreiber der Instanz findet technisch nicht statt\.$/);
  });

  // docs/extern/ is private (not in the open-source export) — the check runs only where the file exists.
  it('die Leistungsbeschreibung zitiert ihn zeichengleich', { skip: !fs.existsSync(path.join(WURZEL, 'docs/extern/LEISTUNGSBESCHREIBUNG-STUFE-1.md')) && 'docs/extern ist privat (OSS-Export)' }, () => {
    const md = lies('docs/extern/LEISTUNGSBESCHREIBUNG-STUFE-1.md');
    const block = md.split('**Der verbindliche Abgrenzungssatz.**')[1];
    assert.ok(block, 'Abschnitt "Der verbindliche Abgrenzungssatz" fehlt');
    const zitat = block.split('\n').filter((z) => z.startsWith('>')).map((z) => z.replace(/^>\s?/, '')).join(' ')
      .replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    assert.equal(zitat, satz);
  });

  it('Impressum und Registrierungsseite benutzen die Konstante, nicht eine Kopie', () => {
    assert.ok(q.includes('Architektenleistung. {VERGABE_SATZ}'), 'Impressum nutzt VERGABE_SATZ nicht');
    const reg = lies('packages/nova-core/src/pages/Registrieren.jsx');
    assert.match(reg, /<AngebotsUmfang \/>/);
    assert.equal(fundstellen('dafür nicht zertifiziert; ein Verschluss').length <= 2, true,
      'der Satz steht ausgeschrieben außerhalb von rechtstexte.jsx');
  });
});

describe('Öffentliche Wege — ohne Anmeldung erreichbar', () => {
  const app = lies('src/App.jsx');
  const zweig = app.slice(app.indexOf('if (istOeffentlicherWeg(location.pathname))'));
  const routen = zweig.slice(0, zweig.indexOf('</Routes>'));
  const geroutet = [...routen.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

  it('App.jsx fragt die Liste aus @core ab, statt eine eigene zu führen', () => {
    assert.match(app, /import \{ istOeffentlicherWeg \} from '@core\/lib\/oeffentlicheWege'/);
    assert.ok(zweig.length > 0, 'öffentlicher Zweig nicht gefunden');
  });

  it('jeder öffentliche Weg hat eine Route im öffentlichen Zweig — und umgekehrt', () => {
    assert.deepEqual([...geroutet].sort(), [...OEFFENTLICHE_WEGE].sort());
  });

  it('die fünf Rechtsseiten sind öffentlich und haben eine Seitendatei', () => {
    for (const weg of RECHTSSEITEN) {
      assert.ok(istOeffentlicherWeg(weg), weg);
      const name = weg.slice(1, 2).toUpperCase() + weg.slice(2);
      assert.ok(fs.existsSync(path.join(WURZEL, 'packages/nova-core/src/pages', `${name}.jsx`)), `${name}.jsx fehlt`);
    }
  });

  it('exakter Vergleich: Unterpfade, Großschreibung und App-Routen sind nicht öffentlich', () => {
    assert.equal(istOeffentlicherWeg('/impressum/x'), false);
    assert.equal(istOeffentlicherWeg('/Impressum'), false);
    assert.equal(istOeffentlicherWeg('/AVA'), false);
    assert.equal(istOeffentlicherWeg(''), false);
    assert.equal(istOeffentlicherWeg(/** @type {any} */ (undefined)), false);
  });

  it('Anmeldung, Passwort-Reset und Registrierung verlinken Impressum und Datenschutz per <Link>', () => {
    for (const seite of ['Anmeldung', 'PasswortZuruecksetzen', 'Registrieren']) {
      const q = lies(`packages/nova-core/src/pages/${seite}.jsx`);
      assert.match(q, /<Link to="\/impressum"/, seite);
      assert.match(q, /<Link to="\/datenschutz"/, seite);
    }
  });

  it('angemeldet: die Fußzeile im Inhaltsbereich verlinkt beide, nicht die Seitenleiste', () => {
    const layout = lies('src/Layout.jsx');
    assert.match(layout, /<Link to="\/impressum"/);
    assert.match(layout, /<Link to="\/datenschutz"/);
    const fuss = layout.indexOf('<SidebarFooter');
    const ende = fuss >= 0 ? layout.indexOf('</SidebarFooter>', fuss) : -1;
    const imSidebarFooter = fuss >= 0 && ende > fuss && layout.slice(fuss, ende).includes('/impressum');
    assert.equal(imSidebarFooter, false, 'Impressum-Link sitzt im SidebarFooter (verschwindet eingeklappt)');
  });
});

describe('public/_headers', () => {
  it('setzt die vier Sicherheits-Header für alle Pfade', () => {
    const h = lies('public/_headers');
    const start = h.indexOf('\n/*\n');
    assert.ok(start >= 0, 'Block /* fehlt');
    // The block ends at the next unindented line (the next path rule).
    const allgemein = h.slice(start + 4).split(/\n\S/)[0];
    for (const kopf of [
      'X-Frame-Options: DENY',
      "Content-Security-Policy: frame-ancestors 'none'",
      'Referrer-Policy: strict-origin-when-cross-origin',
      'X-Content-Type-Options: nosniff',
    ]) {
      assert.ok(allgemein.includes(kopf), `${kopf} fehlt im Block /*`);
    }
  });
});
