// Einladung — public page /einladung?code=… (Phase 110-06, migration 0017).
//
// The invitee got a link (WhatsApp, mail) and has no account yet. Here they
// register with an OWN e-mail + password (or sign in, if the address already
// has an account), or continue with Google; then the code is redeemed for
// the signed-in account (RPC einladungscode_einloesen): membership with the
// fixed rights of the role and access to exactly the code's project. After
// that the app reloads into the client portal.
//
// Rendered OUTSIDE the auth gate (oeffentlicheWege.js). Cloud build only —
// elsewhere a plain note. Google needs the provider set up in Supabase
// (Authentication → Sign In / Providers → Google); until then its button
// reports that in plain words. Plain-text errors, never swallowed.
//
// In:  ?code= from the URL. Out: the page. Side effects: sign-up/sign-in,
//      RPC, reload.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DATENQUELLE } from '@core/lib/umgebung';
import { useI18n } from '@core/lib/i18n';
import { einladungscodeEinloesen } from '@core/api/zugriff';
import { flaecheErfolg, flaecheFeld, flaecheFehler, flaecheKarte, flaecheKnopf, flaecheKnopfLeise, flaecheLeise, flaecheTitel } from '@core/lib/portalFlaeche';

const feld = `w-full rounded-md ${flaecheFeld} px-3 py-2 text-sm shadow-sm disabled:opacity-60`;
const knopf = `w-full rounded-md ${flaecheKnopf} px-4 py-2 text-sm font-medium shadow disabled:cursor-not-allowed disabled:opacity-60`;
const knopfLeise = `w-full rounded-md ${flaecheKnopfLeise} px-4 py-2 text-sm font-medium disabled:opacity-60`;

/** Supabase client, only behind the DATENQUELLE guard (keeps supabase-js out of local builds). */
async function holeClient() {
  if (DATENQUELLE !== 'supabase') throw new Error('Einladungen gibt es nur in der Cloud-App.');
  const { supabaseClient } = await import('@core/api/supabaseClient.js');
  return supabaseClient();
}

/** @returns {string} the code from the URL, '' when missing */
function codeAusUrl() {
  try { return new URLSearchParams(window.location.search).get('code') || ''; } catch { return ''; }
}

/**
 * The invitation page.
 * @returns {React.ReactElement}
 */
export default function Einladung() {
  const { t } = useI18n();
  const [code] = useState(codeAusUrl);
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [passwort2, setPasswort2] = useState('');
  const [angemeldet, setAngemeldet] = useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = useState('');
  const [hinweis, setHinweis] = useState('');
  const [busy, setBusy] = useState(false);
  const cloud = DATENQUELLE === 'supabase';

  // Already signed in (e.g. back from Google): offer to accept right away.
  useEffect(() => {
    if (!cloud) return undefined;
    let aus = false;
    holeClient().then(async (c) => {
      const { data } = await c.auth.getUser();
      if (!aus) setAngemeldet(data?.user?.email || null);
    }).catch(() => {});
    return () => { aus = true; };
  }, [cloud]);

  /** Redeems the code and goes into the app. */
  const annehmen = async () => {
    await einladungscodeEinloesen(code);
    setHinweis(t('Zugang eingerichtet — die App wird geladen …'));
    window.location.assign('/');
  };

  /** @param {() => Promise<void>} fn */
  const ausfuehren = async (fn) => {
    setFehler('');
    setHinweis('');
    setBusy(true);
    try { await fn(); } catch (e) {
      const m = String(/** @type {any} */ (e)?.message || e);
      setFehler(/nicht zulässig oder nicht gefunden/i.test(m)
        ? t('Dieser Einladungslink ist ungültig, abgelaufen oder schon benutzt. Bitte beim Büro einen neuen anfordern.')
        : m);
    } finally { setBusy(false); }
  };

  /** @param {React.FormEvent} e */
  const registrieren = (e) => {
    e.preventDefault();
    ausfuehren(async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error(t('Bitte eine gültige E-Mail-Adresse eingeben.'));
      if (passwort.length < 8) throw new Error(t('Das Passwort braucht mindestens 8 Zeichen.'));
      if (passwort !== passwort2) throw new Error(t('Die beiden Passwörter stimmen nicht überein.'));
      const c = await holeClient();
      const r = await c.auth.signUp({ email: email.trim(), password: passwort });
      if (r.error && /already registered|already exists/i.test(r.error.message)) {
        // The address has an account: sign in with the password typed here.
        const s = await c.auth.signInWithPassword({ email: email.trim(), password: passwort });
        if (s.error) throw new Error(t('Zu dieser E-Mail gibt es schon ein Konto — bitte dessen Passwort eingeben.'));
      } else if (r.error) {
        if (/signups? not allowed|disabled/i.test(r.error.message)) throw new Error(t('Die Registrierung ist im Büro gerade ausgeschaltet. Bitte dem Büro Bescheid geben.'));
        throw new Error(`${t('Registrierung fehlgeschlagen')}: ${r.error.message}`);
      } else if (!r.data?.session) {
        throw new Error(t('Konto angelegt, aber das Büro verlangt eine Bestätigung per E-Mail. Bitte dem Büro Bescheid geben.'));
      }
      await annehmen();
    });
  };

  const mitGoogle = () => ausfuehren(async () => {
    const c = await holeClient();
    const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
    if (error) {
      throw new Error(/provider is not enabled|unsupported provider/i.test(error.message)
        ? t('Die Anmeldung mit Google ist im Büro noch nicht eingerichtet. Bitte E-Mail und Passwort verwenden.')
        : error.message);
    }
  });

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <main className={`w-full max-w-sm rounded-xl ${flaecheKarte} p-6 shadow-xl`} aria-labelledby="einladung-titel" data-testid="einladung">
        <div className="mb-5">
          <h1 id="einladung-titel" className={`text-lg font-bold ${flaecheTitel}`}>{t('Einladung zu BIT-Atelier')}</h1>
          <p className={`text-xs ${flaecheLeise}`}>{t('Mit diesem Link bekommen Sie Zugang zu Ihrem Projekt.')}</p>
        </div>

        {!cloud && (
          <p role="alert" className={`mb-4 rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>
            {t('Einladungen gibt es nur in der Cloud-App.')}
          </p>
        )}
        {cloud && !code && (
          <p role="alert" className={`mb-4 rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>
            {t('Im Link fehlt der Einladungscode. Bitte den vollständigen Link aus der Nachricht öffnen.')}
          </p>
        )}

        {cloud && code && angemeldet && (
          <div className="space-y-3">
            <p className="text-sm">{t('Angemeldet als')} <strong>{angemeldet}</strong>.</p>
            <button type="button" className={knopf} disabled={busy} onClick={() => ausfuehren(annehmen)}>{t('Einladung annehmen')}</button>
          </div>
        )}

        {cloud && code && !angemeldet && (
          <form onSubmit={registrieren} className="space-y-3" noValidate>
            <button type="button" className={knopfLeise} disabled={busy} onClick={mitGoogle} data-testid="einladung-google">{t('Mit Google anmelden')}</button>
            <p className={`text-center text-xs ${flaecheLeise}`}>{t('oder mit E-Mail')}</p>
            <div>
              <label htmlFor="einladung-email" className={`mb-1 block text-xs font-medium ${flaecheLeise}`}>{t('E-Mail')}</label>
              <input id="einladung-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={feld} disabled={busy} />
            </div>
            <div>
              <label htmlFor="einladung-passwort" className={`mb-1 block text-xs font-medium ${flaecheLeise}`}>{t('Passwort festlegen (mindestens 8 Zeichen)')}</label>
              <input id="einladung-passwort" type="password" autoComplete="new-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} className={feld} disabled={busy} />
            </div>
            <div>
              <label htmlFor="einladung-passwort2" className={`mb-1 block text-xs font-medium ${flaecheLeise}`}>{t('Passwort wiederholen')}</label>
              <input id="einladung-passwort2" type="password" autoComplete="new-password" value={passwort2} onChange={(e) => setPasswort2(e.target.value)} className={feld} disabled={busy} />
            </div>
            <button type="submit" className={knopf} disabled={busy}>{busy ? t('Wird eingerichtet …') : t('Zugang einrichten')}</button>
          </form>
        )}

        {fehler && <p role="alert" className={`mt-3 rounded-md ${flaecheFehler} px-3 py-2 text-sm`}>{fehler}</p>}
        {hinweis && <p role="status" className={`mt-3 rounded-md ${flaecheErfolg} px-3 py-2 text-sm`}>{hinweis}</p>}

        <p className={`mt-5 border-t border-border pt-4 text-center text-[11px] ${flaecheLeise}`}>
          <Link to="/impressum" className="underline hover:text-foreground">{t('Impressum')}</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/datenschutz" className="underline hover:text-foreground">{t('Datenschutz')}</Link>
        </p>
      </main>
    </div>
  );
}
