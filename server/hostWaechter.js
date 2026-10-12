// DNS-rebinding guard for the local server. A foreign web page can point its own domain name at
// 127.0.0.1 and then read the loopback API from the browser — the request is "same origin" for the
// browser, so CORS does not help. What always gives it away is the Host header: it carries the
// attacker's domain name. This guard runs before every route (API and app files) and admits only
// hosts that cannot belong to a foreign site: `localhost`, `*.localhost`, IP literals (loopback and
// the LAN addresses of the office mode, 93-03) and names listed in BIT_ERLAUBTE_HOSTS.
//
// In:  request Host header; env BIT_ERLAUBTE_HOSTS (comma-separated host names, e.g. a name the
//      office gives the host computer). Out: next() or 421 with a plain-text reason.
import net from 'node:net';

/**
 * Host name without port (handles "[::1]:3001", "example:80", "LOCALHOST").
 * @param {string|undefined} host Host header value
 * @returns {string} lower-case host name, "" when missing
 */
export function hostName(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined);
  const teile = h.split(':');
  return teile.length > 2 ? h : teile[0]; // bare IPv6 without brackets stays whole
}

/**
 * Whether a Host header may reach the local server.
 * @param {string|undefined} host Host header value
 * @param {string[]} [extra] additionally allowed host names
 * @returns {boolean}
 */
export function hostErlaubt(host, extra = []) {
  const name = hostName(host);
  if (!name) return false;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (net.isIP(name)) return true;
  return extra.map((x) => x.trim().toLowerCase()).filter(Boolean).includes(name);
}

/**
 * Express middleware (mount first).
 * @param {{extra?: string[]}} [o] allowed host names (default: BIT_ERLAUBTE_HOSTS)
 * @returns {import('express').RequestHandler}
 */
export function hostWaechter({ extra = String(process.env.BIT_ERLAUBTE_HOSTS || '').split(',') } = {}) {
  return (req, res, next) => {
    if (hostErlaubt(req.headers.host, extra)) return next();
    res.status(421).type('text/plain; charset=utf-8')
      .send('BIT-Atelier antwortet nur unter localhost oder einer IP-Adresse. Ein anderer Name im Host-Header deutet auf DNS-Rebinding hin — die Anfrage wurde abgewiesen. Eigene Namen: BIT_ERLAUBTE_HOSTS.');
  };
}
