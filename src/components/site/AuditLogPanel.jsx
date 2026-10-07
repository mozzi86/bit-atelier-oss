import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@core/components/ui/table";
import { format } from "date-fns";
import { ScrollText, RefreshCw, Download } from "lucide-react";

const actorColor = {
  Bediener: "bg-blue-100 text-blue-800",
  Disposition: "bg-purple-100 text-purple-800",
  Wetter: "bg-cyan-100 text-cyan-800",
  Sicherheitssystem: "bg-rose-100 text-rose-800",
};

// Persistent, exportable audit trail of autonomous actions (liability record).
export default function AuditLogPanel({ projectId }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await bitApi.entities.AuditLog.filter({ project_id: projectId }, "-ts");
      setEntries(data);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return entries.filter(
      (e) =>
        !q ||
        [e.actor, e.action, e.detail, e.unit_name].some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [entries, filter]);

  const exportCsv = () => {
    const rows = [["Zeit", "Akteur", "Aktion", "Einheit", "Detail"]];
    filtered.forEach((e) => rows.push([e.ts, e.actor, e.action, e.unit_name || "", e.detail || ""]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><ScrollText className="w-4 h-4" /> Audit-Log ({filtered.length})</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} title="Aktualisieren">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-1" /> CSV</Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Filtern (Akteur, Aktion, Einheit, Detail)..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-[480px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zeit</TableHead>
                <TableHead>Akteur</TableHead>
                <TableHead>Aktion</TableHead>
                <TableHead>Einheit</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {e.ts ? format(new Date(e.ts), "dd.MM. HH:mm:ss") : "—"}
                  </TableCell>
                  <TableCell><Badge className={actorColor[e.actor] || "bg-slate-100 text-slate-700"}>{e.actor}</Badge></TableCell>
                  <TableCell className="font-medium text-sm">{e.action}</TableCell>
                  <TableCell className="text-sm">{e.unit_name || "—"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{e.detail}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-6">Noch keine Einträge.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
