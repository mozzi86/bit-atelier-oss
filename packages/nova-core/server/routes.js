// nova-core Server-Basis: Router-Factories für Auth (lokaler Mock), generisches
// Entity-CRUD und den LLM-Proxy. Extrahiert 1:1 aus server/index.js (Phase 31).
// Pfade OHNE /api-Präfix — die Kompositionswurzel mountet unter '/api'.
import express from 'express';
import { invokeLLM, callConnection, PROVIDER_DEFAULTS } from './llm.js';
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
  const gesperrt = [LLM_ENTITY, ...PERSONAL_ENTITAETEN];
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

export function entitiesRouter(db) {
  const r = express.Router();

  // LlmConnection enthält API-Schlüssel und ist über das generische CRUD
  // gesperrt — Verwaltung nur über /llm/connections (maskierte Antworten).
  r.use('/entities/LlmConnection', (_req, res) => {
    res.status(403).json({ error: 'LlmConnection nur über /api/llm/connections verwaltbar' });
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
    const angelegt = db.bulkCreate(req.params.entity, records);
    res.status(201).json({ created: angelegt.length, ids: angelegt.map((r2) => r2.id) });
  });

  r.put('/entities/:entity/bulk', (req, res) => {
    const records = req.body?.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Body braucht { records: [...] }' });
    }
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
    const record = db.create(req.params.entity, req.body || {});
    res.status(201).json(record);
  });

  r.put('/entities/:entity/:id', (req, res) => {
    const record = db.update(req.params.entity, req.params.id, req.body || {});
    if (!record) return res.status(404).json({ error: 'Not found' });
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

// db ist optional (Abwärtskompatibilität): ohne db keine Verbindungs-Verwaltung.
export function llmRouter(db) {
  const r = express.Router();

  r.post('/integrations/invoke-llm', async (req, res) => {
    try {
      const conn = db ? activeConnection(db) : null;
      const result = await invokeLLM(req.body || {}, conn);
      res.json(result);
    } catch (err) {
      console.error('InvokeLLM error:', err.message || err);
      res.status(500).json({ error: err.message || 'LLM invocation failed' });
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

    // Verbindungstest: Mini-Prompt, 15 s Timeout. Offline-Konvention:
    // immer HTTP 200 mit { ok:false, fehler } bei Nichterreichbarkeit.
    r.post('/llm/test', async (req, res) => {
      const body = req.body || {};
      let conn;
      if (body.id) {
        const stored = db.get(LLM_ENTITY, body.id);
        if (!stored) return res.json({ ok: false, fehler: 'Verbindung nicht gefunden' });
        // RC-04: der gespeicherte Schlüssel reist nur an das Ziel, für das er
        // gespeichert wurde.
        if (!body.api_key && zielGeaendert(stored, body)) {
          return res.json({
            ok: false,
            fehler: 'Anbieter oder Basis-URL geändert — bitte den API-Schlüssel erneut eingeben. Der gespeicherte Schlüssel wird für ein anderes Ziel nicht verwendet.',
          });
        }
        // Formularwerte überschreiben Gespeichertes; leerer Key = gespeicherten nutzen.
        conn = { ...stored, ...body, api_key: body.api_key || stored.api_key };
      } else {
        conn = body;
      }
      if (!conn.provider) return res.json({ ok: false, fehler: 'Anbieter fehlt' });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const t0 = Date.now();
      try {
        const antwort = await callConnection(
          conn,
          { prompt: 'Antworte nur mit dem Wort: OK' },
          { signal: controller.signal }
        );
        res.json({
          ok: true,
          modell: conn.model || '(Standard)',
          antwort: String(antwort).slice(0, 200),
          dauer_ms: Date.now() - t0,
        });
      } catch (err) {
        const fehler =
          err.name === 'AbortError'
            ? 'Zeitüberschreitung (15 s) — Endpoint nicht erreichbar'
            : err.message || 'Verbindung fehlgeschlagen';
        res.json({ ok: false, fehler, dauer_ms: Date.now() - t0 });
      } finally {
        clearTimeout(timer);
      }
    });

    r.get('/llm/defaults', (_req, res) => res.json(PROVIDER_DEFAULTS));
  }

  return r;
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
