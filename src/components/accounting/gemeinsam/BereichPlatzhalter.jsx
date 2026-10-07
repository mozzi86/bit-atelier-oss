// Placeholder of an accounting area that a later plan fills (phase 79). Keeps
// the tab honest while the area is being built: it names the area, says that
// it is in preparation and how many records are already stored for it (the
// demo seed shows up here before the area itself exists).
//
// In:  translated title, owner plan (data attribute for tests and the
//      review, not shown), optional record count. Out: an empty-state card.

import React from "react";
import { Construction } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

/**
 * @param {{titel: string, besitzer: string, anzahl?: number}} props
 *   titel: translated area name; besitzer: plan that fills the area, e.g. "79-04";
 *   anzahl: records already stored for this area
 * @returns {React.ReactElement}
 */
export default function BereichPlatzhalter({ titel, besitzer, anzahl }) {
  const { t } = useI18n();
  return (
    <section data-besitzer={besitzer} aria-label={titel}
      className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white/70 p-10 text-center dark:border-slate-600 dark:bg-slate-900/60">
      <span className="mb-3 rounded-xl bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <Construction className="h-8 w-8" aria-hidden="true" />
      </span>
      <h2 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{titel}</h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-300">{t("Dieser Bereich ist in Vorbereitung.")}</p>
      {typeof anzahl === "number" && anzahl > 0 && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" data-testid="bereich-anzahl">
          {t("{n} Einträge gespeichert").replace("{n}", String(anzahl))}
        </p>
      )}
    </section>
  );
}
