// steuerungRouter.js — local control protocol for agents (phase 104-04), mounted under /api by server/index.js.
// Idea: the local JSON control channel seen in the Craft apps (cadcraft), own implementation; the commands are the
// ones of the open drawing surface (104-03 command register, window.__bitBefehle).
//
//   POST /api/steuerung              agent → {"id","method","params"} (same lines as befehlsregister.zeileBearbeiten)
//                                    header x-bit-steuerung: <token from the token file>
//                                    → the answer of the open app, or after `wartezeit`:
//                                      {ok:false, status:"not-run"}      — no app took the request (safe to retry)
//                                      {ok:false, status:"may-have-run"} — taken but unanswered (check state first)
//   GET  /api/steuerung/naechste?aktiv=<ms>  app (long poll) → 200 {nr, zeile} or 204 after `abholWarten`;
//                                    with several open tabs the one with the latest user activity gets the request
//   POST /api/steuerung/antwort      app → {nr, antwort} (answer line); browser writes carry the session header
//
// Long polls end after `abholWarten` (10 s): behind the Vite dev proxy a closed tab's poll is not torn down until
// then (the proxy does not pass the abort on), and a request handed to it answers "may-have-run". Short polls keep
// that window small; in the installed app (no proxy) a closed tab is noticed at once.
//
// Security: loopback-only server, never for paired LAN devices (anfrageEntfernt); the agent side needs the random
// token written at start to <data folder>/steuerung.token (mode 0600) — binding to 127.0.0.1 alone would let any
// local web page in through the browser; the app side is refused for cross-site requests. Limits: request size,
// queue length, waiting pollers.
//
// In:  { lokalGebunden, anfrageEntfernt?, token, wartezeit?, abholWarten?, maxWarteschlange?, maxBytes? }
// Out: an Express router.

import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';

/** Header of the agent token. */
export const STEUERUNGS_KOPF = 'x-bit-steuerung';

/** New random token (hex). */
export function steuerungsToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * @param {{lokalGebunden: boolean, anfrageEntfernt?: (req: any) => boolean, token: string, wartezeit?: number,
 *   abholWarten?: number, maxWarteschlange?: number, maxBytes?: number}} o
 *   wartezeit / abholWarten in ms; maxBytes = largest request body
 * @returns {import('express').Router}
 */
export function steuerungRouter({ lokalGebunden, anfrageEntfernt = () => false, token, wartezeit = 10_000, abholWarten = 10_000, maxWarteschlange = 50, maxBytes = 64 * 1024 }) {
  if (!token) throw new Error('steuerungRouter: Token fehlt');
  const r = Router();
  const erwartet = Buffer.from(token);
  /** @type {Array<{nr: number, zeile: string, abgeholt: boolean, fertig: (antwort: string|null) => void}>} */
  const warteschlange = [];
  /** @type {Array<{abgeben: (eintrag: any) => void, aktiv: number}>} */
  const abholer = [];
  /** The waiting tab with the latest user activity (ms) — the one the user works in. */
  const juengster = () => {
    if (!abholer.length) return null;
    let best = 0;
    for (let i = 1; i < abholer.length; i++) if (abholer[i].aktiv > abholer[best].aktiv) best = i;
    return abholer.splice(best, 1)[0];
  };
  let naechsteNr = 1;

  const nurLokal = (req, res) => {
    if (!lokalGebunden || anfrageEntfernt(req)) { res.status(403).json({ ok: false, error: 'Nur auf diesem Rechner möglich.' }); return false; }
    return true;
  };
  const uebergeben = (eintrag) => { eintrag.abgeholt = true; return { nr: eintrag.nr, zeile: eintrag.zeile }; };

  r.post('/steuerung', express.text({ type: '*/*', limit: maxBytes }), (req, res) => {
    if (!nurLokal(req, res)) return;
    const kopf = Buffer.from(String(req.headers[STEUERUNGS_KOPF] || ''));
    if (kopf.length !== erwartet.length || !crypto.timingSafeEqual(kopf, erwartet)) return res.status(401).json({ ok: false, error: 'Steuerungs-Token fehlt oder falsch (Datei steuerung.token im Datenordner).' });
    const zeile = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    let id = null;
    try { id = JSON.parse(zeile)?.id ?? null; } catch { return res.status(400).json({ id: null, ok: false, error: 'Kein gültiges JSON' }); }
    if (warteschlange.length >= maxWarteschlange) return res.status(503).json({ id, ok: false, status: 'not-run', error: 'Warteschlange voll' });
    const eintrag = {
      nr: naechsteNr++, zeile, abgeholt: false,
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
        res.type('application/json').send(antwort);
      },
    };
    const uhr = setTimeout(() => eintrag.fertig(null), wartezeit);
    warteschlange.push(eintrag);
    const wartend = juengster();
    if (wartend) wartend.abgeben(uebergeben(eintrag));
  });

  r.get('/steuerung/naechste', (req, res) => {
    if (!nurLokal(req, res)) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Nur aus der App selbst.' });
    res.set('Cache-Control', 'no-store');
    const offen = warteschlange.find((e) => !e.abgeholt);
    if (offen) return res.json(uebergeben(offen));
    if (abholer.length >= 8) return res.status(204).end(); // more tabs polling than useful
    let erledigt = false;
    const aktiv = Number(req.query?.aktiv) || 0;
    const abgeben = (/** @type {any} */ eintrag) => { if (erledigt) return; erledigt = true; clearTimeout(uhr); res.json(eintrag); };
    const platz = { abgeben, aktiv };
    const uhr = setTimeout(() => {
      if (erledigt) return;
      erledigt = true;
      const i = abholer.indexOf(platz);
      if (i >= 0) abholer.splice(i, 1);
      res.status(204).end();
    }, abholWarten);
    req.on('close', () => { if (!erledigt) { erledigt = true; clearTimeout(uhr); const i = abholer.indexOf(platz); if (i >= 0) abholer.splice(i, 1); } });
    abholer.push(platz);
  });

  r.post('/steuerung/antwort', express.json({ limit: maxBytes }), (req, res) => {
    if (!nurLokal(req, res)) return;
    const nr = Number(req.body?.nr);
    const eintrag = warteschlange.find((e) => e.nr === nr && e.abgeholt);
    if (!eintrag) return res.status(404).json({ ok: false, error: 'Anfrage unbekannt oder schon beantwortet' });
    eintrag.fertig(typeof req.body?.antwort === 'string' ? req.body.antwort : JSON.stringify(req.body?.antwort ?? null));
    res.json({ ok: true });
  });

  return r;
}
