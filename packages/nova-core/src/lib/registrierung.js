// Access request ("Registrieren") for the cloud build (Plan 83-02).
//
// Registration is open, approval is manual: the page does not create an
// account. It prepares an e-mail to ANBIETER.anfrageEmail that the visitor
// sends from their own mail program; the operator then creates the account
// with scripts/zugang-freischalten.mjs (invitation mail from Supabase). No
// form endpoint, no server, no database write from the browser — RLS stays
// exactly as it is (supabase/migrations/0002_rls.sql: clients create no orgs
// and no memberships).
//
// In:  the form values. Out: validation result and the mailto URL. Pure.

/**
 * The roles a visitor can choose. `wert` travels in the mail, `label` is the
 * German source text shown through t().
 * @type {ReadonlyArray<Readonly<{wert: string, label: string}>>}
 */
export const REGISTRIERUNG_ROLLEN = Object.freeze([
  Object.freeze({ wert: 'architektur', label: 'Architektur' }),
  Object.freeze({ wert: 'fachplanung', label: 'Fachplanung' }),
  Object.freeze({ wert: 'bauherr', label: 'Bauherr' }),
  Object.freeze({ wert: 'sonstiges', label: 'Sonstiges' }),
]);

/**
 * Form values of the access request.
 * @typedef {object} RegistrierungsAngaben
 * @property {string} name        full name (required)
 * @property {string} buero       office / company (required)
 * @property {string} email       mail address the invitation goes to (required)
 * @property {string} [telefon]   phone (optional)
 * @property {string} rolle       one of REGISTRIERUNG_ROLLEN[].wert (required)
 * @property {string} [nachricht] free text (optional)
 */

// Deliberately loose: the browser's type=email check runs as well, and the
// operator reads every request before anything is created.
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks the required fields.
 * @param {Partial<RegistrierungsAngaben>} angaben
 * @returns {string[]} German error texts (i18n keys), empty when the request can be prepared
 */
export function pruefeRegistrierung(angaben = {}) {
  const fehler = [];
  if (!String(angaben.name || '').trim()) fehler.push('Bitte Ihren Namen angeben.');
  if (!String(angaben.buero || '').trim()) fehler.push('Bitte Büro oder Firma angeben.');
  if (!EMAIL_MUSTER.test(String(angaben.email || '').trim())) fehler.push('Bitte eine gültige E-Mail-Adresse angeben.');
  if (!REGISTRIERUNG_ROLLEN.some((r) => r.wert === angaben.rolle)) fehler.push('Bitte eine Rolle wählen.');
  return fehler;
}

/**
 * The prepared request mail. Labels stay German: the mail goes to the operator.
 * @param {RegistrierungsAngaben} angaben validated form values
 * @param {string} empfaenger ANBIETER.anfrageEmail
 * @returns {string} mailto URL
 */
export function registrierungMailto(angaben, empfaenger) {
  const rolle = REGISTRIERUNG_ROLLEN.find((r) => r.wert === angaben.rolle)?.label || angaben.rolle || '—';
  const buero = String(angaben.buero || '').trim();
  const zeilen = [
    'Zugangsanfrage für BIT-Atelier (Cloud)',
    '',
    `Name: ${String(angaben.name || '').trim()}`,
    `Büro/Firma: ${buero}`,
    `E-Mail: ${String(angaben.email || '').trim()}`,
    `Telefon: ${String(angaben.telefon || '').trim() || '—'}`,
    `Rolle: ${rolle}`,
    '',
    'Nachricht:',
    String(angaben.nachricht || '').trim() || '—',
  ];
  // Same cap as the feedback mail (feedback.js MAX_MAILTO_TEXT): mail programs
  // cut long mailto URLs silently.
  const body = zeilen.join('\n').slice(0, 1500);
  const betreff = `BIT-Atelier Zugangsanfrage – ${buero}`;
  return `mailto:${empfaenger}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;
}
