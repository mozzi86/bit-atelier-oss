// browserSpeicher.test.js — the guard behind the browser-storage registry
// (Plan 80-05, EINST-04). Why a guard and not just a hand-kept list: the OLD
// cookie-policy table (rechtstexte.jsx) was already a hand-kept list and had
// already drifted from the code — "bit-atelier-rundgang" (the tour) and
// "bit-atelier-sicherung-spaeter" (the header's save-later snooze) were both
// missing from it (57-06 finding G-4). This test scans the real source tree
// for every storage key the app reads or writes and fails the build the moment
// a new one appears without a matching registry row — the same shape as
// personalLeck.test.js's allowlist scan, applied to storage keys instead of a
// forbidden name.
//
// What counts as "a storage key in the code" (review follow-up 80-05: the
// first version only looked at constants in files that ALSO had an inline
// literal call — which is none of the files that own a key symbolically, so
// the scan saw 4 of 17 keys and would have let the two G-4 keys go missing
// again unnoticed):
// 1. the first argument of every `.getItem(` / `.setItem(` / `.removeItem(`
//    call, whatever the receiver (localStorage, window.sessionStorage, or an
//    injected storage parameter like rundgangSchritte.js's `speicher`) — the
//    Web Storage API is the only thing in this code base with these method
//    names, and a false hit would surface as a visible failure, never as a
//    silent pass:
//    - a string literal → taken as is;
//    - an identifier → resolved against `const/let/var NAME = '…'` in the same
//      file, else through a named import to `export const NAME = '…'` in any
//      scanned file (DatenschutzBereich.jsx imports RUNDGANG_SCHLUESSEL);
//    - an identifier named `…KEY`/`…SCHLUESSEL` that resolves to nothing, or a
//      template literal with a placeholder, fails the test as "not
//      resolvable" — a key the guard cannot see is exactly the drift it exists
//      to prevent. Other identifiers that resolve to nothing (`k` in a loop
//      over the registry itself) are dynamic and stay out.
// 2. every `…KEY`/`…SCHLUESSEL` string constant in a file that contains at
//    least one such call (any argument form) — catches a key passed through a
//    small local wrapper function. A file without any storage call stays out
//    (idsEditorKern.js's SPECS_KEY is a setting name, not a storage key).
//
// New keys — including ones Spur B introduces later in this phase — belong in
// browserSpeicher.js FIRST; this test is what enforces that.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BROWSER_SCHLUESSEL,
  richtlinienZeilen,
} from '../../packages/nova-core/src/lib/browserSpeicher.js';

const REPO = path.resolve(import.meta.dirname, '../..');
const CODE_EXT = /\.jsx?$/;
const SCHLUESSEL_NAME = /(?:KEY|SCHLUESSEL)$/;

/** `.getItem(` / `.setItem(` / `.removeItem(` and its first argument: group 2 = quote, 3 = literal body, 4 = identifier. */
const AUFRUF_MUSTER = /\.(getItem|setItem|removeItem)\(\s*(?:(['"`])((?:(?!\2)[^\\\n]|\\.)*)\2|([A-Za-z_$][\w$]*)(?=\s*[,)]))/g;
/** Any other first-argument form of such a call (member expression, call, …) — only used to decide "this file touches storage". */
const AUFRUF_ROH = /\.(?:getItem|setItem|removeItem)\(/;
/** `[export] const|let|var NAME = '…'` with nothing but a terminator after the literal (so `'a' + b` is not taken as 'a'). */
const DEKLARATION_MUSTER = /(^|[^\w$.])(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:(?!\4)[^\\\n]|\\.)*)\4(?=\s*(?:[;,)\n]|\/\/|\/\*|$))/g;
/** `import [Default,] { A, B as C } from '…'`. */
const IMPORT_MUSTER = /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;

/**
 * Every js/jsx file under one directory, recursively (node_modules excluded,
 * test files excluded — a test fixture is not production storage usage).
 * @param {string} absOrdner
 * @returns {string[]} absolute paths
 */
function dateienUnter(absOrdner) {
  if (!fs.existsSync(absOrdner)) return [];
  const dateien = [];
  const laufe = (ordner) => {
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (eintrag.name === 'node_modules') continue;
      const p = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) laufe(p);
      else if (CODE_EXT.test(eintrag.name) && !eintrag.name.endsWith('.test.js')) dateien.push(p);
    }
  };
  laufe(absOrdner);
  return dateien;
}

/**
 * Every source file the scan covers: src/** and packages/*\/src/**.
 * @param {string} root repo root, or a synthetic temp tree for the self-tests
 * @returns {string[]} absolute paths
 */
function alleQuelldateien(root) {
  const dateien = [...dateienUnter(path.join(root, 'src'))];
  const paketeOrdner = path.join(root, 'packages');
  if (fs.existsSync(paketeOrdner)) {
    for (const paket of fs.readdirSync(paketeOrdner)) {
      dateien.push(...dateienUnter(path.join(paketeOrdner, paket, 'src')));
    }
  }
  return dateien;
}

/**
 * String constants of one file text.
 * @param {string} text
 * @returns {{alle: Map<string, Set<string>>, exportiert: Map<string, Set<string>>}} name → literal values
 */
function deklarationen(text) {
  const alle = new Map();
  const exportiert = new Map();
  const merke = (karte, name, wert) => {
    if (!karte.has(name)) karte.set(name, new Set());
    karte.get(name).add(wert);
  };
  for (const t of text.matchAll(DEKLARATION_MUSTER)) {
    const [, , istExport, name, quote, wert] = t;
    if (quote === '`' && wert.includes('${')) continue; // not a constant
    merke(alle, name, wert);
    if (istExport) merke(exportiert, name, wert);
  }
  return { alle, exportiert };
}

/**
 * Local name → imported name for every named import of one file text.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function importNamen(text) {
  const namen = new Map();
  for (const t of text.matchAll(IMPORT_MUSTER)) {
    for (const teil of t[1].split(',')) {
      const m = teil.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (m) namen.set(m[2] || m[1], m[1]);
    }
  }
  return namen;
}

/**
 * Every storage key the source tree uses (see the file header for the rules).
 * @param {string} root
 * @returns {{literale: Set<string>, fundstellen: Map<string, string>, unaufgeloest: string[]}}
 *   fundstellen: key → first file it was found in (relative, POSIX);
 *   unaufgeloest: "file: argument" for every key argument the scan cannot resolve
 */
function gefundeneLiterale(root) {
  const dateien = alleQuelldateien(root).map((abs) => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    text: fs.readFileSync(abs, 'utf8'),
  }));

  // Repo-wide exported string constants, for identifiers a file imports.
  /** @type {Map<string, Set<string>>} */
  const exporte = new Map();
  for (const d of dateien) {
    d.dekl = deklarationen(d.text);
    for (const [name, werte] of d.dekl.exportiert) {
      if (!exporte.has(name)) exporte.set(name, new Set());
      for (const w of werte) exporte.get(name).add(w);
    }
  }

  const literale = new Set();
  const fundstellen = new Map();
  const unaufgeloest = [];
  const merke = (wert, rel) => {
    literale.add(wert);
    if (!fundstellen.has(wert)) fundstellen.set(wert, rel);
  };

  for (const { rel, text, dekl } of dateien) {
    if (!AUFRUF_ROH.test(text)) continue;
    const importe = importNamen(text);
    for (const t of text.matchAll(AUFRUF_MUSTER)) {
      const [, , quote, wert, bezeichner] = t;
      if (quote) {
        if (quote === '`' && wert.includes('${')) unaufgeloest.push(`${rel}: \`${wert}\``);
        else merke(wert, rel);
        continue;
      }
      const lokal = dekl.alle.get(bezeichner);
      const importiert = importe.has(bezeichner) ? exporte.get(importe.get(bezeichner)) : undefined;
      const werte = lokal || importiert;
      if (werte && werte.size) {
        for (const w of werte) merke(w, rel);
      } else if (SCHLUESSEL_NAME.test(bezeichner)) {
        unaufgeloest.push(`${rel}: ${bezeichner}`);
      }
    }
    for (const [name, werte] of dekl.alle) {
      if (!SCHLUESSEL_NAME.test(name)) continue;
      for (const w of werte) merke(w, rel);
    }
  }
  return { literale, fundstellen, unaufgeloest };
}

/**
 * Keys the scan finds but the given registry key set lacks.
 * @param {string} root
 * @param {Set<string>} registrySchluessel
 * @returns {string[]}
 */
function fehlendeSchluessel(root, registrySchluessel) {
  const { literale } = gefundeneLiterale(root);
  return [...literale].filter((k) => !registrySchluessel.has(k)).sort();
}

/** The registry's own key set (rows without a single key — IndexedDB, Cache Storage — left out). */
const REGISTRY = new Set(BROWSER_SCHLUESSEL.map((e) => e.schluessel).filter(Boolean));

// Written by the supabase-js library, not by app code — there is no literal to
// find (the project ref is part of the key), see 80-05-PLAN.md Task 1's table.
const OHNE_CODEFUNDSTELLE = new Set(['sb-…-auth-token']);

/**
 * Writes a synthetic source tree for one self-test and runs `fn` on its root.
 * @param {Record<string, string>} dateien relative path → file text
 * @param {(root: string) => void} fn
 */
function mitFixture(dateien, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-browserspeicher-selbsttest-'));
  try {
    for (const [rel, text] of Object.entries(dateien)) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, 'utf8');
    }
    fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('browserSpeicher — Registry und Wächter (EINST-04, 57-06 G-4)', () => {
  it('BROWSER_SCHLUESSEL hat mindestens 14 Einträge', () => {
    // 20 until 83-02; the six demo keys went with the online demo.
    assert.ok(BROWSER_SCHLUESSEL.length >= 14, `nur ${BROWSER_SCHLUESSEL.length}`);
  });

  it('jeder im Code gefundene Schlüssel steht in der Registry (0 fehlend)', () => {
    const { literale, fundstellen } = gefundeneLiterale(REPO);
    const fehlend = [...literale].filter((k) => !REGISTRY.has(k));
    assert.deepEqual(
      fehlend,
      [],
      'im Code verwendet, aber nicht in BROWSER_SCHLUESSEL:\n'
        + fehlend.map((k) => `  ${k} (${fundstellen.get(k)})`).join('\n'),
    );
  });

  it('jedes Schlüssel-Argument im Code ist auflösbar (0 unaufgelöst)', () => {
    const { unaufgeloest } = gefundeneLiterale(REPO);
    assert.deepEqual(unaufgeloest, [], 'Speicheraufruf mit einem Schlüssel, den der Wächter nicht auflösen kann:\n  ' + unaufgeloest.join('\n  '));
  });

  it('Rückrichtung: jeder Registry-Schlüssel wird im Code gefunden (Wächter sieht die symbolischen Besitzer)', () => {
    // Also the proof that the scan actually reaches the files that own a key
    // through a constant (demoDb, SpeicherStatus …; the demo gate and tour files
    // were removed in 83-02)
    // — the first version of this guard found 4 keys, this line would have
    // failed it on 13 of them.
    const { literale } = gefundeneLiterale(REPO);
    const nichtGefunden = [...REGISTRY].filter((k) => !OHNE_CODEFUNDSTELLE.has(k) && !literale.has(k));
    assert.deepEqual(nichtGefunden, [], 'in BROWSER_SCHLUESSEL, aber nirgends im Code gefunden:\n  ' + nichtGefunden.join('\n  '));
  });

  it('Mutation: ohne die G-4-Zeile meldet der Wächter genau diese als fehlend', () => {
    // The second G-4 row (the demo tour) went with the demo in 83-02.
    const verkuerzt = new Set(REGISTRY);
    verkuerzt.delete('bit-atelier-sicherung-spaeter');
    assert.deepEqual(fehlendeSchluessel(REPO, verkuerzt), ['bit-atelier-sicherung-spaeter']);
  });

  it('Selbsttest: ein neues Literal im Aufruf wird als fehlend erkannt', () => {
    mitFixture({ 'src/demo/x.js': "localStorage.setItem('neu-x', 1);\n" }, (root) => {
      assert.deepEqual(fehlendeSchluessel(root, REGISTRY), ['neu-x']);
    });
  });

  it('Selbsttest: Konstante in derselben Datei, OHNE jeden Literal-Aufruf, wird erkannt (auch nackt KEY)', () => {
    mitFixture({
      'src/demo/a.jsx': 'const STREIFEN_NEU_KEY = "neu-a";\nexport function f() { return localStorage.getItem(STREIFEN_NEU_KEY); }\n',
      'src/demo/b.js': "const KEY = 'neu-b';\nconst MAX = 250;\nwindow.sessionStorage.removeItem(KEY);\n",
    }, (root) => {
      assert.deepEqual(fehlendeSchluessel(root, REGISTRY), ['neu-a', 'neu-b']);
    });
  });

  it('Selbsttest: injizierter Speicher-Parameter und importierte Konstante (mit as) werden erkannt', () => {
    mitFixture({
      'src/demo/quelle.js': 'export const NEU_SCHLUESSEL = "neu-c";\n',
      'src/demo/nutzer.jsx': 'import { NEU_SCHLUESSEL as S_KEY } from "./quelle.js";\nexport const g = (speicher) => speicher.setItem(S_KEY, "1");\n',
    }, (root) => {
      assert.deepEqual(fehlendeSchluessel(root, REGISTRY), ['neu-c']);
    });
  });

  it('Selbsttest: Wrapper-Funktion — die …KEY-Konstante einer Datei mit Speicheraufruf zählt auch ohne direkten Bezug', () => {
    mitFixture({
      'src/demo/w.js': "const NOTIZ_KEY = 'neu-d';\nconst lies = (k) => localStorage.getItem(k);\nexport const notiz = () => lies(NOTIZ_KEY);\n",
    }, (root) => {
      assert.deepEqual(fehlendeSchluessel(root, REGISTRY), ['neu-d']);
    });
  });

  it('Selbsttest: unauflösbare Schlüssel werden gemeldet, Nicht-Speicher-Konstanten ohne Aufruf nicht', () => {
    mitFixture({
      'src/demo/dyn.js': 'const DYN_KEY = "p-" + Date.now();\nlocalStorage.getItem(DYN_KEY);\nlocalStorage.setItem(`v-${1}`, "x");\n',
      'packages/p/src/kern.js': 'export const SPECS_KEY = "eigene_specs";\n',
      'src/demo/schleife.js': "for (const k of ['lang']) localStorage.removeItem(k);\n",
    }, (root) => {
      const { unaufgeloest, literale } = gefundeneLiterale(root);
      assert.deepEqual(unaufgeloest.sort(), ['src/demo/dyn.js: DYN_KEY', 'src/demo/dyn.js: `v-${1}`']);
      assert.ok(!literale.has('eigene_specs'), 'SPECS_KEY ohne Speicheraufruf darf nicht zählen');
      assert.deepEqual([...literale], []);
    });
  });

  it('richtlinienZeilen() deckt alle als inRichtlinie markierten Einträge ab, darunter die neuen', () => {
    const zeilen = richtlinienZeilen();
    assert.equal(zeilen.length, BROWSER_SCHLUESSEL.filter((e) => e.inRichtlinie).length);
    const schluessel = zeilen.map((z) => z.schluessel);
    // 83-02: no demo key may survive in the public cookie policy.
    assert.deepEqual(schluessel.filter((k) => /demo-(agb|user|streifen|protokoll)|rundgang/.test(k || '')), []);
    assert.ok(schluessel.includes('bit-atelier-sicherung-spaeter'), 'bit-atelier-sicherung-spaeter fehlt');
    assert.ok(schluessel.includes('bit-atelier-personal-hinweis'), 'bit-atelier-personal-hinweis fehlt');
  });
});
