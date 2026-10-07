// Shared shell for the two legal pages (57-06 Task 1c).
//
// Deliberately free of everything that can fail: no holeClient(), no Supabase,
// no mode switch, no data load. These pages have to render when the database
// is down, when the project is paused and when the session cannot be resolved -
// a legal notice that waits for an auth round trip is a legal notice that
// disappears exactly when something is wrong.
//
// The way back depends on the data path (72-16, N-18). In the cloud build it
// points at /anmeldung, not at /: a visitor without a session is bounced from /
// to /anmeldung anyway (App.jsx), just with a visible detour. Demo, client and
// Express have no login - /anmeldung only says "cloud only" there, so every demo
// visitor who opened "Impressum" from the footer was stuck. There the way back
// is the app itself. DATENQUELLE is a build constant, no auth call is involved,
// so the rule above (nothing that can fail) still holds.

import React from 'react';
import { Link } from 'react-router-dom';
import { DATENQUELLE } from '@core/lib/umgebung';
import { useI18n } from '@core/lib/i18n';
import { rechtsRueckweg } from '@core/lib/seitenLink';

/**
 * @param {{titel: string, children: React.ReactNode}} props
 */
export default function RechtsSeite({ titel, children }) {
  const { t } = useI18n();
  const rueckweg = rechtsRueckweg(DATENQUELLE);
  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-green-50/30 to-blue-50/20 p-4">
      <main
        className="mx-auto w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8"
        aria-labelledby="rechts-titel"
      >
        <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-lg font-bold text-white shadow"
            aria-hidden="true"
          >
            BA
          </div>
          <div>
            <h1 id="rechts-titel" className="text-lg font-bold text-slate-800">
              {titel}
            </h1>
            <p className="text-xs text-slate-500">BIT-Atelier</p>
          </div>
        </div>

        {children}

        {/* Every legal page links every other one: a reader of the privacy
            notice who wants the cookie list must not have to guess the URL. */}
        <nav
          aria-label="Weitere Rechtstexte"
          className="mt-8 flex flex-wrap justify-center gap-x-3 gap-y-1 border-t border-slate-100 pt-4 text-center text-xs text-slate-600"
        >
          <Link to="/impressum" className="underline hover:text-slate-900">Impressum</Link>
          <Link to="/datenschutz" className="underline hover:text-slate-900">Datenschutz</Link>
          <Link to="/nutzungsbedingungen" className="underline hover:text-slate-900">Nutzungsbedingungen</Link>
          <Link to="/rueckerstattung" className="underline hover:text-slate-900">Rückerstattung</Link>
          <Link to="/cookies" className="underline hover:text-slate-900">Cookies</Link>
        </nav>
        <p className="mt-3 text-center text-xs">
          <Link
            to={rueckweg.ziel}
            className="font-medium text-emerald-700 underline hover:text-emerald-900"
          >
            {t(rueckweg.text)}
          </Link>
        </p>
      </main>
    </div>
  );
}
