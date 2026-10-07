// Settings area "Büro & Briefkopf" (key `office`, 80-03: KRITIK-05). Embeds the
// ONE letterhead editor (@core/components/settings/BriefkopfFormular) — the
// former Layout.jsx modal and the Reports.jsx card are gone (Layout.jsx task 3,
// Reports.jsx task 3), both now point here.
//
// In:  props {kontext?: import("@/lib/settings/bereiche.js").EinstellungsKontext} (unused — the
//      editor reads its own state through useBriefkopf).
// Out: BEREIT = true, the area.

import React from "react";
import { FileSignature } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import BriefkopfFormular from "@core/components/settings/BriefkopfFormular.jsx";

/** Ready since 80-03. */
export const BEREIT = true;

/**
 * @returns {React.ReactElement}
 */
export default function BueroBereich() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="bereich-buero" data-testid="bereich-office" className="space-y-4">
      <h2 id="bereich-buero" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <FileSignature className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Büro & Briefkopf")}
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Büroname, Adresse und Kontakt im Kopf aller Berichte")}
      </p>
      <BriefkopfFormular />
      {/* Reserved for phase 79's default payment term (buchhaltung.zahlungsziel_tage):
          it lives in "Einstellungen › Regelwerke" (80-07), not here — a second copy
          of the same value would drift (CLAUDE.md: keine zweite Quelle). */}
    </section>
  );
}
