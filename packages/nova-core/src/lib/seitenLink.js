/// <reference types="vite/client" />
// Router-safe absolute links to an app page (72-16, N-18).
//
// Why: a link that leaves the app is a dead end. The serverless builds (demo,
// lokal) run a HashRouter under a sub-path ("/demo/#/IfcViewer"), the Express and
// cloud builds a BrowserRouter at the base path ("/IfcViewer"). Code that glued
// "#/" in front of every route broke the second family, code that wrote a plain
// "/IfcViewer" broke the first. This module is the one place that knows both.
//
// Also here: the way back out of the legal pages (rechtsRueckweg), the second
// place that has to know which build runs to avoid a dead end.
//
// In:  a route ("IfcViewer" or "/IfcViewer", may carry its own "?a=b"), query
//      parameters (object, URLSearchParams or string) and the environment
//      (router family, origin, document path, current search, Vite base path).
//      The environment defaults to the running build and window.location and is
//      injectable, so the rule is testable under plain node.
// Out: an absolute URL string for copy buttons and shared links. In-app
//      navigation keeps using <Link to="/Route"> - the router adds the prefix.
//
// The active project travels along: ProjectContext reads ?projekt= from
// window.location.search (before the "#"), so a copied link opens the same
// project instead of the recipient's last one.
//
// node-safe like umgebung.js: `import.meta.env?.X` (optional chain) keeps the
// module importable where import.meta.env does not exist.

import { SERVERLOS } from '@core/lib/umgebung';

/** Query parameter of the active project (same name as URL_PARAM in ProjectContext.jsx). */
export const PROJEKT_PARAMETER = 'projekt';

/**
 * Target and label of the way back out of a legal page (RechtsSeite.jsx).
 * Cloud: the login - a visitor without a session is bounced from / to
 * /anmeldung anyway. Demo, client and Express have no login (/anmeldung only
 * says "cloud only" there), so the way back is the app itself.
 * @param {'serverlos'|'supabase'|'express'} datenquelle DATENQUELLE of the build
 * @returns {{ziel: string, text: string}} router path and German label (i18n key)
 */
export function rechtsRueckweg(datenquelle) {
  return datenquelle === 'supabase'
    ? { ziel: '/anmeldung', text: 'Zurück zur Anmeldung' }
    : { ziel: '/', text: 'Zurück zur App' };
}

/**
 * @typedef {object} SeitenUmgebung
 * @property {boolean} [serverlos] true = HashRouter build (demo/lokal), false = BrowserRouter
 * @property {string} [origin] e.g. "https://bit-atelier.de" (no trailing slash); '' = relative link
 * @property {string} [pathname] document path, e.g. "/demo/" - used by the HashRouter form only
 * @property {string} [search] current search incl. "?", source of ?projekt=
 * @property {string} [base] Vite base path, e.g. "/" or "/app/" - used by the BrowserRouter form only
 */

/**
 * The running build and the current window location, read at call time.
 * @returns {Required<SeitenUmgebung>}
 */
function standardUmgebung() {
  const ort = typeof globalThis !== 'undefined' ? globalThis.location : undefined;
  return {
    serverlos: SERVERLOS,
    origin: ort?.origin ?? '',
    pathname: ort?.pathname ?? '/',
    search: ort?.search ?? '',
    base: import.meta.env?.BASE_URL ?? '/',
  };
}

/**
 * Adds query values to a parameter set. Empty values (undefined, null, '') are
 * skipped, so optional state does not produce "?sel=" noise.
 * @param {URLSearchParams} ziel
 * @param {Record<string, unknown>|URLSearchParams|string|null|undefined} query
 */
function ergaenze(ziel, query) {
  if (!query) return;
  /** @param {unknown} v @param {string} k */
  const setze = (v, k) => {
    if (v === undefined || v === null || v === '') return;
    ziel.set(k, String(v));
  };
  // forEach, not entries(): jsconfig has no DOM.Iterable lib.
  if (typeof query === 'string' || query instanceof URLSearchParams) {
    new URLSearchParams(query).forEach(setze);
    return;
  }
  for (const [k, v] of Object.entries(query)) setze(v, k);
}

/**
 * Base path with exactly one leading and one trailing slash ("app" -> "/app/").
 * @param {string} base
 * @returns {string}
 */
function basisPfad(base) {
  const kern = String(base || '').replace(/^\/+|\/+$/g, '');
  return kern ? `/${kern}/` : '/';
}

/**
 * The absolute URL of an app page for the router of the running build.
 *
 * HashRouter (serverless): origin + pathname + [?projekt=…] + "#/" + route + [?query]
 * BrowserRouter (Express/cloud): origin + base + route + [?query incl. projekt]
 *
 * An explicit `projekt` in `query` wins over the one in `search`; in the hash
 * form it moves in front of the "#", where ProjectContext reads it.
 *
 * @param {string} route page route, e.g. "IfcViewer", "/IfcViewer" or "ComplexDesigner?tab=bim"
 * @param {Record<string, unknown>|URLSearchParams|string} [query] query parameters of the page
 * @param {SeitenUmgebung} [umgebung] overrides for the running build/location (tests, viewerLink)
 * @returns {string} absolute URL (relative when no origin is known)
 */
export function seitenUrl(route, query = {}, umgebung = {}) {
  const u = { ...standardUmgebung(), ...umgebung };
  const roh = String(route || '').replace(/^\/+/, '');
  const frage = roh.indexOf('?');
  const pfad = frage >= 0 ? roh.slice(0, frage) : roh;

  const params = new URLSearchParams(frage >= 0 ? roh.slice(frage + 1) : '');
  ergaenze(params, query);

  let projekt = params.get(PROJEKT_PARAMETER);
  if (!projekt) {
    try {
      projekt = new URLSearchParams(u.search || '').get(PROJEKT_PARAMETER);
    } catch {
      projekt = null;
    }
  }
  params.delete(PROJEKT_PARAMETER);

  if (u.serverlos) {
    const vorne = projekt ? `?${new URLSearchParams({ [PROJEKT_PARAMETER]: projekt })}` : '';
    const q = params.toString();
    return `${u.origin}${u.pathname || '/'}${vorne}#/${pfad}${q ? `?${q}` : ''}`;
  }

  if (projekt) params.set(PROJEKT_PARAMETER, projekt);
  const q = params.toString();
  return `${u.origin}${basisPfad(u.base)}${pfad}${q ? `?${q}` : ''}`;
}
