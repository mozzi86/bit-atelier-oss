// aenderungsStrom.js — 106-09: the change stream between devices (Server-Sent Events).
//
// Before 106-09 a change saved on one device reached another one only after a reload (BroadcastChannel served
// comments in ONE browser, aufBimModelAenderung served readers in ONE tab). Now every successful write of a
// streamed entity (the model record BimModel and the IFC change journal IfcAenderung) becomes one event, and every
// open page of the SAME project gets it at once:
//
//   GET /api/aenderungen?projekt=<id>[&seit=<seq>]  text/event-stream; event "bereit" first (with the identity of this
//                                            server run), then "aenderung" per write, a comment line as heartbeat.
//                                            Reconnects resume with Last-Event-ID (or ?seit=, used by a new leader tab).
//
// What an event carries: {seq, projekt, entitaet, id, art: angelegt|geaendert|geloescht, felder, updated_date,
// geraet: {id, name}|null (null = this computer), client (the writing tab, so it can ignore its own echo), zeit,
// datensatz?}. Small records (< DATENSATZ_MAX_BYTE: journal entries, a small model) ride along, so the other device has
// them before its own next save; a bigger model (several MB possible) is recognised by a bounded walk without
// serialising it and is read by the client with a normal GET. An event is a NOTE that something changed, never a
// command: nothing is confirmed or written because of it (D-IM-04 — the change was confirmed by the person on the
// device that wrote it, and it arrives as exactly that).
//
// Who gets the stream: this computer (loopback) and paired office-mode devices — bueroWaechter (bueroRouter.js) lets
// a device reach /api/aenderungen only with a valid pairing, and only for reading. A device gains no right through the
// stream: it learns what it could already read through /api/entities, and only for the project it names. A request
// from a foreign web page (Sec-Fetch-Site: cross-site) is refused before a connection is held open.
// Review 106-09: the pairing is checked again before EVERY event and heartbeat (nochGueltig), and revoking a device or
// switching office mode off closes its open streams at once (hub.schliessenFuer) — a revoked or expired device gets
// nothing more over a stream it opened before.
//
// In:  the database (createDb) for the project check and the record before a delete; the device of a request
//      (geraetVon); whether a stream holder may still read (nochGueltig). Out: aenderungsStrom() hub,
//      aenderungenMelden() middleware (mount BEFORE entitiesRouter), aenderungsRouter() (GET /aenderungen),
//      ereignisAusSchreiben() / sseBlock() (pure, unit-tested).

import crypto from 'node:crypto';
import { Router } from 'express';

/** Entities whose writes are streamed: the drawn model (one record per project) and the IFC change journal. */
export const STROM_ENTITAETEN = Object.freeze(['BimModel', 'IfcAenderung']);

/**
 * Open streams at most: all together and per source (one paired device or this computer's tabs).
 * [ASSUMED: an office has a handful of devices; since review 106-09 the tabs of one browser share ONE stream per project,
 * the limit keeps a broken client that reconnects in a loop from holding hundreds of sockets.]
 */
export const STROM_GRENZEN = Object.freeze({ gesamt: 48, jeQuelle: 12 });

/** Events kept per project for a reconnect (Last-Event-ID). [ASSUMED: a reconnect after a short network gap.] */
export const PUFFER_JE_PROJEKT = 100;

/**
 * Age after which a buffered event is dropped, ms. [ASSUMED: a reconnect comes within seconds; after a longer gap the
 * client reads the record again anyway (every "bereit" after the first one), so an old buffer only costs memory.]
 */
export const PUFFER_ALTER_MS = 10 * 60 * 1000;

/** Heartbeat comment interval, ms. Keeps proxies and the browser from closing an idle stream (typical idle limit 30–60 s). */
export const HERZSCHLAG_MS = 25000;

/** Largest record (JSON bytes) that rides along in an event; bigger ones are read by the client. */
export const DATENSATZ_MAX_BYTE = 16 * 1024;

/** Retry delay the browser uses after a dropped stream, ms (SSE field `retry`). */
export const WIEDERHOLEN_MS = 3000;

/** Request header of the writing tab (bitApi sends it on every request, see @core/lib/abgleich/clientKennung.js). */
export const CLIENT_KOPF = 'x-bit-client';

const CLIENT_MUSTER = /^[A-Za-z0-9_-]{8,64}$/;
const VERWALTUNG = new Set(['id', 'created_date', 'updated_date', 'project_id']);

/**
 * Whether a record is probably small enough to ride along, decided by a walk that stops after about `maxByte` of work —
 * never a JSON.stringify of a model of several MB on every save just to learn that it is too big (review 106-09).
 * Each value counts its text length plus 4 bytes; the exact size is checked afterwards on the (then small) JSON.
 * @param {any} rec @param {number} maxByte bytes @returns {boolean}
 */
export function vermutlichKlein(rec, maxByte) {
  let rest = maxByte;
  const stapel = [rec];
  while (stapel.length) {
    const v = stapel.pop();
    rest -= 4;
    if (typeof v === 'string') rest -= v.length;
    else if (v && typeof v === 'object') {
      const kinder = Array.isArray(v) ? v : Object.values(v);
      if (!Array.isArray(v)) for (const k of Object.keys(v)) rest -= k.length;
      for (const k of kinder) stapel.push(k);
    }
    if (rest < 0) return false;
  }
  return true;
}

/**
 * The writing tab of a request (header x-bit-client), or null when missing or malformed.
 * @param {{headers?: Record<string, any>}} req
 * @returns {string|null}
 */
export function clientAus(req) {
  const k = String(req?.headers?.[CLIENT_KOPF] || '');
  return CLIENT_MUSTER.test(k) ? k : null;
}

/**
 * @typedef {{seq: number, projekt: string, entitaet: string, id: string, art: 'angelegt'|'geaendert'|'geloescht',
 *   felder: string[], updated_date: string|null, geraet: {id: string, name: string}|null, client: string|null, zeit: string,
 *   datensatz?: any}} Ereignis
 */

/**
 * One event from a finished write (pure). Returns null when the write belongs to no project (nothing to stream).
 * @param {{methode: string, entitaet: string, id?: string|null, datensatz?: any, vorher?: any, body?: any,
 *   geraet?: {id: string, name: string}|null, client?: string|null, zeit?: string, maxByte?: number, mitDatensatz?: boolean}} w
 *   methode POST/PUT/DELETE; datensatz = the record the route answered (POST/PUT); vorher = the record before the write
 *   (PUT/DELETE); body = the request body (PUT: which fields were written); maxByte = largest record riding along, bytes;
 *   mitDatensatz false = never attach the record (a big one is skipped anyway, see vermutlichKlein)
 * @returns {Omit<Ereignis, 'seq'>|null}
 */
export function ereignisAusSchreiben({ methode, entitaet, id = null, datensatz = null, vorher = null, body = null, geraet = null, client = null, zeit, maxByte = DATENSATZ_MAX_BYTE, mitDatensatz = true }) {
  const art = methode === 'POST' ? 'angelegt' : methode === 'PUT' ? 'geaendert' : methode === 'DELETE' ? 'geloescht' : null;
  if (!art) return null;
  const rec = art === 'geloescht' ? vorher : datensatz;
  const projekt = rec?.project_id ?? vorher?.project_id ?? null;
  if (projekt == null || projekt === '') return null;
  const quelle = art === 'geaendert' ? (body && typeof body === 'object' ? body : {}) : (rec || {});
  const felder = Object.keys(quelle).filter((k) => !VERWALTUNG.has(k)).sort();
  /** @type {Omit<Ereignis, 'seq'>} */
  const e = {
    projekt: String(projekt), entitaet, id: String(rec?.id ?? id ?? ''), art, felder,
    updated_date: art === 'geloescht' ? null : (rec?.updated_date ?? null),
    geraet: geraet ? { id: String(geraet.id), name: String(geraet.name ?? '') } : null,
    client: client ?? null, zeit: zeit || new Date().toISOString(),
  };
  if (rec && mitDatensatz && vermutlichKlein(rec, maxByte)) {
    try {
      const json = JSON.stringify(rec);
      if (Buffer.byteLength(json, 'utf8') <= maxByte) e.datensatz = JSON.parse(json);
    } catch { /* not serialisable: the client reads it */ }
  }
  return e;
}

/**
 * One SSE block (pure): `id:` line (resume point), `event:` name, `data:` JSON on one line, blank line.
 * @param {string} name event name @param {any} daten payload (JSON) @param {number|null} [seq] event id
 * @returns {string}
 */
export function sseBlock(name, daten, seq = null) {
  return `${seq != null ? `id: ${seq}\n` : ''}event: ${name}\ndata: ${JSON.stringify(daten)}\n\n`;
}

/**
 * @typedef {{projekt: string, quelle: string, senden: (e: Ereignis) => void, gueltig: () => boolean, schliessen: () => void}} Abo
 *   gueltig = whether the holder may still read (pairing valid); schliessen = unsubscribes and ends the stream (res.end)
 */

/**
 * The hub: subscribers per project, a numbered short history per project for reconnects.
 * @param {{puffer?: number, pufferAlterMs?: number, grenzen?: {gesamt: number, jeQuelle: number}, jetzt?: () => string}} [o]
 *   puffer = events kept per project; pufferAlterMs = age after which a buffered event is dropped, ms
 */
export function aenderungsStrom({ puffer = PUFFER_JE_PROJEKT, pufferAlterMs = PUFFER_ALTER_MS, grenzen = STROM_GRENZEN, jetzt = () => new Date().toISOString() } = {}) {
  let seq = 0;
  /** Identity of this server run: a restart starts seq at 0 again, the client learns it from "bereit". */
  const instanz = crypto.randomBytes(6).toString('hex');
  /** @type {Set<Abo>} */
  const abos = new Set();
  /** @type {Map<string, Ereignis[]>} */
  const verlauf = new Map();

  /** Drops buffered events older than pufferAlterMs; a project without events leaves the map. @param {string} jetztIso */
  const pufferKuerzen = (jetztIso) => {
    const grenze = Date.parse(jetztIso) - pufferAlterMs;
    if (!Number.isFinite(grenze)) return;
    for (const [p, liste] of verlauf) {
      const rest = liste.filter((x) => !(Date.parse(x.zeit) < grenze));
      if (rest.length) verlauf.set(p, rest); else verlauf.delete(p);
    }
  };

  return {
    /** Identity of this server run (changes with every restart). */
    instanz,
    /**
     * Streams one event to every subscriber of its project and keeps it for reconnects. A subscriber whose holder may no
     * longer read (revoked or expired pairing, office mode off) is closed instead of served.
     * @param {Omit<Ereignis, 'seq'|'zeit'> & {zeit?: string}} e
     * @returns {Ereignis} the numbered event
     */
    melden(e) {
      seq += 1;
      const ereignis = /** @type {Ereignis} */ ({ ...e, zeit: e.zeit || jetzt(), seq });
      pufferKuerzen(jetzt());
      const liste = verlauf.get(ereignis.projekt) || [];
      liste.push(ereignis);
      if (liste.length > puffer) liste.splice(0, liste.length - puffer);
      verlauf.set(ereignis.projekt, liste);
      for (const abo of [...abos]) {
        if (abo.projekt !== ereignis.projekt) continue;
        if (!abo.gueltig()) { abo.schliessen(); continue; }
        try { abo.senden(ereignis); } catch { /* a dead socket is removed by its close handler */ }
      }
      return ereignis;
    },
    /**
     * Adds a subscriber of ONE project. Refused when a limit is reached.
     * @param {{projekt: string, quelle: string, senden: (e: Ereignis) => void, seit?: number|null, gueltig?: () => boolean,
     *   schliessen?: () => void}} a
     *   quelle = who holds the stream ("lokal" or "geraet:<id>"), counted against grenzen.jeQuelle; seit = last seq the
     *   client saw (Last-Event-ID); gueltig = may the holder still read; schliessen = ends its stream
     * @returns {{ok: true, abmelden: () => void, nachholen: Ereignis[]} | {ok: false, grund: string}}
     */
    abonnieren({ projekt, quelle, senden, seit = null, gueltig = () => true, schliessen }) {
      if (abos.size >= grenzen.gesamt) return { ok: false, grund: 'Zu viele offene Abgleich-Verbindungen an diesem Rechner.' };
      let eigene = 0;
      for (const a of abos) if (a.quelle === quelle) eigene += 1;
      if (eigene >= grenzen.jeQuelle) return { ok: false, grund: 'Zu viele offene Abgleich-Verbindungen von diesem Gerät.' };
      /** @type {Abo} */
      const abo = { projekt: String(projekt), quelle, senden, gueltig, schliessen: () => { abos.delete(abo); schliessen?.(); } };
      abos.add(abo);
      const nachholen = seit != null && Number.isFinite(seit) ? (verlauf.get(abo.projekt) || []).filter((x) => x.seq > seit) : [];
      return { ok: true, abmelden: () => { abos.delete(abo); }, nachholen };
    },
    /**
     * Closes every open stream whose holder matches (a revoked device; every device when office mode goes off).
     * @param {(quelle: string) => boolean} trifft e.g. (q) => q === 'geraet:<id>'
     * @returns {number} streams closed
     */
    schliessenFuer(trifft) {
      let n = 0;
      for (const a of [...abos]) if (trifft(a.quelle)) { a.schliessen(); n += 1; }
      return n;
    },
    /** Open subscriptions (all, or of one project). @param {string} [projekt] @returns {number} */
    anzahl(projekt) {
      if (projekt == null) return abos.size;
      let n = 0;
      for (const a of abos) if (a.projekt === String(projekt)) n += 1;
      return n;
    },
    /** Projects with buffered events (memory check). @returns {number} */
    gepuffert: () => verlauf.size,
    /** Number of the newest event (0 = none yet). @returns {number} */
    stand: () => seq,
  };
}

/**
 * Middleware that turns every successful write of a streamed entity into one event. Mount on /api BEFORE
 * entitiesRouter: it reads the record before a PUT/DELETE, catches the route's JSON answer and reports after the
 * response finished with 2xx. Bulk writes (/entities/:e/bulk) are not streamed (imports, no device edits).
 * @param {ReturnType<typeof aenderungsStrom>} strom
 * @param {{get: (entity: string, id: string) => any}} db
 * @param {{entitaeten?: ReadonlyArray<string>, geraetVon?: (req: any) => {id: string, name: string}|null}} [o]
 * @returns {import('express').RequestHandler}
 */
export function aenderungenMelden(strom, db, { entitaeten = STROM_ENTITAETEN, geraetVon = () => null } = {}) {
  const menge = new Set(entitaeten);
  return (req, res, next) => {
    const m = /^\/entities\/([^/]+)(?:\/([^/]+))?$/.exec(req.path);
    if (!m || !menge.has(m[1])) return next();
    const [, entitaet, id] = m;
    const methode = req.method;
    const passt = (methode === 'POST' && !id) || ((methode === 'PUT' || methode === 'DELETE') && id && id !== 'bulk');
    if (!passt) return next();
    let vorher = null;
    try { vorher = id ? db.get(entitaet, id) : null; } catch { vorher = null; }
    let antwort = /** @type {any} */ (null);
    const json = res.json.bind(res);
    res.json = (/** @type {any} */ body) => { antwort = body; return json(body); };
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      try {
        const e = ereignisAusSchreiben({
          methode, entitaet, id: id ?? null, datensatz: methode === 'DELETE' ? null : antwort, vorher, body: req.body,
          geraet: geraetVon(req), client: clientAus(req),
        });
        if (e) strom.melden(e);
      } catch (err) {
        console.error(`[abgleich] event not reported: ${/** @type {any} */ (err)?.message || err}`);
      }
    });
    next();
  };
}

/**
 * GET /aenderungen?projekt=<id> — the stream of one project (mount under /api).
 * @param {ReturnType<typeof aenderungsStrom>} strom
 * @param {{db: {get: (entity: string, id: string) => any}, geraetVon?: (req: any) => {id: string, name: string}|null,
 *   nochGueltig?: (req: any) => boolean, herzschlagMs?: number}} o
 *   nochGueltig = whether the holder of an open stream may still read (office mode on, pairing neither revoked nor expired),
 *   checked before every event and with every heartbeat; herzschlagMs = heartbeat interval, ms
 * @returns {import('express').Router}
 */
export function aenderungsRouter(strom, { db, geraetVon = () => null, nochGueltig = () => true, herzschlagMs = HERZSCHLAG_MS }) {
  const r = Router();
  r.get('/aenderungen', (req, res) => {
    // a foreign web page could not read the stream (CORS), but it could hold sockets open: refuse before that
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Nur aus der App selbst.' });
    const projekt = String(req.query.projekt ?? '').trim();
    if (!projekt) return res.status(400).json({ error: 'projekt fehlt — der Abgleich gilt immer genau einem Projekt.' });
    let vorhanden = null;
    try { vorhanden = db.get('Project', projekt); } catch { vorhanden = null; }
    if (!vorhanden) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
    const geraet = geraetVon(req);
    const seitRoh = req.headers['last-event-id'] ?? req.query.seit;
    const seit = seitRoh != null && /^\d{1,15}$/.test(String(seitRoh)) ? Number(seitRoh) : null;
    let offen = true;
    /** @type {any} */ let puls = null;
    /** Ends this stream from the server side (revoked, expired, office mode off). */
    const beenden = () => {
      if (!offen) return;
      offen = false;
      if (puls) clearInterval(puls);
      try { res.end(); } catch { /* already closed */ }
    };
    const a = strom.abonnieren({
      projekt, quelle: geraet ? `geraet:${geraet.id}` : 'lokal', seit,
      senden: (e) => { if (offen) res.write(sseBlock('aenderung', e, e.seq)); },
      gueltig: () => nochGueltig(req),
      schliessen: beenden,
    });
    if (!a.ok) return res.status(503).json({ error: a.grund });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: ${WIEDERHOLEN_MS}\n\n`);
    res.write(sseBlock('bereit', { projekt, stand: strom.stand(), instanz: strom.instanz, geraet: geraet ? { id: geraet.id, name: geraet.name } : null }));
    for (const e of a.nachholen) res.write(sseBlock('aenderung', e, e.seq));
    puls = setInterval(() => {
      // an expired pairing ends the stream with the next heartbeat at the latest
      if (!nochGueltig(req)) { a.abmelden(); beenden(); return; }
      try { res.write(': puls\n\n'); } catch { /* closed */ }
    }, herzschlagMs);
    puls.unref?.();
    const schliessen = () => { offen = false; clearInterval(puls); a.abmelden(); };
    req.on('close', schliessen);
    res.on('error', schliessen);
  });
  return r;
}
