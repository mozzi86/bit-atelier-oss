// "Weiter mit …" bar at the end of every page (72-09, N-03).
//
// Why: the end of a task is where the next one starts, and most modules ended
// in nothing — no link to any other module. Layout.jsx renders this bar after
// the page content, so pages whose own files are off limits (check suite,
// designer) get an exit too. The steps come from src/naechsteSchritte.js.
//
// In:  the current pathname and whether it is a Labor route.
// Out: <nav aria-label="Weiter mit"> with one router link (one tab stop) per
//      step, plus the Labor notice with a way back to the overview on Labor
//      routes; nothing at all when there is neither.

import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FlaskConical } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { naechsteSchritteFuer, zielPfad } from "../naechsteSchritte";

/**
 * Next-step bar for the page at `pathname`.
 *
 * @param {object} props
 * @param {string} props.pathname router pathname without query, e.g. "/AVA"
 * @param {boolean} [props.labor] true on a Labor route: adds the Labor notice
 *   and a link back to the project overview (also when the table has no steps)
 * @returns {JSX.Element|null} the bar, or null when there is nothing to offer
 */
export default function WeiterMit({ pathname, labor = false }) {
  const { t } = useI18n();
  // The table never points at its own route (unit test); the filter keeps a
  // future slip from rendering a link that goes nowhere.
  const schritte = naechsteSchritteFuer(pathname).filter((s) => zielPfad(s.ziel) !== pathname);
  if (schritte.length === 0 && !labor) return null;

  return (
    <nav
      aria-label={t("Weiter mit")}
      className="mx-4 md:mx-6 mt-8 mb-4 rounded-xl border border-slate-200 bg-white/80 px-4 py-3"
    >
      {schritte.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The nav's accessible name already says this; hidden to avoid a double announcement. */}
          <span aria-hidden="true" className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {t("Weiter mit")}
          </span>
          <ul className="flex flex-wrap gap-2 min-w-0">
            {schritte.map((s) => (
              <li key={s.ziel} className="max-w-full">
                <Link
                  to={s.ziel}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-400 hover:text-emerald-700 dark:hover:border-emerald-500 dark:hover:text-emerald-300 transition-colors"
                >
                  <span className="min-w-0">{t(s.text)}</span>
                  <ArrowRight
                    aria-hidden="true"
                    className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {labor && (
        <p
          data-testid="weiter-mit-labor"
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 ${
            schritte.length > 0 ? "mt-3 pt-3 border-t border-slate-200" : ""
          }`}
        >
          <FlaskConical aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{t("Labor-Modul – zeigt eine Vision oder braucht einen Zusatzdienst, nicht Teil des Kernprodukts")}</span>
          <Link
            to="/Dashboard"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-emerald-700 dark:hover:text-emerald-300"
          >
            {t("Zurück zur Projektübersicht")}
          </Link>
        </p>
      )}
    </nav>
  );
}
