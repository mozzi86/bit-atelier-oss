// Team calendar (phase 82, 82-04, ABW-04): persons × days of a month as a real
// table (accessible: row header = initials, column header = day, every cell
// with a text label) — no library, the pattern of GanttSchedule.jsx. Holidays
// hatched, weekends set off, requested entries dashed, half days half filled.
// Cell text, tooltip and aria label say only "abwesend" or "beantragt" — never
// the kind, for every role (E-14): the model (teamRaster) does not even carry it.
//
// In:  props raster (teamRaster), jahr, monat, onMonat. Out: the calendar.

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";

/** Cell styles per state. */
const STIL = Object.freeze({
  abwesend: "bg-emerald-500/80",
  beantragt: "border-2 border-dashed border-emerald-600 bg-emerald-100/40 dark:bg-emerald-900/30",
  feiertag: "bg-[repeating-linear-gradient(45deg,rgba(148,163,184,.45)_0_3px,transparent_3px_6px)]",
  wochenende: "bg-slate-200/70 dark:bg-slate-800",
});

/**
 * @param {{raster: ReturnType<typeof import("@/lib/abwesenheit/abwesenheitAnsicht.js").teamRaster>, jahr: number, monat: number, onMonat: (delta: number) => void}} props
 * @returns {React.ReactElement}
 */
export default function TeamKalender({ raster, jahr, monat, onMonat }) {
  const { t, lang } = useI18n();
  const titel = new Date(Date.UTC(jahr, monat - 1, 15)).toLocaleDateString(lang === "en" ? "en-GB" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
  const label = (/** @type {string|null} */ z) => (z === "abwesend" ? t("abwesend") : z === "beantragt" ? t("beantragt") : z === "feiertag" ? t("Feiertag") : z === "wochenende" ? t("Wochenende") : "");
  return (
    <section className="space-y-2" data-testid="team-kalender">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onMonat(-1)} aria-label={t("Vorheriger Monat")}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <h2 className="min-w-[10rem] text-center font-semibold text-slate-900 dark:text-slate-100" data-testid="team-monat">{titel}</h2>
        <Button type="button" size="sm" variant="outline" onClick={() => onMonat(1)} aria-label={t("Nächster Monat")}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="border-collapse text-[11px]">
          <caption className="sr-only">{t("Teamkalender")} {titel}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-white px-2 py-1 text-left dark:bg-slate-900">{t("Kürzel")}</th>
              {raster.tage.map((d) => <th key={d.datum} scope="col" className="w-6 px-0.5 py-1 text-center font-normal text-slate-500">{Number(d.datum.slice(8))}</th>)}
            </tr>
          </thead>
          <tbody>
            {raster.zeilen.map((z) => (
              <tr key={z.id} data-person={z.id}>
                <th scope="row" className="sticky left-0 bg-white px-2 py-0.5 text-left font-medium dark:bg-slate-900">{z.kuerzel}</th>
                {z.zellen.map((c) => {
                  const text = label(c.zustand);
                  return (
                    <td key={c.datum} className="h-6 w-6 p-0.5" data-datum={c.datum} data-zustand={c.zustand || ""} title={text ? `${z.kuerzel} · ${c.datum} · ${text}${c.halb ? ` (${t("Halbtag")})` : ""}` : undefined}>
                      <span className={`block h-full w-full rounded-sm ${c.zustand ? STIL[c.zustand] : ""} ${c.halb ? "[clip-path:inset(0_50%_0_0)]" : ""}`}>
                        {text && <span className="sr-only">{text}</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300" aria-label={t("Legende")}>
        <li className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${STIL.abwesend}`} aria-hidden="true" /> {t("abwesend")}</li>
        <li className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${STIL.beantragt}`} aria-hidden="true" /> {t("beantragt")}</li>
        <li className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${STIL.feiertag}`} aria-hidden="true" /> {t("Feiertag")}</li>
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/80 [clip-path:inset(0_50%_0_0)]" aria-hidden="true" /> {t("Halbtag")}</li>
      </ul>
    </section>
  );
}
