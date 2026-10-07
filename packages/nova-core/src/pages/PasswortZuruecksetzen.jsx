import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DATENQUELLE } from '@core/lib/umgebung';

// Reset-Seite (Phase 57-02, Task 4) — Route /passwort-zuruecksetzen in
// App.jsx, bewusst OUTSIDE des Auth-Gates: die Recovery-Session entsteht erst
// beim Laden dieser Seite aus dem Mail-Link (review correction #1), ein Gate
// davor würde sie nie sehen. Der Mail-Link ist `${origin}/passwort-zuruecksetzen`
// OHNE Raute — im Cloud-Build läuft BrowserRouter.
//
// A11y (Audit 18.09.2026): label mit htmlFor, Fokus im ersten Feld,
// Fehlertext mit role="alert" und im Klartext.

/**
 * Shared form styling — same constants as Anmeldung.jsx (kept local, see the
 * note there).
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
    throw new Error('Passwort-Zurücksetzen ist nur im Cloud-Betrieb verfügbar (VITE_SUPABASE_URL fehlt).');
  }
  const { supabaseClient } = await import('@core/api/supabaseClient.js');
  return supabaseClient();
}

/**
 * Two roles in one route, deliberately:
 *  1. REQUEST a reset mail (no recovery token yet) — the "Passwort vergessen"
 *     link target and the mail's redirectTo both point here.
 *  2. SET a new password when a recovery session exists (Supabase puts the
 *     token in the URL, detectSessionInUrl exchanges it on page load and
 *     fires PASSWORD_RECOVERY through onAuthStateChange).
 * After a successful update: back to the dashboard (session is a normal one).
 */
export function PasswortZuruecksetzen() {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [wiederholen, setWiederholen] = useState('');
  const [fehler, setFehler] = useState('');
  const [hinweis, setHinweis] = useState('');
  const [busy, setBusy] = useState(false);
  const [hatRecovery, setHatRecovery] = useState(false);
  const [bereit, setBereit] = useState(false);
  // Guard like on the login page: reaching this route outside the cloud build
  // is a routing/config mistake — plain-text note instead of silent failure.
  const [fehlkonfiguriert] = useState(() => DATENQUELLE !== 'supabase');

  /**
   * Watches for the recovery session. supabase-js handles the URL-token
   * exchange itself (detectSessionInUrl default) and fires PASSWORD_RECOVERY;
   * a reload that already has ?type=recovery in the URL is caught via getUser.
   */
  useEffect(() => {
    if (DATENQUELLE !== 'supabase') {
      setBereit(true);
      return undefined;
    }
    let subscription = null;
    let verworfen = false;
    (async () => {
      const client = await holeClient();
      if (verworfen) return;
      subscription = client.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') setHatRecovery(true);
      }).data.subscription;
      const { data } = await client.auth.getUser();
      // 83-02: an invitation (scripts/zugang-freischalten.mjs with BIT_APP_URL)
      // lands here with ?type=einladung and a fresh session (Supabase signals
      // SIGNED_IN, not PASSWORD_RECOVERY) — the new person sets a password the
      // same way a reset does.
      const typ = new URLSearchParams(window.location.search).get('type');
      if (!verworfen && data?.user && (typ === 'recovery' || typ === 'einladung')) {
        setHatRecovery(true);
      }
      if (!verworfen) setBereit(true);
    })().catch((err) => {
      if (verworfen) return;
      console.error('Supabase recovery-init failed:', err);
      setFehler(`Passwort-Zurücksetzen konnte nicht vorbereitet werden: ${err?.message || err}`);
      setBereit(true);
    });
    return () => {
      verworfen = true;
      subscription?.unsubscribe();
    };
  }, []);

  /** Sends the reset mail. redirectTo WITHOUT hash — BrowserRouter (review #1). */
  const mailAnfordern = async (e) => {
    e.preventDefault();
    setFehler(''); setHinweis(''); setBusy(true);
    try {
      const client = await holeClient();
      const redirectTo = `${window.location.origin}/passwort-zuruecksetzen`;
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) {
        setFehler(`Reset-Mail konnte nicht versendet werden: ${error.message}`);
      } else {
        // No "does this address exist" reveal — same wording for known and
        // unknown addresses (Supabase answers success either way).
        setHinweis('Wenn die Adresse bekannt ist, ist eine Reset-Mail unterwegs. Bitte den Link darin öffnen.');
      }
    } catch (err) {
      setFehler(`Reset-Mail konnte nicht versendet werden: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  /** Sets the new password on the recovery session, then back to the app. */
  const passwortSetzen = async (e) => {
    e.preventDefault();
    setFehler('');
    // 8 characters: Supabase default minimum — the server enforces it too,
    // the client-side check only spares a round trip.
    if (passwort.length < 8) {
      setFehler('Das Passwort braucht mindestens 8 Zeichen.');
      return;
    }
    if (passwort !== wiederholen) {
      setFehler('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      const client = await holeClient();
      const { error } = await client.auth.updateUser({ password: passwort });
      if (error) {
        setFehler(`Passwort konnte nicht gesetzt werden: ${error.message}`);
        setBusy(false);
        return;
      }
      // Success: the recovery session became a normal session — into the app.
      // Hard navigation (not router navigate) so AuthContext re-inits cleanly.
      window.location.assign('/');
    } catch (err) {
      setFehler(`Passwort konnte nicht gesetzt werden: ${err?.message || err}`);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-slate-50 via-green-50/30 to-blue-50/20 p-4">
      <main className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl" aria-labelledby="reset-titel">
        <h1 id="reset-titel" className="mb-1 text-lg font-bold text-slate-800">
          {hatRecovery ? 'Neues Passwort setzen' : 'Passwort zurücksetzen'}
        </h1>
        <p className="mb-5 text-xs text-slate-500">
          {hatRecovery
            ? 'Das neue Passwort gilt ab sofort für diese Anmeldung.'
            : 'Wir senden einen Link, mit dem Sie ein neues Passwort vergeben können.'}
        </p>

        {fehlkonfiguriert && (
          <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            Diese Seite funktioniert nur im Cloud-Betrieb (VITE_SUPABASE_URL fehlt in diesem Build).
          </div>
        )}

        {bereit && !hatRecovery && (
          <form onSubmit={mailAnfordern} className="space-y-4" noValidate>
            <div>
              <label htmlFor="reset-email" className="mb-1 block text-xs font-medium text-slate-600">E-Mail</label>
              <input
                id="reset-email"
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
            {fehler && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{fehler}</p>}
            {hinweis && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{hinweis}</p>}
            <button type="submit" className={knopfKlasse} disabled={fehlkonfiguriert || busy}>
              {busy ? 'Wird gesendet …' : 'Reset-Link senden'}
            </button>
          </form>
        )}

        {bereit && hatRecovery && (
          <form onSubmit={passwortSetzen} className="space-y-4" noValidate>
            <div>
              <label htmlFor="reset-passwort" className="mb-1 block text-xs font-medium text-slate-600">Neues Passwort</label>
              <input
                id="reset-passwort"
                type="password"
                autoComplete="new-password"
                autoFocus
                required
                minLength={8}
                value={passwort}
                onChange={(e) => setPasswort(e.target.value)}
                className={feldKlasse()}
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor="reset-passwort-2" className="mb-1 block text-xs font-medium text-slate-600">Passwort wiederholen</label>
              <input
                id="reset-passwort-2"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={wiederholen}
                onChange={(e) => setWiederholen(e.target.value)}
                className={feldKlasse()}
                disabled={busy}
              />
            </div>
            {fehler && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{fehler}</p>}
            <button type="submit" className={knopfKlasse} disabled={busy}>
              {busy ? 'Wird gesetzt …' : 'Passwort setzen und anmelden'}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs">
          <a href="/anmeldung" className="font-medium text-emerald-700 underline hover:text-emerald-900">
            Zurück zur Anmeldung
          </a>
        </p>

        {/* Mandatory notices, same as on the login page (57-06 Task 1g). */}
        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-[11px] text-slate-400">
          <Link to="/impressum" className="underline hover:text-slate-600">
            Impressum
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/datenschutz" className="underline hover:text-slate-600">
            Datenschutz
          </Link>
        </p>
      </main>
    </div>
  );
}

export default PasswortZuruecksetzen;
