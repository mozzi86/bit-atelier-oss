// Pure list-building for the service worker (Phase 69-04).
//
// Extracted from build-sw.mjs so the unit test can assert against the built
// lists WITHOUT running the build script (which writes files and exits the
// process — same reason sw-modi.mjs exists since 70-01).
//
// In:  the dist folder path, URL base, manifest name.
// Out: PRECACHE (shell + sample + icons — installed eagerly),
//      WARMUP (the heavy lazily-loaded binaries/chunks — fetched only on the
//      'warmup' message or on first real use), and the version hash over BOTH.
//
// 69-04 split: the first demo visit no longer drags 1.8 MB of WASM (plus the
// 3.58 MB ifc chunk, P-10 addendum) through `install`; the offline promise
// now depends on the warm-up having run (documented in 69-04-SUMMARY).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Everything the shell needs before a single route is opened. */
// Nur das Shell-CSS (index-*.css) — die Karten-CSS gehört zum map-Chunk und
// wird mit ihm nachgeladen, nicht vorgehalten.
export const SHELL_MUSTER = [/^index-.*\.js$/, /^vendor-.*\.js$/, /^motion-.*\.js$/, /^index-.*\.css$/];

/**
 * Heavy, lazily-loaded files (69-04): the two WASM binaries (1.8 MB) AND the
 * ifc-*.js chunk (3.58 MB, largest chunk — P-10 addendum). They join the
 * cache only on the 'warmup' message or on first real use (the fetch handler
 * already caches assets/ cache-first at runtime).
 */
export const WARMUP_MUSTER = [/web-ifc.*\.wasm$/, /planegcs.*\.wasm$/, /^ifc-.*\.js$/];

/**
 * Files below <dist>/assets matching any of the patterns, as base-relative URLs.
 * @param {string} dist absolute path of the build folder
 * @param {RegExp[]} muster
 * @param {string} basis URL base (leading and trailing slash)
 * @returns {string[]} sorted paths including the base prefix
 */
export function ausAssets(dist, muster, basis) {
  const dir = path.join(dist, 'assets');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => muster.some((m) => m.test(f)))
    .map((f) => `${basis}assets/${f}`)
    .sort();
}

/** The sample model — without it the offline demo has nothing to show. */
function beispielDateien(dist, basis) {
  const dir = path.join(dist, 'beispiel');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => `${basis}beispiel/${f}`).sort();
}

/**
 * Builds the PRECACHE list (shell + sample model + icons + manifest).
 * @param {{dist: string, basis: string, manifest: string}} p
 * @returns {string[]}
 */
export function bauePrecache({ dist, basis, manifest }) {
  return [
    basis, // /demo/ selbst — der Einstieg
    `${basis}index.html`,
    ...ausAssets(dist, SHELL_MUSTER, basis),
    ...beispielDateien(dist, basis),
    ...(fs.existsSync(path.join(dist, manifest)) ? [`${basis}${manifest}`] : []),
    ...(fs.existsSync(path.join(dist, 'icons'))
      ? fs.readdirSync(path.join(dist, 'icons')).map((f) => `${basis}icons/${f}`).sort()
      : []),
  ];
}

/**
 * Builds the WARMUP list (heavy lazily-loaded binaries/chunks). An empty
 * assets folder yields an empty list — the worker must still build (plan
 * Task 1: "leere WARMUP-Liste bricht nicht").
 * @param {{dist: string, basis: string}} p
 * @returns {string[]}
 */
export function baueWarmup({ dist, basis }) {
  return ausAssets(dist, WARMUP_MUSTER, basis);
}

/**
 * Version hash over BOTH lists: a change in either list means a new cache —
 * otherwise an installed PWA would keep a stale warm-up set (the 70-01 lesson
 * about fixed cache names, extended to the split lists).
 * @param {string[]} precache
 * @param {string[]} warmup
 * @returns {string} first 12 hex chars of a sha1
 */
export function versionsHash(precache, warmup) {
  return crypto
    .createHash('sha1')
    .update(`${precache.join('|')}#${warmup.join('|')}`)
    .digest('hex')
    .slice(0, 12);
}
