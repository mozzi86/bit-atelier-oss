import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { bitApi } from "@core/api/bitApi";
import LoadingState from "@core/components/common/LoadingState";
import { useI18n } from "@core/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import {
  Bot, Brain, Workflow, MessageSquare, Eye, Zap, Building, Euro, AlertTriangle,
  Gauge, ClipboardCheck, X, FileDown, Lightbulb, BarChart3, Check, Loader2, Plug,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { exportElementToPdf } from "@core/lib/pdf";
import { pfadText } from "@core/lib/ablage";
import { useProject } from "@core/lib/ProjectContext";
import { statusInfo, hoaiProgress, hoaiPhaseShort, projectArea, fmtArea } from "@core/lib/projectModel";
import { normalisiereProjekte, normalisiereStatus } from "@core/lib/labels";

import AgentChat from "../components/ai/AgentChat";
import WorkflowBuilder from "../components/ai/WorkflowBuilder";
import ProjectAudit from "../components/ai/ProjectAudit";

// Capability tiles (descriptive — no fake numeric stats).
const AI_AGENTS = [
  { id: "architect_advisor", name: "Architektur-Berater", specialty: "Entwurf & Normen", description: "Prüft Entwürfe, Baurecht (GEG/DIN) und schlägt Verbesserungen vor.", icon: Building, color: "text-blue-600", bg: "bg-blue-100" },
  { id: "cost_analyzer", name: "Kosten-Analyst", specialty: "Kostenmanagement", description: "Analysiert Projektkosten, findet Einsparungen und optimiert das Budget.", icon: Euro, color: "text-emerald-600", bg: "bg-emerald-100" },
  { id: "energy_consultant", name: "Energie-Berater", specialty: "Energie & Nachhaltigkeit", description: "Energieeffizienz-Analyse und GEG-/Nachhaltigkeits-Empfehlungen.", icon: Zap, color: "text-amber-600", bg: "bg-amber-100" },
  { id: "bim_validator", name: "BIM-Prüfer", specialty: "BIM-Qualität", description: "Validiert BIM-Modelle, erkennt Kollisionen und sichert Datenqualität.", icon: Eye, color: "text-violet-600", bg: "bg-violet-100" },
  { id: "risk_assessor", name: "Risiko-Analyst", specialty: "Risikomanagement", description: "Identifiziert Projektrisiken und schlägt Gegenmaßnahmen vor.", icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100" },
  { id: "workflow_optimizer", name: "Prozess-Optimierer", specialty: "Automatisierung", description: "Automatisiert Abläufe und steigert die Team-Produktivität.", icon: Workflow, color: "text-teal-600", bg: "bg-teal-100" },
];

const PRIO = {
  critical: "text-rose-600 bg-rose-100",
  high: "text-orange-600 bg-orange-100",
  medium: "text-amber-600 bg-amber-100",
  low: "text-slate-600 bg-slate-100",
};

// Tab keys that ?tab may name — the `v` values of TABS below.
const TAB_SCHLUESSEL = ["analysis", "chat", "workflows", "agents", "connections"];

export default function AIDashboard() {
  const { projectId } = useProject();
  const { t } = useI18n();
  // 72-10 (N-05): the tab lives in ?tab, so the shell's AI button can open
  // "KI-Chat" directly (#/AIDashboard?tab=chat) and a reload keeps the tab.
  // Unknown values fall back to the analysis. Inline on purpose: after the
  // merge switch to useTabParam from @core (lane B, N-16).
  const [suchParams, setSuchParams] = useSearchParams();
  const tabAusUrl = suchParams.get("tab");
  const activeTab = TAB_SCHLUESSEL.includes(tabAusUrl) ? tabAusUrl : "analysis";
  const setActiveTab = useCallback((tab) => {
    setSuchParams((vorher) => {
      const naechste = new URLSearchParams(vorher);
      naechste.set("tab", tab);
      return naechste;
    }, { replace: true });
  }, [setSuchParams]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [metrics, setMetrics] = useState({ projects: 0, openIssues: 0, modules: AI_AGENTS.length, avgProgress: 0 });
  const [activities, setActivities] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [openIssuesList, setOpenIssuesList] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [creatingTask, setCreatingTask] = useState(null);
  const [createdTasks, setCreatedTasks] = useState(() => new Set());
  const analysisRef = useRef(null);
  // 72-10 (STATES-08): load state of the key figures. Before, the page showed
  // zeros and "alle Kennzahlen im grünen Bereich" while (or instead of) loading.
  const [laedt, setLaedt] = useState(true);
  const [ladeFehler, setLadeFehler] = useState(/** @type {string|null} */ (null));
  const bereit = !laedt && !ladeFehler;

  const ladeKennzahlen = useCallback(async () => {
    setLaedt(true);
    setLadeFehler(null);
    try {
      const [rawProjects, issues] = await Promise.all([
        bitApi.entities.Project.list("-updated_date"),
        bitApi.entities.Issue.list("-updated_date"),
      ]);
      // 72-01 A-7: Seed-Labels („LP 5 - …") und neue Keys auf eine Wertebasis
      // bringen — hoaiProgress/statusInfo zählen sonst Mischformen.
      const projects = normalisiereProjekte(rawProjects);
      const open = issues.filter((i) => i.status !== "resolved" && i.status !== "closed");
      const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
      const avg = projects.length ? Math.round(projects.reduce((s, p) => s + hoaiProgress(p), 0) / projects.length) : 0;
      setMetrics({ projects: projects.length, openIssues: open.length, modules: AI_AGENTS.length, avgProgress: avg });
      setAllProjects(projects);
      setOpenIssuesList(open);
      setActivities(
        open.slice(0, 5).map((i) => ({
          id: i.id, title: i.title, priority: i.priority,
          project: byId[i.project_id]?.name || "—", assignee: i.assignee,
        }))
      );
    } catch (err) {
      setLadeFehler(String(err?.message || err));
    } finally {
      setLaedt(false);
    }
  }, []);

  useEffect(() => { ladeKennzahlen(); }, [ladeKennzahlen]);

  // Open ticket count per project (for the comparison table).
  const openByProject = useMemo(() => {
    const map = {};
    for (const i of openIssuesList) map[i.project_id] = (map[i.project_id] || 0) + 1;
    return map;
  }, [openIssuesList]);

  // Rule-based measures derived from the loaded portfolio metrics.
  const massnahmen = useMemo(() => {
    const list = [];
    if (metrics.openIssues > 0) {
      list.push({ id: "open_issues", title: `Offene Tickets reduzieren (${metrics.openIssues} offen)`, detail: "BIM-Tickets sichten, priorisieren und abarbeiten." });
    }
    const critical = openIssuesList.filter((i) => i.priority === "critical" || i.priority === "high").length;
    if (critical > 0) {
      list.push({ id: "critical_issues", title: `Kritische Tickets priorisieren (${critical} hoch/kritisch)`, detail: "Hoch priorisierte BIM-Themen zuerst klären." });
    }
    if (allProjects.length > 0 && metrics.avgProgress < 50) {
      list.push({ id: "progress", title: `Planungsfortschritt erhöhen (Ø ${metrics.avgProgress}%)`, detail: "HOAI-Leistungsphasen der Projekte vorantreiben." });
    }
    const noArea = allProjects.filter((p) => !projectArea(p)).length;
    if (noArea > 0) {
      list.push({ id: "missing_area", title: `Projektdaten vervollständigen (${noArea} ${noArea === 1 ? "Projekt" : "Projekte"} ohne Fläche)`, detail: "Flächenangaben in den Projektstammdaten ergänzen." });
    }
    const overdue = allProjects.filter((p) => p.completion_date && new Date(p.completion_date).getTime() < Date.now() && !["completed", "operation"].includes(normalisiereStatus(p.status))).length;
    if (overdue > 0) {
      list.push({ id: "overdue", title: `Terminplan prüfen (${overdue} ${overdue === 1 ? "Projekt" : "Projekte"} über Fertigstellungstermin)`, detail: "Fertigstellungstermine aktualisieren oder Maßnahmen einleiten." });
    }
    return list;
  }, [metrics, allProjects, openIssuesList]);

  const handleExportPdf = async () => {
    if (!analysisRef.current) return;
    setExporting(true);
    try {
      const r = await exportElementToPdf(analysisRef.current, "KI-Analyse.pdf", {
        ablage: { projectId, typ: "Bericht", notiz: "Projekt-Analyse der KI-Zentrale" },
      });
      if (r?.abgelegt) toast.success(`Analyse abgelegt: ${pfadText(r.pfad)}`);
      toast.success("PDF exportiert");
    } catch (e) {
      toast.error("PDF-Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  };

  const handleCreateTask = async (m) => {
    if (!projectId || createdTasks.has(m.id)) return;
    setCreatingTask(m.id);
    try {
      await bitApi.entities.Issue.create({
        project_id: projectId,
        title: m.title,
        description: "Aus KI-Zentrale übernommen",
        priority: "medium",
        status: "open",
        assignee: "KI-Zentrale",
      });
      setCreatedTasks((prev) => new Set(prev).add(m.id));
      toast.success("Aufgabe angelegt");
    } catch (e) {
      toast.error("Aufgabe konnte nicht angelegt werden");
    } finally {
      setCreatingTask(null);
    }
  };

  const TABS = [
    { v: "analysis", icon: ClipboardCheck, label: "Projekt-Analyse" },
    { v: "chat", icon: MessageSquare, label: "KI-Chat" },
    { v: "workflows", icon: Workflow, label: "Workflows" },
    { v: "agents", icon: Bot, label: "KI-Module" },
    { v: "connections", icon: Plug, label: "Verbindungen" },
  ];

  const MET = [
    { icon: Building, label: "Projekte", value: metrics.projects, color: "text-blue-600", tint: "bg-blue-100" },
    { icon: AlertTriangle, label: "Offene BIM-Tickets", value: metrics.openIssues, color: "text-rose-600", tint: "bg-rose-100" },
    { icon: Bot, label: "KI-Module aktiv", value: metrics.modules, color: "text-emerald-600", tint: "bg-emerald-100" },
    { icon: Gauge, label: "Ø Planungsfortschritt", value: `${metrics.avgProgress}%`, color: "text-teal-600", tint: "bg-teal-100" },
  ];

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl shadow-lg"><Brain className="w-7 h-7 text-white" /></div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">KI-Zentrale</h1>
            <p className="text-slate-600 mt-1">Projekte ganzheitlich bewerten, Daten analysieren und Abläufe automatisieren</p>
          </div>
        </motion.div>

        {/* Real metrics — only once they are loaded; a failed load says so. */}
        {laedt && (
          <div role="status">
            <span className="sr-only">{t("Kennzahlen werden geladen …")}</span>
            <LoadingState variant="list" rows={2} />
          </div>
        )}
        {ladeFehler && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 break-words">
              <span className="font-semibold">{t("Die Kennzahlen konnten nicht geladen werden.")}</span>{" "}
              {t("Meldung:")} {ladeFehler}
            </p>
            <button
              type="button"
              onClick={ladeKennzahlen}
              className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-800 hover:bg-rose-100 transition-colors"
            >
              {t("Erneut versuchen")}
            </button>
          </div>
        )}
        {bereit && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {MET.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="border-0 shadow-sm bg-white hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5 flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${m.tint} shrink-0`}><m.icon className={`w-5 h-5 ${m.color}`} /></div>
                  <div><div className="text-2xl font-bold leading-none text-slate-800">{m.value}</div><div className="text-xs text-slate-500 mt-1">{m.label}</div></div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
        )}

        {/* Main */}
        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardContent className="p-4 md:p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab.v} value={tab.v} className="flex items-center gap-2">
                    <tab.icon className="w-4 h-4" /> {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="analysis" className="pt-5">
                <div className="flex justify-end mb-4">
                  <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={exporting}>
                    {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
                    {exporting ? "Exportiere..." : "Analyse als PDF"}
                  </Button>
                </div>

                <div ref={analysisRef} className="bg-white rounded-xl space-y-6 p-1">
                  {/* Kompakte Kennzahlen (auch für den PDF-Export) */}
                  {bereit && (
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600 px-1">
                    <span><span className="font-semibold text-slate-800">{metrics.projects}</span> Projekte</span>
                    <span><span className="font-semibold text-slate-800">{metrics.openIssues}</span> offene Tickets</span>
                    <span>Ø Planungsfortschritt <span className="font-semibold text-slate-800">{metrics.avgProgress}%</span></span>
                  </div>
                  )}

                  {/* (A) Projektvergleich */}
                  <Card className="border border-slate-100 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-emerald-600" /> Projektvergleich
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {laedt ? (
                        <LoadingState variant="list" rows={3} />
                      ) : ladeFehler ? (
                        <p className="text-sm text-slate-400">{t("Nicht verfügbar – die Kennzahlen konnten nicht geladen werden.")}</p>
                      ) : allProjects.length === 0 ? (
                        <p className="text-sm text-slate-400">Keine Projekte vorhanden.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                                <th className="py-2 pr-3 font-medium">Projekt</th>
                                <th className="py-2 pr-3 font-medium">Status</th>
                                <th className="py-2 pr-3 font-medium">HOAI-Fortschritt</th>
                                <th className="py-2 pr-3 font-medium text-right">Fläche</th>
                                <th className="py-2 pr-3 font-medium text-right">Offene Tickets</th>
                                <th className="py-2 font-medium text-right">Fertigstellung</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allProjects.map((p) => {
                                const si = statusInfo(p.status);
                                const area = projectArea(p);
                                const isCurrent = p.id === projectId;
                                return (
                                  <tr key={p.id} className={`border-b border-slate-100 last:border-0 ${isCurrent ? "bg-emerald-50" : ""}`}>
                                    <td className="py-2 pr-3 font-medium text-slate-800">
                                      {p.name}
                                      {isCurrent && <Badge variant="outline" className="ml-2 text-[10px] border-emerald-300 text-emerald-700">Aktuell</Badge>}
                                    </td>
                                    <td className="py-2 pr-3"><Badge className={`${si.color} border-0 font-normal`}>{si.label}</Badge></td>
                                    <td className="py-2 pr-3 text-slate-600">{hoaiPhaseShort(p)} · {hoaiProgress(p)}%</td>
                                    <td className="py-2 pr-3 text-right text-slate-600">{area ? fmtArea(area) : "—"}</td>
                                    <td className="py-2 pr-3 text-right text-slate-600">{openByProject[p.id] || 0}</td>
                                    <td className="py-2 text-right text-slate-600">{p.completion_date ? new Date(p.completion_date).getFullYear() : "—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* (C) Empfohlene Maßnahmen */}
                  <Card className="border border-slate-100 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-amber-500" /> Empfohlene Maßnahmen
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {!projectId && (
                        <p className="text-xs text-slate-400">Kein Projekt gewählt — bitte oben ein aktuelles Projekt auswählen, um Maßnahmen als Aufgaben zu übernehmen.</p>
                      )}
                      {/* The all-clear only after a successful load — while loading
                          or after an error the list is empty for another reason. */}
                      {bereit && massnahmen.length === 0 && (
                        <p className="text-sm text-slate-400">Keine Maßnahmen — alle Kennzahlen im grünen Bereich.</p>
                      )}
                      {laedt && <LoadingState variant="list" rows={2} />}
                      {ladeFehler && (
                        <p className="text-sm text-slate-400">{t("Nicht verfügbar – die Kennzahlen konnten nicht geladen werden.")}</p>
                      )}
                      {massnahmen.map((m) => {
                        const done = createdTasks.has(m.id);
                        return (
                          <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800">{m.title}</p>
                              <p className="text-xs text-slate-500">{m.detail}</p>
                            </div>
                            <Button
                              variant={done ? "ghost" : "outline"}
                              size="sm"
                              className="shrink-0"
                              disabled={!projectId || done || creatingTask === m.id}
                              onClick={() => handleCreateTask(m)}
                            >
                              {creatingTask === m.id ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              ) : done ? (
                                <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                              ) : null}
                              {done ? "Übernommen" : "Als Aufgabe übernehmen"}
                            </Button>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>

                  {/* Bestehende KI-Projektanalyse */}
                  <ProjectAudit />
                </div>
              </TabsContent>

              <TabsContent value="chat" className="pt-5">
                <AgentChat agents={AI_AGENTS} />
              </TabsContent>

              <TabsContent value="workflows" className="pt-5">
                <WorkflowBuilder agents={AI_AGENTS} />
              </TabsContent>

              <TabsContent value="agents" className="pt-5">
                <div className="grid lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Verfügbare KI-Module</h2>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {AI_AGENTS.map((a) => (
                        <motion.div key={a.id} whileHover={{ scale: 1.02 }}>
                          <Card className="border-0 shadow-md hover:shadow-lg transition-all cursor-pointer h-full" onClick={() => setSelectedAgent(a)}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3 mb-2">
                                <div className={`p-2.5 rounded-xl ${a.bg}`}><a.icon className={`w-5 h-5 ${a.color}`} /></div>
                                <div className="min-w-0">
                                  <h3 className="font-semibold text-slate-800 truncate">{a.name}</h3>
                                  <p className="text-xs text-slate-500 truncate">{a.specialty}</p>
                                </div>
                              </div>
                              <p className="text-sm text-slate-600">{a.description}</p>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Real recent activity from open tickets */}
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Aktuelle Themen</h2>
                    <div className="space-y-3">
                      {bereit && activities.length === 0 && <p className="text-sm text-slate-400">Keine offenen Tickets.</p>}
                      {activities.map((a) => (
                        <Card key={a.id} className="border-0 shadow-sm">
                          <CardContent className="p-3">
                            <div className="flex items-start gap-2">
                              <div className={`p-1.5 rounded-lg ${PRIO[a.priority] || PRIO.low}`}><AlertTriangle className="w-3.5 h-3.5" /></div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800">{a.title}</p>
                                <div className="flex items-center justify-between mt-1">
                                  <Badge variant="outline" className="text-[10px]">{a.project}</Badge>
                                  <span className="text-[11px] text-slate-400">{a.assignee || ""}</span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="connections" className="pt-5">
                {/* 80-03 (D-P80-12): der Editor zog nach Einstellungen › KI-Verbindungen
                    um (kein zweiter Editor, CLAUDE.md) — dieser Reiter-Schlüssel bleibt
                    gültig, damit alte Links/der KI-Assistent-Knopf weiter funktionieren.
                    Native <div> statt <Card>/<CardContent>: die shadcn-Wrapper kosten je
                    Element einen tsc-Fehler (79-01 Abweichung 3), ein neuer Block hier
                    vermeidet das statt ihn hinzunehmen. */}
                <div className="rounded-xl border-0 bg-white p-6 shadow-sm flex flex-col items-start gap-3">
                  <p className="text-sm text-slate-600">{t("KI-Verbindungen verwalten Sie jetzt in den Einstellungen.")}</p>
                  <Link to="/Settings?tab=ai"
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
                    <Plug className="w-4 h-4" aria-hidden="true" /> {t("Zu den KI-Verbindungen")}
                  </Link>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Agent detail modal */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setSelectedAgent(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setSelectedAgent(null); }}>
          <motion.div role="dialog" aria-modal="true" aria-label={selectedAgent.name || "Agent-Details"}
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${selectedAgent.bg}`}><selectedAgent.icon className={`w-7 h-7 ${selectedAgent.color}`} /></div>
                <div><h2 className="text-xl font-bold">{selectedAgent.name}</h2><p className="text-slate-600">{selectedAgent.specialty}</p></div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Dialog schliessen" onClick={() => setSelectedAgent(null)}><X className="w-4 h-4" /></Button>
            </div>
            <p className="text-slate-600 mb-5">{selectedAgent.description}</p>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={() => { setSelectedAgent(null); setActiveTab("analysis"); }}>
                <ClipboardCheck className="w-4 h-4 mr-2" /> Projekt analysieren
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => { setSelectedAgent(null); setActiveTab("chat"); }}>
                <MessageSquare className="w-4 h-4 mr-2" /> Im Chat fragen
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
