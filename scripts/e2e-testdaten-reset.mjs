#!/usr/bin/env node
// e2e-testdaten-reset.mjs — plan 100-07: put the TEST database back to a known state before a full E2E run.
//
// Safe by construction (redesign after the data incident of 19.11.2026, where a bypass flag let the reset delete a person's
// real data): the script only ever works in a folder that carries a marker file ".bit-testdaten" whose content is the
// folder's own absolute real path. There is no flag, no name heuristic and no exported delete without the guard.
//
// Guard (testOrdnerPruefen), all of it on real paths (symlinks resolved first):
//   - BIT_DATA_DIR unset → refused (the server's default is the source checkout's server/ folder with real data).
//   - BIT_DATA_DIR itself a symlink → refused (a marker reached through a link would authorise another place).
//   - Hard refusals, independent of any marker: the file-system root, the home folder, this repository, the system temp
//     folder itself, any folder that IS or CONTAINS one of them, any folder inside this repository or inside any other source
//     checkout (an ancestor with package.json + server/ or .git), a folder named server/ beside a package.json, and a folder
//     that holds program or project files anywhere below it (.js/.mjs/.cjs, package.json, .git).
//   - Existing folder: the marker must be a regular file (not a symlink) inside it whose trimmed content equals the folder's
//     real path. Missing or wrong marker → refused, with a German text that says how to write the marker by hand.
//   - Missing folder: created ONLY inside the system temp folder; the reset then writes the marker itself.
// Port check: refuses while something listens on API_PORT (default 3001) or PORT (default 5173) - a running server keeps the
// database in memory and would write its old state back, and Playwright would reuse it (reuseExistingServer).
// Reset (testdatenZuruecksetzen, runs the guard again itself): removes ONLY the fixed TESTDATEN_EINTRAEGE inside the verified
// folder (a symlinked entry loses only the link), runs server/seed.js into it, adds the "Review Testhaus" (project + BimModel
// from tests/e2e/fixtures/testhaus-record.json) that global-setup expects.
//
// Usage:  BIT_DATA_DIR=<marked test folder> npm run test:e2e:frisch       (reset, then playwright test)
//         BIT_DATA_DIR=<marked test folder> node scripts/e2e-testdaten-reset.mjs
// In:  process.env (BIT_DATA_DIR, PORT, API_PORT). Out: exit 0 after a reset, 1 when refused or failed; one line per step.
// Exports the guard, the port check and the guarded reset for tests/unit/e2eTestdatenReset-10007.test.js.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from '../packages/nova-core/server/db.js';
import { TESTHAUS, TESTHAUS_FIXTURE, TESTHAUS_PROJEKT } from '../tests/e2e/fixtures/testhaus.js';

/** Repository root (this file lives in scripts/). */
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Name of the marker file that makes a folder a test data folder; its content is the folder's absolute real path. */
export const MARKER_NAME = '.bit-testdaten';

/** Data files and folders the reset removes - nothing else in the folder is touched. */
export const TESTDATEN_EINTRAEGE = Object.freeze([
  'db.json', 'db.json.bak', 'db.json.tmp', 'blobs', 'personal.json', 'personal.json.bak', 'personal.json.tmp', 'personal-blobs',
]);

/** File names below a test folder that mark program or project files (never test data). */
const PROGRAMM_DATEI = /\.(c|m)?js$/i;
const PROJEKT_EINTRAEGE = new Set(['package.json', '.git']);

/**
 * Most entries the content scan visits before it gives up and refuses. [ASSUMED: a test data folder holds a db.json and a few
 * hundred blobs; a bigger tree is no reset target - refusing is the safe direction.]
 */
export const SCAN_GRENZE = 20000;

/**
 * Places the guard knows about. Defaults are the real ones; tests pass throwaway folders. `heim` and `repos` are ADDED to
 * the real home folder and this repository - a caller can never remove those protections.
 * @typedef {object} Umgebung
 * @property {string} [temp] the system temp folder (default os.tmpdir()) - the only place a missing folder may be created
 * @property {string[]} [heim] further folders treated like the home folder
 * @property {string[]} [repos] further folders treated like this repository
 */

/** @param {string} p @returns {boolean} whether something exists at p (a dangling symlink counts) */
function vorhanden(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

/** @param {string} p @returns {string} real path when it exists, else the resolved path */
function echt(p) {
  const r = path.resolve(p);
  try { return fs.realpathSync(r); } catch { return r; }
}

/**
 * Real path of a folder that may not exist yet: the nearest existing ancestor is resolved, the missing rest appended.
 * @param {string} p absolute path @returns {string}
 */
function echtAuchNeu(p) {
  const teile = [];
  let cur = path.resolve(p);
  while (!vorhanden(cur)) {
    const eltern = path.dirname(cur);
    if (eltern === cur) break;
    teile.unshift(path.basename(cur));
    cur = eltern;
  }
  return path.join(echt(cur), ...teile);
}

/** @param {string} kind @param {string} eltern @returns {boolean} kind equals eltern or lies inside it */
function liegtIn(kind, eltern) {
  const rel = path.relative(eltern, kind);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** @param {string} ordner @returns {boolean} whether the folder looks like the root of a source checkout */
function istQuellstand(ordner) {
  if (!fs.existsSync(path.join(ordner, 'package.json'))) return false;
  return vorhanden(path.join(ordner, '.git')) || vorhanden(path.join(ordner, 'server'));
}

/**
 * Bounded walk below a folder (symlinks are not followed): the first program or project file, or the reason to stop.
 * @param {string} ordner @returns {string|null} German finding, or null when the tree holds only data
 */
function inhaltPruefen(ordner) {
  const stapel = [ordner];
  let gesehen = 0;
  while (stapel.length) {
    const cur = /** @type {string} */ (stapel.pop());
    let eintraege;
    try { eintraege = fs.readdirSync(cur, { withFileTypes: true }); } catch { return `${cur} ist nicht lesbar`; }
    for (const e of eintraege) {
      gesehen += 1;
      if (gesehen > SCAN_GRENZE) return `mehr als ${SCAN_GRENZE} Einträge — zu groß für einen Testordner`;
      const p = path.join(cur, e.name);
      if (PROJEKT_EINTRAEGE.has(e.name)) return `enthält ${p} (Projektdatei)`;
      if (PROGRAMM_DATEI.test(e.name)) return `enthält ${p} (Programmdatei)`;
      if (e.name === 'server' && e.isDirectory()) return `enthält einen Ordner server/ (${p})`;
      if (e.isDirectory()) stapel.push(p);
    }
  }
  return null;
}

/** @param {string} ordner @returns {string} German instruction for writing the marker by hand */
function markerAnleitung(ordner) {
  return `Wenn dieser Ordner wirklich nur Testdaten enthält, die Markierung von Hand anlegen: `
    + `printf '%s' '${ordner}' > '${path.join(ordner, MARKER_NAME)}' — die Datei ${MARKER_NAME} muss genau den echten, `
    + `absoluten Pfad des Ordners enthalten. Alternativ BIT_DATA_DIR auf einen noch nicht vorhandenen Ordner im Temp-Ordner `
    + `(${echt(os.tmpdir())}) setzen; den legt das Skript selbst an und markiert ihn.`;
}

/**
 * The guard: may this folder be reset? Pure apart from reading the file system.
 * @param {{env?: Record<string, string|undefined>, umgebung?: Umgebung}} [o] env: environment (BIT_DATA_DIR)
 * @returns {{ok: true, ordner: string, neu: boolean} | {ok: false, grund: string}}
 *   ordner: absolute real folder; neu: the folder does not exist yet (inside temp; the reset creates and marks it);
 *   grund: German refusal text
 */
export function testOrdnerPruefen({ env = process.env, umgebung = {} } = {}) {
  const nein = (/** @type {string} */ grund) => ({ ok: /** @type {false} */ (false), grund });
  const gesetzt = String(env.BIT_DATA_DIR ?? '').trim();
  if (!gesetzt) {
    return nein('BIT_DATA_DIR ist nicht gesetzt — ohne ihn schreibt der Server in server/ (echte Daten). Für den Reset BIT_DATA_DIR auf einen markierten Testordner setzen.');
  }
  const angegeben = path.resolve(gesetzt);
  let istLink = false;
  try { istLink = fs.lstatSync(angegeben).isSymbolicLink(); } catch { /* missing */ }
  if (istLink) return nein(`${angegeben} ist ein symbolischer Link — nie zurückgesetzt. BIT_DATA_DIR auf den echten Ordner setzen.`);
  const neu = !vorhanden(angegeben);
  const ordner = neu ? echtAuchNeu(angegeben) : echt(angegeben);

  const temp = echt(umgebung.temp || os.tmpdir());
  const heime = [os.homedir(), ...(umgebung.heim || [])].map(echt);
  const repos = [WURZEL, ...(umgebung.repos || [])].map(echt);
  const wurzel = path.parse(ordner).root;
  // Hard refusals - no marker lifts these.
  if (ordner === wurzel) return nein(`${ordner} ist das Wurzelverzeichnis — nie zurückgesetzt.`);
  for (const g of [...heime, ...repos, temp]) {
    if (liegtIn(g, ordner)) return nein(`${ordner} ist oder enthält ${g} — nie zurückgesetzt.`);
  }
  for (const r of repos) {
    if (liegtIn(ordner, r)) return nein(`${ordner} liegt im Quellstand ${r} — nie zurückgesetzt.`);
  }
  // Any source checkout (worktrees and the main checkout share the layout), not only this one: walk the ancestors below the
  // file-system root and refuse a folder that lies in one.
  for (let a = path.dirname(ordner); a !== path.dirname(a); a = path.dirname(a)) {
    if (istQuellstand(a)) return nein(`${ordner} liegt in einem Quellstand (${a}) — nie zurückgesetzt.`);
  }
  if (path.basename(ordner) === 'server' && fs.existsSync(path.join(path.dirname(ordner), 'package.json'))) {
    return nein(`${ordner} ist der server/-Ordner eines Quellstands — nie zurückgesetzt.`);
  }

  if (neu) {
    // Only a fresh folder inside the system temp folder may be created; elsewhere the person makes and marks it.
    if (!liegtIn(ordner, temp) || ordner === temp) {
      return nein(`${ordner} gibt es nicht. Neu angelegt wird ein Testordner nur im Temp-Ordner (${temp}); anderswo den Ordner selbst anlegen und markieren.`);
    }
    return { ok: true, ordner, neu: true };
  }

  let st;
  try { st = fs.statSync(ordner); } catch { return nein(`${ordner} ist nicht lesbar — nie zurückgesetzt.`); }
  if (!st.isDirectory()) return nein(`${ordner} ist kein Ordner — nie zurückgesetzt.`);
  const befund = inhaltPruefen(ordner);
  if (befund) return nein(`${ordner} ist kein Testordner (${befund}) — nie zurückgesetzt, auch nicht mit Markierung.`);

  const marker = path.join(ordner, MARKER_NAME);
  let mst;
  try { mst = fs.lstatSync(marker); } catch {
    return nein(`${ordner} trägt keine Markierung ${MARKER_NAME} — nie zurückgesetzt. ${markerAnleitung(ordner)}`);
  }
  if (!mst.isFile()) {
    return nein(`${marker} ist keine gewöhnliche Datei (z. B. ein symbolischer Link) — nie zurückgesetzt. ${markerAnleitung(ordner)}`);
  }
  let inhalt = '';
  try { inhalt = fs.readFileSync(marker, 'utf8').trim(); } catch { /* unreadable: refused below */ }
  if (inhalt !== ordner) {
    return nein(`Die Markierung ${marker} nennt ${inhalt ? `„${inhalt}“` : 'keinen Pfad'}, nicht diesen Ordner — nie zurückgesetzt. ${markerAnleitung(ordner)}`);
  }
  return { ok: true, ordner, neu: false };
}

/**
 * Whether something accepts connections on a local port.
 * @param {number} port TCP port @param {number} [wartezeitMs] connect timeout, ms
 * @returns {Promise<boolean>}
 */
export function portBelegt(port, wartezeitMs = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const fertig = (/** @type {boolean} */ belegt) => { s.destroy(); resolve(belegt); };
    s.setTimeout(wartezeitMs, () => fertig(false));
    s.once('connect', () => fertig(true));
    s.once('error', () => fertig(false));
  });
}

/**
 * The guarded reset: runs testOrdnerPruefen itself, then removes the fixed test data entries, seeds, adds the test house.
 * Side effects (only inside the verified folder): creates and marks a new temp folder; deletes TESTDATEN_EINTRAEGE (a
 * symlinked entry loses only the link); runs server/seed.js as a child process; writes db.json.
 * @param {{env?: Record<string, string|undefined>, umgebung?: Umgebung}} [o] same as testOrdnerPruefen
 * @returns {{ordner: string, entfernt: string[], testhausProjekt: string, testhausModell: string}}
 *   real folder; removed entries; ids of the test house records
 * @throws {Error} German text when the guard refuses or the seed fails (nothing deleted when refused)
 */
export function testdatenZuruecksetzen({ env = process.env, umgebung = {} } = {}) {
  const p = testOrdnerPruefen({ env, umgebung });
  if (!p.ok) throw new Error(`abgelehnt: ${p.grund}`);
  const { ordner } = p;
  if (p.neu) {
    fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, MARKER_NAME), ordner, { flag: 'wx' });
  }
  // Second look right before deleting: the folder must still be the one the marker names.
  const nochmal = testOrdnerPruefen({ env: { BIT_DATA_DIR: ordner }, umgebung });
  if (!nochmal.ok || nochmal.ordner !== ordner || nochmal.neu) throw new Error(`abgelehnt: ${nochmal.ok ? 'Ordner hat sich geändert' : nochmal.grund}`);
  const entfernt = [];
  for (const name of TESTDATEN_EINTRAEGE) {
    const ziel = path.join(ordner, name);
    let st;
    try { st = fs.lstatSync(ziel); } catch { continue; }
    if (st.isSymbolicLink()) fs.unlinkSync(ziel); // the link only, never what it points to
    else fs.rmSync(ziel, { recursive: true, force: true });
    entfernt.push(name);
  }
  const seed = spawnSync(process.execPath, [path.join(WURZEL, 'server', 'seed.js')], {
    cwd: WURZEL, env: { ...process.env, BIT_DATA_DIR: ordner }, encoding: 'utf8',
  });
  if (seed.status !== 0) throw new Error(`Seed fehlgeschlagen (Exit ${seed.status}): ${seed.stderr || seed.stdout}`);
  // The test house exactly as global-setup's testhausAnlegen would create it through the API.
  const fixture = JSON.parse(fs.readFileSync(path.join(WURZEL, TESTHAUS_FIXTURE), 'utf8'));
  const db = createDb(path.join(ordner, 'db.json'));
  const projekt = db.create('Project', { ...TESTHAUS_PROJEKT });
  const modell = db.create('BimModel', { project_id: projekt.id, ...fixture, ...TESTHAUS });
  db.flush();
  return { ordner, entfernt, testhausProjekt: projekt.id, testhausModell: modell.id };
}

/** CLI: guard, port check, guarded reset; exit code 0/1. */
async function main() {
  const pruefung = testOrdnerPruefen();
  if (!pruefung.ok) { console.error(`[e2e-reset] abgelehnt: ${pruefung.grund}`); return 1; }
  const ports = [Number(process.env.API_PORT) || 3001, Number(process.env.PORT) || 5173];
  for (const port of ports) {
    if (await portBelegt(port)) {
      console.error(`[e2e-reset] abgelehnt: auf Port ${port} läuft schon ein Server — erst beenden (er hält die DB im Speicher, Playwright würde ihn wiederverwenden).`);
      return 1;
    }
  }
  const b = testdatenZuruecksetzen();
  console.log(`[e2e-reset] ${b.ordner}: entfernt ${b.entfernt.length ? b.entfernt.join(', ') : '(nichts)'}; Seed geschrieben; Testhaus ${b.testhausProjekt} angelegt.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(`[e2e-reset] Fehler: ${err?.message || err}`); process.exitCode = 1; });
}
