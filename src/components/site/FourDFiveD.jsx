import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Stat } from "@core/components/Field";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { CalendarClock, Layers, Euro, FileDown, Sheet } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { exportElementToPdf } from "@core/lib/pdf";
import { zeitstrahlMatrix, standAlsCsv } from "@/lib/planung/zeitstrahl";

const DAY = 24 * 3600 * 1000;
const eur = (n) => `€${Math.round(n).toLocaleString("de-DE")}`;

function expected(task, ms) {
  const s = new Date(task.start_date).getTime();
  const e = new Date(task.end_date).getTime();
  if (ms <= s) return 0;
  if (ms >= e) return 1;
  return (ms - s) / (e - s);
}

// Cell colours of the 4D matrix: not started (dashed), running (amber, share as fill), finished (green).
const ZELLE_KLASSE = {
  offen: "border-dashed border-slate-300 bg-white text-slate-400",
  laeuft: "border-amber-300 bg-amber-50 text-amber-900",
  fertig: "border-emerald-300 bg-emerald-100 text-emerald-900",
};
const ZUSTAND_TEXT = { offen: "nicht begonnen", laeuft: "läuft", fertig: "fertig" };

/**
 * 4D (time) + 5D (cost) view. Since 89-06 (D-BW-04) the 4D part is the matrix
 * construction section × trade at the chosen date (src/lib/planung/zeitstrahl.js) — it
 * replaced the estimate "floors built = budget share × 8 floors". Element-level follows 89-03.
 * @param {{ tasks?: Array<any>, projektName?: string }} props ScheduleTask rows of the project
 */
export default function FourDFiveD({ tasks = [], projektName = "" }) {
  const { t } = useI18n();
  const range = useMemo(() => {
    if (tasks.length === 0) return { start: Date.now(), end: Date.now() + 30 * DAY };
    const s = Math.min(...tasks.map((x) => new Date(x.start_date).getTime()).filter(Number.isFinite));
    const e = Math.max(...tasks.map((x) => new Date(x.end_date).getTime()).filter(Number.isFinite));
    return Number.isFinite(s) && Number.isFinite(e) ? { start: s, end: e } : { start: Date.now(), end: Date.now() + 30 * DAY };
  }, [tasks]);

  const [scrub, setScrub] = useState(() => Math.min(range.end, Math.max(range.start, Date.now())));
  const totalBudget = tasks.reduce((s, x) => s + (x.budget || 0), 0);
  const costToDate = tasks.reduce((s, x) => s + (x.budget || 0) * expected(x, scrub), 0);

  const matrix = useMemo(() => zeitstrahlMatrix(tasks, scrub), [tasks, scrub]);
  const aktiveGewerke = useMemo(() => [...new Set(matrix.aktiv.map((a) => a.gewerk))], [matrix]);
  const standRef = useRef(null);
  const datumIso = format(new Date(scrub), "yyyy-MM-dd");
  const dateiBasis = `${(projektName || "Projekt").replace(/[^\wäöüÄÖÜß-]+/g, "_")}_Bauzustand_${datumIso}`;

  const csvLaden = () => {
    // BOM so Excel reads the umlauts as UTF-8.
    const blob = new Blob(["﻿", standAlsCsv(matrix, datumIso)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${dateiBasis}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const pdfLaden = () => exportElementToPdf(standRef.current, `${dateiBasis}.pdf`, { orientation: "landscape" });

  const curve = useMemo(() => {
    const N = 40;
    return Array.from({ length: N + 1 }, (_, i) => {
      const ts = range.start + ((range.end - range.start) * i) / N;
      const cost = tasks.reduce((s, task) => s + (task.budget || 0) * expected(task, ts), 0);
      return { t: ts, cost: Math.round(cost) };
    });
  }, [tasks, range]);

  return (
    <div className="space-y-4">
      {/* Date scrubber */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium"><CalendarClock className="w-4 h-4" /> {t("Zeitpunkt")}</span>
            <Badge className="bg-blue-100 text-blue-800" data-testid="zs-datum">{format(new Date(scrub), "dd.MM.yyyy")}</Badge>
          </div>
          <input
            type="range" min={range.start} max={range.end} step={DAY / 2} value={scrub}
            onChange={(e) => setScrub(Number(e.target.value))} className="w-full"
            aria-label={t("Zeitpunkt")} data-testid="zs-regler"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>{format(new Date(range.start), "dd.MM.yyyy")}</span>
            <span>{format(new Date(range.end), "dd.MM.yyyy")}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid xl:grid-cols-2 gap-4">
        {/* 4D: construction section × trade */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> {t("4D — Bauzustand je Bauabschnitt und Gewerk")}</span>
              <span className="flex gap-1">
                <Button type="button" size="sm" variant="outline" onClick={pdfLaden} disabled={!matrix.abschnitte.length} data-testid="zs-pdf">
                  <FileDown className="w-3 h-3 mr-1" /> PDF
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={csvLaden} disabled={!matrix.abschnitte.length} data-testid="zs-csv">
                  <Sheet className="w-3 h-3 mr-1" /> CSV
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={standRef} className="space-y-3 bg-white" data-testid="zs-stand">
              {matrix.abschnitte.length === 0 ? (
                <p className="text-sm text-slate-400">{t("Keine Vorgänge mit Start- und Enddatum — im Bauzeitenplan anlegen.")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-separate border-spacing-1" data-testid="zs-matrix">
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-slate-500">{t("Bauabschnitt")} \ {t("Gewerk")}</th>
                        {matrix.gewerke.map((g) => <th key={g} className="text-left font-medium text-slate-600">{g}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.abschnitte.map((ab) => (
                        <tr key={ab}>
                          <th className="text-left font-medium text-slate-600 whitespace-nowrap">{ab}</th>
                          {matrix.gewerke.map((g) => {
                            const z = matrix.zelle(ab, g);
                            if (!z) return <td key={g} className="text-center text-slate-200">·</td>;
                            return (
                              <td key={g} data-testid="zs-zelle" data-abschnitt={ab} data-gewerk={g} data-zustand={z.zustand}
                                title={z.namen.join(" · ")}
                                className={`rounded border px-1.5 py-1 ${ZELLE_KLASSE[z.zustand]}`}>
                                <div className="font-medium">{t(ZUSTAND_TEXT[z.zustand])}</div>
                                <div className="tabular-nums">
                                  {t("Soll")} {Math.round(z.soll * 100)} %{z.ist != null ? ` · ${t("Ist")} ${Math.round(z.ist * 100)} %` : ""}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Stat label={t("Baufortschritt (Soll, dauergewichtet)")} value={`${Math.round(matrix.gesamtSoll * 100)} %`} accent="text-emerald-600" />
                <div>
                  <div className="text-xs text-slate-500 mb-1">{t("Auf der Baustelle am")} {format(new Date(scrub), "dd.MM.yyyy")}</div>
                  <div className="flex flex-wrap gap-1" data-testid="zs-aktiv">
                    {aktiveGewerke.length === 0 && <span className="text-xs text-slate-400">—</span>}
                    {aktiveGewerke.map((g) => (
                      <Badge key={g} className="bg-amber-100 text-amber-800 text-[10px]" title={matrix.aktiv.filter((a) => a.gewerk === g).map((a) => `${a.abschnitt}: ${a.name}`).join("\n")}>
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              {matrix.unbewertbar > 0 && (
                <p className="text-xs text-amber-700">{t("Vorgänge ohne gültiges Start-/Enddatum nicht dargestellt")}: {matrix.unbewertbar}</p>
              )}
              <p className="text-[11px] text-slate-400">{t("Bauteilgenau (Bauteile je Datum ein-/ausblenden) folgt mit den Bauteil-GUIDs aus 89-03.")}</p>
            </div>
          </CardContent>
        </Card>

        {/* 5D cost */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Euro className="w-4 h-4" /> 5D — Kostenverlauf</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <Stat label="Kosten bis Datum" value={eur(costToDate)} accent="text-purple-600" />
              <Stat label="Gesamtbudget" value={eur(totalBudget)} />
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="c5d" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                    tickFormatter={(ts) => format(new Date(ts), "dd.MM.")} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => eur(v)} labelFormatter={(ts) => format(new Date(ts), "dd.MM.yyyy")} />
                  <Area type="monotone" dataKey="cost" stroke="#a855f7" fill="url(#c5d)" />
                  <ReferenceLine x={scrub} stroke="#ef4444" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
