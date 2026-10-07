import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { Link } from "react-router-dom";
import { createPageUrl } from "@core/utils";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
} from "recharts";
import {
  Building2, Plus, ArrowRight, Hammer, CheckCircle2, Ruler, CalendarClock,
  Boxes, FileSpreadsheet, MapPin, FileText, PencilRuler, ShieldCheck, Ticket,
  TriangleAlert,
} from "lucide-react";
import {
  PROJECT_STATUS, statusInfo, hoaiProgress, hoaiPhaseShort, projectHealth,
  projectArea, fmtArea, fmtDate, fmtCity,
} from "@core/lib/projectModel";
import { useProject } from "@core/lib/ProjectContext";
import { normalisiereProjekte, normalisiereStatus } from "@core/lib/labels";
import EmptyState from "@core/components/common/EmptyState";
import LoadingState from "@core/components/common/LoadingState";
import { useI18n } from "@core/lib/i18n";
import AktivesProjekt from "../components/projects/AktivesProjekt";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useAuth } from "@core/lib/AuthContext";
import { personalZugang } from "@/lib/people/zugang.js";

// 80-10 Task 7: React.lazy statt eines statischen Imports, damit der
// Personal-Chunk nur lädt, wenn personalZugang === 'erlaubt' unten wirklich
// rendert — ein Mitglied ohne Zugang bekommt kein Byte Personal-Code.
const PersonalZaehlkarte = React.lazy(() => import("@/components/people/PersonalZaehlkarte.jsx"));

/** Fills {key} placeholders after translation, so the dictionary key keeps them. */
const fuellen = (text, werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

/**
 * KPI tile.
 * @param {{ icon: any, label: string, value: any, sub?: string, tint: string }} props
 *   value = the big number (already formatted), sub = optional suffix after the label
 */
const Kpi = ({ icon: Icon, label, value, sub, tint }) => (
  <Card className="border-0 shadow-sm">
    <CardContent className="p-4 flex items-center gap-3">
      <div className={`p-2.5 rounded-xl ${tint}`}><Icon className="w-5 h-5" /></div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-800 leading-tight">{value}</div>
        <div className="text-xs text-slate-500 truncate">{label}{sub ? ` · ${sub}` : ""}</div>
      </div>
    </CardContent>
  </Card>
);

// Per-project shortcuts to the five core modules (72-09, FINDINGS-BACKLOG-03):
// no Labor module and no redirecting placeholder route (EnergyAnalysis) any more.
const MODULES = [
  { to: "ComplexDesigner", icon: PencilRuler, label: "Entwurf" },
  { to: "ModelCheck", icon: ShieldCheck, label: "Prüfen" },
  { to: "AVA", icon: FileSpreadsheet, label: "AVA" },
  { to: "BimViewer", icon: Ticket, label: "Tickets" },
  { to: "Reports", icon: FileText, label: "Bericht" },
];

function ProjectCard({ project, delay, onPick }) {
  const { t } = useI18n();
  const st = statusInfo(project.status);
  const health = projectHealth(project);
  const progress = hoaiProgress(project);
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                <h3 className="font-semibold text-slate-800 truncate">{project.name}</h3>
              </div>
              <p className="text-sm text-slate-500 truncate">{project.client}</p>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {fmtCity(project)}</p>
            </div>
            <Badge className={`${health.color} shrink-0`}>
              <span className={`w-1.5 h-1.5 rounded-full ${health.dot} mr-1.5`} />{t(health.label)}
            </Badge>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>{t("Planungsfortschritt")} · {hoaiPhaseShort(project)}</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" aria-label={fuellen(t("Planungsfortschritt {name}"), { name: project.name })} />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 py-2">
              <div className="text-[11px] text-slate-400">{t("Status")}</div>
              <div className="text-xs font-semibold text-slate-700">{t(st.label)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 py-2">
              <div className="text-[11px] text-slate-400">{t("Fläche")}</div>
              {/* 72-09: German number format in m² instead of "18.5k m²" (English decimal point). */}
              <div className="text-xs font-semibold text-slate-700">{projectArea(project) > 0 ? fmtArea(projectArea(project)) : "—"}</div>
            </div>
            <div className="rounded-lg bg-slate-50 py-2">
              <div className="text-[11px] text-slate-400">{t("Fertig")}</div>
              <div className="text-xs font-semibold text-slate-700">{project.completion_date ? new Date(project.completion_date).getFullYear() : "—"}</div>
            </div>
          </div>

          {(project.energy_target || project.sustainability_rating) && (
            <div className="flex flex-wrap gap-1">
              {project.energy_target && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">{project.energy_target}</Badge>}
              {project.sustainability_rating && <Badge variant="outline" className="text-[10px] border-teal-200 text-teal-700">{project.sustainability_rating}</Badge>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1 pt-1 border-t">
            {/* 72-09 (A11Y-I18N-15): the link IS the button (asChild) - one tab stop,
                valid HTML, announced once as a link. */}
            {MODULES.map((m) => (
              <Button key={m.to} asChild variant="ghost" size="sm" className="flex-1 flex-col h-auto px-1 py-1.5 gap-0.5 text-slate-500 hover:text-slate-900">
                <Link
                  to={createPageUrl(m.to)}
                  onClick={() => onPick?.(project.id)}
                  aria-label={fuellen(t("{modul} für {name}"), { modul: t(m.label), name: project.name })}
                >
                  <m.icon className="w-4 h-4" aria-hidden="true" />
                  <span className="text-[10px]">{t(m.label)}</span>
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { setProjectId } = useProject();
  const { user } = useAuth();
  // 80-10 Task 7: nur die Zugangsfrage — die Zählkarte selbst entscheidet, ob
  // sie wirklich etwas zeigt (Setting, fällige Fristen).
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ladeFehler, setLadeFehler] = useState("");
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    let aktiv = true;
    (async () => {
      setIsLoading(true);
      setLadeFehler("");
      // 72-09 (STATES-05): a failed load used to leave the skeletons up forever.
      try {
        // 72-01 A-7: Seed-Labels und neue Keys auf eine Wertebasis bringen —
        // sonst zählen Donut/KPIs das neue Projekt nicht mit (Befund N-07).
        const data = normalisiereProjekte(await bitApi.entities.Project.list("-updated_date"));
        if (aktiv) setProjects(data);
      } catch (err) {
        if (aktiv) setLadeFehler(String(err?.message || err));
      } finally {
        if (aktiv) setIsLoading(false);
      }
    })();
    return () => { aktiv = false; };
  }, [versuch]);

  const total = projects.length;
  const statusVon = (p) => normalisiereStatus(p.status);
  const inBau = projects.filter((p) => statusVon(p) === "construction").length;
  const inPlanung = projects.filter((p) => ["concept", "design", "design_development", "technical_design", "feasibility"].includes(statusVon(p))).length;
  const fertig = projects.filter((p) => ["completed", "operation"].includes(statusVon(p))).length;
  const flaeche = projects.reduce((s, p) => s + projectArea(p), 0);
  const faellig = projects.filter((p) => {
    const d = p.completion_date ? (new Date(p.completion_date) - Date.now()) / 864e5 : null;
    return d != null && d >= 0 && d < 180 && statusVon(p) !== "completed";
  }).length;

  const statusData = Object.keys(PROJECT_STATUS)
    .map((k) => ({ key: k, name: PROJECT_STATUS[k].label, value: projects.filter((p) => statusVon(p) === k).length, color: PROJECT_STATUS[k].ring }))
    .filter((d) => d.value > 0);

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            {/* h1 stays "Projektübersicht": menu name (navigation.js) and cloud-smoke.spec.js:62. */}
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">{t("Projektübersicht")}</h1>
            <p className="text-slate-600 mt-1">{t("Portfolio – alle Projekte")}</p>
          </div>
          {/* 72-01 A-9 (Befund N-13): direkt das Formular öffnen — der Button
              führte vorher nur auf die Projektliste ohne Aktion. */}
          <Button asChild className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
            <Link to={`${createPageUrl("Projects")}?neu=1`}>
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> {t("Neues Projekt")}
            </Link>
          </Button>
        </motion.div>

        {/* 72-09 (LINKING-13): the active project and its next step come first,
            the portfolio below. */}
        <AktivesProjekt />

        {/* KPI strip (real numbers) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi icon={Building2} label={t("Projekte gesamt")} value={total} tint="bg-slate-100 text-slate-700" />
          <Kpi icon={Hammer} label={t("Im Bau")} value={inBau} tint="bg-amber-100 text-amber-700" />
          <Kpi icon={Ruler} label={t("In Planung")} value={inPlanung} tint="bg-blue-100 text-blue-700" />
          <Kpi icon={CheckCircle2} label={t("Fertig")} value={fertig} tint="bg-emerald-100 text-emerald-700" />
          {/* 72-09: full German number instead of "61.2k"; the unit leads the label so the tile's truncation cannot hide it. */}
          <Kpi icon={Boxes} label={t("m² gesamt")} value={Math.round(flaeche).toLocaleString("de-DE")} tint="bg-violet-100 text-violet-700" />
          <Kpi icon={CalendarClock} label={t("Fällig <6 Mon.")} value={faellig} tint="bg-rose-100 text-rose-700" />
        </div>

        {/* 80-10 Task 7 (D-P80-24): In-App-Erinnerung, kein Push/Mail. Eigener
            Chunk, geladen nur mit Personal-Zugang. */}
        {zugang === "erlaubt" && (
          <React.Suspense fallback={null}>
            <PersonalZaehlkarte personalZugang={zugang} />
          </React.Suspense>
        )}

        <div className="grid lg:grid-cols-4 gap-6">
          {/* Project cards */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">{t("Projekte")}</h2>
              <Link to={createPageUrl("Projects")} className="text-sm text-emerald-700 hover:underline flex items-center gap-1">
                {t("Alle verwalten")} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
            {isLoading ? (
              <LoadingState variant="cards" rows={6} className="grid-cols-1" />
            ) : ladeFehler ? (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex flex-wrap items-center gap-3">
                <TriangleAlert aria-hidden="true" className="w-4 h-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  {fuellen(t("Die Projekte konnten nicht geladen werden: {fehler}"), { fehler: ladeFehler })}
                </span>
                <button
                  type="button"
                  onClick={() => setVersuch((v) => v + 1)}
                  className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium text-rose-800 hover:bg-rose-100"
                >
                  {t("Erneut versuchen")}
                </button>
              </div>
            ) : total === 0 ? (
              <EmptyState
                icon={Building2}
                title={t("Noch keine Projekte")}
                description={t("Legen Sie das erste Projekt an, um es hier in der Übersicht zu sehen.")}
                action={(
                  <Button asChild className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
                    <Link to={`${createPageUrl("Projects")}?neu=1`}>
                      <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> {t("Neues Projekt")}
                    </Link>
                  </Button>
                )}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {projects.map((p, i) => <ProjectCard key={p.id} project={p} delay={i * 0.05} onPick={setProjectId} />)}
              </div>
            )}
          </div>

          {/* Side: status donut + legend */}
          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-800 mb-3">{t("Portfolio-Status")}</h3>
                {statusData.length > 0 ? (
                  <>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                            {statusData.map((d) => <Cell key={d.key} fill={d.color} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {statusData.map((d) => (
                        <div key={d.key} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} /> {d.name}</span>
                          <span className="font-semibold text-slate-700">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <p className="text-sm text-slate-400">{t("Keine Daten.")}</p>}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold">{t("Schnellzugriff")}</h3>
                {[
                  { to: "AIDashboard", label: "KI-Analyse starten" },
                  { to: "AVA", label: "Ausschreibung / Kosten" },
                  { to: "ComplexDesigner", label: "Komplex-Designer" },
                ].map((q) => (
                  <Button key={q.to} asChild variant="secondary" className="flex w-full h-auto min-h-10 justify-between gap-2 whitespace-normal text-left bg-white/20 hover:bg-white/30 text-white border-0">
                    <Link to={createPageUrl(q.to)}>
                      <span className="min-w-0">{t(q.label)}</span><ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                    </Link>
                  </Button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
