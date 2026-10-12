// "Stunden für: …" — which person books on this device (phase 81-02, D-P81-21).
// The list comes from phase 80 through the adapter (src/lib/people/
// zeitHonorarPersonal.js) plus the virtual owner when 80 has no owner record
// (E-17). Without personnel access (cloud build, another role) there is no
// list of names: the page books as the owner and says why. Until phase 82 ties
// bookings to the signed-in user the choice is stored per device.
//
// In:  props zh (page loader), zz (useZeiterfassung). Out: the selector row.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { personAnzeigeName } from "@/lib/zeit/personalQuelle.js";
import { FELD } from "./zeitGemeinsam.jsx";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung}} props
 * @returns {React.ReactElement}
 */
export default function MitarbeiterWahl({ zh, zz }) {
  const { t } = useI18n();
  const zugang = zh.personal.zugang;
  // 82-02: without the approval right a linked person records only her own hours.
  const zugriff = useZugriff();
  const eigene = !zugriff.darf("zeiterfassung:freigabe") && zugriff.mitarbeiterId && zz.personen.some((p) => p.id === zugriff.mitarbeiterId) ? zugriff.mitarbeiterId : null;
  React.useEffect(() => { if (eigene && zz.personId !== eigene) zz.setPersonId(eigene); }, [eigene, zz]);
  const personen = eigene ? zz.personen.filter((p) => p.id === eigene) : zz.personen;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="zeit-person" className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{t("Stunden für")}</label>
        <select id="zeit-person" className={`${FELD} sm:w-64`} value={zz.personId} onChange={(e) => zz.setPersonId(e.target.value)} data-testid="zeit-person" disabled={Boolean(eigene)}>
          {personen.map((p) => <option key={p.id} value={p.id}>{personAnzeigeName(p, t)}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {eigene
          ? t("Sie erfassen Ihre eigenen Stunden.")
          : zugang === "erlaubt"
          ? t("Auswahl gilt für dieses Gerät.")
          : zugang === "nur-lokal"
            ? t("Personaldaten bleiben lokal — in der Cloud buchen Sie als Inhaber/in.")
            : t("Ohne Personal-Zugang buchen Sie als Inhaber/in.")}
        {zh.personal.fehler && <span className="ml-1 text-red-700 dark:text-red-300">{zh.personal.fehler}</span>}
      </p>
      {zugang === "erlaubt" && !eigene && (
        <Link to="/People?tab=staff" className="text-xs underline text-emerald-800 dark:text-emerald-300 sm:ml-auto">{t("Mitarbeitende pflegen")}</Link>
      )}
    </div>
  );
}
