// bueroRouter.js — the Express side of the office mode (plan 93-03, lever 158). Three pieces, all used by
// server/index.js:
//
//   bueroWaechter(buero)   the FIRST middleware of the app. Loopback requests pass unchanged (as before 93-03).
//                          Every other request needs office mode on AND a private source address; /api then
//                          needs a paired device token (httpOnly cookie `bit_geraet` or `Authorization: Bearer`)
//                          and may only reach the device allow-list below. Cookie requests that write need an
//                          Origin equal to their own host (CSRF). Sets req.bitZugang = {lokal, geraet}.
//   bueroRouter(buero, …)  routes under /api/buero (+ /api/auth/me for devices):
//                            GET  /buero/ich            who am I (host / paired device / unpaired device)
//                            POST /buero/koppeln        {code, alsToken?} → cookie (+ token on request)  [device]
//                            POST /buero/abmelden       revoke the own token                            [device]
//                            GET  /buero/status         on/off, LAN URLs, devices, open code            [host]
//                            POST /buero/aktivieren     {aktiv} → binds/unbinds the LAN listeners      [host + app Origin]
//                            POST /buero/code           {name} → 6-digit code, 10 minutes              [host + app Origin]
//                            GET  /buero/geraete        paired devices                                  [host]
//                            DELETE /buero/geraete/:id  revoke a device                                 [host + app Origin]
//   lanServer({app, port}) the extra listeners on this computer's private IPv4 addresses (same app, same port).
//
// Why an allow-list for devices and not a deny-list: a route added later is host-only until somebody decides
// otherwise. Not on it: /system (paths of the user account), /update (installs software), /llm (API keys),
// /buero admin, the dev IFC/filter routes (folders on this disk), /personal (unless PERSONAL_LAN=1).
//
// In:  a Buero from bueroModus.js; options below. Out: middleware, router, listener manager.

import http from 'node:http';
import { Router } from 'express';
import { adressArt, normalisiereAdresse, lanAdressen, TOKEN_GUELTIG_MS } from './bueroModus.js';

/** Name of the device cookie. */
export const COOKIE_NAME = 'bit_geraet';
/** Response header that tells a client its write replaced a newer version (see routes.js entitiesRouter). */
export const HINWEIS_HEADER = 'X-Bit-Hinweis';

const LESEND = new Set(['GET', 'HEAD']);

/**
 * What a paired device may call: [methods, path pattern]. Patterns are anchored and case-sensitive, so a
 * spelling Express would still route (it matches paths case-insensitively) is refused, never let through.
 * @type {ReadonlyArray<[ReadonlySet<string>|'*', RegExp]>}
 */
const GERAET_ERLAUBT = Object.freeze([
  [LESEND, /^\/api\/auth\/me$/],
  ['*', /^\/api\/entities(\/[^/]+){0,2}$/],
  [LESEND, /^\/api\/catalogs$/],
  ['*', /^\/api\/blobs(\/[^/]+)?$/],
  [new Set(['POST']), /^\/api\/integrations\/(invoke-llm|typesafe)$/],
  [new Set(['POST']), /^\/api\/prices\/ted-search$/],
  [LESEND, /^\/api\/(weather|elevation|climate|osm-buildings|osm-environment)$/],
  [LESEND, /^\/api\/status$/],
  [LESEND, /^\/api\/telemetry\/config$/],
  [LESEND, /^\/api\/buero\/ich$/],
  [new Set(['POST']), /^\/api\/buero\/abmelden$/],
]);
/** HR data: only with PERSONAL_LAN=1 (D-P80-05), and then only for paired devices. */
const PERSONAL_PFAD = /^\/api\/personal(-dateien)?(\/[^/]+){1,2}$/;

/** Anything that looks like the API, in any spelling Express might still route. */
const API_SEGMENT = /(^|\/)api(\/|$)/i;

/**
 * Whether a paired device may call this method on this path.
 * @param {string} methode HTTP method, upper case
 * @param {string} pfad request path (req.path, not decoded)
 * @param {boolean} [personalImLan] PERSONAL_LAN=1 set by the office
 * @returns {boolean}
 */
export function geraetDarf(methode, pfad, personalImLan = false) {
  if (personalImLan && PERSONAL_PFAD.test(pfad)) return true;
  return GERAET_ERLAUBT.some(([m, re]) => (m === '*' || m.has(methode)) && re.test(pfad));
}

/**
 * The device token of a request: `Authorization: Bearer …` wins over the cookie.
 * @param {{headers: Record<string, any>}} req
 * @returns {{token: string|null, art: 'bearer'|'cookie'|null}}
 */
export function tokenAusAnfrage(req) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(auth.trim());
  if (m) return { token: m[1], art: 'bearer' };
  for (const teil of String(req.headers.cookie || '').split(';')) {
    const i = teil.indexOf('=');
    if (i > 0 && teil.slice(0, i).trim() === COOKIE_NAME) {
      const wert = teil.slice(i + 1).trim();
      if (/^[A-Za-z0-9_-]{20,200}$/.test(wert)) return { token: wert, art: 'cookie' };
    }
  }
  return { token: null, art: null };
}

/**
 * Same-origin check of a browser request: the Origin header names exactly the host the request went to.
 * @param {{headers: Record<string, any>}} req
 * @returns {boolean} false without Origin
 */
export function gleicherUrsprung(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && u.host === String(req.headers.host || '');
  } catch {
    return false;
  }
}

/**
 * Cookie line for a device token.
 * @param {string} token
 * @returns {string}
 */
function geraetCookie(token) {
  // No `Secure`: office mode is plain HTTP in the LAN (no TLS, see SECURITY.md). SameSite=Strict keeps the
  // cookie off every cross-site request; HttpOnly keeps it away from scripts on the page.
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(TOKEN_GUELTIG_MS / 1000)}`;
}

/**
 * @typedef {{lokal: boolean, geraet: import('./bueroModus.js').GeraetOeffentlich|null, quelle: string}} BitZugang
 */

/**
 * The gate in front of the whole app (mount before CORS and every router).
 * @param {import('./bueroModus.js').Buero} buero
 * @param {{personalImLan?: () => boolean, adresseVon?: (req: any) => string|undefined}} [o]
 *   personalImLan = PERSONAL_LAN=1; adresseVon = source address (injectable for tests)
 * @returns {import('express').RequestHandler}
 */
export function bueroWaechter(buero, { personalImLan = () => process.env.PERSONAL_LAN === '1', adresseVon = (req) => req.socket?.remoteAddress } = {}) {
  return (req, res, next) => {
    const quelle = normalisiereAdresse(adresseVon(req));
    const art = adressArt(quelle);
    const zugang = /** @type {BitZugang} */ ({ lokal: art === 'loopback', geraet: null, quelle });
    /** @type {any} */ (req).bitZugang = zugang;
    if (zugang.lokal) return next();

    if (!buero.istAktiv()) {
      return res.status(403).json({ error: 'Büro-Modus ist aus: diese Installation ist nur auf dem Büro-Rechner erreichbar.' });
    }
    if (art !== 'privat') {
      return res.status(403).json({ error: 'Nur aus dem Büro-Netz erreichbar (private Adresse).' });
    }

    const { token, art: tokenArt } = tokenAusAnfrage(req);
    zugang.geraet = buero.geraetFuerToken(token);
    const pfad = req.path;

    // The app shell (index.html, JS, CSS, icons) carries no data — an unpaired tablet needs it to show the
    // pairing page. Only reading methods.
    if (!API_SEGMENT.test(pfad)) {
      if (!LESEND.has(req.method)) return res.status(405).json({ error: 'Nicht erlaubt.' });
      return next();
    }
    res.setHeader('Cache-Control', 'no-store');
    if (pfad === '/api/buero/ich' && LESEND.has(req.method)) return next();
    if (pfad === '/api/buero/koppeln' && req.method === 'POST') {
      // A browser always sends Origin on POST; a script may omit it. A foreign page may not pair.
      if (req.headers.origin && !gleicherUrsprung(req)) return res.status(403).json({ error: 'Kopplung nur aus der App selbst.' });
      return next();
    }
    if (!zugang.geraet) {
      return res.status(401).json({ error: 'Dieses Gerät ist nicht gekoppelt oder die Kopplung ist abgelaufen.', koppeln: true });
    }
    if (tokenArt === 'cookie' && !LESEND.has(req.method) && !gleicherUrsprung(req)) {
      return res.status(403).json({ error: 'Anfrage von fremder Seite abgelehnt.' });
    }
    if (!geraetDarf(req.method, pfad, personalImLan())) {
      return res.status(403).json({ error: 'Nur am Büro-Rechner verfügbar.' });
    }
    next();
  };
}

/**
 * Extra HTTP listeners on the private IPv4 addresses of this computer — the same Express app, the same port.
 * Binding the specific addresses (not 0.0.0.0) keeps public IPv6 addresses of the router out.
 * @param {{app: import('express').Express, port: number|string, adressenFn?: () => string[]}} o
 */
export function lanServer({ app, port, adressenFn = () => lanAdressen() }) {
  /** @type {Array<{adresse: string, server: import('node:http').Server}>} */
  let laufend = [];
  /** @type {string[]} */
  let fehler = [];

  return {
    /**
     * Bind every private address (again). Resolves after each listen succeeded or failed.
     * @returns {Promise<{adressen: string[], fehler: string[]}>}
     */
    async starten() {
      await this.stoppen();
      fehler = [];
      const ziele = adressenFn();
      if (ziele.length === 0) fehler.push('Keine private Netzwerkadresse gefunden (WLAN/LAN verbunden?).');
      for (const adresse of ziele) {
        const server = http.createServer(app);
        // eslint-disable-next-line no-await-in-loop
        const ok = await new Promise((resolve) => {
          server.once('error', (e) => { fehler.push(`${adresse}:${port} — ${/** @type {any} */ (e).code || /** @type {any} */ (e).message}`); resolve(false); });
          server.listen(Number(port), adresse, () => resolve(true));
        });
        if (ok) laufend.push({ adresse, server });
      }
      return { adressen: this.adressen(), fehler: [...fehler] };
    },
    /** Close the listeners and every open connection (keep-alive sockets would otherwise stay usable). */
    async stoppen() {
      const alt = laufend;
      laufend = [];
      await Promise.all(alt.map(({ server }) => new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections?.();
      })));
    },
    /** @returns {string[]} addresses that are listening now */
    adressen: () => laufend.map((l) => l.adresse),
    /** @returns {string[]} problems of the last start */
    fehler: () => [...fehler],
    /** @returns {string[]} browser origins of the listeners, e.g. 'http://192.168.1.5:3001' */
    origins: () => laufend.map((l) => `http://${l.adresse}:${port}`),
  };
}

/** @typedef {ReturnType<typeof lanServer>} LanServer */

/**
 * Routes of the office mode, mounted under /api BEFORE authRouter (it answers /auth/me for devices).
 * @param {import('./bueroModus.js').Buero} buero
 * @param {{port: number|string, appModus: boolean, origins?: string[],
 *   lan: Pick<LanServer, 'starten'|'stoppen'|'adressen'|'fehler'>}} o
 *   origins = further app origins that may trigger host actions (Vite dev server); lan = listener manager
 * @returns {import('express').Router}
 */
export function bueroRouter(buero, { port, appModus, origins = [], lan }) {
  const r = Router();
  const appOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...origins]);
  /** @param {any} req @returns {BitZugang} */
  const zugang = (req) => req.bitZugang || { lokal: false, geraet: null, quelle: '' };

  /** Host only (loopback). */
  const nurHost = (req, res, next) => (zugang(req).lokal ? next()
    : res.status(403).json({ error: 'Nur am Büro-Rechner verfügbar.' }));
  /** Host only, and the request comes from the app itself (no foreign local page, no bare script). */
  const hostAktion = (req, res, next) => {
    if (!zugang(req).lokal) return res.status(403).json({ error: 'Nur am Büro-Rechner verfügbar.' });
    if (!appOrigins.has(String(req.headers.origin || ''))) return res.status(403).json({ error: 'Nur aus der App selbst erlaubt.' });
    next();
  };

  const status = () => {
    const adressen = lan.adressen();
    return {
      aktiv: buero.istAktiv(), port: Number(port), appModus,
      adressen, urls: adressen.map((a) => `http://${a}:${port}/`), fehler: lan.fehler(),
      geraete: buero.geraete(), offenerCode: buero.offenerCode(),
    };
  };

  // Devices see who they are; the role is "Projektleitung" (no HR, no rights, settings read-only) — the
  // server allow-list above is the real boundary, the role only shapes the menu.
  r.get('/auth/me', (req, res, next) => {
    const g = zugang(req).geraet;
    if (!g) return next();
    res.json({ id: `geraet-${g.id}`, full_name: `Gerät: ${g.name}`, email: '', role: 'planner', buero_rolle: 'projektleitung', geraet: g });
  });

  r.get('/buero/ich', (req, res) => {
    const z = zugang(req);
    if (z.lokal) return res.json({ lokal: true, aktiv: buero.istAktiv(), appModus });
    res.json({ lokal: false, aktiv: buero.istAktiv(), geraet: z.geraet });
  });

  r.post('/buero/koppeln', (req, res) => {
    const z = zugang(req);
    if (z.lokal) return res.status(400).json({ error: 'Dieser Rechner braucht keine Kopplung.' });
    const e = buero.koppeln(req.body?.code, z.quelle);
    if (!e.ok) {
      if (e.warteSekunden) res.setHeader('Retry-After', String(e.warteSekunden));
      return res.status(e.status).json({ error: e.fehler });
    }
    res.setHeader('Set-Cookie', geraetCookie(e.token));
    res.json({ geraet: e.geraet, ...(req.body?.alsToken === true ? { token: e.token } : {}) });
  });

  r.post('/buero/abmelden', (req, res) => {
    const g = zugang(req).geraet;
    if (!g) return res.status(401).json({ error: 'Nicht gekoppelt.' });
    buero.widerrufen(g.id);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  r.get('/buero/status', nurHost, (_req, res) => res.json(status()));

  r.post('/buero/aktivieren', hostAktion, async (req, res) => {
    const an = req.body?.aktiv === true;
    try {
      buero.setzeAktiv(an);
      if (an) {
        await lan.starten();
        console.warn(`[buero] Office mode ON — paired devices in this network may use the app: ${lan.adressen().map((a) => `http://${a}:${port}`).join(', ') || '(no address bound)'}`);
      } else {
        await lan.stoppen();
        console.log('[buero] Office mode off — this computer only.');
      }
      res.json(status());
    } catch (e) {
      res.status(500).json({ error: /** @type {any} */ (e).message });
    }
  });

  r.post('/buero/code', hostAktion, (req, res) => {
    try {
      res.json(buero.codeErzeugen(req.body?.name));
    } catch (e) {
      res.status(400).json({ error: /** @type {any} */ (e).message });
    }
  });

  r.get('/buero/geraete', nurHost, (_req, res) => res.json(buero.geraete()));

  r.delete('/buero/geraete/:id', hostAktion, (req, res) => {
    if (!buero.widerrufen(req.params.id)) return res.status(404).json({ error: 'Gerät nicht gefunden.' });
    res.json({ ok: true });
  });

  return r;
}
