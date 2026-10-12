#!/usr/bin/env node
// update-anwenden.mjs — second half of the self-update (plan 92-01, health check + rollback 92-05). Started
// DETACHED by the server after the new release was downloaded, verified (SHA-256) and unpacked into
// <app>/.update/neu; the server then exits. The server copies this file into <app>/.update/ first, so moving
// tools/ during the swap never touches the running script. Self-contained on purpose (only node: built-ins).
//
// Steps:
//   1. wait until the old server process is gone
//   2. copy the data folder daten/ into .update/sicherung-<time>/daten (92-05; logs and the app window's
//      browser profile excluded, 93-11) — a new version
//      may migrate db.json on its first start, and a rollback must give the old version its old data back
//   3. move every program entry of the app folder into the same backup folder (daten/, .env, node_modules/,
//      .update/ stay), move the new files in, bring back data files a source-style setup keeps in server/
//   4. `npm ci --omit=dev` only when package-lock.json changed (the old node_modules/ is moved into the
//      backup first, so a rollback gets it back without a network)
//   5. restart the app (no browser: the open tab reloads itself; Windows since 93-11 without a console window,
//      output in daten/server.log) and check its health: GET
//      http://127.0.0.1:<port>/api/status must report the NEW version within 60 s (92-05)
//   6. unhealthy → stop the new server, put program, node_modules and data back from the backup, restart the
//      old version and check it too; any error in steps 2–4 → same rollback without the data step
//   7. keep only the newest 2 backups; write daten/update-ergebnis.json (read by /api/update → the banner can
//      say "rolled back" instead of waiting) and log every step to daten/update.log
//
// Usage: node .update/update-anwenden.mjs --root <app folder> --pid <old server pid> [--port <port>]
//
// Test hooks (environment):
//   BIT_UPDATE_KEIN_NEUSTART=1     start no process (no app start, no kill); the health check is skipped
//                                  unless one of the next two is set
//   BIT_UPDATE_PRUEFEN=1           with KEIN_NEUSTART: still check whatever answers on --port (a test server)
//   BIT_UPDATE_TEST_GESUNDHEIT=ok|fehler   simulated health result, no network at all
//   BIT_UPDATE_WARTEZEIT_MS=<ms>   health-check timeout instead of 60 000 ms

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg('root') || '.');
const PID = Number(arg('pid')) || 0;
const PORT = Number(arg('port')) || Number(process.env.API_PORT) || 3001;
const NEU = path.join(ROOT, '.update', 'neu');
const SICHERUNG = path.join(ROOT, '.update', `sicherung-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const OBEN_BEWAHREN = new Set(['daten', '.env', 'node_modules', '.update']);
// Data a source-style setup (no BIT_DATA_DIR) keeps inside server/ — restored after the swap.
const DATEN_IN_SERVER = ['db.json', 'db.json.bak', 'personal.json', 'personal.json.bak', 'blobs', 'personal-blobs'];
const DATEN = path.join(ROOT, 'daten');
const LOG = path.join(DATEN, 'update.log');
const ERGEBNIS = path.join(DATEN, 'update-ergebnis.json');
// Files of daten/ that describe THIS update (or the app console) — never backed up or restored, so a
// rollback cannot overwrite the log that explains it.
// 93-11: also the hidden server's log and the app window's browser profile (fenster-profil/, Edge/Chrome —
// large, and its files are locked while the window is open, which would break the copy).
const NICHT_SICHERN = new Set(['update.log', 'app.log', 'update-ergebnis.json', 'server.log', 'server.log.1', 'fenster-profil']);
/** Backups (.update/sicherung-*) kept after an update, newest first [ASSUMED: 2 = this one + one before]. */
const BEHALTEN = 2;
/** How long the restarted app may take to answer /api/status, ms [ASSUMED: first start of a cold Node + DB load ≈ 5–20 s]. */
const GESUNDHEIT_MS = Number(process.env.BIT_UPDATE_WARTEZEIT_MS) || 60_000;
const KEIN_NEUSTART = process.env.BIT_UPDATE_KEIN_NEUSTART === '1';

function log(text) {
  const zeile = `${new Date().toISOString()} ${text}\n`;
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, zeile); } catch { /* logging must never stop the update */ }
}
const lockHash = (ordner) => { const p = path.join(ordner, 'package-lock.json'); return fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null; };
const versionVon = (ordner) => { try { return String(JSON.parse(fs.readFileSync(path.join(ordner, 'package.json'), 'utf8')).version || ''); } catch { return ''; } };
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

/** Write the outcome for /api/update (letztesUpdate). */
function ergebnisSchreiben(ergebnis, von, nach, grund = null) {
  try {
    fs.mkdirSync(DATEN, { recursive: true });
    fs.writeFileSync(ERGEBNIS, `${JSON.stringify({ ergebnis, von, nach, zeit: new Date().toISOString(), grund }, null, 2)}\n`);
  } catch (e) { log(`Ergebnisdatei nicht geschrieben: ${/** @type {any} */ (e).message}`); }
}

/** Copy daten/ (without the logs of this update) into the backup. Returns the number of top-level entries. */
function datenSichern() {
  if (!fs.existsSync(DATEN)) return 0;
  const ziel = path.join(SICHERUNG, 'daten');
  fs.mkdirSync(ziel, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(DATEN)) {
    if (NICHT_SICHERN.has(name)) continue;
    fs.cpSync(path.join(DATEN, name), path.join(ziel, name), { recursive: true });
    n += 1;
  }
  return n;
}

/** Put daten/ back from the backup (everything except the logs of this update). */
function datenZurueck() {
  const quelle = path.join(SICHERUNG, 'daten');
  if (!fs.existsSync(quelle)) { log('Keine Datensicherung vorhanden – Daten bleiben unverändert.'); return; }
  for (const name of fs.existsSync(DATEN) ? fs.readdirSync(DATEN) : []) {
    if (!NICHT_SICHERN.has(name)) fs.rmSync(path.join(DATEN, name), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(quelle)) fs.cpSync(path.join(quelle, name), path.join(DATEN, name), { recursive: true });
  log('Daten aus der Sicherung zurückgeholt.');
}

/** PIDs listening on a TCP port of this machine (netstat on Windows, lsof/fuser elsewhere). */
function portPids(port) {
  const pids = new Set();
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    // A listening socket has the foreign address *:0 — the state word itself is localised (LISTENING/ABHÖREN).
    for (const z of String(r.stdout || '').split(/\r?\n/)) {
      const m = /^\s*TCP\s+\S+:(\d+)\s+\S+:0\s+\S+\s+(\d+)\s*$/i.exec(z);
      if (m && Number(m[1]) === port && Number(m[2]) > 0) pids.add(Number(m[2]));
    }
  } else {
    let r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    if (r.error) r = spawnSync('fuser', [`${port}/tcp`], { encoding: 'utf8' });
    for (const t of String(r.stdout || '').split(/\s+/)) if (/^\d+$/.test(t)) pids.add(Number(t));
  }
  return [...pids];
}

/** Parent PID and image name of a Windows process (to close the console window of start-windows.cmd too). */
function elternprozess(pid) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if($p){$q=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.ParentProcessId); if($q){"$($q.ProcessId) $($q.Name)"}}`],
  { encoding: 'utf8', windowsHide: true });
  const m = /^(\d+)\s+(\S+)/.exec(String(r.stdout || '').trim());
  return m ? { pid: Number(m[1]), name: m[2].toLowerCase() } : null;
}

/** Stop the freshly started (unhealthy) app: the child we spawned and whatever listens on the port. */
async function neuenServerStoppen(kind) {
  if (KEIN_NEUSTART) return;
  const pids = new Set(portPids(PORT));
  if (kind?.pid && process.platform !== 'win32') pids.add(kind.pid);
  for (const pid of pids) {
    if (process.platform === 'win32') {
      const eltern = elternprozess(pid);
      const ziel = eltern && eltern.name === 'cmd.exe' ? eltern.pid : pid;
      spawnSync('taskkill', ['/PID', String(ziel), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
    }
  }
  for (let i = 0; i < 20 && portPids(PORT).length; i += 1) await warte(500);
  for (const pid of portPids(PORT)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  log(`Neuer Server gestoppt (${[...pids].join(', ') || 'kein Prozess am Port'}).`);
}

/** Start the app in the background. Returns the spawned child (its pid is the node process on macOS/Linux). */
function neustarten() {
  if (KEIN_NEUSTART) { log('Neustart übersprungen (Test).'); return null; }
  const env = { ...process.env, BIT_KEIN_BROWSER: '1' };
  let kind;
  if (process.platform === 'win32') {
    // 93-11: hidden like tools/app-start.mjs — no console window after an update; output to daten/server.log.
    // The packages are installed already at this point (npm ci above), so start-windows.cmd's first-start
    // work is not needed.
    fs.mkdirSync(DATEN, { recursive: true });
    const out = fs.openSync(path.join(DATEN, 'server.log'), 'a');
    kind = spawn(process.execPath, ['--env-file-if-exists=.env', path.join('server', 'index.js'), '--app'], {
      cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, out], env: { ...env, BIT_DATA_DIR: DATEN },
    });
  } else {
    fs.mkdirSync(DATEN, { recursive: true });
    const out = fs.openSync(path.join(DATEN, 'app.log'), 'a');
    kind = spawn('sh', [path.join(ROOT, 'start.sh')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env });
  }
  kind.unref();
  log('Neustart ausgelöst.');
  return kind;
}

/**
 * Does the app answer GET /api/status with the expected version within GESUNDHEIT_MS?
 * @param {string} version expected version ('' = any version)
 * @returns {Promise<boolean>}
 */
async function gesundheit(version) {
  const sim = process.env.BIT_UPDATE_TEST_GESUNDHEIT;
  if (sim) { log(`Gesundheitsprüfung (Test): ${sim === 'ok' ? 'bestanden' : 'fehlgeschlagen'}.`); return sim === 'ok'; }
  if (KEIN_NEUSTART && process.env.BIT_UPDATE_PRUEFEN !== '1') { log('Gesundheitsprüfung übersprungen (kein Neustart).'); return true; }
  const ende = Date.now() + GESUNDHEIT_MS;
  let zuletzt = 'keine Antwort';
  while (Date.now() < ende) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (!version || j?.version === version) { log(`Gesundheitsprüfung bestanden: Fassung ${j?.version} antwortet auf Port ${PORT}.`); return true; }
        zuletzt = `antwortet mit Fassung ${j?.version} statt ${version}`;
      } else zuletzt = `HTTP ${r.status}`;
    } catch (e) { zuletzt = /** @type {any} */ (e).message; }
    await warte(1000);
  }
  log(`Gesundheitsprüfung fehlgeschlagen nach ${Math.round(GESUNDHEIT_MS / 1000)} s (${zuletzt}).`);
  return false;
}

/** Keep only the newest BEHALTEN backups (names carry an ISO time, so name order = time order). */
function aufraeumen() {
  const ordner = path.join(ROOT, '.update');
  const alle = fs.existsSync(ordner) ? fs.readdirSync(ordner).filter((n) => n.startsWith('sicherung-')).sort().reverse() : [];
  for (const name of alle.slice(BEHALTEN)) {
    try { fs.rmSync(path.join(ordner, name), { recursive: true, force: true }); log(`Alte Sicherung entfernt: ${name}.`); } catch (e) {
      log(`Alte Sicherung ${name} nicht entfernt: ${/** @type {any} */ (e).message}`);
    }
  }
}

async function main() {
  log(`Update startet in ${ROOT} (alter Server pid ${PID}, Port ${PORT}).`);
  for (let i = 0; PID && lebt(PID) && i < 120; i += 1) await warte(500);
  if (PID && lebt(PID)) throw new Error('Der alte Server läuft nach 60 s noch – Update abgebrochen.');
  if (!fs.existsSync(path.join(NEU, 'package.json'))) throw new Error('Kein vorbereitetes Update in .update/neu.');

  const alteVersion = versionVon(ROOT);
  const neueVersion = versionVon(NEU);
  const alterLock = lockHash(ROOT);
  const verschoben = [];
  const eingesetzt = [];
  let modulesGesichert = false;

  /** Undo the swap: new entries out, backed-up entries back, old node_modules back. */
  const programmZurueck = () => {
    for (const name of eingesetzt) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
    for (const name of verschoben) verschieben(path.join(SICHERUNG, name), path.join(ROOT, name));
    if (modulesGesichert) {
      fs.rmSync(path.join(ROOT, 'node_modules'), { recursive: true, force: true });
      verschieben(path.join(SICHERUNG, 'node_modules'), path.join(ROOT, 'node_modules'));
    }
    log('Programmdateien der vorigen Fassung zurückgesetzt.');
  };

  try {
    log(`Daten gesichert (${datenSichern()} Einträge aus daten/ nach ${path.basename(SICHERUNG)}/daten).`);
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
      if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
        verschieben(path.join(ROOT, 'node_modules'), path.join(SICHERUNG, 'node_modules'));
        modulesGesichert = true;
      }
      log('package-lock.json geändert – npm ci --omit=dev …');
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const r = spawnSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
      log(String(r.stdout || '').slice(-2000) + String(r.stderr || '').slice(-2000));
      if (r.status !== 0) throw new Error(`npm ci fehlgeschlagen (Code ${r.status}).`);
    }
    fs.rmSync(NEU, { recursive: true, force: true });
    log(`Update fertig (${alteVersion} → ${neueVersion}). Neustart und Gesundheitsprüfung folgen.`);
  } catch (e) {
    const grund = /** @type {any} */ (e).message;
    log(`FEHLER: ${grund} – Rückfall auf die vorige Fassung.`);
    // Entries that were never moved out are still the old ones and stay untouched; the app has not run,
    // so the data are unchanged and stay as they are.
    programmZurueck();
    log('Rückfall abgeschlossen.');
    ergebnisSchreiben('fehlgeschlagen', alteVersion, neueVersion, grund);
    neustarten();
    await gesundheit(alteVersion);
    aufraeumen();
    return;
  }

  const kind = neustarten();
  if (await gesundheit(neueVersion)) {
    ergebnisSchreiben('ok', alteVersion, neueVersion);
    aufraeumen();
    return;
  }

  // 92-05: the new version installed fine but does not run — go back to the old one, data included.
  log(`Die neue Fassung ${neueVersion} läuft nicht – Rücksprung auf ${alteVersion} (Programm und Daten).`);
  await neuenServerStoppen(kind);
  try {
    programmZurueck();
    datenZurueck();
  } catch (e) {
    log(`FEHLER beim Rücksprung: ${/** @type {any} */ (e).message} – Sicherung liegt unter .update/${path.basename(SICHERUNG)}.`);
  }
  ergebnisSchreiben('zurueckgenommen', alteVersion, neueVersion, `Fassung ${neueVersion} antwortete nicht innerhalb von ${Math.round(GESUNDHEIT_MS / 1000)} s.`);
  neustarten();
  log(await gesundheit(alteVersion) ? `Vorige Fassung ${alteVersion} läuft wieder.` : `Auch die vorige Fassung ${alteVersion} antwortet nicht – bitte start-windows.cmd bzw. start.sh von Hand starten.`);
  aufraeumen();
}

main().catch((e) => { log(`ABBRUCH: ${e.message}`); neustarten(); process.exitCode = 1; });
