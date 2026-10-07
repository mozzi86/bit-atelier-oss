// Shared size reporting for build outputs (57-05, extracted from the former demo
// deploy script, removed with the demo in 83-02).
//
// Why shared: the demo deploy has measured its bundle since 65-03, and the cloud
// build needs the same numbers. Two copies would drift, and the first paint size
// is exactly the number nobody should be allowed to guess.
//
// In:  a build directory. Out: per-file raw/gzip sizes and the first-paint total.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Types worth gzipping; images/fonts are already compressed. */
const KOMPRIMIERBAR = /\.(js|mjs|css|html|json|svg|ifc|ids|xml|txt|md|webmanifest)$/i;

/**
 * Byte size of a file, raw and gzip.
 * @param {string} datei absolute path
 * @returns {{roh: number, gz: number|null}} gz is null for already-compressed types
 */
export function groesse(datei) {
  const inhalt = fs.readFileSync(datei);
  return {
    roh: inhalt.length,
    gz: KOMPRIMIERBAR.test(datei) ? zlib.gzipSync(inhalt).length : null,
  };
}

/**
 * Every file below a directory, as paths relative to it.
 * @param {string} wurzel directory to walk
 * @param {string} [praefix] internal, for recursion
 * @returns {string[]} relative paths, unsorted
 */
export function alleDateien(wurzel, praefix = '') {
  const raus = [];
  for (const e of fs.readdirSync(path.join(wurzel, praefix), { withFileTypes: true })) {
    const rel = praefix ? `${praefix}/${e.name}` : e.name;
    if (e.isDirectory()) raus.push(...alleDateien(wurzel, rel));
    else raus.push(rel);
  }
  return raus;
}

/**
 * Human size in KB, German decimal comma.
 * @param {number} n bytes
 * @returns {string} e.g. "142,7 KB"
 */
export function kb(n) {
  return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
}

/**
 * Measures a build directory.
 *
 * `erstePaintGz` is what the browser fetches before the first paint: the entry
 * script, every modulepreload and the stylesheet named in index.html. That is
 * the number that decides whether the app feels instant on a site visit.
 * @param {string} dist absolute path of the build output
 * @param {string} [base] public base path as it appears in index.html, e.g. "/" or "/demo/"
 * @returns {{ zeilen: Array<{rel: string, roh: number, gz: number|null}>,
 *   gesamtRoh: number, gesamtGz: number, erstePaintGz: number, erstePaintDateien: string[] }}
 */
export function messeBuild(dist, base = '/') {
  const zeilen = alleDateien(dist).sort().map((rel) => ({ rel, ...groesse(path.join(dist, rel)) }));
  const gesamtRoh = zeilen.reduce((s, z) => s + z.roh, 0);
  const gesamtGz = zeilen.reduce((s, z) => s + (z.gz ?? z.roh), 0);

  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const muster = new RegExp(`(?:href|src)="${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^"]+)"`, 'g');
  const erstePaintDateien = [...new Set([...html.matchAll(muster)].map((m) => m[1]))];
  const erstePaintGz = erstePaintDateien.reduce(
    (s, rel) => s + (zeilen.find((z) => z.rel === rel)?.gz ?? 0),
    0
  );

  return { zeilen, gesamtRoh, gesamtGz, erstePaintGz, erstePaintDateien };
}

/**
 * Markdown report of a measured build.
 * @param {ReturnType<typeof messeBuild>} messung result of messeBuild
 * @param {string} titel headline, e.g. "Cloud-Build (app.bit-atelier.de)"
 * @returns {string} markdown
 */
export function berichtMarkdown(messung, titel) {
  const kopf = [
    `# ${titel}`,
    '',
    `Gemessen: ${new Date().toISOString().slice(0, 10)}`,
    '',
    `- **Erste Runde (vor dem ersten Bild): ${kb(messung.erstePaintGz)} gzip**`,
    `- Gesamt: ${kb(messung.gesamtGz)} gzip · ${kb(messung.gesamtRoh)} roh · ${messung.zeilen.length} Dateien`,
    '',
    '| Datei | roh | gzip |',
    '|---|---|---|',
  ];
  const zeilen = messung.zeilen
    .slice()
    .sort((a, b) => (b.gz ?? b.roh) - (a.gz ?? a.roh))
    .map((z) => `| \`${z.rel}\` | ${kb(z.roh)} | ${z.gz === null ? '—' : kb(z.gz)} |`);
  return [...kopf, ...zeilen, ''].join('\n');
}
