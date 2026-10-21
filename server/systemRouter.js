// systemRouter.js — facts about THIS installation that only the local server knows (plan 92-07), mounted
// under /api by server/index.js:
//
//   GET  /api/system/datenordner          → { ordner, dateien: { db, personal } }   absolute paths
//   POST /api/system/datenordner/oeffnen  → { ok: true }  opens the data folder in Explorer / Finder / the
//                                            file manager (explorer.exe, open, xdg-open)
//   GET  /api/system/ki-anbindung         → { node, mcpServer, vorhanden, apiUrl, standardPort }
//                                            what an MCP client needs: this Node binary (process.execPath) and
//                                            the absolute path of tools/mcp-server.mjs
//   GET  /api/system/sicherung            → status of the automatic backup (93-06, server/sicherung.js)
//   POST /api/system/sicherung            → back up now; { ok, name, zeit, bytes, dateien } or 500 { error }
//
// Why: Settings › "Daten & Sicherung" shows where the projects really are (the installer puts them under
// %LOCALAPPDATA%, which office backups often miss — lever Nr. 155), and "KI-Verbindungen" shows a ready MCP
// entry with real paths instead of a placeholder (Nr. 154).
//
// Security: absolute paths name the user's account folder, so every route answers only while the API is
// bound to the loopback interface (no API_HOST LAN opt-out) — otherwise 403. Opening a folder is an action:
// POST plus an Origin of the app itself (same rule as /api/update/installieren); the folder is always the
// data folder, never a path from the request, and the opener runs without a shell; since 104-10 it also
// passes the path rule (@core/lib/pfadRichtlinie.js) before the opener starts.
//
// 93-03: also refused per request for a paired LAN device of the office mode (anfrageEntfernt) — the
// server may bind 127.0.0.1 and still serve such a device through the extra LAN listeners.
//
// In:  { root, port, lokalGebunden, origins?, anfrageEntfernt?, datenOrdnerFn?, oeffnen?, execPath?, sicherung? }
//      (datenOrdnerFn/oeffnen/execPath/sicherung injectable for tests; without `sicherung` the backup routes
//      answer 404). Out: an Express router.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Router } from 'express';
import { datenOrdner } from './datenPfad.js';
import { pfadRichtlinie } from '../packages/nova-core/src/lib/pfadRichtlinie.js';

/**
 * Open a folder in the desktop's file manager. Resolves once the opener process started.
 * 104-10: the folder passes the path rule first (pfadRichtlinie, network shares allowed — the data folder
 * is the operator's own BIT_DATA_DIR). explorer.exe / open / xdg-open also open URLs and treat a leading
 * "/" or "-" as a switch, so nothing but an absolute local or share path ever reaches them.
 * @param {string} ordner absolute folder path
 * @param {NodeJS.Platform} [plattform]
 * @returns {Promise<void>} rejects with the plain-text reason when the rule refuses the folder
 */
export function ordnerOeffnen(ordner, plattform = process.platform) {
  const regel = pfadRichtlinie(ordner, { plattform: plattform === 'win32' ? 'win32' : 'posix', netzwerkErlaubt: true });
  if (!regel.ok) return Promise.reject(new Error(regel.meldung));
  const programm = plattform === 'win32' ? 'explorer.exe' : plattform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const kind = spawn(programm, [ordner], { detached: true, stdio: 'ignore', windowsHide: false });
    kind.once('error', (e) => reject(new Error(`${programm} konnte nicht gestartet werden: ${e.message}`)));
    kind.once('spawn', () => { kind.unref(); resolve(); });
  });
}

/**
 * @param {{root: string, port: number|string, lokalGebunden: boolean, origins?: string[],
 *   anfrageEntfernt?: (req: any) => boolean,
 *   datenOrdnerFn?: () => string, oeffnen?: (ordner: string) => Promise<void>, execPath?: string,
 *   sicherung?: {status: () => object, jetztSichern: () => object}|null, personalSchluessel?: string|null}} o
 *   root = app folder (absolute); port = this server's port; lokalGebunden = API bound to loopback only;
 *   origins = further allowed Origins for the POST (e.g. the Vite dev server); anfrageEntfernt = the request
 *   comes from another device (93-03 office mode), default never; sicherung = the backup service of
 *   server/sicherung.js (93-06); personalSchluessel = path of the personnel key file (96-01)
 * @returns {import('express').Router}
 */
export function systemRouter({ root, port, lokalGebunden, origins = [], anfrageEntfernt = () => false, datenOrdnerFn = () => datenOrdner(), oeffnen = ordnerOeffnen, execPath = process.execPath, sicherung = null, personalSchluessel = null }) {
  const r = Router();
  const erlaubteOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...origins]);
  const nurLokal = (req, res, next) => (lokalGebunden && !anfrageEntfernt(req) ? next()
    : res.status(403).json({ error: 'Nur verfügbar, solange die App ausschließlich auf diesem Rechner erreichbar ist (API_HOST nicht gesetzt).' }));

  r.get('/system/datenordner', nurLokal, (_req, res) => {
    const ordner = datenOrdnerFn();
    // 96-01: where the personnel key lives (outside the data folder) — it must be backed up separately.
    res.json({ ordner, dateien: { db: path.join(ordner, 'db.json'), personal: path.join(ordner, 'personal.json') }, personalSchluessel });
  });

  r.post('/system/datenordner/oeffnen', nurLokal, async (req, res) => {
    if (!erlaubteOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    const ordner = datenOrdnerFn();
    try {
      await oeffnen(ordner);
      res.json({ ok: true, ordner });
    } catch (e) {
      res.status(500).json({ error: /** @type {any} */ (e).message });
    }
  });

  // 94-08 "Problem melden": the last lines of update.log and server.log for the issue text. Loopback
  // only (they name folders of this machine); the client cleans them (src/lib/problemMelden.js)
  // and shows everything before the user decides to open GitHub.
  r.get('/system/protokoll', nurLokal, (_req, res) => {
    const ordner = datenOrdnerFn();
    const ende = (name, n) => {
      try {
        const text = fs.readFileSync(path.join(ordner, name), 'utf-8');
        return text.split(/\r?\n/).filter(Boolean).slice(-n).map((z) => `[${name}] ${z.slice(0, 400)}`);
      } catch {
        return [];
      }
    };
    res.set('Cache-Control', 'no-store');
    res.json({ zeilen: [...ende('update.log', 15), ...ende('server.log', 25)] });
  });

  // 93-06: the status names an absolute folder (account name) → loopback only, like the data folder.
  r.get('/system/sicherung', nurLokal, (_req, res) => {
    if (!sicherung) return res.status(404).json({ error: 'Automatische Sicherung nicht verfügbar.' });
    res.json(sicherung.status());
  });

  // Backing up is an action (writes a zip, deletes old ones by retention): POST + Origin of the app.
  r.post('/system/sicherung', nurLokal, (req, res) => {
    if (!erlaubteOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    if (!sicherung) return res.status(404).json({ error: 'Automatische Sicherung nicht verfügbar.' });
    try {
      const e = /** @type {any} */ (sicherung.jetztSichern());
      res.json({ ok: true, name: e.name, zeit: e.zeit, bytes: e.bytes, dateien: e.dateien });
    } catch (e) {
      res.status(500).json({ error: /** @type {any} */ (e).message });
    }
  });

  r.get('/system/ki-anbindung', nurLokal, (_req, res) => {
    const mcpServer = path.join(root, 'tools', 'mcp-server.mjs');
    res.json({
      node: execPath, mcpServer, vorhanden: fs.existsSync(mcpServer),
      apiUrl: `http://127.0.0.1:${port}/api`, standardPort: String(port) === '3001',
    });
  });

  return r;
}
