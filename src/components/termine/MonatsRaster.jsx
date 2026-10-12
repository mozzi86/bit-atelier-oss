// Tab "Monat" of /Deadlines (phase 82, 82-03, FRIST-02): a month grid, Monday
// first, public holidays hatched (from the one holiday setting of the office,
// kalenderEinstellung, 81-01 core), weekends set apart, up to three entries per
// day plus "+n"; month navigation; arrow keys move the focus between days,
// Enter opens the day's list. Below it an accessible table of the same data
// (pattern of the row grid in GanttSchedule.jsx, no library).
//
// In:  props termine (filtered), heute, feiertage ([{datum, name}] of the shown
//      years), projektNamen. Out: the month view.

import React, { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { feiertagLabel } from "@/lib/abwesenheit/feiertagNamen.js";
import { monatsRaster } from "@/lib/termine/termineAnsicht.js";
import { terminTitel } from "./TerminZeile.jsx";

/** Hatching of a holiday (light and dark). */
const SCHRAFFUR = "bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.25)_0,rgba(148,163,184,0.25)_4px,transparent_4px,transparent_8px)]";

/**
 * @param {{termine: import("@core/lib/kalender/termin.js").Termin[], heute: string, feiertage: Array<{datum: string, name: string}>, projektNamen: Map<string, string>}} props
 * @returns {React.ReactElement}
 */
export default function MonatsRaster({ termine, heute, feiertage, projektNamen }) {
  const { t, lang } = useI18n();
  const [monat, setMonat] = useState(() => ({ jahr: Number(heute.slice(0, 4)), monat: Number(heute.slice(5, 7)) }));
  const [gewaehlt, setGewaehlt] = useState(/** @type {string|null} */ (null));
  const wurzel = useRef(/** @type {HTMLDivElement|null} */ (null));
  const wochen = useMemo(() => monatsRaster(monat.jahr, monat.monat, termine, feiertage), [monat, termine, feiertage]);
  const tage = wochen.flat();
  const ort = lang === "en" ? "en-GB" : "de-DE";
  const titel = new Date(Date.UTC(monat.jahr, monat.monat - 1, 15)).toLocaleDateString(ort, { month: "long", year: "numeric", timeZone: "UTC" });
  const wochentage = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 8, 28 + i)).toLocaleDateString(ort, { weekday: "short", timeZone: "UTC" }));
  const blaettern = (d) => setMonat((m) => {
    const z = m.monat - 1 + d;
    return { jahr: m.jahr + Math.floor(z / 12), monat: ((z % 12) + 12) % 12 + 1 };
  });

  /** Arrow keys move the focus by a day / a week. */
  const taste = (/** @type {React.KeyboardEvent} */ e, /** @type {number} */ i) => {
    const schritt = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (schritt) {
      e.preventDefault();
      const ziel = wurzel.current?.querySelector(`[data-index="${Math.max(0, Math.min(tage.length - 1, i + schritt))}"]`);
      /** @type {any} */ (ziel)?.focus();
    }
    if (e.key === "Enter") setGewaehlt(tage[i].datum);
  };
  const tagesListe = gewaehlt ? tage.find((d) => d.datum === gewaehlt)?.termine || [] : [];
  const imMonat = tage.filter((d) => d.imMonat && d.termine.length);

  return (
    <section className="space-y-3" data-testid="monats-raster">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => blaettern(-1)} aria-label={t("Vorheriger Monat")}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <h3 className="min-w-40 text-center text-sm font-semibold" data-testid="monat-titel">{titel}</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => blaettern(1)} aria-label={t("Nächster Monat")}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div ref={wurzel} className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs dark:border-slate-700 dark:bg-slate-700" role="grid" aria-label={titel}>
        {wochentage.map((w) => <div key={w} role="columnheader" className="bg-slate-50 px-1 py-1 text-center font-medium dark:bg-slate-800">{w}</div>)}
        {tage.map((d, i) => (
          <div key={d.datum} role="gridcell" tabIndex={0} data-index={i} data-datum={d.datum} data-feiertag={d.feiertag ? "1" : undefined}
            onKeyDown={(e) => taste(e, i)} onClick={() => setGewaehlt(d.datum)}
            aria-label={`${d.datum}${d.feiertagName ? " · " + t(feiertagLabel(d.feiertagName)) : ""} · ${d.termine.length}`}
            className={`min-h-20 cursor-pointer p-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${d.imMonat ? "bg-white dark:bg-slate-900" : "bg-slate-50 text-slate-400 dark:bg-slate-800/60"} ${d.wochenende ? "bg-slate-50 dark:bg-slate-800" : ""} ${d.feiertag ? SCHRAFFUR : ""} ${d.datum === heute ? "ring-2 ring-inset ring-emerald-500" : ""}`}>
            <div className="flex justify-between"><span className="font-medium">{Number(d.datum.slice(8, 10))}</span>{d.feiertagName && <span className="truncate text-[10px] text-slate-500" title={t(feiertagLabel(d.feiertagName))}>{t(feiertagLabel(d.feiertagName))}</span>}</div>
            {d.termine.slice(0, 3).map((x) => <p key={x.id} className={`truncate ${x.klasse === "frist" ? "text-rose-700 dark:text-rose-300" : ""}`}>{terminTitel(t, x)}</p>)}
            {d.termine.length > 3 && <p className="text-slate-500">+{d.termine.length - 3}</p>}
          </div>
        ))}
      </div>
      {gewaehlt && (
        <div className="rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700" data-testid="tages-liste">
          <p className="font-medium">{gewaehlt}</p>
          {tagesListe.length === 0 ? <p className="text-slate-500">{t("Keine Einträge.")}</p> : <ul>{tagesListe.map((x) => <li key={x.id}>{terminTitel(t, x)}</li>)}</ul>}
        </div>
      )}
      <table className="w-full text-sm" data-testid="monats-tabelle">
        <caption className="text-left text-xs text-slate-500">{t("Termine im Monat")}</caption>
        <thead><tr className="text-left text-slate-600 dark:text-slate-300"><th scope="col" className="py-1">{t("Datum")}</th><th scope="col">{t("Termin")}</th><th scope="col">{t("Projekt")}</th></tr></thead>
        <tbody>
          {imMonat.flatMap((d) => d.termine.map((x) => (
            <tr key={d.datum + x.id} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1 tabular-nums">{d.datum}</td><td>{terminTitel(t, x)}</td><td>{x.project_id ? projektNamen.get(x.project_id) || x.project_id : "—"}</td></tr>
          )))}
        </tbody>
      </table>
    </section>
  );
}
