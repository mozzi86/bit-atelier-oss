// StellenListe.jsx — Liste der Stellen (Plan 80-08, Task 3): Titel, Status,
// Umfang, Zahl der aktiven Bewerbungen (offene Pipeline-Stufe, keine
// Entscheidung), Aktionen "Bearbeiten", "Anzeigentext", "Neue Bewerbung".
//
// In:  {stellen, bewerbungen, hervorhebenId?, onBearbeiten, onAnzeigentext, onNeueBewerbung}.
// Out: UI (schreibt selbst nichts — die Aktionen delegieren an SucheReiter.jsx).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { STELLEN_STATUS } from "./StellenFormular.jsx";

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * @param {{stellen: object[], bewerbungen: object[], hervorhebenId?: string,
 *   onBearbeiten: (s: object) => void, onAnzeigentext: (s: object) => void, onNeueBewerbung: (s: object) => void}} props
 * @returns {React.ReactElement}
 */
export default function StellenListe({ stellen, bewerbungen, hervorhebenId, onBearbeiten, onAnzeigentext, onNeueBewerbung }) {
  const { t } = useI18n();
  const containerRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));

  React.useEffect(() => {
    if (!hervorhebenId) return;
    containerRef.current?.querySelector(`[data-stelle="${hervorhebenId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hervorhebenId]);

  const aktiveBewerbungenJeStelle = (stelleId) =>
    bewerbungen.filter((b) => b.stelle_id === stelleId && !b?.entscheidung?.art).length;

  if (stellen.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="stellen-leer">{t("Noch keine Stellen erfasst.")}</p>;
  }

  return (
    <div ref={containerRef} data-testid="stellen-liste" className="space-y-2">
      {stellen.map((s) => {
        const status = STELLEN_STATUS.find((k) => k.key === s.status);
        const aktiv = aktiveBewerbungenJeStelle(s.id);
        return (
          <div key={s.id} data-stelle={s.id}
            className={`rounded-lg border p-3 ${hervorhebenId === s.id ? "border-emerald-400 ring-2 ring-emerald-200 dark:ring-emerald-800" : "border-slate-200 dark:border-slate-700"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-slate-800 dark:text-slate-100">{s.titel}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t(status?.label || s.status)} · {fuellen(t("{n} Std./Woche"), { n: s.wochenstunden ?? "?" })} · {fuellen(t("{n} Bewerbungen aktiv"), { n: aktiv })}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => onBearbeiten(s)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  {t("Bearbeiten")}
                </button>
                <button type="button" onClick={() => onAnzeigentext(s)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  {t("Anzeigentext")}
                </button>
                <button type="button" onClick={() => onNeueBewerbung(s)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                  {t("Neue Bewerbung")}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
