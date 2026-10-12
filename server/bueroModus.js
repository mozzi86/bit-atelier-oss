// bueroModus.js — the pure core of the office mode (plan 93-03, lever 158): a second workstation or a site
// tablet in the same office LAN may use this local installation, but only after it was paired on this
// computer. No Express in here — the router (bueroRouter.js) and the composition root use these pieces.
//
//   adressArt(ip)          → 'loopback' | 'privat' | 'oeffentlich'   (who is asking)
//   lanAdressen(netz?)     → private IPv4 addresses of this computer  (where the LAN listeners bind)
//   createBuero({ datei }) → the state: on/off, pairing code, paired devices (token hashes), rate limit
//
// Security model (threat list in .planning/phases/93-hebel-156-164/93-03-PLAN.md):
// - A pairing code is 6 digits, valid 10 minutes, single use, burnt after 5 wrong guesses; every source
//   address may try 10 times per 10 minutes. 5 guesses out of 10^6 leave a chance of 1 : 200 000 per code.
// - A device token is 32 random bytes (base64url). The file stores only its SHA-256 — a token with 256 bits
//   of entropy needs no slow hash, there is no dictionary to try. Tokens expire after 30 days.
// - The state file buero.json lives in the data folder (datenPfad.js) next to db.json and is written
//   atomically (tmp + rename).
//
// In:  { datei, jetzt?, zufallsCode?, zufallsToken? } (clock and randomness injectable for tests).
// Out: the functions below; nothing listens on a port here.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Lifetime of a pairing code, in milliseconds (10 minutes). */
export const CODE_GUELTIG_MS = 10 * 60 * 1000;
/** Wrong guesses after which the current code is burnt. */
export const CODE_MAX_FEHLVERSUCHE = 5;
/** Pairing attempts per source address and window. */
export const DROSSEL_MAX_VERSUCHE = 10;
/** Window of the pairing rate limit, in milliseconds (10 minutes). */
export const DROSSEL_FENSTER_MS = 10 * 60 * 1000;
/** Lifetime of a device token, in milliseconds (30 days). [ASSUMED] long enough for a site tablet, short enough that a lost device runs out by itself. */
export const TOKEN_GUELTIG_MS = 30 * 24 * 60 * 60 * 1000;
/** "last seen" is written to disk at most this often per device, in milliseconds (10 minutes). */
const ZULETZT_SCHREIBEN_MS = 10 * 60 * 1000;
/** Longest device name, in characters. */
export const NAME_MAX = 60;

/**
 * Strip the IPv4-mapped prefix and an IPv6 zone id from a socket address.
 * @param {string|undefined|null} ip e.g. '::ffff:192.168.1.5', 'fe80::1%12', '127.0.0.1'
 * @returns {string} the bare address, lower case ('' for nothing)
 */
export function normalisiereAdresse(ip) {
  let a = String(ip || '').trim().toLowerCase();
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (a.startsWith('::ffff:') && a.includes('.')) a = a.slice(7);
  return a;
}

/**
 * Parse a dotted IPv4 address.
 * @param {string} a
 * @returns {number[]|null} the four octets, or null when `a` is no IPv4 address
 */
function ipv4Oktette(a) {
  const teile = a.split('.');
  if (teile.length !== 4) return null;
  const zahlen = teile.map((t) => (/^\d{1,3}$/.test(t) ? Number(t) : NaN));
  return zahlen.every((z) => Number.isInteger(z) && z >= 0 && z <= 255) ? zahlen : null;
}

/**
 * Class of a source address.
 * - loopback: 127.0.0.0/8, ::1 — this computer; office mode never changes what these may do.
 * - privat: RFC 1918 (10/8, 172.16/12, 192.168/16), link-local 169.254/16 and fe80::/10, IPv6 ULA fc00::/7.
 * - oeffentlich: everything else, including garbage — rejected in office mode.
 * @param {string|undefined|null} ip socket address (req.socket.remoteAddress)
 * @returns {'loopback'|'privat'|'oeffentlich'}
 */
export function adressArt(ip) {
  const a = normalisiereAdresse(ip);
  const v4 = ipv4Oktette(a);
  if (v4) {
    const [x, y] = v4;
    if (x === 127) return 'loopback';
    if (x === 10) return 'privat';
    if (x === 172 && y >= 16 && y <= 31) return 'privat';
    if (x === 192 && y === 168) return 'privat';
    if (x === 169 && y === 254) return 'privat';
    return 'oeffentlich';
  }
  if (!a.includes(':') || !/^[0-9a-f:]+$/.test(a)) return 'oeffentlich';
  if (a === '::1' || /^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(a)) return 'loopback';
  const erstes = parseInt(a.split(':')[0] || '0', 16);
  if ((erstes & 0xffc0) === 0xfe80) return 'privat'; // fe80::/10 link-local
  if ((erstes & 0xfe00) === 0xfc00) return 'privat'; // fc00::/7 unique local
  return 'oeffentlich';
}

/**
 * Private IPv4 addresses of this computer's network adapters — where the LAN listeners bind. IPv6 is left out
 * on purpose: link-local needs a zone id and the global IPv6 addresses of a home router are public.
 * @param {ReturnType<typeof os.networkInterfaces>} [netz] default os.networkInterfaces()
 * @returns {string[]} e.g. ['192.168.178.20'], sorted, without duplicates
 */
export function lanAdressen(netz = os.networkInterfaces()) {
  const raus = new Set();
  for (const liste of Object.values(netz || {})) {
    for (const n of liste || []) {
      const fam = /** @type {any} */ (n.family);
      const istV4 = fam === 'IPv4' || fam === 4;
      if (!n.internal && istV4 && adressArt(n.address) === 'privat' && !n.address.startsWith('169.254.')) raus.add(n.address);
    }
  }
  return [...raus].sort();
}

/**
 * SHA-256 of a device token (hex). What buero.json stores instead of the token.
 * @param {string} token
 * @returns {string}
 */
export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Clean a device name: trimmed, control characters removed, at most NAME_MAX characters.
 * @param {unknown} name
 * @returns {string} '' when nothing usable is left
 */
export function bereinigeName(name) {
  // eslint-disable-next-line no-control-regex
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/**
 * A paired device as stored in buero.json.
 * @typedef {{id: string, name: string, hash: string, erstellt: string, laeuftAb: string, zuletzt: string|null}} Geraet
 *   erstellt / laeuftAb / zuletzt = ISO timestamps
 */

/**
 * A device as the API shows it — never with the hash.
 * @typedef {{id: string, name: string, erstellt: string, laeuftAb: string, zuletzt: string|null}} GeraetOeffentlich
 */

/**
 * @param {Geraet} g
 * @returns {GeraetOeffentlich}
 */
function oeffentlich(g) {
  return { id: g.id, name: g.name, erstellt: g.erstellt, laeuftAb: g.laeuftAb, zuletzt: g.zuletzt };
}

/**
 * Read the state file. A missing file is the default (off, no devices); a broken file is reported on the
 * console and treated the same — the safe direction, office mode stays off.
 * @param {string} datei absolute path of buero.json
 * @returns {{aktiv: boolean, geraete: Geraet[]}}
 */
function lesen(datei) {
  try {
    const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
    const geraete = Array.isArray(roh?.geraete)
      ? roh.geraete.filter((g) => g && typeof g.id === 'string' && /^[0-9a-f]{64}$/.test(String(g.hash)))
      : [];
    return { aktiv: roh?.aktiv === true, geraete };
  } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[buero] ${datei} not readable, office mode stays off: ${/** @type {any} */ (e).message}`);
    return { aktiv: false, geraete: [] };
  }
}

/**
 * The office-mode state of this installation.
 * @param {{datei: string, jetzt?: () => number, zufallsCode?: () => string, zufallsToken?: () => string}} o
 *   datei = absolute path of buero.json; jetzt = clock in ms; zufallsCode = 6-digit code; zufallsToken = token
 */
export function createBuero({
  datei,
  jetzt = () => Date.now(),
  zufallsCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
  zufallsToken = () => crypto.randomBytes(32).toString('base64url'),
}) {
  const zustand = lesen(datei);
  /** @type {Map<string, number>} device id → ms when zuletzt was last written to disk */
  const zuletztGeschrieben = new Map();
  /** @type {{code: string, name: string, laeuftAb: number, fehlversuche: number}|null} */
  let offenerCode = null;
  /** @type {Map<string, {start: number, anzahl: number}>} source address → attempts in the current window */
  const versuche = new Map();

  function speichern() {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    const tmp = `${datei}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ aktiv: zustand.aktiv, geraete: zustand.geraete }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, datei);
  }

  /** Drop expired devices; true when something was dropped. */
  function aufraeumen() {
    const vorher = zustand.geraete.length;
    const n = jetzt();
    zustand.geraete = zustand.geraete.filter((g) => Date.parse(g.laeuftAb) > n);
    return zustand.geraete.length !== vorher;
  }
  if (aufraeumen()) { try { speichern(); } catch { /* read-only folder: the filter still applies in memory */ } }

  return {
    /** @returns {boolean} whether office mode is on */
    istAktiv: () => zustand.aktiv,

    /**
     * Switch office mode on or off and persist it. Switching off also drops an open pairing code;
     * paired devices are kept (switching on again does not need a new pairing).
     * @param {boolean} an
     */
    setzeAktiv(an) {
      zustand.aktiv = Boolean(an);
      if (!zustand.aktiv) offenerCode = null;
      speichern();
    },

    /**
     * Create a pairing code for a device name chosen on this computer (replaces an open code).
     * @param {unknown} name e.g. "Tablet Baustelle"
     * @returns {{code: string, name: string, laeuftAb: string}} laeuftAb = ISO timestamp
     * @throws {Error} plain text when office mode is off or the name is empty
     */
    codeErzeugen(name) {
      if (!zustand.aktiv) throw new Error('Büro-Modus ist aus — erst einschalten.');
      const sauber = bereinigeName(name);
      if (!sauber) throw new Error('Bitte einen Gerätenamen angeben (z. B. „Tablet Baustelle“).');
      offenerCode = { code: zufallsCode(), name: sauber, laeuftAb: jetzt() + CODE_GUELTIG_MS, fehlversuche: 0 };
      return { code: offenerCode.code, name: sauber, laeuftAb: new Date(offenerCode.laeuftAb).toISOString() };
    },

    /** @returns {{name: string, laeuftAb: string}|null} the open code's facts, without the code */
    offenerCode() {
      if (!offenerCode || offenerCode.laeuftAb <= jetzt()) return null;
      return { name: offenerCode.name, laeuftAb: new Date(offenerCode.laeuftAb).toISOString() };
    },

    /**
     * Exchange a pairing code for a device token. Counts against the rate limit of the source address.
     * @param {unknown} code what the device sent
     * @param {string} quelle normalised source address (rate-limit key)
     * @returns {{ok: true, token: string, geraet: GeraetOeffentlich}
     *   | {ok: false, status: number, fehler: string, warteSekunden?: number}}
     */
    koppeln(code, quelle) {
      const n = jetzt();
      if (!zustand.aktiv) return { ok: false, status: 403, fehler: 'Büro-Modus ist aus.' };
      const v = versuche.get(quelle);
      const fenster = v && n - v.start < DROSSEL_FENSTER_MS ? v : { start: n, anzahl: 0 };
      if (fenster.anzahl >= DROSSEL_MAX_VERSUCHE) {
        return { ok: false, status: 429, fehler: 'Zu viele Versuche. Bitte später erneut versuchen.', warteSekunden: Math.ceil((fenster.start + DROSSEL_FENSTER_MS - n) / 1000) };
      }
      fenster.anzahl += 1;
      versuche.set(quelle, fenster);
      // Bound the map: old windows are of no use any more.
      if (versuche.size > 1000) for (const [k, w] of versuche) if (n - w.start >= DROSSEL_FENSTER_MS) versuche.delete(k);

      const eingabe = String(code ?? '').replace(/\s+/g, '');
      if (!offenerCode || offenerCode.laeuftAb <= n) return { ok: false, status: 401, fehler: 'Kein gültiger Koppel-Code offen. Bitte am Büro-Rechner einen neuen Code erzeugen.' };
      const a = Buffer.from(eingabe);
      const b = Buffer.from(offenerCode.code);
      const passt = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!passt) {
        offenerCode.fehlversuche += 1;
        if (offenerCode.fehlversuche >= CODE_MAX_FEHLVERSUCHE) offenerCode = null;
        return { ok: false, status: 401, fehler: 'Code falsch oder abgelaufen.' };
      }
      const token = zufallsToken();
      /** @type {Geraet} */
      const geraet = {
        id: crypto.randomUUID(), name: offenerCode.name, hash: tokenHash(token),
        erstellt: new Date(n).toISOString(), laeuftAb: new Date(n + TOKEN_GUELTIG_MS).toISOString(), zuletzt: new Date(n).toISOString(),
      };
      offenerCode = null;
      zustand.geraete.push(geraet);
      speichern();
      return { ok: true, token, geraet: oeffentlich(geraet) };
    },

    /**
     * The device a token belongs to, or null (unknown, revoked or expired). Refreshes "last seen".
     * @param {string|null|undefined} token
     * @returns {GeraetOeffentlich|null}
     */
    geraetFuerToken(token) {
      if (!token) return null;
      const h = tokenHash(token);
      const n = jetzt();
      const g = zustand.geraete.find((x) => x.hash === h);
      if (!g || Date.parse(g.laeuftAb) <= n) return null;
      g.zuletzt = new Date(n).toISOString();
      if (n - (zuletztGeschrieben.get(g.id) || 0) >= ZULETZT_SCHREIBEN_MS) {
        zuletztGeschrieben.set(g.id, n);
        try { speichern(); } catch (e) { console.error(`[buero] last-seen not written: ${/** @type {any} */ (e).message}`); }
      }
      return oeffentlich(g);
    },

    /** @returns {GeraetOeffentlich[]} paired, not yet expired devices, newest first */
    geraete() {
      if (aufraeumen()) speichern();
      return zustand.geraete.map(oeffentlich).sort((x, y) => y.erstellt.localeCompare(x.erstellt));
    },

    /**
     * Revoke a device (its token stops working at once).
     * @param {string} id
     * @returns {boolean} false when no such device
     */
    widerrufen(id) {
      const vorher = zustand.geraete.length;
      zustand.geraete = zustand.geraete.filter((g) => g.id !== id);
      if (zustand.geraete.length === vorher) return false;
      speichern();
      return true;
    },
  };
}

/** @typedef {ReturnType<typeof createBuero>} Buero */
