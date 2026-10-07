import { seitenWurzel } from "@core/lib/utils";
import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { toast } from "sonner";
import { BookmarkPlus, ArrowLeftRight, Download, Upload, FileJson, Box, History } from "lucide-react";
import { useProject } from "@core/lib/ProjectContext";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { IST_SUPABASE } from "@core/lib/umgebung";
import { gatherProjectData, snapshotMetrics, SNAPSHOT_LABELS, toIfcText, downloadText, readJsonFile } from "@ifc/lib/interop";

// 72-08 (KRITIK-14): the page stores nine key figures per stage and restores
// nothing, so its texts say "Stand festhalten", not "commit". The entity name
// ModelVersion and the stored fields stay as they are.

// Stored author of new stages on the local and demo path. Kept in German in the
// record and translated only on display; old records keep their "Du".
const LOKALER_AUTOR = "Lokaler Nutzer";

// Dictionary keys are whole German sentences with {name} slots; the values go
// in after translation so an English sentence can place them elsewhere.
const fuellen = (text, werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

export default function ModelVersions() {
  const { projectId, project } = useProject();
  const { user } = useAuth();
  const { t } = useI18n();
  const [versions, setVersions] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");

  const load = async () => {
    if (!projectId) return;
    const v = await bitApi.entities.ModelVersion.filter({ project_id: projectId }, "-version");
    setVersions(v);
    if (v.length) { setBId(v[0].id); setAId(v[1]?.id || v[0].id); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const festhalten = async () => {
    setBusy(true);
    try {
      const data = await gatherProjectData(projectId);
      const snap = snapshotMetrics(data);
      const nextV = (versions[0]?.version || 0) + 1;
      await bitApi.entities.ModelVersion.create({
        project_id: projectId, version: nextV, message: message.trim() || `Stand v${nextV}`,
        author: IST_SUPABASE && user?.email ? user.email : LOKALER_AUTOR,
        created_date: new Date().toISOString(), snapshot: snap,
      });
      setMessage("");
      toast.success(fuellen(t("Stand v{n} festgehalten"), { n: nextV }));
      load();
    } catch { toast.error(t("Festhalten fehlgeschlagen")); }
    setBusy(false);
  };

  const exportJson = async () => {
    const data = await gatherProjectData(projectId);
    downloadText(`${project?.name || "projekt"}.bit-atelier.json`, JSON.stringify(data, null, 2), "application/json");
    toast.success(t("Projektdaten exportiert"));
  };
  const exportIfc = async () => {
    const blds = await bitApi.entities.Building.filter({ project_id: projectId });
    downloadText(`${project?.name || "modell"}.ifc`, toIfcText(project, blds[0]), "application/x-step");
    toast.success(t("IFC exportiert"));
  };
  // Preview only: the file is read and counted, nothing is written.
  const importJson = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const obj = await readJsonFile(file);
      const m = snapshotMetrics(obj);
      toast.success(fuellen(
        t("Gelesen: {lv} LV-Pos., {tickets} Tickets, {kommentare} Kommentare – nicht übernommen (Vorschau)"),
        { lv: m.lv_positionen, tickets: m.offene_tickets, kommentare: m.kommentare },
      ));
    } catch { toast.error(t("Datei konnte nicht gelesen werden")); }
    e.target.value = "";
  };

  const a = versions.find((v) => v.id === aId);
  const b = versions.find((v) => v.id === bId);
  const diff = useMemo(() => {
    if (!a || !b) return [];
    const keys = Object.keys(SNAPSHOT_LABELS);
    return keys.map((k) => ({ key: k, label: SNAPSHOT_LABELS[k], a: a.snapshot?.[k] ?? 0, b: b.snapshot?.[k] ?? 0 }));
  }, [a, b]);

  return (
    <div className={seitenWurzel}>
      <div className="max-w-6xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <History className="w-7 h-7 text-emerald-600" /> {t("Projektstände")}
          </h1>
          <p className="text-slate-600 mt-1">
            {t("Kennzahlen je festgehaltenem Stand – keine Wiederherstellung")}
            {project && <> · <span className="font-medium text-slate-700">{project.name}</span></>}
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Record a stage + history */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-slate-800"><BookmarkPlus className="w-4 h-4" /> {t("Stand festhalten")}</CardTitle></CardHeader>
              <CardContent className="flex gap-2">
                <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("Beschreibung, z. B. Entwurf nach Bauherren-Termin")} />
                <Button onClick={festhalten} disabled={busy || !projectId} className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg shrink-0">
                  <BookmarkPlus className="w-4 h-4 mr-2" /> {t("Stand festhalten")}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-2"><CardTitle className="text-base text-slate-800">{fuellen(t("Verlauf ({n})"), { n: versions.length })}</CardTitle></CardHeader>
              <CardContent className="space-y-0">
                {versions.length === 0 && <p className="text-sm text-slate-400">{t("Noch kein Stand festgehalten. Halten Sie den ersten Stand oben fest.")}</p>}
                <div className="relative">
                  {versions.map((v, i) => (
                    <div key={v.id} className="flex gap-3 pb-4">
                      <div className="flex flex-col items-center">
                        <div className="w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                        {i < versions.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                      </div>
                      <div className="flex-1 -mt-1">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-emerald-100 text-emerald-800">v{v.version}</Badge>
                          <span className="font-medium text-slate-800">{v.message}</span>
                        </div>
                        <div className="text-xs text-slate-400">{v.author === LOKALER_AUTOR ? t(LOKALER_AUTOR) : v.author} · {new Date(v.created_date).toLocaleString("de-DE")}</div>
                        <div className="text-xs text-slate-500 mt-1">{fuellen(t("{lv} LV-Pos. · {tickets} Tickets · Kostenanschlag {eur} €"), {
                          lv: v.snapshot?.lv_positionen ?? 0,
                          tickets: v.snapshot?.offene_tickets ?? 0,
                          eur: (v.snapshot?.kostenanschlag_eur || 0).toLocaleString("de-DE"),
                        })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Compare */}
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-slate-800"><ArrowLeftRight className="w-4 h-4" /> {t("Stände vergleichen")}</CardTitle></CardHeader>
              <CardContent>
                {versions.length < 2 ? <p className="text-sm text-slate-400">{t("Mindestens zwei Stände nötig.")}</p> : (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <Select value={aId} onValueChange={setAId}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>v{v.version} — {v.message}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-slate-400">→</span>
                      <Select value={bId} onValueChange={setBId}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>v{v.version} — {v.message}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-slate-400 border-b"><th className="py-1">{t("Kennzahl")}</th><th className="text-right">v{a?.version}</th><th className="text-right">v{b?.version}</th><th className="text-right">Δ</th></tr></thead>
                      <tbody>
                        {diff.map((r) => {
                          const delta = r.b - r.a;
                          return (
                            <tr key={r.key} className="border-b last:border-0">
                              <td className="py-1.5">{t(r.label)}</td>
                              <td className="text-right tabular-nums text-slate-500">{r.a.toLocaleString("de-DE")}</td>
                              <td className="text-right tabular-nums">{r.b.toLocaleString("de-DE")}</td>
                              <td className={`text-right tabular-nums font-medium ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-300"}`}>
                                {delta > 0 ? "+" : ""}{delta.toLocaleString("de-DE")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Interop */}
          <div className="space-y-4">
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-slate-800"><FileJson className="w-4 h-4" /> {t("Datenaustausch")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start" onClick={exportJson}><Download className="w-4 h-4 mr-2" /> {t("Projektdaten als JSON")}</Button>
                <Button variant="outline" className="w-full justify-start" onClick={exportIfc}><Box className="w-4 h-4 mr-2" /> {t("IFC exportieren (schematisch)")}</Button>
                <label className="block">
                  <input type="file" accept="application/json,.json" className="hidden" onChange={importJson} />
                  <span className="flex items-center justify-start w-full px-3 py-2 rounded-md border text-sm cursor-pointer hover:bg-slate-50"><Upload className="w-4 h-4 mr-2" /> {t("JSON lesen (Vorschau, ohne Übernahme)")}</span>
                </label>
                <p className="text-[11px] text-slate-400 pt-1">{t("Export als JSON oder schematisches IFC. Der JSON-Import liest eine Datei nur zur Vorschau – übernommen wird nichts.")}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
