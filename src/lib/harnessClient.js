// Client for the Atelier AI Harness service (harness/, Phase 67).
//
// In:  VITE_HARNESS_URL (default http://127.0.0.1:8765). Out: small fetch
// wrappers for the HTTP routes and `openChat()` — a WebSocket session that
// forwards the service's events 1:1 (see harness/harness/agent/messages.py:
// hello, status, text_delta, tool_call, tool_result, approval, usage,
// compression, notice, error, done). No dependency: native fetch + WebSocket.
//
// The app talks to the service directly (HANDOFF-KI-HARNESS §4.4), not via
// Express — one hop less and no WebSocket proxy.

/** @type {string} HTTP origin of the service, without trailing slash. */
// `import.meta.env` exists under Vite only; node:test imports this file too.
export const HARNESS_URL = (import.meta.env?.VITE_HARNESS_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');

/** WebSocket origin derived from the HTTP one (http→ws, https→wss). */
export const HARNESS_WS = HARNESS_URL.replace(/^http/, 'ws');

/** Reconnect schedule in ms (backoff 1–8 s, then give up → offline card). */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000];

/** Timeout for a single HTTP call in ms — the service is local, anything slower is "down". */
const HTTP_TIMEOUT_MS = 4000;

/**
 * GET/POST JSON against the service. Throws Error with a German sentence.
 * @param {string} path
 * @param {{method?: string, body?: unknown, timeoutMs?: number}} [opt]
 * @returns {Promise<any>}
 */
export async function harnessFetch(path, opt = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opt.timeoutMs ?? HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${HARNESS_URL}${path}`, {
      method: opt.method || 'GET',
      headers: opt.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail ?? ''; } catch { /* body not JSON */ }
      throw new Error(`Dienst antwortet ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Dienst unter ${HARNESS_URL} antwortet nicht`);
    if (err instanceof TypeError) throw new Error(`Kein Dienst unter ${HARNESS_URL} erreichbar`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<any>} status object (mode, display_name, model, projekt, tokens, kosten_eur, …) */
export const status = () => harnessFetch('/status');
/** @returns {Promise<{aktiv: string|null, projekte: string[]}>} */
export const projects = () => harnessFetch('/projects');
/** @param {string} slug */
export const setProject = (slug) => harnessFetch(`/project/${encodeURIComponent(slug)}`, { method: 'POST' });
/** @returns {Promise<{skills: {name: string, description: string, mode: string}[], warnungen: string[]}>} */
export const skills = () => harnessFetch('/skills');
/** @returns {Promise<{provider: string, model: string, profile: string[], models: string[]}>} */
export const model = () => harnessFetch('/model');
/** @param {string|null} provider @param {string|null} modelName */
export const setModel = (provider, modelName) => harnessFetch('/model', { method: 'POST', body: { provider, model: modelName } });

/**
 * URL of a project file served by the service (sandbox-checked server side,
 * only model/*.ifc of the active project — Plan 67-06 Task 3).
 * @param {string} path relative to the project or absolute
 */
export const fileUrl = (path) => `${HARNESS_URL}/files?path=${encodeURIComponent(path)}`;

/**
 * Transcribes one recording via POST /stt (67-05). The text is a PREVIEW for the
 * composer — the caller never sends it on its own. Throws with the service's
 * German sentence (501 without the voice extra, 503 while the model loads).
 * @param {Blob} blob audio/webm;codecs=opus from MediaRecorder (or audio/wav)
 * @param {string} [language]
 * @returns {Promise<{text: string, dauer_s: number, geraet: string, modell: string, audio_s: number}>}
 */
export async function stt(blob, language = 'de') {
  const fd = new FormData();
  fd.append('audio', blob, 'aufnahme.webm');
  const res = await fetch(`${HARNESS_URL}/stt?language=${encodeURIComponent(language)}`, { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Dienst antwortet ${res.status}`);
  return body;
}

/**
 * Opens the chat WebSocket with reconnect. Every service event goes to
 * `onEvent(ev)`; connection state to `onState('connecting'|'open'|'closed'|'offline')`.
 * Returns handles; `close()` stops reconnecting.
 *
 * @param {{onEvent: (ev: any) => void, onState?: (s: string) => void}} handlers
 */
export function openChat({ onEvent, onState }) {
  let ws = null;
  let attempts = 0;
  let closedByUs = false;
  let timer = null;

  const setState = (s) => onState?.(s);

  const connect = () => {
    setState(attempts === 0 ? 'connecting' : 'reconnecting');
    ws = new WebSocket(`${HARNESS_WS}/ws/chat`);
    ws.onopen = () => { attempts = 0; setState('open'); };
    ws.onmessage = (m) => {
      let ev;
      try { ev = JSON.parse(m.data); } catch { onEvent({ type: 'error', message: 'Dienst schickte kein JSON' }); return; }
      onEvent(ev);
    };
    ws.onerror = () => { /* onclose follows; state handled there */ };
    ws.onclose = () => {
      ws = null;
      if (closedByUs) { setState('closed'); return; }
      if (attempts >= RECONNECT_DELAYS_MS.length) { setState('offline'); return; }
      const delay = RECONNECT_DELAYS_MS[attempts++];
      setState('reconnecting');
      timer = setTimeout(connect, delay);
    };
  };
  connect();

  const send = (obj) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };

  return {
    /** @param {string} text */
    sendText: (text) => send({ type: 'user', text }),
    /** @param {string} id @param {boolean} ja */
    reply: (id, ja) => send({ type: 'approval_reply', id, ja }),
    requestStatus: () => send({ type: 'status' }),
    /** @param {string|null} provider @param {string|null} modelName */
    switchModel: (provider, modelName) => send({ type: 'model', provider, model: modelName }),
    /** Reset the backoff and try again now (the offline card's button). */
    retry: () => { attempts = 0; closedByUs = false; if (!ws) connect(); },
    close: () => { closedByUs = true; clearTimeout(timer); ws?.close(); },
    isOpen: () => !!ws && ws.readyState === WebSocket.OPEN,
  };
}

/**
 * Splits assistant text into prose and fenced code blocks — a tiny stand-in
 * for a Markdown renderer (T-67-18: text stays text, no HTML injection).
 * @param {string} text
 * @returns {{type: 'text'|'code', text: string, lang?: string}[]}
 */
export function splitFences(text) {
  const out = [];
  const re = /```([\w+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    out.push({ type: 'code', lang: m[1] || undefined, text: m[2].replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.length ? out : [{ type: 'text', text }];
}

/**
 * Finds .ifc paths in a tool result (JSON string or text) — what the IFC pane offers to open.
 * @param {string} result
 * @returns {string[]}
 */
export function findeIfcPfade(result) {
  const hits = new Set();
  // Tool results are JSON: walk the string values — paths contain spaces
  // ("My Drive"), so a whitespace-bounded regex would cut them apart.
  try {
    const walk = (v) => {
      if (typeof v === 'string') { if (/\.ifc$/i.test(v.trim())) hits.add(v.trim()); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(JSON.parse(result));
    if (hits.size) return [...hits];
  } catch { /* not JSON — fall through to the text scan */ }
  const re = /[^\s"'`<>|]+\.ifc\b/gi;
  let m;
  while ((m = re.exec(result || '')) !== null) hits.add(m[0].replace(/\\\\/g, '\\'));
  return [...hits];
}
