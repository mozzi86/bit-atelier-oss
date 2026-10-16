// sitzungsSchutz.js — session header for the local API (plan 96-04).
//
// Why: CORS only hides RESPONSES from foreign pages. A "simple" request — a
// form POST with text/plain or urlencoded body, no custom header — is still
// EXECUTED by the server, so any web page open in the same browser could fire
// writes at http://127.0.0.1:3001/api (create junk records, trigger actions).
// From now on a browser write needs the header X-Bit-Session with a random
// token created at server start. A custom header makes the browser send a CORS
// preflight first, which the origin allow-list refuses for foreign pages, and
// the token itself also refuses a different app that happens to run on an
// allowed origin (e.g. another clone's Vite on :5173).
//
// Who is NOT asked for the token:
//  - reads (GET/HEAD/OPTIONS);
//  - non-browser clients on this machine (no Origin AND no Sec-Fetch-* header:
//    the MCP server, the AI harness, update and import tools, tests). A local
//    process can read the data files directly anyway — the header guards
//    against browsers, not against the machine's own programs;
//  - the office-mode pairing routes (an unpaired device has no session yet;
//    bueroRouter.js checks code, cookie and origin itself).
//
// The app gets the token from GET /api/sitzung (refused for cross-site
// requests; a foreign page could not read the response anyway) and sends it on
// every write (src/lib/sitzungsKopf.js). After a server restart the token
// changes: the 401 carries X-Bit-Sitzung-Erneuern so the client fetches the new
// token once and repeats the request.
//
// In:  the token (injectable for tests). Out: sitzungsToken(), sitzungsSchutz(), sitzungsRouter(),
//      SITZUNGS_KOPF, ERNEUERN_KOPF.

import crypto from 'node:crypto';
import { Router } from 'express';

/** Request header that carries the session token. */
export const SITZUNGS_KOPF = 'x-bit-session';
/** Response header of a 401 that asks the client to fetch a new token. */
export const ERNEUERN_KOPF = 'X-Bit-Sitzung-Erneuern';

/** Methods that never change data. */
const LESEND = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths below /api that an unpaired office-mode device must reach without a session. */
const AUSNAHMEN = new Set(['/buero/koppeln', '/buero/abmelden']);

/**
 * A new random session token (24 bytes, base64url).
 * @returns {string}
 */
export function sitzungsToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Whether a request comes from a browser: browsers send Origin on every
 * non-GET request and Sec-Fetch-* on every request (Fetch Metadata).
 * @param {{headers: Record<string, string|string[]|undefined>}} req
 * @returns {boolean}
 */
export function vomBrowser(req) {
  const h = req.headers || {};
  return Boolean(h.origin || h['sec-fetch-site'] || h['sec-fetch-mode']);
}

/**
 * Express middleware for /api: browser writes need the session header.
 * @param {{token: string}} optionen token = this server run's session token
 * @returns {import('express').RequestHandler}
 */
export function sitzungsSchutz({ token }) {
  if (!token) throw new Error('sitzungsSchutz: Token fehlt');
  const erwartet = Buffer.from(token);
  return (req, res, next) => {
    if (LESEND.has(req.method) || AUSNAHMEN.has(req.path) || !vomBrowser(req)) return next();
    const kopf = Buffer.from(String(req.headers[SITZUNGS_KOPF] || ''));
    if (kopf.length === erwartet.length && crypto.timingSafeEqual(kopf, erwartet)) return next();
    res.set(ERNEUERN_KOPF, '1');
    return res.status(401).json({ error: 'Sitzung fehlt oder ist abgelaufen — bitte die Seite neu laden.' });
  };
}

/**
 * GET /sitzung → {token}. Cross-site requests are refused (Fetch Metadata);
 * the origin allow-list of the CORS layer additionally hides the response
 * from foreign pages.
 * @param {{token: string}} optionen
 * @returns {import('express').Router}
 */
export function sitzungsRouter({ token }) {
  const r = Router();
  r.get('/sitzung', (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Nur aus der App selbst.' });
    res.set('Cache-Control', 'no-store');
    res.json({ token });
  });
  return r;
}
