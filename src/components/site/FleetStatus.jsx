import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { Activity, Truck, AlertCircle, CheckCircle2 } from "lucide-react";

const STATUS_META = {
  working: { label: "Arbeitet", color: "#10b981" },
  loading: { label: "Lädt auf/ab", color: "#f59e0b" },
  enroute: { label: "Unterwegs", color: "#3b82f6" },
  charging: { label: "Lädt Akku", color: "#a855f7" },
  idle: { label: "Bereit", color: "#94a3b8" },
  stopped: { label: "Gestoppt", color: "#ef4444" },
};

// Expected progress from elapsed time between start and end.
function expectedProgress(task, now) {
  const s = new Date(task.start_date).getTime();
  const e = new Date(task.end_date).getTime();
  if (now <= s) return 0;
  if (now >= e) return 100;
  return Math.round(((now - s) / (e - s)) * 100);
}

export default function FleetStatus({ units = [], tasks = [] }) {
  const now = Date.now();

  const byStatus = useMemo(() => {
    const m = {};
    units.forEach((u) => (m[u.status] = (m[u.status] || 0) + 1));
    return m;
  }, [units]);

  const pieData = Object.entries(byStatus).map(([k, v]) => ({
    name: STATUS_META[k]?.label || k,
    value: v,
    color: STATUS_META[k]?.color || "#94a3b8",
  }));

  const areas = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      const exp = expectedProgress(t, now);
      const delta = (t.progress || 0) - exp;
      if (!map[t.area]) map[t.area] = { area: t.area, tasks: 0, behindSum: 0, worst: 0, progress: 0, expected: 0 };
      const a = map[t.area];
      a.tasks += 1;
      a.progress += t.progress || 0;
      a.expected += exp;
      if (delta < a.worst) a.worst = delta;
    });
    return Object.values(map).map((a) => ({
      ...a,
      avgProgress: Math.round(a.progress / a.tasks),
      avgExpected: Math.round(a.expected / a.tasks),
      behind: a.worst < -15,
    }));
  }, [tasks, now]);

  const stat = (label, value, Icon, color) => (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}><Icon className="w-5 h-5" /></div>
        <div>
          <div className="text-2xl font-bold text-slate-800">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stat("Arbeiten gerade", byStatus.working || 0, Activity, "bg-emerald-100 text-emerald-700")}
        {stat("Laden auf/ab", byStatus.loading || 0, Truck, "bg-amber-100 text-amber-700")}
        {stat("Akku laden", byStatus.charging || 0, AlertCircle, "bg-purple-100 text-purple-700")}
        {stat("Bereit/Idle", byStatus.idle || 0, CheckCircle2, "bg-slate-100 text-slate-700")}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Flottenstatus</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Bereiche im Zeitplan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {areas.map((a) => (
              <div key={a.area}>
                <div className="flex justify-between items-center text-sm mb-1">
                  <span className="font-medium">{a.area}</span>
                  {a.behind ? (
                    <Badge className="bg-red-100 text-red-800">hinter Plan</Badge>
                  ) : (
                    <Badge className="bg-emerald-100 text-emerald-800">im Plan</Badge>
                  )}
                </div>
                <div className="relative">
                  <Progress value={a.avgProgress} className={a.behind ? "[&>div]:bg-red-500" : ""} />
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>Ist {a.avgProgress}%</span>
                  <span>Soll {a.avgExpected}%</span>
                </div>
              </div>
            ))}
            {areas.length === 0 && <p className="text-sm text-slate-500">Keine Aufgaben.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
