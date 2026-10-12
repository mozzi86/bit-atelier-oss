// Tab "Briefvorlagen" of /Correspondence (phase 82, 82-05): every template
// with its source (82, 81 fee builders, 79 dunning), version and the marks
// "Büro-Fassung" and "Richtwert"; opens the template editor.
//
// In:  props vorlagen (with office version and title), onOeffnen. Out: the tab.

import React from "react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";

/**
 * @param {{vorlagen: Array<Record<string, any>>, darfPflegen: boolean, onOeffnen: (v: Record<string, any>) => void}} props
 * @returns {React.ReactElement}
 */
export default function VorlagenReiter({ vorlagen, darfPflegen, onOeffnen }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2" data-testid="vorlagen">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {vorlagen.map((v) => (
          <li key={v.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="vorlage-zeile" data-vorlage={v.key}>
            <div className="min-w-0">
              <p className="font-medium text-slate-900 dark:text-slate-100">{t(v.titel || v.key)}</p>
              <p className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{t("Phase {n}").replace("{n}", String(v.quelle))} · {t("Fassung {n}").replace("{n}", String(v.version))}</span>
                {v.buero && <span className="rounded bg-emerald-100 px-1 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" data-testid="vorlage-buero">{t("Büro-Fassung")}</span>}
                {v.richtwert && <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t("Richtwert")}</span>}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => onOeffnen(v)} aria-label={`${darfPflegen && "text" in v && !v.textAus79 ? t("Bearbeiten") : t("Ansehen")}: ${t(v.titel || v.key)}`}>
              {darfPflegen && "text" in v && !v.textAus79 ? t("Bearbeiten") : t("Ansehen")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
