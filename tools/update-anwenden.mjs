#!/usr/bin/env node
// update-anwenden.mjs — second half of the self-update (plan 92-01). Started DETACHED by the server after the
// new release was downloaded, verified (SHA-256) and unpacked into <app>/.update/neu; the server then exits.
// The server copies this file into <app>/.update/ first, so moving tools/ during the swap never touches the
// running script. Self-contained on purpose (only node: built-ins).
//
// Steps: wait until the old server process is gone → move every program entry of the app folder into
// .update/sicherung-<time> (daten/, .env, node_modules/, .update/ stay) → move the new files in → bring back
// data files a source-style setup keeps inside server/ → `npm ci --omit=dev` only when package-lock.json
// changed → restart the app (no browser: the open tab reloads itself). Any error → roll back to the backup
// and restart the old version. Every step is logged to daten/update.log.
//
// Usage: node .update/update-anwenden.mjs --root <app folder> --pid <old server pid>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg('root') || '.');
const PID = Number(arg('pid')) || 0;
const NEU = path.join(ROOT, '.update', 'neu');
const SICHERUNG = path.join(ROOT, '.update', `sicherung-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const OBEN_BEWAHREN = new Set(['daten', '.env', 'node_modules', '.update']);
// Data a source-style setup (no BIT_DATA_DIR) keeps inside server/ — restored after the swap.
const DATEN_IN_SERVER = ['db.json', 'db.json.bak', 'personal.json', 'personal.json.bak', 'blobs', 'personal-blobs'];
const LOG = path.join(ROOT, 'daten', 'update.log');

function log(text) {
  const zeile = `${new Date().toISOString()} ${text}\n`;
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, zeile); } catch { /* logging must never stop the update */ }
}
const lockHash = (ordner) => { const p = path.join(ordner, 'package-lock.json'); return fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null; };
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Move with a copy fallback (rename fails across devices and, on Windows, briefly after a process exit). */
function verschieben(von, nach) {
  fs.mkdirSync(path.dirname(nach), { recursive: true });
  for (let i = 0; i < 20; i += 1) {
    try { fs.renameSync(von, nach); return; } catch (e) {
      if (i === 19) { fs.cpSync(von, nach, { recursive: true }); fs.rmSync(von, { recursive: true, force: true }); return; }
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},250)']); // short pause without busy-waiting
      if (/** @type {any} */ (e).code === 'EXDEV') { fs.cpSync(von, nach, { recursive: true }); fs.rmSync(von, { recursive: true, force: true }); return; }
    }
  }
}

function neustarten() {
  // Tests set BIT_UPDATE_KEIN_NEUSTART=1: they check the swap, not a real app start (would open a console).
  if (process.env.BIT_UPDATE_KEIN_NEUSTART === '1') { log('Neustart übersprungen (Test).'); return; }
  const env = { ...process.env, BIT_KEIN_BROWSER: '1' };
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/d', '/s', '/c', `start "BIT-Atelier" /D "${ROOT}" start-windows.cmd`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env }).unref();
  } else {
    const out = fs.openSync(path.join(ROOT, 'daten', 'app.log'), 'a');
    spawn('sh', [path.join(ROOT, 'start.sh')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env }).unref();
  }
  log('Neustart ausgelöst.');
}

async function main() {
  log(`Update startet in ${ROOT} (alter Server pid ${PID}).`);
  for (let i = 0; PID && lebt(PID) && i < 120; i += 1) await warte(500);
  if (PID && lebt(PID)) throw new Error('Der alte Server läuft nach 60 s noch – Update abgebrochen.');
  if (!fs.existsSync(path.join(NEU, 'package.json'))) throw new Error('Kein vorbereitetes Update in .update/neu.');

  const alterLock = lockHash(ROOT);
  const verschoben = [];
  const eingesetzt = [];
  try {
    for (const name of fs.readdirSync(ROOT)) {
      if (OBEN_BEWAHREN.has(name)) continue;
      verschieben(path.join(ROOT, name), path.join(SICHERUNG, name));
      verschoben.push(name);
    }
    log(`${verschoben.length} Einträge gesichert nach ${path.basename(SICHERUNG)}.`);
    for (const name of fs.readdirSync(NEU)) {
      if (OBEN_BEWAHREN.has(name)) continue;
      verschieben(path.join(NEU, name), path.join(ROOT, name));
      eingesetzt.push(name);
    }
    for (const d of DATEN_IN_SERVER) {
      const alt = path.join(SICHERUNG, 'server', d);
      if (fs.existsSync(alt)) fs.cpSync(alt, path.join(ROOT, 'server', d), { recursive: true });
    }
    log('Neue Programmdateien eingesetzt.');
    if (lockHash(ROOT) !== alterLock) {
      log('package-lock.json geändert – npm ci --omit=dev …');
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const r = spawnSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
      log(String(r.stdout || '').slice(-2000) + String(r.stderr || '').slice(-2000));
      if (r.status !== 0) throw new Error(`npm ci fehlgeschlagen (Code ${r.status}).`);
    }
    fs.rmSync(NEU, { recursive: true, force: true });
    log('Update fertig.');
  } catch (e) {
    log(`FEHLER: ${/** @type {any} */ (e).message} – Rückfall auf die vorige Fassung.`);
    // Remove exactly what came in from the update, then put the backup back. Entries that were never
    // moved out are still the old ones and stay untouched.
    for (const name of eingesetzt) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
    for (const name of verschoben) verschieben(path.join(SICHERUNG, name), path.join(ROOT, name));
    log('Rückfall abgeschlossen.');
  }
  neustarten();
}

main().catch((e) => { log(`ABBRUCH: ${e.message}`); neustarten(); process.exitCode = 1; });
