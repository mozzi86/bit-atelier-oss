// LLM proxy. An active LlmConnection wins; otherwise Anthropic if ANTHROPIC_API_KEY
// is set, OpenAI if OPENAI_API_KEY is set, otherwise a deterministic offline mock
// so the app stays usable.
//
// Base44's InvokeLLM returns a plain string when no schema is given, and a parsed
// object when `response_json_schema` is provided. We mirror that contract.
//
// 83-03: endpoint URLs come from ONE rule (endpunktUrl in @core/lib/kiVorlagen.js,
// shared with the connection form); default models are configurable through
// ANTHROPIC_MODEL / OPENAI_MODEL (LLM_MODEL stays as the old shared fallback).
import { endpunktUrl, chatCompletionsUrl } from '../src/lib/kiVorlagen.js';
import { geschuetzterPrompt, antwortBereinigen } from './llmSchutz.js';
// 93-12: loopback targets go through node:http with a long timeout; "Nur lokale KI" guard.
import { senden, nurLokalPruefen, lokalTimeoutMs } from './llmLokal.js';
import { istLoopbackUrl, lokalerFehlerText } from '../src/lib/kiLokal.js';
// 106-06: images of the view as context (bilder: [{png_base64}]) - checked here, the one choke point of the app server.
import { bilderPruefen, bildFreigabe, bildZielText } from '../src/lib/zeigen/bildKontext.js';
import { bildFaehig } from '../src/lib/modellKatalog.js';

export { endpunktUrl, chatCompletionsUrl };

/**
 * Default Anthropic model when neither the connection nor the environment names one.
 * [CITED] Claude Sonnet 5.5 = `claude-sonnet-5-5` (Anthropic model table, 25.09.2026).
 */
export const STANDARD_ANTHROPIC_MODELL = 'claude-sonnet-5-5';
/** Default OpenAI model (unchanged since phase 31). */
export const STANDARD_OPENAI_MODELL = 'gpt-4o-mini';

/**
 * Model for the env-key Anthropic fallback.
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 * @returns {string} ANTHROPIC_MODEL, else LLM_MODEL, else the default
 */
export function anthropicModell(env = process.env) {
  return env.ANTHROPIC_MODEL || env.LLM_MODEL || STANDARD_ANTHROPIC_MODELL;
}

/**
 * Model for the env-key OpenAI fallback.
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 * @returns {string} OPENAI_MODEL, else LLM_MODEL, else the default
 */
export function openaiModell(env = process.env) {
  return env.OPENAI_MODEL || env.LLM_MODEL || STANDARD_OPENAI_MODELL;
}

function mockResponse({ prompt = '', response_json_schema }) {
  if (response_json_schema) {
    return buildMockFromSchema(response_json_schema);
  }
  return (
    `🔧 [Offline-Modus] Es ist kein LLM-API-Schlüssel konfiguriert.\n\n` +
    `Setze ANTHROPIC_API_KEY oder OPENAI_API_KEY in der .env, um echte ` +
    `KI-Antworten zu erhalten.\n\n` +
    `Deine Anfrage war:\n"${String(prompt).slice(0, 400)}"`
  );
}

function buildMockFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.type === 'object' && schema.properties) {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out[k] = buildMockFromSchema(v);
    }
    return out;
  }
  if (schema.type === 'array') {
    return [];
  }
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  return schema.enum?.[0] ?? '';
}

/**
 * The user turn of a request, with images when there are any (106-06). Text-only requests stay byte-identical to before.
 * @param {"anthropic"|"openai"|"ollama"} stil  API dialect.
 * @param {string} text  The prompt.
 * @param {Array<{png_base64: string}>} [bilder]  Checked PNGs (bilderPruefen), base64 without data: prefix.
 * @returns {Record<string, any>}  One message object {role: "user", content, images?}.
 */
export function benutzerNachricht(stil, text, bilder = []) {
  if (!bilder.length) return { role: 'user', content: text };
  if (stil === 'anthropic') {
    // Messages dialect: image blocks before the text (the documented order for best results)
    return { role: 'user', content: [
      ...bilder.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b.png_base64 } })),
      { type: 'text', text },
    ] };
  }
  // local /api/chat dialect: base64 images in `images` next to the text content
  if (stil === 'ollama') return { role: 'user', content: text, images: bilder.map((b) => b.png_base64) };
  // Chat Completions dialect: content parts, the image as a data URL
  return { role: 'user', content: [
    { type: 'text', text },
    ...bilder.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b.png_base64}` } })),
  ] };
}

async function callAnthropic({ prompt, response_json_schema, bilder = [] }, deps = {}) {
  const sys = response_json_schema
    ? 'You are a helpful assistant. Respond ONLY with valid JSON matching the schema the user describes. No prose, no code fences.'
    : 'You are a helpful assistant specialized in construction, architecture, and project management.';
  const fullPrompt = response_json_schema
    ? `${prompt}\n\nReturn JSON conforming to this JSON schema:\n${JSON.stringify(response_json_schema)}`
    : prompt;

  const resp = await (deps.fetchFn || fetch)(ENV_ZIELE.anthropic, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: anthropicModell(),
      max_tokens: 2048,
      system: sys,
      messages: [benutzerNachricht('anthropic', fullPrompt, bilder)],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.content?.map((c) => c.text).join('') ?? '';
  return response_json_schema ? safeParse(text) : text;
}

async function callOpenAI({ prompt, response_json_schema, bilder = [] }, deps = {}) {
  const sys = response_json_schema
    ? 'You are a helpful assistant. Respond ONLY with valid JSON matching the schema the user describes.'
    : 'You are a helpful assistant specialized in construction, architecture, and project management.';
  const fullPrompt = response_json_schema
    ? `${prompt}\n\nReturn JSON conforming to this JSON schema:\n${JSON.stringify(response_json_schema)}`
    : prompt;

  const resp = await (deps.fetchFn || fetch)(ENV_ZIELE.openai, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModell(),
      messages: [
        { role: 'system', content: sys },
        benutzerNachricht('openai', fullPrompt, bilder),
      ],
      ...(response_json_schema
        ? { response_format: { type: 'json_object' } }
        : {}),
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return response_json_schema ? safeParse(text) : text;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Strip code fences / surrounding prose and retry.
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return { raw: text };
  }
}

// --- Benutzerdefinierte Verbindungen (LlmConnection) ------------------------
// Standard-Basis-URLs je Anbieter; leere base_url fällt darauf zurück.
export const PROVIDER_DEFAULTS = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  ollama: 'http://127.0.0.1:11434',
  custom: '',
};

function baseUrlFor(conn) {
  const raw = (conn.base_url || PROVIDER_DEFAULTS[conn.provider] || '').trim();
  return raw.replace(/\/+$/, '');
}

function buildPrompts({ prompt, response_json_schema }) {
  const sys = response_json_schema
    ? 'You are a helpful assistant. Respond ONLY with valid JSON matching the schema the user describes. No prose, no code fences.'
    : 'You are a helpful assistant specialized in construction, architecture, and project management.';
  const fullPrompt = response_json_schema
    ? `${prompt}\n\nReturn JSON conforming to this JSON schema:\n${JSON.stringify(response_json_schema)}`
    : prompt;
  return { sys, fullPrompt };
}

// Ruft das per LlmConnection konfigurierte Modell auf (Anthropic Messages,
// OpenAI-kompatibles Chat Completions oder Ollama /api/chat). Die Ziel-URL
// bildet endpunktUrl() (83-03) — eine Regel für alle Anbieter.
// Der API-Schlüssel wird ausschließlich hier serverseitig verwendet.
export async function callConnection(conn, params, { signal, timeoutMs, deps } = {}) {
  const url = zielUrlFuer(conn);
  if (!url) throw new Error('Keine Basis-URL konfiguriert');
  // 93-12: a local server that is not running answers with ECONNREFUSED — say so in plain German.
  try {
    return await verbindungAufrufen(conn, url, params, { signal, timeoutMs, deps });
  } catch (err) {
    if (istLoopbackUrl(url) && (err?.code || err?.cause?.code || err?.name === 'AbortError')) {
      throw new Error(lokalerFehlerText(err, { provider: conn.provider, url, timeoutS: Math.round((timeoutMs ?? lokalTimeoutMs()) / 1000) }));
    }
    throw err;
  }
}

/**
 * Endpoint URL a connection talks to (empty base → the type's default).
 * @param {{provider: string, base_url?: string}} conn
 * @returns {string} '' when no base URL can be resolved
 */
export function zielUrlFuer(conn) {
  const base = baseUrlFor(conn);
  return base ? endpunktUrl(conn.provider, base) : '';
}

async function verbindungAufrufen(conn, url, params, { signal, timeoutMs, deps }) {
  const { sys, fullPrompt } = buildPrompts(params);
  const { response_json_schema } = params;
  const bilder = Array.isArray(params.bilder) ? params.bilder : [];
  // Loopback: node:http with our own timeout (default 15 min); cloud: fetch as before.
  const post = (headers, body) => senden(url, { method: 'POST', headers, body, signal, timeoutMs }, deps);

  if (conn.provider === 'anthropic') {
    const resp = await post({
      'content-type': 'application/json',
      'x-api-key': conn.api_key || '',
      'anthropic-version': '2023-06-01',
    }, JSON.stringify({
      model: conn.model || STANDARD_ANTHROPIC_MODELL,
      max_tokens: 2048,
      system: sys,
      messages: [benutzerNachricht('anthropic', fullPrompt, bilder)],
    }));
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.content?.map((c) => c.text).join('') ?? '';
    return response_json_schema ? safeParse(text) : text;
  }

  if (conn.provider === 'ollama') {
    const resp = await post({ 'content-type': 'application/json' }, JSON.stringify({
      model: conn.model || 'llama3',
      stream: false,
      messages: [
        { role: 'system', content: sys },
        benutzerNachricht('ollama', fullPrompt, bilder),
      ],
    }));
    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.message?.content ?? '';
    return response_json_schema ? safeParse(text) : text;
  }

  // 'openai' und 'custom' → OpenAI-kompatibles Chat-Completions-API.
  const headers = { 'content-type': 'application/json' };
  if (conn.api_key) headers.authorization = `Bearer ${conn.api_key}`;
  const resp = await post(headers, JSON.stringify({
    model: conn.model || STANDARD_OPENAI_MODELL,
    messages: [
      { role: 'system', content: sys },
      benutzerNachricht('openai', fullPrompt, bilder),
    ],
  }));
  if (!resp.ok) throw new Error(`Endpoint ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return response_json_schema ? safeParse(text) : text;
}

/** Endpoints of the env-key fallbacks (no LlmConnection), so the image check knows where an image would go. */
export const ENV_ZIELE = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
});

/**
 * Where a request goes and with which model - for the image check (106-06).
 * @param {object|null} connection active LlmConnection or null
 * @param {Record<string, string|undefined>} [env]
 * @returns {{url: string, anbieter: string, modell: string}|null}  null = the offline mock (no model at all)
 */
export function anfrageZiel(connection, env = process.env) {
  if (connection) {
    const c = /** @type {any} */ (connection);
    // Review fix 106-06: without a model the request names the provider's default model, but only the provider's own host really
    // answers with it. Another server behind the same dialect (a local chat-completions server, another vendor) answers with whatever
    // model it has loaded - then the model is unknown ('') and bildFaehig refuses the image in words.
    const standardHost = baseUrlFor(c) === String(PROVIDER_DEFAULTS[c.provider] || '').replace(/\/+$/, '') && baseUrlFor(c) !== '';
    const standard = c.provider === 'anthropic' ? STANDARD_ANTHROPIC_MODELL : c.provider === 'ollama' ? 'llama3' : STANDARD_OPENAI_MODELL;
    return { url: zielUrlFuer(c), anbieter: String(c.name || c.provider || ''), modell: String(c.model || (standardHost ? standard : '')) };
  }
  if (env.ANTHROPIC_API_KEY) return { url: ENV_ZIELE.anthropic, anbieter: 'anthropic', modell: anthropicModell(env) };
  if (env.OPENAI_API_KEY) return { url: ENV_ZIELE.openai, anbieter: 'openai', modell: openaiModell(env) };
  return null;
}

/**
 * The image gate of the app server (106-06, D-IM-02): checks the images, the project (NDA, consent), the switches and whether the model
 * reads images - BEFORE any request. Throws with a German sentence and `grund`; nothing is sent then.
 * @param {Array<{png_base64: string}>} bilder  checked images (bilderPruefen)
 * @param {object|null} connection
 * @param {{ nurLokal?: boolean, bilderExtern?: boolean, projekt?: {nda?: boolean, bild_freigabe?: any}|null, katalog?: any, env?: Record<string, string|undefined> }} opt
 * @throws {Error & {status: number, grund: string}}
 */
export function bildGatter(bilder, connection, opt = {}) {
  if (!bilder.length) return;
  const fehler = (/** @type {number} */ status, /** @type {string} */ grund, /** @type {string} */ text) => Object.assign(new Error(text), { status, grund });
  // the project's own rules first: they hold whatever the target is (no project, NDA)
  const vorab = bildFreigabe({ projekt: opt.projekt ?? null, zielLokal: true });
  if (!vorab.ok) throw fehler(403, String(vorab.grund), vorab.text);
  const ziel = anfrageZiel(connection, opt.env);
  if (!ziel) throw fehler(422, 'vision', 'Kein Sprachmodell verbunden (Offline-Modus) — ein Bild hätte kein Ziel; nichts wurde gesendet');
  const lokal = istLoopbackUrl(ziel.url);
  let host = '';
  try { host = new URL(ziel.url).hostname; } catch { host = ''; }
  const f = bildFreigabe({ projekt: opt.projekt ?? null, zielLokal: lokal, nurLokal: !!opt.nurLokal, bilderExtern: opt.bilderExtern !== false,
    ziel: bildZielText({ lokal, anbieter: ziel.anbieter, host }) });
  // the consent is a question to the person (409), every other refusal is final (403)
  if (!f.ok) throw fehler(f.grund === 'zustimmung' ? 409 : 403, String(f.grund), f.text);
  const v = bildFaehig({ modell: ziel.modell, katalog: opt.katalog ?? null });
  if (!v.ja) throw fehler(422, 'vision', v.text);
}

/**
 * Invoke the active model (Base44 InvokeLLM contract: string, or parsed JSON with a schema).
 * @param {object} params { prompt, response_json_schema?, daten?, bilder? } - bilder (106-06): [{png_base64}] images of the view, see bildGatter
 * @param {object|null} connection active LlmConnection or null (env-key fallback / offline mock)
 * @param {{ nurLokal?: boolean, bilderExtern?: boolean, projekt?: object|null, katalog?: any, deps?: object, env?: Record<string, string|undefined> }} [opt]
 *   nurLokal = "Nur lokale KI" (93-12): every target that is not on this computer is refused BEFORE any request, including the env-key
 *   fallbacks and the offline mock (the user asked for local AI — a mock answer would hide that none is connected);
 *   bilderExtern/projekt/katalog: the image gate (106-06) - only read when params.bilder is not empty; deps = injectable transports for tests
 * @returns {Promise<any>}
 * @throws {Error & {status?: number, grund?: string}} 403 when refused by "Nur lokale KI" or the image gate, 409 when an image needs the
 *   project's consent, 422 when the model reads no images, 400 for a broken image
 */
export async function invokeLLM(params, connection, opt = {}) {
  if (opt.nurLokal) nurLokalPruefen(connection ? zielUrlFuer(connection) : '', true);
  const bilder = bilderPruefen(params?.bilder);
  bildGatter(bilder, connection, opt);
  // 78-12: external content as data (params.daten = [{ quelle, text }]) behind a fixed preamble, and the
  // answer as plain text only (llmSchutz.js). Without params.daten the prompt is unchanged.
  const geschuetzt = { ...params, prompt: geschuetzterPrompt(params?.prompt, params?.daten) };
  delete geschuetzt.daten;
  delete geschuetzt.bilder;
  if (bilder.length) geschuetzt.bilder = bilder;
  return antwortBereinigen(await rufen(geschuetzt, connection, opt.deps));
}

async function rufen(params, connection, deps = {}) {
  // Aktive benutzerdefinierte Verbindung hat Vorrang; Fallback bleibt unverändert.
  if (connection) return callConnection(connection, params, { deps });
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(params, deps);
  if (process.env.OPENAI_API_KEY) return callOpenAI(params, deps);
  return mockResponse(params);
}
