// app-start.mjs — starts BIT-Atelier like a program (plan 93-11): no console window, one server per user,
// the app in its own window. Called by tools/bit-atelier.ps1 (Windows shortcut, hidden PowerShell) and
// reused by tools/datei-oeffnen.mjs (.bitproj double-click).
//
// Steps:
//   1. GET http://127.0.0.1:<port>/api/status — BIT-Atelier answers: only open a window (a second click never
//      starts a second server); another program on the port: stop with a message;
//   2. nothing answers:
//      - first start (no node_modules/ or no dist/index.html): start-windows.cmd / start.sh VISIBLY, so the
//        package installation shows its progress (a few minutes) and its error texts;
//      - otherwise the server itself, hidden (`windowsHide`, detached), output appended to
//        <data>/server.log (rotated to server.log.1 above 5 MB);
//      a start marker in the temp folder keeps two quick clicks from starting two servers; wait ≤ 300 s;
//   3. open the app window (tools/app-fenster.mjs).
// The server keeps running when the last window closes (93-11 D-03); Settings › System & Info › „Programm
// beenden“ stops it.
//
// Usage: node tools/app-start.mjs [--port <n>] [--kein-fenster]
// Out: exit 0, or 1 with a message on stderr (bit-atelier.ps1 shows it in a message box). No dependency.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fensterOeffnen, envDateiLaden } from './app-fenster.mjs';

/** App folder (the parent of tools/). */
export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Seconds to wait for a server this script started (the first start installs packages). */
export const START_WARTEN_S = 300;
/** server.log is rotated above this size, bytes (5 MB). */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * One request to the local server. Plain http (not fetch): no Origin, no Sec-Fetch-* headers.
 * @param {{port: number, methode: string, pfad: string, kopf?: Record<string, string>, body?: string, timeoutMs?: number}} o
 * @returns {Promise<{status: number, json: any}>}
 */
export function anfrage({ port, methode, pfad, kopf = {}, body, timeoutMs = 3000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: methode, path: pfad, headers: kopf, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * What answers on the port.
 * @param {number} port
 * @returns {Promise<'bit-atelier'|'fremd'|null>} null = nothing answers
 */
export async function wasLaeuft(port) {
  try {
    const r = await anfrage({ port, methode: 'GET', pfad: '/api/status', timeoutMs: 2000 });
    return r.json?.name === 'bit-atelier' ? 'bit-atelier' : 'fremd';
  } catch {
    return null;
  }
}

/**
 * First start or ready installation?
 * @param {string} wurzel
 * @param {(p: string) => boolean} [vorhanden]
 * @returns {'erststart'|'versteckt'}
 */
export function startArt(wurzel = WURZEL, vorhanden = fs.existsSync) {
  return vorhanden(path.join(wurzel, 'node_modules')) && vorhanden(path.join(wurzel, 'dist', 'index.html')) ? 'versteckt' : 'erststart';
}

/**
 * The visible start, like the shortcut used to do — as data. Windows: a NEW console window running
 * start-windows.cmd (cmd /s /c strips the outer quotes, paths with blanks work).
 * @param {string} wurzel
 * @param {NodeJS.Platform} plattform
 * @returns {{programm: string, args: string[], verbatim: boolean}}
 */
export function startBefehl(wurzel = WURZEL, plattform = process.platform) {
  if (plattform === 'win32') {
    const skript = path.join(wurzel, 'start-windows.cmd');
    return { programm: 'cmd.exe', args: ['/d', '/s', '/c', `"start "BIT-Atelier" "${skript}""`], verbatim: true };
  }
  return { programm: 'sh', args: [path.join(wurzel, 'start.sh')], verbatim: false };
}

/**
 * The hidden start — as data: this Node, the server in app mode, the data folder the start scripts use.
 * @param {string} wurzel
 * @param {Record<string, string|undefined>} env
 * @returns {{programm: string, args: string[], datenOrdner: string}}
 */
export function verstecktBefehl(wurzel = WURZEL, env = process.env) {
  const datenOrdner = String(env.BIT_DATA_DIR || '').trim() ? path.resolve(String(env.BIT_DATA_DIR)) : path.join(wurzel, 'daten');
  return { programm: process.execPath, args: ['--env-file-if-exists=.env', path.join('server', 'index.js'), '--app'], datenOrdner };
}

/**
 * Opens <data>/server.log for appending; above LOG_MAX_BYTES the old log becomes server.log.1 first.
 * @param {string} datenOrdner
 * @returns {number} file descriptor
 */
export function logOeffnen(datenOrdner) {
  fs.mkdirSync(datenOrdner, { recursive: true });
  const log = path.join(datenOrdner, 'server.log');
  try {
    if (fs.statSync(log).size > LOG_MAX_BYTES) fs.renameSync(log, `${log}.1`);
  } catch { /* no log yet */ }
  const fd = fs.openSync(log, 'a');
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} BIT-Atelier wird gestartet ---\n`);
  return fd;
}

/**
 * Starts the server (visible on a first start, hidden otherwise) unless another caller started it less
 * than START_WARTEN_S ago (marker file in the temp folder).
 * @param {number} port
 * @param {{wurzel?: string, sichtbar?: boolean}} [o]
 * @returns {string|null} the marker path this caller owns (remove after the wait), or null when it only waits
 */
export function serverStarten(port, { wurzel = WURZEL, sichtbar = startArt(wurzel) === 'erststart' } = {}) {
  const marke = path.join(os.tmpdir(), `bit-atelier-start-${port}.marke`);
  try {
    if (Date.now() - fs.statSync(marke).mtimeMs < START_WARTEN_S * 1000) return null; // someone else is starting it
    fs.rmSync(marke, { force: true });
  } catch { /* no marker */ }
  try {
    fs.writeFileSync(marke, String(process.pid), { flag: 'wx' });
  } catch {
    return null;
  }
  const env = { ...process.env, API_PORT: String(port), BIT_KEIN_BROWSER: '1' };
  if (sichtbar) {
    const b = startBefehl(wurzel);
    spawn(b.programm, b.args, { cwd: wurzel, detached: true, stdio: 'ignore', windowsVerbatimArguments: b.verbatim, env }).unref();
  } else {
    const b = verstecktBefehl(wurzel, env);
    const fd = logOeffnen(b.datenOrdner);
    spawn(b.programm, b.args, { cwd: wurzel, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...env, BIT_DATA_DIR: b.datenOrdner } }).unref();
    fs.closeSync(fd);
  }
  return marke;
}

/**
 * Makes sure BIT-Atelier answers on the port: uses a running one, starts one otherwise and waits.
 * @param {number} port
 * @param {{wurzel?: string, keinStart?: boolean, melden?: (text: string) => void}} [o]
 * @returns {Promise<void>}
 * @throws {Error} another program on the port, no server (keinStart), or no answer within START_WARTEN_S
 */
export async function serverBereit(port, { wurzel = WURZEL, keinStart = false, melden = () => {} } = {}) {
  let laeuft = await wasLaeuft(port);
  if (laeuft === 'fremd') throw new Error(`Port ${port} ist von einem anderen Programm belegt / port in use by another program.`);
  if (laeuft === 'bit-atelier') return;
  if (keinStart) throw new Error(`Kein Server auf Port ${port} / no server on port ${port}.`);
  melden('Starte BIT-Atelier ... / starting BIT-Atelier ...');
  const marke = serverStarten(port, { wurzel });
  const ende = Date.now() + START_WARTEN_S * 1000;
  try {
    while (Date.now() < ende && laeuft !== 'bit-atelier') {
      await new Promise((r) => setTimeout(r, 700));
      laeuft = await wasLaeuft(port);
    }
  } finally {
    if (marke) fs.rmSync(marke, { force: true });
  }
  if (laeuft !== 'bit-atelier') {
    throw new Error(`Der Server antwortet nicht (${START_WARTEN_S} s) - siehe daten/server.log bzw. das Startfenster. / The server did not answer.`);
  }
}

/** The whole run. @returns {Promise<number>} exit code */
async function main() {
  // <app>/.env (BIT_DATA_DIR, API_PORT, BIT_FENSTER) as documented in docs/NOTFALL.md; the environment wins.
  envDateiLaden(WURZEL);
  const argv = process.argv.slice(2);
  let port = Number(process.env.API_PORT) || 3001;
  const i = argv.indexOf('--port');
  if (i >= 0) port = Number(argv[i + 1]) || port;
  await serverBereit(port, { melden: (t) => console.log(`[BIT-Atelier] ${t}`) });
  if (!argv.includes('--kein-fenster')) await fensterOeffnen(`http://localhost:${port}/`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`[BIT-Atelier] ${e?.message || e}`);
    process.exit(1);
  });
}
