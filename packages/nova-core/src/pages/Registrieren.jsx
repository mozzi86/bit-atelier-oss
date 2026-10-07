// Registration page /registrieren (Plan 83-02): open registration with manual
// approval. Route in App.jsx RECHTSWEGE, i.e. OUTSIDE the auth gate, in every
// build.
//
// Cloud build: a form (name, office, e-mail, phone, role, message). "Zugang
// anfragen" opens the visitor's mail program with a prepared mail to
// ANBIETER.anfrageEmail — nothing is sent by the app itself. Afterwards a
// confirmation explains the waiting time: accounts are approved by hand
// (scripts/zugang-freischalten.mjs), the invitation arrives by e-mail.
// Local / express build: there is no account at all — the page says so and
// links into the app.
//
// In:  nothing (reads DATENQUELLE and ANBIETER). Out: the page.

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DATENQUELLE } from '@core/lib/umgebung';
import { useI18n } from '@core/lib/i18n';
import { ANBIETER } from '@core/lib/anbieter';
import { REGISTRIERUNG_ROLLEN, pruefeRegistrierung, registrierungMailto } from '@core/lib/registrierung';

const feldKlasse =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
const labelKlasse = 'mb-1 block text-xs font-medium text-slate-600';
const knopfKlasse =
  'w-full rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90';

/** @type {import('@core/lib/registrierung').RegistrierungsAngaben} */
const LEER = { name: '', buero: '', email: '', telefon: '', rolle: '', nachricht: '' };

/**
 * Frame shared by the three states (form, confirmation, local note).
 * @param {{ untertitel: string, children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
function Rahmen({ untertitel, children }) {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-slate-50 via-green-50/30 to-blue-50/20 p-4">
      <main className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl" aria-labelledby="registrieren-titel">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-lg font-bold text-white shadow" aria-hidden="true">
            BA
          </div>
          <div>
            <h1 id="registrieren-titel" className="text-lg font-bold text-slate-800">BIT-Atelier</h1>
            <p className="text-xs text-slate-500">{untertitel}</p>
          </div>
        </div>
        {children}
        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-[11px] text-slate-400">
          <Link to="/impressum" className="underline hover:text-slate-600">{t('Impressum')}</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/datenschutz" className="underline hover:text-slate-600">{t('Datenschutz')}</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/nutzungsbedingungen" className="underline hover:text-slate-600">{t('Nutzungsbedingungen')}</Link>
        </p>
      </main>
    </div>
  );
}

/**
 * The registration page.
 * @returns {React.ReactElement}
 */
export function Registrieren() {
  const { t } = useI18n();
  const [angaben, setAngaben] = useState(LEER);
  const [fehler, setFehler] = useState(/** @type {string[]} */ ([]));
  const [mailHref, setMailHref] = useState('');

  // Outside the cloud there is no account to request: the local build keeps
  // everything on the device, the express build is the operator's own server.
  if (DATENQUELLE !== 'supabase') {
    return (
      <Rahmen untertitel={t('Registrieren')}>
        <div role="status" data-testid="registrieren-lokal" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p>{t('Die lokale Fassung braucht kein Konto — einfach loslegen.')}</p>
          <p className="mt-2">
            <Link to="/" className="font-medium underline hover:text-emerald-950">{t('Zur Startseite')}</Link>
          </p>
        </div>
      </Rahmen>
    );
  }

  if (mailHref) {
    return (
      <Rahmen untertitel={t('Registrieren')}>
        <div role="status" data-testid="registrieren-bestaetigung" className="space-y-3 text-sm text-slate-700">
          <p className="font-medium text-slate-800">{t('Anfrage vorbereitet.')}</p>
          <p>
            {t('Konten werden von Hand freigeschaltet — in der Regel innerhalb von {n} Werktagen. Sie erhalten eine E-Mail mit dem Zugang.')
              .replace('{n}', String(ANBIETER.antwortfristWerktage))}
          </p>
          <p className="text-xs text-slate-500">
            {t('Ihr E-Mail-Programm hat sich nicht geöffnet?')}{' '}
            <a href={mailHref} className="font-medium text-emerald-700 underline hover:text-emerald-900">{t('E-Mail erneut öffnen')}</a>
            {' · '}
            <span className="font-mono">{ANBIETER.anfrageEmail}</span>
          </p>
          <p>
            <Link to="/anmeldung" className="font-medium text-emerald-700 underline hover:text-emerald-900">{t('Zur Anmeldung')}</Link>
          </p>
        </div>
      </Rahmen>
    );
  }

  /** @param {keyof typeof LEER} feld @param {string} wert */
  const setze = (feld, wert) => setAngaben((a) => ({ ...a, [feld]: wert }));

  /** @param {React.FormEvent} e */
  const absenden = (e) => {
    e.preventDefault();
    const probleme = pruefeRegistrierung(angaben);
    setFehler(probleme);
    if (probleme.length) return;
    const href = registrierungMailto(angaben, ANBIETER.anfrageEmail);
    // Opens the visitor's own mail program; the app itself sends nothing.
    window.location.assign(href);
    setMailHref(href);
  };

  return (
    <Rahmen untertitel={t('Registrieren')}>
      <p className="mb-4 text-sm text-slate-600">
        {t('Konten für den Cloud-Betrieb werden von Hand freigeschaltet. Ihre Anfrage geht als E-Mail aus Ihrem eigenen E-Mail-Programm an uns.')}
      </p>
      <form onSubmit={absenden} className="space-y-3" noValidate data-testid="registrieren-formular">
        <div>
          <label htmlFor="reg-name" className={labelKlasse}>{t('Name')}</label>
          <input id="reg-name" autoComplete="name" required value={angaben.name} onChange={(e) => setze('name', e.target.value)} className={feldKlasse} />
        </div>
        <div>
          <label htmlFor="reg-buero" className={labelKlasse}>{t('Büro / Firma')}</label>
          <input id="reg-buero" autoComplete="organization" required value={angaben.buero} onChange={(e) => setze('buero', e.target.value)} className={feldKlasse} />
        </div>
        <div>
          <label htmlFor="reg-email" className={labelKlasse}>{t('E-Mail')}</label>
          <input id="reg-email" type="email" autoComplete="email" required value={angaben.email} onChange={(e) => setze('email', e.target.value)} className={feldKlasse} />
        </div>
        <div>
          <label htmlFor="reg-telefon" className={labelKlasse}>{t('Telefon (optional)')}</label>
          <input id="reg-telefon" type="tel" autoComplete="tel" value={angaben.telefon} onChange={(e) => setze('telefon', e.target.value)} className={feldKlasse} />
        </div>
        <div>
          <label htmlFor="reg-rolle" className={labelKlasse}>{t('Rolle')}</label>
          <select id="reg-rolle" required value={angaben.rolle} onChange={(e) => setze('rolle', e.target.value)} className={feldKlasse}>
            <option value="">{t('Bitte wählen …')}</option>
            {REGISTRIERUNG_ROLLEN.map((r) => (
              <option key={r.wert} value={r.wert}>{t(r.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reg-nachricht" className={labelKlasse}>{t('Nachricht (optional)')}</label>
          <textarea id="reg-nachricht" rows={3} value={angaben.nachricht} onChange={(e) => setze('nachricht', e.target.value)} className={feldKlasse} />
        </div>

        {fehler.length > 0 && (
          <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-rose-200 bg-rose-50 py-2 pl-7 pr-3 text-sm text-rose-800">
            {fehler.map((f) => <li key={f}>{t(f)}</li>)}
          </ul>
        )}

        <p className="text-xs text-slate-500">
          {t('Ihre Angaben werden nur zur Freischaltung verwendet.')}{' '}
          <Link to="/datenschutz" className="underline hover:text-slate-700">{t('Datenschutz')}</Link>
        </p>

        <button type="submit" className={knopfKlasse}>{t('Zugang anfragen')}</button>

        <p className="text-center text-xs text-slate-500">
          {t('Schon ein Konto?')}{' '}
          <Link to="/anmeldung" className="font-medium text-emerald-700 underline hover:text-emerald-900">{t('Anmelden')}</Link>
        </p>
      </form>
    </Rahmen>
  );
}

export default Registrieren;
