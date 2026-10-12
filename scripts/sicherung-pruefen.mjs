// Checks a database dump from scripts/backup-export.ps1 without restoring it (57-05).
//
// A dump nobody has looked at is a file, not a backup. This script reads the
// plain-format pg_dump offline and answers three questions:
//   1. Is it complete? pg_dump writes "-- PostgreSQL database dump complete" as
//      its last line; a dump cut off by a network drop or a full disk lacks it.
//   2. What is in it? Rows of public.records per entity, orgs, memberships,
//      storage objects per bucket (metadata only - see below).
//   3. Does a restore reproduce it? With --vergleich it compares two dumps -
//      the weekly one and a dump taken from the throwaway project it was
//      restored into (restore drill, docs/BETRIEB.md section 3). Any difference
//      is exit 1.
//
// What it cannot say: whether the uploaded FILES are safe. pg_dump copies
// storage.objects (the index of the files), not the files themselves; those
// live in the Supabase bucket and are not part of any dump. The report says so
// on every run, because that is exactly the sentence that otherwise ends up
// wrong in an offer ("complete backup").
//
// In:  path to a .sql file (plain format, COPY blocks - the pg_dump default).
// Out: report on stdout; exit 0 = complete (and equal, with --vergleich),
//      exit 1 = incomplete, unreadable or different. No network, no writes.
//
// Usage:  node scripts/sicherung-pruefen.mjs <abzug.sql>
//         node scripts/sicherung-pruefen.mjs <abzug.sql> --vergleich <rueckspiel.sql>

import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

/** Last line pg_dump writes when it finished without error. */
export const ENDMARKE = '-- PostgreSQL database dump complete';

/**
 * @typedef {Object} DumpZaehlung
 * @property {boolean} vollstaendig dump ends with ENDMARKE
 * @property {Record<string, number>} tabellen rows per "schema.table" (every COPY block)
 * @property {Record<string, number>} records rows of public.records per entity
 * @property {Record<string, number>} objekte rows of storage.objects per bucket_id
 */

/**
 * Parses a COPY header line into table name and column list.
 * `COPY public.records (id, entity, ...) FROM stdin;` → { tabelle, spalten }.
 * @param {string} zeile one line of the dump
 * @returns {{ tabelle: string, spalten: string[] } | null} null when the line is no COPY header
 */
export function copyKopf(zeile) {
  const m = /^COPY\s+([^\s(]+)\s*\(([^)]*)\)\s+FROM\s+stdin;\s*$/.exec(zeile);
  if (!m) return null;
  // pg_dump quotes identifiers only when needed ("Name"); strip the quotes so
  // public."records" and public.records count as the same table.
  const tabelle = m[1].replace(/"/g, '');
  const spalten = m[2].split(',').map((s) => s.trim().replace(/"/g, ''));
  return { tabelle, spalten };
}

/**
 * Counts the content of a plain-format dump, line by line (works on a file of
 * any size when fed from a stream).
 * Data rows are tab-separated; pg_dump escapes tabs inside values as \t, so a
 * split on the real tab character is exact. NULL is written as \N.
 * @param {Iterable<string> | AsyncIterable<string>} zeilen lines without line break
 * @returns {Promise<DumpZaehlung>}
 */
export async function zaehleDump(zeilen) {
  /** @type {DumpZaehlung} */
  const z = { vollstaendig: false, tabellen: {}, records: {}, objekte: {} };
  /** @type {{ tabelle: string, spalten: string[] } | null} */
  let block = null;
  for await (const roh of zeilen) {
    const zeile = roh.endsWith('\r') ? roh.slice(0, -1) : roh;
    if (block) {
      if (zeile === '\\.') { block = null; continue; }
      z.tabellen[block.tabelle] = (z.tabellen[block.tabelle] || 0) + 1;
      if (block.tabelle === 'public.records' || block.tabelle === 'storage.objects') {
        const feld = block.tabelle === 'public.records' ? 'entity' : 'bucket_id';
        const i = block.spalten.indexOf(feld);
        const wert = i >= 0 ? (zeile.split('\t')[i] ?? '') : '';
        const schluessel = wert === '\\N' || wert === '' ? '(ohne)' : wert;
        const ziel = block.tabelle === 'public.records' ? z.records : z.objekte;
        ziel[schluessel] = (ziel[schluessel] || 0) + 1;
      }
      continue;
    }
    const kopf = copyKopf(zeile);
    if (kopf) {
      block = kopf;
      // An empty table still gets its COPY block; record it with 0 so a
      // comparison sees "table present, empty" rather than "table missing".
      z.tabellen[kopf.tabelle] = z.tabellen[kopf.tabelle] || 0;
      continue;
    }
    if (zeile.trim() === ENDMARKE) z.vollstaendig = true;
  }
  return z;
}

/**
 * Compares two counts key by key. Only differences are returned; an empty list
 * means the restore reproduced the dump.
 * @param {DumpZaehlung} a reference (the weekly dump)
 * @param {DumpZaehlung} b candidate (dump of the restored project)
 * @returns {Array<{ bereich: string, schluessel: string, a: number, b: number }>}
 */
export function vergleiche(a, b) {
  /** @type {Array<{ bereich: string, schluessel: string, a: number, b: number }>} */
  const abweichungen = [];
  for (const bereich of /** @type {const} */ (['tabellen', 'records', 'objekte'])) {
    const schluessel = new Set([...Object.keys(a[bereich]), ...Object.keys(b[bereich])]);
    for (const k of [...schluessel].sort()) {
      const va = a[bereich][k] ?? 0;
      const vb = b[bereich][k] ?? 0;
      if (va !== vb) abweichungen.push({ bereich, schluessel: k, a: va, b: vb });
    }
  }
  return abweichungen;
}

/**
 * Plain-text report for one dump.
 * @param {string} name file name shown in the header
 * @param {DumpZaehlung} z
 * @returns {string[]} lines
 */
export function berichtZeilen(name, z) {
  const summe = (o) => Object.values(o).reduce((s, n) => s + n, 0);
  const zeilen = [`Abzug: ${name}`];
  zeilen.push(z.vollstaendig
    ? 'Vollständig    : ja (Endmarke von pg_dump vorhanden)'
    : 'Vollständig    : NEIN — die Endmarke fehlt, der Abzug ist abgebrochen');
  zeilen.push(`Datensätze     : ${summe(z.records)} in public.records`);
  for (const [k, n] of Object.entries(z.records).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) {
    zeilen.push(`  ${k.padEnd(28)} ${n}`);
  }
  if ('public.orgs' in z.tabellen) zeilen.push(`Büros          : ${z.tabellen['public.orgs']}`);
  if ('public.org_members' in z.tabellen) zeilen.push(`Mitgliedschaften: ${z.tabellen['public.org_members']}`);
  if ('storage.objects' in z.tabellen) {
    zeilen.push(`Dateieinträge  : ${summe(z.objekte)} in storage.objects`);
    for (const [k, n] of Object.entries(z.objekte).sort()) zeilen.push(`  Bucket ${k.padEnd(21)} ${n}`);
  } else {
    zeilen.push('Dateieinträge  : storage.objects nicht im Abzug');
  }
  zeilen.push('Hinweis        : Die hochgeladenen Dateien selbst sind in KEINEM Datenbankabzug enthalten —');
  zeilen.push('                 nur ihr Verzeichnis. Sie liegen im Supabase-Bucket und brauchen eine eigene Sicherung.');
  return zeilen;
}

/**
 * Reads a dump file as a line stream.
 * @param {string} pfad
 * @returns {Promise<DumpZaehlung>}
 * @throws {Error} plain text when the file does not exist
 */
export async function zaehleDatei(pfad) {
  if (!fs.existsSync(pfad)) throw new Error(`Datei nicht gefunden: ${pfad}`);
  const rl = readline.createInterface({ input: fs.createReadStream(pfad, { encoding: 'utf8' }), crlfDelay: Infinity });
  return zaehleDump(rl);
}

/**
 * CLI entry.
 * @param {string[]} argv process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const i = argv.indexOf('--vergleich');
  // The value after --vergleich is the second dump, not the first.
  const datei = argv.find((a, j) => !a.startsWith('--') && (i < 0 || j !== i + 1));
  const zweite = i >= 0 ? argv[i + 1] : '';
  if (!datei || (i >= 0 && !zweite)) {
    console.error('Aufruf: node scripts/sicherung-pruefen.mjs <abzug.sql> [--vergleich <rueckspiel.sql>]');
    return 1;
  }
  const a = await zaehleDatei(datei);
  console.log(berichtZeilen(datei, a).join('\n'));
  let ok = a.vollstaendig;
  if (zweite) {
    const b = await zaehleDatei(zweite);
    console.log('');
    console.log(berichtZeilen(zweite, b).join('\n'));
    ok = ok && b.vollstaendig;
    const abw = vergleiche(a, b);
    console.log('');
    if (abw.length === 0) {
      console.log('Vergleich      : keine Abweichung — die Rückspielprobe hat den Abzug vollständig wiederhergestellt.');
    } else {
      ok = false;
      console.log(`Vergleich      : ${abw.length} Abweichung(en)`);
      for (const d of abw) console.log(`  [${d.bereich}] ${d.schluessel}: ${d.a} → ${d.b}`);
    }
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { console.error(`FEHLER: ${e.message}`); process.exit(1); },
  );
}
