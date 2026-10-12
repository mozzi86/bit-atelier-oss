// Tab "Schreiben" of /Correspondence (phase 82, 82-05): the letters the access
// may see (sicht.js — projects of the project view, office letters with the
// module, accounting letters only with accounting rights), filter active
// project / all / office (without project), "Neues Schreiben".
//
// In:  props schreiben (already filtered by rights), projektNamen, aktivesProjekt,
//      darfBearbeiten, onNeu, onOeffnen. Out: the tab.

import React, { useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { BEREICHE, SCHREIBEN_STATUS } from "@core/lib/brief/status.js";

/**
 * @param {{schreiben: any[], projektNamen: Map<string, string>, aktivesProjekt: string|null, darfBearbeiten: boolean,
 *   onNeu: () => void, onOeffnen: (s: any) => void}} props
 * @returns {React.ReactElement}
 */
export default function SchreibenListe({ schreiben, projektNamen, aktivesProjekt, darfBearbeiten, onNeu, onOeffnen }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState(aktivesProjekt ? "aktiv" : "alle");
  const liste = schreiben
    .filter((s) => filter === "alle" || (filter === "buero" ? !s.project_id : s.project_id === aktivesProjekt))
    .sort((a, b) => String(b.datum || b.created_date || "").localeCompare(String(a.datum || a.created_date || "")));
  const auswahl = "h-9 rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
  return (
    <section className="space-y-3" data-testid="schreiben-liste">
      <div className="flex flex-wrap items-center gap-2">
        {darfBearbeiten && <Button type="button" size="sm" onClick={onNeu} data-testid="schreiben-neu"><PenLine className="h-4 w-4" aria-hidden="true" /> {t("Neues Schreiben")}</Button>}
        <select aria-label={t("Projektfilter")} className={auswahl} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="schreiben-filter">
          {aktivesProjekt && <option value="aktiv">{t("aktives Projekt")}</option>}
          <option value="alle">{t("alle")}</option>
          <option value="buero">{t("Büro (ohne Projekt)")}</option>
        </select>
      </div>
      {liste.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Noch keine Schreiben.")}</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Schreiben")}</caption>
            <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              <tr><th scope="col" className="px-2 py-1">{t("Status")}</th><th scope="col" className="px-2 py-1">{t("Betreff")}</th><th scope="col" className="px-2 py-1">{t("Empfänger")}</th>
                <th scope="col" className="px-2 py-1">{t("Datum")}</th><th scope="col" className="px-2 py-1">{t("Projekt")}</th><th scope="col" className="px-2 py-1">{t("Bereich")}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {liste.map((s) => (
                <tr key={s.id} data-testid="schreiben-zeile" data-schreiben={s.id}>
                  <td className="px-2 py-1">{t(/** @type {any} */ (SCHREIBEN_STATUS)[s.status]?.label || s.status)}</td>
                  <td className="px-2 py-1">
                    <button type="button" className="text-left text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300" onClick={() => onOeffnen(s)}>{s.betreff || t("(ohne Betreff)")}</button>
                  </td>
                  <td className="px-2 py-1">{s.variante === "verteiler" ? t("Verteiler") : [s.empfaenger?.firma, s.empfaenger?.name].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-2 py-1 tabular-nums">{s.datum || String(s.festgeschrieben_am || "").slice(0, 10) || "—"}</td>
                  <td className="px-2 py-1">{s.project_id ? projektNamen.get(s.project_id) || s.project_id : "—"}</td>
                  <td className="px-2 py-1">{t(/** @type {any} */ (BEREICHE)[s.bereich]?.label || s.bereich || "Projekt")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
