// dateiOeffnenRouter.js — double-click on a .bitproj file → import preview in the local edition, and
// "save back into the file" (plan 93-10). Mounted under /api by server/index.js.
//
//   POST   /api/datei/oeffnen                     launcher only (tools/datei-oeffnen.mjs): { pfad } →
//                                                 { token, pfad: "/?import=<token>" }
//   GET    /api/datei/import/:token               the app: the staged file + what exists locally
//   POST   /api/datei/import/:token/uebernehmen   the app: { modus: "ersetzen"|"kopie", … } → applied
//   DELETE /api/datei/import/:token               the app: cancel, drops the staged file
//   GET    /api/datei/quelle                      the app: the linked source file (or null)
//   POST   /api/datei/zurueckschreiben            the app: { entscheidung?: "ueberschreiben"|"kopie" } →
//                                                 { ok: true, pfad } or { ok: false, konflikt: "geaendert"|"fehlt" }
//
// Why a server route: the installed edition keeps its projects in daten/db.json (express data source);
// the browser cannot read a file path, and the in-browser import of the serverless build never reached
// this database. The launcher hands the PATH to the server, the server reads and validates the file with
// the SAME parser the browser import uses (projektDateiFormat.js) and holds it under a short-lived token;
// the app fetches it with ?import=<token> and shows the usual import preview.
//
// Security (threat list in 93-10-PLAN.md):
//   - every route answers only while the API is bound to loopback (no API_HOST LAN opt-out) and never to a
//     paired LAN device of the office mode (93-03, anfrageEntfernt) — else 403;
//   - the launcher route needs the secret from <data folder>/.oeffnen-schluessel (new on every server
//     start, changed after every use) in the header x-bit-schluessel and refuses any request carrying
//     Origin or Sec-Fetch-Site — a web page in the browser can neither read the secret nor send a
//     request without those headers;
//   - the app's actions (apply, cancel, save back) need the app's own Origin (same rule as systemRouter);
//   - paths: absolute, extension .bitproj, real path a regular file, ≤ 64 MB, unpacked ≤ 256 MB;
//     saving back never takes a path from the request, only the one stored at import time;
//   - tokens: 32 random bytes, 15 minutes, consumed on apply, at most 3 staged files at a time.
//
// Storage (D-93-10-03): the source path is NEVER written into db.json or an export (it names the user's
// folder) — it lives in <data folder>/dateiquelle.json. A pre-import copy of db.json goes to
// <data folder>/vor-import/ (the newest 3 stay).
//
// In:  { db, lokalGebunden, port, origins?, anfrageEntfernt?, datenOrdnerFn?, jetzt? }. Out: an Express router.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import express, { Router } from 'express';
import { datenOrdner } from './datenPfad.js';
import {
  DATEI_ENDUNG, parseProjektDatei, serialisiereProjekt, entferneBereiche, mitBehaltenem,
  kopieAnfuegen, projekteIn, vorhandeneProjekte,
} from '../packages/nova-core/src/api/projektDateiFormat.js';

/** Largest .bitproj file read from disk, bytes (64 MB). [ASSUMED] — a full office backup is a few MB gzipped. */
export const MAX_DATEI_BYTES = 64 * 1024 * 1024;
/** Largest unpacked content of a gzipped file, bytes (256 MB) — stops a gzip bomb. */
export const MAX_ENTPACKT_BYTES = 256 * 1024 * 1024;
/** Lifetime of an import token, milliseconds (15 min). */
export const TOKEN_MS = 15 * 60 * 1000;
/** Staged files kept at the same time; the oldest is dropped first. */
export const MAX_BEREIT = 3;
/** Pre-import copies of db.json kept in <data>/vor-import/. */
export const SICHERUNGEN_BEHALTEN = 3;
/** File name of the launcher secret inside the data folder. */
export const SCHLUESSEL_DATEI = '.oeffnen-schluessel';
/** File name of the source link inside the data folder. */
export const QUELLE_DATEI = 'dateiquelle.json';

/** Error with an HTTP status for the route handlers. */
class DateiFehler extends Error {
  /** @param {number} status @param {string} meldung */
  constructor(status, meldung) {
    super(meldung);
    this.status = status;
  }
}

/**
 * Checks a path a launcher sent: absolute, `.bitproj`, a regular file within the size limit. Resolves
 * symlinks first and checks the extension of the real target too.
 * @param {unknown} pfad
 * @returns {Promise<string>} the real absolute path
 * @throws {DateiFehler} 400 (not a .bitproj path), 404 (missing), 413 (too large)
 */
export async function pfadPruefen(pfad) {
  if (typeof pfad !== 'string' || !pfad || pfad.length > 4096 || pfad.includes('\0')) throw new DateiFehler(400, 'Kein gültiger Dateipfad.');
  if (!path.isAbsolute(pfad)) throw new DateiFehler(400, 'Der Pfad muss absolut sein.');
  if (path.extname(pfad).toLowerCase() !== DATEI_ENDUNG) throw new DateiFehler(400, `Nur ${DATEI_ENDUNG}-Dateien können geöffnet werden.`);
  let echt;
  try {
    echt = await fs.promises.realpath(pfad);
  } catch {
    throw new DateiFehler(404, 'Die Datei wurde nicht gefunden.');
  }
  if (path.extname(echt).toLowerCase() !== DATEI_ENDUNG) throw new DateiFehler(400, `Nur ${DATEI_ENDUNG}-Dateien können geöffnet werden.`);
  const st = await fs.promises.stat(echt);
  if (!st.isFile()) throw new DateiFehler(400, 'Der Pfad ist keine Datei.');
  if (st.size > MAX_DATEI_BYTES) throw new DateiFehler(413, `Die Datei ist zu groß (über ${MAX_DATEI_BYTES / 1024 / 1024} MB).`);
  return echt;
}

/**
 * Size and SHA-256 of a file as it is on disk now — the fingerprint saving back compares against.
 * @param {string} pfad
 * @returns {Promise<{groesse: number, mtimeMs: number, sha256: string}|null>} null when the file is missing
 */
export async function dateiStand(pfad) {
  let st;
  try {
    st = await fs.promises.stat(pfad);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const bytes = await fs.promises.readFile(pfad);
  return { groesse: st.size, mtimeMs: st.mtimeMs, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

/**
 * Reads and validates a project file: gzip unpacked here with a size cap, then the shared parser.
 * @param {string} pfad checked real path (pfadPruefen)
 * @param {number} [maxEntpackt] cap for the unpacked content, bytes (tests pass a small one)
 * @returns {Promise<{obj: any, groesse: number, mtimeMs: number, sha256: string}>}
 * @throws {DateiFehler} 413 (unpacked too large), 422 (not a readable project file)
 */
export async function dateiEinlesen(pfad, maxEntpackt = MAX_ENTPACKT_BYTES) {
  const bytes = await fs.promises.readFile(pfad);
  const st = await fs.promises.stat(pfad);
  return bytesEinlesen(bytes, { groesse: st.size, mtimeMs: st.mtimeMs }, maxEntpackt);
}

/**
 * 93-13: the same reading for bytes that came as an upload ("Aus Datei laden") instead of a path.
 * @param {Buffer} bytes file content (gzip or plain JSON)
 * @param {{groesse: number, mtimeMs: number}} meta size in bytes, mtime in ms (0 for an upload)
 * @param {number} [maxEntpackt] cap for the unpacked content, bytes
 * @returns {Promise<{obj: any, groesse: number, mtimeMs: number, sha256: string}>}
 * @throws {DateiFehler} 413 (too large), 422 (not a readable project file)
 */
export async function bytesEinlesen(bytes, { groesse, mtimeMs }, maxEntpackt = MAX_ENTPACKT_BYTES) {
  if (bytes.length > MAX_DATEI_BYTES) throw new DateiFehler(413, 'Die Datei ist zu groß.');
  const st = { size: groesse, mtimeMs };
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let klar = bytes;
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      klar = zlib.gunzipSync(bytes, { maxOutputLength: maxEntpackt });
    } catch (e) {
      const zuGross = /** @type {any} */ (e)?.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError;
      throw new DateiFehler(zuGross ? 413 : 422, zuGross ? 'Der entpackte Inhalt ist zu groß.' : 'Die Datei ist beschädigt (gzip nicht lesbar).');
    }
  }
  try {
    const obj = await parseProjektDatei(new Uint8Array(klar.buffer, klar.byteOffset, klar.byteLength));
    return { obj, groesse: st.size, mtimeMs: st.mtimeMs, sha256 };
  } catch (e) {
    throw new DateiFehler(422, /** @type {Error} */ (e).message);
  }
}

/**
 * Writes bytes atomically: `<ziel>.tmp` first, then rename over the target. A failed write removes the
 * .tmp again — no temp file is ever left behind.
 * @param {string} ziel absolute path
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
export async function atomarSchreiben(ziel, bytes) {
  const tmp = `${ziel}.tmp`;
  try {
    await fs.promises.writeFile(tmp, bytes, { flag: 'w' });
    await fs.promises.rename(tmp, ziel);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * A free file name for "save as copy" next to the source: `<name> (Kopie 2026-10-12 2215).bitproj`,
 * with " 2", " 3" … when that exists too.
 * @param {string} quelle absolute path of the source file
 * @param {Date} [jetzt]
 * @returns {string}
 */
export function kopieName(quelle, jetzt = new Date()) {
  const ordner = path.dirname(quelle);
  const basis = path.basename(quelle, path.extname(quelle));
  const z = (n) => String(n).padStart(2, '0');
  const stempel = `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())} ${z(jetzt.getHours())}${z(jetzt.getMinutes())}`;
  for (let i = 1; i < 1000; i += 1) {
    const kandidat = path.join(ordner, `${basis} (Kopie ${stempel}${i > 1 ? ` ${i}` : ''})${DATEI_ENDUNG}`);
    if (!fs.existsSync(kandidat)) return kandidat;
  }
  throw new DateiFehler(409, 'Kein freier Dateiname für die Kopie gefunden.');
}

/**
 * Packs a project object as the browser export does (gzip of the JSON).
 * @param {object} obj
 * @returns {Uint8Array}
 */
export function projektDateiBytes(obj) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
}

/**
 * Writes a fresh launcher secret into the data folder (owner-only where the OS supports modes).
 * @param {string} ordner data folder
 * @returns {string} the secret (64 hex characters)
 */
export function schluesselSchreiben(ordner) {
  const wert = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, SCHLUESSEL_DATEI), wert, { encoding: 'utf8', mode: 0o600 });
  return wert;
}

/** @param {unknown} liste @returns {string[]} only the string entries (request bodies are untrusted) */
const strings = (liste) => (Array.isArray(liste) ? liste.filter((x) => typeof x === 'string' && x.length < 200).slice(0, 500) : []);

/** @param {string} a @param {string} b constant-time equality of two secrets */
function gleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * @param {{db: {_raw: () => Record<string, object[]>, _reset: (d: Record<string, object[]>) => void},
 *   lokalGebunden: boolean, port: number|string, origins?: string[], anfrageEntfernt?: (req: any) => boolean,
 *   datenOrdnerFn?: () => string, jetzt?: () => number}} o  db = the server database (createDb); port = this
 *   server's port; origins = further allowed app Origins (e.g. the Vite dev server); anfrageEntfernt = the
 *   request comes from a paired LAN device (93-03 office mode); jetzt = clock in ms (tests)
 * @returns {import('express').Router}
 */
export function dateiOeffnenRouter({ db, lokalGebunden, port, origins = [], anfrageEntfernt = () => false, datenOrdnerFn = () => datenOrdner(), jetzt = () => Date.now() }) {
  const r = Router();
  const erlaubteOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...origins]);
  /** @type {Map<string, {pfad: string, obj: any, groesse: number, mtimeMs: number, sha256: string, ablauf: number}>} */
  const bereit = new Map();
  let schluessel = lokalGebunden ? schluesselSchreiben(datenOrdnerFn()) : '';

  // The file paths and the save-back act on THIS computer's disk — never for a paired LAN device (93-03).
  const nurLokal = (req, res, next) => (lokalGebunden && !anfrageEntfernt(req) ? next()
    : res.status(403).json({ error: 'Nur verfügbar, solange die App ausschließlich auf diesem Rechner erreichbar ist (API_HOST nicht gesetzt).' }));
  const nurApp = (req, res, next) => (erlaubteOrigins.has(String(req.headers.origin || '')) ? next()
    : res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' }));
  // A same-origin GET carries no Origin header; Sec-Fetch-Site tells it apart from a foreign page.
  const nurAppLesen = (req, res, next) => (erlaubteOrigins.has(String(req.headers.origin || '')) || req.headers['sec-fetch-site'] === 'same-origin' ? next()
    : res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' }));
  const fehler = (res, e) => res.status(/** @type {any} */ (e)?.status || 500).json({ error: /** @type {Error} */ (e)?.message || String(e) });
  const aufraeumen = () => {
    const t = jetzt();
    for (const [k, v] of bereit) if (v.ablauf <= t) bereit.delete(k);
  };
  /** @param {string} token */
  const holen = (token) => {
    aufraeumen();
    const eintrag = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? bereit.get(token) : undefined;
    if (!eintrag) throw new DateiFehler(404, 'Der Import-Link ist abgelaufen oder unbekannt. Bitte die Datei erneut öffnen.');
    return eintrag;
  };
  const quellePfad = () => path.join(datenOrdnerFn(), QUELLE_DATEI);
  const quelleLesen = () => {
    try {
      return JSON.parse(fs.readFileSync(quellePfad(), 'utf8'));
    } catch {
      return null;
    }
  };
  /** @param {object} q */
  const quelleSchreiben = async (q) => atomarSchreiben(quellePfad(), Buffer.from(JSON.stringify(q, null, 2), 'utf8'));

  // --- Launcher → server -------------------------------------------------------------------------
  r.post('/datei/oeffnen', nurLokal, async (req, res) => {
    // A browser always sends Origin (or at least Sec-Fetch-Site) on a cross-site POST; the launcher never.
    if (req.headers.origin || req.headers['sec-fetch-site']) return res.status(403).json({ error: 'Nur für das Startprogramm auf diesem Rechner.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erwartet.' });
    if (!schluessel || !gleich(String(req.headers['x-bit-schluessel'] || ''), schluessel)) return res.status(403).json({ error: 'Schlüssel fehlt oder passt nicht.' });
    // One use per secret: the next launcher reads the new one from the data folder.
    schluessel = schluesselSchreiben(datenOrdnerFn());
    try {
      const pfad = await pfadPruefen(req.body?.pfad);
      const gelesen = await dateiEinlesen(pfad);
      aufraeumen();
      while (bereit.size >= MAX_BEREIT) bereit.delete(/** @type {string} */ (bereit.keys().next().value));
      const token = crypto.randomBytes(32).toString('hex');
      bereit.set(token, { pfad, ...gelesen, ablauf: jetzt() + TOKEN_MS });
      res.json({ token, pfad: `/?import=${token}` });
    } catch (e) {
      fehler(res, e);
    }
  });

  // --- 93-13: save / load from inside the app (installed edition) ------------------------------------
  // "Als Datei sichern": the current workspace as a .bitproj (same format and areas as the PWA export).
  r.get('/datei/export', nurLokal, nurAppLesen, (_req, res) => {
    try {
      const datum = new Date(jetzt()).toISOString().slice(0, 10);
      const bytes = projektDateiBytes(serialisiereProjekt(db._raw(), 'BIT-Atelier'));
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="bit-atelier-${datum}${DATEI_ENDUNG}"`);
      res.send(Buffer.from(bytes));
    } catch (e) {
      fehler(res, e);
    }
  });
  // "Aus Datei laden": an uploaded file is staged like a double-click and opens the same preview. It has no
  // source path, so "save back" stays off for it (quelle is not written).
  r.post('/datei/hochladen', nurLokal, nurApp, express.raw({ type: 'application/octet-stream', limit: MAX_DATEI_BYTES }), async (req, res) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!bytes.length) throw new DateiFehler(400, 'Keine Datei erhalten.');
      const gelesen = await bytesEinlesen(bytes, { groesse: bytes.length, mtimeMs: 0 });
      aufraeumen();
      while (bereit.size >= MAX_BEREIT) bereit.delete(/** @type {string} */ (bereit.keys().next().value));
      const token = crypto.randomBytes(32).toString('hex');
      bereit.set(token, { pfad: '', ...gelesen, ablauf: jetzt() + TOKEN_MS });
      res.json({ token, pfad: `/?import=${token}` });
    } catch (e) {
      fehler(res, e);
    }
  });

  // --- App ← staged file ----------------------------------------------------------------------------
  r.get('/datei/import/:token', nurLokal, (req, res) => {
    try {
      const e = holen(req.params.token);
      const raw = db._raw();
      /** @type {Record<string, number>} */
      const anzahl = {};
      for (const [entity, rows] of Object.entries(raw)) anzahl[entity] = Array.isArray(rows) ? rows.length : 0;
      const lokaleProjekte = projekteIn(raw);
      res.json({
        obj: e.obj,
        quelle: { name: path.basename(e.pfad), pfad: e.pfad, groesse: e.groesse },
        lokal: { anzahl, projekte: lokaleProjekte.length },
        wiederOeffnen: vorhandeneProjekte(e.obj.daten, lokaleProjekte.map((p) => p.id)),
      });
    } catch (err) {
      fehler(res, err);
    }
  });

  r.delete('/datei/import/:token', nurLokal, nurApp, (req, res) => {
    bereit.delete(req.params.token);
    res.status(204).end();
  });

  r.post('/datei/import/:token/uebernehmen', nurLokal, nurApp, async (req, res) => {
    try {
      const e = holen(req.params.token);
      const modus = req.body?.modus;
      if (modus !== 'ersetzen' && modus !== 'kopie') throw new DateiFehler(400, 'Unbekannter Modus.');
      const behalte = strings(req.body?.behalte);
      const behalteSettingKeys = strings(req.body?.behalteSettingKeys);
      const behalteDokumentBereiche = strings(req.body?.behalteDokumentBereiche);
      const vorher = db._raw();
      const sicherung = vorImportSichern(datenOrdnerFn(), vorher, new Date(jetzt()));
      bereit.delete(req.params.token);
      if (modus === 'kopie') {
        const { daten, kopiert } = kopieAnfuegen(vorher, e.obj.daten, { ohne: strings(req.body?.ohne), ohneDokumentBereiche: strings(req.body?.ohneDokumentBereiche) });
        db._reset(daten);
        return res.json({ ok: true, modus, kopiert, sicherung });
      }
      db._reset(mitBehaltenem(vorher, e.obj.daten, { behalte, behalteSettingKeys, behalteDokumentBereiche }));
      // The workspace now IS this file: remember where it came from, for "save back". The areas the
      // file did not carry stay out of the saved file again (same selection as the source).
      if (e.pfad) await quelleSchreiben({
        pfad: e.pfad, name: path.basename(e.pfad), groesse: e.groesse, mtimeMs: e.mtimeMs, sha256: e.sha256,
        projektname: e.obj.projektname || '', art: e.obj.art, bereiche: e.obj.bereiche,
        ohne: behalte, ohneSettingKeys: behalteSettingKeys, ohneDokumentBereiche: behalteDokumentBereiche,
        importiertAm: new Date(jetzt()).toISOString(), gespeichertAm: null,
      });
      res.json({ ok: true, modus, sicherung });
    } catch (err) {
      fehler(res, err);
    }
  });

  // --- Linked source file + save back ---------------------------------------------------------------
  r.get('/datei/quelle', nurLokal, (_req, res) => {
    const q = quelleLesen();
    if (!q) return res.json({ quelle: null });
    res.json({ quelle: { name: q.name, pfad: q.pfad, projektname: q.projektname, importiertAm: q.importiertAm, gespeichertAm: q.gespeichertAm }, vorhanden: fs.existsSync(q.pfad) });
  });

  r.post('/datei/zurueckschreiben', nurLokal, nurApp, async (req, res) => {
    try {
      const q = quelleLesen();
      if (!q?.pfad) throw new DateiFehler(404, 'Keine verknüpfte Projektdatei.');
      if (path.extname(q.pfad).toLowerCase() !== DATEI_ENDUNG) throw new DateiFehler(400, 'Die verknüpfte Datei ist keine Projektdatei.');
      const entscheidung = req.body?.entscheidung;
      if (entscheidung != null && entscheidung !== 'ueberschreiben' && entscheidung !== 'kopie') throw new DateiFehler(400, 'Unbekannte Entscheidung.');
      const stand = await dateiStand(q.pfad);
      const geaendert = !stand || stand.groesse !== q.groesse || stand.sha256 !== q.sha256;
      if (geaendert && !entscheidung) {
        // An expected answer, not an error: 200 with `konflikt`, the app asks the user (no red console line).
        return res.json({
          ok: false, konflikt: stand ? 'geaendert' : 'fehlt', pfad: q.pfad,
          error: stand ? 'Die Datei wurde seit dem Öffnen geändert.' : 'Die Datei ist nicht mehr vorhanden.',
        });
      }
      const ziel = entscheidung === 'kopie' ? kopieName(q.pfad, new Date(jetzt())) : q.pfad;
      if (!fs.existsSync(path.dirname(ziel))) throw new DateiFehler(409, 'Der Ordner der Datei ist nicht mehr vorhanden.');
      const daten = entferneBereiche(db._raw(), strings(q.ohne), strings(q.ohneSettingKeys), strings(q.ohneDokumentBereiche));
      const obj = serialisiereProjekt(daten, q.projektname || undefined, { art: q.art, bereiche: q.bereiche });
      await atomarSchreiben(ziel, projektDateiBytes(obj));
      const neu = await dateiStand(ziel);
      await quelleSchreiben({ ...q, pfad: ziel, name: path.basename(ziel), ...neu, gespeichertAm: new Date(jetzt()).toISOString() });
      res.json({ ok: true, pfad: ziel, kopie: entscheidung === 'kopie' });
    } catch (err) {
      fehler(res, err);
    }
  });

  return r;
}

/**
 * Copies the current database to <data>/vor-import/db-<stamp>.json before an import changes it, and keeps
 * only the newest SICHERUNGEN_BEHALTEN copies (the browser edition takes a snapshot at the same point).
 * @param {string} ordner data folder
 * @param {Record<string, object[]>} daten current database content
 * @param {Date} jetzt
 * @returns {string} file name of the copy
 */
export function vorImportSichern(ordner, daten, jetzt) {
  const ziel = path.join(ordner, 'vor-import');
  fs.mkdirSync(ziel, { recursive: true });
  const name = `db-${jetzt.toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(ziel, name), JSON.stringify(daten), 'utf8');
  const alle = fs.readdirSync(ziel).filter((n) => /^db-.*\.json$/.test(n)).sort();
  for (const alt of alle.slice(0, Math.max(0, alle.length - SICHERUNGEN_BEHALTEN))) fs.rmSync(path.join(ziel, alt), { force: true });
  return name;
}
