// personalRouter.js — the Express side of the "personal" storage class
// (Plan 80-02, D-P80-A #4): its OWN JSON file (server/personal.json, never
// server/db.json) and its OWN blob directory (server/personal-blobs/, never
// server/blobs/), so an office's HR data is a separate file the office
// controls (back up, encrypt, exclude from OneDrive sync) independently of
// the project database.
//
// Why a second router and not a flag on entitiesRouter: routes.js already
// rejects every Personal entity on the GENERIC /entities path (403, D-P80-A
// #4) — this router is the ONLY way in, mounted on its OWN prefix
// (/personal, /personal-dateien), so there is exactly one code path to audit
// for the six DS-05 guarantees (loopback, 403 elsewhere, own file, own blobs,
// unknown entity → 404).
//
// D-P80-05 (Loopback): the office's HR data must not answer to the LAN just
// because the project API happens to (a deliberate LAN setup via API_HOST) —
// `lokalGebunden` is computed once in server/index.js from the SAME env var
// that binds the HTTP server (API_HOST) and passed in here; PERSONAL_LAN=1 is
// a SEPARATE, explicit opt-out an office has to set on purpose.
//
// In:  db = createDb(.../personal.json), blobs = createBlobStore(.../personal-blobs),
//      { lokalGebunden } = the same boolean server/index.js binds HOST with.
// Out: JSON CRUD under /personal/:entity (list/filter/get/create/update/delete)
//      and /personal-dateien/:id (get/put/delete), mounted under /api by the
//      composition root.

import express from 'express';
import { istPersonalEntitaet } from '../src/api/personalEntitaeten.js';

/**
 * @param {ReturnType<typeof import('./db.js').createDb>} db the personal.json store
 * @param {ReturnType<typeof import('./blobs.js').createBlobStore>} blobs the personal-blobs/ store
 * @param {{lokalGebunden: boolean}} optionen loopback flag (server/index.js computes it from API_HOST)
 * @returns {import('express').Router}
 */
export function personalRouter(db, blobs, { lokalGebunden } = /** @type {any} */ ({})) {
  const r = express.Router();

  // D-P80-05: outside loopback, refuse unless the office explicitly opted in.
  // r.use() with a path prefix matches every method under it, same pattern as
  // the LlmConnection sperre in routes.js.
  const sperre = (_req, res, next) => {
    if (!lokalGebunden && process.env.PERSONAL_LAN !== '1') {
      return res.status(403).json({
        error:
          'Personaldaten nur lokal erreichbar (Server nicht an Loopback gebunden). ' +
          'PERSONAL_LAN=1 hebt die Sperre bewusst auf.',
      });
    }
    next();
  };
  r.use('/personal', sperre);
  r.use('/personal-dateien', sperre);

  /** @param {import('express').Response} res @param {string} entity */
  function pruefeEntitaet(res, entity) {
    if (istPersonalEntitaet(entity)) return true;
    res.status(404).json({ error: `"${entity}" ist keine Personal-Entität` });
    return false;
  }

  r.get('/personal/:entity', (req, res) => {
    if (!pruefeEntitaet(res, req.params.entity)) return;
    const { entity } = req.params;
    const { sort, ...query } = req.query;
    const hasFilters = Object.keys(query).length > 0;
    res.json(hasFilters ? db.filter(entity, query, sort) : db.list(entity, sort));
  });

  r.get('/personal/:entity/:id', (req, res) => {
    if (!pruefeEntitaet(res, req.params.entity)) return;
    const record = db.get(req.params.entity, req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  });

  r.post('/personal/:entity', (req, res) => {
    if (!pruefeEntitaet(res, req.params.entity)) return;
    res.status(201).json(db.create(req.params.entity, req.body || {}));
  });

  r.put('/personal/:entity/:id', (req, res) => {
    if (!pruefeEntitaet(res, req.params.entity)) return;
    const record = db.update(req.params.entity, req.params.id, req.body || {});
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  });

  r.delete('/personal/:entity/:id', (req, res) => {
    if (!pruefeEntitaet(res, req.params.entity)) return;
    const ok = db.remove(req.params.entity, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });

  // File payloads (Personaldokument's datei_ref) — same ID_MUSTER whitelist as
  // blobsRouter (blobs.js validates and throws; caught here as 400).
  r.get('/personal-dateien/:id', (req, res) => {
    let daten;
    try {
      daten = blobs.get(req.params.id);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (daten == null) return res.status(404).json({ error: 'Datei nicht vorhanden' });
    res.json(daten);
  });

  r.put('/personal-dateien/:id', (req, res) => {
    if (req.body == null) return res.status(400).json({ error: 'Leerer Body' });
    try {
      const bytes = blobs.put(req.params.id, req.body);
      res.json({ id: req.params.id, bytes });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  r.delete('/personal-dateien/:id', (req, res) => {
    try {
      res.json({ deleted: blobs.remove(req.params.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return r;
}
