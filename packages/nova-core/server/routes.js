// nova-core Server-Basis: Router-Factories für Auth (lokaler Mock), generisches
// Entity-CRUD und den LLM-Proxy. Extrahiert 1:1 aus server/index.js (Phase 31).
// Pfade OHNE /api-Präfix — die Kompositionswurzel mountet unter '/api'.
import fs from 'node:fs';
import express from 'express';
import { invokeLLM, callConnection, PROVIDER_DEFAULTS, zielUrlFuer } from './llm.js';
import { bildFreigabe, bildZielText, zugestimmt } from '../src/lib/zeigen/bildKontext.js';
import { katalogPruefen } from '../src/lib/modellKatalog.js';
import {
  KI_EINSTELLUNG_ENTITY, kiEinstellungenLesen, kiEinstellungenSchreiben, nurLokalPruefen, modelleAbrufen,
} from './llmLokal.js';
import { istLoopbackUrl } from '../src/lib/kiLokal.js';
import { mitProjektKontext } from './llmKontext.js';
import { KATALOG_ENTITAETEN } from './catalog-seed.js';
import { PERSONAL_ENTITAETEN } from '../src/api/personalEntitaeten.js';

// --- Auth (local single-user mock) -----------------------------------------
// 83-02: neutral name instead of the old product name; no e-mail, so the
// settings page shows its own "Lokaler Nutzer" label. The id stays stable
// (records may carry it as author).
const DEV_USER = {
  id: 'local-user-1',
  full_name: 'Lokaler Nutzer',
  email: '',
  role: 'admin',
};

export function authRouter() {
  const r = express.Router();
  r.get('/auth/me', (_req, res) => res.json(DEV_USER));
  return r;
}

// --- Entity CRUD ------------------------------------------------------------
// GET /entities/:entity?sort=-created_date&<field>=<value>...
// Generisch: jede Entität funktioniert ohne Registrierung.

/**
 * Overview of the collections in a database (83-03, GET /api/entities).
 * Locked entities — LlmConnection (API keys) and the HR entities — are left out,
 * the same lock the CRUD routes below apply.
 * @param {{ _raw: () => Record<string, unknown> }} db a createDb() store
 * @returns {{ entitaeten: Array<{ name: string, anzahl: number, katalog: boolean }>,
 *   gesperrt: string[] }} sorted by name; anzahl = number of records
 */
export function entitaetenUebersicht(db) {
  const gesperrt = [LLM_ENTITY, KI_EINSTELLUNG_ENTITY, ...PERSONAL_ENTITAETEN];
  const roh = db._raw() || {};
  const entitaeten = Object.keys(roh)
    .filter((name) => !gesperrt.includes(name) && Array.isArray(roh[name]))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      anzahl: /** @type {unknown[]} */ (roh[name]).length,
      katalog: KATALOG_ENTITAETEN.includes(name),
    }));
  return { entitaeten, gesperrt };
}

/**
 * Whether an update was made on an outdated copy (93-03, office mode with several devices): the body carries
 * the `updated_date` the client loaded, and the stored record is newer. Without `updated_date` in the body
 * nothing can be said — false. ISO timestamps of db.js compare as strings.
 * @param {{updated_date?: string}} gespeichert stored record
 * @param {unknown} body request body
 * @returns {boolean}
 */
export function veralteterStand(gespeichert, body) {
  const geladen = body && typeof body === 'object' ? /** @type {any} */ (body).updated_date : undefined;
  if (typeof geladen !== 'string' || typeof gespeichert?.updated_date !== 'string') return false;
  return geladen < gespeichert.updated_date;
}

// --- 106-06: guarded project fields ----------------------------------------
/** Entity of the projects. */
const PROJEKT_ENTITY = 'Project';

/**
 * Whether a request is the person at the app page itself (106-06, review fix): what the consent and loosening the NDA marker need.
 * Browsers mark a request of the app's own page with `Sec-Fetch-Site: same-origin`. Over plain HTTP to a LAN address (office mode) browsers
 * send no Fetch Metadata - then the `Origin` must be this server's own address. A program's HTTP client (Node's fetch sends only
 * `Sec-Fetch-Mode: cors`, curl and test clients send nothing) is NOT the person - so the MCP server's update_record is not either.
 * Limit (stated in docs/KI-ANBINDUNG.md): this keeps out foreign web pages, MCP tools and agents without a shell; a local process that
 * forges the headers and fetches the session token (or simply edits db.json) is not stopped - nothing on this computer can stop that.
 * In the real server sitzungsSchutz.js also demands the session token for every request that carries Origin or Sec-Fetch-*.
 * @param {{headers?: Record<string, any>}} req @returns {boolean}
 */
export function personImBrowser(req) {
  const h = req?.headers || {};
  const seite = h['sec-fetch-site'];
  if (seite) return seite === 'same-origin';
  if (!h.origin || !h.host) return false;
  try { return new URL(String(h.origin)).host === String(h.host); } catch { return false; }
}

/** Response header naming the project fields a write could not set (comma-separated, ASCII); the record is still saved. */
export const FELD_GESCHUETZT_KOPF = 'X-Bit-Feld-Geschuetzt';

/**
 * Removes what a generic write must not set on a project (106-06, D-IM-02):
 *  - `bild_freigabe` (the consent that images may leave the device) from EVERY generic write: only POST /llm/bild-zustimmung, from the
 *    person's page, sets it - an agent with write access (MCP update_record) must not give consent for the person;
 *  - `nda` from a write that is not the person's page unless it switches the marker ON: a program may make a project stricter, never looser.
 * Other entities pass unchanged.
 * @param {string} entity @param {any} body @param {boolean} person  personImBrowser(req)
 * @param {string[]} [verworfen]  collects the names of the dropped fields (for FELD_GESCHUETZT_KOPF)
 * @returns {any} the same object, cleaned
 */
export function projektFelderSchuetzen(entity, body, person, verworfen = []) {
  if (entity !== PROJEKT_ENTITY || !body || typeof body !== 'object') return body;
  if ('bild_freigabe' in body) { delete body.bild_freigabe; if (!verworfen.includes('bild_freigabe')) verworfen.push('bild_freigabe'); }
  if (!person && body.nda !== undefined && body.nda !== true) { delete body.nda; if (!verworfen.includes('nda')) verworfen.push('nda'); }
  return body;
}

/**
 * Tells the caller which project fields were dropped (review fix 106-06: not silently). The app's own form echoes the stored record;
 * its `bild_freigabe` is dropped on purpose and needs no note, so for the person only `nda` would be named (never happens).
 * @param {any} res  Express response (header set) @param {string[]} verworfen @param {boolean} person
 */
function geschuetztMelden(res, verworfen, person) {
  const zeigen = person ? verworfen.filter((f) => f !== 'bild_freigabe') : verworfen;
  if (zeigen.length) res.setHeader(FELD_GESCHUETZT_KOPF, zeigen.join(','));
}

/**
 * The store's decision whether an image of the view of a project may go to a target (106-06, D-IM-02) - one function for the route
 * GET /llm/bild-freigabe and the control channel (server/index.js: an agent always counts as a target outside this computer).
 * @param {any} db @param {string|null} pid  project id (null = no project open)
 * @param {{zielLokal?: boolean, anbieter?: string, host?: string}} [o]  zielLokal: the target runs on this computer; anbieter/host: words for it
 * @returns {{ok: boolean, grund: string|null, text: string, projekt: any, einst: any}}  projekt null when not found; einst = KI settings
 */
export function bildFreigabeAusSpeicher(db, pid, o = {}) {
  const projekt = pid ? db.get(PROJEKT_ENTITY, String(pid)) : null;
  const einst = kiEinstellungenLesen(db);
  const zielLokal = o.zielLokal === true;
  const f = bildFreigabe({ projekt, zielLokal, nurLokal: einst.nur_lokal, bilderExtern: einst.bilder_extern !== false,
    ziel: bildZielText({ lokal: zielLokal, anbieter: o.anbieter || null, host: o.host || null }) });
  return { ...f, projekt, einst };
}

export function entitiesRouter(db) {
  const r = express.Router();

  // LlmConnection enthält API-Schlüssel und ist über das generische CRUD
  // gesperrt — Verwaltung nur über /llm/connections (maskierte Antworten).
  r.use('/entities/LlmConnection', (_req, res) => {
    res.status(403).json({ error: 'LlmConnection nur über /api/llm/connections verwaltbar' });
  });
  // 93-12: the AI switches ("Nur lokale KI" …) — a generic write could switch the guard off unvalidated.
  r.use(`/entities/${KI_EINSTELLUNG_ENTITY}`, (_req, res) => {
    res.status(403).json({ error: 'KI-Einstellungen nur über /api/llm/einstellungen' });
  });

  // Plan 80-02 (D-P80-A #4): Personal-Entitäten dürfen den generischen
  // CRUD-Pfad NIE erreichen — eigene Datei, eigene Sperren, nur über
  // /api/personal (personalRouter.js). REIHENFOLGE NICHT ÄNDERN: diese
  // r.use()-Zeilen müssen — wie die LlmConnection-Sperre oben — vor dem
  // Bulk-Pfad stehen, sonst matcht '/entities/:entity/bulk' zuerst.
  for (const name of PERSONAL_ENTITAETEN) {
    r.use(`/entities/${name}`, (_req, res) => {
      res.status(403).json({ error: 'Personaldaten nur über /api/personal' });
    });
  }

  // --- Bulk-Schreibpfad (Phase 33 / W0, T-33-03) --------------------------
  // MUSS vor '/entities/:entity/:id' stehen, sonst frisst die :id-Route "bulk".
  // Die LlmConnection-403-Sperre oben (r.use mit Pfad-Präfix) greift auch hier —
  // sie matcht '/entities/LlmConnection/bulk' mit. Reihenfolge NICHT ändern.
  r.post('/entities/:entity/bulk', (req, res) => {
    const records = req.body?.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Body braucht { records: [...] }' });
    }
    const person = personImBrowser(req), verworfen = /** @type {string[]} */ ([]);
    records.forEach((rec) => projektFelderSchuetzen(req.params.entity, rec, person, verworfen));
    geschuetztMelden(res, verworfen, person);
    const angelegt = db.bulkCreate(req.params.entity, records);
    res.status(201).json({ created: angelegt.length, ids: angelegt.map((r2) => r2.id) });
  });

  r.put('/entities/:entity/bulk', (req, res) => {
    const records = req.body?.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Body braucht { records: [...] }' });
    }
    const person = personImBrowser(req), verworfen = /** @type {string[]} */ ([]);
    records.forEach((rec) => projektFelderSchuetzen(req.params.entity, rec, person, verworfen));
    geschuetztMelden(res, verworfen, person);
    const key = req.body?.key || 'id';
    const { updated, created } = db.bulkUpsert(req.params.entity, records, key);
    res.json({ updated, created: created.length, ids: created.map((r2) => r2.id) });
  });

  // 83-03: which entities this database holds — read by the MCP server's
  // list_entity_types. The CRUD path is generic (any name works), so the only
  // registry is the database itself: every collection with its record count.
  // Locked entities (LlmConnection, the nine HR entities) are never listed.
  r.get('/entities', (_req, res) => {
    res.json(entitaetenUebersicht(db));
  });

  // Alle büroweiten Kataloge in EINEM Rutsch — spart 14 Requests beim Start.
  r.get('/catalogs', (_req, res) => {
    const out = {};
    for (const entity of KATALOG_ENTITAETEN) out[entity] = db.list(entity);
    res.json(out);
  });

  r.get('/entities/:entity', (req, res) => {
    const { entity } = req.params;
    const { sort, ...query } = req.query;
    const hasFilters = Object.keys(query).length > 0;
    const records = hasFilters
      ? db.filter(entity, query, sort)
      : db.list(entity, sort);
    res.json(records);
  });

  r.get('/entities/:entity/:id', (req, res) => {
    const record = db.get(req.params.entity, req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  });

  r.post('/entities/:entity', (req, res) => {
    const person = personImBrowser(req), verworfen = /** @type {string[]} */ ([]);
    const record = db.create(req.params.entity, projektFelderSchuetzen(req.params.entity, req.body || {}, person, verworfen));
    geschuetztMelden(res, verworfen, person);
    res.status(201).json(record);
  });

  r.put('/entities/:entity/:id', (req, res) => {
    const vorher = db.get(req.params.entity, req.params.id);
    const hinweis = vorher && veralteterStand(vorher, req.body);
    const person = personImBrowser(req), verworfen = /** @type {string[]} */ ([]);
    const record = db.update(req.params.entity, req.params.id, projektFelderSchuetzen(req.params.entity, req.body || {}, person, verworfen));
    if (!record) return res.status(404).json({ error: 'Not found' });
    geschuetztMelden(res, verworfen, person);
    // 93-03: last write still wins; the client only learns that it replaced a newer version.
    if (hinweis) res.setHeader('X-Bit-Hinweis', 'zwischenzeitlich-geaendert');
    res.json(record);
  });

  r.delete('/entities/:entity/:id', (req, res) => {
    const ok = db.remove(req.params.entity, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });

  return r;
}

// --- Integrations: LLM ------------------------------------------------------
const LLM_ENTITY = 'LlmConnection';

// API-Schlüssel niemals im Klartext zurückgeben — nur maskiert (sk-…abcd).
function maskKey(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

/**
 * True when a request would point a stored connection at another endpoint
 * (provider or base_url in the body and different from the stored row).
 * Trailing slashes are ignored. RC-04: gate for reusing a stored api_key.
 * @param {{provider?: string, base_url?: string}} gespeichert stored row
 * @param {Record<string, unknown>} body request body
 * @returns {boolean}
 */
export function zielGeaendert(gespeichert, body) {
  const norm = (v) => String(v ?? '').trim().replace(/\/+$/, '');
  const providerNeu = body.provider !== undefined && String(body.provider) !== String(gespeichert.provider ?? '');
  const urlNeu = body.base_url !== undefined && norm(body.base_url) !== norm(gespeichert.base_url);
  return providerNeu || urlNeu;
}

function publicConnection(conn) {
  if (!conn) return conn;
  const { api_key, ...rest } = conn;
  return { ...rest, api_key_masked: maskKey(api_key), has_api_key: Boolean(api_key) };
}

function activeConnection(db) {
  try {
    return db.list(LLM_ENTITY).find((c) => c.active) || null;
  } catch {
    return null;
  }
}

/**
 * 78-12: record source for the server-built project context (llmKontext.js) on the local JSON db.
 * Reads only the named project and rows whose project_id equals it; llmKontext filters the rows again.
 * @param {{ get: (entity: string, id: string) => any, filter: (entity: string, query: object) => any[] }} db
 * @returns {import('./llmKontext.js').KontextQuelle}
 */
export function lokaleKontextQuelle(db) {
  return {
    projekt: async (id) => db.get('Project', id),
    liste: async (entity, projektId) => db.filter(entity, { project_id: projektId }),
  };
}

/**
 * Merge the form values of /llm/test and /llm/modelle with a stored connection (RC-04: the stored key
 * only travels to the target it was stored for).
 * @param {any} db
 * @param {Record<string, any>} body request body ({id?, provider, base_url, model, api_key})
 * @returns {{ conn?: any, fehler?: string }}
 */
function verbindungAusBody(db, body) {
  if (!body.id) return { conn: body };
  const stored = db.get(LLM_ENTITY, body.id);
  if (!stored) return { fehler: 'Verbindung nicht gefunden' };
  if (!body.api_key && zielGeaendert(stored, body)) {
    return { fehler: 'Anbieter oder Basis-URL geändert — bitte den API-Schlüssel erneut eingeben. Der gespeicherte Schlüssel wird für ein anderes Ziel nicht verwendet.' };
  }
  // Formularwerte überschreiben Gespeichertes; leerer Key = gespeicherten nutzen.
  return { conn: { ...stored, ...body, api_key: body.api_key || stored.api_key } };
}

/** Timeout of the test prompt against a LOCAL server, ms. [ASSUMED] 10 min: the first call loads the model. */
const LOKALER_TEST_MS = 10 * 60 * 1000;

/**
 * LLM proxy + connection management. db is optional (backwards compatible): without it only
 * invoke-llm (env keys / offline mock) is offered.
 * 93-12: opt.onEinstellungen(neu, alt) runs after PUT /llm/einstellungen (server/index.js restarts the
 * managed harness so it picks up "Nur lokale KI").
 * @param {any} [db] createDb() store
 * @param {{ onEinstellungen?: (neu: any, alt: any) => void }} [opt]
 * @returns {import('express').Router}
 */
export function llmRouter(db, opt = {}) {
  const r = express.Router();

  r.post('/integrations/invoke-llm', async (req, res) => {
    try {
      const conn = db ? activeConnection(db) : null;
      // 106-06: images name their project separately (bild_projekt_id), so a request with an image does not switch on the project context
      const { bild_projekt_id: bildProjektId, ...body } = req.body || {};
      // 78-12: { projekt_id, kontext } → the server builds the context from exactly that project.
      const params = await mitProjektKontext(body, db ? lokaleKontextQuelle(db) : null);
      const einst = kiEinstellungenLesen(db);
      const pid = bildProjektId ?? body.projekt_id;
      // 93-12: "Nur lokale KI" is enforced here, server-side, for every AI feature of the app.
      // 106-06: the image gate reads the project (NDA, consent) and the office switch from the store, never from the request.
      const result = await invokeLLM(params, conn, {
        nurLokal: einst.nur_lokal, bilderExtern: einst.bilder_extern !== false,
        projekt: db && pid ? db.get(PROJEKT_ENTITY, String(pid)) : null, katalog: bildKatalog(einst),
      });
      res.json(result);
    } catch (err) {
      console.error('InvokeLLM error:', err.message || err);
      const status = Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
      res.status(status).json({ error: err.message || 'LLM invocation failed', ...(err?.grund ? { grund: err.grund } : {}) });
    }
  });

  if (db) {
    r.get('/llm/connections', (_req, res) => {
      res.json(db.list(LLM_ENTITY, '-updated_date').map(publicConnection));
    });

    r.post('/llm/connections', (req, res) => {
      const { name, provider, base_url, model, api_key, active } = req.body || {};
      if (!provider) return res.status(400).json({ error: 'Anbieter fehlt' });
      // Nur eine Verbindung gleichzeitig aktiv.
      if (active) {
        for (const c of db.list(LLM_ENTITY)) {
          if (c.active) db.update(LLM_ENTITY, c.id, { active: false });
        }
      }
      const record = db.create(LLM_ENTITY, {
        name: name || '',
        provider,
        base_url: base_url || '',
        model: model || '',
        api_key: api_key || '',
        active: Boolean(active),
      });
      res.status(201).json(publicConnection(record));
    });

    r.put('/llm/connections/:id', (req, res) => {
      const existing = db.get(LLM_ENTITY, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { name, provider, base_url, model, api_key, active } = req.body || {};
      if (active) {
        for (const c of db.list(LLM_ENTITY)) {
          if (c.active && c.id !== req.params.id) db.update(LLM_ENTITY, c.id, { active: false });
        }
      }
      // RC-04 (74-01 Task 9): neues Ziel ohne neuen Schlüssel → gespeicherter
      // Schlüssel wird gelöscht, sonst ginge er beim nächsten Aufruf an die
      // neue base_url.
      const zielNeu = !api_key && zielGeaendert(existing, req.body || {});
      const patch = {
        ...(name !== undefined ? { name } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(base_url !== undefined ? { base_url } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(active !== undefined ? { active: Boolean(active) } : {}),
        // Leeres api_key-Feld = Schlüssel unverändert lassen (write-only) —
        // außer das Ziel hat sich geändert, dann muss er neu eingegeben werden.
        ...(api_key ? { api_key } : zielNeu ? { api_key: '' } : {}),
      };
      const record = db.update(LLM_ENTITY, req.params.id, patch);
      res.json(publicConnection(record));
    });

    r.delete('/llm/connections/:id', (req, res) => {
      const ok = db.remove(LLM_ENTITY, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    });

    // Verbindungstest: Mini-Prompt. Offline-Konvention: immer HTTP 200 mit { ok:false, fehler }.
    // 93-12: a LOCAL target is tested in two steps — the model list first (8 s: is the server running,
    // which models are there), then the prompt with a long timeout (the first call loads the model into
    // memory; minutes on a 10 GB card). Cloud targets keep the 15 s. "Nur lokale KI" refuses non-local
    // targets before any request. Closing the browser request aborts the upstream call.
    r.post('/llm/test', async (req, res) => {
      const { conn, fehler: bodyFehler } = verbindungAusBody(db, req.body || {});
      if (bodyFehler) return res.json({ ok: false, fehler: bodyFehler });
      if (!conn.provider) return res.json({ ok: false, fehler: 'Anbieter fehlt' });
      const ziel = zielUrlFuer(conn);
      try {
        nurLokalPruefen(ziel, kiEinstellungenLesen(db).nur_lokal);
      } catch (err) {
        return res.json({ ok: false, fehler: err.message, gesperrt: true });
      }
      const lokal = istLoopbackUrl(ziel);
      const t0 = Date.now();
      /** @type {string[]|undefined} */
      let modelle;
      if (lokal) {
        const liste = await modelleAbrufen({ ...conn, base_url: conn.base_url || PROVIDER_DEFAULTS[conn.provider] || '' });
        if (!liste.ok) return res.json({ ok: false, fehler: liste.fehler, lokal, dauer_ms: Date.now() - t0 });
        modelle = liste.modelle;
        if (conn.model && modelle.length && !modelle.includes(conn.model)) {
          return res.json({ ok: false, lokal, modelle, dauer_ms: Date.now() - t0, fehler: `Server läuft, aber das Modell „${conn.model}“ ist dort nicht vorhanden. Vorhanden: ${modelle.slice(0, 8).join(', ')}` });
        }
      }

      const timeoutMs = lokal ? LOKALER_TEST_MS : 15000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      try {
        const antwort = await callConnection(
          conn,
          { prompt: 'Antworte nur mit dem Wort: OK' },
          { signal: controller.signal, timeoutMs }
        );
        res.json({
          ok: true,
          lokal,
          modelle,
          modell: conn.model || '(Standard)',
          antwort: String(antwort).slice(0, 200),
          dauer_ms: Date.now() - t0,
        });
      } catch (err) {
        const fehler =
          err.name === 'AbortError'
            ? `Zeitüberschreitung (${Math.round(timeoutMs / 1000)} s) — Endpoint nicht erreichbar`
            : err.message || 'Verbindung fehlgeschlagen';
        if (!res.writableEnded) res.json({ ok: false, lokal, modelle, fehler, dauer_ms: Date.now() - t0 });
      } finally {
        clearTimeout(timer);
      }
    });

    // 93-12: model discovery for the connection form (GET /v1/models resp. /api/tags).
    r.post('/llm/modelle', async (req, res) => {
      const { conn, fehler } = verbindungAusBody(db, req.body || {});
      if (fehler) return res.json({ ok: false, modelle: [], fehler });
      if (!conn.provider) return res.json({ ok: false, modelle: [], fehler: 'Anbieter fehlt' });
      try {
        res.json(await modelleAbrufen({ ...conn, base_url: conn.base_url || PROVIDER_DEFAULTS[conn.provider] || '' }, { nurLokal: kiEinstellungenLesen(db).nur_lokal }));
      } catch (err) {
        res.json({ ok: false, modelle: [], fehler: err.message, gesperrt: Boolean(err.nurLokal) });
      }
    });

    // 93-12: AI switches. GET answers with the catalog's date only — the catalog itself travels through
    // /api/ki/katalog (server/kiLokalRouter.js).
    const oeffentlich = (e) => ({ ...e, katalog: e.katalog ? { stand: e.katalog.stand } : null });
    r.get('/llm/einstellungen', (_req, res) => res.json(oeffentlich(kiEinstellungenLesen(db))));
    r.put('/llm/einstellungen', (req, res) => {
      // benchmark and katalog are written by the server itself (kiLokalRouter), never by the form.
      const { benchmark: _b, katalog: _k, ...patch } = req.body || {};
      const alt = kiEinstellungenLesen(db);
      try {
        const neuWert = kiEinstellungenSchreiben(db, patch);
        try { opt.onEinstellungen?.(neuWert, alt); } catch (e) { console.error('[ki] onEinstellungen:', e?.message || e); }
        res.json(oeffentlich(neuWert));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    r.get('/llm/defaults', (_req, res) => res.json(PROVIDER_DEFAULTS));

    // 106-06 (D-IM-02): may an image of the view of this project go to a target? GET: read-only, for the speech field, the AI harness and
    // the MCP server (non-browser clients read without a session). ziel=extern (default) = outside this computer, ziel=lokal = on it.
    r.get('/llm/bild-freigabe', (req, res) => {
      const pid = String(req.query.projekt_id ?? '').trim();
      const f = bildFreigabeAusSpeicher(db, pid || null, { zielLokal: String(req.query.ziel ?? 'extern') === 'lokal',
        host: String(req.query.host ?? '').slice(0, 200), anbieter: String(req.query.anbieter ?? '').slice(0, 80) });
      if (pid && !f.projekt) return res.status(404).json({ ok: false, grund: 'ohne-projekt', text: `Projekt ${pid} nicht gefunden — kein Bild` });
      const { projekt, einst, ...entscheidung } = f;
      res.json({ ...entscheidung, projekt_id: pid || null, nda: projekt?.nda === true, zugestimmt: zugestimmt(projekt),
        am: projekt?.bild_freigabe?.am ?? null, nur_lokal: einst.nur_lokal, bilder_extern: einst.bilder_extern !== false });
    });

    // 106-06: the person's consent, once per project. Only from the app's own page (personImBrowser; in the real server sitzungsSchutz also
    // demands the session token) - an MCP tool or a program's HTTP client never consents for the person. Refused for an NDA project (the
    // marker wins, there is nothing to consent to). Limit: a local process that forges browser headers is not stopped (see personImBrowser).
    r.post('/llm/bild-zustimmung', (req, res) => {
      if (!personImBrowser(req)) return res.status(403).json({ error: 'Die Zustimmung gibt nur die Person in BIT-Atelier (Knopf „mit Bild“ im Viewer), kein Programm' });
      const pid = String(req.body?.projekt_id ?? '').trim();
      const projekt = pid ? db.get(PROJEKT_ENTITY, pid) : null;
      if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden' });
      if (projekt.nda === true) return res.status(409).json({ error: 'NDA-Projekt: es geht nie ein Bild an ein Sprachmodell — keine Zustimmung möglich' });
      const neu = db.update(PROJEKT_ENTITY, pid, { bild_freigabe: { am: new Date().toISOString(), durch: 'person' } });
      res.json({ ok: true, projekt_id: pid, am: neu?.bild_freigabe?.am ?? null });
    });
    // withdrawing makes it stricter: allowed for every client
    r.delete('/llm/bild-zustimmung', (req, res) => {
      const pid = String(req.query.projekt_id ?? '').trim();
      if (!pid || !db.get(PROJEKT_ENTITY, pid)) return res.status(404).json({ error: 'Projekt nicht gefunden' });
      db.update(PROJEKT_ENTITY, pid, { bild_freigabe: null });
      res.json({ ok: true, projekt_id: pid });
    });
  }

  return r;
}

/** Bundled catalog of local models, read once (106-06: which local model reads images). @type {any} */
let mitgeliefert;

/**
 * The catalog the image check uses: the updated one from the settings, else the bundled lokaleModelle.json.
 * @param {{katalog?: any}} einst KI settings @returns {any|null}
 */
function bildKatalog(einst) {
  if (einst?.katalog?.modelle) return einst.katalog;
  if (mitgeliefert === undefined) {
    try {
      mitgeliefert = katalogPruefen(JSON.parse(fs.readFileSync(new URL('../src/lib/lokaleModelle.json', import.meta.url), 'utf8'))).katalog;
    } catch {
      mitgeliefert = null; // without the file only the model-id patterns decide
    }
  }
  return mitgeliefert;
}

// --- Blob-Store (Phase 33 / W3) --------------------------------------------
// Große, ABGELEITETE Nutzlasten (die 6.038 Bauteile eines IFC-Stands) liegen
// NEBEN db.json: als Entitäten würden sie jeden Positions-Speichervorgang zu
// einem Mehr-Megabyte-Schreibvorgang machen (T-33-03). Sie sind reproduzierbar
// (IFC erneut lesen) und deshalb kein nutzergepflegter Datensatz.
//
// Die id-Whitelist steckt im Store (Path-Traversal); hier kommt die Größen-
// grenze dazu, damit ein Upload nicht den Speicher sprengt (ASVS V5).
export function blobsRouter(blobs, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const r = express.Router();

  r.get('/blobs', (_req, res) => {
    res.json(blobs.list().map((id) => ({ id, bytes: blobs.size(id) })));
  });

  r.get('/blobs/:id', (req, res) => {
    let daten;
    try {
      daten = blobs.get(req.params.id);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (daten == null) return res.status(404).json({ error: 'Blob nicht vorhanden' });
    res.json(daten);
  });

  r.put('/blobs/:id', express.json({ limit: maxBytes }), (req, res) => {
    if (req.body == null) return res.status(400).json({ error: 'Leerer Body' });
    try {
      const bytes = blobs.put(req.params.id, req.body);
      res.json({ id: req.params.id, bytes });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  r.delete('/blobs/:id', (req, res) => {
    try {
      res.json({ deleted: blobs.remove(req.params.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return r;
}

// 76-01: same import location as llmRouter for the shells; implementation in typesafe.js.
export { typesafeRouter } from './typesafe.js';
