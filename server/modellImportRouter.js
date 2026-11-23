// modellImportRouter.js — 108-09 (D-EFH-06): a model from a geometry JSON, checked before anything is written.
//
//   POST /modell/import?projekt=<id>[&modus=pruefen|anwenden][&stand=<updated_date>]       body: the import (format "bit-modell")
//        pruefen (default) writes NOTHING and answers what the import would do: {ok, fehler, warnungen, wuerde: {anlegen, vorher, nachher,
//        felder}, stand}. anwenden writes only an error-free import: the BimModel record of the project (created when there is none),
//        with a strict stand rule (106-09, tightened by R-GJ-1): a record that exists needs exactly the `stand` of the dry run, any other
//        stand answers 409 and nothing is overwritten. Before the write the replaced fields are kept as a backup record BimModelImport
//        {project_id, bim_model_id, vorher, datum, quelle, warnungen}; after it ONE event goes into the change stream, so an open studio
//        takes the import over (or meets it as a 409 on its next save) instead of silently saving over it.
//   POST /modell/import/zuruecknehmen?projekt=<id>&id=<BimModelImport id>[&modus=pruefen|anwenden][&stand=<updated_date>]
//        puts the backed-up fields back (same stand rule, one stream event). An import that CREATED the record is not taken back here
//        (the person moves the record to the recycle bin in the app).
//        The undo has no MCP tool: taking something back is the person's act (D-IM-04); [ASSUMED] until an app dialog exists the
//        operator calls it on this computer (devices are blocked, see below).
//
// One writer: the patch is built by @core bauteil/modellImport.js importPatch (the studio's field set and its GUID pinning), written
// through db.create/db.update like the generic entities route and reported with ereignisAusSchreiben like its middleware. Paired
// devices never reach this route: bueroWaechter (bueroRouter.js) lets a device call only the paths it lists, and /api/modell is not
// among them — an import is the operator's act on this computer.
//
// In: the database (createDb) and a callback for the stream event. Out: modellImportRouter() (mount under /api).

import { Router } from 'express';
import { modellPruefen, importPatch, listenAnzahl } from '../packages/nova-core/src/lib/bauteil/modellImport.js';
import { standVeraltet, STAND_KONFLIKT_TEXT } from '../packages/nova-core/server/routes.js';

/** Entity of the backups (additive, one record per applied import). */
export const IMPORT_SICHERUNG = 'BimModelImport';

/** 409 text when a record exists and the write names no stand. */
export const STAND_FEHLT_TEXT = 'Das Projekt hat schon ein Modell — erst prüfen (modus=pruefen) und dessen stand beim Anwenden mitgeben; sonst würde ungesehen überschrieben.';

/** Most characters of the `quelle` note of a backup. */
const MAX_QUELLE = 80;

/**
 * Router of the model import.
 * @param {{get: (e: string, id: string) => any, filter: (e: string, q: Record<string, any>, sort?: string) => any[],
 *   create: (e: string, d: any) => any, update: (e: string, id: string, d: any) => any}} db
 * @param {{nachAenderung?: (w: {methode: 'POST'|'PUT', entitaet: string, id: string, datensatz: any, vorher: any, body: any, req: any}) => void,
 *   jetzt?: () => Date}} [o] nachAenderung = report one write of the model record (index.js: into the change stream)
 * @returns {import('express').Router}
 */
export function modellImportRouter(db, { nachAenderung = () => {}, jetzt = () => new Date() } = {}) {
  const r = Router();

  /** The project of a request and its model record, or an error answer. @param {any} req @param {any} res */
  const projektLesen = (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') { res.status(403).json({ error: 'Nur aus der App oder von diesem Rechner.' }); return null; }
    const projekt = String(req.query.projekt ?? '').trim();
    if (!projekt) { res.status(400).json({ error: 'projekt fehlt — ein Import gilt immer genau einem Projekt.' }); return null; }
    if (!db.get('Project', projekt)) { res.status(404).json({ error: 'Projekt nicht gefunden.' }); return null; }
    const modus = String(req.query.modus ?? 'pruefen');
    if (modus !== 'pruefen' && modus !== 'anwenden') { res.status(400).json({ error: 'modus ist pruefen (Vorgabe, schreibt nichts) oder anwenden.' }); return null; }
    const modell = db.filter('BimModel', { project_id: projekt })[0] || null;
    return { projekt, modus, modell };
  };

  /**
   * Strict stand rule for a write on an existing record; answers and returns false when refused. Stricter than the generic route's
   * standVeraltet (which lets any non-date stand pass, R-GJ-1; a future date is refused there too since review 115-05b part 2): only the exact `updated_date` the dry run reported
   * counts as "seen". A missing or non-date stand is STAND_FEHLT_TEXT, any other date (older or newer) STAND_KONFLIKT_TEXT.
   * [ASSUMED] a record without a string updated_date (createDb always sets one on create/update) has nothing to compare against;
   * then an ISO-shaped stand is accepted, as before.
   * @param {any} modell @param {any} req @param {any} res
   */
  const standOk = (modell, req, res) => {
    if (!modell) return true;
    const stand = req.query.stand;
    const gespeichert = modell.updated_date;
    if (typeof stand !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(stand)) { res.status(409).json({ error: STAND_FEHLT_TEXT, konflikt: true, stand: gespeichert ?? null }); return false; }
    if (typeof gespeichert === 'string' ? stand !== gespeichert : standVeraltet(modell, stand)) {
      res.status(409).json({ error: STAND_KONFLIKT_TEXT, konflikt: true, stand: gespeichert ?? null }); return false;
    }
    return true;
  };

  r.post('/modell/import', (req, res) => {
    const k = projektLesen(req, res);
    if (!k) return;
    const { projekt, modus, modell } = k;
    const pruefung = modellPruefen(req.body);
    const antwort = { ok: pruefung.ok, modus, fehler: pruefung.fehler, warnungen: pruefung.warnungen, stand: modell?.updated_date ?? null };
    if (!pruefung.ok || !pruefung.normalisiert) {
      const text = `Import hat ${pruefung.fehler.length} Fehler — nichts geschrieben.`;
      return res.status(modus === 'anwenden' ? 422 : 200).json({ ...antwort, geschrieben: false, ...(modus === 'anwenden' ? { error: text } : {}) });
    }
    const patch = importPatch(pruefung.normalisiert, projekt, { hatteTreppen: modell ? modell.customStairs !== undefined : false, jetzt: jetzt() });
    const wuerde = { anlegen: !modell, vorher: listenAnzahl(modell), nachher: listenAnzahl(patch), felder: Object.keys(patch).sort() };
    if (modus === 'pruefen') return res.json({ ...antwort, geschrieben: false, wuerde });
    if (!standOk(modell, req, res)) return;
    // the backup first: the fields the import replaces, as they are stored now (a field the record did not have is kept as null)
    const vorher = modell ? Object.fromEntries(Object.keys(patch).map((f) => [f, modell[f] === undefined ? null : modell[f]])) : null;
    const quelle = String(req.body?.quelle ?? req.query.quelle ?? 'api').slice(0, MAX_QUELLE);
    const sicherung = db.create(IMPORT_SICHERUNG, {
      project_id: projekt, bim_model_id: modell?.id ?? null, vorher, datum: jetzt().toISOString(), quelle, warnungen: pruefung.warnungen,
    });
    const datensatz = modell ? db.update('BimModel', modell.id, patch) : db.create('BimModel', { project_id: projekt, ...patch });
    if (!modell) db.update(IMPORT_SICHERUNG, sicherung.id, { bim_model_id: datensatz.id });
    try {
      nachAenderung({ methode: modell ? 'PUT' : 'POST', entitaet: 'BimModel', id: datensatz.id, datensatz, vorher: modell, body: patch, req });
    } catch (err) {
      console.error(`[modell-import] event not reported: ${/** @type {any} */ (err)?.message || err}`);
    }
    res.status(modell ? 200 : 201).json({ ...antwort, geschrieben: true, wuerde, sicherung: sicherung.id, bim_model_id: datensatz.id, stand: datensatz.updated_date ?? null });
  });

  r.post('/modell/import/zuruecknehmen', (req, res) => {
    const k = projektLesen(req, res);
    if (!k) return;
    const { projekt, modus, modell } = k;
    const s = db.get(IMPORT_SICHERUNG, String(req.query.id ?? ''));
    if (!s || s.project_id !== projekt) return res.status(404).json({ error: 'Diese Import-Sicherung gibt es in diesem Projekt nicht.' });
    if (!s.vorher) return res.status(409).json({ error: 'Dieser Import hat das Modell erst angelegt — zum Entfernen den Modell-Datensatz in der App in den Papierkorb legen.' });
    if (!modell || modell.id !== s.bim_model_id) return res.status(409).json({ error: 'Das Modell dieses Imports gibt es nicht mehr.' });
    const patch = /** @type {Record<string, any>} */ (s.vorher);
    const wuerde = { vorher: listenAnzahl(modell), nachher: listenAnzahl(patch), felder: Object.keys(patch).filter((f) => f !== 'id').sort() };
    if (modus === 'pruefen') return res.json({ ok: true, modus, geschrieben: false, wuerde, stand: modell.updated_date ?? null });
    if (!standOk(modell, req, res)) return;
    /** @type {Record<string, any>} */
    const zurueck = {};
    for (const f of wuerde.felder) zurueck[f] = patch[f];
    const datensatz = db.update('BimModel', modell.id, zurueck);
    db.update(IMPORT_SICHERUNG, s.id, { zurueckgenommen: jetzt().toISOString() });
    try {
      nachAenderung({ methode: 'PUT', entitaet: 'BimModel', id: datensatz.id, datensatz, vorher: modell, body: zurueck, req });
    } catch (err) {
      console.error(`[modell-import] event not reported: ${/** @type {any} */ (err)?.message || err}`);
    }
    res.json({ ok: true, modus, geschrieben: true, wuerde, stand: datensatz.updated_date ?? null });
  });

  return r;
}
