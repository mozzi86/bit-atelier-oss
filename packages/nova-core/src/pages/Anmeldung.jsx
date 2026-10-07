import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DATENQUELLE } from '@core/lib/umgebung';
import { useI18n } from '@core/lib/i18n';

// Anmeldeseite (Phase 57-02, Task 4) — Route /anmeldung in App.jsx, bewusst
// OUTSIDE des Auth-Gates.
//
// A11y (Audit 18.09.2026): label mit htmlFor, Fokus im ersten Feld,
// Fehlertext mit role="alert" und im Klartext (Projektregel: nie still
// verwerfen, nie technisch werden).
//
// Seit 83-02: Registrierung mit Wartezeit — Link „Noch kein Konto?
// Registrieren" auf /registrieren (Anfrage per E-Mail, Freischaltung von Hand).

/**
 * Shared form styling — deliberately duplicated in PasswortZuruecksetzen.jsx
 * (two constants, both pages stay self-contained; no new shared module was in
 * the 57-02 file plan).
 * @param {string} [extra] additional classes
 * @returns {string} class list
 */
const feldKlasse = (extra = '') =>
  `w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60 ${extra}`;

const knopfKlasse =
  'w-full rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Returns the Supabase client — ONLY behind a DATENQUELLE === 'supabase'
 * guard (review correction #5: the condition must sit in front of EVERY
 * dynamic import, exactly like bitApi's DEMO branch). Rollup folds the
 * constant, so in demo/lokal builds this function is a plain throw and the
 * dynamic import — and with it all of supabase-js — tree-shakes out.
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient>}
 * @throws {Error} plain text when this page runs outside the cloud build
 */
async function holeClient() {
  if (DATENQUELLE !== 'supabase') {
    throw new Error('Anmeldung ist nur im Cloud-Betrieb verfügbar (VITE_SUPABASE_URL fehlt).');
  }
  const { supabaseClient } = await import('@core/api/supabaseClient.js');
  return supabaseClient();
}

/**
 * Login page: email + password via supabase.auth.signInWithPassword.
 * On success AuthContext's onAuthStateChange listener flips isAuthenticated
 * and App.jsx renders the protected app — no navigation here.
 */
export function Anmeldung() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  // Guard: this page only works on the supabase path. Reaching it on express
  // or serverlos is a routing mistake — say so instead of failing silently.
  const [fehlkonfiguriert] = useState(() => DATENQUELLE !== 'supabase');

  /** @param {React.FormEvent} e */
  const anmelden = async (e) => {
    e.preventDefault();
    setFehler('');
    setBusy(true);
    try {
      // Supabase client via the guarded local helper — the DATENQUELLE check
      // in front of the dynamic import is what keeps supabase-js out of the
      // demo/lokal bundles (review correction #5).
      const client = await holeClient();
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password: passwort,
      });
      if (error) {
        // Plain-text German for the common cases, technical message as the
        // fallback — users must understand why nothing happened.
        if (/Invalid login credentials/i.test(error.message)) {
          setFehler('E-Mail oder Passwort ist falsch.');
        } else if (/Email not confirmed/i.test(error.message)) {
          setFehler('Die E-Mail-Adresse ist noch nicht bestätigt — bitte den Bestätigungslink aus der Eingangs-E-Mail öffnen.');
        } else {
          setFehler(`Anmeldung fehlgeschlagen: ${error.message}`);
        }
      }
      // Success: onAuthStateChange takes over — no state to set here.
    } catch (err) {
      setFehler(`Anmeldung fehlgeschlagen: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-slate-50 via-green-50/30 to-blue-50/20 p-4">
      <main className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl" aria-labelledby="anmeldung-titel">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-lg font-bold text-white shadow" aria-hidden="true">
            BA
          </div>
          <div>
            <h1 id="anmeldung-titel" className="text-lg font-bold text-slate-800">BIT-Atelier</h1>
            <p className="text-xs text-slate-500">Anmeldung</p>
          </div>
        </div>

        {/* Outside the cloud build there is nothing to sign in to (72-16, N-18):
            the note carries the way into the app, so this page is no dead end. */}
        {fehlkonfiguriert && (
          <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            Diese Seite funktioniert nur im Cloud-Betrieb (VITE_SUPABASE_URL fehlt in diesem Build).{' '}
            <Link to="/" className="font-medium underline hover:text-rose-950">
              {t('Zur App')}
            </Link>
          </div>
        )}

        <form onSubmit={anmelden} className="space-y-4" noValidate>
          <div>
            <label htmlFor="anmeldung-email" className="mb-1 block text-xs font-medium text-slate-600">
              E-Mail
            </label>
            <input
              id="anmeldung-email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={feldKlasse()}
              disabled={fehlkonfiguriert || busy}
            />
          </div>
          <div>
            <label htmlFor="anmeldung-passwort" className="mb-1 block text-xs font-medium text-slate-600">
              Passwort
            </label>
            <input
              id="anmeldung-passwort"
              type="password"
              autoComplete="current-password"
              required
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              className={feldKlasse()}
              disabled={fehlkonfiguriert || busy}
            />
          </div>

          {fehler && (
            <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {fehler}
            </p>
          )}

          <button type="submit" className={knopfKlasse} disabled={fehlkonfiguriert || busy}>
            {busy ? 'Anmeldung läuft …' : 'Anmelden'}
          </button>

          <p className="text-center text-xs text-slate-500">
            <a
              href="/passwort-zuruecksetzen"
              className="font-medium text-emerald-700 underline hover:text-emerald-900"
            >
              Passwort vergessen?
            </a>
          </p>
          {/* 83-02: open registration with manual approval — /registrieren
              prepares a request mail, the operator approves it by hand
              (scripts/zugang-freischalten.mjs). <Link>, see the footer note. */}
          <p className="text-center text-xs text-slate-500" data-testid="anmeldung-registrieren">
            {t('Noch kein Konto?')}{' '}
            <Link to="/registrieren" className="font-medium text-emerald-700 underline hover:text-emerald-900">
              {t('Registrieren')}
            </Link>
          </p>
        </form>

        {/* Mandatory notices on the one page every visitor can reach without a
            session (57-06 Task 1g). <Link>, not the <a href> pattern above:
            that one is a full reload and breaks in the HashRouter builds. */}
        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-[11px] text-slate-400">
          <Link to="/impressum" className="underline hover:text-slate-600">
            Impressum
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/datenschutz" className="underline hover:text-slate-600">
            Datenschutz
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/nutzungsbedingungen" className="underline hover:text-slate-600">
            Nutzungsbedingungen
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/cookies" className="underline hover:text-slate-600">
            Cookies
          </Link>
        </p>
      </main>
    </div>
  );
}

export default Anmeldung;
