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
//
// Plan 93-03 (office mode): the server binds 127.0.0.1 as before. Switched on in Settings › System & Info,
// it binds the private LAN addresses of this computer as well (bueroRouter.js lanServer); every request that
// is not loopback then passes bueroWaechter: private source address + paired device token + allow-list.
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { datenOrdner, datenPfad } from './datenPfad.js';
import { updateRouter } from './updateRouter.js';
import { updateCheckAus } from './selbstUpdate.js';
import { systemRouter } from './systemRouter.js';
import { dateiOeffnenRouter } from './dateiOeffnenRouter.js';
import { programmRouter } from './programmRouter.js';
import { steuerungRouter, steuerungsToken } from './steuerungRouter.js';
import { schreibeAtomar } from '../packages/nova-core/server/atomarErsetzen.js';
import { sicherungsDienst } from './sicherung.js';
import { appAusliefern, istAppModus } from './appAuslieferung.js';
import { createBuero } from './bueroModus.js';
import { hostWaechter } from './hostWaechter.js';
import { ERNEUERN_KOPF, sitzungsRouter, sitzungsSchutz, sitzungsToken } from './sitzungsSchutz.js';
import { bueroRouter, bueroWaechter, lanServer, HINWEIS_HEADER } from './bueroRouter.js';
import { kiLokalRouter, harnessUmgebung } from './kiLokalRouter.js';
import { harnessManager } from './harnessProzess.js';
import { kiEinstellungenLesen } from '../packages/nova-core/server/llmLokal.js';
import { createDb } from '../packages/nova-core/server/db.js';
import { createBlobStore } from '../packages/nova-core/server/blobs.js';
import { ladeSchluessel, standardSchluesselPfad, verschluesselteDatenVorhanden, verschluesselungsCodec } from '../packages/nova-core/server/ruheVerschluesselung.js';
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
// 93-03: the office mode — state in buero.json of the data folder, LAN listeners on the same app and port.
// The gate runs FIRST: loopback passes unchanged, everything else needs office mode + a paired device.
const buero = createBuero({ datei: datenPfad('buero.json') });
const lan = lanServer({ app, port: PORT });
const anfrageEntfernt = (req) => req.bitZugang?.lokal === false;
// DNS rebinding: only localhost / IP literals / BIT_ERLAUBTE_HOSTS reach any route (hostWaechter.js).
app.use(hostWaechter());
app.use(bueroWaechter(buero));
app.use(cors({
  // No Origin header at all (curl, same-origin fetch, Electron/Tauri file://) is allowed —
  // those are not the browser-driven cross-site case this guard is about.
  // 93-03: the LAN origins of the office mode only while their listeners run.
  origin: (origin, cb) => cb(null, !origin || ERLAUBTE_ORIGINS.includes(origin) || lan.origins().includes(origin)),
  exposedHeaders: [HINWEIS_HEADER, ERNEUERN_KOPF],
}));
app.use(express.json({ limit: '10mb' }));
// 96-04: browser writes need X-Bit-Session (a token of this server run) — a form POST
// of a foreign web page is executed despite CORS otherwise. Tools without a browser pass.
const SITZUNG = sitzungsToken();
app.use('/api', sitzungsRouter({ token: SITZUNG }));
app.use('/api', sitzungsSchutz({ token: SITZUNG }));

// DB-Factory: Daten bleiben physisch in server/db.json (Pitfall 1 — keine Migration),
// außer BIT_DATA_DIR zeigt auf einen eigenen Datenordner (83-03, Release-Start).
const db = createDb(datenPfad('db.json'));

// Blob-Store (Phase 33): große, ABGELEITETE Nutzlasten (Bauteillisten) liegen
// NEBEN db.json, damit jeder persist() klein bleibt (T-33-03).
export const blobs = createBlobStore(datenPfad('blobs'));

// Personal-Speicherklasse (Plan 80-02, D-P80-A #4): eigene Datei, eigene
// Blobs — NIE db.json/blobs/, damit ein Büro seine HR-Daten unabhängig vom
// Projektbestand sichern/verschlüsseln/aus OneDrive ausschließen kann.
// 96-01: personnel data encrypted at rest (AES-256-GCM). The key lives OUTSIDE the
// data folder (ruheVerschluesselung.js); it is only created when no encrypted
// personnel file exists yet — otherwise a missing key locks the store instead of
// starting empty over the ciphertext.
const PERSONAL_SCHLUESSEL = standardSchluesselPfad();
const personalCodec = (() => {
  try {
    const vorhanden = verschluesselteDatenVorhanden(datenPfad('personal.json'), datenPfad('personal-blobs'));
    const key = ladeSchluessel(PERSONAL_SCHLUESSEL, { erzeugen: !vorhanden });
    if (!key) {
      console.error(`[personal] Verschlüsselte Personaldaten, aber kein Schlüssel unter ${PERSONAL_SCHLUESSEL} — Personalbereich gesperrt (BIT_PERSONAL_SCHLUESSEL setzt einen anderen Ort).`);
      return verschluesselungsCodec(crypto.randomBytes(32)); // decrypts nothing → store locks, writes nothing
    }
    return verschluesselungsCodec(key);
  } catch (e) {
    console.error(`[personal] Schlüssel nicht nutzbar: ${e?.message || e} — Personalbereich gesperrt.`);
    return verschluesselungsCodec(crypto.randomBytes(32));
  }
})();
const personalDb = createDb(datenPfad('personal.json'), { codec: personalCodec });
const personalBlobs = createBlobStore(datenPfad('personal-blobs'), { codec: personalCodec });
if (!personalDb.gesperrt()) {
  try {
    const n = personalBlobs.migriere();
    if (n) console.log(`[personal] ${n} Personal-Datei(en) verschlüsselt (96-01).`);
  } catch (e) {
    console.error(`[personal] Verschlüsseln der Personal-Dateien fehlgeschlagen: ${e?.message || e}`);
  }
}
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

// 83-03 run mode, needed by the office-mode status (the app shell is only on this port in app mode).
const APP_MODUS = istAppModus();
// 93-03: before authRouter — it answers /auth/me for paired devices ("Gerät: <Name>").
app.use('/api', bueroRouter(buero, { port: PORT, appModus: APP_MODUS, origins: ERLAUBTE_ORIGINS, lan }));
app.use('/api', authRouter());
app.use('/api', entitiesRouter(db));
app.use('/api', personalRouter(personalDb, personalBlobs, { lokalGebunden, anfrageEntfernt }));
app.use('/api', blobsRouter(blobs));
// 93-12: the Python harness as a child process (loopback only) — created here so "Nur lokale KI" can
// restart it with the new environment. Never started without the user's switch or click.
const harness = harnessManager({ harnessDir: path.join(__dirname, '..', 'harness') });
app.use('/api', llmRouter(db, {
  onEinstellungen: (neu, alt) => {
    if (neu.nur_lokal !== alt.nur_lokal && harness.status().zustand === 'laeuft') {
      harness.neustart(harnessUmgebung(db, ERLAUBTE_ORIGINS)).catch((e) => console.error('[harness]', e?.message || e));
    }
  },
}));
// 76-01: TypeSafe-Urteile (Wahrscheinlichkeiten, kein Mock)
app.use('/api', typesafeRouter());
app.use('/api', pricesRouter());
app.use('/api', geoRouter());

// --- Status (83-03): what the MCP server's bit_status and scripts ask first ---
// Name and version from package.json, the run mode — no paths, no data.
const PAKET = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
app.get('/api/status', (_req, res) => {
  res.json({ name: PAKET.name, version: PAKET.version, modus: APP_MODUS ? 'app' : 'api', node: process.versions.node });
});

// --- Self-update (92-01): check the latest release, install it from inside the app ---
// 92-04: BIT_KEIN_UPDATECHECK=1 switches the check off entirely (no request to GitHub).
app.use('/api', updateRouter({ root: path.join(__dirname, '..'), port: PORT, appModus: APP_MODUS, version: PAKET.version, deaktiviert: updateCheckAus() }));

// --- Automatic local backup (93-06): data entries only, flushed + read in one tick, retention 7 daily + 4 weekly;
// also trims the self-updater's .update/sicherung-* copies. BIT_SICHERUNG_AUS=1 switches it off. ---
const sicherung = sicherungsDienst({ datenOrdner: datenOrdner(), appOrdner: path.join(__dirname, '..'), dbs: [db, personalDb], version: PAKET.version });

// --- Data folder + AI-assistant (MCP) entry + backup status for Settings (92-07, 93-06): loopback only, POST with
// Origin check; refused for paired LAN devices of the office mode (93-03) ---
app.use('/api', systemRouter({ personalSchluessel: PERSONAL_SCHLUESSEL, root: path.join(__dirname, '..'), port: PORT, lokalGebunden, origins: ERLAUBTE_ORIGINS, anfrageEntfernt, sicherung }));

// --- Local AI + harness (93-12): detection, catalog, hardware, pull, benchmark, harness process ---
app.use('/api', kiLokalRouter({ db, root: path.join(__dirname, '..'), lokalGebunden, origins: ERLAUBTE_ORIGINS, port: PORT, harness }));
// --- Double-click on a .bitproj file (93-10): launcher → staged import → preview in the app; save back ---
app.use('/api', dateiOeffnenRouter({ db, lokalGebunden, port: PORT, origins: ERLAUBTE_ORIGINS, anfrageEntfernt }));

// --- Agent control (104-04): local agents drive the open drawing surface through its command register. The
// random token goes to <data folder>/steuerung.token (0600) — an agent on this machine reads it, a web page cannot.
const STEUERUNG_TOKEN = steuerungsToken();
try {
  schreibeAtomar(datenPfad('steuerung.token'), `${STEUERUNG_TOKEN}
`, { mode: 0o600 });
} catch (e) {
  console.error(`[steuerung] Token-Datei nicht geschrieben: ${e?.message || e}`);
}
app.use('/api', steuerungRouter({ lokalGebunden, anfrageEntfernt, token: STEUERUNG_TOKEN }));

// --- "Programm beenden" (93-11): the hidden server has no console to press Ctrl+C in ---
app.use('/api', programmRouter({
  lokalGebunden, port: PORT, origins: ERLAUBTE_ORIGINS, anfrageEntfernt,
  beenden: () => {
    console.log('[server] Stopped via Settings > System & Info > "Programm beenden".');
    // Write pending debounced changes of both databases before the process ends (db.js also flushes on exit).
    db.flush();
    personalDb.flush();
    process.exit(0);
  },
}));

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
// API_HOST moves the binding; since 93-03 a request from another device still needs the
// office mode and a paired device (bueroWaechter) — API_HOST no longer opens the API.
const HOST = process.env.API_HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  if (APP_MODUS) {
    console.log(`BIT-Atelier running on http://localhost:${PORT} (app + API on one port, bound to ${HOST})`);
  } else {
    console.log(`BIT-Atelier local API running on http://${HOST}:${PORT}`);
  }
  console.log(`Data folder: ${datenOrdner()}`);
  console.log('The API has no login on this computer. Other devices need the office mode and a pairing. Never forward or expose this port.');
  if (!lokalGebunden) {
    console.warn(`[warning] API_HOST=${HOST} — bound beyond loopback; other devices still need office mode + pairing.`);
  }
  // 93-03: office mode stays on across restarts until switched off in the settings — say so loudly.
  if (buero.istAktiv()) {
    lan.starten().then(({ adressen, fehler }) => {
      console.warn(`[buero] Office mode is ON — paired devices in this network may use the app: ${adressen.map((a) => `http://${a}:${PORT}`).join(', ') || '(no address bound)'}`);
      for (const f of fehler) console.warn(`[buero] ${f}`);
    });
  }
  // 93-12: "mit BIT-Atelier starten" (default off) — only on loopback and only when set up.
  if (lokalGebunden && kiEinstellungenLesen(db).harness_autostart && harness.status().eingerichtet) {
    harness.start(harnessUmgebung(db, ERLAUBTE_ORIGINS))
      .then((s) => console.log(`[harness] ${s.zustand === 'laeuft' ? 'running on' : s.zustand} ${s.url}`))
      .catch((e) => console.error('[harness]', e?.message || e));
  }
});
// 93-12: never leave the harness child behind — kill its process tree when this server ends.
process.on('exit', () => harness.beenden());
// Same pattern as db.js: act, then re-raise when nobody else handles the signal (default termination).
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
  process.once(signal, () => {
    harness.beenden();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  });
}
server.on('error', (err) => {
  // EADDRINUSE is the common case (a second start, or the dev stack still running).
  const grund = err.code === 'EADDRINUSE'
    ? `port ${PORT} is already in use — is BIT-Atelier already running? Otherwise set API_PORT.`
    : err.message;
  console.error(`[server] Start failed: ${grund}`);
  process.exit(1);
});
