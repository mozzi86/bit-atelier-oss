// ollamaDienst.js — the setup path for a local model (plan 93-12 A/B/C), server side.
//
//   Detection     Ollama GET /api/version, LM Studio GET {base}/models — 2.5 s each, loopback only.
//   Pull          POST /api/pull (NDJSON stream) as ONE background job: progress, cancel, and a free-disk
//                 check before it starts. The app never downloads or installs Ollama itself — the UI only
//                 links the official download page; this module only asks an already running Ollama to
//                 fetch a model.
//   Benchmark     POST /api/generate with a fixed short prompt; tokens/s = eval_count / eval_duration,
//                 time to first answer ≈ load_duration + prompt_eval_duration (Ollama reports ns).
//   Catalog       the bundled lokaleModelle.json, optionally replaced by a newer copy from the public
//                 repository — fetched only on the user's click, only from raw.githubusercontent.com,
//                 at most 256 KB, schema-checked (modellKatalog.katalogPruefen).
//
// [CITED] Ollama API: https://docs.ollama.com/api (version, tags, pull, generate), checked 12.10.2026.
// In:  base URLs, model tags, injectable transports. Out: plain objects with German error sentences.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { httpAnfrage } from '../packages/nova-core/server/llmLokal.js';
import { istLoopbackUrl, lokalerFehlerText, modelleAusAntwort } from '../packages/nova-core/src/lib/kiLokal.js';
import { katalogPruefen } from '../packages/nova-core/src/lib/modellKatalog.js';
import { UPDATE_REPO } from './selbstUpdate.js';

/** Repository path of the catalog — the same file in the monorepo and in the OSS export. */
export const KATALOG_PFAD = 'packages/nova-core/src/lib/lokaleModelle.json';
/** The only host a catalog update may come from. */
export const KATALOG_HOSTS = Object.freeze(['raw.githubusercontent.com']);
/** Largest accepted catalog file, bytes. */
const MAX_KATALOG_BYTES = 256 * 1024;
/** Fixed benchmark prompt (German, short, deterministic with temperature 0). */
export const BENCHMARK_PROMPT = 'Erkläre in drei kurzen Sätzen, was eine Ausschreibung nach VOB/A ist.';
/** Tokens the benchmark generates at most. [ASSUMED] 128 — long enough for a stable rate, short enough for slow PCs. */
const BENCHMARK_TOKENS = 128;

/**
 * Raw URL of the catalog in the public repository.
 * @param {string} [repo] "owner/name"
 * @returns {string}
 */
export function katalogUrl(repo = UPDATE_REPO) {
  return `https://raw.githubusercontent.com/${repo}/main/${KATALOG_PFAD}`;
}

/**
 * The catalog bundled with this installation.
 * @param {string} root app folder (absolute)
 * @returns {import('../packages/nova-core/src/lib/modellKatalog.js').Katalog}
 * @throws when the bundled file is missing or invalid (a broken release, not a user error)
 */
export function mitgelieferterKatalog(root) {
  const roh = JSON.parse(fs.readFileSync(path.join(root, KATALOG_PFAD), 'utf8'));
  const { ok, katalog, fehler } = katalogPruefen(roh);
  if (!ok || !katalog) throw new Error(`Mitgelieferter Modellkatalog ungültig: ${fehler.join('; ')}`);
  return katalog;
}

/**
 * Fetch a catalog from the public repository.
 * @param {{ url?: string, fetchFn?: typeof fetch, timeoutMs?: number }} [o] timeoutMs default 10 000 ms
 * @returns {Promise<{ ok: boolean, katalog?: import('../packages/nova-core/src/lib/modellKatalog.js').Katalog, fehler?: string, warnungen?: string[] }>}
 */
export async function katalogHolen(o = {}) {
  const url = o.url ?? katalogUrl();
  let host = '';
  try { const u = new URL(url); host = u.protocol === 'https:' ? u.hostname : ''; } catch { host = ''; }
  if (!KATALOG_HOSTS.includes(host)) return { ok: false, fehler: `Katalog-Adresse nicht erlaubt (nur ${KATALOG_HOSTS.join(', ')} über https)` };
  const ctrl = new AbortController();
  const uhr = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 10_000);
  try {
    const r = await (o.fetchFn ?? fetch)(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'BIT-Atelier-Modellkatalog' } });
    if (!r.ok) return { ok: false, fehler: `GitHub antwortet ${r.status} — Katalog nicht abrufbar` };
    const text = await r.text();
    if (text.length > MAX_KATALOG_BYTES) return { ok: false, fehler: 'Katalog-Datei ist zu groß und wurde verworfen' };
    let roh;
    try { roh = JSON.parse(text); } catch { return { ok: false, fehler: 'Katalog-Datei ist kein gültiges JSON' }; }
    const { ok, katalog, fehler } = katalogPruefen(roh);
    if (!ok || !katalog) return { ok: false, fehler: `Katalog-Datei ungültig: ${fehler.join('; ')}` };
    return { ok: true, katalog, warnungen: fehler };
  } catch (err) {
    return { ok: false, fehler: /** @type {any} */ (err)?.name === 'AbortError' ? 'GitHub hat nicht rechtzeitig geantwortet (10 s) — offline? Der mitgelieferte Katalog bleibt aktiv.' : `GitHub nicht erreichbar — offline? Der mitgelieferte Katalog bleibt aktiv. (${/** @type {any} */ (err)?.message || err})` };
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * Is Ollama / LM Studio running?
 * @param {{ ollamaUrl: string, lmstudioUrl: string, anfrageFn?: typeof httpAnfrage, timeoutMs?: number }} o
 * @returns {Promise<{ ollama: { ok: boolean, url: string, version?: string, fehler?: string },
 *   lmstudio: { ok: boolean, url: string, modelle?: string[], fehler?: string } }>}
 */
export async function lokaleServerErkennen(o) {
  const anfrage = o.anfrageFn ?? httpAnfrage;
  const timeoutMs = o.timeoutMs ?? 2500;
  const holen = async (url, provider) => {
    if (!istLoopbackUrl(url)) return { ok: false, fehler: 'Nur Adressen auf diesem Rechner' };
    try {
      const r = await anfrage(url, { method: 'GET', headers: { accept: 'application/json' }, timeoutMs });
      if (!r.ok) return { ok: false, fehler: `HTTP ${r.status}` };
      return { ok: true, json: await r.json().catch(() => ({})) };
    } catch (err) {
      return { ok: false, fehler: lokalerFehlerText(err, { provider, url, timeoutS: Math.round(timeoutMs / 1000) }) };
    }
  };
  const ollamaBasis = String(o.ollamaUrl).replace(/\/+$/, '');
  const lmBasis = String(o.lmstudioUrl).replace(/\/+$/, '');
  const [ol, lm] = await Promise.all([holen(`${ollamaBasis}/api/version`, 'ollama'), holen(`${lmBasis}/models`, 'openai')]);
  return {
    ollama: ol.ok ? { ok: true, url: ollamaBasis, version: String(ol.json?.version || '') } : { ok: false, url: ollamaBasis, fehler: ol.fehler },
    lmstudio: lm.ok ? { ok: true, url: lmBasis, modelle: modelleAusAntwort(lm.json) } : { ok: false, url: lmBasis, fehler: lm.fehler },
  };
}

/**
 * Installed Ollama models (/api/tags), {models: []} when Ollama is not running.
 * @param {string} ollamaUrl
 * @param {typeof httpAnfrage} [anfrageFn]
 * @returns {Promise<{ models: any[], laeuft: boolean }>}
 */
export async function ollamaTags(ollamaUrl, anfrageFn = httpAnfrage) {
  try {
    const r = await anfrageFn(`${String(ollamaUrl).replace(/\/+$/, '')}/api/tags`, { method: 'GET', timeoutMs: 2500 });
    if (!r.ok) return { models: [], laeuft: true };
    const j = await r.json();
    return { models: Array.isArray(j?.models) ? j.models : [], laeuft: true };
  } catch {
    return { models: [], laeuft: false };
  }
}

// --- Pull progress ----------------------------------------------------------------------------

/**
 * @typedef {object} PullStand
 * @property {string} modell tag being pulled
 * @property {string} status last status line of Ollama ("pulling manifest", "pulling 6a0746a1ec1a", "success" …)
 * @property {Record<string, {total: number, completed: number}>} schichten per layer digest, bytes
 * @property {number} gesamtBytes sum of the known layer sizes, bytes (grows while new layers appear)
 * @property {number} fertigBytes bytes downloaded, bytes
 * @property {number} prozent 0–100
 * @property {boolean} fertig "success" arrived
 * @property {boolean} abgebrochen cancelled by the user
 * @property {string|null} fehler plain-German error
 * @property {string} gestartetUm ISO time
 */

/**
 * Initial progress state.
 * @param {string} modell
 * @returns {PullStand}
 */
export function pullStart(modell) {
  return { modell, status: 'startet', schichten: {}, gesamtBytes: 0, fertigBytes: 0, prozent: 0, fertig: false, abgebrochen: false, fehler: null, gestartetUm: new Date().toISOString() };
}

/**
 * Apply one NDJSON line of the /api/pull stream. Unparsable lines are ignored.
 * Lines: {"status":"pulling manifest"} · {"status":"pulling <digest>","digest":"sha256:…","total":N,"completed":M}
 * · {"status":"verifying sha256 digest"} · {"status":"success"} · {"error":"…"}.
 * @param {PullStand} stand
 * @param {string} zeile one line
 * @returns {PullStand} new state (the input is not changed)
 */
export function pullZeileVerarbeiten(stand, zeile) {
  let j;
  try { j = JSON.parse(String(zeile).trim()); } catch { return stand; }
  if (!j || typeof j !== 'object') return stand;
  if (j.error) return { ...stand, fehler: `Ollama: ${String(j.error).slice(0, 300)}` };
  const neu = { ...stand, schichten: { ...stand.schichten }, status: String(j.status || stand.status) };
  if (j.digest && Number(j.total) > 0) {
    neu.schichten[j.digest] = { total: Number(j.total), completed: Math.min(Number(j.completed) || 0, Number(j.total)) };
  }
  const werte = Object.values(neu.schichten);
  neu.gesamtBytes = werte.reduce((s, w) => s + w.total, 0);
  neu.fertigBytes = werte.reduce((s, w) => s + w.completed, 0);
  neu.prozent = neu.gesamtBytes > 0 ? Math.floor((neu.fertigBytes / neu.gesamtBytes) * 100) : 0;
  if (j.status === 'success') { neu.fertig = true; neu.prozent = 100; }
  return neu;
}

/**
 * Streaming request: calls onZeile for every complete line of the response body.
 * Idle timeout (no bytes for `leerlaufMs`) aborts — a large download keeps the socket busy.
 * @param {string} url
 * @param {{ method?: string, body?: string, signal?: AbortSignal, onZeile: (z: string) => void, leerlaufMs?: number }} o
 *   leerlaufMs default 120 000 ms
 * @returns {Promise<{ status: number }>}
 */
export function httpStream(url, o) {
  const ziel = new URL(url);
  const modul = ziel.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = modul.request(ziel, { method: o.method || 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let rest = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rest += chunk;
        const zeilen = rest.split('\n');
        rest = zeilen.pop() ?? '';
        for (const z of zeilen) if (z.trim()) o.onZeile(z);
      });
      res.on('end', () => { if (rest.trim()) o.onZeile(rest); resolve({ status: res.statusCode || 0 }); });
      res.on('error', reject);
    });
    req.setTimeout(o.leerlaufMs ?? 120_000, () => req.destroy(Object.assign(new Error('Zeitüberschreitung'), { name: 'AbortError' })));
    if (o.signal) {
      if (o.signal.aborted) req.destroy(Object.assign(new Error('Abgebrochen'), { name: 'AbortError' }));
      else o.signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Abgebrochen'), { name: 'AbortError' })), { once: true });
    }
    req.on('error', reject);
    if (o.body != null) req.write(o.body);
    req.end();
  });
}

/**
 * One background pull at a time.
 * @param {{ streamFn?: typeof httpStream }} [deps]
 */
export function pullManager(deps = {}) {
  const streamFn = deps.streamFn ?? httpStream;
  /** @type {PullStand|null} */
  let stand = null;
  /** @type {AbortController|null} */
  let ctrl = null;
  /** @type {Promise<void>|null} */
  let laufend = null;

  /**
   * Start pulling a model.
   * @param {{ url: string, modell: string, benoetigtGb?: number|null, freiGb?: number|null, onFertig?: (modell: string) => void }} o
   *   benoetigtGb = expected download size (GB, catalog), freiGb = free disk space (GiB); both null = no check
   * @returns {PullStand}
   * @throws {Error & {status: number}} 409 while another pull runs, 400 for too little disk space or a bad tag
   */
  const start = (o) => {
    if (stand && !stand.fertig && !stand.fehler && !stand.abgebrochen) throw Object.assign(new Error(`Es lädt bereits ${stand.modell} — erst abwarten oder abbrechen.`), { status: 409 });
    if (!/^[a-z0-9][a-z0-9._/-]*(:[a-z0-9][a-z0-9._-]*)?$/i.test(String(o.modell || ''))) throw Object.assign(new Error('Ungültiger Modellname'), { status: 400 });
    if (!istLoopbackUrl(o.url)) throw Object.assign(new Error('Ollama muss auf diesem Rechner laufen'), { status: 400 });
    // Disk check BEFORE the first byte: download size + 2 GB headroom for temporary blobs. [ASSUMED] headroom.
    if (o.freiGb != null && o.benoetigtGb != null && o.benoetigtGb + 2 > o.freiGb) {
      throw Object.assign(new Error(`Zu wenig Platz: ${o.modell} braucht etwa ${o.benoetigtGb} GB (plus 2 GB Reserve), frei sind ${o.freiGb} GB im Modellordner.`), { status: 400 });
    }
    stand = pullStart(o.modell);
    ctrl = new AbortController();
    const signal = ctrl.signal;
    const basis = String(o.url).replace(/\/+$/, '');
    // "success" from Ollama is held back (fertig stays false at 100 %) until the stream ended AND onFertig
    // entered the model into the connection — the page announces "eingetragen" only when it is true.
    let erfolg = false;
    laufend = streamFn(`${basis}/api/pull`, {
      method: 'POST',
      body: JSON.stringify({ model: o.modell, stream: true }),
      signal,
      onZeile: (z) => {
        if (!stand) return;
        const neu = pullZeileVerarbeiten(stand, z);
        if (neu.fertig) erfolg = true;
        stand = { ...neu, fertig: false };
      },
    }).then(({ status }) => {
      if (!stand) return;
      if (status >= 400 && !stand.fehler) stand = { ...stand, fehler: `Ollama antwortet ${status}` };
      else if (!erfolg && !stand.fehler && !stand.abgebrochen) stand = { ...stand, fehler: 'Der Download endete ohne Erfolgsmeldung von Ollama — bitte erneut starten (Ollama setzt fort).' };
      if (erfolg && !stand.fehler) {
        try { o.onFertig?.(o.modell); } catch (e) { console.error('[ki] onFertig:', /** @type {any} */ (e)?.message || e); }
        stand = { ...stand, fertig: true, prozent: 100 };
      }
    }).catch((err) => {
      if (!stand) return;
      if (stand.abgebrochen) return;
      stand = { ...stand, fehler: lokalerFehlerText(err, { provider: 'ollama', url: basis }) };
    });
    return stand;
  };

  /** @returns {PullStand|null} */
  const status = () => stand;

  /**
   * Cancel the running pull (Ollama keeps the finished layers; a new pull resumes).
   * @returns {PullStand|null}
   */
  const abbrechen = () => {
    if (stand && !stand.fertig && !stand.fehler) {
      stand = { ...stand, abgebrochen: true, status: 'abgebrochen' };
      ctrl?.abort();
    }
    return stand;
  };

  /** For tests: resolves when the running pull finished. @returns {Promise<void>} */
  const warten = () => laufend ?? Promise.resolve();

  return { start, status, abbrechen, warten };
}

// --- Benchmark --------------------------------------------------------------------------------

/**
 * Evaluate an /api/generate answer (stream: false). Durations from Ollama are nanoseconds.
 * @param {any} j answer JSON
 * @returns {{ tokenProSekunde: number, ersteAntwortMs: number, tokens: number, ladezeitMs: number }|null} null when the fields are missing
 */
export function benchmarkAuswerten(j) {
  const evalCount = Number(j?.eval_count);
  const evalNs = Number(j?.eval_duration);
  if (!(evalCount > 0) || !(evalNs > 0)) return null;
  const ladeNs = Number(j?.load_duration) || 0;
  const promptNs = Number(j?.prompt_eval_duration) || 0;
  return {
    tokenProSekunde: Math.round((evalCount / (evalNs / 1e9)) * 10) / 10,
    ersteAntwortMs: Math.round((ladeNs + promptNs) / 1e6),
    tokens: evalCount,
    ladezeitMs: Math.round(ladeNs / 1e6),
  };
}

/**
 * Run the micro benchmark against an installed model.
 * @param {{ url: string, modell: string, signal?: AbortSignal, anfrageFn?: typeof httpAnfrage, timeoutMs?: number }} o
 *   timeoutMs default 10 min (first call loads the model)
 * @returns {Promise<{ ok: boolean, ergebnis?: ReturnType<typeof benchmarkAuswerten>, fehler?: string }>}
 */
export async function benchmarkAusfuehren(o) {
  if (!istLoopbackUrl(o.url)) return { ok: false, fehler: 'Ollama muss auf diesem Rechner laufen' };
  const basis = String(o.url).replace(/\/+$/, '');
  try {
    const r = await (o.anfrageFn ?? httpAnfrage)(`${basis}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: o.modell, prompt: BENCHMARK_PROMPT, stream: false, options: { num_predict: BENCHMARK_TOKENS, temperature: 0 } }),
      signal: o.signal,
      timeoutMs: o.timeoutMs ?? 10 * 60 * 1000,
    });
    if (!r.ok) return { ok: false, fehler: `Ollama antwortet ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const ergebnis = benchmarkAuswerten(await r.json());
    if (!ergebnis) return { ok: false, fehler: 'Ollama hat keine Messwerte geliefert (eval_count/eval_duration fehlen).' };
    return { ok: true, ergebnis };
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'AbortError' && o.signal?.aborted) return { ok: false, fehler: 'Messung abgebrochen.' };
    return { ok: false, fehler: lokalerFehlerText(err, { provider: 'ollama', url: basis }) };
  }
}
