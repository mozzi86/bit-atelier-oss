import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Progress } from "@core/components/ui/progress";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { TrendingUp } from "lucide-react";

const BAR_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#6366f1"];

export default function AgentPerformance({ agents = [], metrics = {} }) {
  const chartData = agents.map((a) => ({
    name: a.name.split(" ")[0],
    tasks: a.tasks_completed || 0,
    confidence: a.confidence || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Aktive Agenten", metrics.active_agents],
          ["Aufgaben gesamt", metrics.total_tasks],
          ["Erfolgsquote", metrics.success_rate ? `${metrics.success_rate}%` : "—"],
          ["Stunden gespart", metrics.time_saved_hours],
        ].map(([label, val]) => (
          <Card key={label}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-slate-800">{val ?? "—"}</div>
              <div className="text-xs text-slate-500 mt-1">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4" /> Abgeschlossene Aufgaben je Agent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="tasks" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Konfidenz je Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {agents.map((a) => (
            <div key={a.id}>
              <div className="flex justify-between text-sm mb-1">
                <span>{a.name}</span>
                <span className="font-semibold">{a.confidence}%</span>
              </div>
              <Progress value={a.confidence} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
