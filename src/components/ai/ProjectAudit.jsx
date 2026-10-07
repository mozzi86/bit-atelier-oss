import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import {
  Brain, Loader2, Sparkles, AlertTriangle, Euro, Zap, CalendarClock, Boxes, Lightbulb, Gauge,
} from "lucide-react";
import { InvokeLLM } from "@core/integrations/Core";
import { gp, eur0 } from "@ava/components/avaUtils";
import { hoaiProgress, projectArea } from "@core/lib/projectModel";
import { useProject } from "@core/lib/ProjectContext";

const SEVERITY = {
  hoch: { label: "Hoch", color: "bg-rose-100 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  mittel: { label: "Mittel", color: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  niedrig: { label: "Niedrig", color: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};
const sev = (s) => SEVERITY[String(s).toLowerCase()] || SEVERITY.niedrig;
const scoreColor = (n) => (n >= 75 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
const scoreRing = (n) => (n >= 75 ? "#10b981" : n >= 50 ? "#f59e0b" : "#ef4444");

const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    overall_score: { type: "number", description: "Gesamtbewertung 0-100" },
    summary: { type: "string", description: "2-3 Sätze Management-Zusammenfassung" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          score: { type: "number" },
          status: { type: "string", description: "gut | mittel | kritisch" },
          comment: { type: "string" },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string" },
          severity: { type: "string", description: "hoch | mittel | niedrig" },
          title: { type: "string" },
          detail: { type: "string" },
          recommendation: { type: "string" },
          saving_eur: { type: "number" },
        },
      },
    },
    total_saving_potential_eur: { type: "number" },
  },
};

// Holistic AI project audit: gathers all project data and asks the LLM to score
// every dimension and propose concrete optimisation potential.
export default function ProjectAudit() {
  const { projectId, project } = useProject();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [facts, setFacts] = useState(null);
  const [error, setError] = useState("");

  // Reset the analysis when the global project changes.
  useEffect(() => { setResult(null); setFacts(null); setError(""); }, [projectId]);

  // Gather the hard facts for the selected project (also shown as KPI chips).
  const gatherFacts = async (pid) => {
    const [energy, issues, lv, tenders, bids, tasks] = await Promise.all([
      bitApi.entities.EnergyScenario.filter({ project_id: pid }),
      bitApi.entities.Issue.filter({ project_id: pid }),
      bitApi.entities.LVPosition.filter({ project_id: pid }),
      bitApi.entities.Tender.filter({ project_id: pid }),
      bitApi.entities.Bid.filter({ project_id: pid }),
      bitApi.entities.ScheduleTask.filter({ project_id: pid }),
    ]);
    const estimate = lv.reduce((s, p) => s + gp(p), 0);
    const openIssues = issues.filter((i) => i.status !== "resolved" && i.status !== "closed");
    const critical = openIssues.filter((i) => i.priority === "critical" || i.priority === "high");
    const es = energy[0];
    const now = Date.now();
    const overdue = tasks.filter((t) => t.end_date && new Date(t.end_date).getTime() < now && (t.progress || 0) < 100);
    return {
      project, energy: es, issues, openIssues, critical, lv, tenders, bids, tasks, overdue,
      estimate,
      progress: hoaiProgress(project),
      area: projectArea(project),
    };
  };

  const run = async () => {
    if (!projectId) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const f = await gatherFacts(projectId);
      setFacts(f);
      const ctx = {
        projekt: f.project?.name,
        auftraggeber: f.project?.client,
        status: f.project?.status,
        hoai_phase: f.project?.hoai_phase,
        flaeche_m2: f.area,
        energieziel: f.project?.energy_target,
        nachhaltigkeit: f.project?.sustainability_rating,
        fertigstellung: f.project?.completion_date,
        kostenanschlag_eur: Math.round(f.estimate),
        lv_positionen: f.lv.length,
        ausschreibungen: f.tenders.length,
        angebote: f.bids.length,
        offene_tickets: f.openIssues.length,
        kritische_tickets: f.critical.length,
        bim_themen: f.openIssues.slice(0, 8).map((i) => `${i.priority}: ${i.title}`),
        vorgaenge: f.tasks.length,
        ueberfaellige_vorgaenge: f.overdue.length,
        geg: f.energy?.geg_compliance
          ? { besteht: f.energy.geg_compliance.passes_geg, faktor: f.energy.geg_compliance.compliance_factor }
          : null,
      };
      const prompt =
        `Du bist ein erfahrener Bau- und Projektcontrolling-Experte (HOAI, GEG, DIN 276, BIM). ` +
        `Analysiere dieses Bauprojekt ganzheitlich anhand der folgenden harten Projektdaten und bewerte ` +
        `jede Dimension (Kosten, Energie/GEG, Termine, BIM-Qualität, Nachhaltigkeit) von 0-100. ` +
        `Nenne konkrete, umsetzbare Optimierungspotenziale mit geschätztem Einsparpotenzial in Euro. ` +
        `Antworte auf Deutsch.\n\nProjektdaten:\n${JSON.stringify(ctx, null, 2)}`;
      const res = await InvokeLLM({ prompt, response_json_schema: AUDIT_SCHEMA, add_context_from_internet: false });
      const obj = typeof res === "string" ? JSON.parse(res) : res;
      setResult(obj);
    } catch (e) {
      setError("Analyse fehlgeschlagen. Prüfe den LLM-Proxy oder versuche es erneut.");
    }
    setLoading(false);
  };

  const overall = result?.overall_score ?? 0;
  const dims = result?.dimensions || [];
  const findings = useMemo(
    () => (result?.findings || []).slice().sort((a, b) => {
      const order = { hoch: 0, mittel: 1, niedrig: 2 };
      return (order[String(a.severity).toLowerCase()] ?? 3) - (order[String(b.severity).toLowerCase()] ?? 3);
    }),
    [result]
  );

  return (
    <div className="space-y-5">
      {/* Controls */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-slate-500">Projekt für die KI-Analyse</div>
            <div className="text-lg font-semibold text-slate-800">{project?.name || "— oben Projekt wählen —"}</div>
          </div>
          <Button onClick={run} disabled={loading || !projectId} className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {loading ? "KI analysiert…" : "Projekt analysieren"}
          </Button>
        </CardContent>
      </Card>

      {/* Hard-fact KPI chips (shown after gathering) */}
      {facts && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { icon: Euro, label: "Kostenanschlag", value: eur0(facts.estimate), tint: "bg-blue-100 text-blue-700" },
            { icon: Boxes, label: "LV-Positionen", value: facts.lv.length, tint: "bg-violet-100 text-violet-700" },
            { icon: AlertTriangle, label: "Offene Tickets", value: facts.openIssues.length, tint: "bg-amber-100 text-amber-700" },
            { icon: AlertTriangle, label: "Kritisch/Hoch", value: facts.critical.length, tint: "bg-rose-100 text-rose-700" },
            { icon: CalendarClock, label: "Überfällig", value: facts.overdue.length, tint: "bg-rose-100 text-rose-700" },
            { icon: Zap, label: "GEG", value: facts.energy?.geg_compliance ? (facts.energy.geg_compliance.passes_geg ? "✓" : "✗") : "—", tint: "bg-emerald-100 text-emerald-700" },
          ].map((k, i) => (
            <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3 flex items-center gap-2">
              <div className={`p-2 rounded-lg ${k.tint}`}><k.icon className="w-4 h-4" /></div>
              <div className="min-w-0"><div className="text-lg font-bold text-slate-800 leading-none">{k.value}</div><div className="text-[11px] text-slate-500 truncate">{k.label}</div></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {error && <Card><CardContent className="p-4 text-rose-600 text-sm">{error}</CardContent></Card>}

      {!result && !loading && !error && (
        <Card><CardContent className="p-10 text-center text-slate-400">
          <Brain className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          Wähle ein Projekt und starte die ganzheitliche KI-Bewertung — Kosten, Energie/GEG, Termine, BIM-Qualität und Nachhaltigkeit inkl. konkreter Optimierungspotenziale.
        </CardContent></Card>
      )}

      {result && (
        <>
          {/* Score + summary + dimensions */}
          <div className="grid lg:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 36 36" className="w-32 h-32 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={scoreRing(overall)} strokeWidth="3"
                      strokeDasharray={`${overall} 100`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-3xl font-bold ${scoreColor(overall)}`}>{Math.round(overall)}</span>
                    <span className="text-xs text-slate-400">/ 100</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700"><Gauge className="w-4 h-4" /> Gesamtbewertung</div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4 text-emerald-600" /> Zusammenfassung</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{result.summary}</p>
                <div className="space-y-2">
                  {dims.map((d, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700">{d.label}</span>
                        <span className={scoreColor(d.score)}>{Math.round(d.score)}{d.status ? ` · ${d.status}` : ""}</span>
                      </div>
                      <Progress value={d.score} className="h-2" />
                      {d.comment && <p className="text-[11px] text-slate-400 mt-0.5">{d.comment}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Optimisation potential */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" /> Optimierungspotenziale ({findings.length})</CardTitle>
                {result.total_saving_potential_eur > 0 && (
                  <Badge className="bg-emerald-100 text-emerald-800">Einsparpotenzial ges. {eur0(result.total_saving_potential_eur)}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {findings.length === 0 && <p className="text-sm text-slate-400">Keine Auffälligkeiten.</p>}
              {findings.map((f, i) => {
                const s = sev(f.severity);
                return (
                  <div key={i} className={`rounded-lg border p-3 ${s.color}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                        <span className="font-semibold text-slate-800">{f.title}</span>
                        {f.dimension && <Badge variant="outline" className="text-[10px]">{f.dimension}</Badge>}
                      </div>
                      {f.saving_eur > 0 && <span className="text-sm font-semibold text-emerald-700 whitespace-nowrap">{eur0(f.saving_eur)}</span>}
                    </div>
                    {f.detail && <p className="text-sm text-slate-600 mt-1">{f.detail}</p>}
                    {f.recommendation && (
                      <p className="text-sm text-slate-700 mt-1.5 flex gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                        <span><span className="font-medium">Empfehlung:</span> {f.recommendation}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
