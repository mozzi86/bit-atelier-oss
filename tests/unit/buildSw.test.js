// Phase 69-04: PRECACHE/WARMUP split in the service-worker build. Tests run
// against the pure builders in scripts/sw-inhalt.mjs with a fixture directory
// (no real build needed) — plan Task 1: WARMUP contains both WASM (+ the ifc
// chunk, P-10 addendum), PRECACHE contains none, the version hash changes
// when either list changes, an empty WARMUP list does not break.
//
// NOTE: scripts/*.mjs run in plain node without the alias loader — relative
// imports only.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  SHELL_MUSTER, WARMUP_MUSTER,
  ausAssets, bauePrecache, baueWarmup, versionsHash,
} from '../../scripts/sw-inhalt.mjs';

/** Fixture dist folder with representative file names. */
let dist;
before(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-inhalt-test-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.mkdirSync(path.join(dist, 'beispiel'));
  fs.mkdirSync(path.join(dist, 'icons'));
  for (const f of [
    'index-abc123.js',        // shell
    'vendor-def456.js',       // shell
    'motion-ghi789.js',       // shell
    'index-abc123.css',       // shell
    'web-ifc-DaBphSR1.wasm',  // warmup (WASM)
    'planegcs-r8EUavAY.wasm', // warmup (WASM)
    'ifc-XYZ789.js',          // warmup (P-10: largest chunk)
    'karte-LLL111.js',        // lazy route chunk — neither list
  ]) fs.writeFileSync(path.join(dist, 'assets', f), 'x');
  fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(dist, 'beispiel', 'musterprojekt.ifc'), 'IFC');
  fs.writeFileSync(path.join(dist, 'icons', 'icon-192.png'), 'png');
  fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{}');
});

after(() => {
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('sw-inhalt — Listentrennung (69-04)', () => {
  it('PRECACHE enthält Shell, Beispiel, Icons und Manifest — KEIN WASM, keinen ifc-Chunk', () => {
    const p = bauePrecache({ dist, basis: '/demo/', manifest: 'manifest.webmanifest' });
    assert.ok(p.includes('/demo/'), 'Einstieg');
    assert.ok(p.includes('/demo/index.html'));
    assert.ok(p.includes('/demo/assets/index-abc123.js'), 'Shell-JS');
    assert.ok(p.includes('/demo/assets/index-abc123.css'), 'Shell-CSS');
    assert.ok(p.includes('/demo/beispiel/musterprojekt.ifc'), 'Beispielmodell');
    assert.ok(p.includes('/demo/icons/icon-192.png'), 'Icons');
    assert.ok(p.includes('/demo/manifest.webmanifest'), 'Manifest');
    assert.equal(p.some((x) => /\.wasm$/.test(x)), false, 'kein WASM im Precache');
    assert.equal(p.some((x) => /ifc-.*\.js$/.test(x)), false, 'kein ifc-Chunk im Precache');
    assert.equal(p.includes('/demo/assets/karte-LLL111.js'), false, 'lazy Routen-Chunk bleibt draußen');
  });

  it('WARMUP enthält beide WASM UND den ifc-Chunk (P-10), sortiert', () => {
    const w = baueWarmup({ dist, basis: '/demo/' });
    assert.equal(w.length, 3);
    assert.ok(w.includes('/demo/assets/web-ifc-DaBphSR1.wasm'));
    assert.ok(w.includes('/demo/assets/planegcs-r8EUavAY.wasm'));
    assert.ok(w.includes('/demo/assets/ifc-XYZ789.js'));
    assert.deepEqual(w, [...w].sort(), 'sortiert');
  });

  it('leere WARMUP-Liste bricht nicht (leerer assets-Ordner)', () => {
    const leer = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-leer-'));
    fs.mkdirSync(path.join(leer, 'assets'));
    assert.deepEqual(baueWarmup({ dist: leer, basis: '/demo/' }), []);
    // and the version hash still works with an empty warmup list
    assert.match(versionsHash(['/demo/'], []), /^[0-9a-f]{12}$/);
    fs.rmSync(leer, { recursive: true, force: true });
  });

  it('fehlender assets-Ordner → leere Listen statt Crash', () => {
    const leer = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ohne-'));
    assert.deepEqual(ausAssets(leer, WARMUP_MUSTER, '/demo/'), []);
    assert.deepEqual(baueWarmup({ dist: leer, basis: '/demo/' }), []);
    fs.rmSync(leer, { recursive: true, force: true });
  });
});

describe('sw-inhalt — Versions-Hash über BEIDE Listen (69-04)', () => {
  it('ändert sich bei Änderung der PRECACHE-Liste', () => {
    const w = ['/demo/assets/x.wasm'];
    assert.notEqual(versionsHash(['/demo/a'], w), versionsHash(['/demo/b'], w));
  });

  it('ändert sich bei Änderung der WARMUP-Liste (vor 69-04 unmöglich — da gab es nur eine Liste)', () => {
    const p = ['/demo/a'];
    assert.notEqual(versionsHash(p, ['/demo/x.wasm']), versionsHash(p, ['/demo/y.wasm']));
  });

  it('identische Listen → identischer Hash; # trennt die Listen eindeutig', () => {
    assert.equal(versionsHash(['/a'], ['/b']), versionsHash(['/a'], ['/b']));
    // Without the separator, ['a|b'] + [] would equal ['a'] + ['b'].
    assert.notEqual(versionsHash(['/a|/b'], []), versionsHash(['/a'], ['/b']));
  });
});

describe('sw-inhalt — Muster-Tabellen', () => {
  it('SHELL_MUSTER trifft index/vendor/motion JS+CSS, aber kein WASM und keinen ifc-Chunk', () => {
    assert.ok(SHELL_MUSTER.some((m) => m.test('index-abc.js')));
    assert.ok(SHELL_MUSTER.some((m) => m.test('vendor-abc.js')));
    assert.ok(SHELL_MUSTER.some((m) => m.test('motion-abc.js')));
    assert.ok(SHELL_MUSTER.some((m) => m.test('index-abc.css')));
    assert.equal(SHELL_MUSTER.some((m) => m.test('web-ifc-x.wasm')), false);
    assert.equal(SHELL_MUSTER.some((m) => m.test('ifc-XYZ.js')), false);
  });

  it('WARMUP_MUSTER trifft beide WASM + ifc-Chunk, nichts aus der Shell', () => {
    assert.ok(WARMUP_MUSTER.some((m) => m.test('web-ifc-x.wasm')));
    assert.ok(WARMUP_MUSTER.some((m) => m.test('planegcs-x.wasm')));
    assert.ok(WARMUP_MUSTER.some((m) => m.test('ifc-XYZ789.js')));
    assert.equal(WARMUP_MUSTER.some((m) => m.test('index-abc.js')), false);
    assert.equal(WARMUP_MUSTER.some((m) => m.test('vendor-abc.js')), false);
  });
});
