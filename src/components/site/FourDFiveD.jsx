import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Stat } from "@core/components/Field";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { CalendarClock, Layers, Euro } from "lucide-react";

const DAY = 24 * 3600 * 1000;
const eur = (n) => `€${Math.round(n).toLocaleString("de-DE")}`;

function expected(task, ms) {
  const s = new Date(task.start_date).getTime();
  const e = new Date(task.end_date).getTime();
  if (ms <= s) return 0;
  if (ms >= e) return 1;
  return (ms - s) / (e - s);
}

// 4D (time) + 5D (cost) view: scrub a date to see built floors and cost-to-date.
export default function FourDFiveD({ tasks = [], totalFloors = 8 }) {
  const range = useMemo(() => {
    if (tasks.length === 0) return { start: Date.now(), end: Date.now() + 30 * DAY };
    const s = Math.min(...tasks.map((t) => new Date(t.start_date).getTime()));
    const e = Math.max(...tasks.map((t) => new Date(t.end_date).getTime()));
    return { start: s, end: e };
  }, [tasks]);

  const [scrub, setScrub] = useState(() => Math.min(range.end, Math.max(range.start, Date.now())));
  const totalBudget = tasks.reduce((s, t) => s + (t.budget || 0), 0);

  const costToDate = tasks.reduce((s, t) => s + (t.budget || 0) * expected(t, scrub), 0);
  const plannedFraction = totalBudget ? costToDate / totalBudget : 0;
  const builtFloors = Math.round(plannedFraction * totalFloors);
  const activeTasks = tasks.filter((t) => {
    const s = new Date(t.start_date).getTime();
    const e = new Date(t.end_date).getTime();
    return scrub >= s && scrub <= e;
  });

  const curve = useMemo(() => {
    const N = 40;
    return Array.from({ length: N + 1 }, (_, i) => {
      const t = range.start + ((range.end - range.start) * i) / N;
      const cost = tasks.reduce((s, task) => s + (task.budget || 0) * expected(task, t), 0);
      return { t, cost: Math.round(cost) };
    });
  }, [tasks, range]);

  return (
    <div className="space-y-4">
      {/* Date scrubber */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium"><CalendarClock className="w-4 h-4" /> Zeitpunkt</span>
            <Badge className="bg-blue-100 text-blue-800">{format(new Date(scrub), "dd.MM.yyyy")}</Badge>
          </div>
          <input
            type="range" min={range.start} max={range.end} step={DAY / 2} value={scrub}
            onChange={(e) => setScrub(Number(e.target.value))} className="w-full"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>{format(new Date(range.start), "dd.MM.yyyy")}</span>
            <span>{format(new Date(range.end), "dd.MM.yyyy")}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 4D building */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4" /> 4D — Bauzustand</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <svg viewBox="0 0 100 140" className="w-32 h-48">
                {Array.from({ length: totalFloors }).map((_, idx) => {
                  const floor = totalFloors - 1 - idx; // render top-down
                  const built = floor < builtFloors;
                  const current = floor === builtFloors - 1;
                  const y = idx * (130 / totalFloors) + 4;
                  const h = 130 / totalFloors - 2;
                  return (
                    <g key={floor}>
                      <rect x="20" y={y} width="60" height={h}
                        fill={built ? (current ? "#22c55e" : "#3b82f6") : "#ffffff"}
                        fillOpacity={built ? 0.85 : 0.25}
                        stroke={built ? "#1e3a8a" : "#cbd5e1"}
                        strokeWidth="0.8" strokeDasharray={built ? "0" : "2 2"} />
                      <text x="50" y={y + h / 2 + 1.5} fontSize="5" textAnchor="middle" fill={built ? "#fff" : "#94a3b8"}>
                        {floor + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="flex-1 space-y-2">
                <Stat label="Geschosse gebaut" value={`${builtFloors} / ${totalFloors}`} accent="text-blue-600" />
                <Stat label="Baufortschritt (geplant)" value={`${Math.round(plannedFraction * 100)} %`} accent="text-emerald-600" />
                <div>
                  <div className="text-xs text-slate-500 mb-1">Aktive Gewerke</div>
                  <div className="flex flex-wrap gap-1">
                    {activeTasks.length === 0 && <span className="text-xs text-slate-400">—</span>}
                    {activeTasks.map((t) => <Badge key={t.id} className="bg-amber-100 text-amber-800 text-[10px]">{t.trade}</Badge>)}
                  </div>
                </div>
              </div>
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
                    tickFormatter={(t) => format(new Date(t), "dd.MM.")} tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => eur(v)} labelFormatter={(t) => format(new Date(t), "dd.MM.yyyy")} />
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
