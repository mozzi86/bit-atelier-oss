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
export async function callConnection(conn, params, { signal } = {}) {
  const { sys, fullPrompt } = buildPrompts(params);
  const base = baseUrlFor(conn);
  if (!base) throw new Error('Keine Basis-URL konfiguriert');
  const { response_json_schema } = params;
  const url = endpunktUrl(conn.provider, base);

  if (conn.provider === 'anthropic') {
    const resp = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': conn.api_key || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: conn.model || STANDARD_ANTHROPIC_MODELL,
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

  if (conn.provider === 'ollama') {
    const resp = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: conn.model || 'llama3',
        stream: false,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: fullPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.message?.content ?? '';
    return response_json_schema ? safeParse(text) : text;
  }

  // 'openai' und 'custom' → OpenAI-kompatibles Chat-Completions-API.
  const headers = { 'content-type': 'application/json' };
  if (conn.api_key) headers.authorization = `Bearer ${conn.api_key}`;
  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model: conn.model || STANDARD_OPENAI_MODELL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: fullPrompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Endpoint ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return response_json_schema ? safeParse(text) : text;
}

export async function invokeLLM(params, connection) {
  // Aktive benutzerdefinierte Verbindung hat Vorrang; Fallback bleibt unverändert.
  if (connection) return callConnection(connection, params);
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(params);
  if (process.env.OPENAI_API_KEY) return callOpenAI(params);
  return mockResponse(params);
}
