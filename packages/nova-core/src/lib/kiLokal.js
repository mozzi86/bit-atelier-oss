// kiLokal.js — local AI building blocks shared by the server (llm.js, llmLokal.js, server/) and the
// settings UI (plan 93-12). Pure and loadable under plain node: no network, no browser API.
//
//   - Loopback detection: the "Nur lokale KI" switch allows only endpoints on THIS computer
//     (localhost, 127.0.0.0/8, ::1, IPv4-mapped ::ffff:127.x). Uses the WHATWG URL parser, so
//     tricks like http://127.0.0.1@evil.example or http://127.0.0.1.evil.example resolve to the
//     real host and are refused.
//   - Model discovery: the URL of the model list per connection type and a parser for both
//     answer shapes (OpenAI-style `data[].id`, Ollama `/api/tags` `models[].name`).
//   - Plain-text errors when a local server is not running (ECONNREFUSED & co.).
//   - The OpenAI-compatible base URL the Python harness needs for a stored connection.
//
// In:  URLs, connection rows ({provider, base_url, model}), raw JSON answers, Error objects.
// Out: booleans, URLs, string lists, German sentences.

import { chatCompletionsUrl, ollamaChatUrl } from './kiVorlagen.js';

/** Default base URL of LM Studio's OpenAI-compatible server. [CITED] https://lmstudio.ai/docs/app/api/endpoints/openai */
export const LMSTUDIO_STANDARD_URL = 'http://127.0.0.1:1234/v1';
/** Default base URL of Ollama. [CITED] https://docs.ollama.com/api — port 11434. */
export const OLLAMA_STANDARD_URL = 'http://127.0.0.1:11434';

/** Strict dotted IPv4 with every octet 0–255. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * True when a host name names this computer.
 * Accepted: `localhost` and `*.localhost` (RFC 6761 §6.3 reserves it for loopback), 127.0.0.0/8,
 * `::1` (any spelling), IPv4-mapped `::ffff:127.x.x.x` in dotted or hex form (the URL parser turns
 * [::ffff:127.0.0.1] into [::ffff:7f00:1]).
 * @param {string} host host name, with or without IPv6 brackets
 * @returns {boolean}
 */
export function istLoopbackHost(host) {
  let h = String(host ?? '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = h.match(IPV4);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255) && Number(v4[1]) === 127;
  if (h.includes(':')) {
    // IPv6: expand "::" and compare the 8 groups.
    const mapped = h.match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/);
    if (mapped) {
      const rest = mapped[1];
      if (IPV4.test(rest)) return istLoopbackHost(rest);
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) return (parseInt(hex[1], 16) >> 8) === 127;
      return false;
    }
    const teile = h.split('::');
    if (teile.length > 2) return false;
    const links = teile[0] ? teile[0].split(':') : [];
    const rechts = teile.length === 2 && teile[1] ? teile[1].split(':') : [];
    const fehlend = 8 - links.length - rechts.length;
    if (fehlend < 0 || (teile.length === 1 && fehlend !== 0)) return false;
    const gruppen = [...links, ...Array(fehlend).fill('0'), ...rechts];
    if (gruppen.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return false;
    return gruppen.slice(0, 7).every((g) => parseInt(g, 16) === 0) && parseInt(gruppen[7], 16) === 1;
  }
  return false;
}

/**
 * True when a URL points to this computer (http or https only).
 * @param {string} url absolute URL
 * @returns {boolean} false for unparsable URLs and other schemes
 */
export function istLoopbackUrl(url) {
  try {
    const u = new URL(String(url ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return istLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Host name of a URL for messages ("api.openai.com"), '' when unparsable.
 * @param {string} url
 * @returns {string}
 */
export function hostVon(url) {
  try { return new URL(String(url ?? '').trim()).host; } catch { return ''; }
}

/**
 * Server root of an Ollama base URL (…/v1 and …/api stripped).
 * @param {string} basisUrl e.g. http://127.0.0.1:11434/v1
 * @returns {string} e.g. http://127.0.0.1:11434
 */
export function ollamaWurzel(basisUrl) {
  return ollamaChatUrl(basisUrl).replace(/\/api\/chat$/, '');
}

/**
 * OpenAI-compatible base (the part before /chat/completions) — what the harness's openai_compat
 * transport and the model list need.
 * @param {string} provider connection type ('openai' | 'custom' | 'ollama' | 'anthropic')
 * @param {string} basisUrl stored base URL
 * @returns {string} e.g. http://127.0.0.1:1234/v1; for Ollama the server root + /v1; '' when empty
 */
export function openaiBasis(provider, basisUrl) {
  if (provider === 'ollama') {
    const wurzel = ollamaWurzel(basisUrl);
    return wurzel ? `${wurzel}/v1` : '';
  }
  return chatCompletionsUrl(basisUrl).replace(/\/chat\/completions$/i, '');
}

/**
 * URL of the model list for a connection.
 * Ollama: GET /api/tags ([CITED] https://docs.ollama.com/api/tags);
 * OpenAI-compatible (LM Studio, OpenAI, …): GET {base}/models ([CITED] https://lmstudio.ai/docs/app/api/endpoints/openai).
 * @param {string} provider connection type
 * @param {string} basisUrl base URL
 * @returns {string} '' for Anthropic or an empty base (no list offered there)
 */
export function modellListenUrl(provider, basisUrl) {
  if (provider === 'anthropic') return '';
  if (provider === 'ollama') {
    const wurzel = ollamaWurzel(basisUrl);
    return wurzel ? `${wurzel}/api/tags` : '';
  }
  const basis = openaiBasis(provider, basisUrl);
  return basis ? `${basis}/models` : '';
}

/**
 * Model names from a model-list answer. Accepts the OpenAI shape `{data: [{id}]}` and the Ollama
 * shape `{models: [{name|model}]}`; anything else gives []. Sorted, without duplicates.
 * Embedding-only models (LM Studio lists them too, id contains "embed") are left out — they cannot chat.
 * @param {unknown} antwort parsed JSON
 * @returns {string[]}
 */
export function modelleAusAntwort(antwort) {
  /** @type {any} */
  const a = antwort;
  let namen = [];
  if (a && Array.isArray(a.data)) namen = a.data.map((m) => (m && typeof m === 'object' ? m.id : null));
  else if (a && Array.isArray(a.models)) namen = a.models.map((m) => (m && typeof m === 'object' ? (m.name || m.model) : null));
  const sauber = namen.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()).filter((n) => !/embed/i.test(n));
  return [...new Set(sauber)].sort((x, y) => x.localeCompare(y));
}

/**
 * Display name of the local server behind a URL — for error sentences.
 * @param {string} provider connection type
 * @param {string} url base or endpoint URL
 * @returns {string} 'Ollama' | 'LM Studio' | 'der lokale KI-Server'
 */
export function lokalerServerName(provider, url) {
  if (provider === 'ollama' || /:11434\b/.test(String(url))) return 'Ollama';
  if (/:1234\b/.test(String(url))) return 'LM Studio';
  return 'der lokale KI-Server';
}

/**
 * Plain-German sentence for a failed request to a (local) AI server.
 * Network errors arrive as `TypeError: fetch failed` with `cause.code`, or as node:http errors with
 * `code` directly — both are read.
 * @param {any} err the thrown error
 * @param {{provider?: string, url?: string, timeoutS?: number}} [ctx] provider, target URL, timeout (seconds)
 * @returns {string}
 */
export function lokalerFehlerText(err, ctx = {}) {
  const code = err?.code || err?.cause?.code || '';
  const url = ctx.url || '';
  const name = lokalerServerName(ctx.provider || '', url);
  const wo = hostVon(url) || url;
  const start = name === 'Ollama'
    ? 'Ollama starten (Programm „Ollama“ öffnen oder `ollama serve`).'
    : name === 'LM Studio'
      ? 'In LM Studio unter „Developer“ den Server starten (oder `lms server start`) und ein Modell laden.'
      : 'Den lokalen Server starten und ein Modell laden.';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') {
    return `${name === 'der lokale KI-Server' ? 'Der lokale KI-Server' : name} antwortet nicht unter ${wo} — läuft er? ${start}`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Adresse ${wo} nicht gefunden — Basis-URL prüfen.`;
  if (err?.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    const s = ctx.timeoutS ? ` (${ctx.timeoutS} s)` : '';
    return `Keine Antwort von ${wo} innerhalb der Wartezeit${s}. Lokale Modelle brauchen beim ersten Aufruf oft Minuten (Laden in den Grafikspeicher) — später erneut versuchen oder ein kleineres Modell wählen.`;
  }
  return String(err?.message || err || 'Unbekannter Fehler');
}

/** Message when "Nur lokale KI" refuses a target. */
export const NUR_LOKAL_TEXT = 'Nur lokale KI ist eingeschaltet: Anfragen an {host} werden nicht gesendet. Eine lokale Verbindung (LM Studio oder Ollama auf diesem Rechner) aktivieren oder den Schalter in Einstellungen › KI ausschalten.';

/**
 * The refusal sentence for a target host.
 * @param {string} url the refused URL ('' = no local connection active)
 * @returns {string}
 */
export function nurLokalMeldung(url) {
  const host = hostVon(url);
  return NUR_LOKAL_TEXT.replace('{host}', host || 'einen Cloud-Anbieter');
}
