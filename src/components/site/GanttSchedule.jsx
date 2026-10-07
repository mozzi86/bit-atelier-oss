import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { format } from "date-fns";
import { toast } from "sonner";
import { CalendarRange, Plus, Bell, Building2, User } from "lucide-react";
import { taskTiming, pendingNotifications, formatLead } from "./notifications";

const DAY = 24 * 3600 * 1000;

const phaseBar = {
  active: "bg-blue-500",
  done: "bg-emerald-500",
  upcoming: "bg-slate-400",
};
function barColor(timing) {
  if (timing.phase === "due") return timing.due?.key === "10h" ? "bg-red-500" : timing.due?.key === "3d" ? "bg-amber-500" : "bg-yellow-500";
  return phaseBar[timing.phase] || "bg-slate-400";
}

export default function GanttSchedule({ tasks = [], onAddTask }) {
  const now = new Date();
  const notifiedRef = useRef(false);

  const range = useMemo(() => {
    if (tasks.length === 0) return { start: now.getTime(), end: now.getTime() + 30 * DAY };
    const starts = tasks.map((t) => new Date(t.start_date).getTime());
    const ends = tasks.map((t) => new Date(t.end_date).getTime());
    const start = Math.min(...starts, now.getTime()) - 2 * DAY;
    const end = Math.max(...ends) + 2 * DAY;
    return { start, end };
  }, [tasks]);

  const span = range.end - range.start || 1;
  const pct = (ms) => ((ms - range.start) / span) * 100;
  const nowPct = pct(now.getTime());

  // weekly ticks
  const ticks = [];
  let t = new Date(range.start);
  t.setHours(0, 0, 0, 0);
  while (t.getTime() < range.end) {
    ticks.push(new Date(t));
    t = new Date(t.getTime() + 7 * DAY);
  }

  const notifications = useMemo(() => pendingNotifications(tasks, now), [tasks]);

  // Fire toasts once for due notifications.
  useEffect(() => {
    if (notifiedRef.current || notifications.length === 0) return;
    notifiedRef.current = true;
    notifications.slice(0, 4).forEach((n) => {
      toast(`🔔 Erinnerung: „${n.name}"`, {
        description: `${n.threshold.label} vorher · ${n.company || n.assignee} wird benachrichtigt (Start in ${formatLead(n.msToStart)})`,
      });
    });
  }, [notifications]);

  return (
    <div className="space-y-6">
      {/* Notifications */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Bell className="w-4 h-4" /> Benachrichtigungen ({notifications.length})
            </span>
            <span className="text-xs font-normal text-slate-400">Schwellen: 1 Woche · 3 Tage · 10 Std vorher</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notifications.length === 0 && <p className="text-sm text-slate-500">Aktuell keine anstehenden Benachrichtigungen.</p>}
          {notifications.map((n) => (
            <div key={n.taskId} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
              <div>
                <span className="font-medium">{n.name}</span>
                <span className="text-slate-500"> — Start in {formatLead(n.msToStart)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {n.company || n.assignee}
                </Badge>
                <Badge className={n.threshold.key === "10h" ? "bg-red-100 text-red-800" : n.threshold.key === "3d" ? "bg-amber-100 text-amber-800" : "bg-yellow-100 text-yellow-800"}>
                  {n.threshold.label} vorher
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Gantt */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="w-4 h-4" /> Bauzeitenplan
          </CardTitle>
          <Button size="sm" onClick={onAddTask}><Plus className="w-4 h-4 mr-1" /> Aufgabe planen</Button>
        </CardHeader>
        <CardContent>
          {/* header ticks */}
          <div className="hidden md:block ml-[260px] relative h-5 mb-1 border-b">
            {ticks.map((d, i) => (
              <div key={i} className="absolute text-[10px] text-slate-400" style={{ left: `${pct(d.getTime())}%` }}>
                {format(d, "dd.MM.")}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {tasks.map((task) => {
              const timing = taskTiming(task, now);
              const left = pct(new Date(task.start_date).getTime());
              const width = Math.max(1.5, pct(new Date(task.end_date).getTime()) - left);
              return (
                <div key={task.id} className="flex items-center gap-2">
                  <div className="w-[252px] shrink-0">
                    <div className="text-sm font-medium truncate">{task.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 truncate">
                      <User className="w-3 h-3" /> {task.assignee_name} · {task.company_name}
                    </div>
                  </div>
                  <div className="relative flex-1 h-8 bg-slate-50 rounded">
                    {/* weekly gridlines */}
                    {ticks.map((d, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: `${pct(d.getTime())}%` }} />
                    ))}
                    {/* now line */}
                    {nowPct >= 0 && nowPct <= 100 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" style={{ left: `${nowPct}%` }} />
                    )}
                    {/* bar */}
                    <div
                      className={`absolute top-1 h-6 rounded ${barColor(timing)} flex items-center px-1.5 overflow-hidden`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${task.name} — ${timing.label}`}
                    >
                      {/* progress overlay */}
                      <div className="absolute inset-y-0 left-0 bg-black/20 rounded-l" style={{ width: `${task.progress || 0}%` }} />
                      <span className="relative text-[10px] text-white font-medium truncate">{task.progress || 0}%</span>
                    </div>
                  </div>
                  <div className="w-28 shrink-0 text-right">
                    {timing.phase === "due" && (
                      <Badge className="bg-amber-100 text-amber-800 text-[10px]">{timing.due.label} ⏰</Badge>
                    )}
                    {timing.phase === "active" && <Badge className="bg-blue-100 text-blue-800 text-[10px]">läuft</Badge>}
                    {timing.phase === "done" && <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">fertig</Badge>}
                  </div>
                </div>
              );
            })}
            {tasks.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">Noch keine Aufgaben geplant.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
