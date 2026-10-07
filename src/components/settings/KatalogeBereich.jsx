// Settings area "Kataloge & Bürostandards" (key `catalogs`, 80-01, D-P80-13).
//
// Only a way to the one existing editor: quantity rules and catalogues live in
// AVA › Mengenregeln (KatalogEditor). A second editor here would drift from it
// (CLAUDE.md: "kein zweiter Editor neben einem bestehenden").
//
// In:  props {kontext} (unused). Out: BEREIT = true, the area.

import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Library } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

/** Ready since 80-01. */
export const BEREIT = true;

/** Target of the link: the quantity rules tab of the AVA (a TabsTrigger value in AVA.jsx). */
export const KATALOG_ZIEL = "/AVA?tab=mengenregeln";

/**
 * @returns {React.ReactElement}
 */
export default function KatalogeBereich() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="bereich-kataloge" data-testid="bereich-catalogs"
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-3 dark:border-slate-700 dark:bg-slate-900">
      <h2 id="bereich-kataloge" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <Library className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Kataloge & Bürostandards")}
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Mengenregeln und Kataloge pflegen Sie an einer Stelle: in der Ausschreibung (AVA) im Reiter Mengenregeln. Sie gelten dort für alle Leistungsverzeichnisse des Büros.")}
      </p>
      <Link to={KATALOG_ZIEL} data-testid="kataloge-link"
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500 dark:text-emerald-200 dark:hover:bg-emerald-950">
        {t("Zu den Mengenregeln der AVA")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
