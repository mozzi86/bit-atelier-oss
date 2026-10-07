// supabaseDb.js — the cloud data path behind bitApi (Phase 57-02, D-P57-02).
//
// The `entityClient`-level adapter: every method is a row-wise PostgREST call
// against the generic `records` table (57-01 migration 0001), RLS filters
// server-side by org membership. No collection cache — that was the single-user
// semantics that disqualified candidate A (Research §2).
//
// Contract (57-02 <interfaces>): the six methods return the SAME shapes the
// Express and DEMO branches of bitApi return — arrays of client records
// {id, created_date, updated_date, ...fields}, get/update reject with an Error
// carrying status 404, delete resolves null. Mapping lives in abfrage.js (pure,
// shared with the 57-03 import — one truth).
//
// Errors: PostgREST/Storage/Auth errors become Error objects with .status;
// 401/403 get the plain-text message "Anmeldung abgelaufen — bitte neu
// anmelden" (project rule: never lose a write silently, never swallow).
//
// This module is imported dynamically by bitApi.js ONLY when
// DATENQUELLE === 'supabase', so supabase-js tree-shakes out of demo/lokal.

import { supabaseClient } from './supabaseClient.js';
import {
  sortNachPostgrest,
  filterNachPostgrest,
  datensatzAusZeile,
  zeileAusDatensatz,
} from './abfrage.js';

/** Plain-text message for every auth failure — users must know why nothing saved. */
const AUTH_MELDUNG = 'Anmeldung abgelaufen — bitte neu anmelden';

/**
 * Error class carrying an HTTP-ish status (and optional PostgREST code) so
 * every layer can branch on .status without property-assigning onto Error
 * (checkJs-friendly; same contract bitApi's branches expose: err.status).
 */
class ApiFehler extends Error {
  /**
   * @param {string} message plain-text message (German where user-facing)
   * @param {number} status HTTP status to mimic (401/403/404/500)
   * @param {string} [code] PostgREST error code, if any
   */
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiFehler';
    this.status = status;
    this.code = code ?? '';
  }
}

/**
 * Converts any supabase error into a thrown ApiFehler with .status.
 * PostgREST error codes: PGRST3xx = JWT/session problems → 401;
 * 42501/42502 = RLS violations → 403 (a member never sees these — RLS
 * filters instead; they mean "not a member" or an expired token).
 * @param {{ message?: string, code?: string, details?: string, status?: number,
 *   statusCode?: string, errorCode?: string, error?: string }} error
 * @param {string} kontext what was attempted (plain text, for the console)
 * @throws {ApiFehler} never returns
 */
function wirf(error, kontext) {
  const code = String(error?.code || error?.errorCode || '');
  const meldung = error?.message || error?.error || error?.details || 'Unbekannter Fehler';
  let status = Number(error?.status || error?.statusCode) || 500;
  let message = `${kontext}: ${meldung}`;
  if (/^PGRST3\d\d$/.test(code)) status = 401;
  if (code === '42501' || code === '42502') status = 403;
  if (status === 401 || status === 403) {
    // Session problem: the actionable message wins, the technical detail rides
    // along in parentheses for the console/support.
    message = `${AUTH_MELDUNG} (${kontext}: ${meldung})`;
  }
  throw new ApiFehler(message, status, code);
}

/**
 * "Row not found" — mirrors the Express branch (status 404).
 * @param {string} what entity/id description for the message
 * @returns {ApiFehler}
 */
function nichtGefunden(what) {
  return new ApiFehler(`Request failed: 404 (${what})`, 404);
}

/** Columns selected for every records query — one spelling, one place. */
const SPALTEN = 'id, entity, org_id, data, created_date, updated_date';

/**
 * Builds the base query for an entity, always scoped by entity name AND the
 * caller's org (defense in depth — RLS filters anyway, but without the org_id
 * predicate a member of two orgs would see both orgs' rows of one entity).
 *
 * NOT async: PostgREST builders are thenable — awaiting one fires the query
 * immediately and you can no longer chain .filter/.order onto it. The org id
 * must be awaited by the CALLER, this function returns the chainable builder.
 * @param {string} entity entity name (e.g. "Project")
 * @param {string} org org uuid (defense in depth, see above)
 * @param {{ count?: 'exact', head?: boolean }} [selectOpts]
 * @returns {any} chainable PostgrestFilterBuilder (await only at the very end)
 */
function basis(entity, org, selectOpts) {
  return supabaseClient()
    .from('records')
    .select(SPALTEN, selectOpts)
    .eq('entity', entity)
    .eq('org_id', org);
}

/**
 * Applies the abfrage.js sort description to a PostgREST builder.
 * Nulls last in BOTH directions — db.js:104-106 sorts null after values
 * regardless of asc/desc; Postgres' default for DESC is NULLS FIRST, so the
 * flag must follow the direction explicitly.
 * @param {any} q PostgREST builder
 * @param {string|undefined} sortStr bitApi sort string
 * @returns {any} the builder with .order applied (or unchanged)
 */
function sortAnwenden(q, sortStr) {
  const sort = sortNachPostgrest(sortStr);
  if (!sort) return q;
  return q.order(sort.spalte, {
    ascending: sort.aufsteigend,
    nullsFirst: !sort.aufsteigend,
  });
}

/**
 * The entity client for the supabase path — same six methods as the DEMO and
 * Express branches of bitApi.js.
 * @param {string} name entity name, e.g. "Project"
 * @returns {{ list: (sort?: string) => Promise<object[]>,
 *   filter: (query?: object, sort?: string) => Promise<object[]>,
 *   get: (id: string) => Promise<object>,
 *   create: (data: object) => Promise<object>,
 *   update: (id: string, data: object) => Promise<object>,
 *   delete: (id: string) => Promise<{ success: true }> }}
 */
export function entityClientSupabase(name) {
  return {
    async list(sort) {
      const org = await authSupabase.aktuelleOrgId();
      const { data, error } = await sortAnwenden(basis(name, org), sort);
      if (error) wirf(error, `list ${name}`);
      return (data || []).map(datensatzAusZeile);
    },

    async filter(query, sort) {
      const org = await authSupabase.aktuelleOrgId();
      let q = basis(name, org);
      // Every query field is a text equality on the jsonb payload (abfrage.js)
      // — undefined/null values are already dropped there.
      for (const [spalte, wert] of filterNachPostgrest(query)) {
        // spalte is 'data->>field' — PostgREST accepts it as a column expression.
        q = q.filter(spalte, 'eq', wert);
      }
      const { data, error } = await sortAnwenden(q, sort);
      if (error) wirf(error, `filter ${name}`);
      return (data || []).map(datensatzAusZeile);
    },

    async get(id) {
      const org = await authSupabase.aktuelleOrgId();
      const { data, error } = await supabaseClient()
        .from('records')
        .select(SPALTEN)
        .eq('entity', name)
        .eq('org_id', org)
        .eq('id', id)
        .maybeSingle();
      if (error) wirf(error, `get ${name}/${id}`);
      // maybeSingle: null = not found → 404 with status, like the DEMO branch.
      if (!data) throw nichtGefunden(`${name}/${id}`);
      return datensatzAusZeile(data);
    },

    async create(datensatz) {
      const org = await authSupabase.aktuelleOrgId();
      const { data: user } = await supabaseClient().auth.getUser();
      // RLS insert-policy enforces created_by = auth.uid() (57-01/0002) —
      // set here so the policy sees the caller, not null.
      const zeile = {
        ...zeileAusDatensatz(name, org, datensatz),
        created_by: user?.user?.id ?? null,
      };
      const { data, error } = await supabaseClient()
        .from('records')
        .insert(zeile)
        .select(SPALTEN)
        .single();
      if (error) wirf(error, `create ${name}`);
      return datensatzAusZeile(data);
    },

    async update(id, datensatz) {
      // Merge semantics like db.js update (shallow merge, id immutable):
      // read the row, merge the payload into the jsonb, write back. A single
      // `jsonb ||` RPC was considered (57-02 <interfaces>) and deferred until
      // a measurement shows the extra round trip hurts.
      const vorhandene = await this.get(id); // throws 404 like Express
      const gemergt = { ...vorhandene, ...datensatz, id };
      // updated_date is set by the DB trigger (57-01/0001) — never from here.
      const { id: _i, created_date: _c, updated_date: _u, ...nurData } = gemergt;
      const { data, error } = await supabaseClient()
        .from('records')
        .update({ data: nurData })
        .eq('id', id)
        .eq('entity', name)
        .select(SPALTEN)
        .single();
      if (error) wirf(error, `update ${name}/${id}`);
      return datensatzAusZeile(data);
    },

    async delete(id) {
      const { error } = await supabaseClient()
        .from('records')
        .delete()
        .eq('id', id)
        .eq('entity', name);
      if (error) wirf(error, `delete ${name}/${id}`);
      // The Express branch returns { success: true } (routes.js:94) — the
      // supabase branch returns the same shape so callers never branch on the
      // data path.
      return { success: true };
    },
  };
}

/** Cached org id — stage 1 has exactly one membership (D-P57-04). */
let orgCache = null;

/** Auth surface for the supabase path (bitApi.auth.* equivalent). */
export const authSupabase = {
  /**
   * The current user in the Express DEV_USER-compatible shape, so no page has
   * to branch on the data path.
   * @returns {Promise<{ id: string, full_name: string, email: string, role: string }>}
   * @throws {ApiFehler} with status 401 when there is no session
   */
  async me() {
    const { data, error } = await supabaseClient().auth.getUser();
    if (error) wirf(error, 'auth.me');
    const user = data?.user;
    if (!user) throw new ApiFehler(AUTH_MELDUNG, 401);
    // Role from the org membership (57-01: 'admin'|'mitglied'); own rows only,
    // per the org_members select policy.
    const { data: mitgliedschaft } = await supabaseClient()
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    return {
      id: user.id,
      full_name: user.user_metadata?.full_name || user.email || 'Nutzer',
      email: user.email || '',
      role: mitgliedschaft?.role || 'mitglied',
    };
  },

  async logout() {
    const { error } = await supabaseClient().auth.signOut();
    // signOut errors are session-only (token already gone) — report, don't
    // block the UI logout; AuthContext clears its own state regardless.
    if (error) console.error('Supabase signOut:', error.message);
    orgCache = null;
  },

  /**
   * Route to the in-app login page (App.jsx renders it outside the auth gate).
   * The cloud build runs BrowserRouter (57-02 review correction #1) — a plain
   * path, no hash. Kept in sync with bitApi.auth.redirectToLogin.
   */
  redirectToLogin() {
    if (typeof window !== 'undefined') window.location.assign('/anmeldung');
  },

  /**
   * The org this user works in — stage 1: the FIRST membership (D-P57-04,
   * multiple orgs are stage 2). Cached per session; logout clears it.
   * @returns {Promise<string>} org uuid
   * @throws {Error} status 401 without session, 403 without membership —
   *   plain text, because every data call depends on this.
   */
  async aktuelleOrgId() {
    if (orgCache) return orgCache;
    const { data: session } = await supabaseClient().auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) throw new ApiFehler(AUTH_MELDUNG, 401);
    const { data, error } = await supabaseClient()
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) wirf(error, 'aktuelleOrgId');
    if (!data?.org_id) {
      throw new ApiFehler(
        'Keinem Büro zugeordnet — bitte den Administrator kontaktieren (Einladung fehlt).',
        403,
      );
    }
    orgCache = data.org_id;
    return orgCache;
  },

  /** Clears the org cache (tests, account switch). */
  orgCacheLeeren() { orgCache = null; },
};

// --- 57-04 Task 5: path prefix → Edge Function — the ONE routing table -------
//
// In the cloud there is no Express server: the routes that used to live in
// packages/*/server/routes.js are the three Edge Functions (llm, geo, preise).
// Client callers keep their old paths (/llm/connections, /weather?lat=…, …) —
// this table translates ONE place, and bitApi.apiFetch/request consult it.
// An unknown path is a plain-text error, never a silent 404 (project rule).

/** The geo services the `geo` function answers (designer/server/routes.js). */
const GEO_DIENSTE = ['weather', 'elevation', 'climate', 'osm-buildings', 'osm-environment'];

/**
 * Maps an Express-style API path (+ method) onto an Edge Function invoke.
 * PURE — unit-testable under node without any supabase import at runtime.
 *
 * @param {string} pfad e.g. '/llm/connections/abc', '/api/weather?lat=1' or a full URL
 * @param {{ method?: string, body?: string }} [optionen] fetch-style options
 * @returns {{ funktion: string, invokeName: string, invokeOptionen: { method: string, body?: object } }|null}
 *   null = no cloud route for this path (caller decides: error or plain fetch)
 */
export function funktionAusPfad(pfad, optionen = {}) {
  // Normalize: full URL → pathname+search; '/api/x' → '/x' (the Express proxy
  // prefix does not exist in the cloud).
  let p = String(pfad);
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    p = u.pathname + u.search;
  }
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '/';
  const [nurPfad, query = ''] = p.split('?');
  // fetch default is GET; all our POST callers pass method explicitly.
  const methode = String(optionen.method || 'GET').toUpperCase();
  // Every caller JSON.stringifies its body — parse defensively.
  let body = {};
  if (optionen.body) {
    try { body = JSON.parse(String(optionen.body)); } catch { body = {}; }
  }

  // --- llm (routes.js llmRouter → functions/llm) ---
  if (nurPfad === '/integrations/invoke-llm' && methode === 'POST') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'invoke', ...body } } };
  }
  if (nurPfad === '/llm/connections' && methode === 'GET') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'connections.list' } } };
  }
  if (nurPfad === '/llm/connections' && methode === 'POST') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'connections.create', ...body } } };
  }
  const connId = nurPfad.match(/^\/llm\/connections\/([^/]+)$/);
  if (connId && methode === 'PUT') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'connections.update', id: decodeURIComponent(connId[1]), ...body } } };
  }
  if (connId && methode === 'DELETE') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'connections.delete', id: decodeURIComponent(connId[1]) } } };
  }
  if (nurPfad === '/llm/test' && methode === 'POST') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'test', ...body } } };
  }
  if (nurPfad === '/llm/defaults' && methode === 'GET') {
    return { funktion: 'llm', invokeName: 'llm', invokeOptionen: { method: 'POST', body: { aktion: 'defaults' } } };
  }

  // --- preise (ausschreibung/routes.js pricesRouter → functions/preise) ---
  if (nurPfad === '/prices/ted-search' && methode === 'POST') {
    return { funktion: 'preise', invokeName: 'preise', invokeOptionen: { method: 'POST', body: { aktion: 'ted-search', ...body } } };
  }

  // --- geo (designer/routes.js → functions/geo) — GET keeps its query string.
  // functions.invoke builds `${functionsUrl}/${name}`, so the query rides
  // along IN the name ('geo?dienst=weather&lat=…') — the URL API parses it.
  const geoDienst = nurPfad.match(/^\/([a-z-]+)$/);
  if (geoDienst && GEO_DIENSTE.includes(geoDienst[1]) && methode === 'GET') {
    const parameter = new URLSearchParams(query);
    parameter.set('dienst', geoDienst[1]);
    return {
      funktion: 'geo',
      invokeName: `geo?${parameter.toString()}`,
      invokeOptionen: { method: 'GET' },
    };
  }

  return null;
}

/**
 * Calls an Edge Function and returns a REAL Response, so every caller keeps
 * its `r.ok` / `await r.json()` code unchanged.
 *
 * Error mapping: FunctionsHttpError carries the function's own Response in
 * `.context` (status + { error } body survive); relay/network errors throw a
 * plain-text Error like fetch does on a network failure.
 *
 * @param {string} pfad Express-style path (see funktionAusPfad)
 * @param {RequestInit & { body?: string | object }} [optionen] fetch options;
 *   body is normally the JSON.stringify'd string callers pass today, an
 *   object is accepted too (funktionAusPfad normalizes both)
 * @returns {Promise<Response>}
 * @throws {Error} plain text for unknown routes ('Route im Cloud-Modus nicht
 *   verfügbar: …') and unreachable functions
 */
export async function cloudFetch(pfad, optionen = {}) {
  const route = funktionAusPfad(pfad, optionen);
  if (!route) {
    throw new Error(`Route im Cloud-Modus nicht verfügbar: ${pfad}`);
  }
  // Cast: the built FunctionInvokeOptions type is narrower than what invoke
  // actually accepts at runtime (method/body/signal are all real options);
  // the repo has no generated Database types yet (see _shared/auth.ts note).
  const { data, error } = await supabaseClient().functions.invoke(route.invokeName, /** @type {any} */ ({
    ...route.invokeOptionen,
    ...(optionen.signal ? { signal: optionen.signal } : {}),
  }));
  if (error) {
    // FunctionsHttpError: the function answered (4xx/5xx) — hand its Response
    // straight through so status and { error } body reach the caller.
    if (error.name === 'FunctionsHttpError' && error.context instanceof Response) {
      return error.context;
    }
    // Relay/network: fetch would have thrown a TypeError — mirror that shape
    // with a plain-text German message (project rule: never swallow).
    throw new Error(`Cloud-Funktion „${route.funktion}" nicht erreichbar: ${error.message}`);
  }
  // Success: invoke already parsed the JSON payload. The function's own status
  // (201 on create) is not exposed by invoke — callers only read the body, so
  // a plain 200 Response is the honest container here.
  return new Response(JSON.stringify(data ?? null), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Blob storage for the supabase path: private bucket `blobs`, object path
 * `<org_id>/<id>.json` (57-01/0003 policies enforce exactly that shape).
 * Same surface bitApi.blobs exposes on every path.
 */
export const blobsSupabase = {
  /**
   * Writes JSON into the org's blob folder (upsert — same id overwrites).
   * @param {string} id blob id (whitelist [A-Za-z0-9_-], enforced by policy)
   * @param {object} json payload
   * @returns {Promise<{ id: string }>}
   */
  async put(id, json) {
    const org = await authSupabase.aktuelleOrgId();
    const { error } = await supabaseClient().storage
      .from('blobs')
      .upload(`${org}/${id}.json`, JSON.stringify(json), {
        upsert: true,
        contentType: 'application/json',
      });
    if (error) wirf(error, `blob put ${id}`);
    return { id };
  },

  /**
   * Reads a blob; missing object → null (mirrors the Express branch:
   * blobs.get returns null for "not there", routes.js:262 answers 404 — the
   * client-side contract is null, callers show their empty state).
   * @param {string} id blob id
   * @returns {Promise<object|null>} parsed JSON or null
   */
  async get(id) {
    const org = await authSupabase.aktuelleOrgId();
    const { data, error } = await supabaseClient().storage
      .from('blobs')
      .download(`${org}/${id}.json`);
    if (error) {
      // Storage "not found" arrives as error code '400' with a not-found
      // message — map that to null, everything else stays a loud error.
      const msg = String(error.message || '');
      if (/not found|Object not found/i.test(msg)) return null;
      wirf(error, `blob get ${id}`);
    }
    const text = await data.text();
    return JSON.parse(text);
  },

  /**
   * Deletes a blob; missing object is not an error (mirrors Express: the
   * store answers { deleted: false }).
   * @param {string} id blob id
   * @returns {Promise<{ deleted: boolean }>}
   */
  async delete(id) {
    const org = await authSupabase.aktuelleOrgId();
    const { error } = await supabaseClient().storage
      .from('blobs')
      .remove([`${org}/${id}.json`]);
    if (error) wirf(error, `blob delete ${id}`);
    return { deleted: true };
  },
};
