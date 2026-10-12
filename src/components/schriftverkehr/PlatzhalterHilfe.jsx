// Placeholder help of the template editor (phase 82, 82-05): the catalogue of
// a letter type, grouped with the phase that delivers the values; a click
// inserts the placeholder.
//
// In:  props art, onEinfuegen. Out: the panel.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { katalogFuer } from "@core/lib/brief/platzhalterKatalog.js";

/**
 * @param {{art: string, onEinfuegen: (platzhalter: string) => void, nurLesen?: boolean}} props
 * @returns {React.ReactElement}
 */
export default function PlatzhalterHilfe({ art, onEinfuegen, nurLesen = false }) {
  const { t } = useI18n();
  return (
    <aside aria-label={t("Platzhalter")} className="space-y-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700" data-testid="platzhalter-hilfe">
      <p className="font-medium text-slate-800 dark:text-slate-100">{t("Platzhalter")}</p>
      {katalogFuer(art).map((g) => (
        <div key={g.gruppe}>
          <p className="text-slate-500">{t("aus Phase {n}").replace("{n}", g.phase)}</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {g.pfade.map((p) => (
              <li key={p.pfad}>
                <button type="button" disabled={nurLesen} title={t(p.label)} onClick={() => onEinfuegen(`{{${p.pfad}}}`)}
                  className="rounded border border-slate-200 px-1 py-0.5 font-mono hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800">
                  {p.pfad}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}
