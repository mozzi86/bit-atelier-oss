// kiLokalRouter.js — local AI and the harness inside the program (plan 93-12), mounted under /api by
// server/index.js. Loopback only: every route answers 403 while the API is reachable from the LAN
// (API_HOST opt-out) — starting processes, reading hardware and paths is nothing for other devices.
// Actions (POST/DELETE) additionally need an Origin of the app itself (same rule as systemRouter.js).
//
//   GET    /api/ki/harness                     status of the Python harness (+ autostart switch)
//   POST   /api/ki/harness/start|stop|neustart  manage the child process
//   POST   /api/ki/harness/einrichten           create harness/.venv + pinned packages (user click only)
//   GET    /api/ki/lokal/erkennen               is Ollama / LM Studio running?
//   POST   /api/ki/lokal/verwenden              { modell } → becomes the model of the Ollama connection
//   GET    /api/ki/katalog                      model catalog merged with installed Ollama models
//   POST   /api/ki/katalog/aktualisieren        newer catalog from the public repository (GitHub)
//   GET    /api/ki/hardware                     RAM/CPU/GPU/disk of this computer
//   GET    /api/ki/ollama/pull                  progress of the running pull
//   POST   /api/ki/ollama/pull                  { modell } start pulling (disk checked first)
//   DELETE /api/ki/ollama/pull                  cancel
//   POST   /api/ki/benchmark                    { modell } micro benchmark; closing the request cancels
//
// In:  { db, root, lokalGebunden, origins, port, harness?, pulls?, hardwareFn?, katalogFetchFn? }.
// Out: Express router; harnessUmgebung() for server/index.js.

import { Router } from 'express';
import { kiEinstellungenLesen, kiEinstellungenSchreiben } from '../packages/nova-core/server/llmLokal.js';
import { PROVIDER_DEFAULTS, zielUrlFuer } from '../packages/nova-core/server/llm.js';
import { istLoopbackUrl, openaiBasis } from '../packages/nova-core/src/lib/kiLokal.js';
import { neuererKatalog, mitInstallierten } from '../packages/nova-core/src/lib/modellKatalog.js';
import { hardwareErmitteln } from './hardware.js';
import {
  mitgelieferterKatalog, katalogHolen, katalogUrl, lokaleServerErkennen, ollamaTags, pullManager, benchmarkAusfuehren,
} from './ollamaDienst.js';

const LLM_ENTITY = 'LlmConnection';

/**
 * Environment for the harness child: the app's local AI connection and "Nur lokale KI".
 * Only an OpenAI-compatible LOCAL connection (LM Studio, Ollama, custom on loopback) is handed over —
 * the harness reads its own keys from harness/.env and never receives one from the app.
 *   BIT_NUR_LOKAL       "1" | "0"
 *   BIT_LOKAL_BASE_URL  OpenAI-compatible base, e.g. http://127.0.0.1:1234/v1 (Ollama: …:11434/v1)
 *   BIT_LOKAL_MODELL    model name of the connection
 *   BIT_LOKAL_ART       "ollama" | "openai" (Ollama gets its /api/tags as model list)
 *   HARNESS_ALLOWED_ORIGINS  the app's own origins (CORS of the harness)
 * @param {any} db
 * @param {string[]} origins allowed app origins
 * @returns {Record<string, string>}
 */
export function harnessUmgebung(db, origins = []) {
  const e = kiEinstellungenLesen(db);
  /** @type {Record<string, string>} */
  const env = { BIT_NUR_LOKAL: e.nur_lokal ? '1' : '0', HARNESS_ALLOWED_ORIGINS: origins.join(',') };
  /** @type {any} */
  let conn = null;
  try { conn = db.list(LLM_ENTITY).find((c) => c.active) || null; } catch { conn = null; }
  if (conn && conn.provider !== 'anthropic') {
    const voll = { ...conn, base_url: conn.base_url || PROVIDER_DEFAULTS[conn.provider] || '' };
    if (istLoopbackUrl(zielUrlFuer(voll)) && conn.model) {
      env.BIT_LOKAL_BASE_URL = openaiBasis(conn.provider, voll.base_url);
      env.BIT_LOKAL_MODELL = String(conn.model);
      env.BIT_LOKAL_ART = conn.provider === 'ollama' ? 'ollama' : 'openai';
    }
  }
  return env;
}

/**
 * Make `modell` the model of the Ollama connection (create it when missing). The new connection becomes
 * active only when no other connection is active or "Nur lokale KI" is on — a working cloud connection is
 * not switched off behind the user's back.
 * @param {any} db
 * @param {{ ollamaUrl: string, modell: string, nurLokal: boolean }} o
 * @returns {{ id: string, aktiv: boolean, neu: boolean }}
 */
export function modellAlsVerbindung(db, o) {
  const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  const alle = db.list(LLM_ENTITY);
  const vorhanden = alle.find((c) => c.provider === 'ollama' && norm(c.base_url || PROVIDER_DEFAULTS.ollama) === norm(o.ollamaUrl));
  if (vorhanden) {
    db.update(LLM_ENTITY, vorhanden.id, { model: o.modell });
    return { id: vorhanden.id, aktiv: Boolean(vorhanden.active), neu: false };
  }
  const aktiv = o.nurLokal || !alle.some((c) => c.active);
  if (aktiv) for (const c of alle) if (c.active) db.update(LLM_ENTITY, c.id, { active: false });
  const rec = db.create(LLM_ENTITY, { name: 'Ollama (lokal)', provider: 'ollama', base_url: o.ollamaUrl, model: o.modell, api_key: '', active: aktiv });
  return { id: rec.id, aktiv, neu: true };
}

/**
 * @param {{ db: any, root: string, lokalGebunden: boolean, origins?: string[], port: number|string,
 *   harness?: ReturnType<typeof import('./harnessProzess.js').harnessManager>,
 *   pulls?: ReturnType<typeof pullManager>, hardwareFn?: typeof hardwareErmitteln, katalogFetchFn?: typeof fetch }} o
 * @returns {import('express').Router}
 */
export function kiLokalRouter(o) {
  const r = Router();
  const erlaubteOrigins = new Set([`http://localhost:${o.port}`, `http://127.0.0.1:${o.port}`, ...(o.origins || [])]);
  const pulls = o.pulls ?? pullManager();
  const hardwareFn = o.hardwareFn ?? hardwareErmitteln;

  r.use('/ki', (req, res, next) => {
    if (!o.lokalGebunden) return res.status(403).json({ error: 'Nur verfügbar, solange die App ausschließlich auf diesem Rechner erreichbar ist (API_HOST nicht gesetzt).' });
    if (req.method !== 'GET' && !erlaubteOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    next();
  });

  // --- Harness ---
  const harnessAntwort = () => ({ ...(o.harness ? o.harness.status() : { zustand: 'nicht-eingerichtet', eingerichtet: false, log: [] }), autostart: kiEinstellungenLesen(o.db).harness_autostart, nurLokal: kiEinstellungenLesen(o.db).nur_lokal });
  r.get('/ki/harness', (_req, res) => res.json(harnessAntwort()));
  r.post('/ki/harness/:aktion', async (req, res) => {
    if (!o.harness) return res.status(501).json({ error: 'Harness-Verwaltung ist in diesem Build nicht verfügbar.' });
    const umgebung = harnessUmgebung(o.db, [...erlaubteOrigins]);
    const aktion = req.params.aktion;
    try {
      if (aktion === 'start') await o.harness.start(umgebung);
      else if (aktion === 'stop') await o.harness.stop();
      else if (aktion === 'neustart') await o.harness.neustart(umgebung);
      else if (aktion === 'einrichten') {
        // Long-running (minutes): answer right away, the page polls GET /ki/harness.
        o.harness.einrichten().catch((e) => console.error('[harness] Einrichtung:', e?.message || e));
      } else return res.status(404).json({ error: `Unbekannte Aktion ${aktion}` });
      res.json(harnessAntwort());
    } catch (err) {
      res.status(500).json({ error: /** @type {any} */ (err)?.message || String(err) });
    }
  });

  // --- Detection + connection ---
  r.get('/ki/lokal/erkennen', async (_req, res) => {
    const e = kiEinstellungenLesen(o.db);
    res.json(await lokaleServerErkennen({ ollamaUrl: e.ollama_url, lmstudioUrl: e.lmstudio_url }));
  });
  r.post('/ki/lokal/verwenden', (req, res) => {
    const modell = String(req.body?.modell || '').trim();
    if (!modell) return res.status(400).json({ error: 'Modell fehlt' });
    const e = kiEinstellungenLesen(o.db);
    res.json(modellAlsVerbindung(o.db, { ollamaUrl: e.ollama_url, modell, nurLokal: e.nur_lokal }));
  });

  // --- Catalog ---
  const katalog = () => {
    const mitgeliefert = mitgelieferterKatalog(o.root);
    const gespeichert = /** @type {any} */ (kiEinstellungenLesen(o.db).katalog);
    return neuererKatalog(mitgeliefert, gespeichert && Array.isArray(gespeichert.modelle) ? gespeichert : null) || mitgeliefert;
  };
  r.get('/ki/katalog', async (_req, res) => {
    try {
      const k = katalog();
      const tags = await ollamaTags(kiEinstellungenLesen(o.db).ollama_url);
      res.json({ stand: k.stand, quelle: k.quelle, hinweis: k.hinweis, aktualisierenUrl: katalogUrl(), ollamaLaeuft: tags.laeuft, modelle: mitInstallierten(k, { models: tags.models }) });
    } catch (err) {
      res.status(500).json({ error: /** @type {any} */ (err)?.message || String(err) });
    }
  });
  r.post('/ki/katalog/aktualisieren', async (_req, res) => {
    const aktuell = katalog();
    const geholt = await katalogHolen({ fetchFn: o.katalogFetchFn });
    if (!geholt.ok || !geholt.katalog) return res.json({ ok: false, stand: aktuell.stand, fehler: geholt.fehler });
    const neuer = geholt.katalog.stand > aktuell.stand;
    if (neuer) kiEinstellungenSchreiben(o.db, { katalog: geholt.katalog });
    res.json({ ok: true, neu: neuer, stand: neuer ? geholt.katalog.stand : aktuell.stand, warnungen: geholt.warnungen || [] });
  });

  // --- Hardware ---
  r.get('/ki/hardware', async (_req, res) => {
    try {
      res.json(await hardwareFn());
    } catch (err) {
      res.status(500).json({ error: /** @type {any} */ (err)?.message || String(err) });
    }
  });

  // --- Pull ---
  r.get('/ki/ollama/pull', (_req, res) => res.json(pulls.status()));
  r.post('/ki/ollama/pull', async (req, res) => {
    const modell = String(req.body?.modell || '').trim();
    const e = kiEinstellungenLesen(o.db);
    try {
      const eintrag = katalog().modelle.find((m) => m.tag === modell);
      const hw = await hardwareFn().catch(() => null);
      const stand = pulls.start({
        url: e.ollama_url,
        modell,
        benoetigtGb: eintrag ? eintrag.groesseQ4Gb : null,
        freiGb: hw?.plattenFreiGb ?? null,
        // Afterwards the model becomes the model of the local Ollama connection (task A).
        onFertig: (m) => modellAlsVerbindung(o.db, { ollamaUrl: e.ollama_url, modell: m, nurLokal: kiEinstellungenLesen(o.db).nur_lokal }),
      });
      res.json(stand);
    } catch (err) {
      res.status(/** @type {any} */ (err)?.status || 500).json({ error: /** @type {any} */ (err)?.message || String(err) });
    }
  });
  r.delete('/ki/ollama/pull', (_req, res) => res.json(pulls.abbrechen()));

  // --- Benchmark ---
  r.post('/ki/benchmark', async (req, res) => {
    const modell = String(req.body?.modell || '').trim();
    if (!modell) return res.status(400).json({ error: 'Modell fehlt' });
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    const e = kiEinstellungenLesen(o.db);
    const r2 = await benchmarkAusfuehren({ url: e.ollama_url, modell, signal: ctrl.signal });
    if (r2.ok && r2.ergebnis) {
      kiEinstellungenSchreiben(o.db, { benchmark: { modell, ...r2.ergebnis, datum: new Date().toISOString() } });
    }
    if (!res.writableEnded) res.json(r2);
  });

  return r;
}
