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
  let res;
  try {
    res = await fetch(`${HARNESS_URL}/stt?language=${encodeURIComponent(language)}`, { method: 'POST', body: fd });
  } catch (err) {
    // 106-05: a plain sentence instead of the browser's "Failed to fetch" (the speech field shows it)
    if (err instanceof TypeError) throw new Error(`Kein Dienst unter ${HARNESS_URL} erreichbar`);
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Dienst antwortet ${res.status}`);
  return body;
}

/** Longest wait for the agent of the speech profile, in ms [ASSUMED: 15 min - a big local model on a small graphics card needs minutes per turn]. */
export const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

/** Harness tools whose successful answer is a proposal waiting in the viewer (106-04 MCP tools). */
const VORSCHLAG_WERKZEUGE = ['eigenschaft_setzen', 'transformieren', 'teilen'];

/** @param {any} result  `result` of a tool_result event (a string). @returns {boolean} it is the harness's error form `{"error": …}` */
function werkzeugFehler(result) {
  try {
    const j = JSON.parse(String(result ?? ''));
    return !!j && typeof j === 'object' && 'error' in j;
  } catch {
    return false;
  }
}

/** Sentence of the speech field when the harness is not there (plan 106-05). */
export const SPRECH_OHNE_HARNESS = 'Spracheingabe braucht den KI-Harness (Einstellungen › KI)';

/** Review 106-07: sentence on a paired device (office mode) whose harness address points at the device itself (127.0.0.1 there). */
export const GERAET_OHNE_HARNESS = 'Spracheingabe am gekoppelten Gerät nicht verfügbar: der KI-Harness läuft nur am Rechner — den Satz bitte in die Zeile tippen';
/** Review 106-07: sentence on a page without a secure context (office mode is plain HTTP in the LAN): the browser gives no microphone. */
export const GERAET_OHNE_HTTPS = 'Spracheingabe am gekoppelten Gerät nicht verfügbar: die Seite läuft ohne HTTPS, der Browser gibt das Mikrofon nicht frei — den Satz bitte in die Zeile tippen';

/** @param {string} host  hostname without port @returns {boolean} this machine itself (loopback names, *.localhost) */
function istLoopback(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Review 106-07: why speech cannot work on THIS page although the field is shown - a paired device of the office mode opens the app from
 * the computer's LAN address over plain HTTP. Two causes, in this order: the harness address is loopback (on the device that is the device
 * itself, the harness runs on the computer), or the page is no secure context / has no microphone API (getUserMedia needs HTTPS).
 * Making speech work there needs a decision (HTTPS in the office mode, or recognition through the app server) - see 106-07-SUMMARY.
 * @param {{seiteHost: string, sicher: boolean, aufnahmeDa: boolean, harnessUrl: string}} o
 *   seiteHost: hostname of the page (location.hostname, '' for file/app shells); sicher: window.isSecureContext;
 *   aufnahmeDa: navigator.mediaDevices.getUserMedia exists; harnessUrl: HTTP origin of the harness
 * @returns {string}  '' = no device restriction, else GERAET_OHNE_HARNESS or GERAET_OHNE_HTTPS
 */
export function geraetSprechGrund({ seiteHost, sicher, aufnahmeDa, harnessUrl }) {
  if (!seiteHost || istLoopback(seiteHost)) return '';
  let harnessHost = '';
  try { harnessHost = new URL(harnessUrl).hostname; } catch { /* unreadable address: treated like loopback */ }
  if (!harnessHost || istLoopback(harnessHost)) return GERAET_OHNE_HARNESS;
  if (!sicher || !aufnahmeDa) return GERAET_OHNE_HTTPS;
  return '';
}

/** @returns {string} geraetSprechGrund for the current page ('' outside a browser) */
function geraetGrundJetzt() {
  if (typeof window === 'undefined' || !window.location) return '';
  return geraetSprechGrund({
    seiteHost: window.location.hostname || '',
    sicher: window.isSecureContext !== false,
    aufnahmeDa: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    harnessUrl: HARNESS_URL,
  });
}

/**
 * What the speech field needs to know before it records or asks the model (106-05): is the harness there, can it transcribe, which provider
 * does it use and does that one leave this computer, does the app say "Nur lokale KI", does the harness have the viewer tools.
 * Never throws: an unreachable harness is `harness: false` with the sentence for the field.
 * @returns {Promise<import('@core/lib/zeigen/sprechDienst.js').SprechBereitschaft>}
 */
export async function sprechBereitschaft() {
  let nurLokalApp = false;
  try {
    const r = await fetch('/api/llm/einstellungen', { cache: 'no-store' });
    if (r.ok) nurLokalApp = (await r.json())?.nur_lokal === true;
  } catch { /* an app without the route or offline: not set */ }
  const aus = (hinweis, extra = {}) => ({ harness: false, stt: false, sttBereit: false, hinweis, sttHinweis: hinweis, mcpHinweis: hinweis, provider: null, providerLokal: false, nurLokalApp, nurLokalHarness: false, mcp: false, ...extra });
  // review 106-07: on a paired device the field names the real cause instead of "start the harness"
  const geraetGrund = geraetGrundJetzt();
  if (geraetGrund === GERAET_OHNE_HARNESS) return aus(geraetGrund);
  let s;
  try {
    s = await status();
  } catch {
    return aus(SPRECH_OHNE_HARNESS);
  }
  const stt = s?.stt || {};
  // two causes, two fields (additive): the microphone needs the recognition, a typed free sentence needs the viewer tools
  const sttHinweis = geraetGrund || (!stt.verfuegbar ? (stt.hinweis ? `Spracheingabe nicht verfügbar: ${stt.hinweis}` : SPRECH_OHNE_HARNESS) : '');
  const mcpHinweis = s?.mcp && s.mcp.aktiv === false ? (s.mcp.hinweis || '') : !s?.mcp ? 'Der KI-Harness hat keine Verbindung zu den Modell-Werkzeugen dieser App' : '';
  return {
    harness: true,
    stt: !!stt.verfuegbar && !geraetGrund,
    sttBereit: !!stt.bereit,
    hinweis: sttHinweis || mcpHinweis,
    sttHinweis,
    mcpHinweis,
    provider: s?.provider ?? null,
    providerLokal: s?.provider_lokal === true,
    nurLokalApp,
    nurLokalHarness: s?.nur_lokal === true,
    // "aktiv" = switched on in config.yaml; the connection itself is made on the first sentence (and says why it fails)
    mcp: !!s?.mcp && s.mcp.aktiv !== false,
    // 106-06: for the "mit Bild" button - does the harness's model read images, which model, where does it talk to (host only)
    bilder: s?.bilder === true,
    modell: s?.model ?? null,
    providerZiel: typeof s?.provider_ziel === 'string' ? s.provider_ziel : null,
  };
}

/**
 * 106-06 (D-IM-02): asks the app's store whether an image of the view of this project may go to the target - NDA marker, the person's
 * consent, "Nur lokale KI", the office switch. Never throws: an unreachable app is a refusal with a sentence (no check, no image).
 * @param {string} projektId
 * @param {{lokal: boolean, anbieter?: string|null, host?: string|null}} ziel  lokal: the model runs on this computer.
 * @returns {Promise<{ok: boolean, grund: string|null, text: string, zugestimmt?: boolean}>}
 */
export async function bildFreigabeLesen(projektId, ziel) {
  const q = new URLSearchParams({ projekt_id: String(projektId ?? ''), ziel: ziel?.lokal ? 'lokal' : 'extern', anbieter: String(ziel?.anbieter ?? ''), host: String(ziel?.host ?? '') });
  try {
    const r = await fetch(`/api/llm/bild-freigabe?${q}`, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (j && typeof j.ok === 'boolean') return j;
    return { ok: false, grund: 'app', text: `Die Freigabe des Bildes ließ sich nicht prüfen (HTTP ${r.status}) — kein Bild gesendet` };
  } catch {
    return { ok: false, grund: 'app', text: 'BIT-Atelier antwortet nicht — ohne Prüfung geht kein Bild an ein Modell' };
  }
}

/**
 * 106-06: the person's consent for images of this project leaving the computer (once per project; POST from the browser only).
 * @param {string} projektId
 * @returns {Promise<{ok: boolean, text?: string}>}  never throws; `text` says why it failed
 */
export async function bildZustimmen(projektId) {
  try {
    const r = await fetch('/api/llm/bild-zustimmung', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projekt_id: projektId }) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, text: String(j?.error || `HTTP ${r.status}`) };
  } catch {
    return { ok: false, text: 'BIT-Atelier antwortet nicht — Zustimmung nicht gespeichert' };
  }
}

/**
 * 106-06: withdraws the consent of a project (images stop leaving the computer until the person agrees again).
 * @param {string} projektId @returns {Promise<{ok: boolean, text?: string}>}  never throws
 */
export async function bildZustimmungZuruecknehmen(projektId) {
  try {
    const r = await fetch(`/api/llm/bild-zustimmung?${new URLSearchParams({ projekt_id: String(projektId ?? '') })}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, text: String(j?.error || `HTTP ${r.status}`) };
  } catch {
    return { ok: false, text: 'BIT-Atelier antwortet nicht' };
  }
}

/**
 * One task for the harness agent in the speech profile (106-05): opens /ws/chat?profil=sprechen, sends the task as the one user message, collects
 * what the agent says and which tools it called, and answers when its turn is done. The profile has only the viewer's proposal tools, so a result
 * is never a change: proposals appear in the open viewer and wait for the person. An approval request of the agent is ALWAYS answered "nein" -
 * a program never says yes for the person (decision D-IM-04).
 * @param {string} auftrag  The task text (sprachAgent.agentAuftrag).
 * @param {{profil?: string, ziel?: string[], bilder?: Array<{png_base64: string}>, projektId?: string|null, satzMarke?: string, onEvent?: (ev: any) => void, timeoutMs?: number}} [opt]
 *   ziel: the GUIDs selected when the person spoke - sent with the task, the harness aims the change tools at exactly them (guard rail 3);
 *   satzMarke (D-IM-07): the page's marker of the sentence (spoken / image along, @core/lib/zeigen/satzMarke.js) - sent as `satz_marke`, the
 *   harness puts it into the change tools' calls so the proposals carry "sprache" + "agent"; the model never sees it;
 *   bilder/projektId (106-06): images of the view as context and the project they belong to - the harness checks both against the app's store
 *   (NDA, consent) before an image reaches its model;
 *   timeoutMs: give up after this long, in ms (default AGENT_TIMEOUT_MS).
 * @returns {Promise<{text: string, werkzeuge: string[], vorschlaege: number, fehler: string|null}>}  Never rejects: `fehler` carries a German
 *   sentence. vorschlaege: change tools (eigenschaft_setzen, transformieren, teilen) whose answer was not an error = proposals now waiting in the viewer.
 */
export function agentFrage(auftrag, { profil = 'sprechen', ziel, bilder, projektId, satzMarke, onEvent, timeoutMs = AGENT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let text = '';
    /** @type {string[]} */
    const werkzeuge = [];
    let vorschlaege = 0;
    let fehler = null;
    let fertig = false;
    let ws;
    const ende = (/** @type {string|null} */ f) => {
      if (fertig) return;
      fertig = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closed */ }
      resolve({ text, werkzeuge, vorschlaege, fehler: fehler || f });
    };
    const timer = setTimeout(() => ende(`Der KI-Harness hat nicht innerhalb von ${Math.round(timeoutMs / 60000)} Minuten geantwortet`), timeoutMs);
    try {
      ws = new WebSocket(`${HARNESS_WS}/ws/chat?profil=${encodeURIComponent(profil)}`);
    } catch {
      ende(`Kein Dienst unter ${HARNESS_URL} erreichbar`);
      return;
    }
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => ende(`Die Verbindung zum KI-Harness wurde beendet, bevor eine Antwort kam`);
    ws.onmessage = (m) => {
      let ev;
      try { ev = JSON.parse(m.data); } catch { fehler = 'Der Dienst schickte kein JSON'; ende(null); return; }
      try { onEvent?.(ev); } catch { /* a faulty listener must not stop the turn */ }
      switch (ev.type) {
        case 'hello': ws.send(JSON.stringify({ type: 'user', text: auftrag, ...(Array.isArray(ziel) ? { ziel } : {}),
          ...(Array.isArray(bilder) && bilder.length ? { bilder, projekt_id: projektId ?? null } : {}),
          ...(typeof satzMarke === 'string' && satzMarke ? { satz_marke: satzMarke } : {}) })); break;
        case 'text_delta': text += ev.text || ''; break;
        case 'tool_call': werkzeuge.push(String(ev.name)); break;
        case 'tool_result': if (VORSCHLAG_WERKZEUGE.includes(String(ev.name)) && !werkzeugFehler(ev.result)) vorschlaege += 1; break;
        case 'approval': ws.send(JSON.stringify({ type: 'approval_reply', id: ev.id, ja: false })); break;
        case 'error': fehler = String(ev.message || 'Fehler im KI-Harness'); ende(null); break;
        case 'done': ende(ev.stop_reason === 'error' ? 'Der KI-Harness hat mit einem Fehler beendet' : null); break;
        default: break;
      }
    };
  });
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
  /** @type {{type: 'text'|'code', text: string, lang?: string}[]} */
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
