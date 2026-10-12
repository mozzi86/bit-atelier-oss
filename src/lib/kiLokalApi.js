// kiLokalApi.js — fetch helpers for the local-AI settings (plan 93-12): /api/llm/einstellungen and the
// /api/ki/* routes of server/kiLokalRouter.js. Local express build only (the routes do not exist in the
// cloud build); callers check DATENQUELLE first.
//
// Two window events keep the independent cards in step without a shared store:
//   EINSTELLUNGEN_EVENT  "Nur lokale KI" changed → badges re-read the setting
//   VERBINDUNGEN_EVENT   a connection was created/changed server-side (pull finished, "Verwenden")
//
// In: path + options. Out: parsed JSON; Error with the server's German sentence on failure.

/** Fired after the AI settings changed (detail = new settings). */
export const EINSTELLUNGEN_EVENT = 'bit:ki-einstellungen';
/** Fired after the server changed the LlmConnection list. */
export const VERBINDUNGEN_EVENT = 'bit:llm-verbindungen';

/**
 * JSON request against the local API.
 * @param {string} pfad path below /api, e.g. "/ki/harness"
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [opt]
 * @returns {Promise<any>}
 */
export async function kiJson(pfad, opt = {}) {
  const r = await fetch(`/api${pfad}`, {
    method: opt.method || 'GET',
    headers: opt.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
    cache: 'no-store',
    signal: opt.signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || j?.fehler || `HTTP ${r.status}`);
  return j;
}

/**
 * Notify other cards.
 * @param {string} name EINSTELLUNGEN_EVENT | VERBINDUNGEN_EVENT
 * @param {unknown} [detail]
 */
export function melden(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Size in GB with one decimal, German or English separator.
 * @param {number|null|undefined} gb gigabytes
 * @param {string} lang 'de' | 'en'
 * @returns {string} e.g. "6,6"; "?" when unknown
 */
export function gbText(gb, lang) {
  if (gb == null || !Number.isFinite(Number(gb))) return '?';
  return Number(gb).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

/**
 * Replace {platzhalter} in an already translated text.
 * @param {string} text translated template
 * @param {Record<string, string|number>} [werte]
 * @param {string} [lang] numbers are formatted for this language
 * @returns {string}
 */
export function einsetzen(text, werte = {}, lang = 'de') {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => {
    const v = werte[k];
    if (v == null) return m;
    return typeof v === 'number' ? gbText(v, lang) : String(v);
  });
}
