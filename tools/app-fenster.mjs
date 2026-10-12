// app-fenster.mjs — opens BIT-Atelier in its OWN window instead of a browser tab (plan 93-11).
//
// Edge (Windows' built-in browser) or Chrome/Chromium in app mode: `--app=<url>` gives a window without
// tabs and address bar, `--user-data-dir=<data>/fenster-profil` a separate profile — so the window gets its
// own taskbar group and never merges with the user's own browser session (and its extensions/cookies).
// Chromium remembers size and position of an app window in that profile by itself; only on the very first
// start (profile folder missing) a default size is passed. Without Edge/Chrome the default browser opens
// the URL as before. BIT_FENSTER=0 forces the browser tab.
//
// Used by start-windows.cmd / start.sh (browser step), tools/app-start.mjs (hidden start) and
// tools/datei-oeffnen.mjs (.bitproj double-click).
//
// Usage: node tools/app-fenster.mjs <url>
// In:  the URL; env (and <app>/.env) BIT_DATA_DIR (profile location), BIT_FENSTER; LOCALAPPDATA/ProgramFiles.
// Out: exit 0 once the window/browser process started (or 1 with a message). No dependency.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** App folder (the parent of tools/). */
export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Window size of the very first start, pixels (later Chromium restores the user's own). */
export const ERSTE_GROESSE = '1440,900';

/**
 * Where Edge / Chrome / Chromium may live, in the order they are preferred.
 * @param {NodeJS.Platform} plattform
 * @param {Record<string, string|undefined>} env
 * @returns {string[]} absolute paths (Windows/macOS) or program names looked up in PATH (Linux)
 */
export function browserKandidaten(plattform = process.platform, env = process.env) {
  if (plattform === 'win32') {
    const orte = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    return [
      ...orte.map((o) => path.win32.join(/** @type {string} */ (o), 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...orte.map((o) => path.win32.join(/** @type {string} */ (o), 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ];
  }
  if (plattform === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return ['microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

/**
 * Finds a program name in PATH (Linux).
 * @param {string} name
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
function imPfad(name, env) {
  for (const ordner of String(env.PATH || '').split(path.delimiter)) {
    if (!ordner) continue;
    const kandidat = path.join(ordner, name);
    try {
      fs.accessSync(kandidat, fs.constants.X_OK);
      return kandidat;
    } catch { /* next */ }
  }
  return null;
}

/**
 * The data folder the window profile lives in — same rule as server/datenPfad.js plus <app>/daten, which
 * the start scripts set.
 * @param {string} wurzel
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function datenOrdnerFuer(wurzel = WURZEL, env = process.env) {
  if (String(env.BIT_DATA_DIR || '').trim()) return path.resolve(String(env.BIT_DATA_DIR));
  const daten = path.join(wurzel, 'daten');
  return fs.existsSync(daten) ? daten : path.join(wurzel, 'server');
}

/**
 * How to open the URL — as data, so it can be checked without starting anything.
 * @param {string} url
 * @param {{plattform?: NodeJS.Platform, env?: Record<string, string|undefined>, datenOrdner?: string,
 *   vorhanden?: (p: string) => boolean}} [o] vorhanden = file-exists check (tests inject it)
 * @returns {{programm: string, args: string[], art: 'fenster'|'browser'}}
 */
export function fensterBefehl(url, { plattform = process.platform, env = process.env, datenOrdner = datenOrdnerFuer(WURZEL, env), vorhanden = fs.existsSync } = {}) {
  const standard = plattform === 'win32'
    ? { programm: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
    : { programm: plattform === 'darwin' ? 'open' : 'xdg-open', args: [url] };
  if (env.BIT_FENSTER === '0') return { ...standard, art: 'browser' };
  let browser = null;
  for (const k of browserKandidaten(plattform, env)) {
    // Windows/macOS: fixed install paths; Linux: program names in PATH.
    const gefunden = plattform === 'win32' || plattform === 'darwin' ? (vorhanden(k) ? k : null) : imPfad(k, env);
    if (gefunden) { browser = gefunden; break; }
  }
  if (!browser) return { ...standard, art: 'browser' };
  const profil = path.join(datenOrdner, 'fenster-profil');
  const args = [`--app=${url}`, `--user-data-dir=${profil}`, '--no-first-run', '--no-default-browser-check'];
  if (!vorhanden(profil)) args.push(`--window-size=${ERSTE_GROESSE}`);
  return { programm: browser, args, art: 'fenster' };
}

/**
 * Reads <app>/.env into process.env once (keys already set win) — the server reads the same file
 * (--env-file-if-exists), so BIT_FENSTER and BIT_DATA_DIR mean the same here as there.
 * @param {string} [wurzel]
 */
export function envDateiLaden(wurzel = WURZEL) {
  const datei = path.join(wurzel, '.env');
  if (!fs.existsSync(datei)) return;
  try {
    process.loadEnvFile(datei);
  } catch { /* unreadable .env: the defaults apply, the server reports it */ }
}

/**
 * Opens the app window (or the browser). Never throws: a failing window start falls back to the default
 * browser, and that failing prints the URL.
 * @param {string} url
 * @returns {Promise<'fenster'|'browser'|'hinweis'>} what was started
 */
export async function fensterOeffnen(url) {
  envDateiLaden();
  const b = fensterBefehl(url);
  const starten = (programm, args) => new Promise((resolve) => {
    const kind = spawn(programm, args, { detached: true, stdio: 'ignore' });
    kind.once('error', () => resolve(false));
    kind.once('spawn', () => { kind.unref(); resolve(true); });
  });
  if (await starten(b.programm, b.args)) return b.art;
  if (b.art === 'fenster') {
    const s = fensterBefehl(url, { env: { ...process.env, BIT_FENSTER: '0' } });
    if (await starten(s.programm, s.args)) return 'browser';
  }
  console.log(`Bitte im Browser öffnen / open in your browser: ${url}`);
  return 'hinweis';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const url = process.argv[2];
  if (!url || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) {
    console.error('Aufruf / usage: node tools/app-fenster.mjs http://localhost:<port>/');
    process.exit(1);
  }
  fensterOeffnen(url).then(() => process.exit(0));
}
