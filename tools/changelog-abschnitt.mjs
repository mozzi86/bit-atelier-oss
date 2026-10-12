#!/usr/bin/env node
// changelog-abschnitt.mjs — prints the section of ONE version from CHANGELOG.md (plan 92-04).
//
// The release workflow (oss/.github/workflows/release.yml) uses it to build the release notes from the
// changelog instead of a fixed text: the notes of tag v1.2.0 are the "## [1.2.0] - <date>" section,
// word for word. The in-app update banner shows the first lines of exactly these notes.
//
// Format: Keep a Changelog — a version heading is "## [1.2.0] - 2026-10-11" (also accepted: without
// brackets, with a leading "v", with an en dash before the date). The section ends at the next "## "
// heading or at the link reference block ("[1.2.0]: https://…") at the end of the file.
//
// In:  CLI  node tools/changelog-abschnitt.mjs <version> [--datei <CHANGELOG.md>]
// Out: the section body on stdout (without its heading). Exit 1 with a message on stderr when the
//      version has no section or the section is empty — a release without its changelog stops.
// Only node: built-ins (runs in the release job before anything else is needed).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Normalise a version label: drop a leading "v", trim, lower-case (for "Unveröffentlicht").
 * @param {string} v version as written in the tag or heading
 * @returns {string}
 */
function norm(v) {
  return String(v || '').trim().replace(/^v(?=\d)/i, '').toLowerCase();
}

/**
 * Version label of a level-2 heading line, or null when the line is no version heading.
 * @param {string} zeile one line of the changelog
 * @returns {string|null} normalised label, e.g. "1.2.0" or "unveröffentlicht"
 */
export function versionAusUeberschrift(zeile) {
  const m = /^##\s+\[?([^\]\s]+)\]?(?:\s+[-–—]\s+.*)?\s*$/.exec(String(zeile));
  return m ? norm(m[1]) : null;
}

/**
 * The body of one version section.
 * @param {string} text whole CHANGELOG.md
 * @param {string} version e.g. "1.2.0", "v1.2.0" or "Unveröffentlicht"
 * @returns {string|null} section text without its heading, trimmed; null when the version has no section
 */
export function abschnitt(text, version) {
  const ziel = norm(version);
  const zeilen = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const start = zeilen.findIndex((z) => z.startsWith('## ') && versionAusUeberschrift(z) === ziel);
  if (start < 0) return null;
  const rumpf = [];
  for (const z of zeilen.slice(start + 1)) {
    if (z.startsWith('## ') || /^\[[^\]]+\]:\s*\S/.test(z)) break;
    rumpf.push(z);
  }
  return rumpf.join('\n').trim();
}

/**
 * All version labels in file order (normalised), e.g. ["unveröffentlicht", "1.1.0", "1.0.1"].
 * @param {string} text whole CHANGELOG.md
 * @returns {string[]}
 */
export function versionen(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .filter((z) => z.startsWith('## '))
    .map(versionAusUeberschrift)
    .filter((v) => v !== null);
}

function main(argv) {
  const i = argv.indexOf('--datei');
  const datei = i >= 0 ? argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
  const version = argv.find((a, j) => !a.startsWith('--') && argv[j - 1] !== '--datei');
  if (!version) {
    console.error('Usage: node tools/changelog-abschnitt.mjs <version> [--datei CHANGELOG.md]');
    return 2;
  }
  let text;
  try { text = fs.readFileSync(datei, 'utf8'); } catch (e) {
    console.error(`Cannot read ${datei}: ${/** @type {any} */ (e).message}`);
    return 1;
  }
  const teil = abschnitt(text, version);
  if (teil === null) {
    console.error(`CHANGELOG has no section for version ${version} (found: ${versionen(text).join(', ') || 'none'}).`);
    return 1;
  }
  if (!teil) {
    console.error(`The CHANGELOG section of version ${version} is empty.`);
    return 1;
  }
  process.stdout.write(`${teil}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
