// datei-oeffnen.mjs — opens a .bitproj file in the local BIT-Atelier (plan 93-10, window mode 93-11). The
// installer registers tools/bit-atelier.ps1 -Datei "%1" (Windows, hidden) / tools/datei-oeffnen.sh (Linux)
// as the "open" command of .bitproj; tools/datei-oeffnen.cmd stays for a manual call.
//
// Steps:
//   1. check the path (path rule of 104-10 — local drives only —, exists, .bitproj);
//   2. make sure BIT-Atelier answers (tools/app-start.mjs serverBereit: use a running one, else start it —
//      visibly on a first start, hidden otherwise — one server only);
//   3. POST the path to /api/datei/oeffnen with the one-time secret from the data folder
//      (<data>/.oeffnen-schluessel — env BIT_DATA_DIR, else <app>/daten, else <app>/server);
//   4. open the app at /?import=<token> in the app window (tools/app-fenster.mjs).
//
// Usage: node tools/datei-oeffnen.mjs <file.bitproj> [--port <n>] [--app-url <url>] [--kein-browser] [--kein-start]
//   --port / env API_PORT (default 3001); --app-url: base URL of the app when it is not served by the API
//   port (dev: the Vite server); --kein-browser / env BIT_KEIN_BROWSER: print the URL as JSON instead of
//   opening it; --kein-start: never start a server (tests).
// Out: exit 0 and (with --kein-browser) one JSON line {"url": "…"} on stdout; exit 1 with a message.
// No dependency; Node ≥ 22.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { anfrage, serverBereit, startBefehl } from './app-start.mjs';
import { fensterOeffnen, envDateiLaden } from './app-fenster.mjs';
import { pfadRichtlinie } from '../packages/nova-core/src/lib/pfadRichtlinie.js';

// 93-11: the request helper and the visible start command moved to app-start.mjs; re-exported for callers.
export { anfrage, startBefehl };

/** App folder (the parent of tools/). */
export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Reads the command line.
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string|undefined>} env
 * @returns {{datei: string|null, port: number, appUrl: string|null, keinBrowser: boolean, keinStart: boolean}}
 */
export function argumenteLesen(argv, env = process.env) {
  const o = { datei: /** @type {string|null} */ (null), port: Number(env.API_PORT) || 3001, appUrl: /** @type {string|null} */ (null), keinBrowser: !!env.BIT_KEIN_BROWSER, keinStart: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]) || o.port;
    else if (a === '--app-url') o.appUrl = String(argv[++i] || '').replace(/\/+$/, '') || null;
    else if (a === '--kein-browser') o.keinBrowser = true;
    else if (a === '--kein-start') o.keinStart = true;
    else if (!o.datei) o.datei = a;
  }
  return o;
}

/**
 * 104-10: the file argument under the path rule (@core/lib/pfadRichtlinie.js) BEFORE the disk is touched —
 * a UNC path, a file: URL with a host or a device path is refused with its plain-text reason instead of
 * being looked up (Windows would contact the server). A plain relative name ("Plan.bitproj" from a manual
 * call in a terminal) is resolved against the working folder first; anything with a drive letter, a scheme
 * or a leading separator is checked as written, so "C:foo" and "\\server\share" keep their own reason.
 * @param {string} roh the argument as given
 * @param {{plattform?: 'win32'|'posix', aufloesen?: (p: string) => string}} [o] notation (default: this
 *   machine) and the resolver for relative names (default path.resolve)
 * @returns {{ok: true, pfad: string}|{ok: false, grund: string, meldung: string}}
 */
export function dateiAusArgument(roh, { plattform = process.platform === 'win32' ? 'win32' : 'posix', aufloesen = path.resolve } = {}) {
  const schlicht = typeof roh === 'string' && roh !== '' && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(roh) && !/^[\\/]/.test(roh);
  const e = pfadRichtlinie(schlicht ? aufloesen(roh) : roh, { plattform });
  return e.ok ? { ok: true, pfad: e.pfad } : e;
}

/**
 * Where the server may have written its launcher secret — the same rule as server/datenPfad.js
 * (BIT_DATA_DIR, else server/), plus <app>/daten, which the start scripts set.
 * @param {string} wurzel app folder
 * @param {Record<string, string|undefined>} env
 * @returns {string[]} absolute file paths, most likely first, without duplicates
 */
export function schluesselKandidaten(wurzel, env = process.env) {
  const ordner = [];
  if (String(env.BIT_DATA_DIR || '').trim()) ordner.push(path.resolve(String(env.BIT_DATA_DIR)));
  ordner.push(path.join(wurzel, 'daten'), path.join(wurzel, 'server'));
  return [...new Set(ordner.map((o) => path.join(o, '.oeffnen-schluessel')))];
}

/**
 * Hands the file to the server. Tries every candidate secret (a stale file of another data folder is
 * refused with 403) and, after a short pause, once more — the secret changes after every use.
 * @param {number} port
 * @param {string} datei absolute path
 * @returns {Promise<string>} the app path with the import token
 */
async function uebergeben(port, datei) {
  const body = JSON.stringify({ pfad: datei });
  let letzter = 'Kein Schlüssel im Datenordner gefunden.';
  for (let runde = 0; runde < 2; runde += 1) {
    for (const kandidat of schluesselKandidaten(WURZEL)) {
      let schluessel;
      try { schluessel = fs.readFileSync(kandidat, 'utf8').trim(); } catch { continue; }
      const r = await anfrage({
        port, methode: 'POST', pfad: '/api/datei/oeffnen', body, timeoutMs: 60000,
        kopf: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-bit-schluessel': schluessel },
      });
      if (r.status === 200 && r.json?.pfad) return r.json.pfad;
      letzter = r.json?.error || `HTTP ${r.status}`;
      if (r.status !== 403) throw new Error(letzter);
    }
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error(letzter);
}

/** The whole run. @returns {Promise<number>} exit code */
async function main() {
  envDateiLaden(WURZEL); // same .env as the server (BIT_DATA_DIR → where the launcher secret lies)
  const o = argumenteLesen(process.argv.slice(2));
  if (!o.datei) {
    console.error('Aufruf / usage: datei-oeffnen <datei.bitproj>');
    return 1;
  }
  const geprueft = dateiAusArgument(o.datei);
  if (!geprueft.ok) {
    console.error(`[BIT-Atelier] ${geprueft.meldung} (${o.datei})`);
    return 1;
  }
  const datei = geprueft.pfad;
  if (path.extname(datei).toLowerCase() !== '.bitproj' || !fs.existsSync(datei)) {
    console.error(`[BIT-Atelier] Keine Projektdatei gefunden / not a project file: ${datei}`);
    return 1;
  }
  await serverBereit(o.port, { keinStart: o.keinStart, melden: (t) => console.log(`[BIT-Atelier] ${t}`) });
  const appPfad = await uebergeben(o.port, datei);
  const url = `${o.appUrl || `http://localhost:${o.port}`}${appPfad}`;
  if (o.keinBrowser) console.log(JSON.stringify({ url }));
  else await fensterOeffnen(url);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`[BIT-Atelier] Datei konnte nicht geöffnet werden / could not open the file: ${e?.message || e}`);
    process.exit(1);
  });
}
