// papierkorbRouter.js — soft delete for records: the recycle bin (plan 111-02, finding K-07).
//
// Until 111-02 every delete was hard (DELETE /entities/:e/:id → db.remove → splice). This module adds a second road that never
// loses a record: the record is copied with time, reason and origin into the collection `Papierkorb`, and only then removed from
// its own collection. Restoring puts it back with the SAME id, but only while that id is free in the target collection
// (db.create takes a given id unchecked, finding B-111-02-01 - so the check happens here, before the call).
// The generic CRUD stays as it is; the bin itself is read-only there (papierkorbSperre, mounted before entitiesRouter).
// The app's own delete buttons still delete hard (a follow-up plan decides whether they move to the bin as well).
//
// In:  a createDb() store; HTTP requests under /api (mount after the session guard).
// Out: POST /papierkorb/:entity/:id {grund?, herkunft: 'mcp'|'app'} → 201 the bin entry;
//      GET  /papierkorb?entity=&project_id= → entries, newest first;
//      POST /papierkorb/:id/wiederherstellen → 200 {ok, datensatz} or 409 with the reason;
//      the pure functions below for tests and other callers.
// Imports only core (routes.js for the lock lists and their texts).

import express from 'express';
import { gesperrteEntitaet, nurPersonSchreibt, personImBrowser, standVeraltet, NUR_PERSON_TEXT, STAND_KONFLIKT_TEXT } from './routes.js';

/** Collection of the bin entries (additive, new in 111-02). */
export const PAPIERKORB_ENTITY = 'Papierkorb';

/**
 * Days an entry stays in the bin before it is cleaned up (at start and before every list).
 * [ASSUMED] 90 days: long enough to notice a wrong delete after a holiday, short enough that the bin does not grow without end;
 * the office may want a setting for this (D-IDEE-04) - then this is only the start value.
 */
export const AUFBEWAHRUNG_TAGE = 90;

/** Origins a bin entry may name: the MCP server (an agent) or the app's own page. */
export const HERKUENFTE = Object.freeze(['mcp', 'app']);

/** Longest reason stored with an entry, in characters (same limit as begruendung.grund of the MCP server). */
export const MAX_GRUND_ZEICHEN = 500;

/** 403 text: the generic CRUD never writes into the bin. */
export const PAPIERKORB_GESPERRT_TEXT = 'Der Papierkorb ist über das allgemeine Speichern nur lesbar — Löschen und Wiederherstellen gehen über /api/papierkorb';

/** Entity names the bin accepts (same form as the MCP server's ENTITAET_MUSTER). */
const ENTITAET_MUSTER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** One day in milliseconds. */
const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} PapierkorbEintrag
 * @property {string} id            id of the entry (not of the record)
 * @property {string} entity        collection the record came from
 * @property {string} record_id     id of the record; restored with this id
 * @property {string|null} project_id  project of the record (Project records: their own id), for the filter
 * @property {Record<string, any>} datensatz  the record as it was stored, unchanged
 * @property {string} geloescht_am  ISO time of the delete
 * @property {string|null} grund    reason in words, or null
 * @property {'mcp'|'app'} herkunft who deleted
 */

/**
 * @typedef {{ok: true, status: number, eintrag?: PapierkorbEintrag, datensatz?: Record<string, any>, entity?: string} |
 *   {ok: false, status: number, fehler: string}} Ergebnis
 *   status: the HTTP status the route answers with; entity: collection of a restored record
 */

/**
 * Why a write on this entity is refused, in the same words as the generic CRUD; null = allowed.
 * @param {string} entity  entity name (decoded)
 * @param {boolean} person true = the person at the app page (personImBrowser)
 * @returns {{status: number, fehler: string}|null}
 */
function sperreFuer(entity, person) {
  if (!ENTITAET_MUSTER.test(String(entity ?? ''))) return { status: 400, fehler: `Ungültige Entität ${JSON.stringify(entity)}` };
  if (String(entity).toLowerCase() === PAPIERKORB_ENTITY.toLowerCase()) return { status: 400, fehler: 'Einträge des Papierkorbs selbst kommen nicht in den Papierkorb' };
  const gesperrt = gesperrteEntitaet(entity);
  if (gesperrt) return { status: 403, fehler: gesperrt };
  if (nurPersonSchreibt(entity) && !person) return { status: 403, fehler: NUR_PERSON_TEXT };
  return null;
}

/**
 * Whether the bin collection exists yet. db.list() would create an empty one (and write db.json) - a store that never
 * deleted anything keeps no `Papierkorb: []`.
 * @param {any} db @returns {boolean}
 */
function hatPapierkorb(db) {
  const roh = typeof db?._raw === 'function' ? db._raw() : null;
  return Array.isArray(roh?.[PAPIERKORB_ENTITY]);
}

/**
 * Removes bin entries older than the keeping time. An entry whose time cannot be read is kept (never delete what cannot be dated).
 * @param {any} db  createDb() store
 * @param {Date} [jetzt]  the clock (tests inject it)
 * @param {number} [tage]  keeping time in days
 * @returns {number} entries removed
 */
export function papierkorbAufraeumen(db, jetzt = new Date(), tage = AUFBEWAHRUNG_TAGE) {
  if (!hatPapierkorb(db)) return 0;
  const grenze = jetzt.getTime() - tage * TAG_MS;
  const alt = db.list(PAPIERKORB_ENTITY).filter((e) => {
    const t = Date.parse(String(e?.geloescht_am ?? ''));
    return Number.isFinite(t) && t < grenze;
  });
  for (const e of alt) db.remove(PAPIERKORB_ENTITY, e.id);
  return alt.length;
}

/**
 * Moves one record into the bin: copy first (with time, reason, origin), then remove it from its collection.
 * @param {any} db  createDb() store
 * @param {string} entity  collection of the record
 * @param {string} id  record id
 * @param {{grund?: unknown, herkunft?: unknown, person?: boolean, jetzt?: Date, stand?: string}} [o]  stand: updated_date the caller saw (ISO); older than the record → 409
 *   grund: reason in words (cut to MAX_GRUND_ZEICHEN); herkunft: one of HERKUENFTE; person: personImBrowser(req)
 * @returns {Ergebnis} status 201 with the entry, or the refusal (400/403/404)
 */
export function inPapierkorb(db, entity, id, { grund, herkunft, person = false, jetzt = new Date(), stand } = {}) {
  const sperre = sperreFuer(entity, person);
  if (sperre) return { ok: false, ...sperre };
  if (!HERKUENFTE.includes(/** @type {any} */ (herkunft))) return { ok: false, status: 400, fehler: `herkunft muss ${HERKUENFTE.join(' oder ')} sein` };
  // db.get() creates a missing collection (and writes db.json) - a typo in the entity name must not leave an empty one (review 111-02)
  const roh = typeof db?._raw === 'function' ? db._raw() : null;
  const datensatz = roh && !Array.isArray(roh[entity]) ? null : db.get(entity, String(id));
  if (!datensatz) return { ok: false, status: 404, fehler: `${entity} ${id} nicht gefunden — schon gelöscht oder nie angelegt` };
  // the same stale-base rule as PUT ?stand= (routes.js): a delete prepared on an older state is refused, nothing moves
  if (standVeraltet(datensatz, stand)) return { ok: false, status: 409, fehler: STAND_KONFLIKT_TEXT };
  const text = grund == null ? '' : String(grund).trim().slice(0, MAX_GRUND_ZEICHEN);
  const projektId = datensatz.project_id ?? (entity === 'Project' ? datensatz.id : null);
  const eintrag = db.create(PAPIERKORB_ENTITY, {
    entity, record_id: String(datensatz.id), project_id: projektId == null ? null : String(projektId),
    datensatz: JSON.parse(JSON.stringify(datensatz)), geloescht_am: jetzt.toISOString(), grund: text || null, herkunft,
  });
  db.remove(entity, String(id));
  return { ok: true, status: 201, eintrag };
}

/**
 * Puts a record from the bin back with its own id and fields - only while that id is free in its collection; then the
 * entry leaves the bin. An occupied id is "nicht übernommen" (409) with the reason; nothing is overwritten.
 * @param {any} db  createDb() store
 * @param {string} eintragId  id of the bin entry
 * @param {{person?: boolean}} [o]  person: personImBrowser(req)
 * @returns {Ergebnis} status 200 with the restored record, or the refusal (403/404/409)
 */
export function ausPapierkorb(db, eintragId, { person = false } = {}) {
  const eintrag = hatPapierkorb(db) ? db.get(PAPIERKORB_ENTITY, String(eintragId)) : null;
  if (!eintrag) return { ok: false, status: 404, fehler: `Papierkorb-Eintrag ${eintragId} nicht gefunden — papierkorb_lesen zeigt alle (nach ${AUFBEWAHRUNG_TAGE} Tagen wird aufgeräumt)` };
  const sperre = sperreFuer(eintrag.entity, person);
  if (sperre) return { ok: false, ...sperre };
  const belegt = db.get(eintrag.entity, String(eintrag.record_id));
  if (belegt) {
    return { ok: false, status: 409, fehler: `nicht übernommen: die id ${eintrag.record_id} ist in ${eintrag.entity} inzwischen wieder belegt — nichts wurde überschrieben` };
  }
  // db.create keeps the id of the record (B-111-02-01): wanted here, and safe because the id was checked free just above
  const datensatz = db.create(eintrag.entity, JSON.parse(JSON.stringify(eintrag.datensatz || {})));
  db.remove(PAPIERKORB_ENTITY, eintrag.id);
  return { ok: true, status: 200, datensatz, entity: eintrag.entity };
}

/**
 * The bin, cleaned up first, newest first; optional filter by entity and project.
 * @param {any} db @param {{entity?: unknown, project_id?: unknown}} [filter] @param {Date} [jetzt]
 * @returns {PapierkorbEintrag[]}
 */
export function papierkorbListe(db, { entity, project_id: projektId } = {}, jetzt = new Date()) {
  papierkorbAufraeumen(db, jetzt);
  if (!hatPapierkorb(db)) return [];
  const e = entity == null || entity === '' ? null : String(entity);
  const p = projektId == null || projektId === '' ? null : String(projektId);
  return db.list(PAPIERKORB_ENTITY, '-geloescht_am').filter((x) => (!e || x.entity === e) && (!p || x.project_id === p));
}

/**
 * Middleware before entitiesRouter: the generic CRUD may read the bin, never write it - for every client, the app's page
 * included (deleting and restoring have their own routes). Compares the DECODED name, any case (lesson of B-106-10-01).
 * @returns {import('express').RequestHandler}
 */
export function papierkorbSperre() {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const m = /^\/entities\/([^/]+)/.exec(req.path);
    if (!m) return next();
    let name;
    try { name = decodeURIComponent(m[1]); } catch { return next(); }
    if (name.toLowerCase() !== PAPIERKORB_ENTITY.toLowerCase()) return next();
    res.status(403).json({ error: PAPIERKORB_GESPERRT_TEXT });
  };
}

/**
 * Routes of the bin (mount under /api, after the session guard).
 * @param {any} db  createDb() store
 * @param {{jetzt?: () => Date, nachAenderung?: (w: {methode: 'POST'|'DELETE', entitaet: string, id: string, datensatz: any, vorher: any, req: any}) => void}} [o]
 *   jetzt: the clock (tests); nachAenderung: called after a record left or came back (server/index.js reports it to the change stream)
 * @returns {import('express').Router}
 */
export function papierkorbRouter(db, { jetzt = () => new Date(), nachAenderung } = {}) {
  const r = express.Router();
  papierkorbAufraeumen(db, jetzt());
  /** @param {Parameters<NonNullable<typeof nachAenderung>>[0]} w */
  const melden = (w) => {
    try { nachAenderung?.(w); } catch (err) { console.error(`[papierkorb] change not reported: ${/** @type {any} */ (err)?.message || err}`); }
  };

  r.get('/papierkorb', (req, res) => {
    res.json(papierkorbListe(db, { entity: req.query.entity, project_id: req.query.project_id }, jetzt()));
  });

  // Before '/papierkorb/:entity/:id': otherwise "wiederherstellen" would be read as a record id.
  r.post('/papierkorb/:id/wiederherstellen', (req, res) => {
    const e = ausPapierkorb(db, req.params.id, { person: personImBrowser(req) });
    if (!e.ok) return res.status(e.status).json({ error: e.fehler, uebernommen: false });
    melden({ methode: 'POST', entitaet: String(e.entity ?? ''), id: String(e.datensatz?.id ?? ''), datensatz: e.datensatz, vorher: null, req });
    res.status(200).json({ ok: true, uebernommen: true, entity: e.entity, datensatz: e.datensatz });
  });

  r.post('/papierkorb/:entity/:id', (req, res) => {
    const e = inPapierkorb(db, req.params.entity, req.params.id, {
      grund: req.body?.grund, herkunft: req.body?.herkunft, person: personImBrowser(req), jetzt: jetzt(),
      stand: typeof req.query.stand === 'string' ? req.query.stand : undefined,
    });
    if (!e.ok) return res.status(e.status).json({ error: e.fehler });
    melden({ methode: 'DELETE', entitaet: req.params.entity, id: req.params.id, datensatz: null, vorher: e.eintrag?.datensatz, req });
    res.status(201).json(e.eintrag);
  });

  return r;
}
