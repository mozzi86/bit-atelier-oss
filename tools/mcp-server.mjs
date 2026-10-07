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
//        get_record; with write permission also create_record, update_record.

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

// --- Argument checks ------------------------------------------------------------

/** @param {Record<string, unknown>} args @returns {string} */
function entitaetAus(args) {
  const entity = String(args.entity ?? '');
  if (!ENTITAET_MUSTER.test(entity)) {
    throw new EingabeFehler(`Ungültige Entität ${JSON.stringify(args.entity)} — erwartet z. B. "Project" (list_entity_types zeigt alle).`);
  }
  return entity;
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
    return { ergebnis: ergebnis(await werkzeug.ausfuehren(args)) };
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
