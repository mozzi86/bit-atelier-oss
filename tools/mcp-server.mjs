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
// Usage:  node tools/mcp-server.mjs [--schreiben|--write]
//         claude mcp add bit-atelier -- node tools/mcp-server.mjs
// Config: BIT_API_URL (default http://127.0.0.1:3001/api)
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
//        Not connected: the Python harness (harness/) has no MCP client yet.
//        docs/KI-ANBINDUNG.md lists them; tests/unit/mcp-server-10604.test.js checks the doc against this file.
// 106-06: ansicht_bild hands out an image only when the app allows it for the open project (GET /llm/bild-freigabe: no NDA marker,
//        the person's one-time consent per project, "Nur lokale KI" and the office switch) - decision D-IM-02.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, URLSearchParams } from 'node:url';

/** Protocol versions this server speaks, newest first (MCP spec revisions). */
const PROTOKOLL_VERSIONEN = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** Longest text answer in characters before records are dropped / text is cut. */
const MAX_ZEICHEN = 50_000;
/** Upper bound and default for list_records / list_projects (records). */
const MAX_LIMIT = 200;
const STANDARD_LIMIT = 50;
/** Timeout of one API request in milliseconds. */
const TIMEOUT_MS = 15_000;

const SCHREIBEN = process.argv.includes('--schreiben') || process.argv.includes('--write');
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
/** Thrown for an HTTP error answer of the API (404, 403, …). */
class ApiFehler extends Error {}
/** Thrown for invalid tool arguments. */
class EingabeFehler extends Error {}

// --- REST API -------------------------------------------------------------------

/**
 * One request against the local API.
 * @param {'GET'|'POST'|'PUT'} methode HTTP method
 * @param {string} pfad path below BIT_API_URL, starting with '/'
 * @param {unknown} [body] JSON body
 * @returns {Promise<any>} parsed JSON answer
 */
async function api(methode, pfad, body) {
  let res;
  try {
    res = await fetch(API_URL + pfad, {
      method: methode,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
    throw new ApiFehler(`API ${methode} ${pfad} → HTTP ${res.status}: ${meldung}`);
  }
  if (json === null && text) {
    throw new ApiFehler(`Antwort von ${API_URL}${pfad} ist kein JSON — läuft unter BIT_API_URL wirklich BIT-Atelier?`);
  }
  return json;
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
  if (res.status === 401) throw new ApiFehler('Steuerungs-Token passt nicht — wurde BIT-Atelier neu gestartet? Dann gilt das neue Token automatisch beim nächsten Aufruf.');
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
  if (!pid) throw new ApiFehler('ansicht_bild ist abgelehnt: der Viewer hat kein geöffnetes Projekt — NDA-Merker und Zustimmung hängen am Projekt, ohne Projekt geht kein Bild heraus.');
  let f;
  try {
    f = await api('GET', `/llm/bild-freigabe?${new URLSearchParams({ projekt_id: pid, ziel: 'extern', anbieter: 'MCP-Client' })}`);
  } catch (err) {
    if (err instanceof NichtErreichbar) throw err;
    throw new ApiFehler(`ansicht_bild ist abgelehnt: die Freigabe des Projekts ließ sich nicht prüfen (${err?.message || err}) — ohne Prüfung geht kein Bild heraus.`);
  }
  if (f?.ok !== true) {
    const zustimmung = f?.grund === 'zustimmung' ? ' Die Person stimmt in BIT-Atelier im Viewer über den Knopf „mit Bild“ einmal für dieses Projekt zu.' : '';
    throw new ApiFehler(`ansicht_bild ist abgelehnt: ${f?.text || 'Bild für dieses Projekt nicht freigegeben'}.${zustimmung}`);
  }
}

// --- Argument checks ------------------------------------------------------------

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

/** @type {Array<{ name: string, title: string, description: string, inputSchema: object, annotations: object, schreibt?: boolean, ausfuehren: (args: Record<string, any>) => Promise<any> }>} */
const WERKZEUGE = [
  {
    name: 'bit_status',
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
      if (befehl === 'bestaetigen') throw new EingabeFehler(`bestaetigen ist abgelehnt: ${BESTAETIGEN_ABGELEHNT}`);
      // 106-06 review fix: the image of the view has ONE road with its checks (ansicht_bild: "Nur lokale KI", NDA, consent, office switch);
      // the app server checks every image in the control channel as well (steuerungRouter bildPruefen) - defence in depth
      if (befehl === 'ansicht-bild') throw new EingabeFehler('ansicht-bild geht nicht über zeichenflaeche_ausfuehren — dafür gibt es das Werkzeug ansicht_bild (es prüft NDA-Merker, Zustimmung des Projekts und „Nur lokale KI“).');
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
    title: 'View as image',
    description: 'Liefert die aktuelle 3D-Ansicht des geöffneten Viewers als PNG-Bild (Standard 800 px breit, höchstens 1600), samt Auswahl und Vorschau, wie die Person sie sieht. Das Bild ist nur Ansicht: Bauteile wählt oder ändert man über die GUID aus auswahl_abfragen/modell_bauteile, nie nach Pixeln. Nur in der 3D-Ansicht; Plan und Schnitt antworten mit Klartext. Das Bild gilt als Bild an ein Cloud-Modell (der Client reicht es an sein Modell weiter): es kommt nur, wenn das geöffnete Projekt keinen NDA-Merker trägt, die Person für dieses Projekt einmal zugestimmt hat (Knopf „mit Bild“ im Viewer) und „Nur lokale KI“ sowie die Büro-Einstellung es erlauben; sonst Klartext. Suchwort: render_view. / Returns the current 3D view as a PNG image block (default 800 px, max 1600). The image is only a view; ground truth is the GUID. Treated as an image to a cloud model: only for a project without the NDA marker, after the person\'s one-time consent for that project, and not while "local AI only" is on.',
    inputSchema: { type: 'object', properties: { breite: { type: 'integer', minimum: 64, maximum: 1600, description: 'Bildbreite in Pixel (Standard 800)' } } },
    annotations: NUR_LESEN,
    async ausfuehren(args) {
      const breite = args.breite == null || args.breite === '' ? undefined : Number(args.breite);
      if (breite !== undefined && !(Number.isFinite(breite) && breite > 0)) throw new EingabeFehler(`Ungültige Breite ${JSON.stringify(args.breite)} — Pixel erwartet (64 bis 1600).`);
      if (await nurLokalAktiv()) throw new ApiFehler('ansicht_bild ist abgelehnt: In BIT-Atelier ist „Nur lokale KI“ eingeschaltet (Einstellungen › KI) — ein MCP-Client reicht das Bild an sein Modell weiter, meist ein Cloud-Modell außerhalb dieses Rechners (Entscheidung D-IM-02). Die Person kann den Schalter ausstellen oder ein lokales Modell anbinden.');
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
    title: 'Discard proposal',
    description: 'Nimmt einen eigenen, noch offenen Vorschlag zurück (id aus eigenschaft_setzen/transformieren/teilen). Ändert nichts am Modell; ein Agent kann nur Vorschläge verwerfen, die er selbst gemacht hat. / Withdraws an own open proposal. Changes nothing in the model.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Id des Vorschlags' } }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    schreibt: true,
    async ausfuehren(args) {
      return befehlAnApp('verwerfen', { vorschlag_id: vorschlagIdAus(args) });
    },
  },
  {
    name: 'create_record',
    title: 'Create record',
    description: 'Legt einen Datensatz an (nur mit Schreibrecht). / Creates a record (write permission only).',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' }, data: { type: 'object', description: 'Felder des neuen Datensatzes' } },
      required: ['entity', 'data'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    schreibt: true,
    async ausfuehren(args) {
      return api('POST', `/entities/${entitaetAus(args)}`, datenAus(args));
    },
  },
  {
    name: 'update_record',
    title: 'Update record',
    description: 'Ändert Felder eines Datensatzes; nicht genannte Felder bleiben (nur mit Schreibrecht). / Updates fields of a record; other fields stay (write permission only).',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' }, id: { type: 'string' }, data: { type: 'object', description: 'Zu ändernde Felder' } },
      required: ['entity', 'id', 'data'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    schreibt: true,
    async ausfuehren(args) {
      return api('PUT', `/entities/${entitaetAus(args)}/${encodeURIComponent(idAus(args))}`, datenAus(args));
    },
  },
];

/** Tools visible to the client — write tools only with --schreiben/--write. */
function sichtbareWerkzeuge() {
  return WERKZEUGE.filter((w) => !w.schreibt || SCHREIBEN)
    .map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

/**
 * tools/call. Tool failures are results with isError (the model reads them);
 * an unknown tool name is a protocol error.
 * @param {Record<string, any>} params
 */
async function werkzeugAufruf(params) {
  const name = String(params?.name ?? '');
  const werkzeug = WERKZEUGE.find((w) => w.name === name);
  if (!werkzeug) return { fehler: { code: -32602, message: `Unbekanntes Werkzeug: ${name}` } };
  if (werkzeug.schreibt && !SCHREIBEN) {
    return { ergebnis: fehlerErgebnis(`${name} ist abgelehnt: Schreibrecht fehlt. Der MCP-Server läuft nur lesend — mit --schreiben (oder --write) starten, um Datensätze anzulegen oder zu ändern.`) };
  }
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  try {
    const roh = await werkzeug.ausfuehren(args);
    return { ergebnis: roh instanceof RohErgebnis ? roh.wert : ergebnis(roh) };
  } catch (err) {
    if (err instanceof NichtErreichbar || err instanceof ApiFehler || err instanceof EingabeFehler) {
      return { ergebnis: fehlerErgebnis(err.message) };
    }
    log(`${name}: unexpected error: ${err?.stack || err}`);
    return { ergebnis: fehlerErgebnis(`Interner Fehler in ${name}: ${err?.message || err}`) };
  }
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
      return {
        jsonrpc: '2.0', id,
        result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'bit-atelier', version: VERSION } },
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
log(`v${VERSION} · API ${API_URL} · ${SCHREIBEN ? 'write permission ON (--schreiben)' : 'read-only'}`);

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
