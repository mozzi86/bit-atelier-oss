#!/usr/bin/env node
// mcp-server.mjs — BIT-Atelier as a Model Context Protocol server (plan 83-03).
//
// Lets any MCP client (Claude Code, Claude Desktop, other agents) read the projects
// and records of a RUNNING local BIT-Atelier — and, only when started with
// `--schreiben` / `--write`, create and change records. It is a thin bridge to the
// local REST API (/api/entities/…); it holds no data and no state of its own.
//
// Transport: stdio, JSON-RPC 2.0, one JSON message per line (newline-delimited).
// stdout carries protocol messages ONLY; every log line goes to stderr.
// No dependency — Node ≥ 22 (global fetch, AbortSignal.timeout).
//
// Usage:  node tools/mcp-server.mjs [--schreiben|--write] [--protokoll-lesen]
//         claude mcp add bit-atelier -- node tools/mcp-server.mjs
// Config: BIT_API_URL (default http://127.0.0.1:3001/api); BIT_DATA_DIR (data folder of the call log, else asked from the app)
//
// In:  JSON-RPC requests on stdin. Out: JSON-RPC responses on stdout.
// Methods: initialize, notifications/initialized, ping, tools/list, tools/call.
// Tools: bit_status, list_entity_types, list_projects, get_project, list_records,
//        get_record, zeichenflaeche_befehle; with write permission also create_record,
//        update_record, zeichenflaeche_ausfuehren (104-04: drive the open drawing surface —
//        token read from <data folder>/steuerung.token, the folder from /api/system/datenordner).
// 106-04: tools for the model in the open viewer (IFC viewer, BIM studio - NOT the Massing studio, which only has the
//        generic zeichenflaeche_* tools) over the same control channel: auswahl_abfragen, bauteil_waehlen, modell_bauteile,
//        vorschlaege_lesen, pruefen, ansicht_bild (no flag); eigenschaft_setzen, transformieren, teilen, vorschlag_verwerfen
//        (write: they only make a PROPOSAL that a person confirms in the app). There is NO tool to confirm: an agent never
//        confirms (decision D-IM-04; the app core refuses it on this channel as well) - the flag --bestaetigen-erlaubt of the
//        first draft of 106-04 was removed again, it could only show a tool that always failed.
//        D-IM-07: the three proposal tools pass an optional `satz_marke` (set by the harness's speech profile, never by the model) on to
//        the app, which then records the origins "sprache" + "agent" (+ "bild"); a marker the app did not issue adds nothing.
//        The Python harness reaches these tools through its MCP client (harness/harness/mcp/bridge.py, since 106-05).
//        docs/KI-ANBINDUNG.md lists them; tests/unit/mcp-server-10604.test.js checks the doc against this file.
// 106-06: ansicht_bild hands out an image only when the app allows it for the open project (GET /llm/bild-freigabe: no NDA marker,
//        the person's one-time consent per project, "Nur lokale KI" and the office switch) - decision D-IM-02.
// 111-01 (K-02, K-03, K-04, K-06, K-18):
//        - initialize answers `instructions` (German): language, read -> preview -> run, an agent never confirms, write permission
//          and the working project (the most recently changed one, [ASSUMED]); the app being down never delays it beyond 1.5 s.
//        - every tools/call (refused, unknown and failed ones too) leaves exactly one line in the call log
//          <data folder>/ki-protokoll/mcp-<day>.jsonl (tools/mcp-aufrufprotokoll.mjs); a log error never changes the answer.
//        - THE CONVENTION (tools/mcp-konvention.mjs): every tool has a kind `art` - lesen | vorschlag |
//          vorschau-dann-ausfuehren (the default for writing: preview first) | sofort (only the listed exceptions, with reason).
//          Write tools take the optional `begruendung` {grund, quelle, aussenwirkung}; it is taken out of the arguments before
//          the tool runs and goes into the log only, never to the app. No tool confirms anything (D-IDEE-03).
//        - aufrufprotokoll_lesen reads the log back, only when started with --protokoll-lesen.
// 111-02 (K-05, K-07, K-11, S-12): safe writing of records.
//        - create_record / update_record answer a PREVIEW by default {vorher, nachher, geaenderte_felder, probleme, naechster_schritt,
//          stand}; only `ausfuehren: true` writes. update sends the `stand` of the preview (PUT ?stand=), so a record changed in
//          between is "nicht übernommen" instead of overwritten.
//        - delete_record never deletes hard: the record moves into the recycle bin (POST /papierkorb/..., collection Papierkorb);
//          papierkorb_lesen lists it, wiederherstellen puts it back with the same id while that id is free.
//        - create_record refuses a likely duplicate (same normalised name/title in the same project) unless doppelt_erlaubt, and
//          an idempotenz_schluessel (stored as field ki_vorgang) makes a repeated call return the first record.
//        - locked entities (API keys, AI settings, HR data), entities only the person writes and the bin itself are refused in
//          the preview already; protected project fields (bild_freigabe, loosening nda) are named as problems and never sent.
//        None of these tools takes over a proposal of the model (D-IDEE-03 / D-IM-04).

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { AufrufProtokoll, protokollLesen, NEU_VERSUCH_MS } from './mcp-aufrufprotokoll.mjs';
import { BEGRUENDUNG_SCHEMA, begruendungAus, konventionPruefen, konventionsSatz } from './mcp-konvention.mjs';

/** Protocol versions this server speaks, newest first (MCP spec revisions). */
const PROTOKOLL_VERSIONEN = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** Longest text answer in characters before records are dropped / text is cut. */
const MAX_ZEICHEN = 50_000;
/** Upper bound and default for list_records / list_projects (records). */
const MAX_LIMIT = 200;
const STANDARD_LIMIT = 50;
/** Timeout of one API request in milliseconds. */
const TIMEOUT_MS = 15_000;

/**
 * Time limit in milliseconds for the side requests of initialize and the call log (working project, person, data folder).
 * [ASSUMED] 1.5 s: the local app answers in a few ms; a client waits for initialize before anything else, so a hanging app
 * must not hold it longer than this.
 */
const NEBEN_TIMEOUT_MS = 1500;

const SCHREIBEN = process.argv.includes('--schreiben') || process.argv.includes('--write');
/** 111-01: the tool aufrufprotokoll_lesen exists only with this flag (the log holds the arguments of every call). */
const PROTOKOLL_LESEN = process.argv.includes('--protokoll-lesen');
const API_URL = String(process.env.BIT_API_URL || 'http://127.0.0.1:3001/api').replace(/\/+$/, '');
const NICHT_ERREICHBAR = 'BIT-Atelier läuft nicht — starten Sie die App (start-windows.cmd / npm start)';

/** Version from the repo's package.json; a copied script without it reports 0.0.0. */
const VERSION = (() => {
  try {
    const datei = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(datei, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** Entity names the REST API accepts here (also keeps the URL path clean). */
const ENTITAET_MUSTER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Record ids: generated base36 ids and seed ids like "co-1". */
const ID_MUSTER = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Filter field names (query keys); `sort` is reserved by the API. */
const FELD_MUSTER = /^[A-Za-z0-9_.-]{1,64}$/;
/** IFC GUIDs (22 characters of the IFC base-64 alphabet) and the GUIDs the BIM studio writes; loose on purpose, the app decides. */
const GUID_MUSTER = /^[A-Za-z0-9_$-]{1,64}$/;
/** Marker of a sentence issued by the app's speech field (D-IM-07, @core/lib/zeigen/satzMarke.js): "sm-" + 32 hex digits. */
const SATZ_MARKE_MUSTER = /^sm-[0-9a-f]{32}$/;
/** A PNG file always starts with these bytes; as base64 they read "iVBORw0KGgo". */
const PNG_BASE64_KOPF = 'iVBORw0KGgo';

/** @param {string} text */
function log(text) {
  process.stderr.write(`[bit-atelier-mcp] ${text}\n`);
}

// --- Errors ---------------------------------------------------------------------

/** Thrown when the API cannot be reached at all (not running, wrong URL). */
class NichtErreichbar extends Error {}
/** Thrown for an HTTP error answer of the API (404, 403, …); `status` = the HTTP status (null when not from an answer). */
class ApiFehler extends Error {
  /** @param {string} meldung @param {number|null} [status] HTTP status */
  constructor(meldung, status = null) {
    super(meldung);
    this.status = status;
  }
}
/** Thrown for invalid tool arguments. */
class EingabeFehler extends Error {}
/** 111-01: thrown when a rule of this server or the app refuses the call (write lock, D-IM-04, NDA, "Nur lokale KI"); logged as "abgelehnt". */
class Abgelehnt extends Error {}

// --- REST API -------------------------------------------------------------------

/**
 * One request against the local API.
 * @param {'GET'|'POST'|'PUT'} methode HTTP method
 * @param {string} pfad path below BIT_API_URL, starting with '/'
 * @param {unknown} [body] JSON body
 * @param {number} [timeoutMs] time limit in milliseconds (default TIMEOUT_MS)
 * @returns {Promise<any>} parsed JSON answer
 */
async function api(methode, pfad, body, timeoutMs = TIMEOUT_MS) {
  return (await apiAntwort(methode, pfad, body, timeoutMs)).json;
}

/**
 * Like api(), but a 404 is null instead of an error (111-02: "is this id free?", "does this record exist?").
 * @param {string} pfad GET path below BIT_API_URL @returns {Promise<any|null>}
 */
async function apiOderNull(pfad) {
  try {
    return await api('GET', pfad);
  } catch (err) {
    if (err instanceof ApiFehler && err.status === 404) return null;
    throw err;
  }
}

/**
 * One request against the local API with the response headers (111-02: X-Bit-Feld-Geschuetzt names dropped project fields).
 * @param {'GET'|'POST'|'PUT'} methode @param {string} pfad @param {unknown} [body] @param {number} [timeoutMs] milliseconds
 * @returns {Promise<{json: any, headers: Headers}>}
 */
async function apiAntwort(methode, pfad, body, timeoutMs = TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(API_URL + pfad, {
      method: methode,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const grund = err?.cause?.code || err?.name || 'Netzwerkfehler';
    throw new NichtErreichbar(`${NICHT_ERREICHBAR}. Erwartet unter ${API_URL} (${grund}).`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const meldung = json?.error || json?.fehler || text.slice(0, 300) || res.statusText;
    throw new ApiFehler(`API ${methode} ${pfad} → HTTP ${res.status}: ${meldung}`, res.status);
  }
  if (json === null && text) {
    throw new ApiFehler(`Antwort von ${API_URL}${pfad} ist kein JSON — läuft unter BIT_API_URL wirklich BIT-Atelier?`);
  }
  return { json, headers: res.headers };
}

// --- Drawing surface control (104-04) ------------------------------------------------

/** Token of the local control channel: BIT_STEUERUNG_TOKEN or <data folder>/steuerung.token. */
async function steuerungsToken() {
  if (process.env.BIT_STEUERUNG_TOKEN) return process.env.BIT_STEUERUNG_TOKEN.trim();
  const { ordner } = await api('GET', '/system/datenordner');
  const datei = path.join(String(ordner || ''), 'steuerung.token');
  try {
    return fs.readFileSync(datei, 'utf8').trim();
  } catch {
    throw new ApiFehler(`Steuerungs-Token nicht gefunden (${datei}) — BIT-Atelier ab Fassung 1.8 starten.`);
  }
}

/**
 * One request of the control channel; answers of the open app are passed through as they are
 * (also ok:false with status "not-run" / "may-have-run" — the model must see the difference).
 * @param {{id: any, method: string, params?: object}} anfrage
 */
async function steuerung(anfrage) {
  const token = await steuerungsToken();
  let res;
  try {
    res = await fetch(`${API_URL}/steuerung`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bit-steuerung': token },
      body: JSON.stringify(anfrage), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new NichtErreichbar(`${NICHT_ERREICHBAR}. Erwartet unter ${API_URL} (${err?.cause?.code || err?.name || 'Netzwerkfehler'}).`);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401) {
    // Two different 401s (113-01): the session guard of the API (server/sitzungsSchutz.js, header X-Bit-Sitzung-Erneuern)
    // and the control token check (server/steuerungRouter.js). Only the second one is about the token.
    const sitzung = res.headers.get('x-bit-sitzung-erneuern') || /sitzung/i.test(String(json?.error || ''));
    if (sitzung) throw new ApiFehler('Der Sitzungsschutz von BIT-Atelier hat den Aufruf abgelehnt (HTTP 401) — diese BIT-Atelier-Fassung hält Werkzeuge ohne Browser für einen Browser; BIT-Atelier aktualisieren (ab Plan 113-01 behoben).');
    throw new ApiFehler('Steuerungs-Token passt nicht — wurde BIT-Atelier neu gestartet? Dann gilt das neue Token automatisch beim nächsten Aufruf.');
  }
  if (!json) throw new ApiFehler(`Steuerung → HTTP ${res.status} ohne JSON`);
  return json;
}

/**
 * Runs one register command of the open viewer through the control channel (106-04). The answer of the app is passed through
 * as it is: ok:true with result, or ok:false with the reason in German ("Keine Auswahl ..."), or status "not-run" (no viewer open).
 * @param {string} befehl  Register command id (hyphenated), e.g. 'auswahl-lesen'.
 * @param {Record<string, any>} [params]
 */
function befehlAnApp(befehl, params = {}) {
  return steuerung({ id: Date.now(), method: 'ausfuehren', params: { befehl, params } });
}

/**
 * Whether the operator set "Nur lokale KI" in the app (Settings > KI): then no image of the model leaves for an MCP client,
 * whose model usually runs outside this computer (decision D-IM-02). An older server without the
 * route answers 404: unknown means allowed, like before (the project check below then refuses: it needs the newer route).
 * @returns {Promise<boolean>}
 */
async function nurLokalAktiv() {
  try {
    const e = await api('GET', '/llm/einstellungen');
    return e?.nur_lokal === true;
  } catch (err) {
    if (err instanceof NichtErreichbar) throw err;
    return false;
  }
}

/**
 * 106-06 (D-IM-02, plan Task 5): may the image of the view of this project go to the MCP client? The client counts as a target OUTSIDE this
 * computer (its model usually is a cloud model; BIT-Atelier cannot see where it sends the image). Asks GET /llm/bild-freigabe, which reads the
 * NDA marker, the person's consent and the switches from the store. Throws ApiFehler with the German sentence when not allowed.
 * @param {unknown} projektId  `projekt_id` the viewer sent with the image (null = no project open).
 */
async function bildFreigabePruefen(projektId) {
  const pid = typeof projektId === 'string' ? projektId.trim() : '';
  if (!pid) throw new Abgelehnt('ansicht_bild ist abgelehnt: der Viewer hat kein geöffnetes Projekt — NDA-Merker und Zustimmung hängen am Projekt, ohne Projekt geht kein Bild heraus.');
  let f;
  try {
    f = await api('GET', `/llm/bild-freigabe?${new URLSearchParams({ projekt_id: pid, ziel: 'extern', anbieter: 'MCP-Client' })}`);
  } catch (err) {
    if (err instanceof NichtErreichbar) throw err;
    throw new Abgelehnt(`ansicht_bild ist abgelehnt: die Freigabe des Projekts ließ sich nicht prüfen (${err?.message || err}) — ohne Prüfung geht kein Bild heraus.`);
  }
  if (f?.ok !== true) {
    const zustimmung = f?.grund === 'zustimmung' ? ' Die Person stimmt in BIT-Atelier im Viewer über den Knopf „mit Bild“ einmal für dieses Projekt zu.' : '';
    throw new Abgelehnt(`ansicht_bild ist abgelehnt: ${f?.text || 'Bild für dieses Projekt nicht freigegeben'}.${zustimmung}`);
  }
}

// --- Argument checks ------------------------------------------------------------

/**
 * 106-10 (D-IM-04): entities only the person in the app writes - the change log (release / reversal notes) and the office's command
 * library. Same list as packages/nova-core/src/lib/verlauf/entitaeten.js NUR_PERSON_SCHREIBT (a unit test compares both; this file
 * imports nothing from the packages). The app server refuses such a write as well (403); here it is refused before it is sent.
 */
const NUR_PERSON_ENTITAETEN = Object.freeze(['AenderungsSchritt', 'Befehlsvorlage']);

/** Refusal of create_record / update_record on those entities. */
const NUR_PERSON_HINWEIS = 'Freigeben, Zurücknehmen und die Befehlsbibliothek sind Handlungen der Person in der App (Seite „Modellfreigabe“) — ein Agent kann sie lesen, aber nicht schreiben.';

/** @param {Record<string, unknown>} args @returns {string} */
function entitaetAus(args) {
  const entity = String(args.entity ?? '');
  if (!ENTITAET_MUSTER.test(entity)) {
    throw new EingabeFehler(`Ungültige Entität ${JSON.stringify(args.entity)} — erwartet z. B. "Project" (list_entity_types zeigt alle).`);
  }
  return entity;
}

/**
 * GUID argument of a viewer tool.
 * @param {Record<string, any>} args @param {boolean} [pflicht] true: a missing GUID is an error; false: '' (= the selected element)
 * @returns {string}
 */
function guidAus(args, pflicht = false) {
  const guid = args.guid == null ? '' : String(args.guid).trim();
  if (!guid) {
    if (pflicht) throw new EingabeFehler('guid fehlt — die GUID kommt aus modell_bauteile oder auswahl_abfragen.');
    return '';
  }
  if (!GUID_MUSTER.test(guid)) throw new EingabeFehler(`Ungültige GUID ${JSON.stringify(args.guid)}.`);
  return guid;
}

/**
 * D-IM-07: the app's marker of the spoken sentence a proposal belongs to. The harness's speech profile sets it (never the model); the app
 * looks it up in its own page - a marker the app did not issue adds nothing, the proposal then stays origin "agent". It cannot confirm
 * anything and never turns a proposal into "hand".
 * @param {Record<string, any>} args @returns {string} the marker, or '' when none was given
 * @throws {EingabeFehler} the form does not fit
 */
function satzMarkeAus(args) {
  if (args.satz_marke == null || args.satz_marke === '') return '';
  const m = String(args.satz_marke).trim();
  if (!SATZ_MARKE_MUSTER.test(m)) throw new EingabeFehler(`Ungültige satz_marke ${JSON.stringify(args.satz_marke)} — sie kommt nur von der Sprachsteuerung der App.`);
  return m;
}

/** Schema of the `satz_marke` argument of the three proposal tools (D-IM-07). */
const SATZ_MARKE_SCHEMA = { type: 'string', description: 'Nur für die Sprachsteuerung der App (setzt der KI-Harness, nicht das Modell): Kennung des gesprochenen Satzes; Herkunft dann „Spracheingabe + Agent“' };

/** @param {Record<string, any>} args @returns {string} id of a proposal */
function vorschlagIdAus(args) {
  const id = String(args.id ?? '').trim();
  if (!ID_MUSTER.test(id)) throw new EingabeFehler(`Ungültige Vorschlags-Id ${JSON.stringify(args.id)} — sie steht in der Antwort von eigenschaft_setzen, transformieren oder teilen.`);
  return id;
}

/** @param {Record<string, any>} args @param {string} feld @returns {number} */
function zahlAus(args, feld) {
  const roh = args[feld];
  // Number('') is 0, Number([]) is 0, Number(true) is 1: only a number or non-empty numeric text counts, nothing is guessed
  const n = typeof roh === 'number' ? roh : typeof roh === 'string' && roh.trim() !== '' ? Number(roh.replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) throw new EingabeFehler(`${feld}: eine Zahl erwartet, bekommen ${JSON.stringify(args[feld])}.`);
  return n;
}

/** @param {Record<string, unknown>} args @returns {string} */
function idAus(args) {
  const id = String(args.id ?? '');
  if (!ID_MUSTER.test(id)) throw new EingabeFehler(`Ungültige id ${JSON.stringify(args.id)}.`);
  return id;
}

/** @param {Record<string, unknown>} args @returns {number} records, 1…MAX_LIMIT */
function limitAus(args) {
  if (args.limit === undefined || args.limit === null) return STANDARD_LIMIT;
  const n = Math.floor(Number(args.limit));
  if (!Number.isFinite(n) || n < 1) throw new EingabeFehler('limit muss eine Zahl ≥ 1 sein.');
  return Math.min(n, MAX_LIMIT);
}

/** @param {Record<string, unknown>} args @returns {Record<string, unknown>} */
function datenAus(args) {
  const data = args.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new EingabeFehler('data muss ein JSON-Objekt mit den Feldern des Datensatzes sein.');
  }
  return /** @type {Record<string, unknown>} */ (data);
}

// --- 111-02: safe writing (preview, duplicates, idempotency, protected paths) -------------

/**
 * S-12: entities the generic CRUD of the app never serves (API keys, the "Nur lokale KI" guard, HR data). Same names as
 * packages/nova-core/server/routes.js gesperrteEntitaet() (LlmConnection, KiEinstellung, PERSONAL_ENTITAETEN of
 * packages/nova-core/src/api/personalEntitaeten.js); a unit test compares them, this file imports nothing from packages/.
 */
const GESPERRTE_ENTITAETEN = Object.freeze(['LlmConnection', 'KiEinstellung', 'Mitarbeiter', 'Arbeitsvertrag', 'Gehaltsaenderung', 'Stelle', 'Bewerbung', 'Personalvorgang', 'Personaldokument', 'Fristquittung', 'Loeschprotokoll', 'Kostensatz', 'Abwesenheit']);

/** The recycle bin collection (packages/nova-core/server/papierkorbRouter.js PAPIERKORB_ENTITY): read-only for the generic tools. */
const PAPIERKORB_ENTITY = 'Papierkorb';

/**
 * S-12: project fields a program never sets (routes.js projektFelderSchuetzen): `bild_freigabe` always (only the person's consent
 * route sets it), `nda` unless it switches the marker ON (a program may make a project stricter, never looser). Compared by a test.
 */
const GESCHUETZTE_PROJEKTFELDER = Object.freeze(['bild_freigabe', 'nda']);

/** Fields the app sets itself; a write never sends them (an `id` in a create would even be taken over unchecked, B-111-02-01). */
const VERWALTUNGSFELDER = Object.freeze(['id', 'created_date', 'updated_date']);

/** Field of a created record that carries the idempotency key (additive, optional). */
const IDEMPOTENZ_FELD = 'ki_vorgang';

/** Name fields of the duplicate check, in this order: the first one filled is the record's name. */
const NAMENSFELDER = Object.freeze(['name', 'title', 'titel', 'bezeichnung']);

/**
 * Most records the duplicate check reads; beyond that it says "nicht geprüft" instead of guessing.
 * [ASSUMED] 2,000: a project rarely holds more records of one kind; the check reads them all at once over local HTTP.
 */
const MAX_DUBLETTEN_SUCHE = 2000;

/**
 * Fields read as a date for the preview's plausibility hint (only a hint, the write is not refused).
 * [ASSUMED] the naming of the store: *_date, *datum, *_am.
 */
const DATUMSFELD = /(?:_date|datum|_am)$/i;

/** Longest reason of delete_record in characters (the bin keeps the same limit). */
const MAX_LOESCHGRUND_ZEICHEN = 500;

/** Refusal of a write on a locked entity. */
const GESPERRT_HINWEIS = 'ist gesperrt: API-Schlüssel, KI-Einstellungen und Personaldaten sind über diese Schnittstelle weder lesbar noch schreibbar — sie haben eigene, geschützte Seiten in der App.';

/** Text of a stand that no longer holds (HTTP 409 of the app, or the stored record is newer than the preview). */
const INZWISCHEN_GEAENDERT = 'nicht übernommen: inzwischen geändert — neue Vorschau holen (dasselbe Werkzeug erneut ohne ausfuehren aufrufen)';

/** Schema of the switch of the convention: without it a tool only answers the preview. */
const AUSFUEHREN_SCHEMA = { type: 'boolean', description: 'false (Vorgabe): nur Vorschau, nichts wird geschrieben. true: ausführen — erst nach der Vorschau, mit deren stand' };

/** Schema of the `stand` argument: the updated_date the preview showed. */
const STAND_SCHEMA = { type: 'string', description: 'stand aus der Vorschau (updated_date des Datensatzes); beim Ausführen Pflicht, wenn der Datensatz einen hat' };

/**
 * The entity of a write tool (S-12): never a locked entity, never one the person alone writes, never the recycle bin - in any
 * spelling (review 106-10). Refused before anything is sent, also in the preview.
 * @param {Record<string, any>} args @returns {string}
 */
function schreibEntitaetAus(args) {
  const entity = entitaetAus(args);
  const klein = entity.toLowerCase();
  if (NUR_PERSON_ENTITAETEN.some((e) => e.toLowerCase() === klein)) throw new Abgelehnt(NUR_PERSON_HINWEIS);
  if (GESPERRTE_ENTITAETEN.some((e) => e.toLowerCase() === klein)) throw new Abgelehnt(`${entity} ${GESPERRT_HINWEIS}`);
  if (klein === PAPIERKORB_ENTITY.toLowerCase()) throw new Abgelehnt('Der Papierkorb ist nur lesbar — Datensätze kommen über delete_record hinein und über wiederherstellen zurück.');
  return entity;
}

/**
 * K-11: the comparison form of a name: lower case, umlauts and ß spelt out, every run of separators and spaces one space, trimmed.
 * [ASSUMED] separators = everything that is neither a letter nor a digit; accents other than the German umlauts stay as they are.
 * @param {unknown} text @returns {string} '' for an empty or missing name
 */
function nameSchluessel(text) {
  return String(text ?? '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** @param {Record<string, any>} rec @returns {{feld: string, schluessel: string}|null} the first filled name field of a record */
function namensSchluesselVon(rec) {
  for (const feld of NAMENSFELDER) {
    const s = typeof rec?.[feld] === 'string' ? nameSchluessel(rec[feld]) : '';
    if (s) return { feld, schluessel: s };
  }
  return null;
}

/** @param {unknown} a @param {unknown} b @returns {boolean} same value as stored JSON */
function gleich(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What of `data` a write may send, and what it keeps back with the reason (S-12): fields the app sets itself, the reserved
 * idempotency field, and the protected project fields. The app would drop the project fields as well (header X-Bit-Feld-Geschuetzt);
 * here they never leave.
 * @param {string} entity @param {Record<string, any>} data
 * @returns {{senden: Record<string, any>, probleme: Array<{art: string, feld: string, text: string}>}}
 */
function datenBereinigen(entity, data) {
  /** @type {Record<string, any>} */
  const senden = {};
  const probleme = [];
  for (const [feld, wert] of Object.entries(data)) {
    if (VERWALTUNGSFELDER.includes(feld)) {
      probleme.push({ art: 'nicht_gesendet', feld, text: `${feld} vergibt die App selbst — wird nicht gesendet.` });
    } else if (feld === IDEMPOTENZ_FELD) {
      probleme.push({ art: 'nicht_gesendet', feld, text: `${IDEMPOTENZ_FELD} ist reserviert — dafür idempotenz_schluessel angeben.` });
    } else if (entity === 'Project' && feld === GESCHUETZTE_PROJEKTFELDER[0]) {
      probleme.push({ art: 'geschuetztes_feld', feld, text: 'bild_freigabe (Zustimmung zu Bildern) gibt nur die Person in der App — wird nicht gesendet.' });
    } else if (entity === 'Project' && feld === GESCHUETZTE_PROJEKTFELDER[1] && wert !== true) {
      probleme.push({ art: 'geschuetztes_feld', feld, text: 'Den NDA-Merker lockert nur die Person in der App (ein Programm darf ihn nur einschalten) — wird nicht gesendet.' });
    } else {
      senden[feld] = wert;
    }
  }
  return { senden, probleme };
}

/**
 * Plausibility hints for date fields: a filled text that no date reader understands. Only a hint (the store keeps text as it is).
 * @param {Record<string, any>} senden @returns {Array<{art: string, feld: string, text: string}>}
 */
function datumsProbleme(senden) {
  return Object.entries(senden)
    .filter(([feld, wert]) => DATUMSFELD.test(feld) && typeof wert === 'string' && wert.trim() !== '' && !Number.isFinite(Date.parse(wert)))
    .map(([feld, wert]) => ({ art: 'datum', feld, text: `${feld}: „${String(wert).slice(0, 40)}“ ist kein lesbares Datum — erwartet z. B. 2026-11-08.` }));
}

/**
 * The idempotency key of a create, or '' when none was given.
 * @param {Record<string, any>} args @returns {string}
 */
function idempotenzAus(args) {
  if (args.idempotenz_schluessel == null || args.idempotenz_schluessel === '') return '';
  const k = String(args.idempotenz_schluessel).trim();
  if (!ID_MUSTER.test(k)) throw new EingabeFehler(`Ungültiger idempotenz_schluessel ${JSON.stringify(args.idempotenz_schluessel)} — Buchstaben, Ziffern und _ . : - , höchstens 128 Zeichen.`);
  return k;
}

/**
 * The `stand` of a preview (the record's updated_date), or '' when none was given.
 * @param {Record<string, any>} args @returns {string}
 */
function standAus(args) {
  if (args.stand == null || args.stand === '') return '';
  const st = String(args.stand).trim();
  if (!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z?$/.test(st)) throw new EingabeFehler(`Ungültiger stand ${JSON.stringify(args.stand)} — er steht in der Vorschau (Feld stand).`);
  return st;
}

/**
 * Whether the stand of the preview still holds for the stored record: equal updated_date. A record without updated_date cannot be
 * checked (old seed records) - then a missing stand is fine. A stand is required whenever the record has one.
 * @param {Record<string, any>} gespeichert @param {string} stand @returns {'ok'|'fehlt'|'veraltet'}
 */
function standPruefen(gespeichert, stand) {
  const aktuell = typeof gespeichert?.updated_date === 'string' ? gespeichert.updated_date : '';
  if (!aktuell) return 'ok';
  if (!stand) return 'fehlt';
  return stand === aktuell ? 'ok' : 'veraltet';
}

/** @param {string} werkzeug @returns {string} the German sentence for a write without stand */
function standFehltText(werkzeug) {
  return `stand fehlt — erst ${werkzeug} ohne ausfuehren aufrufen (Vorschau); deren naechster_schritt enthält den stand.`;
}

/**
 * K-11: records of the same entity (and the same project, when the new one names one) whose name has the same comparison form.
 * @param {string} entity @param {Record<string, any>} senden
 * @returns {Promise<{treffer: Array<{id: string, name: string}>, problem: {art: string, text: string}|null}>}
 */
async function dublettenSuchen(entity, senden) {
  const neu = namensSchluesselVon(senden);
  if (!neu) return { treffer: [], problem: null };
  const pid = senden.project_id == null || senden.project_id === '' ? '' : String(senden.project_id);
  const liste = await api('GET', `/entities/${entity}${pid ? `?${new URLSearchParams({ project_id: pid })}` : ''}`);
  const alle = Array.isArray(liste) ? liste : [];
  if (alle.length > MAX_DUBLETTEN_SUCHE) {
    return { treffer: [], problem: { art: 'nicht_geprueft', text: `Doppelte Namen nicht geprüft: ${alle.length} Datensätze (Grenze ${MAX_DUBLETTEN_SUCHE}).` } };
  }
  const treffer = [];
  for (const r of alle) {
    const k = namensSchluesselVon(r);
    if (k && k.schluessel === neu.schluessel) treffer.push({ id: String(r.id), name: String(r[k.feld]) });
  }
  return { treffer, problem: null };
}

/**
 * K-11: the record a create with this key already made (field ki_vorgang), or null. Survives restarts: the key is in the store.
 * The key counts per project (a key used in project A never returns a record of project B), and the match is checked here
 * again (review 111-02): the server's query filter compares String(record[k]) — a key "undefined" matched EVERY record without
 * the field, so create_record answered "schon angelegt" with a foreign record and wrote nothing.
 * @param {string} entity @param {string} schluessel @param {unknown} [projektId] project_id of the new record, if any
 * @returns {Promise<Record<string, any>|null>}
 */
async function schonAngelegt(entity, schluessel, projektId) {
  if (!schluessel) return null;
  const p = projektId == null || projektId === '' ? null : String(projektId);
  const filter = { [IDEMPOTENZ_FELD]: schluessel, ...(p ? { project_id: p } : {}) };
  const liste = await api('GET', `/entities/${entity}?${new URLSearchParams(filter)}`);
  if (!Array.isArray(liste)) return null;
  return liste.find((/** @type {any} */ r) => typeof r?.[IDEMPOTENZ_FELD] === 'string' && r[IDEMPOTENZ_FELD] === schluessel
    && (p ? String(r.project_id ?? '') === p : r.project_id == null || r.project_id === '')) ?? null;
}

/**
 * Whether the collection holds no record yet (a typo makes a new collection - worth a hint in the preview).
 * @param {string} entity @returns {Promise<boolean>}
 */
async function neueSammlung(entity) {
  try {
    const u = await api('GET', '/entities');
    const e = Array.isArray(u?.entitaeten) ? u.entitaeten.find((/** @type {any} */ x) => x?.name === entity) : null;
    return !e || !(Number(e.anzahl) > 0);
  } catch (err) {
    if (err instanceof NichtErreichbar) throw err;
    return false; // an older app without the overview: no hint rather than a wrong one
  }
}

/** Creates run one after the other in this process, so two calls with the same key cannot both miss the first record. */
let anlegenKette = /** @type {Promise<unknown>} */ (Promise.resolve());

/**
 * Runs `fn` after every create started before it (in this process).
 * @template T
 * @param {() => Promise<T>} fn @returns {Promise<T>}
 */
function nacheinander(fn) {
  const lauf = anlegenKette.then(fn, fn);
  anlegenKette = lauf.then(() => undefined, () => undefined);
  return lauf;
}

/** @param {Headers} headers @returns {string[]} project fields the app did not take (X-Bit-Feld-Geschuetzt) */
function nichtGesetztAus(headers) {
  const kopf = headers?.get?.('x-bit-feld-geschuetzt');
  return kopf ? String(kopf).split(',').map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * K-05 / K-11: create_record - a preview by default; with ausfuehren the write, after the idempotency and duplicate checks.
 * @param {Record<string, any>} args @returns {Promise<Record<string, any>>}
 */
async function datensatzAnlegen(args) {
  const entity = schreibEntitaetAus(args);
  const data = datenAus(args);
  const schluessel = idempotenzAus(args);
  const doppeltErlaubt = args.doppelt_erlaubt === true;
  const { senden, probleme } = datenBereinigen(entity, data);
  if (schluessel) senden[IDEMPOTENZ_FELD] = schluessel;
  const folgeArgs = { entity, data: Object.fromEntries(Object.entries(senden).filter(([k]) => k !== IDEMPOTENZ_FELD)), ausfuehren: true,
    ...(schluessel ? { idempotenz_schluessel: schluessel } : {}), ...(doppeltErlaubt ? { doppelt_erlaubt: true } : {}) };

  // an empty or unknown collection holds neither a duplicate nor an earlier record of this key - and reading it would create it in
  // the store (db.js collection()), which a preview must not do
  const leer = await neueSammlung(entity);
  if (args.ausfuehren !== true) {
    const alle = [...probleme, ...datumsProbleme(senden)];
    if (leer) alle.push({ art: 'neue_sammlung', text: `${entity} hat noch keinen Datensatz — Schreibweise prüfen (list_entity_types); sonst entsteht eine neue Sammlung.` });
    const erster = leer ? null : await schonAngelegt(entity, schluessel, senden.project_id);
    if (erster) {
      alle.push({ art: 'schon_angelegt', id: String(erster.id), text: `Mit diesem idempotenz_schluessel ist schon ${entity} ${erster.id} angelegt — ausführen liefert ihn zurück, ein zweiter entsteht nicht.` });
    }
    const d = leer ? { treffer: [], problem: null } : await dublettenSuchen(entity, senden);
    if (d.problem) alle.push(d.problem);
    const dublette = d.treffer.length > 0 && !doppeltErlaubt;
    if (dublette) {
      alle.push({ art: 'dublette', ids: d.treffer.map((t) => t.id), text: `Mögliche Dublette von ${d.treffer.map((t) => `${t.id} („${t.name}“)`).join(', ')} — ausführen legt nichts an, außer mit doppelt_erlaubt: true.` });
    }
    return {
      vorschau: true, aktion: 'anlegen', entity, vorher: null, nachher: senden, geaenderte_felder: Object.keys(senden), probleme: alle, stand: null,
      naechster_schritt: {
        werkzeug: 'create_record', argumente: dublette ? { ...folgeArgs, doppelt_erlaubt: true } : folgeArgs,
        hinweis: dublette
          ? 'Nur wenn die Person bestätigt, dass es wirklich ein zweiter Datensatz ist: mit doppelt_erlaubt: true ausführen.'
          : 'Der Person zeigen, was angelegt wird; dann mit ausfuehren: true aufrufen.',
      },
    };
  }

  return nacheinander(async () => {
    const leerJetzt = leer && await neueSammlung(entity); // asked again inside the queue: an earlier create may have filled it
    const erster = leerJetzt ? null : await schonAngelegt(entity, schluessel, senden.project_id);
    if (erster) return { uebernommen: true, status: 'schon angelegt', entity, datensatz: erster, hinweis: 'Mit diesem idempotenz_schluessel war der Datensatz schon angelegt — kein zweiter.' };
    if (!doppeltErlaubt && !leerJetzt) {
      const d = await dublettenSuchen(entity, senden);
      if (d.treffer.length) {
        return {
          uebernommen: false, entity, grund: `nicht übernommen: mögliche Dublette von ${d.treffer[0].id}`, dubletten: d.treffer,
          naechster_schritt: { werkzeug: 'create_record', argumente: { ...folgeArgs, doppelt_erlaubt: true }, hinweis: 'Nur wenn die Person bestätigt, dass es wirklich ein zweiter Datensatz ist.' },
        };
      }
    }
    const { json, headers } = await apiAntwort('POST', `/entities/${entity}`, senden);
    const nichtGesetzt = [...new Set([...probleme.map((p) => p.feld), ...nichtGesetztAus(headers)])];
    return { uebernommen: true, status: 'angelegt', entity, datensatz: json, ...(nichtGesetzt.length ? { nicht_gesetzt: nichtGesetzt } : {}) };
  });
}

/**
 * K-05: update_record - a preview (stored record before / after, changed fields, problems, stand) by default; with ausfuehren the
 * write, only while the stand of the preview still holds (checked here and by the app: PUT ?stand=, 409 when newer).
 * @param {Record<string, any>} args @returns {Promise<Record<string, any>>}
 */
async function datensatzAendern(args) {
  const entity = schreibEntitaetAus(args);
  const id = idAus(args);
  const data = datenAus(args);
  const pfad = `/entities/${entity}/${encodeURIComponent(id)}`;
  const vorher = await apiOderNull(pfad);
  if (!vorher) throw new ApiFehler(`${entity} ${id} nicht gefunden — die id aus list_records oder get_record nehmen.`, 404);
  const { senden, probleme } = datenBereinigen(entity, data);
  const geaendert = Object.keys(senden).filter((k) => !gleich(vorher[k], senden[k]));
  const stand = typeof vorher.updated_date === 'string' ? vorher.updated_date : null;

  if (args.ausfuehren !== true) {
    const alle = [...probleme, ...datumsProbleme(senden)];
    if (!geaendert.length) alle.push({ art: 'keine_aenderung', text: 'Alle Werte sind schon so gespeichert — nichts zu ändern.' });
    if (!stand) alle.push({ art: 'ohne_stand', text: 'Der Datensatz hat kein updated_date — eine Änderung dazwischen lässt sich nicht erkennen.' });
    return {
      vorschau: true, aktion: 'aendern', entity, id, vorher, nachher: { ...vorher, ...senden }, geaenderte_felder: geaendert, probleme: alle, stand,
      naechster_schritt: geaendert.length
        ? { werkzeug: 'update_record', argumente: { entity, id, data: Object.fromEntries(geaendert.map((k) => [k, senden[k]])), ausfuehren: true, ...(stand ? { stand } : {}) },
          hinweis: 'Der Person vorher/nachher zeigen; dann mit ausfuehren: true und diesem stand aufrufen.' }
        : null,
    };
  }

  const st = standAus(args);
  const pruefung = standPruefen(vorher, st);
  if (pruefung === 'fehlt') throw new EingabeFehler(standFehltText('update_record'));
  if (pruefung === 'veraltet') return { uebernommen: false, entity, id, grund: INZWISCHEN_GEAENDERT, stand_jetzt: stand };
  if (!geaendert.length) return { uebernommen: false, entity, id, grund: 'nicht übernommen: keine Änderung — alle Werte sind schon so gespeichert.' };
  const patch = Object.fromEntries(geaendert.map((k) => [k, senden[k]]));
  try {
    const { json, headers } = await apiAntwort('PUT', `${pfad}${st ? `?${new URLSearchParams({ stand: st })}` : ''}`, patch);
    const nichtGesetzt = [...new Set([...probleme.map((p) => p.feld), ...nichtGesetztAus(headers)])];
    return { uebernommen: true, status: 'geändert', entity, geaenderte_felder: geaendert, datensatz: json, ...(nichtGesetzt.length ? { nicht_gesetzt: nichtGesetzt } : {}) };
  } catch (err) {
    // the app's own check of ?stand= (routes.js standVeraltet): somebody wrote between our read and our write
    if (err instanceof ApiFehler && err.status === 409) return { uebernommen: false, entity, id, grund: INZWISCHEN_GEAENDERT };
    throw err;
  }
}

/**
 * K-07: delete_record - the preview shows the record and that it goes into the recycle bin; with ausfuehren it moves there
 * (POST /papierkorb/:entity/:id, origin "mcp"). Never a hard delete. Projects are refused: the app guards their deletion
 * (retention duties of time records, contracts, invoices) and offers archiving instead.
 * @param {Record<string, any>} args @returns {Promise<Record<string, any>>}
 */
async function datensatzLoeschen(args) {
  const entity = schreibEntitaetAus(args);
  // [ASSUMED] an agent never removes a whole project: the app's deletion guard (src/lib/projektLoeschschutz.js) runs in the page only
  if (entity === 'Project') throw new Abgelehnt('Projekte löscht oder archiviert nur die Person in der App (Löschschutz wegen Aufbewahrungspflichten) — ein Agent nicht.');
  const id = idAus(args);
  const grund = args.grund == null ? '' : String(args.grund).trim().slice(0, MAX_LOESCHGRUND_ZEICHEN);
  const vorher = await apiOderNull(`/entities/${entity}/${encodeURIComponent(id)}`);
  if (!vorher) throw new ApiFehler(`${entity} ${id} nicht gefunden — schon gelöscht? papierkorb_lesen zeigt den Papierkorb.`, 404);
  const stand = typeof vorher.updated_date === 'string' ? vorher.updated_date : null;
  if (args.ausfuehren !== true) {
    return {
      vorschau: true, aktion: 'in den Papierkorb', entity, id, vorher, nachher: null, geaenderte_felder: [], stand,
      probleme: stand ? [] : [{ art: 'ohne_stand', text: 'Der Datensatz hat kein updated_date — eine Änderung dazwischen lässt sich nicht erkennen.' }],
      hinweis: 'Der Datensatz wandert in den Papierkorb (nicht endgültig gelöscht); wiederherstellen holt ihn mit derselben id zurück.',
      naechster_schritt: { werkzeug: 'delete_record', argumente: { entity, id, ausfuehren: true, ...(stand ? { stand } : {}), ...(grund ? { grund } : {}) },
        hinweis: 'Der Person zeigen, welcher Datensatz in den Papierkorb geht; dann mit ausfuehren: true aufrufen.' },
    };
  }
  const pruefung = standPruefen(vorher, standAus(args));
  if (pruefung === 'fehlt') throw new EingabeFehler(standFehltText('delete_record'));
  if (pruefung === 'veraltet') return { uebernommen: false, entity, id, grund: INZWISCHEN_GEAENDERT, stand_jetzt: stand };
  // the server checks the stand again (review 111-02): a stale delete is refused there too, not only here
  const gesehen = standAus(args); // the stand the caller saw in the preview, not the one read just now
  const standQuery = gesehen ? `?${new URLSearchParams({ stand: gesehen })}` : '';
  const eintrag = await api('POST', `/papierkorb/${entity}/${encodeURIComponent(id)}${standQuery}`, { herkunft: 'mcp', ...(grund ? { grund } : {}) });
  return { uebernommen: true, status: 'im Papierkorb', entity, id, papierkorb_id: eintrag?.id ?? null, geloescht_am: eintrag?.geloescht_am ?? null,
    hinweis: `Zurückholen: wiederherstellen mit id ${eintrag?.id ?? '?'}.` };
}

/**
 * K-07: wiederherstellen - the preview shows the record from the bin and whether its id is free; with ausfuehren it comes back
 * with the same id (POST /papierkorb/:id/wiederherstellen). An occupied id is "nicht übernommen" with the reason.
 * @param {Record<string, any>} args @returns {Promise<Record<string, any>>}
 */
async function datensatzWiederherstellen(args) {
  const pid = idAus(args);
  // read through the bin route, not the generic CRUD: GET /entities/Papierkorb/:id would create an empty bin collection in a
  // store that never deleted anything (db.js collection()), review 111-02
  const liste = await api('GET', '/papierkorb');
  const eintrag = Array.isArray(liste) ? liste.find((/** @type {any} */ e) => String(e?.id) === pid) ?? null : null;
  if (!eintrag) throw new ApiFehler(`Papierkorb-Eintrag ${pid} nicht gefunden — papierkorb_lesen zeigt die ids (alte Einträge werden aufgeräumt).`, 404);
  const entity = schreibEntitaetAus({ entity: eintrag.entity });
  const recordId = String(eintrag.record_id ?? '');
  if (args.ausfuehren !== true) {
    const belegt = ID_MUSTER.test(recordId) ? await apiOderNull(`/entities/${entity}/${encodeURIComponent(recordId)}`) : null;
    return {
      vorschau: true, aktion: 'wiederherstellen', entity, id: recordId, vorher: belegt, nachher: eintrag.datensatz ?? null,
      geaenderte_felder: Object.keys(eintrag.datensatz ?? {}), stand: null, geloescht_am: eintrag.geloescht_am ?? null, grund: eintrag.grund ?? null,
      probleme: belegt ? [{ art: 'id_belegt', id: recordId, text: `Die id ${recordId} ist in ${entity} wieder belegt — wiederherstellen überschreibt nichts und wird abgelehnt.` }] : [],
      naechster_schritt: belegt ? null : { werkzeug: 'wiederherstellen', argumente: { id: pid, ausfuehren: true }, hinweis: 'Der Person zeigen, was zurückkommt; dann mit ausfuehren: true aufrufen.' },
    };
  }
  try {
    const r = await api('POST', `/papierkorb/${encodeURIComponent(pid)}/wiederherstellen`, {});
    return { uebernommen: true, status: 'wiederhergestellt', entity, datensatz: r?.datensatz ?? null };
  } catch (err) {
    if (err instanceof ApiFehler && err.status === 409) {
      return { uebernommen: false, entity, id: recordId, grund: err.message.replace(/^API POST \S+ → HTTP 409: /, '') };
    }
    throw err;
  }
}

/**
 * Query string for list_records: filter fields (exact match, the API compares
 * as strings) and an optional sort ("-updated_date" = descending).
 * @param {Record<string, unknown>} args
 * @returns {string} '' or '?…'
 */
function abfrageAus(args) {
  const params = new URLSearchParams();
  if (args.filter !== undefined && args.filter !== null) {
    if (typeof args.filter !== 'object' || Array.isArray(args.filter)) {
      throw new EingabeFehler('filter muss ein Objekt { feld: wert } sein.');
    }
    for (const [feld, wert] of Object.entries(args.filter)) {
      if (!FELD_MUSTER.test(feld) || feld === 'sort') throw new EingabeFehler(`Ungültiges Filterfeld ${JSON.stringify(feld)}.`);
      if (wert !== null && typeof wert === 'object') throw new EingabeFehler(`Filterwert für ${feld} muss Text, Zahl oder Wahrheitswert sein.`);
      params.set(feld, String(wert));
    }
  }
  if (args.sort !== undefined && args.sort !== null && args.sort !== '') {
    const sort = String(args.sort);
    if (!/^-?[A-Za-z0-9_.]{1,64}$/.test(sort)) throw new EingabeFehler(`Ungültige Sortierung ${JSON.stringify(sort)}.`);
    params.set('sort', sort);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

// --- Answers --------------------------------------------------------------------

/**
 * Tool result as MCP text content. Long lists drop records from the end until the
 * JSON fits MAX_ZEICHEN (stays valid JSON); anything else is cut with a note.
 * @param {any} wert JSON-serialisable value
 * @returns {{ content: Array<{ type: 'text', text: string }> }}
 */
function ergebnis(wert) {
  if (istSteuerAntwort(wert)) return antwortErgebnis(wert);
  let text = JSON.stringify(wert, null, 2);
  if (text.length > MAX_ZEICHEN && wert && Array.isArray(wert.datensaetze)) {
    const alle = wert.datensaetze;
    let n = alle.length;
    while (n > 1 && text.length > MAX_ZEICHEN) {
      n = Math.max(1, Math.floor(n * 0.75));
      text = JSON.stringify({
        ...wert,
        datensaetze: alle.slice(0, n),
        anzahl: n,
        hinweis: `Antwort gekürzt: ${n} von ${alle.length} Datensätzen gezeigt (Grenze ${MAX_ZEICHEN} Zeichen). Mit limit, filter oder get_record eingrenzen.`,
      }, null, 2);
    }
  }
  if (text.length > MAX_ZEICHEN) {
    text = `${text.slice(0, MAX_ZEICHEN)}\n… gekürzt: ${text.length} Zeichen, gezeigt ${MAX_ZEICHEN}. Mit limit, filter oder get_record eingrenzen.`;
  }
  return { content: [{ type: 'text', text }] };
}

/** @param {any} w @returns {boolean} an answer of the control channel: {ok: boolean, result?: ...} */
function istSteuerAntwort(w) {
  return !!w && typeof w === 'object' && typeof w.ok === 'boolean' && 'result' in w;
}

/**
 * Answer of the open viewer (selection, model, proposals) as MCP text: compact JSON (indentation only inflates up to 200
 * elements), and when it is still over MAX_ZEICHEN the longest list inside `result` loses entries from the end - valid JSON
 * with a note, never a cut in the middle of a GUID list.
 * @param {{ok: boolean, result: any, [k: string]: any}} wert
 * @returns {{ content: Array<{ type: 'text', text: string }> }}
 */
function antwortErgebnis(wert) {
  let text = JSON.stringify(wert);
  const r = wert.result;
  /** @type {string|null} field of `result` that holds the longest list; '' = result itself is the list */
  let feld = null;
  if (Array.isArray(r)) feld = '';
  else if (r && typeof r === 'object') {
    let laengste = 0;
    for (const [k, v] of Object.entries(r)) if (Array.isArray(v) && v.length > laengste) { laengste = v.length; feld = k; }
  }
  if (text.length > MAX_ZEICHEN && feld !== null) {
    const alle = feld === '' ? r : r[feld];
    let n = alle.length;
    while (n > 1 && text.length > MAX_ZEICHEN) {
      n = Math.max(1, Math.floor(n * 0.75));
      const hinweis = `Antwort gekürzt: ${n} von ${alle.length} Einträgen${feld ? ` in "${feld}"` : ''} gezeigt (Grenze ${MAX_ZEICHEN} Zeichen). Mit klasse (modell_bauteile) oder guid eingrenzen.`;
      const rest = alle.slice(0, n);
      text = JSON.stringify(feld === '' ? { ...wert, result: rest, hinweis } : { ...wert, result: { ...r, [feld]: rest }, hinweis });
    }
  }
  if (text.length > MAX_ZEICHEN) text = `${text.slice(0, MAX_ZEICHEN)}\n… gekürzt: ${text.length} Zeichen, gezeigt ${MAX_ZEICHEN}. Mit klasse oder guid eingrenzen.`;
  return { content: [{ type: 'text', text }] };
}

/** A tool answer that is already a finished MCP result (e.g. with an image block) and must not pass through ergebnis(). */
class RohErgebnis {
  /** @param {{content: Array<Record<string, any>>}} wert */
  constructor(wert) { this.wert = wert; }
}

/** @param {string} text @returns {{ content: Array<{type:'text', text:string}>, isError: true }} */
function fehlerErgebnis(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Short project row for list_projects — the full record comes from get_project.
 * @param {Record<string, any>} p a Project record
 */
function projektKurz(p) {
  const ort = p?.location?.city || p?.location?.address || p?.city || undefined;
  const kurz = {
    id: p.id, name: p.name, client: p.client, status: p.status, ort,
    hoai_phase: p.hoai_phase, created_date: p.created_date, updated_date: p.updated_date,
  };
  return Object.fromEntries(Object.entries(kurz).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

// --- Tools ----------------------------------------------------------------------

const NUR_LESEN = { readOnlyHint: true, openWorldHint: false };
/** Tools that only make a proposal: nothing in the model changes until a person confirms in the app. */
const VORSCHLAG = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Refusal text for confirming over MCP (decision D-IM-04): the person confirms in the app, there is no agent road. */
const BESTAETIGEN_ABGELEHNT = 'Ein Agent bestätigt Änderungen nicht selbst (Entscheidung D-IM-04): die Person übernimmt den Vorschlag in der App (Übernehmen) oder per Befehlszeile. Ein Werkzeug zum Bestätigen gibt es für Agenten nicht.';

/**
 * All tools. `art` is THE convention (tools/mcp-konvention.mjs, stated once here and in the instructions, not per tool):
 * lesen | vorschlag | vorschau-dann-ausfuehren | sofort. `schreibt`: visible and callable only with --schreiben (then the
 * server adds the optional `begruendung` to the schema). `protokollLesen`: only with --protokoll-lesen.
 * @type {Array<{ name: string, title: string, description: string, inputSchema: {type: string, properties?: Record<string, any>, required?: string[]}, annotations: object,
 *   art: 'lesen'|'vorschlag'|'vorschau-dann-ausfuehren'|'sofort', schreibt?: boolean, protokollLesen?: boolean, ausfuehren: (args: Record<string, any>) => Promise<any> }>}
 */
const WERKZEUGE = [
  {
    name: 'bit_status',
    art: 'lesen',
    title: 'BIT-Atelier status',
    description: 'Prüft, ob BIT-Atelier läuft, und nennt Version und Schreibrecht. / Checks whether BIT-Atelier is running; reports version and write permission.',
    inputSchema: { type: 'object', properties: {} },
    annotations: NUR_LESEN,
    async ausfuehren() {
      let status;
      try {
        status = await api('GET', '/status');
      } catch (err) {
        if (!(err instanceof ApiFehler)) throw err;
        await api('GET', '/auth/me'); // older server without /status: reachable, version unknown
        status = { version: 'unbekannt (Server vor 83-03)' };
      }
      return { erreichbar: true, api_url: API_URL, app: status, mcp_server: { version: VERSION, schreiben: SCHREIBEN } };
    },
  },
  {
    name: 'list_entity_types',
    art: 'lesen',
    title: 'List entity types',
    description: 'Listet die Datensatz-Arten (Entitäten) mit Anzahl, z. B. Project, Contact, ChangeOrder. / Lists the record types (entities) in the database with counts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: NUR_LESEN,
    async ausfuehren() {
      const uebersicht = await api('GET', '/entities');
      return { ...uebersicht, hinweis: 'Gesperrte Entitäten (API-Schlüssel, Personaldaten) sind über diese Schnittstelle nicht lesbar.' };
    },
  },
  {
    name: 'list_projects',
    art: 'lesen',
    title: 'List projects',
    description: 'Listet die Projekte (Kurzform: id, Name, Bauherr, Status, Ort), neueste zuerst. / Lists projects (short form), most recently changed first.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Höchstzahl, Vorgabe ${STANDARD_LIMIT}` } },
    },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      const limit = limitAus(args);
      const alle = await api('GET', '/entities/Project?sort=-updated_date');
      const liste = Array.isArray(alle) ? alle : [];
      return { gesamt: liste.length, anzahl: Math.min(limit, liste.length), datensaetze: liste.slice(0, limit).map(projektKurz) };
    },
  },
  {
    name: 'get_project',
    art: 'lesen',
    title: 'Get project',
    description: 'Liest ein Projekt vollständig. / Reads one project with all fields.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Projekt-id (aus list_projects)' } }, required: ['id'] },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      return api('GET', `/entities/Project/${encodeURIComponent(idAus(args))}`);
    },
  },
  {
    name: 'list_records',
    art: 'lesen',
    title: 'List records',
    description: `Listet Datensätze einer Entität, optional gefiltert (exakter Feldvergleich) und sortiert; höchstens ${MAX_LIMIT}. / Lists records of one entity with optional exact-match filter and sort.`,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entität, z. B. "ChangeOrder" (siehe list_entity_types)' },
        filter: { type: 'object', description: 'Exakter Vergleich je Feld, z. B. {"project_id": "abc"}', additionalProperties: { type: ['string', 'number', 'boolean'] } },
        sort: { type: 'string', description: 'Feld, mit "-" absteigend, z. B. "-updated_date"' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Höchstzahl, Vorgabe ${STANDARD_LIMIT}` },
      },
      required: ['entity'],
    },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      const entity = entitaetAus(args);
      const limit = limitAus(args);
      const alle = await api('GET', `/entities/${entity}${abfrageAus(args)}`);
      const liste = Array.isArray(alle) ? alle : [];
      return { entity, gesamt: liste.length, anzahl: Math.min(limit, liste.length), datensaetze: liste.slice(0, limit) };
    },
  },
  {
    name: 'get_record',
    art: 'lesen',
    title: 'Get record',
    description: 'Liest einen Datensatz einer Entität. / Reads one record of an entity.',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' }, id: { type: 'string' } },
      required: ['entity', 'id'],
    },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      return api('GET', `/entities/${entitaetAus(args)}/${encodeURIComponent(idAus(args))}`);
    },
  },
  {
    name: 'zeichenflaeche_befehle',
    art: 'lesen',
    title: 'Drawing surface commands',
    description: 'Listet die Befehle der in BIT-Atelier geöffneten Fläche mit Tastenkürzel und ob sie gerade möglich sind. Die Anfrage geht an die Fläche, in der die Person zuletzt gearbeitet hat: Massing-Studio, IFC-Viewer oder BIM-Studio (jede kennt eigene Befehle). Antwort status "not-run" = keine Fläche offen. / Lists the commands of the surface open in BIT-Atelier (Massing studio, IFC viewer or BIM studio — the one the person worked in last), with keys and whether each is possible now.',
    inputSchema: { type: 'object', properties: {} },
    annotations: NUR_LESEN,
    async ausfuehren() {
      return steuerung({ id: Date.now(), method: 'befehle' });
    },
  },
  {
    name: 'zeichenflaeche_ausfuehren',
    art: 'sofort',
    title: 'Run drawing surface command',
    description: 'Führt einen Befehl der geöffneten Fläche aus (Massing-Studio, IFC-Viewer oder BIM-Studio, je nach dem, in der die Person gerade arbeitet), z. B. im Massing-Studio {"befehl":"linie"}, dann {"befehl":"eingabe","params":{"text":"@8;0"}} (Koordinaten: #x;y absolut, @dx;dy relativ, @abstand<winkel polar, Norden oben), {"befehl":"modell"} liest das Modell. Für Auswahl, Eigenschaften, Verschieben, Teilen und das Bild der Ansicht gibt es eigene Werkzeuge (auswahl_abfragen, eigenschaft_setzen, …). ACHTUNG: Im IFC-Viewer und im BIM-Studio liefern die Änderungsbefehle (eigenschaft-setzen, transformieren, teilen) nur einen Vorschlag, den die Person in der App übernimmt; das Massing-Studio führt seine Zeichen- und Bearbeitungsbefehle (linie, wand, loeschen, rueckgaengig …) dagegen SOFORT aus, ohne Vorschlag und ohne Bestätigung. Bestätigen kann ein Agent nicht (Entscheidung D-IM-04): das macht die Person in der App. status "not-run" = darf wiederholt werden, "may-have-run" = erst mit "modell" prüfen (nur mit Schreibrecht). / Runs a command of the open surface (Massing studio, IFC viewer or BIM studio; write permission only). In the IFC viewer and BIM studio change commands only make proposals; the Massing studio runs its drawing and editing commands (line, wall, delete, undo ...) IMMEDIATELY, with no proposal and no confirmation.',
    inputSchema: {
      type: 'object',
      properties: { befehl: { type: 'string', description: 'Befehls-id aus zeichenflaeche_befehle' }, params: { type: 'object', description: 'Parameter, z. B. {"text":"@3;4"}' } },
      required: ['befehl'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    schreibt: true,
    async ausfuehren(args) {
      const befehl = String(args.befehl ?? '');
      if (!/^[a-z0-9-]{1,40}$/.test(befehl)) throw new EingabeFehler(`Ungültiger Befehl ${JSON.stringify(args.befehl)} — zeichenflaeche_befehle nennt alle.`);
      // confirming has no road for an agent, this one included (the app refuses it as well: defence in depth)
      if (befehl === 'bestaetigen') throw new Abgelehnt(`bestaetigen ist abgelehnt: ${BESTAETIGEN_ABGELEHNT}`);
      // 106-06 review fix: the image of the view has ONE road with its checks (ansicht_bild: "Nur lokale KI", NDA, consent, office switch);
      // the app server checks every image in the control channel as well (steuerungRouter bildPruefen) - defence in depth
      if (befehl === 'ansicht-bild') throw new Abgelehnt('ansicht-bild geht nicht über zeichenflaeche_ausfuehren — dafür gibt es das Werkzeug ansicht_bild (es prüft NDA-Merker, Zustimmung des Projekts und „Nur lokale KI“).');
      const params = args.params && typeof args.params === 'object' && !Array.isArray(args.params) ? args.params : {};
      return befehlAnApp(befehl, params);
    },
  },
  // --- 106-04: tools for the model in the open viewer (IFC viewer, BIM studio, Massing studio) ---
  // All go through the control channel to the register of the viewer the person works in. Writing tools only make a PROPOSAL
  // (sentence in words, check, preview); the person confirms in the app (guard rail 1). The target is a GUID or the one
  // selected element - never a guess (guard rail 3): without GUID and selection the app answers in German and nothing runs.
  {
    name: 'auswahl_abfragen',
    art: 'lesen',
    title: 'Read selection',
    description: 'Liest, was die Person im geöffneten Viewer (IFC-Viewer oder BIM-Studio) gerade ausgewählt hat: GUID, Klasse, Name, Geschoss, Steckbrief (KG, Gewerk, Material, Status, Menge, Feuerwiderstand; Herkunft gesetzt/abgeleitet/offen) und Bildschirmposition. Das ist „dieses Bauteil“. Ohne Auswahl ist anzahl 0. Antwort status "not-run" = kein Viewer offen. / Reads what the person has selected in the open viewer (IFC viewer or BIM studio): GUID, class, name, storey, short profile. Suchwort: get_selection.',
    inputSchema: { type: 'object', properties: {} },
    annotations: NUR_LESEN,
    async ausfuehren() {
      return befehlAnApp('auswahl-lesen');
    },
  },
  {
    name: 'bauteil_waehlen',
    art: 'lesen',
    title: 'Select element by GUID',
    description: 'Wählt ein Bauteil per GUID im geöffneten Viewer aus (wie ein Klick) und liefert dessen Steckbrief; die Kamera bleibt. Ändert nur die Auswahl in der Oberfläche, nichts wird gespeichert — deshalb ohne Schreibrecht erlaubt. ACHTUNG: Die Auswahl der Person wird dabei überschrieben, und ein späteres „dieses Bauteil“ meint dann das hier gewählte. Unbekannte oder nicht wählbare GUID: Klartext-Fehler. Die GUID stammt aus modell_bauteile oder auswahl_abfragen, nie aus einem Bild. Suchwort: select_element_by_guid. / Selects an element by GUID in the open viewer (like a click) and returns its profile. Changes only the UI selection, nothing is stored.',
    inputSchema: { type: 'object', properties: { guid: { type: 'string', description: 'GUID des Bauteils (aus modell_bauteile)' } }, required: ['guid'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ausfuehren(args) {
      return befehlAnApp('auswahl-guid', { guid: guidAus(args, true) });
    },
  },
  {
    name: 'modell_bauteile',
    art: 'lesen',
    title: 'List model elements',
    description: 'Kurzübersicht des geöffneten Modells: Zahl je Klasse, Geschosse und bis zu 200 Bauteile mit GUID, Klasse, Name, Geschoss. Bei langen Modellen mit klasse (z. B. IfcWall) Klasse für Klasse suchen. Suchwörter: list_elements, get_model. / Short read-out of the open model: counts per class, storeys and up to 200 elements with GUID; filter by class.',
    inputSchema: { type: 'object', properties: { klasse: { type: 'string', description: 'nur diese IFC-Klasse, z. B. IfcWall' } } },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      const klasse = args.klasse == null || args.klasse === '' ? undefined : String(args.klasse);
      if (klasse !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(klasse)) throw new EingabeFehler(`Ungültige Klasse ${JSON.stringify(args.klasse)} — erwartet z. B. IfcWall.`);
      return befehlAnApp('modell', klasse ? { klasse } : {});
    },
  },
  {
    name: 'vorschlaege_lesen',
    art: 'lesen',
    title: 'Read proposals and history',
    description: 'Listet die offenen Änderungsvorschläge (id, Satz in Worten, Ziel, Prüfstufe, Herkunft, gesperrt) und den Verlauf der übernommenen Schritte mit Herkunft (hand/text/sprache/agent/bild). Damit sieht ein Agent, ob die Person einen Vorschlag übernommen hat. / Lists open change proposals and the history of executed steps with their origin.',
    inputSchema: { type: 'object', properties: {} },
    annotations: NUR_LESEN,
    async ausfuehren() {
      return befehlAnApp('vorschlaege');
    },
  },
  {
    name: 'pruefen',
    art: 'lesen',
    title: 'Check open proposals',
    description: 'Prüft offene Vorschläge erneut gegen den aktuellen Stand des Modells (Brandschutz, Tragwerk, Öffnungen, Veraltet-Prüfung) und liefert Stufe (ok/warnung/fehler) und Sätze. Ohne Angabe alle offenen, sonst nur die zum Bauteil (guid) oder einen Vorschlag (id). Ändert nichts am Modell, aktualisiert aber die gespeicherte Prüfung der Vorschläge (und kann einen veralteten sperren). Prüft nur offene Vorschläge, nicht ein Bauteil für sich: ohne offenen Vorschlag kommt ein Klartext-Fehler, kein Bereich-Prüflauf. / Re-checks open proposals against the current model state; changes nothing in the model but refreshes the stored check of the proposals. It does not check an element on its own.',
    inputSchema: { type: 'object', properties: { guid: { type: 'string', description: 'nur Vorschläge zu diesem Bauteil' }, id: { type: 'string', description: 'nur dieser Vorschlag (vorschlag_id)' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ausfuehren(args) {
      /** @type {Record<string, string>} */
      const params = {};
      if (args.guid != null && args.guid !== '') params.guid = guidAus(args, true);
      if (args.id != null && args.id !== '') params.vorschlag_id = vorschlagIdAus(args);
      return befehlAnApp('pruefen', params);
    },
  },
  {
    name: 'ansicht_bild',
    art: 'lesen',
    title: 'View as image',
    description: 'Liefert die aktuelle 3D-Ansicht des geöffneten Viewers als PNG-Bild (Standard 800 px breit, höchstens 1600), samt Auswahl und Vorschau, wie die Person sie sieht. Das Bild ist nur Ansicht: Bauteile wählt oder ändert man über die GUID aus auswahl_abfragen/modell_bauteile, nie nach Pixeln. Nur in der 3D-Ansicht; Plan und Schnitt antworten mit Klartext. Das Bild gilt als Bild an ein Cloud-Modell (der Client reicht es an sein Modell weiter): es kommt nur, wenn das geöffnete Projekt keinen NDA-Merker trägt, die Person für dieses Projekt einmal zugestimmt hat (Knopf „mit Bild“ im Viewer) und „Nur lokale KI“ sowie die Büro-Einstellung es erlauben; sonst Klartext. Suchwort: render_view. / Returns the current 3D view as a PNG image block (default 800 px, max 1600). The image is only a view; ground truth is the GUID. Treated as an image to a cloud model: only for a project without the NDA marker, after the person\'s one-time consent for that project, and not while "local AI only" is on.',
    inputSchema: { type: 'object', properties: { breite: { type: 'integer', minimum: 64, maximum: 1600, description: 'Bildbreite in Pixel (Standard 800)' } } },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      const breite = args.breite == null || args.breite === '' ? undefined : Number(args.breite);
      if (breite !== undefined && !(Number.isFinite(breite) && breite > 0)) throw new EingabeFehler(`Ungültige Breite ${JSON.stringify(args.breite)} — Pixel erwartet (64 bis 1600).`);
      if (await nurLokalAktiv()) throw new Abgelehnt('ansicht_bild ist abgelehnt: In BIT-Atelier ist „Nur lokale KI“ eingeschaltet (Einstellungen › KI) — ein MCP-Client reicht das Bild an sein Modell weiter, meist ein Cloud-Modell außerhalb dieses Rechners (Entscheidung D-IM-02). Die Person kann den Schalter ausstellen oder ein lokales Modell anbinden.');
      const antwort = await befehlAnApp('ansicht-bild', breite === undefined ? {} : { breite: Math.round(breite) });
      const r = antwort?.result;
      if (antwort?.ok === true && typeof r?.png_base64 === 'string' && r.png_base64) {
        if (!r.png_base64.startsWith(PNG_BASE64_KOPF)) throw new ApiFehler('ansicht-bild: die App lieferte kein PNG — läuft eine ältere Fassung von BIT-Atelier?');
        // 106-06 (D-IM-02): the image stays on this computer until the app's store allows it for the open project - NDA never, the person's
        // consent once per project. The viewer names its project; without one there is nothing to check against, so no image.
        await bildFreigabePruefen(r.projekt_id);
        // an image block, not text: ergebnis() would cut a long base64 string at MAX_ZEICHEN and break it
        return new RohErgebnis({ content: [
          { type: 'image', data: r.png_base64, mimeType: 'image/png' },
          { type: 'text', text: `Ansicht als Bild: ${r.breite} × ${r.hoehe} px (PNG). Das Bild zeigt nur, was die Person sieht — Bauteile nur über ihre GUID wählen oder ändern, nie nach Pixeln.` },
        ] });
      }
      return antwort; // not-run (no viewer open) or a refusal in words (e.g. not the 3D view) stays visible as text
    },
  },
  {
    name: 'eigenschaft_setzen',
    art: 'vorschlag',
    title: 'Propose property change',
    description: 'Schlägt vor, eine Eigenschaft eines Bauteils zu setzen (z. B. name "Feuerwiderstand", wert "F90"; pset nur bei IFC-Eigenschaftssätzen). Ziel: guid, sonst das ausgewählte Bauteil; ohne beides lehnt die App mit „Keine Auswahl …“ ab. Antwort ist nur der VORSCHLAG (id, Satz in Worten, Prüfung, Herkunft agent) — verändert wird nichts, bis die Person in der App übernimmt. Suchwörter: modify_ifc_property, set_property. / Proposes setting a property of an element. Returns only a proposal with id and sentence; nothing changes until a person confirms in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string', description: 'GUID des Bauteils; ohne Angabe das ausgewählte' },
        pset: { type: 'string', description: 'Eigenschaftssatz bei IFC-Eigenschaften, z. B. Pset_WallCommon' },
        name: { type: 'string', description: 'Name der Eigenschaft, z. B. Feuerwiderstand' },
        wert: { type: ['string', 'number', 'boolean'], description: 'neuer Wert' },
        satz_marke: SATZ_MARKE_SCHEMA,
      },
      required: ['name', 'wert'],
    },
    annotations: VORSCHLAG,
    schreibt: true,
    async ausfuehren(args) {
      const name = String(args.name ?? '').trim();
      if (!name) throw new EingabeFehler('name fehlt — welche Eigenschaft soll gesetzt werden?');
      if (!('wert' in args) || args.wert === null || typeof args.wert === 'object') throw new EingabeFehler('wert fehlt — Text, Zahl oder Wahrheitswert erwartet.');
      const guid = guidAus(args);
      const satzMarke = satzMarkeAus(args);
      return befehlAnApp('eigenschaft-setzen', { name, wert: args.wert, ...(guid ? { guid } : {}), ...(args.pset ? { pset: String(args.pset) } : {}),
        ...(satzMarke ? { satz_marke: satzMarke } : {}) });
    },
  },
  {
    name: 'transformieren',
    art: 'vorschlag',
    title: 'Propose move, rotate, scale',
    description: 'Schlägt vor, ein gezeichnetes Bauteil zu verschieben (verschiebung_m [dx, dz] oder [dx, dy, dz] in m), zu drehen (drehung_grad, Grad) oder zu skalieren (faktor). Ziel: guid, sonst die Auswahl. Antwort ist nur der Vorschlag mit Satz und Prüfung; ausgeführt wird erst nach Bestätigung durch die Person. IFC-Dateien bleiben unverändert (dort Klartext-Absage). Suchwörter: transform_geometry, move_element. / Proposes moving (m), rotating (degrees) or scaling a drawn element. Returns only a proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string', description: 'GUID des Bauteils; ohne Angabe das ausgewählte' },
        verschiebung_m: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[dx, dz] oder [dx, dy, dz] in Metern' },
        drehung_grad: { type: 'number', description: 'Drehung um die Hochachse in Grad' },
        faktor: { type: 'number', exclusiveMinimum: 0, description: 'Maßstabsfaktor, 1 = unverändert' },
        satz_marke: SATZ_MARKE_SCHEMA,
      },
    },
    annotations: VORSCHLAG,
    schreibt: true,
    async ausfuehren(args) {
      if (args.verschiebung_m == null && args.drehung_grad == null && args.faktor == null) throw new EingabeFehler('Nichts zu ändern — verschiebung_m, drehung_grad oder faktor angeben.');
      /** @type {Record<string, any>} */
      const params = {};
      const guid = guidAus(args);
      if (guid) params.guid = guid;
      if (args.verschiebung_m != null) params.verschiebung_m = args.verschiebung_m;
      if (args.drehung_grad != null) params.drehung_grad = zahlAus(args, 'drehung_grad');
      if (args.faktor != null) params.faktor = zahlAus(args, 'faktor');
      const satzMarke = satzMarkeAus(args);
      if (satzMarke) params.satz_marke = satzMarke;
      return befehlAnApp('transformieren', params);
    },
  },
  {
    name: 'teilen',
    art: 'vorschlag',
    title: 'Propose split',
    description: 'Schlägt vor, ein gezeichnetes Bauteil zu teilen: eine Wand an einem Punkt {x, z} (m) oder bei anteil (0 bis 1 entlang der Wand, 0,5 = Mitte), eine Fläche entlang einer linie {a, b}. Ziel: guid, sonst die Auswahl. Antwort ist nur der Vorschlag (Satz, Prüfung); geteilt wird erst nach Bestätigung durch die Person, Öffnungen wandern zum richtigen Teil. IFC-Dateien bleiben unverändert. Suchwort: split_element. / Proposes splitting a drawn element at a point, a fraction or along a line. Returns only a proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string', description: 'GUID des Bauteils; ohne Angabe das ausgewählte' },
        punkt: { type: 'object', properties: { x: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'z'], description: 'Schnittpunkt der Wand in m (Planmaß)' },
        anteil: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: 'Wand: Anteil der Länge vom Anfang, 0,5 = Mitte' },
        linie: { type: 'object', properties: { a: { type: 'object' }, b: { type: 'object' } }, required: ['a', 'b'], description: 'Fläche: Schnittlinie von a {x, z} nach b {x, z} in m' },
        satz_marke: SATZ_MARKE_SCHEMA,
      },
    },
    annotations: VORSCHLAG,
    schreibt: true,
    async ausfuehren(args) {
      if (args.punkt == null && args.anteil == null && args.linie == null) throw new EingabeFehler('Teilen braucht punkt {x, z}, anteil (0 bis 1) oder linie {a, b}.');
      /** @type {Record<string, any>} */
      const params = {};
      const guid = guidAus(args);
      if (guid) params.guid = guid;
      if (args.punkt != null) params.punkt = args.punkt;
      if (args.anteil != null) params.anteil = zahlAus(args, 'anteil');
      if (args.linie != null) params.linie = args.linie;
      const satzMarke = satzMarkeAus(args);
      if (satzMarke) params.satz_marke = satzMarke;
      return befehlAnApp('teilen', params);
    },
  },
  {
    name: 'vorschlag_verwerfen',
    art: 'vorschlag',
    title: 'Discard proposal',
    description: 'Nimmt einen eigenen, noch offenen Vorschlag zurück (id aus eigenschaft_setzen/transformieren/teilen). Ändert nichts am Modell; ein Agent kann nur Vorschläge verwerfen, die er selbst gemacht hat. / Withdraws an own open proposal. Changes nothing in the model.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Id des Vorschlags' } }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    schreibt: true,
    async ausfuehren(args) {
      return befehlAnApp('verwerfen', { vorschlag_id: vorschlagIdAus(args) });
    },
  },
  // --- records: preview first, then ausfuehren (111-02, K-05/K-07/K-11/S-12) ---
  {
    name: 'create_record',
    art: 'vorschau-dann-ausfuehren',
    title: 'Create record',
    description: 'Legt einen Datensatz an (nur mit Schreibrecht). Ohne ausfuehren nur VORSCHAU (vorher null, nachher, geaenderte_felder, probleme, naechster_schritt) — es wird nichts geschrieben. Mit ausfuehren: true wird angelegt, außer es gibt schon einen Datensatz mit gleichem Namen/Titel im selben Projekt (Antwort „nicht übernommen: mögliche Dublette von <id>“; nur mit doppelt_erlaubt: true trotzdem). idempotenz_schluessel: ein zweiter Aufruf mit demselben Schlüssel liefert den ersten Datensatz, statt einen zweiten anzulegen. Gesperrte Entitäten und geschützte Projektfelder werden nie gesendet. / Creates a record (write permission only). Without ausfuehren only a preview; ausfuehren: true writes, unless a record with the same name exists in the project (then "nicht übernommen", doppelt_erlaubt overrides); idempotenz_schluessel makes a repeated call return the first record.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        data: { type: 'object', description: 'Felder des neuen Datensatzes (id, created_date, updated_date vergibt die App)' },
        ausfuehren: AUSFUEHREN_SCHEMA,
        idempotenz_schluessel: { type: 'string', description: 'Eigener Schlüssel dieses Vorgangs (z. B. aus Chat-Nachricht und Zweck); derselbe Schlüssel legt nie einen zweiten Datensatz an' },
        doppelt_erlaubt: { type: 'boolean', description: 'true nur, wenn die Person bestätigt hat, dass ein Datensatz mit gleichem Namen gewollt ist' },
      },
      required: ['entity', 'data'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    schreibt: true,
    ausfuehren: datensatzAnlegen,
  },
  {
    name: 'update_record',
    art: 'vorschau-dann-ausfuehren',
    title: 'Update record',
    description: 'Ändert Felder eines Datensatzes; nicht genannte Felder bleiben (nur mit Schreibrecht). Ohne ausfuehren nur VORSCHAU: vorher (gespeicherter Satz), nachher, geaenderte_felder (nur wirklich andere Werte), probleme, stand und naechster_schritt. Mit ausfuehren: true und dem stand der Vorschau wird geschrieben — hat jemand den Satz inzwischen geändert, kommt „nicht übernommen: inzwischen geändert — neue Vorschau holen“. Geschützte Projektfelder (bild_freigabe, Lockern von nda) werden nie gesendet. / Updates fields of a record (write permission only). Without ausfuehren only a preview with before/after and the stand; ausfuehren: true plus that stand writes, a record changed in between is not overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        id: { type: 'string' },
        data: { type: 'object', description: 'Zu ändernde Felder' },
        ausfuehren: AUSFUEHREN_SCHEMA,
        stand: STAND_SCHEMA,
      },
      required: ['entity', 'id', 'data'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    schreibt: true,
    ausfuehren: datensatzAendern,
  },
  {
    name: 'delete_record',
    art: 'vorschau-dann-ausfuehren',
    title: 'Move record to recycle bin',
    description: 'Legt einen Datensatz in den PAPIERKORB (nur mit Schreibrecht) — endgültig gelöscht wird nie. Ohne ausfuehren nur VORSCHAU (der Satz, stand, naechster_schritt); mit ausfuehren: true und dem stand wandert er mit Zeit, Grund und Herkunft „mcp“ in den Papierkorb. Zurück mit wiederherstellen. Projekte löscht nur die Person in der App. / Moves a record to the recycle bin (write permission only), never a hard delete. Without ausfuehren only a preview; restore with wiederherstellen.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        id: { type: 'string' },
        grund: { type: 'string', maxLength: MAX_LOESCHGRUND_ZEICHEN, description: 'Warum, in Worten (steht im Papierkorb)' },
        ausfuehren: AUSFUEHREN_SCHEMA,
        stand: STAND_SCHEMA,
      },
      required: ['entity', 'id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    schreibt: true,
    ausfuehren: datensatzLoeschen,
  },
  {
    name: 'papierkorb_lesen',
    art: 'lesen',
    title: 'Read recycle bin',
    description: `Listet den Papierkorb, neueste zuerst: id des Eintrags (für wiederherstellen), entity, record_id, project_id, geloescht_am, grund, herkunft (mcp/app) und der Datensatz, wie er war; optional nur eine entity oder ein project_id; höchstens ${MAX_LIMIT}. Einträge älter als 90 Tage räumt die App auf. / Lists the recycle bin, newest first, optionally by entity or project.`,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'nur Einträge dieser Entität' },
        project_id: { type: 'string', description: 'nur Einträge dieses Projekts' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Höchstzahl, Vorgabe ${STANDARD_LIMIT}` },
      },
    },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      const limit = limitAus(args);
      const params = new URLSearchParams();
      if (args.entity != null && args.entity !== '') params.set('entity', entitaetAus(args));
      if (args.project_id != null && args.project_id !== '') params.set('project_id', idAus({ id: args.project_id }));
      const q = params.toString();
      const alle = await api('GET', `/papierkorb${q ? `?${q}` : ''}`);
      const liste = Array.isArray(alle) ? alle : [];
      return { gesamt: liste.length, anzahl: Math.min(limit, liste.length), datensaetze: liste.slice(0, limit) };
    },
  },
  {
    name: 'wiederherstellen',
    art: 'vorschau-dann-ausfuehren',
    title: 'Restore from recycle bin',
    description: 'Holt einen Datensatz aus dem Papierkorb zurück, mit derselben id und denselben Feldern (nur mit Schreibrecht; id = Eintrag aus papierkorb_lesen). Ohne ausfuehren nur VORSCHAU (was zurückkommt, ob die id frei ist); mit ausfuehren: true wird er zurückgelegt — ist die id inzwischen belegt, „nicht übernommen“ mit Grund, nichts wird überschrieben. / Restores a record from the recycle bin with the same id (write permission only). Without ausfuehren only a preview; an occupied id is refused, nothing is overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id des Papierkorb-Eintrags (aus papierkorb_lesen)' },
        ausfuehren: AUSFUEHREN_SCHEMA,
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    schreibt: true,
    ausfuehren: datensatzWiederherstellen,
  },
  // --- 111-01: the call log, read back (only with --protokoll-lesen: it holds the arguments of every call) ---
  {
    name: 'aufrufprotokoll_lesen',
    art: 'lesen',
    title: 'Read call log',
    description: 'Liest die letzten Einträge des lokalen Aufrufprotokolls dieses MCP-Servers (Zeit, Client, Person, Werkzeug, gekürzte und geschwärzte Argumente, Ergebnis ok/fehler/abgelehnt/unbekannt, Dauer in ms, Begründung), neueste zuletzt; optional nur ein werkzeug oder eine ergebnis-Art. Nur verfügbar, wenn der Server mit --protokoll-lesen gestartet wurde. / Reads the last entries of the local call log of this MCP server, newest last; only with --protokoll-lesen.',
    inputSchema: {
      type: 'object',
      properties: {
        anzahl: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'Wie viele Einträge, Vorgabe 20' },
        werkzeug: { type: 'string', description: 'nur Aufrufe dieses Werkzeugs, z. B. create_record' },
        ergebnis: { type: 'string', enum: ['ok', 'fehler', 'abgelehnt', 'unbekannt'], description: 'nur diese Ergebnisart' },
      },
    },
    annotations: NUR_LESEN,
    protokollLesen: true,
    async ausfuehren(args) {
      const anzahl = args.anzahl == null ? 20 : Math.floor(Number(args.anzahl));
      if (!Number.isFinite(anzahl) || anzahl < 1) throw new EingabeFehler('anzahl muss eine Zahl ≥ 1 sein.');
      const werkzeug = args.werkzeug == null || args.werkzeug === '' ? undefined : String(args.werkzeug);
      const art = args.ergebnis == null || args.ergebnis === '' ? undefined : String(args.ergebnis);
      if (art && !['ok', 'fehler', 'abgelehnt', 'unbekannt'].includes(art)) throw new EingabeFehler(`Ungültige ergebnis-Art ${JSON.stringify(args.ergebnis)} — ok, fehler, abgelehnt oder unbekannt.`);
      const ordner = await protokoll.ordner();
      if (!ordner) throw new ApiFehler('Kein Aufrufprotokoll: der Datenordner ist unbekannt — BIT_DATA_DIR setzen oder BIT-Atelier starten (bit_status prüft das).');
      const eintraege = protokollLesen(ordner, { anzahl: Math.min(anzahl, MAX_LIMIT), werkzeug, ergebnis: art });
      return { ordner, anzahl: eintraege.length, eintraege };
    },
  },
];

/**
 * The schema a client sees: write tools get the optional `begruendung` (K-04) automatically, never by hand per tool.
 * @param {typeof WERKZEUGE[number]} w @returns {object}
 */
function schemaFuerClient(w) {
  if (!w.schreibt) return w.inputSchema;
  return { ...w.inputSchema, properties: { ...(w.inputSchema.properties || {}), begruendung: BEGRUENDUNG_SCHEMA } };
}

/** @param {typeof WERKZEUGE[number]} w @returns {boolean} visible and callable with the flags of this process */
function freigeschaltet(w) {
  return (!w.schreibt || SCHREIBEN) && (!w.protokollLesen || PROTOKOLL_LESEN);
}

/**
 * Tools visible to the client — write tools only with --schreiben/--write, the log reader only with --protokoll-lesen.
 * `_meta` carries the kind (the convention) and the write flag, so a test or a client can check them.
 */
function sichtbareWerkzeuge() {
  return WERKZEUGE.filter(freigeschaltet).map((w) => ({
    name: w.name, title: w.title, description: w.description, inputSchema: schemaFuerClient(w), annotations: w.annotations,
    _meta: { 'bit-atelier/art': w.art, 'bit-atelier/schreibt': w.schreibt === true },
  }));
}

/**
 * tools/call without the log. Tool failures are results with isError (the model reads them);
 * an unknown tool name is a protocol error.
 * @param {string} name tool name
 * @param {Record<string, any>} args arguments without `begruendung`
 * @returns {Promise<{ergebnis?: any, fehler?: {code: number, message: string}, art: 'ok'|'fehler'|'abgelehnt'|'unbekannt'}>}
 *   art: the result kind for the call log
 */
async function werkzeugAusfuehren(name, args) {
  const werkzeug = WERKZEUGE.find((w) => w.name === name);
  if (!werkzeug) return { fehler: { code: -32602, message: `Unbekanntes Werkzeug: ${name}` }, art: 'unbekannt' };
  if (werkzeug.schreibt && !SCHREIBEN) {
    return { ergebnis: fehlerErgebnis(`${name} ist abgelehnt: Schreibrecht fehlt. Der MCP-Server läuft nur lesend — mit --schreiben (oder --write) starten, um Datensätze anzulegen oder zu ändern.`), art: 'abgelehnt' };
  }
  if (werkzeug.protokollLesen && !PROTOKOLL_LESEN) {
    return { ergebnis: fehlerErgebnis(`${name} ist abgelehnt: das Aufrufprotokoll ist nur lesbar, wenn der MCP-Server mit --protokoll-lesen gestartet wurde.`), art: 'abgelehnt' };
  }
  try {
    const roh = await werkzeug.ausfuehren(args);
    return { ergebnis: roh instanceof RohErgebnis ? roh.wert : ergebnis(roh), art: 'ok' };
  } catch (err) {
    if (err instanceof Abgelehnt) return { ergebnis: fehlerErgebnis(err.message), art: 'abgelehnt' };
    if (err instanceof NichtErreichbar || err instanceof ApiFehler || err instanceof EingabeFehler) {
      return { ergebnis: fehlerErgebnis(err.message), art: 'fehler' };
    }
    log(`${name}: unexpected error: ${err?.stack || err}`);
    return { ergebnis: fehlerErgebnis(`Interner Fehler in ${name}: ${err?.message || err}`), art: 'fehler' };
  }
}

// --- 111-01: call log (K-03) ----------------------------------------------------

/** clientInfo of the initialize request ({name, version}); null until a client introduced itself. */
let clientInfo = /** @type {{name?: string, version?: string}|null} */ (null);
/** Person of the app session (GET /auth/me), cached after the first answer; the app is single-user today. */
let personCache = /** @type {Promise<string|null>|null} */ (null);
/** Clock time (ms) of the last failed /auth/me; within NEU_VERSUCH_MS no new attempt (review 111-01: a hanging app
 *  must not add its time limit to every tool call). */
let personFehlschlag = 0;

/**
 * The data folder for the log: BIT_DATA_DIR first (same rule as server/datenPfad.js), else the app's answer.
 * @returns {Promise<string|null>} absolute path, or null when unknown
 */
async function datenordnerFuerProtokoll() {
  const gesetzt = String(process.env.BIT_DATA_DIR ?? '').trim();
  if (gesetzt) return path.resolve(gesetzt);
  const antwort = await api('GET', '/system/datenordner', undefined, NEBEN_TIMEOUT_MS);
  return antwort?.ordner ? String(antwort.ordner) : null;
}

const protokoll = new AufrufProtokoll({ ordnerFinden: datenordnerFuerProtokoll, melden: log, geheimnisse: [process.env.BIT_STEUERUNG_TOKEN || ''] });

/**
 * Name (or id) of the person signed in to the app, asked once; null when the app does not answer (asked again next call).
 * @returns {Promise<string|null>}
 */
function person() {
  if (!personCache) {
    if (personFehlschlag && Date.now() - personFehlschlag < NEU_VERSUCH_MS) return Promise.resolve(null);
    personCache = api('GET', '/auth/me', undefined, NEBEN_TIMEOUT_MS)
      .then((me) => (me && typeof me === 'object' ? String(me.full_name || me.email || me.id || '') || null : null))
      .catch(() => { personCache = null; personFehlschlag = Date.now(); return null; });
  }
  return personCache;
}

/** @param {any} antwort @returns {string|undefined} first text block of a result, for the log of a refusal or failure */
function meldungAus(antwort) {
  if (antwort.fehler) return antwort.fehler.message;
  return antwort.ergebnis?.content?.find((c) => c?.type === 'text')?.text;
}

/**
 * tools/call with the call log: `begruendung` is taken out of the arguments before the tool runs (it never reaches the
 * app), the call is timed, and exactly one log line is written — for ok, failed, refused and unknown calls alike.
 * A log error never changes the answer (AufrufProtokoll.schreiben does not throw).
 * @param {Record<string, any>} params
 */
async function werkzeugAufruf(params) {
  const start = performance.now();
  const name = String(params?.name ?? '');
  const roh = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
  const { begruendung: begruendungRoh, ...args } = roh;
  const antwort = await werkzeugAusfuehren(name, args);
  const dauerMs = Math.round(performance.now() - start);
  const begruendung = begruendungAus(protokoll.bereinigen(begruendungRoh)); // redact first, then cut
  /** @type {Record<string, any>} */
  const eintrag = {
    zeit: new Date().toISOString(),
    client: clientInfo ? [clientInfo.name, clientInfo.version].filter(Boolean).join(' ') || null : null,
    person: await person(),
    werkzeug: name,
    argumente: args,
    ergebnis: antwort.art,
    dauer_ms: dauerMs,
    schreibrecht: SCHREIBEN,
  };
  if (begruendung) eintrag.begruendung = begruendung;
  if (antwort.art !== 'ok') eintrag.meldung = meldungAus(antwort);
  await protokoll.schreiben(eintrag);
  return antwort;
}

// --- 111-01: working context for initialize (K-02) ------------------------------

/**
 * Text of a record for the instructions: one line, no control characters, at most 120 characters (a project name is
 * data the person typed, not an instruction).
 * @param {unknown} wert @returns {string}
 */
function einzeilig(wert) {
  // eslint-disable-next-line no-control-regex
  return String(wert ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120);
}

/**
 * The `instructions` of initialize (German, for the model): language, way of working, the convention, the rule that an
 * agent never confirms, the log, write permission, and the working project. Never throws and never waits longer than
 * NEBEN_TIMEOUT_MS for the app.
 * [ASSUMED] working project = the most recently changed project: the app does not tell the MCP server which project is
 * open (open question of plan 111-01: a report over the control channel would replace this).
 * @returns {Promise<string>}
 */
async function arbeitskontext() {
  let projektSatz;
  try {
    const liste = await api('GET', '/entities/Project?sort=-updated_date', undefined, NEBEN_TIMEOUT_MS);
    const p = Array.isArray(liste) ? liste[0] : null;
    projektSatz = p
      ? `Arbeitsprojekt (Annahme: das zuletzt geänderte Projekt — die App meldet ihr offenes Projekt nicht): „${einzeilig(p.name) || 'ohne Namen'}“ (id ${einzeilig(p.id)}). Wenn die Person ein anderes meint, nachfragen; list_projects zeigt alle.`
      : 'Arbeitsprojekt: keines — in BIT-Atelier ist noch kein Projekt angelegt (list_projects zeigt alle).';
  } catch {
    projektSatz = 'Arbeitsprojekt: unbekannt — App nicht erreichbar — bit_status prüft das.';
  }
  return [
    'BIT-Atelier: lokale Plattform für Bau- und Architekturprojekte; dieser MCP-Server ist eine Brücke zur laufenden App auf diesem Rechner.',
    'Sprache: Mit der Person Deutsch sprechen.',
    'Arbeitsweise: erst lesen, dann Vorschau, dann ausführen. Datensätze und Bauteile nur über ids und GUIDs ansprechen, die ein Lesewerkzeug geliefert hat — nie raten.',
    konventionsSatz(),
    'Bestätigen: Ein Agent bestätigt nie selbst — Vorschläge übernimmt oder verwirft die Person in der App; ein Werkzeug zum Bestätigen gibt es nicht.',
    'Fehlertexte nennen den nächsten Schritt: erst lesen, dann gezielt wiederholen.',
    'Begründung: Schreibwerkzeuge nehmen optional begruendung {grund, quelle, aussenwirkung: keine|intern|extern}; sie geht nur ins lokale Aufrufprotokoll, nie an die App.',
    'Protokoll: Jeder Werkzeugaufruf wird auf diesem Rechner protokolliert (Ordner ki-protokoll im Datenordner der App).',
    SCHREIBEN ? 'Schreibrecht: an (--schreiben).' : 'Schreibrecht: aus — nur Lesewerkzeuge; zum Schreiben startet die Person den Server mit --schreiben.',
    projektSatz,
  ].join('\n');
}

// --- JSON-RPC -------------------------------------------------------------------

/**
 * Handles one JSON-RPC message.
 * @param {any} nachricht parsed message
 * @returns {Promise<object|null>} the response, or null for notifications/responses
 */
async function bearbeite(nachricht) {
  const istObjekt = nachricht && typeof nachricht === 'object' && !Array.isArray(nachricht);
  const hatId = istObjekt && Object.prototype.hasOwnProperty.call(nachricht, 'id');
  const id = hatId ? nachricht.id : null;
  if (!istObjekt || nachricht.jsonrpc !== '2.0' || typeof nachricht.method !== 'string') {
    // A response from the client (we never send requests) is ignored silently.
    if (istObjekt && hatId && ('result' in nachricht || 'error' in nachricht)) return null;
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { method, params } = nachricht;

  if (!hatId) {
    // Notifications (notifications/initialized, notifications/cancelled, …): never answered.
    if (method === 'notifications/initialized') log('client initialized');
    return null;
  }

  switch (method) {
    case 'initialize': {
      const verlangt = params?.protocolVersion;
      const version = PROTOKOLL_VERSIONEN.includes(verlangt) ? verlangt : PROTOKOLL_VERSIONEN[0];
      log(`initialize: client ${params?.clientInfo?.name || '?'} asks ${verlangt || '?'} → ${version}`);
      const info = params?.clientInfo;
      if (info && typeof info === 'object') clientInfo = { name: einzeilig(info.name) || undefined, version: einzeilig(info.version) || undefined };
      // find the log folder and clean up old files now, not on the first call (never awaited: initialize must not wait for it)
      protokoll.ordner().catch(() => {});
      return {
        jsonrpc: '2.0', id,
        result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'bit-atelier', version: VERSION }, instructions: await arbeitskontext() },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: sichtbareWerkzeuge() } };
    case 'tools/call': {
      const { ergebnis: res, fehler } = await werkzeugAufruf(params);
      return fehler ? { jsonrpc: '2.0', id, error: fehler } : { jsonrpc: '2.0', id, result: res };
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** @param {object} antwort */
function senden(antwort) {
  process.stdout.write(`${JSON.stringify(antwort)}\n`);
}

/**
 * One input line: a message or a batch (array). Parse errors answer -32700.
 * @param {string} zeile
 */
async function zeileBearbeiten(zeile) {
  if (!zeile.trim()) return;
  let nachricht;
  try {
    nachricht = JSON.parse(zeile);
  } catch {
    senden({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (Array.isArray(nachricht)) {
    if (nachricht.length === 0) {
      senden({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    const antworten = (await Promise.all(nachricht.map(bearbeite))).filter(Boolean);
    if (antworten.length) senden(antworten);
    return;
  }
  const antwort = await bearbeite(nachricht);
  if (antwort) senden(antwort);
}

if (process.argv.includes('--bestaetigen-erlaubt') || process.argv.includes('--allow-confirm')) {
  log('--bestaetigen-erlaubt / --allow-confirm is gone: an agent never confirms (D-IM-04) - the flag is ignored');
}
log(`v${VERSION} · API ${API_URL} · ${SCHREIBEN ? 'write permission ON (--schreiben)' : 'read-only'}${PROTOKOLL_LESEN ? ' · call log readable (--protokoll-lesen)' : ''}`);
// 111-01 (K-18): the convention is checked at every start; a violation is a bug of this file, told on stderr (the server still runs)
for (const verstoss of konventionPruefen(WERKZEUGE.map((w) => ({ ...w, inputSchema: schemaFuerClient(w) })), { mitBegruendung: true })) {
  log(`convention violated: ${verstoss}`);
}

const offen = new Set();
const eingabe = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
eingabe.on('line', (zeile) => {
  const p = zeileBearbeiten(zeile).catch((err) => log(`unexpected error: ${err?.stack || err}`));
  offen.add(p);
  p.finally(() => offen.delete(p));
});
eingabe.on('close', async () => {
  // stdin closed = the client ended the session; finish answers in flight, then let Node exit
  // on its own. A hard process.exit() while fetch keep-alive sockets are still open crashed
  // Node 24 on Windows (exit code 0xC0000409) — so no process.exit() here. Idle keep-alive
  // sockets are released by the HTTP client after a few seconds and the process ends.
  await Promise.allSettled([...offen]);
  process.exitCode = 0;
  process.stdin.destroy();
});
