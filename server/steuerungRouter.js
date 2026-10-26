// steuerungRouter.js — local control protocol for agents (phase 104-04), mounted under /api by server/index.js.
// Idea: the local JSON control channel seen in the Craft apps (cadcraft), own implementation; the commands are the
// ones of the open drawing surface (104-03 command register, window.__bitBefehle).
//
//   POST /api/steuerung              agent → {"id","method","params"} (same lines as befehlsregister.zeileBearbeiten)
//                                    header x-bit-steuerung: <token from the token file>
//                                    → the answer of the open app, or after `wartezeit`:
//                                      {ok:false, status:"not-run"}      — no app took the request (safe to retry)
//                                      {ok:false, status:"may-have-run"} — taken but unanswered (check state first)
//   GET  /api/steuerung/naechste?alter=<ms>  app (long poll) → 200 {nr, zeile} or 204 after `abholWarten`;
//                                    with several open tabs the one with the latest user activity gets the request
//                                    (alter = ms since the tab's last user activity; the server turns it into its own time,
//                                    review fix 106-07 - the old `aktiv=<ms>` of the client clock is still read, capped at now)
//   POST /api/steuerung/antwort      app → {nr, antwort} (answer line); browser writes carry the session header
//
// Long polls end after `abholWarten` (10 s): behind the Vite dev proxy a closed tab's poll is not torn down until
// then (the proxy does not pass the abort on), and a request handed to it answers "may-have-run". Short polls keep
// that window small; in the installed app (no proxy) a closed tab is noticed at once.
//
// Security: loopback-only server; the agent side never for paired LAN devices (anfrageEntfernt), the app side for them only since 106-07 (below); the agent side needs the random
// token written at start to <data folder>/steuerung.token (mode 0600) — binding to 127.0.0.1 alone would let any
// local web page in through the browser; the app side is refused for cross-site requests. Limits: request size,
// queue length, waiting pollers.
//
// Body limits (review fix 106-04): server/index.js parses JSON globally (10 MB) - a second parser behind it would never see the
// body, so the limits below would be dead. `jsonAusserSteuerung` keeps /api/steuerung* out of the global parser; the router's
// own parsers then decide: `maxBytes` for an agent's request, `maxAntwortBytes` for the app's answer.
//
// Images of the view (review fix 106-06, D-IM-02): every answer of the app that carries an image (`result.png_base64`, register command
// "ansicht-bild") passes `bildPruefen` before it reaches the agent - whatever road asked for it (MCP tool ansicht_bild, the generic
// zeichenflaeche_ausfuehren, a script with the token). The agent counts as a target outside this computer: NDA marker, "Nur lokale KI",
// the office switch and the person's consent per project decide; refused = the image is dropped and the agent gets the sentence.
//
// Paired devices (106-07, office mode 93-03): a site tablet paired with this computer runs the app in its own browser. Its
// viewer may take part in the APP side of the channel (poll /steuerung/naechste, answer /steuerung/antwort) - so an agent on this
// computer can point at and propose for the person working on the tablet - but only with the commands of GERAET_BEFEHLE
// (selection and proposals; never bestaetigen / rueckgaengig, never commands that change a model at once). A request outside that
// list is never handed to a device. The AGENT side (POST /steuerung with the token) stays on this computer. Every request is bound
// to the poller that took it: only that tab or device may answer it (a device cannot answer a request of the computer, and the
// other way round). Confirming stays with the person in the window, and only with a role that may change the model (aenderungsBefehle.js).
// That rights lock is order in the client, not access security: a paired device counts as a full role in the local app and may write
// /api/entities directly (office allow-list) - a role per paired device is an open decision (106-07-SUMMARY, Review-Fixes).
//
// Which surface gets a request (review fix 106-07): the activity times of different devices are never compared. A request goes to a tab
// on THIS computer whenever one is around (waiting now, or polled within `lokalNachlauf`); a paired device gets it only when the agent
// names it - top-level field `ziel` of the request line: "geraet:<id>" (that device) or "geraet" (any paired device) - or when no tab of
// this computer is around at all. `ziel: "lokal"` never goes to a device. The answer of a device carries `oberflaeche: "geraet:<id>"`, so
// the agent knows whose selection it read; answers of this computer stay unchanged (no field = this computer).
// Waiting pollers are limited per kind (8 on this computer, 2 per device, 6 devices in all), so devices can never fill the places of this
// computer; a poll refused for a full list answers 204 with the header `x-bit-steuerung-voll: 1` and the bridge pauses before asking again.
//
// In:  { lokalGebunden, anfrageEntfernt?, geraetVon?, token, wartezeit?, abholWarten?, lokalNachlauf?, maxWarteschlange?, maxBytes?, maxAntwortBytes?, bildPruefen? }
// Out: an Express router; GERAET_BEFEHLE, geraetDarfZeile(), zielDerZeile(), aktivZeit(), oberflaecheNennen(), ABHOLER_GRENZEN, VOLL_KOPF.

import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';

/** Header of the agent token. */
export const STEUERUNGS_KOPF = 'x-bit-steuerung';

/**
 * JSON body parser for the whole app EXCEPT the control channel, which parses its own bodies with its own limits.
 * @param {number} limitBytes  Body limit in bytes of every other route (server/index.js: 10 MB).
 * @returns {import('express').RequestHandler}
 */
export function jsonAusserSteuerung(limitBytes) {
  const global = express.json({ limit: limitBytes });
  return (req, res, next) => (/^\/api\/steuerung(\/|$)/.test(req.path) ? next() : global(req, res, next));
}

/**
 * 106-07: register commands a paired device may receive over the channel - selecting and proposing only. Not in here, on purpose:
 * bestaetigen and rueckgaengig (a person confirms in the window, D-IM-04), eingabe (a free sentence could be "ja"), ansicht-bild (an
 * image is neither selection nor proposal; the image gate of 106-06 stays the only road for images) and every command of the
 * massing modeller that changes the model at once (linie, wand, loeschen ...).
 */
export const GERAET_BEFEHLE = Object.freeze([
  'auswahl-lesen', 'auswahl-guid', 'auswahl-aufheben', 'ansicht-auf-auswahl', 'modell',
  'vorschlaege', 'pruefen', 'eigenschaft-setzen', 'transformieren', 'teilen', 'verwerfen',
]);

/**
 * Whether a request line may be handed to a paired device (106-07).
 * @param {string} zeile  JSON line of the agent ({id, method, params}; method "befehle" | "finden" | "ausfuehren" with params.befehl)
 * @returns {boolean}  true for the command list and the two read methods; false for anything else and for unreadable lines
 */
export function geraetDarfZeile(zeile) {
  let a;
  try { a = JSON.parse(zeile); } catch { return false; }
  if (a?.method === 'befehle' || a?.method === 'finden') return true;
  return a?.method === 'ausfuehren' && typeof a?.params?.befehl === 'string' && GERAET_BEFEHLE.includes(a.params.befehl);
}

/**
 * Target surface the agent names in a request line (review fix 106-07): top-level field `ziel`.
 * @param {string} zeile  JSON line of the agent
 * @returns {{art: 'lokal'|'geraet'|'frei', geraet: string|null}}  lokal = only this computer; geraet = a paired device (geraet = its id,
 *   null for any device); frei = not named (this computer first, a device only when no tab of this computer is around)
 */
export function zielDerZeile(zeile) {
  let z;
  try { z = JSON.parse(zeile)?.ziel; } catch { return { art: 'frei', geraet: null }; }
  if (z === 'lokal') return { art: 'lokal', geraet: null };
  if (z === 'geraet') return { art: 'geraet', geraet: null };
  if (typeof z === 'string' && z.startsWith('geraet:') && z.length > 7) return { art: 'geraet', geraet: z.slice(7) };
  return { art: 'frei', geraet: null };
}

/**
 * Activity time of a poll in SERVER time (review fix 106-07): a client clock is never trusted across devices.
 * @param {{alter?: any, aktiv?: any}} query  alter = ms since the tab's last user activity (new bridge); aktiv = old form, the client's
 *   own epoch ms - only read when alter is missing, and capped at now (a device with aktiv=9e15 cannot jump ahead of everyone)
 * @param {number} jetzt  server time, epoch ms
 * @returns {number}  epoch ms in server time, never after `jetzt`
 */
export function aktivZeit(query, jetzt) {
  const alter = Number(query?.alter);
  if (query?.alter !== undefined && Number.isFinite(alter)) return jetzt - Math.max(0, alter);
  const aktiv = Number(query?.aktiv);
  return Number.isFinite(aktiv) && aktiv > 0 ? Math.min(aktiv, jetzt) : 0;
}

/** Limits of waiting pollers (review fix 106-07): this computer, each device, all devices together (count of open long polls). */
export const ABHOLER_GRENZEN = Object.freeze({ lokal: 8, jeGeraet: 2, geraete: 6 });

/** Header of a 204 that means "the list of waiting pollers is full" (the bridge pauses instead of asking again at once). */
export const VOLL_KOPF = 'x-bit-steuerung-voll';

/**
 * Names the answering surface in a device's answer (review fix 106-07): `oberflaeche: "geraet:<id>"`. Answers of this computer and
 * lines that are no JSON object stay as they are.
 * @param {string} antwort  answer line (JSON text)
 * @param {string|null} wer  poller that answered: 'lokal' | 'geraet:<id>'
 * @returns {string}
 */
export function oberflaecheNennen(antwort, wer) {
  if (!wer || wer === 'lokal') return antwort;
  let j;
  try { j = JSON.parse(antwort); } catch { return antwort; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return antwort;
  return JSON.stringify({ ...j, oberflaeche: wer });
}

/** New random token (hex). */
export function steuerungsToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Gate for an answer of the app that carries an image of the view (106-06). Answers without an image pass unchanged.
 * @param {string} antwort  answer line of the app (JSON text)
 * @param {any} id  id of the agent's request
 * @param {((projektId: string|null) => {ok: boolean, text: string})|undefined} bildPruefen  the store's decision for the project (null = none open);
 *   missing = no image passes at all (fail closed)
 * @returns {string}  the answer, or a refusal line {id, ok:false, error} without the image
 */
export function bildAntwortPruefen(antwort, id, bildPruefen) {
  if (!antwort.includes('"png_base64"')) return antwort;
  let j;
  try { j = JSON.parse(antwort); } catch { return antwort; }
  const r = j?.result;
  if (!r || typeof r !== 'object' || typeof r.png_base64 !== 'string') return antwort;
  const pid = typeof r.projekt_id === 'string' && r.projekt_id.trim() ? r.projekt_id.trim() : null;
  let f;
  try {
    f = bildPruefen ? bildPruefen(pid) : { ok: false, text: 'Die Bildprüfung fehlt in diesem Server — kein Bild' };
  } catch (e) {
    f = { ok: false, text: `Die Freigabe des Projekts ließ sich nicht prüfen (${/** @type {any} */ (e)?.message || e}) — kein Bild` };
  }
  if (f?.ok === true) return antwort;
  return JSON.stringify({ id: j?.id ?? id, ok: false, error: `Bild der Ansicht abgelehnt: ${f?.text || 'für dieses Projekt nicht freigegeben'}` });
}

/**
 * @param {{lokalGebunden: boolean, anfrageEntfernt?: (req: any) => boolean, geraetVon?: (req: any) => string|null, token: string, wartezeit?: number,
 *   abholWarten?: number, lokalNachlauf?: number, maxWarteschlange?: number, maxBytes?: number, maxAntwortBytes?: number,
 *   bildPruefen?: (projektId: string|null) => {ok: boolean, text: string}}} o
 *   wartezeit / abholWarten in ms; maxBytes = largest request body of an agent; maxAntwortBytes = largest ANSWER body of the
 *   app (106-04: a view image as base64 is far larger than any command, so the answer limit is separate);
 *   bildPruefen (106-06): may an image of this project go to an agent (a target outside this computer)? Without it no image passes.
 *   geraetVon (106-07): id of the paired device a request comes from (office mode), null for none - only such a device may use the app
 *   side besides this computer. Default: no device ever.
 *   lokalNachlauf (ms, review fix 106-07): a tab of this computer counts as "around" this long after its last poll began or ended - the
 *   gap between two long polls must not hand a request meant for this computer to a device.
 * @returns {import('express').Router}
 */
export function steuerungRouter({ lokalGebunden, anfrageEntfernt = () => false, geraetVon = () => null, token, wartezeit = 10_000, abholWarten = 10_000, lokalNachlauf = 3_000, maxWarteschlange = 50, maxBytes = 64 * 1024, maxAntwortBytes = 4 * 1024 * 1024, bildPruefen }) {
  if (!token) throw new Error('steuerungRouter: Token fehlt');
  const r = Router();
  const erwartet = Buffer.from(token);
  /** @type {Array<{nr: number, zeile: string, abgeholt: boolean, wer: string|null, fertig: (antwort: string|null) => void}>} */
  const warteschlange = [];
  /** @type {Array<{abgeben: (eintrag: any) => void, aktiv: number, wer: string}>} */
  const abholer = [];
  /** Server time (ms) a tab of this computer last began or ended a poll; 0 = never. */
  let lokalZuletzt = 0;
  const lokalDa = () => abholer.some((a) => a.wer === 'lokal') || (lokalZuletzt > 0 && Date.now() - lokalZuletzt < lokalNachlauf);
  /**
   * May this poller ('lokal' or 'geraet:<id>') take this request? A device only the commands of GERAET_BEFEHLE, and only when the agent
   * names it (ziel) or no tab of this computer is around; a request named for a device never goes to this computer.
   */
  const darfAbholen = (/** @type {string} */ wer, /** @type {{zeile: string}} */ eintrag) => {
    const ziel = zielDerZeile(eintrag.zeile);
    if (wer === 'lokal') return ziel.art !== 'geraet';
    if (!geraetDarfZeile(eintrag.zeile)) return false;
    if (ziel.art === 'lokal') return false;
    if (ziel.art === 'geraet') return ziel.geraet === null || wer === `geraet:${ziel.geraet}`;
    return !lokalDa();
  };
  /**
   * The poller that gets the request: a tab of this computer before any device; among pollers of the same kind the latest user activity
   * (server time) wins. Activity times are never compared across kinds (review fix 106-07: a device clock cannot pull requests over).
   */
  const juengster = (/** @type {{zeile: string}} */ eintrag) => {
    let best = -1;
    for (let i = 0; i < abholer.length; i++) {
      if (!darfAbholen(abholer[i].wer, eintrag)) continue;
      if (best < 0) { best = i; continue; }
      const neu = abholer[i], bisher = abholer[best];
      const neuLokal = neu.wer === 'lokal', bisherLokal = bisher.wer === 'lokal';
      if (neuLokal !== bisherLokal) { if (neuLokal) best = i; continue; }
      if (neu.aktiv > bisher.aktiv) best = i;
    }
    return best < 0 ? null : abholer.splice(best, 1)[0];
  };
  /** Is there room for one more waiting poll of this kind ('lokal' | 'geraet:<id>')? */
  const platzFrei = (/** @type {string} */ wer) => {
    if (wer === 'lokal') return abholer.filter((a) => a.wer === 'lokal').length < ABHOLER_GRENZEN.lokal;
    const geraete = abholer.filter((a) => a.wer !== 'lokal');
    return geraete.length < ABHOLER_GRENZEN.geraete && geraete.filter((a) => a.wer === wer).length < ABHOLER_GRENZEN.jeGeraet;
  };
  let naechsteNr = 1;

  const nurLokal = (req, res) => {
    if (!lokalGebunden || anfrageEntfernt(req)) { res.status(403).json({ ok: false, error: 'Nur auf diesem Rechner möglich.' }); return false; }
    return true;
  };
  /**
   * App side (poll, answer): this computer, or - 106-07 - a paired device of the office mode. Answers 403 otherwise.
   * @returns {string|null} 'lokal' | 'geraet:<id>' | null (refused, the answer is sent)
   */
  const appSeite = (/** @type {any} */ req, /** @type {any} */ res) => {
    if (lokalGebunden && !anfrageEntfernt(req)) return 'lokal';
    const geraet = lokalGebunden ? geraetVon(req) : null;
    if (geraet) return `geraet:${geraet}`;
    res.status(403).json({ ok: false, error: 'Nur auf diesem Rechner oder einem gekoppelten Gerät möglich.' });
    return null;
  };
  const uebergeben = (eintrag, /** @type {string} */ wer) => { eintrag.abgeholt = true; eintrag.wer = wer; return { nr: eintrag.nr, zeile: eintrag.zeile }; };

  r.post('/steuerung', express.text({ type: '*/*', limit: maxBytes }), (req, res) => {
    if (!nurLokal(req, res)) return;
    const kopf = Buffer.from(String(req.headers[STEUERUNGS_KOPF] || ''));
    if (kopf.length !== erwartet.length || !crypto.timingSafeEqual(kopf, erwartet)) return res.status(401).json({ ok: false, error: 'Steuerungs-Token fehlt oder falsch (Datei steuerung.token im Datenordner).' });
    const zeile = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    let id = null;
    try { id = JSON.parse(zeile)?.id ?? null; } catch { return res.status(400).json({ id: null, ok: false, error: 'Kein gültiges JSON' }); }
    if (warteschlange.length >= maxWarteschlange) return res.status(503).json({ id, ok: false, status: 'not-run', error: 'Warteschlange voll' });
    const eintrag = {
      nr: naechsteNr++, zeile, abgeholt: false, wer: /** @type {string|null} */ (null),
      fertig: (/** @type {string|null} */ antwort) => {
        clearTimeout(uhr);
        const i = warteschlange.indexOf(eintrag);
        if (i >= 0) warteschlange.splice(i, 1);
        if (antwort == null) {
          res.status(504).json(eintrag.abgeholt
            ? { id, ok: false, status: 'may-have-run', error: 'Die App hat die Anfrage übernommen, aber nicht rechtzeitig geantwortet — Zustand prüfen, bevor wiederholt wird.' }
            : { id, ok: false, status: 'not-run', error: 'Keine geöffnete Zeichenfläche hat die Anfrage abgeholt — darf wiederholt werden.' });
          return;
        }
        res.type('application/json').send(oberflaecheNennen(bildAntwortPruefen(antwort, id, bildPruefen), eintrag.wer));
      },
    };
    const uhr = setTimeout(() => eintrag.fertig(null), wartezeit);
    warteschlange.push(eintrag);
    const wartend = juengster(eintrag);
    if (wartend) wartend.abgeben(uebergeben(eintrag, wartend.wer));
  });

  r.get('/steuerung/naechste', (req, res) => {
    const wer = appSeite(req, res);
    if (!wer) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Nur aus der App selbst.' });
    res.set('Cache-Control', 'no-store');
    if (wer === 'lokal') lokalZuletzt = Date.now();
    const offen = warteschlange.find((e) => !e.abgeholt && darfAbholen(wer, e));
    if (offen) return res.json(uebergeben(offen, wer));
    if (!platzFrei(wer)) return res.status(204).set(VOLL_KOPF, '1').end(); // more pollers of this kind than useful: the bridge pauses
    let erledigt = false;
    const aktiv = aktivZeit(req.query, Date.now());
    const abgeben = (/** @type {any} */ eintrag) => { if (erledigt) return; erledigt = true; clearTimeout(uhr); if (wer === 'lokal') lokalZuletzt = Date.now(); res.json(eintrag); };
    const platz = { abgeben, aktiv, wer };
    const uhr = setTimeout(() => {
      if (erledigt) return;
      erledigt = true;
      const i = abholer.indexOf(platz);
      if (i >= 0) abholer.splice(i, 1);
      if (wer === 'lokal') lokalZuletzt = Date.now();
      res.status(204).end();
    }, abholWarten);
    req.on('close', () => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      const i = abholer.indexOf(platz);
      if (i >= 0) abholer.splice(i, 1);
      if (wer === 'lokal') lokalZuletzt = Date.now();
    });
    abholer.push(platz);
  });

  r.post('/steuerung/antwort', express.json({ limit: maxAntwortBytes }), (req, res) => {
    const wer = appSeite(req, res);
    if (!wer) return;
    const nr = Number(req.body?.nr);
    // only the poller that took the request may answer it (106-07: a device never answers for this computer or another device)
    const eintrag = warteschlange.find((e) => e.nr === nr && e.abgeholt && e.wer === wer);
    if (!eintrag) return res.status(404).json({ ok: false, error: 'Anfrage unbekannt oder schon beantwortet' });
    eintrag.fertig(typeof req.body?.antwort === 'string' ? req.body.antwort : JSON.stringify(req.body?.antwort ?? null));
    res.json({ ok: true });
  });

  // a body over a limit: a short JSON answer instead of the framework's stack trace in the log
  r.use((/** @type {any} */ err, /** @type {any} */ _req, /** @type {any} */ res, /** @type {any} */ next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Anfrage zu groß für den Steuerkanal.' });
    return next(err);
  });

  return r;
}
