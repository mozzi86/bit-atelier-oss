// "Ansicht als …" in the header (phase 82, 82-02, D-P82-19): picks the active
// user record of this device — the view follows its role. No password and no
// PIN field on purpose: it is no sign-in, it orders what is shown and protects
// no data on this device (the honesty block in Settings › Nutzer & Rechte says
// so). In the cloud only the role chip shows (the server role is the identity).
// A load error of the rights is shown here, not swallowed.
//
// In:  nothing (useZugriff). Out: the header element.

import React from "react";
import { UserRound } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { ROLLEN_LABELS } from "@core/lib/rechte.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";

/** @returns {React.ReactElement} */
export default function NutzerUmschalter() {
  const { t } = useI18n();
  const z = useZugriff();
  const rolle = t(/** @type {Record<string, string>} */ (ROLLEN_LABELS)[z.rolle || "inhaber"] || String(z.rolle));
  const tipp = t("Ansicht als – keine Anmeldung. Ordnet, was angezeigt wird; schützt keine Daten auf diesem Gerät.");
  return (
    <div className="flex items-center gap-1.5" data-testid="nutzer-umschalter">
      {z.ladeFehler && <span role="alert" className="hidden sm:inline text-xs text-rose-700 dark:text-rose-300" title={z.ladeFehler}>{t("Rechte konnten nicht geladen werden")}</span>}
      {z.kannWechseln ? (
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300" title={tipp}>
          <UserRound className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">{t("Ansicht als …")}</span>
          <select aria-label={t("Ansicht als …")} value={z.nutzer?.id || ""} onChange={(e) => z.wechsleNutzer(e.target.value || null)} data-testid="ansicht-als"
            className="h-8 max-w-[9rem] rounded-md border border-slate-200 bg-white px-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
            {(z.nutzerListe || []).map((n) => (
              <option key={n.id} value={n.id}>{[n.kuerzel || n.name, t(/** @type {Record<string, string>} */ (ROLLEN_LABELS)[n.rolle] || n.rolle)].filter(Boolean).join(" · ")}</option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="hidden sm:inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200" title={tipp} data-testid="rollen-chip">{rolle}</span>
    </div>
  );
}
