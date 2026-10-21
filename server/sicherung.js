// sicherung.js — the local app backs up its own data, on a schedule, with retention (plan 93-06, lever 161).
//
// Why: until now a local user had exactly two safety nets — db.json.bak (the previous write, overwritten
// on the next one) and the copy the self-updater makes before an update. Settings even pointed local
// users at backup-export.ps1, which is the OPERATOR's dump of the hosted database and not part of the
// open-source export. A backup that depends on the user remembering it is no backup.
//
// What is backed up: ONLY the data entries of the data folder (server/datenPfad.js) — db.json,
// personal.json, blobs/, personal-blobs/. Never "the whole folder": without BIT_DATA_DIR the data folder
// is server/ itself, which also holds program code. Siblings db.json.bak/.tmp are left out (.bak is the
// previous state of the same file, .tmp a write in flight).
//
// Consistency ("never while a write is in progress"): every write of this process is synchronous —
// db.js persistNow() = writeFileSync(tmp) + renameSync, blobs.js put() likewise. A backup first calls
// flush() on both databases (forces the pending 120 ms debounce write to disk) and then reads every file
// synchronously in the same tick, so no request handler can run in between. A write from ANOTHER
// process (npm run seed) is atomic by rename, so a read sees either the old or the new file, never half.
//
// Files: <ziel>/bit-atelier-<ISO time with - instead of : and .>.zip, written as .tmp and renamed; inside
// the zip the entries keep their names (db.json, blobs/<id>.json, …) plus sicherung.json (time, app
// version, per-file bytes and SHA-256). Restore = unzip into the data folder with the app stopped
// (docs/NOTFALL.md).
//
// Retention (aufbewahrung): the newest backup of each of the last TAEGLICH days that have one, plus the
// newest of each of the last WOECHENTLICH ISO weeks; everything else in the folder that matches the name
// pattern is deleted. Foreign files in the folder are never touched.
//
// Also: .update/sicherung-* (copies the self-updater makes, tools/update-anwenden.mjs) are trimmed to the
// newest UPDATE_KOPIEN on every start — the updater only trims after a successful run, so a crashed
// update left its copy (program + node_modules + data, often > 300 MB) behind forever.
//
// Environment: BIT_SICHERUNG_AUS=1 (off), BIT_SICHERUNG_STUNDEN (interval in hours, default 24),
// BIT_SICHERUNG_ORDNER (target folder; relative = against the data folder; default <data>/sicherungen),
// BIT_SICHERUNG_TAEGLICH / BIT_SICHERUNG_WOECHENTLICH (retention counts, default 7 / 4).
//
// In:  data folder, app folder, the two databases (flush), env, a clock (injectable for tests).
// Out: sicherungAnlegen(), aufbewahrung(), sicherungenListe(), updateKopienAufraeumen(),
//      sicherungsEinstellungen(), sicherungsDienst(). Only node: built-ins and fflate (already a dependency).

import fs from 'node:fs';
import { ersetzeAtomar } from '../packages/nova-core/server/atomarErsetzen.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync } from 'fflate';
import { pfadRichtlinie } from '../packages/nova-core/src/lib/pfadRichtlinie.js';

/** Entries of the data folder that ARE the user's data (datenPfad.js header). */
export const DATEN_EINTRAEGE = Object.freeze(['db.json', 'personal.json', 'blobs', 'personal-blobs']);

/** Defaults. Interval 24 h and 7 daily + 4 weekly copies [ASSUMED: common GFS scheme; a month back at ≤ 11 files]. */
export const STANDARD = Object.freeze({ stunden: 24, taeglich: 7, woechentlich: 4, updateKopien: 2 });

/** How often the service checks whether a backup is due, ms (1 h; a shorter interval is checked at its own pace). */
const PRUEF_MS = 60 * 60 * 1000;

/** Delay after start before a due backup runs, ms — the first requests of the app come first. */
const START_VERZOEGERUNG_MS = 5_000;

/** File name pattern of an automatic backup; group 1 = time with "-" for ":" and ".". */
const NAME_MUSTER = /^bit-atelier-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.zip$/;

/**
 * @param {Date} zeit
 * @returns {string} file name of a backup made at this moment
 */
export function sicherungsName(zeit) {
  return `bit-atelier-${zeit.toISOString().replace(/[:.]/g, '-')}.zip`;
}

/**
 * Time of a backup from its file name.
 * @param {string} name
 * @returns {string|null} ISO time, null when the name is not an automatic backup
 */
export function zeitAusName(name) {
  const m = NAME_MUSTER.exec(name);
  if (!m) return null;
  // 2026-10-12T19-54-45-123Z → 2026-10-12T19:54:45.123Z
  return m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
}

/**
 * Effective settings from the environment.
 * @param {string} datenOrdner absolute data folder
 * @param {Record<string, string|undefined>} [env]
 * @returns {{aus: boolean, stunden: number, ordner: string, taeglich: number, woechentlich: number}}
 *   stunden in hours (≥ 1), ordner absolute
 */
export function sicherungsEinstellungen(datenOrdner, env = process.env) {
  const zahl = (wert, standard, min) => {
    const n = Number(wert);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : standard;
  };
  const ordnerRoh = String(env.BIT_SICHERUNG_ORDNER ?? '').trim();
  return {
    aus: env.BIT_SICHERUNG_AUS === '1',
    stunden: zahl(env.BIT_SICHERUNG_STUNDEN, STANDARD.stunden, 1),
    ordner: ordnerRoh ? path.resolve(datenOrdner, ordnerRoh) : path.join(datenOrdner, 'sicherungen'),
    taeglich: zahl(env.BIT_SICHERUNG_TAEGLICH, STANDARD.taeglich, 1),
    woechentlich: zahl(env.BIT_SICHERUNG_WOECHENTLICH, STANDARD.woechentlich, 0),
  };
}

/**
 * Every data file below the data folder, read synchronously.
 * @param {string} datenOrdner absolute
 * @returns {Record<string, Uint8Array>} zip path ("db.json", "blobs/x.json") → bytes
 */
export function datenLesen(datenOrdner) {
  /** @type {Record<string, Uint8Array>} */
  const dateien = {};
  const lies = (abs, rel) => {
    let st;
    try { st = fs.statSync(abs); } catch { return; } // a missing entry (no personal data yet) is fine
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) lies(path.join(abs, name), `${rel}/${name}`);
    } else if (st.isFile() && !rel.endsWith('.tmp')) {
      dateien[rel] = new Uint8Array(fs.readFileSync(abs));
    }
  };
  for (const eintrag of DATEN_EINTRAEGE) lies(path.join(datenOrdner, eintrag), eintrag);
  return dateien;
}

/**
 * Makes one backup zip.
 * Side effects: flushes the given databases, creates the target folder, writes one zip (via .tmp + rename).
 * @param {{datenOrdner: string, zielOrdner: string, dbs?: Array<{flush: () => unknown}>, jetzt?: Date, version?: string}} o
 * @returns {{datei: string, name: string, zeit: string, bytes: number, dateien: number}} bytes = zip size in bytes
 * @throws {Error} when the target folder lies inside a data entry (the backup would back itself up) or breaks
 *   the path rule of 104-10 (device name/path, "..", control characters; a network share is allowed)
 */
export function sicherungAnlegen({ datenOrdner, zielOrdner, dbs = [], jetzt = new Date(), version = '' }) {
  const ziel = path.resolve(zielOrdner);
  // 104-10: the target comes from BIT_SICHERUNG_ORDNER (operator configuration). A share (\\nas\backup) is a
  // sensible backup target, so UNC is allowed here; a device name (NUL — the zip would vanish), a device
  // path or ".." is not. Refused with the plain-text reason, which the status shows as letzterFehler.
  const regel = pfadRichtlinie(ziel, { plattform: process.platform === 'win32' ? 'win32' : 'posix', netzwerkErlaubt: true });
  if (!regel.ok) throw new Error(`Sicherungsordner ungültig: ${regel.meldung}`);
  for (const eintrag of DATEN_EINTRAEGE) {
    const e = path.join(path.resolve(datenOrdner), eintrag);
    if (ziel === e || ziel.startsWith(e + path.sep)) throw new Error(`Sicherungsordner liegt in den Daten selbst (${eintrag}) — bitte einen anderen Ordner wählen.`);
  }
  // Same tick from here on: flush, read, zip — no request handler can write in between.
  for (const db of dbs) db.flush();
  const dateien = datenLesen(datenOrdner);
  const inhalt = Object.entries(dateien).map(([name, bytes]) => ({
    name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  const kopf = { app: 'bit-atelier', version, zeit: jetzt.toISOString(), dateien: inhalt };
  // Level 6: JSON shrinks to ~10–20 %; mtime fixed to the backup time so the zip says when it was taken.
  const zip = zipSync({ ...dateien, 'sicherung.json': new TextEncoder().encode(`${JSON.stringify(kopf, null, 2)}\n`) }, { level: 6, mtime: jetzt });
  fs.mkdirSync(ziel, { recursive: true });
  const name = sicherungsName(jetzt);
  const datei = path.join(ziel, name);
  fs.writeFileSync(`${datei}.tmp`, zip);
  ersetzeAtomar(`${datei}.tmp`, datei);
  return { datei, name, zeit: jetzt.toISOString(), bytes: zip.length, dateien: inhalt.length };
}

/**
 * Automatic backups in a folder, newest first. Other files are ignored.
 * @param {string} ordner absolute
 * @returns {Array<{name: string, zeit: string, bytes: number}>} bytes = file size
 */
export function sicherungenListe(ordner) {
  let namen = [];
  try { namen = fs.readdirSync(ordner); } catch { return []; }
  return namen
    .map((name) => ({ name, zeit: zeitAusName(name) }))
    .filter((e) => e.zeit)
    .map((e) => {
      let bytes = 0;
      try { bytes = fs.statSync(path.join(ordner, e.name)).size; } catch { /* vanished meanwhile */ }
      return { name: e.name, zeit: /** @type {string} */ (e.zeit), bytes };
    })
    .sort((a, b) => (a.zeit < b.zeit ? 1 : a.zeit > b.zeit ? -1 : 0));
}

/**
 * ISO week key ("2026-W41") of a UTC time (ISO 8601: weeks start Monday, week 1 holds the first Thursday).
 * @param {string} iso
 * @returns {string}
 */
export function isoWoche(iso) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const tag = d.getUTCDay() || 7; // Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - tag); // Thursday of this week decides the year
  const jahresAnfang = Date.UTC(d.getUTCFullYear(), 0, 1);
  const woche = Math.ceil(((d.getTime() - jahresAnfang) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(woche).padStart(2, '0')}`;
}

/**
 * Retention decision (pure). Keeps the newest backup of each of the last `taeglich` days that have a
 * backup, and the newest of each of the last `woechentlich` ISO weeks that have one. Days are UTC days
 * [ASSUMED: the file names carry UTC; one backup a day makes the local/UTC difference irrelevant].
 * @param {ReadonlyArray<{name: string, zeit: string}>} liste backups (any order)
 * @param {{taeglich: number, woechentlich: number}} regel counts
 * @returns {{behalten: string[], loeschen: string[]}} names, newest first
 */
export function aufbewahrung(liste, { taeglich, woechentlich }) {
  const sortiert = [...liste].sort((a, b) => (a.zeit < b.zeit ? 1 : a.zeit > b.zeit ? -1 : 0));
  const behalten = new Set();
  const nimm = (schluessel, anzahl) => {
    const gesehen = new Set();
    for (const e of sortiert) {
      const k = schluessel(e.zeit);
      if (gesehen.has(k)) continue;
      if (gesehen.size >= anzahl) break;
      gesehen.add(k);
      behalten.add(e.name);
    }
  };
  nimm((z) => z.slice(0, 10), taeglich);
  nimm(isoWoche, woechentlich);
  return {
    behalten: sortiert.filter((e) => behalten.has(e.name)).map((e) => e.name),
    loeschen: sortiert.filter((e) => !behalten.has(e.name)).map((e) => e.name),
  };
}

/**
 * Trims the self-updater's copies .update/sicherung-* to the newest `behalten` (names carry an ISO time,
 * so name order = time order — the same rule as tools/update-anwenden.mjs). A running update is safe:
 * its own copy is the newest.
 * @param {string} appOrdner absolute app folder
 * @param {number} [behalten]
 * @returns {string[]} removed folder names
 */
export function updateKopienAufraeumen(appOrdner, behalten = STANDARD.updateKopien) {
  const ordner = path.join(appOrdner, '.update');
  let namen = [];
  try { namen = fs.readdirSync(ordner).filter((n) => n.startsWith('sicherung-')).sort().reverse(); } catch { return []; }
  const entfernt = [];
  for (const name of namen.slice(behalten)) {
    try { fs.rmSync(path.join(ordner, name), { recursive: true, force: true }); entfernt.push(name); } catch (e) {
      console.warn(`[sicherung] Alte Update-Kopie ${name} nicht entfernt: ${/** @type {any} */ (e).message}`);
    }
  }
  return entfernt;
}

/**
 * Status of the automatic backup as the Settings card shows it.
 * @typedef {{
 *   aktiv: boolean, ordner: string, intervallStunden: number,
 *   aufbewahrung: {taeglich: number, woechentlich: number},
 *   letzte: {name: string, zeit: string, bytes: number}|null, anzahl: number,
 *   naechste: string|null, letzterFehler: string|null, laeuft: boolean,
 * }} SicherungsStatus
 */

/**
 * The backup service of a running server: runs a due backup shortly after start, then checks hourly;
 * also trims the updater's copies once at start. Timers are unref'd (never keep the process alive).
 * @param {{
 *   datenOrdner: string, appOrdner: string, dbs: Array<{flush: () => unknown}>,
 *   env?: Record<string, string|undefined>, version?: string,
 *   jetzt?: () => Date, automatisch?: boolean,
 * }} o automatisch=false: no timers (tests and API-only checks call jetztSichern themselves)
 * @returns {{status: () => SicherungsStatus, jetztSichern: () => ReturnType<typeof sicherungAnlegen>, stop: () => void}}
 */
export function sicherungsDienst({ datenOrdner, appOrdner, dbs, env = process.env, version = '', jetzt = () => new Date(), automatisch = true }) {
  const e = sicherungsEinstellungen(datenOrdner, env);
  /** @type {string|null} */
  let letzterFehler = null;
  let laeuft = false;
  /** @type {Array<ReturnType<typeof setTimeout>>} */
  const timer = [];

  const status = () => {
    const liste = sicherungenListe(e.ordner);
    const letzte = liste[0] || null;
    const naechste = e.aus ? null : letzte ? new Date(Date.parse(letzte.zeit) + e.stunden * 3_600_000).toISOString() : jetzt().toISOString();
    return {
      aktiv: !e.aus, ordner: e.ordner, intervallStunden: e.stunden,
      aufbewahrung: { taeglich: e.taeglich, woechentlich: e.woechentlich },
      letzte, anzahl: liste.length, naechste, letzterFehler, laeuft,
    };
  };

  const jetztSichern = () => {
    if (laeuft) throw new Error('Eine Sicherung läuft bereits.');
    laeuft = true;
    try {
      const ergebnis = sicherungAnlegen({ datenOrdner, zielOrdner: e.ordner, dbs, jetzt: jetzt(), version });
      const { loeschen } = aufbewahrung(sicherungenListe(e.ordner), e);
      for (const name of loeschen) {
        try { fs.rmSync(path.join(e.ordner, name), { force: true }); } catch (err) {
          console.warn(`[sicherung] Alte Sicherung ${name} nicht entfernt: ${/** @type {any} */ (err).message}`);
        }
      }
      letzterFehler = null;
      console.log(`[sicherung] ${ergebnis.name} (${ergebnis.dateien} Dateien, ${Math.round(ergebnis.bytes / 1024)} KB), ${loeschen.length} alte entfernt.`);
      return ergebnis;
    } catch (err) {
      letzterFehler = /** @type {any} */ (err).message || String(err);
      console.error(`[sicherung] Fehlgeschlagen: ${letzterFehler}`);
      throw err;
    } finally {
      laeuft = false;
    }
  };

  const faellig = () => {
    const letzte = sicherungenListe(e.ordner)[0];
    return !letzte || jetzt().getTime() - Date.parse(letzte.zeit) >= e.stunden * 3_600_000;
  };
  const pruefen = () => { if (faellig()) { try { jetztSichern(); } catch { /* logged and kept in letzterFehler */ } } };

  if (automatisch) {
    const entfernt = updateKopienAufraeumen(appOrdner);
    if (entfernt.length) console.log(`[sicherung] ${entfernt.length} alte Update-Kopie(n) entfernt: ${entfernt.join(', ')}`);
    if (!e.aus) {
      const start = setTimeout(pruefen, START_VERZOEGERUNG_MS);
      const iv = setInterval(pruefen, Math.min(PRUEF_MS, e.stunden * 3_600_000));
      for (const t of [start, iv]) { if (typeof t?.unref === 'function') t.unref(); timer.push(t); }
    }
  }

  return {
    status,
    jetztSichern,
    stop: () => { for (const t of timer) { clearTimeout(t); clearInterval(t); } },
  };
}
