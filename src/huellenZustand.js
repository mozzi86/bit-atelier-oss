// What the app shell shows in <main> — decided in one pure place (72-10, N-05).
//
// Why this exists: Layout.jsx used to know two states only, "projects exist"
// and "no project yet". A failed data store therefore read as "Noch kein Projekt
// vorhanden" (the error only reached the console), and without a project the
// shell hid every route except /Projects — also modules that work on a file the
// user opens (check suite, IFC viewer), so a fresh local client had no way to a
// first success. The decision now lives here, testable under node --test.
//
// In:  the ProjectContext state (loading, fehler, number of projects), the
//      current router pathname and the navigation entries (navFlach).
// Out: 'laden' | 'fehler' | 'leer' | 'inhalt', plus two small helpers the
//      shell needs next to it (portfolio scope, office name for the footer).
//
// No React, no browser APIs, no imports: it only decides.

/**
 * Routes that always render their page, whatever the project state: the
 * project list itself — otherwise nobody could ever create the first project.
 * @type {readonly string[]}
 */
export const IMMER_ERREICHBAR = Object.freeze(['/Projects']);

/**
 * Route aliases of App.jsx: "/" renders the same page as "/Dashboard".
 * @type {Readonly<Record<string, string>>}
 */
const ROUTEN_ALIAS = Object.freeze({ '/': '/Dashboard' });

/**
 * Canonical form of a router pathname for comparisons: without a trailing
 * slash, lower case (react-router matches routes case-insensitively, so a
 * hand-typed /modelcheck renders the check suite as well), aliases resolved.
 * @param {string|null|undefined} pathname router pathname, e.g. "/ModelCheck"
 * @returns {string}
 */
function normiere(pathname) {
  let p = typeof pathname === 'string' && pathname ? pathname : '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  p = ROUTEN_ALIAS[p] || p;
  return p.toLowerCase();
}

/**
 * The navigation entry of a route, if the route is in the menu.
 * @param {string|null|undefined} pathname router pathname
 * @param {Array<{url: string, projektfrei?: boolean, umfang?: string}>} [eintraege] navFlach
 * @returns {{url: string, projektfrei?: boolean, umfang?: string}|undefined}
 */
function eintragFuer(pathname, eintraege) {
  const ziel = normiere(pathname);
  return (Array.isArray(eintraege) ? eintraege : []).find((e) => normiere(e?.url) === ziel);
}

/**
 * True when the route renders without an active project: /Projects and every
 * navigation entry flagged `projektfrei` (src/navigation.js).
 * @param {string|null|undefined} pathname router pathname
 * @param {Array<{url: string, projektfrei?: boolean}>} [eintraege] navFlach
 * @returns {boolean}
 */
export function istProjektfreieRoute(pathname, eintraege) {
  const ziel = normiere(pathname);
  if (IMMER_ERREICHBAR.some((p) => p.toLowerCase() === ziel)) return true;
  return eintragFuer(pathname, eintraege)?.projektfrei === true;
}

/**
 * True when the route spans all projects instead of the active one
 * (`umfang: 'portfolio'` in src/navigation.js); "/" counts as "/Dashboard".
 * @param {string|null|undefined} pathname router pathname
 * @param {Array<{url: string, umfang?: string}>} [eintraege] navFlach
 * @returns {boolean}
 */
export function istPortfolioRoute(pathname, eintraege) {
  return eintragFuer(pathname, eintraege)?.umfang === 'portfolio';
}

/**
 * What <main> shows. Order of the rules:
 *   1. /Projects and project-free modules → 'inhalt' (they never need a project,
 *      so neither a failed store nor an empty list may hide them);
 *   2. a load error → 'fehler' (before 'laden': an error is never hidden);
 *   3. still loading → 'laden';
 *   4. no project → 'leer';
 *   5. otherwise → 'inhalt'.
 *
 * @param {{
 *   loading?: boolean,
 *   fehler?: string|null,
 *   projektAnzahl?: number,
 *   pathname?: string,
 *   eintraege?: Array<{url: string, projektfrei?: boolean}>,
 * }} eingabe loading/fehler from useProject(); projektAnzahl = projects.length
 *   (count); pathname = router pathname; eintraege = navFlach
 * @returns {'laden'|'fehler'|'leer'|'inhalt'}
 */
export function huellenZustand({ loading = false, fehler = null, projektAnzahl = 0, pathname = '/', eintraege = [] } = {}) {
  if (istProjektfreieRoute(pathname, eintraege)) return 'inhalt';
  if (fehler) return 'fehler';
  if (loading) return 'laden';
  if (!(projektAnzahl > 0)) return 'leer';
  return 'inhalt';
}

/**
 * Name shown in the sidebar footer when no office name is stored.
 * @type {{name: string, initialen: string}}
 */
export const BUERO_RUECKFALL = Object.freeze({ name: 'BIT-Atelier', initialen: 'BA' });

/**
 * Footer display of the office name (setting "briefkopf", field office):
 * the trimmed name and up to two initials — first character of the first two
 * words that start with a letter or digit ("Büro Test" → "BT", "Müller &
 * Partner" → "MP", "Planwerk" → "P", "3D Studio" → "3S"). Hyphens separate
 * words like spaces, so the fallback "BIT-Atelier" yields its own "BA". Only
 * an empty name falls back; a stored name is always shown as it is.
 * @param {string|null|undefined} office stored office name
 * @returns {{name: string, initialen: string}}
 */
export function bueroAnzeige(office) {
  const name = typeof office === 'string' ? office.trim() : '';
  if (!name) return { ...BUERO_RUECKFALL };
  const woerter = name.split(/[\s\-–—]+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const initialen = woerter
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase('de-DE'))
    .join('');
  // A name made of symbols only ("&") has no initials; show its first character.
  return { name, initialen: initialen || name[0] };
}
