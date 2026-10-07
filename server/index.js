// NovaConstruct-Backend — Kompositionswurzel der Gesamt-App (Phase 31).
// Mountet die Router-Factories aus den Paketen: core (auth/entities/llm),
// @ava (ted-search) und @designer (geo). Inline-Routen: telemetry/config, status.
//
// Plan 83-03: two run modes.
//   API only (default, `npm run dev`): Vite serves the client on :5173 and
//     proxies /api here — unchanged.
//   App mode (`npm start` = `--app`, or NODE_ENV=production / BIT_APP=1): this
//     process also serves the built client from dist/ — app and API on ONE port.
// Data files live in the folder from datenPfad.js (BIT_DATA_DIR, default server/).
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { datenOrdner, datenPfad } from './datenPfad.js';
import { appAusliefern, istAppModus } from './appAuslieferung.js';
import { createDb } from '../packages/nova-core/server/db.js';
import { createBlobStore } from '../packages/nova-core/server/blobs.js';
import { seedCatalogs } from '../packages/nova-core/server/catalog-seed.js';
import { authRouter, entitiesRouter, llmRouter, blobsRouter } from '../packages/nova-core/server/routes.js';
import { personalRouter } from '../packages/nova-core/server/personalRouter.js';
import { typesafeRouter } from '../packages/nova-core/server/typesafe.js';
import { pricesRouter } from '../packages/nova-ausschreibung/server/routes.js';
import { geoRouter } from '../packages/nova-designer/server/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Use a dedicated env var (not PORT) so the backend never collides with the
// frontend dev server, whose port may be injected via PORT by tooling.
const PORT = process.env.API_PORT || 3001;

// This API answers with the office's project data and has no authentication of its own
// (routes.js serves a fixed DEV_USER). `cors()` without arguments sets
// Access-Control-Allow-Origin: * — any web page open in the browser could then read
// http://localhost:3001/api/entities/Project and overwrite it via POST .../bulk. So only
// the app's own dev/preview origins are allowed; extra ones come from API_ORIGINS
// (comma-separated) for cases like the Tauri client of phase 70.
const ERLAUBTE_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173',   // vite dev
  'http://localhost:4173', 'http://127.0.0.1:4173',   // vite preview / client build
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
  ...String(process.env.API_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
];
app.use(cors({
  // No Origin header at all (curl, same-origin fetch, Electron/Tauri file://) is allowed —
  // those are not the browser-driven cross-site case this guard is about.
  origin: (origin, cb) => cb(null, !origin || ERLAUBTE_ORIGINS.includes(origin)),
}));
app.use(express.json({ limit: '10mb' }));

// DB-Factory: Daten bleiben physisch in server/db.json (Pitfall 1 — keine Migration),
// außer BIT_DATA_DIR zeigt auf einen eigenen Datenordner (83-03, Release-Start).
const db = createDb(datenPfad('db.json'));

// Blob-Store (Phase 33): große, ABGELEITETE Nutzlasten (Bauteillisten) liegen
// NEBEN db.json, damit jeder persist() klein bleibt (T-33-03).
export const blobs = createBlobStore(datenPfad('blobs'));

// Personal-Speicherklasse (Plan 80-02, D-P80-A #4): eigene Datei, eigene
// Blobs — NIE db.json/blobs/, damit ein Büro seine HR-Daten unabhängig vom
// Projektbestand sichern/verschlüsseln/aus OneDrive ausschließen kann.
const personalDb = createDb(datenPfad('personal.json'));
const personalBlobs = createBlobStore(datenPfad('personal-blobs'));
// Dieselbe Quelle wie HOST weiter unten (API_HOST) — hier vorab ausgewertet,
// weil personalRouter() die Loopback-Sperre schon beim Mounten braucht;
// die HOST-Zeile bleibt bewusst unverschoben (Kompositionswurzel-Reihenfolge).
const lokalGebunden = !process.env.API_HOST || ['127.0.0.1', '::1', 'localhost'].includes(process.env.API_HOST);

// Die 14 büroweiten Kataloge als Bürostandard anlegen (idempotent: vorhandene
// Kataloge werden NICHT überschrieben, damit Büro-Edits erhalten bleiben).
const katalogReport = seedCatalogs(db);
const neuGeseedet = Object.entries(katalogReport).filter(([, v]) => v.angelegt > 0);
if (neuGeseedet.length > 0) {
  console.log(
    `[kataloge] ${neuGeseedet.length} Katalog(e) neu angelegt: ` +
      neuGeseedet.map(([k, v]) => `${k}=${v.angelegt}`).join(', ')
  );
}

app.use('/api', authRouter());
app.use('/api', entitiesRouter(db));
app.use('/api', personalRouter(personalDb, personalBlobs, { lokalGebunden }));
app.use('/api', blobsRouter(blobs));
app.use('/api', llmRouter(db));
// 76-01: TypeSafe-Urteile (Wahrscheinlichkeiten, kein Mock)
app.use('/api', typesafeRouter());
app.use('/api', pricesRouter());
app.use('/api', geoRouter());

// --- Status (83-03): what the MCP server's bit_status and scripts ask first ---
// Name and version from package.json, the run mode — no paths, no data.
const PAKET = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const APP_MODUS = istAppModus();
app.get('/api/status', (_req, res) => {
  res.json({ name: PAKET.name, version: PAKET.version, modus: APP_MODUS ? 'app' : 'api', node: process.versions.node });
});

// --- Telemetry source configuration (prepares MQTT/WebRTC integration) ------
// App-only — bleibt als einzige Inline-Route in der Kompositionswurzel.
app.get('/api/telemetry/config', (_req, res) => {
  res.json({
    source: process.env.TELEMETRY_SOURCE || 'simulation', // simulation | mqtt | webrtc
    mqtt: {
      url: process.env.MQTT_URL || null, // e.g. wss://broker.local:8084/mqtt
      topicTelemetry: process.env.MQTT_TOPIC_TELEMETRY || 'site/+/telemetry',
      topicCommand: process.env.MQTT_TOPIC_COMMAND || 'site/{unitId}/command',
    },
    webrtc: {
      signalingUrl: process.env.WEBRTC_SIGNALING_URL || null, // e.g. wss://gateway.local/webrtc
    },
  });
});

// --- IFC-Viewer-Routen (rein lesend, dev-only; Pfade aus IFC_DIR/IFC_TEST_FILE/NOVA_FILTER_DIR) ---

// --- Phase-30-Viewer (aus JBs Rückgabe 260821 übernommen): lokales Test-IFC streamen ---
// Erlaubt der /IfcTest-Seite, das große Referenzmodell ohne Datei-Dialog zu laden, und
// den zugehörigen lokalen OneDrive-Ordner aufzulisten, damit im Browser die
// jeweils neueste Datei per Knopf nachgeladen werden kann, ohne Pfad/Server-Neustart.
// Pfad/Ordner kommen aus IFC_TEST_FILE / IFC_DIR (nur .ifc, rein lesend, nur dev).
async function resolveIfcDir() {
  const path = await import('path');
  const dir = process.env.IFC_DIR || '';
  if (dir) return dir;
  const p = process.env.IFC_TEST_FILE || '';
  if (p) return path.dirname(p);
  return '';
}

app.get('/api/ifc-files', async (_req, res) => {
  const dir = await resolveIfcDir();
  if (!dir) return res.status(404).json({ error: 'Kein IFC-Ordner ermittelbar (IFC_DIR oder IFC_TEST_FILE setzen)' });
  try {
    const { readdirSync, statSync } = await import('fs');
    const path = await import('path');
    const entries = readdirSync(dir);
    const files = [];
    for (const name of entries) {
      if (name.startsWith('.') || name.startsWith('~$')) continue;
      if (!name.toLowerCase().endsWith('.ifc')) continue;
      const full = path.join(dir, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      files.push({ name, size: stat.size, mtime: stat.mtimeMs });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    res.json({ dir, files });
  } catch (e) {
    res.status(404).json({ error: `Ordner nicht lesbar: ${e.message}` });
  }
});

app.get('/api/ifc-test-file', async (req, res) => {
  const path = await import('path');
  let p = process.env.IFC_TEST_FILE || '';
  const name = req.query.name;
  if (name != null && name !== '') {
    const base = path.basename(String(name));
    if (base !== String(name) || base.includes('..')) {
      return res.status(400).json({ error: 'Ungültiger Dateiname (kein Pfad erlaubt)' });
    }
    const dir = await resolveIfcDir();
    if (!dir) return res.status(404).json({ error: 'Kein IFC-Ordner ermittelbar (IFC_DIR oder IFC_TEST_FILE setzen)' });
    p = path.join(dir, base);
  }
  if (!p || !p.endsWith('.ifc')) return res.status(404).json({ error: 'IFC_TEST_FILE nicht gesetzt (.ifc-Pfad)' });
  try {
    const { createReadStream, statSync } = await import('fs');
    const size = statSync(p).size;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', size);
    createReadStream(p).pipe(res);
  } catch (e) {
    res.status(404).json({ error: `Datei nicht lesbar: ${e.message}` });
  }
});

// --- Phase-30-Viewer (aus JBs Rückgabe 260821 übernommen): NOVA-Bauteilfilter lesen ---
// Liefert die als XML exportierten NOVA-AVA-Filter (Büro-Vorlagenordner) an die
// IFC-Seite, damit dieselben Filter ohne NOVA direkt aufs Modell angewandt werden.
// Pfad aus NOVA_FILTER_DIR (rein lesend, nur *.xml, nur dev).
// BAUTEILFILTER_DIR is the neutral name; NOVA_FILTER_DIR stays as fallback for
// existing local setups (phase 78 hotfix).
app.get('/api/bauteilfilter', async (_req, res) => {
  const dir = process.env.BAUTEILFILTER_DIR || process.env.NOVA_FILTER_DIR || '';
  if (!dir) return res.status(404).json({ error: 'BAUTEILFILTER_DIR nicht gesetzt' });
  try {
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const path = await import('path');
    const out = [];
    const walk = (d, rel = '') => {
      for (const name of readdirSync(d)) {
        const full = path.join(d, name);
        if (statSync(full).isDirectory()) walk(full, rel ? `${rel}/${name}` : name);
        else if (name.toLowerCase().endsWith('.xml')) {
          out.push({ gruppe: rel || '(Wurzel)', datei: name, xml: readFileSync(full, 'utf8') });
        }
      }
    };
    walk(dir);
    res.json({ verzeichnis: dir, anzahl: out.length, filter: out });
  } catch (e) {
    res.status(404).json({ error: `Filterverzeichnis nicht lesbar: ${e.message}` });
  }
});

// --- App mode (83-03): the built client on the same port, AFTER all /api routes ---
const DIST_ORDNER = path.join(__dirname, '..', 'dist');
if (APP_MODUS) {
  try {
    appAusliefern(app, DIST_ORDNER);
  } catch (err) {
    console.error(`[app] ${err.message}`);
    // `--app` is an explicit request for the app — without a build there is nothing
    // to open, so stop with the reason instead of a silent API-only server.
    if (process.argv.includes('--app')) process.exit(1);
    console.error('[app] Continuing with the API only (no user interface).');
  }
}

// Bind to the loopback interface explicitly. Without a host Express listens on every
// interface, so the office data were reachable from any other device on the same WLAN.
// API_HOST allows an explicit opt-out for a deliberate LAN setup.
const HOST = process.env.API_HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  if (APP_MODUS) {
    console.log(`BIT-Atelier running on http://localhost:${PORT} (app + API on one port, bound to ${HOST})`);
  } else {
    console.log(`BIT-Atelier local API running on http://${HOST}:${PORT}`);
  }
  console.log(`Data folder: ${datenOrdner()}`);
  console.log('The API has no login: it is reachable from this computer only. Never forward or expose this port.');
  if (!lokalGebunden) {
    console.warn(`[warning] API_HOST=${HOST} — the API WITHOUT login is reachable from other devices in this network.`);
  }
});
server.on('error', (err) => {
  // EADDRINUSE is the common case (a second start, or the dev stack still running).
  const grund = err.code === 'EADDRINUSE'
    ? `port ${PORT} is already in use — is BIT-Atelier already running? Otherwise set API_PORT.`
    : err.message;
  console.error(`[server] Start failed: ${grund}`);
  process.exit(1);
});
