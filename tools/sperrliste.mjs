// sperrliste.mjs — scanning core of the block-list guard (Plan 83-01).
//
// The block list (real project, client, employer and person names) must not
// stand in the repository in plain text. The repo only carries, per entry, the
// SHA-256 of the normalised fragment, its length, a 32-bit rolling hash as a
// fast pre-filter and whether it only counts as a whole word
// (tests/unit/sperrliste.sha256.json). This module finds those entries in any
// text by sliding a window of the entry's length over the normalised text:
// rolling hash first (cheap, O(n) per distinct length), SHA-256 only on a
// pre-filter hit.
//
// In:  text (string), hashed entries [{nr, laenge, sha256, rk, wort}]
// Out: hits [{nr, pos}] (positions in the normalised text, 0-based)
//
// Used by tests/unit/projektneutral.test.js (guard over all tracked files) and
// .planning/tools/projektnamen-anwenden.mjs (local tool with the plain list).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Base of the 32-bit polynomial rolling hash (odd, > code-unit range of Latin text). */
const BASIS = 257;

/**
 * Normalise for matching: Unicode NFKC, then lower-case per UTF-16 code unit
 * where that keeps the length (so positions stay 1:1 with the NFKC text; the
 * few characters whose lower-case form is longer keep their original form).
 * @param {string} s
 * @returns {string}
 */
export function normalisiere(s) {
  const n = String(s).normalize('NFKC');
  // Fast path: lower-casing never shortens a UTF-16 string, so equal length
  // means no character changed its length and positions are already 1:1.
  const schnell = n.toLowerCase();
  if (schnell.length === n.length) return schnell;
  let o = '';
  for (let i = 0; i < n.length; i++) {
    const c = n[i];
    const l = c.toLowerCase();
    o += l.length === 1 ? l : c;
  }
  return o;
}

/**
 * 32-bit polynomial hash of a whole string (same arithmetic as the rolling scan).
 * @param {string} s normalised fragment
 * @returns {number} unsigned 32-bit
 */
export function rollHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, BASIS) + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * SHA-256 (hex) of a normalised fragment.
 * @param {string} s
 * @returns {string}
 */
export function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Turn a plain entry into its hashed form (what may be committed).
 * @param {{nr: number, fragment: string, wort?: boolean}} e
 * @returns {{nr: number, laenge: number, sha256: string, rk: number, wort: boolean}}
 */
export function hashEintrag(e) {
  const k = normalisiere(e.fragment);
  return { nr: e.nr, laenge: k.length, sha256: sha256(k), rk: rollHash(k), wort: !!e.wort };
}

const ALNUM = /[\p{L}\p{N}]/u;
const ZIFFER = /\p{N}/u;
const BUCHST = /\p{L}/u;

/**
 * Word boundary at the START of a window at index i: a non-alphanumeric
 * neighbour, or a number that follows letters directly ("v2026"). No camelCase
 * rule on purpose — inside base64 values (integrity hashes) it produced random
 * hits for three-letter entries.
 * @param {string} t text
 * @param {number} i window start
 * @returns {boolean}
 */
export function grenzeStart(t, i) {
  const vor = t[i - 1];
  if (vor === undefined || !ALNUM.test(vor)) return true;
  return ZIFFER.test(t[i]) && BUCHST.test(vor);
}

/**
 * Word boundary at the END of a window (j = index after the last character).
 * @param {string} t text
 * @param {number} j window end (exclusive)
 * @returns {boolean}
 */
export function grenzeEnde(t, j) {
  const nach = t[j];
  if (nach === undefined || !ALNUM.test(nach)) return true;
  return ZIFFER.test(t[j - 1]) && BUCHST.test(nach);
}

/**
 * Search index of the hashed entries, built once per scan: per distinct
 * length the factor of the leaving character, a 64k bitmask over the low 16
 * hash bits (cheap first filter) and the rolling hash → entries map.
 * @param {Array<{nr: number, laenge: number, sha256: string, rk: number, wort: boolean}>} eintraege
 * @returns {{eintraege: Array, laengen: Array<{L: number, hoch: number, maske: Uint8Array, nachRk: Map<number, Array>}>}}
 */
export function baueIndex(eintraege) {
  const jeLaenge = new Map();
  for (const e of eintraege) {
    if (!jeLaenge.has(e.laenge)) {
      // B^(L-1) mod 2^32 — factor of the character that leaves the window
      let hoch = 1;
      for (let i = 1; i < e.laenge; i++) hoch = Math.imul(hoch, BASIS) >>> 0;
      jeLaenge.set(e.laenge, { L: e.laenge, hoch, maske: new Uint8Array(65536), nachRk: new Map() });
    }
    const g = jeLaenge.get(e.laenge);
    g.maske[e.rk & 0xffff] = 1;
    if (!g.nachRk.has(e.rk)) g.nachRk.set(e.rk, []);
    g.nachRk.get(e.rk).push(e);
  }
  return { eintraege, laengen: [...jeLaenge.values()] };
}

/**
 * Find all hashed entries in a text.
 * @param {string} text raw text (normalised here)
 * @param {Array|{laengen: Array}} eintraegeOderIndex hashed entries or baueIndex() result
 * @returns {Array<{nr: number, pos: number}>}
 */
export function findeTreffer(text, eintraegeOderIndex) {
  const index = Array.isArray(eintraegeOderIndex) ? baueIndex(eintraegeOderIndex) : eintraegeOderIndex;
  const t = normalisiere(text);
  const treffer = [];
  for (const { L, hoch, maske, nachRk } of index.laengen) {
    if (t.length < L) continue;
    let h = 0;
    for (let i = 0; i < L; i++) h = (Math.imul(h, BASIS) + t.charCodeAt(i)) >>> 0;
    for (let i = 0; ; i++) {
      const kandidaten = maske[h & 0xffff] ? nachRk.get(h) : undefined;
      if (kandidaten) {
        const fenster = t.slice(i, i + L);
        const hex = sha256(fenster);
        for (const e of kandidaten) {
          if (e.sha256 !== hex) continue;
          if (e.wort && !(grenzeStart(t, i) && grenzeEnde(t, i + L))) continue;
          treffer.push({ nr: e.nr, pos: i });
        }
      }
      if (i + L >= t.length) break;
      h = (Math.imul((h - Math.imul(t.charCodeAt(i), hoch)) >>> 0, BASIS) + t.charCodeAt(i + L)) >>> 0;
    }
  }
  return treffer.sort((a, b) => a.pos - b.pos || a.nr - b.nr);
}

/**
 * File types whose CONTENT is not scanned (the file NAME always is). Reason:
 * compressed or binary formats where a byte window cannot hold readable text
 * (images, fonts, wasm, archives) or whose text sits in compressed streams
 * (pdf, xlsx — checked once by text extraction in Plan 83-01). Everything
 * else is scanned regardless of size, explicitly including
 * .ifc/.ids/.bcf/.csv/.json/.md/.txt/.xml/.x8x/.d8x.
 */
export const NUR_DATEINAME = /\.(png|jpe?g|gif|webp|ico|wasm|woff2?|ttf|otf|eot|pdf|xlsx|docx|zip|tgz|gz)$/i;

/**
 * All tracked files of a repository (git ls-files, NUL-separated so umlauts
 * and spaces survive).
 * @param {string} repo absolute path
 * @returns {string[]} repo-relative paths with forward slashes
 */
export function getrackteDateien(repo) {
  return execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1e8 })
    .split('\0')
    .filter((f) => f && fs.existsSync(path.join(repo, f)));
}

/**
 * Scan file names and contents of a list of repo files.
 * @param {string} repo absolute path
 * @param {string[]} dateien repo-relative paths
 * @param {Array} eintraege hashed entries
 * @returns {Array<{datei: string, zeile: number, nr: number, art: 'inhalt'|'dateiname'}>}
 */
export function scanneDateien(repo, dateien, eintraege) {
  const index = baueIndex(eintraege);
  const out = [];
  for (const datei of dateien) {
    for (const t of findeTreffer(datei, index)) out.push({ datei, zeile: 0, nr: t.nr, art: 'dateiname' });
    if (NUR_DATEINAME.test(datei)) continue;
    const text = fs.readFileSync(path.join(repo, datei), 'utf8');
    const treffer = findeTreffer(text, index);
    if (!treffer.length) continue;
    const n = normalisiere(text);
    for (const t of treffer) {
      let zeile = 1;
      for (let i = n.indexOf('\n'); i !== -1 && i < t.pos; i = n.indexOf('\n', i + 1)) zeile++;
      out.push({ datei, zeile, nr: t.nr, art: 'inhalt' });
    }
  }
  return out;
}

/**
 * Hits minus the justified exceptions. An exception allows up to `anzahl`
 * hits of entry `nr` in file `datei` (e.g. a city name inside a place list).
 * @param {Array<{datei: string, zeile: number, nr: number, art: string}>} treffer
 * @param {Array<{datei: string, nr: number, anzahl: number}>} ausnahmen
 * @returns {Array<{datei: string, zeile: number, nr: number, art: string}>} open hits
 */
export function offeneTreffer(treffer, ausnahmen = []) {
  const erlaubt = new Map(ausnahmen.map((a) => [`${a.datei}#${a.nr}`, a.anzahl]));
  const zaehler = new Map();
  for (const t of treffer) {
    const k = `${t.datei}#${t.nr}`;
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  return treffer.filter((t) => {
    const k = `${t.datei}#${t.nr}`;
    return !(erlaubt.has(k) && zaehler.get(k) <= erlaubt.get(k));
  });
}

/**
 * Published example IBANs (bank documentation, standards, encyclopaedias) —
 * test values, not accounts of real people.
 */
export const TEST_IBANS = new Set([
  'DE89370400440532013000', 'DE02120300000000202051', 'DE12500105170648489890',
  'DE75512108001245126199', 'DE02100100100006820101', 'DE02300209000106531065',
  'DE02200505501015871393', 'DE02700100800030876808', 'DE91100000000123456789',
  'DE68210501700012345678', 'DE44500105175407324931', 'DE27100777770209299700',
  'AT611904300234573201', 'CH9300762011623852957', 'GB29NWBK60161331926819',
  'FR1420041010050500013M02606',
]);

/**
 * ISO 13616 check: mod 97 of the rearranged IBAN must be 1.
 * @param {string} iban without spaces, upper case
 * @returns {boolean}
 */
export function ibanGueltig(iban) {
  const r = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const c of r) {
    const ziffern = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const d of ziffern) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/**
 * IBANs with a valid checksum that are not known test values (compact or
 * grouped by four).
 * @param {string} text
 * @returns {string[]} the IBANs found (normalised, without spaces)
 */
export function echteIbans(text) {
  const out = [];
  const re = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?)\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const iban = m[1].replace(/ /g, '');
    if (iban.length < 15 || iban.length > 34) continue;
    if (ibanGueltig(iban) && !TEST_IBANS.has(iban)) out.push(iban);
  }
  return out;
}
