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

async function callAnthropic({ prompt, response_json_schema }) {
  const sys = response_json_schema
    ? 'You are a helpful assistant. Respond ONLY with valid JSON matching the schema the user describes. No prose, no code fences.'
    : 'You are a helpful assistant specialized in construction, architecture, and project management.';
  const fullPrompt = response_json_schema
    ? `${prompt}\n\nReturn JSON conforming to this JSON schema:\n${JSON.stringify(response_json_schema)}`
    : prompt;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
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
      messages: [{ role: 'user', content: fullPrompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.content?.map((c) => c.text).join('') ?? '';
  return response_json_schema ? safeParse(text) : text;
}

async function callOpenAI({ prompt, response_json_schema }) {
  const sys = response_json_schema
    ? 'You are a helpful assistant. Respond ONLY with valid JSON matching the schema the user describes.'
    : 'You are a helpful assistant specialized in construction, architecture, and project management.';
  const fullPrompt = response_json_schema
    ? `${prompt}\n\nReturn JSON conforming to this JSON schema:\n${JSON.stringify(response_json_schema)}`
    : prompt;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModell(),
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: fullPrompt },
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
      messages: [{ role: 'user', content: fullPrompt }],
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
        { role: 'user', content: fullPrompt },
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
      { role: 'user', content: fullPrompt },
    ],
  }));
  if (!resp.ok) throw new Error(`Endpoint ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return response_json_schema ? safeParse(text) : text;
}

/**
 * Invoke the active model (Base44 InvokeLLM contract: string, or parsed JSON with a schema).
 * @param {object} params { prompt, response_json_schema?, daten? }
 * @param {object|null} connection active LlmConnection or null (env-key fallback / offline mock)
 * @param {{ nurLokal?: boolean, deps?: object }} [opt] nurLokal = "Nur lokale KI" (93-12): every
 *   target that is not on this computer is refused BEFORE any request, including the env-key
 *   fallbacks and the offline mock (the user asked for local AI — a mock answer would hide that none
 *   is connected); deps = injectable transports for tests
 * @returns {Promise<any>}
 * @throws {Error & {status?: number}} 403 when refused by "Nur lokale KI"
 */
export async function invokeLLM(params, connection, opt = {}) {
  if (opt.nurLokal) nurLokalPruefen(connection ? zielUrlFuer(connection) : '', true);
  // 78-12: external content as data (params.daten = [{ quelle, text }]) behind a fixed preamble, and the
  // answer as plain text only (llmSchutz.js). Without params.daten the prompt is unchanged.
  const geschuetzt = { ...params, prompt: geschuetzterPrompt(params?.prompt, params?.daten) };
  delete geschuetzt.daten;
  return antwortBereinigen(await rufen(geschuetzt, connection, opt.deps));
}

async function rufen(params, connection, deps) {
  // Aktive benutzerdefinierte Verbindung hat Vorrang; Fallback bleibt unverändert.
  if (connection) return callConnection(connection, params, { deps });
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(params);
  if (process.env.OPENAI_API_KEY) return callOpenAI(params);
  return mockResponse(params);
}
