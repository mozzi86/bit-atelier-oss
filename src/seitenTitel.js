// Browser tab title per route (72-10, N-06).
//
// Why: every tab was called "BIT-Atelier — Integrated Project Platform", so
// five open modules were five identical tabs, and after a route change a
// screen reader had no page name to announce. The menu titles in
// src/navigation.js are the binding name table (menu = h1), so the tab title
// reuses them; the legal and sign-in routes render outside the menu and get
// their own small table here.
//
// In:  a router pathname and the flat menu list (navFlach).
// Out: the German source title of the page (the caller translates it with
//      t()) or null, and the formatted document title.
//
// No React, no DOM, no imports: unit-testable under node --test.

/** Product name — the whole tab title when a route has no title of its own. */
export const PRODUKTNAME = "BIT-Atelier";

/**
 * Titles of the routes outside the menu (App.jsx RECHTSWEGE): legal pages,
 * sign-in and password reset. German source strings like the menu titles.
 * They have no English dictionary entry on purpose: these pages exist in
 * German only, and their footer links read German in both languages, so the
 * tab says what the page says.
 * @type {Readonly<Record<string, string>>}
 */
export const RECHTSWEG_TITEL = Object.freeze({
  "/impressum": "Impressum",
  "/datenschutz": "Datenschutz",
  "/nutzungsbedingungen": "Nutzungsbedingungen",
  "/rueckerstattung": "Rückerstattung",
  "/cookies": "Cookies",
  "/anmeldung": "Anmeldung",
  "/registrieren": "Registrieren",
  "/passwort-zuruecksetzen": "Passwort zurücksetzen",
});

/**
 * Canonical form of a router pathname for comparisons: no trailing slash,
 * lower case (react-router matches routes case-insensitively), and "/" read
 * as "/Dashboard" (App.jsx redirects the index route there). Same rule as
 * normiere() in src/huellenZustand.js, which does not export it.
 * @param {string|null|undefined} pathname router pathname, e.g. "/AVA"
 * @returns {string}
 */
function normiere(pathname) {
  let p = typeof pathname === "string" && pathname ? pathname : "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "/") p = "/Dashboard";
  return p.toLowerCase();
}

/**
 * German source title of the page at `pathname`: the menu title of the
 * matching navFlach entry, else the legal/sign-in title, else null (unknown
 * route, e.g. the 404 page).
 * @param {string|null|undefined} pathname router pathname without query, e.g. "/AVA"
 * @param {Array<{url: string, title: string}>} [eintraege] navFlach from src/navigation.js
 * @returns {string|null} untranslated title, or null when the route has none
 */
export function seitenTitelFuer(pathname, eintraege) {
  const ziel = normiere(pathname);
  const eintrag = (Array.isArray(eintraege) ? eintraege : []).find((e) => normiere(e?.url) === ziel);
  if (eintrag?.title) return eintrag.title;
  const rechtsweg = Object.keys(RECHTSWEG_TITEL).find((p) => p === ziel);
  return rechtsweg ? RECHTSWEG_TITEL[rechtsweg] : null;
}

/**
 * Document title for a (translated) page title: "{titel} · BIT-Atelier", or
 * just "BIT-Atelier" when there is no title.
 * @param {string|null|undefined} titel page title, already translated
 * @returns {string} value for document.title
 */
export function dokumentTitel(titel) {
  const t = typeof titel === "string" ? titel.trim() : "";
  return t ? `${t} · ${PRODUKTNAME}` : PRODUKTNAME;
}
