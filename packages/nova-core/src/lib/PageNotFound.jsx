// Catch-all page for unknown routes (App.jsx and the standalone shells).
//
// In:  the current router location, optional height class.
// Out: a German "page not found" with ONE way back into the app.
//
// 72-16 (N-18): the way back is a router <Link to="/">, not
// window.location.href = '/'. The hard reload went to the domain root - in the
// demo that is the website, not /demo/ - and threw away the in-memory state of
// the app. The <Link> stays inside the router: HashRouter builds keep their
// sub-path, BrowserRouter builds their base path. The shells render this page
// inside their own Router, so the link works there too.

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '@core/lib/i18n';

/**
 * @param {{hoehenKlasse?: string}} props hoehenKlasse: in the main layout
 *   "min-h-full" fills the scrolling <main>; the standalone shells (document
 *   scrolling) pass "min-h-screen".
 */
export default function PageNotFound({ hoehenKlasse = 'min-h-full' }) {
  const { t } = useI18n();
  const location = useLocation();
  const pageName = location.pathname.substring(1);

  return (
    <div className={`${hoehenKlasse} flex items-center justify-center bg-slate-50 p-6 dark:bg-slate-950`}>
      <div className="w-full max-w-md">
        <div className="space-y-6 text-center">
          <div className="space-y-2" aria-hidden="true">
            <p className="text-7xl font-light text-slate-300 dark:text-slate-600">404</p>
            <div className="mx-auto h-0.5 w-16 bg-slate-200 dark:bg-slate-700"></div>
          </div>

          <div className="space-y-3">
            <h1 className="text-2xl font-medium text-slate-800 dark:text-slate-100">
              {t('Seite nicht gefunden')}
            </h1>
            <p className="leading-relaxed text-slate-600 dark:text-slate-300">
              {t('Die Seite „{name}“ gibt es in dieser Anwendung nicht.').replace('{name}', pageName)}
            </p>
          </div>

          <div className="pt-6">
            <Link
              to="/"
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-950"
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              {t('Zur Übersicht')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
