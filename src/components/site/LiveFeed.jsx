import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Radio } from "lucide-react";

const levelColor = {
  info: "text-slate-600",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600 font-semibold",
};

export default function LiveFeed({ events = [] }) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Radio className="w-4 h-4" /> Live-Feed
          </span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            LIVE
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-1.5 text-sm">
        {events.length === 0 && <p className="text-slate-400">Warte auf Ereignisse...</p>}
        {events.map((e) => (
          <div key={e.id} className="flex gap-2">
            <span className="text-xs text-slate-400 tabular-nums shrink-0">{e.time}</span>
            <span className={levelColor[e.level] || "text-slate-600"}>{e.text}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
