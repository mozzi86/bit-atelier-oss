// llmLokal.js — server half of "local AI as a first-class option" (plan 93-12).
//
//   1. KiEinstellung: ONE row in the JSON db with the AI switches (nur_lokal, harness_autostart, the
//      local server URLs, the last benchmark, an updated model catalog). Locked from the generic CRUD
//      (routes.js) — changed only through PUT /api/llm/einstellungen, which validates every field.
//   2. "Nur lokale KI": `nurLokalPruefen(url, nurLokal)` throws a 403 error with a plain German sentence
//      for every target that is not on this computer. llm.js calls it before any model request,
//      routes.js before /llm/test and /llm/modelle.
//   3. HTTP to loopback targets via node:http instead of fetch: Node's fetch (undici) gives up after
//      300 s without response headers, and a 27 B model on a 10 GB card needs minutes for the first
//      answer (loading + prompt processing). The timeout here is ours: LOKAL_TIMEOUT_MS.
//   4. Model discovery: GET /v1/models (LM Studio, OpenAI-compatible) or /api/tags (Ollama).
//
// In:  db store, connection rows, URLs. Out: settings objects, Response-like objects, model lists.

import http from 'node:http';
import https from 'node:https';
import {
  istLoopbackUrl, modellListenUrl, modelleAusAntwort, lokalerFehlerText, nurLokalMeldung,
  OLLAMA_STANDARD_URL, LMSTUDIO_STANDARD_URL,
} from '../src/lib/kiLokal.js';

/** Entity name of the settings row. */
export const KI_EINSTELLUNG_ENTITY = 'KiEinstellung';

/**
 * Timeout for one request to a LOCAL model, milliseconds. Default 15 min [ASSUMED]: a 27 B model
 * partly offloaded to the CPU answers a long prompt in several minutes; anything beyond a quarter of
 * an hour is a hang, not a slow model. Override: BIT_LOKAL_TIMEOUT_S (seconds, 30…7200).
 * @param {Record<string, string|undefined>} [env]
 * @returns {number}
 */
export function lokalTimeoutMs(env = process.env) {
  const s = Number(env.BIT_LOKAL_TIMEOUT_S);
  return Number.isFinite(s) && s >= 30 && s <= 7200 ? s * 1000 : 15 * 60 * 1000;
}

/**
 * @typedef {object} KiEinstellungen
 * @property {boolean} nur_lokal only loopback AI targets are allowed
 * @property {boolean} harness_autostart start the Python harness together with the server
 * @property {boolean} bilder_extern 106-06 (D-IM-02): images of the view may go to a model outside this computer (default true; per project
 *   a consent is still needed, NDA projects never send). Office-wide off switch.
 * @property {string} ollama_url base URL of the Ollama server (loopback only)
 * @property {string} lmstudio_url base URL of LM Studio's OpenAI-compatible server (loopback only)
 * @property {{modell: string, tokenProSekunde: number, ersteAntwortMs: number, datum: string}|null} benchmark
 * @property {object|null} katalog an updated model catalog (validated), null = bundled one
 */

/** @type {KiEinstellungen} */
export const STANDARD_EINSTELLUNGEN = Object.freeze({
  nur_lokal: false,
  harness_autostart: false,
  bilder_extern: true,
  ollama_url: OLLAMA_STANDARD_URL,
  lmstudio_url: LMSTUDIO_STANDARD_URL,
  benchmark: null,
  katalog: null,
});

/**
 * Current settings (defaults for missing fields).
 * @param {{ list: (entity: string) => any[] }|null|undefined} db
 * @returns {KiEinstellungen & {id?: string}}
 */
export function kiEinstellungenLesen(db) {
  let zeile = null;
  try { zeile = db ? db.list(KI_EINSTELLUNG_ENTITY)[0] || null : null; } catch { zeile = null; }
  return { ...STANDARD_EINSTELLUNGEN, ...(zeile || {}) };
}

/**
 * Validate and store a settings patch. Unknown fields are ignored.
 * @param {{ list: (e: string) => any[], create: (e: string, r: object) => any, update: (e: string, id: string, p: object) => any }} db
 * @param {Record<string, unknown>} patch fields to change
 * @returns {KiEinstellungen} the stored settings
 * @throws {Error & {status: number}} 400 with a German sentence for an invalid value
 */
export function kiEinstellungenSchreiben(db, patch) {
  /** @type {Record<string, unknown>} */
  const sauber = {};
  const fehler = (text) => Object.assign(new Error(text), { status: 400 });
  for (const feld of ['nur_lokal', 'harness_autostart', 'bilder_extern']) {
    if (patch[feld] === undefined) continue;
    if (typeof patch[feld] !== 'boolean') throw fehler(`${feld} muss true oder false sein`);
    sauber[feld] = patch[feld];
  }
  for (const feld of ['ollama_url', 'lmstudio_url']) {
    if (patch[feld] === undefined) continue;
    const url = String(patch[feld] ?? '').trim().replace(/\/+$/, '');
    // Only this computer: the setup path talks to these servers without asking (detection, pull).
    if (!istLoopbackUrl(url)) throw fehler(`${feld}: nur Adressen auf diesem Rechner (127.0.0.1, localhost, ::1) sind erlaubt`);
    sauber[feld] = url;
  }
  if (patch.benchmark !== undefined) sauber.benchmark = patch.benchmark;
  if (patch.katalog !== undefined) sauber.katalog = patch.katalog;
  const alt = db.list(KI_EINSTELLUNG_ENTITY)[0];
  const zeile = alt ? db.update(KI_EINSTELLUNG_ENTITY, alt.id, sauber) : db.create(KI_EINSTELLUNG_ENTITY, { ...STANDARD_EINSTELLUNGEN, ...sauber });
  return { ...STANDARD_EINSTELLUNGEN, ...zeile };
}

/**
 * Refuse a non-loopback target while "Nur lokale KI" is on.
 * @param {string} url target URL ('' = no connection, i.e. a cloud fallback would be used)
 * @param {boolean} nurLokal the switch
 * @throws {Error & {status: number, nurLokal: true}} 403 with a plain German sentence
 */
export function nurLokalPruefen(url, nurLokal) {
  if (!nurLokal) return;
  if (url && istLoopbackUrl(url)) return;
  throw Object.assign(new Error(nurLokalMeldung(url)), { status: 403, nurLokal: true });
}

/**
 * Minimal fetch-like response.
 * @typedef {{ ok: boolean, status: number, text: () => Promise<string>, json: () => Promise<any> }} Antwort
 */

/**
 * HTTP request via node:http/https with an explicit timeout (no undici 300 s header limit).
 * The timeout covers the whole request including the body. Network errors keep their `code`
 * (ECONNREFUSED …) so lokalerFehlerText can explain them.
 * @param {string} url absolute URL
 * @param {{ method?: string, headers?: Record<string, string>, body?: string, timeoutMs?: number, signal?: AbortSignal }} [opt]
 *   timeoutMs in milliseconds (default lokalTimeoutMs())
 * @returns {Promise<Antwort>}
 */
export function httpAnfrage(url, opt = {}) {
  const ziel = new URL(url);
  const modul = ziel.protocol === 'https:' ? https : http;
  const timeoutMs = opt.timeoutMs ?? lokalTimeoutMs();
  return new Promise((resolve, reject) => {
    const req = modul.request(ziel, {
      method: opt.method || 'GET',
      headers: { ...(opt.headers || {}), ...(opt.body != null ? { 'content-length': String(Buffer.byteLength(opt.body)) } : {}) },
    }, (res) => {
      const teile = [];
      res.on('data', (c) => teile.push(c));
      res.on('end', () => {
        clearTimeout(uhr);
        const text = Buffer.concat(teile).toString('utf8');
        const status = res.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      });
      res.on('error', (e) => { clearTimeout(uhr); reject(e); });
    });
    const abbrechen = (grund) => {
      clearTimeout(uhr);
      req.destroy(Object.assign(new Error(grund), { name: 'AbortError' }));
    };
    const uhr = setTimeout(() => abbrechen('Zeitüberschreitung'), timeoutMs);
    if (opt.signal) {
      if (opt.signal.aborted) abbrechen('Abgebrochen');
      else opt.signal.addEventListener('abort', () => abbrechen('Abgebrochen'), { once: true });
    }
    req.on('error', (e) => { clearTimeout(uhr); reject(e); });
    if (opt.body != null) req.write(opt.body);
    req.end();
  });
}

/**
 * Send a request: loopback targets through httpAnfrage (long timeout), everything else through fetch.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string, timeoutMs?: number, signal?: AbortSignal }} opt
 * @param {{ fetchFn?: typeof fetch, anfrageFn?: typeof httpAnfrage }} [deps] injectable for tests
 * @returns {Promise<Antwort>}
 */
export function senden(url, opt, deps = {}) {
  if (istLoopbackUrl(url)) return (deps.anfrageFn || httpAnfrage)(url, opt);
  const f = deps.fetchFn || fetch;
  return /** @type {Promise<Antwort>} */ (/** @type {unknown} */ (f(url, { method: opt.method, headers: opt.headers, body: opt.body, signal: opt.signal })));
}

/**
 * Fetch the model list of a connection.
 * @param {{ provider: string, base_url?: string, api_key?: string }} conn connection (base_url already resolved)
 * @param {{ nurLokal?: boolean, timeoutMs?: number, fetchFn?: typeof fetch, anfrageFn?: typeof httpAnfrage }} [opt]
 *   timeoutMs default 8000 ms — a model list is instant when the server runs
 * @returns {Promise<{ ok: boolean, modelle: string[], url: string, fehler?: string, lokal: boolean }>}
 */
export async function modelleAbrufen(conn, opt = {}) {
  const url = modellListenUrl(conn.provider, conn.base_url || '');
  const lokal = istLoopbackUrl(url);
  if (!url) return { ok: false, modelle: [], url, lokal, fehler: conn.provider === 'anthropic' ? 'Für Anthropic gibt es hier keine Modellliste — Modellnamen von Hand eintragen.' : 'Keine Basis-URL' };
  nurLokalPruefen(url, Boolean(opt.nurLokal));
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json' };
  if (conn.api_key) headers.authorization = `Bearer ${conn.api_key}`;
  const timeoutMs = opt.timeoutMs ?? 8000;
  const ctrl = new AbortController();
  const uhr = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await senden(url, { method: 'GET', headers, timeoutMs, signal: ctrl.signal }, opt);
    if (!r.ok) return { ok: false, modelle: [], url, lokal, fehler: `Modellliste: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}` };
    let json;
    try { json = await r.json(); } catch { return { ok: false, modelle: [], url, lokal, fehler: 'Modellliste ist kein JSON — ist die Basis-URL richtig?' }; }
    const modelle = modelleAusAntwort(json);
    return { ok: true, modelle, url, lokal, ...(modelle.length ? {} : { fehler: 'Server läuft, aber es ist kein Modell geladen bzw. installiert.' }) };
  } catch (err) {
    return { ok: false, modelle: [], url, lokal, fehler: lokalerFehlerText(err, { provider: conn.provider, url, timeoutS: Math.round(timeoutMs / 1000) }) };
  } finally {
    clearTimeout(uhr);
  }
}
