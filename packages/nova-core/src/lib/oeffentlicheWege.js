// Routes that render without a session (57-06 Task 1d, 83-02).
//
// The cloud build sends every visitor without a session to /anmeldung
// (src/App.jsx, Supabase gate). A page is public only if its path is in this
// list AND it has a <Route> in the public branch of App.jsx - a route alone
// would be redirected to the login, which is how an imprint ends up behind a
// login. One list, read by App.jsx and by tests/unit/rechtstexte.test.js, so
// the two cannot drift apart.
//
// In:  a pathname. Out: whether it is public. Pure, no router, no environment.

/**
 * Paths that render outside the auth gate, in every build mode: login,
 * registration request, password reset and the six legal pages
 * (93-02: + accessibility statement).
 * @type {ReadonlyArray<string>}
 */
export const OEFFENTLICHE_WEGE = Object.freeze([
  '/anmeldung',
  '/registrieren',
  '/passwort-zuruecksetzen',
  '/impressum',
  '/datenschutz',
  '/nutzungsbedingungen',
  '/rueckerstattung',
  '/cookies',
  '/barrierefreiheit',
]);

/**
 * The legal pages among them - required to be reachable without login
 * (§ 5 DDG, Art. 13 DSGVO) [ASSUMED legal reading, see rechtstexte.jsx].
 * @type {ReadonlyArray<string>}
 */
export const RECHTSSEITEN = Object.freeze([
  '/impressum',
  '/datenschutz',
  '/nutzungsbedingungen',
  '/rueckerstattung',
  '/cookies',
  '/barrierefreiheit',
]);

/**
 * Whether a pathname renders without a session. Exact match: /impressum/x or
 * /Impressum are not public (the router matches case-insensitively, the gate
 * does not - a deliberate fail-shut).
 * @param {string} pfad location.pathname
 * @returns {boolean}
 */
export function istOeffentlicherWeg(pfad) {
  return OEFFENTLICHE_WEGE.includes(String(pfad || ''));
}
