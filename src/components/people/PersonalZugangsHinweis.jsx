// Notice of /People when personnel access is not granted (80-01, E-03, DS-04/DS-12):
// shown INSTEAD of the tabs, so the page reads no personnel data at all.
//
// In:  {zugang: 'nur-lokal' | 'keine-berechtigung'} (src/lib/people/zugang.js).
// Out: a status card.

import React from "react";
import { CloudOff, Lock } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

/**
 * @param {{zugang: string}} props result of personalZugang()
 * @returns {React.ReactElement}
 */
export default function PersonalZugangsHinweis({ zugang }) {
  const { t } = useI18n();
  const nurLokal = zugang === "nur-lokal";
  const Icon = nurLokal ? CloudOff : Lock;
  return (
    <div role="status" data-testid="personal-zugangshinweis" data-zugang={zugang}
      className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
        <Icon className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        {nurLokal
          ? t("Personaldaten bleiben lokal — in der Cloud-Fassung nicht verfügbar (bis Phase 74).")
          : t("Nur für Inhaber:innen des Büros.")}
      </p>
    </div>
  );
}
