// Shared shell pieces of the three phase-82 pages (/Deadlines, /Absences,
// /Correspondence): the tab list classes (same look as the 81 pages), the
// cloud card for a module locked in the cloud (E-03 without the release E-20),
// the load-error card and the empty state of a tab a later plan fills.
//
// In:  props. Out: TAB_LISTE/TAB_AUSLOESER/TAB_INHALT (re-exported from the 81
//      shell, one look for all office pages), BueroCloudKarte, BueroLadeFehler,
//      ReiterNochLeer.

import React from "react";
import { CloudOff, Inbox } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import EmptyState from "@core/components/common/EmptyState";
import { useI18n } from "@core/lib/i18n";

export { TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/zeitHonorar/Huelle.jsx";

/**
 * Notice instead of the tabs when the module is locked in the cloud. Nothing is read behind it.
 * @returns {React.ReactElement}
 */
export function BueroCloudKarte() {
  const { t } = useI18n();
  return (
    <div role="status" data-testid="buero82-cloud-sperre" className="rounded-xl border border-slate-200 bg-white p-6 space-y-2 dark:border-slate-700 dark:bg-slate-900">
      <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
        <CloudOff className="h-5 w-5 text-slate-500" aria-hidden="true" /> {t("Erst nach Zugriffstrennung (Phase 74) verfügbar")}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t("Diese Büro-Daten sähen sonst alle Mitglieder einer Organisation. Nutzen Sie bis dahin die lokale Version.")}</p>
    </div>
  );
}

/**
 * Load error with the plain-text message and a retry.
 * @param {{fehler: string, onRetry: () => void}} props
 * @returns {React.ReactElement}
 */
export function BueroLadeFehler({ fehler, onRetry }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3 dark:border-red-800 dark:bg-red-950">
      <p className="font-medium text-red-800 dark:text-red-200">{t("Daten konnten nicht geladen werden")}</p>
      <p className="text-sm text-red-700 dark:text-red-300">{fehler}</p>
      <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onRetry}>{t("Erneut versuchen")}</button>
    </div>
  );
}

/**
 * Neutral empty state of a tab (the plan that fills it is named only in the code).
 * @returns {React.ReactElement}
 */
export function ReiterNochLeer() {
  const { t } = useI18n();
  return <EmptyState icon={Inbox} title={t("Noch keine Einträge.")} />;
}
