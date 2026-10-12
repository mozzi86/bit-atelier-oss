// programmRouter.js — "Programm beenden" for the local edition (plan 93-11), mounted under /api by
// server/index.js:
//
//   POST /api/programm/beenden  → { ok: true }, then the server writes its databases and stops
//
// Why: since 93-11 the installed app starts its server WITHOUT a console window (tools/app-start.mjs), and
// the server keeps running when the last app window closes (93-11 D-03: no idle shutdown mid-save, the
// .bitproj double-click and AI clients find it). Without a console there is no Ctrl+C — Settings › System
// & Info offers the button instead.
//
// Security: loopback-only server, never for a paired LAN device of the office mode (anfrageEntfernt), POST
// with the app's own Origin (same rule as systemRouter) — a foreign web page cannot stop the program.
//
// In:  { lokalGebunden, port, origins?, anfrageEntfernt?, beenden } — beenden = the shutdown the
//      composition root provides (flush databases, close the server, exit); injected so tests never exit.
// Out: an Express router.

import { Router } from 'express';

/** Delay between the answer and the shutdown, ms — the response must reach the app first. */
export const BEENDEN_VERZOEGERUNG_MS = 300;

/**
 * @param {{lokalGebunden: boolean, port: number|string, origins?: string[], anfrageEntfernt?: (req: any) => boolean,
 *   beenden: () => void, verzoegerung?: number}} o
 * @returns {import('express').Router}
 */
export function programmRouter({ lokalGebunden, port, origins = [], anfrageEntfernt = () => false, beenden, verzoegerung = BEENDEN_VERZOEGERUNG_MS }) {
  const r = Router();
  const erlaubteOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...origins]);
  let laeuft = false;

  r.post('/programm/beenden', (req, res) => {
    if (!lokalGebunden || anfrageEntfernt(req)) return res.status(403).json({ error: 'Nur auf diesem Rechner möglich.' });
    if (!erlaubteOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    res.json({ ok: true });
    if (laeuft) return;
    laeuft = true;
    setTimeout(beenden, verzoegerung).unref?.();
  });

  return r;
}
