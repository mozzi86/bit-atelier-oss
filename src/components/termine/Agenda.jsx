// Tab "Agenda" of /Deadlines (phase 82, 82-03, FRIST-02/04): the terms in the
// five groups Überfällig · Heute · Diese Woche · Nächste Woche · Später, each
// headed with its count; "Erledigt", "Öffnen" and editing manual terms per row;
// export as .ics (exactly the filtered, visible set — never an absence, the
// file leaves the app) and the list as PDF (a working list, no legal document,
// therefore not filed). The honesty sentence stays on the page: reminders only
// while the app is open, no mail, no push.
//
// In:  props termine (filtered and rights-checked), heute, agendaTage, vorlauf,
//      projektNamen, onErledigt, onBearbeiten, onNeu. Out: the agenda.

import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Download, FileDown } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { alsIcs } from "@core/lib/kalender/ics.js";
import { AGENDA_GRUPPEN } from "@core/lib/kalender/termin.js";
import { exportElementToPdf } from "@core/lib/pdf";
import { gruppiere } from "@/lib/termine/termineAnsicht.js";
import TerminZeile, { terminTitel } from "./TerminZeile.jsx";

/**
 * Offers a text as a file download.
 * @param {string} text
 * @param {string} name
 * @param {string} typ MIME type
 */
function herunterladen(text, name, typ) {
  const url = URL.createObjectURL(new Blob([text], { type: typ }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {{
 *   termine: import("@core/lib/kalender/termin.js").Termin[], heute: string, agendaTage: number, vorlauf: Record<string, number[]>,
 *   projektNamen: Map<string, string>, onErledigt: (t: any) => void, onBearbeiten: (t: any) => void, onNeu: () => void, darfBearbeiten: boolean,
 * }} props
 * @returns {React.ReactElement}
 */
export default function Agenda({ termine, heute, agendaTage, vorlauf, projektNamen, onErledigt, onBearbeiten, onNeu, darfBearbeiten }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ref = useRef(/** @type {HTMLDivElement|null} */ (null));
  const gruppen = gruppiere(termine, heute, { agendaTage });
  const sichtbar = AGENDA_GRUPPEN.flatMap((g) => gruppen[g.key]);

  const ics = () => herunterladen(alsIcs(sichtbar, { jetzt: new Date(), titel: (x) => terminTitel(t, x) }), `fristen_${heute}.ics`, "text/calendar;charset=utf-8");
  const pdf = async () => { if (ref.current) await exportElementToPdf(ref.current, `fristen_${heute}.pdf`); };

  return (
    <section className="space-y-3" data-testid="agenda">
      <div className="flex flex-wrap gap-2">
        {darfBearbeiten && <Button type="button" size="sm" onClick={onNeu}><CalendarPlus className="h-4 w-4" aria-hidden="true" /> {t("Termin anlegen")}</Button>}
        <Button type="button" size="sm" variant="outline" onClick={ics} data-testid="ics-export"><Download className="h-4 w-4" aria-hidden="true" /> {t(".ics exportieren")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={pdf}><FileDown className="h-4 w-4" aria-hidden="true" /> {t("Liste als PDF")}</Button>
      </div>
      <div ref={ref} className="space-y-4">
        {AGENDA_GRUPPEN.map((g) => (
          <div key={g.key} data-testid={`agenda-gruppe-${g.key}`} data-anzahl={gruppen[g.key].length}>
            <h3 className={`text-sm font-semibold ${g.key === "ueberfaellig" && gruppen[g.key].length ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
              {t(g.label)} <span className="font-normal text-slate-500">({gruppen[g.key].length})</span>
            </h3>
            {gruppen[g.key].length === 0 ? <p className="text-xs text-slate-500">{t("Keine Einträge.")}</p> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {gruppen[g.key].map((x) => (
                  <TerminZeile key={x.id} termin={x} heute={heute} vorlauf={vorlauf} projektName={x.project_id ? projektNamen.get(x.project_id) || x.project_id : null}
                    onErledigt={onErledigt} onOeffnen={(y) => navigate(y.ziel)} onBearbeiten={darfBearbeiten && x.quelle === "manuell" ? onBearbeiten : null} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
