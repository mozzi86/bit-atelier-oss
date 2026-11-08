// BIT-API-Client — die EINE Datenschicht der App (umbenannt 2026-08-11,
// vorher "base44Client" aus der Base44-Frühzeit; die Oberfläche ist gleich
// geblieben, damit kein Konsument angefasst werden musste):
//   bitApi.entities.<Entity>.list / filter / create / update / delete / get
//   bitApi.auth.me / logout / redirectToLogin
//   bitApi.blobs.put / get / delete            (neu seit 57-02)
//   bitApi.personal.<Entity>.list / filter / create / update / delete / get,
//   bitApi.personal.dateien.put / get / delete (neu seit 80-02 — eigener
//                                                Namensraum für die
//                                                Personal-Entitäten;
//                                                bitApi.entities lehnt sie ab)
//
// DREI Datenwege seit Phase 57-02 (Weiche DATENQUELLE in umgebung.js — EINE
// Frage, EINE Quelle):
//   express   — lokale Express-API (Entwicklung, Vite-Proxy "/api" → :3001)
//   supabase  — Cloud (app.bit-atelier.de): PostgREST + Storage + Auth,
//               RLS filtert serverseitig (57-01)
//   serverlos — lokale Fassung (PWA/Tauri): IndexedDB im Browser (demoDb.js,
//               gespiegelte server/db.js-Semantik), komplett offline
//
// Tree-Shaking (gemessen wie 70-01): die supabase- und serverlos-Zweige stehen
// hinter Compile-Zeit-Konstanten (`DATENQUELLE === 'supabase'`, `SERVERLOS`)
// UND laden per dynamic import — so landet supabase-js nie im lokal-Bundle
// und demoDb nie im Cloud-Bundle. Die Bedingung MUSS vor jedem dynamic import
// stehen, sonst bleibt der Chunk im Graph.

import { SERVERLOS, DATENQUELLE } from '../lib/umgebung.js';
// 80-02 (D-P80-A #2): the personal storage class gets its OWN namespace,
// never the generic `entities` proxy — istPersonalEntitaet gates both sides.
import { istPersonalEntitaet, PERSONAL_NUR_LOKAL } from './personalEntitaeten.js';
// 106-09: every request names its tab, so the change stream can tell a tab its own writes (server/aenderungsStrom.js).
import { CLIENT_KOPF, clientKennung } from '../lib/abgleich/clientKennung.js';

// Serverless data path of the client build (lokal). One question, one source
// (umgebung.js) - see 70-01. The name DEMO is historical (online demo removed in 83-02).
const DEMO = SERVERLOS;
// 57-02 (review correction #2): `?.` — this module is imported under plain node
// by projectImport.js and friends (isomorphic libs, unit tests); a bare
// `import.meta.env.X` throws there because import.meta.env is undefined.
const API_BASE = import.meta.env?.VITE_API_BASE_URL || '/api';

/**
 * Window event fired when the server says a write replaced a newer version of the record (93-03, office mode
 * with several devices: response header X-Bit-Hinweis). detail = { pfad }. The app shows a plain-text note.
 */
export const ZWISCHENZEITLICH_GEAENDERT = 'bit:zwischenzeitlich-geaendert';

/**
 * Merges the caller's headers over the defaults (112-01 review). Header names are case-insensitive: a caller's
 * "content-type" replaces the default "Content-Type" instead of sending both (fetch would join them to one value).
 * @param {Record<string, string>} vorgaben default headers
 * @param {HeadersInit|undefined} eigene the caller's headers: plain object, Headers instance or entry list
 * @returns {Record<string, string>} plain object (the unit test reads it as such)
 */
export function kopfZeilenMischen(vorgaben, eigene) {
  /** @type {Record<string, string>} */
  const ergebnis = { ...vorgaben };
  // globalThis.Headers: present in browsers and Node >= 18; read through globalThis so a runtime without it falls to the
  // plain-object branch instead of throwing.
  const H = /** @type {any} */ (globalThis).Headers;
  /** @type {Array<[string, string]>} */
  const eintraege = !eigene
    ? []
    : Array.isArray(eigene)
      ? /** @type {Array<[string, string]>} */ (eigene)
      : H && eigene instanceof H
        ? [.../** @type {any} */ (eigene).entries()]
        : Object.entries(/** @type {Record<string, string>} */ (eigene));
  for (const [name, wert] of eintraege) {
    for (const k of Object.keys(ergebnis)) if (k.toLowerCase() === name.toLowerCase()) delete ergebnis[k];
    ergebnis[name] = String(wert);
  }
  return ergebnis;
}

/**
 * One call of the express API (path below API_BASE). Throws an Error with `.status` and `.data` on a non-2xx answer,
 * returns null for 204, else the parsed JSON body. Side effect: dispatches ZWISCHENZEITLICH_GEAENDERT when the server
 * reports that the write replaced a newer version.
 *
 * 112-01 (foreign review point 3): the caller's `options.headers` are MERGED over the defaults. Before, `...options`
 * replaced the whole headers object, so a caller passing one header of its own silently lost Content-Type (express then
 * leaves req.body empty) and the client id of 106-09 (the change stream then echoes the tab's own writes back to it).
 * A caller may still override a default on purpose by naming the same header. A Headers instance or an entry list is
 * normalised first (spreading a Headers instance yields {} - its entries are no own enumerable properties).
 *
 * Exported only for the unit test (bitApiHaertung-11201). It is the bare express path: it bypasses the serverless,
 * cloud and PERSONAL_NUR_LOKAL routing of bitApi.* - app code calls bitApi.entities / bitApi.personal / bitApi.apiFetch.
 * @param {string} path API path below API_BASE, e.g. "/entities/Project?sort=-updated_date"
 * @param {RequestInit} [options] fetch options; headers as a plain object, a Headers instance or an entry list
 * @returns {Promise<any>} parsed JSON body, or null for 204
 */
export async function request(path, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: kopfZeilenMischen({ 'Content-Type': 'application/json', [CLIENT_KOPF]: clientKennung() }, headers),
  });
  if (res.headers?.get?.('X-Bit-Hinweis') === 'zwischenzeitlich-geaendert' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ZWISCHENZEITLICH_GEAENDERT, { detail: { pfad: path } }));
  }
  if (!res.ok) {
    const err = /** @type {Error & {status?: number, data?: any}} */ (new Error(`Request failed: ${res.status}`));
    err.status = res.status;
    try {
      err.data = await res.json();
    } catch {
      /* no body */
    }
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function buildQuery(query = {}, sort) {
  const params = new URLSearchParams();
  if (sort) params.set('sort', sort);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, v);
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

/** Loads the supabase adapter — ONLY behind a DATENQUELLE==='supabase' guard. */
const ladeSupabaseDb = () => import('./supabaseDb.js');

// Returns an object with the standard entity methods for a given entity name.
function entityClient(name) {
  // 80-02 (DS-04): a personal entity is rejected in EVERY branch below, before
  // any network or storage access — checked first, ahead of the cloud/demo/
  // express split, so this guard can never be bypassed by a data path that
  // forgets to repeat it. Use bitApi.personal instead.
  if (istPersonalEntitaet(name)) {
    const gesperrt = async () => {
      throw new Error(`"${name}" ist Personal-Entität – nur über bitApi.personal erreichbar.`);
    };
    return { list: gesperrt, filter: gesperrt, get: gesperrt, create: gesperrt, update: gesperrt, delete: gesperrt };
  }
  // Cloud path (57-02, D-P57-02): row-wise PostgREST calls against `records`,
  // RLS filters server-side. Shapes match the other two branches exactly
  // (arrays of {id, created_date, updated_date, …}; get/update 404 as Error
  // with .status).
  if (DATENQUELLE === 'supabase') {
    return {
      list: async (sort) => (await ladeSupabaseDb()).entityClientSupabase(name).list(sort),
      filter: async (query, sort) => (await ladeSupabaseDb()).entityClientSupabase(name).filter(query, sort),
      get: async (id) => (await ladeSupabaseDb()).entityClientSupabase(name).get(id),
      create: async (data) => (await ladeSupabaseDb()).entityClientSupabase(name).create(data),
      update: async (id, data) => (await ladeSupabaseDb()).entityClientSupabase(name).update(id, data),
      delete: async (id) => (await ladeSupabaseDb()).entityClientSupabase(name).delete(id),
    };
  }
  if (DEMO) {
    return {
      list: async (sort) => (await import('./demoDb.js')).demoDb.list(name, sort),
      filter: async (query, sort) => (await import('./demoDb.js')).demoDb.filter(name, query, sort),
      get: async (id) => {
        const rec = await (await import('./demoDb.js')).demoDb.get(name, id);
        if (!rec) { const err = /** @type {Error & {status?: number}} */ (new Error('Request failed: 404')); err.status = 404; throw err; }
        return rec;
      },
      create: async (data) => (await import('./demoDb.js')).demoDb.create(name, data),
      update: async (id, data) => {
        const rec = await (await import('./demoDb.js')).demoDb.update(name, id, data);
        if (!rec) { const err = /** @type {Error & {status?: number}} */ (new Error('Request failed: 404')); err.status = 404; throw err; }
        return rec;
      },
      delete: async (id) => (await import('./demoDb.js')).demoDb.remove(name, id).then(() => null),
    };
  }
  return {
    list: (sort) => request(`/entities/${name}${buildQuery({}, sort)}`),
    filter: (query, sort) => request(`/entities/${name}${buildQuery(query, sort)}`),
    get: (id) => request(`/entities/${name}/${id}`),
    create: (data) =>
      request(`/entities/${name}`, { method: 'POST', body: JSON.stringify(data) }),
    // 106-09 (105-20): opts.stand = updated_date the write builds on; the server refuses an outdated base with 409
    update: (id, data, opts) =>
      request(`/entities/${name}/${id}${opts?.stand ? `?stand=${encodeURIComponent(opts.stand)}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => request(`/entities/${name}/${id}`, { method: 'DELETE' }),
  };
}

/**
 * The six methods every entity client offers (express, demo and cloud alike).
 * @typedef {object} EntityClient
 * @property {(sort?: string) => Promise<any[]>} list
 * @property {(query?: Record<string, any>, sort?: string) => Promise<any[]>} filter
 * @property {(id: string) => Promise<any>} get
 * @property {(data: Record<string, any>) => Promise<any>} create
 * @property {(id: string, data: Record<string, any>, opts?: {stand?: string|null}) => Promise<any>} update
 *   opts.stand (106-09; for bitApi.personal since 112-01): ISO updated_date of the base; an outdated base answers 409
 *   (err.status, err.data.gespeichert). Only the express path checks it.
 *   The serverless path (demoDb / personalDb) ignores it and has NO conflict check across tabs: IndexedDB belongs to the
 *   origin and is shared by every tab of the browser, so two tabs of the same browser are two writers and the last write
 *   wins between them (personalDb.js reads the store on every call, so a tab never writes from a stale cache, but a
 *   concurrent edit in the other tab is still overwritten). Left open on purpose: the serverless edition has one person
 *   at one device; a cross-tab check (Web Locks / BroadcastChannel) would be a plan of its own.
 *   The cloud path (supabase) ignores it too: records are written row-wise under RLS by the one owner (see the E-20 note
 *   in umgebung.js) and HR entities never go there (PERSONAL_NUR_LOKAL) — a conflict check there belongs to phase 74.
 *   No HR form passes stand yet (MitarbeiterFormular, GehaltsVerlauf …): until they do, personal writes stay
 *   last-write-wins on the express path as well.
 * @property {(id: string) => Promise<any>} delete
 */

// Lazily create entity clients on first access so any entity name works.
// 87-09: typed as a record so `bitApi.entities.Project.filter(…)` type-checks
// (the Proxy itself has type `{}`, which made every entity access a tsc error).
/** @type {Record<string, EntityClient>} */
const entities = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined;
      if (!target[prop]) target[prop] = entityClient(prop);
      return target[prop];
    },
  }
);

// --- Personal (80-02, D-P80-A #2): the ONE namespace for HR entities --------
// Mirrors entityClient's three-way split, but each branch is spelled out here
// (not delegated to entityClient) so the compile-time DATENQUELLE==='supabase'
// guard sits directly before its dynamic import — the same tree-shaking rule
// as the top of this file: a function call ahead of the guard would keep
// personalDb.js reachable from the cloud bundle even though it is never used
// there. Spiegelt personalWeg() (personalEntitaeten.js) inline.
function personalEntityClient(name) {
  if (DATENQUELLE === 'supabase') {
    const gesperrt = async () => { throw new Error(PERSONAL_NUR_LOKAL); };
    return { list: gesperrt, filter: gesperrt, get: gesperrt, create: gesperrt, update: gesperrt, delete: gesperrt };
  }
  if (DEMO) {
    return {
      list: async (sort) => (await import('./personalDb.js')).personalDb.list(name, sort),
      filter: async (query, sort) => (await import('./personalDb.js')).personalDb.filter(name, query, sort),
      get: async (id) => {
        const rec = await (await import('./personalDb.js')).personalDb.get(name, id);
        if (!rec) { const err = /** @type {any} */ (new Error('Request failed: 404')); err.status = 404; throw err; }
        return rec;
      },
      create: async (data) => (await import('./personalDb.js')).personalDb.create(name, data),
      update: async (id, data) => {
        const rec = await (await import('./personalDb.js')).personalDb.update(name, id, data);
        if (!rec) { const err = /** @type {any} */ (new Error('Request failed: 404')); err.status = 404; throw err; }
        return rec;
      },
      delete: async (id) => (await import('./personalDb.js')).personalDb.remove(name, id).then(() => null),
    };
  }
  return {
    list: (sort) => request(`/personal/${name}${buildQuery({}, sort)}`),
    filter: (query, sort) => request(`/personal/${name}${buildQuery(query, sort)}`),
    get: (id) => request(`/personal/${name}/${id}`),
    create: (data) => request(`/personal/${name}`, { method: 'POST', body: JSON.stringify(data) }),
    // 112-01 (foreign review point 3): opts.stand like the entity route (106-09) — the server answers 409 when the stored
    // record is newer than the base the write was built on (personalRouter.js uses the same standVeraltet check).
    update: (id, data, opts) =>
      request(`/personal/${name}/${id}${opts?.stand ? `?stand=${encodeURIComponent(opts.stand)}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => request(`/personal/${name}/${id}`, { method: 'DELETE' }),
  };
}

/** Every method rejects — `prop` is not one of PERSONAL_ENTITAETEN. */
function abgelehnterPersonalClient(prop) {
  const gesperrt = async () => { throw new Error(`"${prop}" ist keine Personal-Entität.`); };
  return { list: gesperrt, filter: gesperrt, get: gesperrt, create: gesperrt, update: gesperrt, delete: gesperrt };
}

/** @type {Record<string, EntityClient>} */
const personalEntities = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined;
      if (!target[prop]) target[prop] = istPersonalEntitaet(prop) ? personalEntityClient(prop) : abgelehnterPersonalClient(prop);
      return target[prop];
    },
  }
);

/** File payloads (Personaldokument's datei_ref) — bitApi.personal.dateien, the HR-only counterpart of bitApi.blobs. */
const personalDateien = {
  put: async (id, datei) => {
    if (DATENQUELLE === 'supabase') throw new Error(PERSONAL_NUR_LOKAL);
    if (DEMO) return (await import('./personalDb.js')).personalDb.dateien.put(id, datei);
    return request(`/personal-dateien/${id}`, { method: 'PUT', body: JSON.stringify(datei) });
  },
  get: async (id) => {
    if (DATENQUELLE === 'supabase') throw new Error(PERSONAL_NUR_LOKAL);
    if (DEMO) return (await import('./personalDb.js')).personalDb.dateien.get(id);
    return request(`/personal-dateien/${id}`);
  },
  delete: async (id) => {
    if (DATENQUELLE === 'supabase') throw new Error(PERSONAL_NUR_LOKAL);
    if (DEMO) return (await import('./personalDb.js')).personalDb.dateien.delete(id);
    return request(`/personal-dateien/${id}`, { method: 'DELETE' });
  },
};

/** @type {Record<string, EntityClient> & { dateien: typeof personalDateien }} */
const personal = new Proxy(
  /** @type {any} */ ({}),
  {
    get: (_target, prop) => {
      if (prop === 'dateien') return personalDateien;
      if (typeof prop !== 'string') return undefined;
      return personalEntities[prop];
    },
  }
);

// Blobs (57-02): ONE data layer for the big payloads — the AVA import's
// putBlob goes through here (projectImport.js) instead of its own fetch to
// /blobs/:id. Supabase-Zweig: privater Bucket, Pfad <org>/<id>.json (57-01).
// Serverless branch (review correction #3): the browser's IndexedDB has NO
// blob path — a plain-text error instead of a second storage path. The desktop
// client's file storage has one (70-03), reached through demoDb.blobSpeicher().
const BLOB_DEMO_FEHLT = 'Blobs sind in der lokalen Fassung nicht verfügbar (kein Blob-Speicher im Browser).';
/**
 * Blob store of the serverless path: the desktop client's file storage has one
 * (70-03, one file per blob in the storage folder); the browser PWA has none.
 * @returns {Promise<{put: Function, get: Function, delete: Function}>}
 */
async function serverlosBlobs() {
  const speicher = (await import('./demoDb.js')).blobSpeicher();
  if (!speicher) throw new Error(BLOB_DEMO_FEHLT);
  return speicher;
}
const blobs = {
  async put(id, json) {
    if (DATENQUELLE === 'supabase') return (await ladeSupabaseDb()).blobsSupabase.put(id, json);
    if (DEMO) return (await serverlosBlobs()).put(id, json);
    return request(`/blobs/${id}`, { method: 'PUT', body: JSON.stringify(json) });
  },
  async get(id) {
    if (DATENQUELLE === 'supabase') return (await ladeSupabaseDb()).blobsSupabase.get(id);
    if (DEMO) return (await serverlosBlobs()).get(id);
    return request(`/blobs/${id}`);
  },
  async delete(id) {
    if (DATENQUELLE === 'supabase') return (await ladeSupabaseDb()).blobsSupabase.delete(id);
    if (DEMO) return (await serverlosBlobs()).delete(id);
    return request(`/blobs/${id}`, { method: 'DELETE' });
  },
};

const auth = {
  me: async () => {
    if (DATENQUELLE === 'supabase') return (await ladeSupabaseDb()).authSupabase.me();
    return DEMO ? (await import('./demoDb.js')).demoUser() : request('/auth/me');
  },
  // Express/serverless have no real auth flow — no-ops kept for API compatibility.
  // The supabase branch signs out for real; AuthContext listens to
  // onAuthStateChange and routes back to /anmeldung (57-02 Task 4).
  logout: async () => {
    if (DATENQUELLE === 'supabase') return (await ladeSupabaseDb()).authSupabase.logout();
  },
  redirectToLogin: () => {
    // Cloud build uses BrowserRouter (review correction #1) — a plain path, no
    // hash. Serverless builds never reach this branch (no-op as before).
    if (DATENQUELLE === 'supabase' && typeof window !== 'undefined') {
      window.location.assign('/anmeldung');
    }
  },
};

/**
 * The fetch drop-in for the INTEGRATION routes (57-04 Task 5) — everything
 * that used to be an Express-only path: /integrations/invoke-llm, /llm/*,
 * /prices/*, /weather|elevation|climate|osm-*.
 *
 *   supabase  → supabaseDb.cloudFetch: the ONE path→function table
 *               (funktionAusPfad) translates to functions.invoke; the JWT is
 *               attached by supabase-js. Unknown path → plain-text Error.
 *   serverlos → plain fetch: the client build has no API, callers show their
 *               own offline text (the fixed demo answers went with the demo, 83-02).
 *   express   → plain fetch with the caller's path — unchanged.
 *
 * Callers pass the SAME path they pass today ('/api/weather?…' or
 * `${API_BASE}/weather`); the supabase branch normalizes the /api prefix.
 * Returns a real Response, so `r.ok` / `await r.json()` code stays untouched.
 *
 * @param {string|URL} pfad Express-style API path (query allowed)
 * @param {RequestInit} [optionen] fetch options (method, body, signal, …)
 * @returns {Promise<Response>}
 */
export async function apiFetch(pfad, optionen = {}) {
  if (DATENQUELLE === 'supabase') {
    // cloudFetch takes the same RequestInit surface (its JSDoc is wider than
    // the old narrow shape — body may be string or object there).
    return (await ladeSupabaseDb()).cloudFetch(String(pfad), optionen);
  }
  return fetch(pfad, optionen);
}

// 80-02: `personal` is the ONE namespace for HR entities — bitApi.entities
// rejects them (see entityClient above), bitApi.personal is the only way in.
export const bitApi = { entities, personal, auth, blobs, apiFetch };
