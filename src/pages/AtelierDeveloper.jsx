// AtelierDeveloper.jsx — "Portfolio (Projektentwicklung)": the projects the role may see, their key figures,
// latest activities and quick links.
//
// 112-01 (foreign review 08.11.2026, point 1): every figure comes from a record. Gone: the fixed "mock" KPIs
// (125 000 m² BGF, 82.4 % efficiency, 23.1 % energy savings, 45.6 Mio. € portfolio value — the Project schema has none
// of these fields), three invented activities and a static "system state" (98/94/100 %, /api/status reports no module
// health). Count, area and screening use the role-filtered list, not the raw one.
//
// In: Project and EnergyScenario records (bitApi). Out: UI only.

import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useMemo } from "react";
import { projekteNachZugriff } from "@core/lib/rechte.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { Project } from "@/entities/Project";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { 
  Building, 
  Zap, 
  Euro, 
  MapPin,
  Calculator,
  Calendar,
  CheckCircle,
  Eye,
  Plus
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { createPageUrl } from "@core/utils";
import { STATUS_LABELS, labelFor } from "../components/projects/labels";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { EN as PORTFOLIO_112_EN } from "@core/lib/i18nTeile/portfolio-112.js";
import { bitApi } from "@core/api/bitApi";
import { KEIN_GEG_NACHWEIS } from "@core/lib/energieScreening";
import { portfolioKennzahlen, letzteAktivitaeten } from "@/lib/portfolio/portfolioKennzahlen.js";

// Lazy dictionary part (see the file header of portfolio-112.js).
englischErgaenzen(PORTFOLIO_112_EN);

// Opens the create form on /Projects (Projects.jsx reads ?neu=1).
const NEUES_PROJEKT = `${createPageUrl("Projects")}?neu=1`;

/** Day of a record timestamp, e.g. "08.11.2026"; "—" for a missing date. */
const tagDe = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

export default function AtelierDeveloper() {
  // 72-08 (N-02): the h1 is the menu title (src/navigation.js), same key.
  const { t } = useI18n();
  // 82-02: the role's project view (same filter as ProjectContext) — applied on render, so "Ansicht als" needs no reload.
  const zugriff = useZugriff();
  const [rohProjekte, setProjects] = useState([]);
  const projects = useMemo(() => projekteNachZugriff(rohProjekte, zugriff), [rohProjekte, zugriff]);
  const [szenarien, setSzenarien] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  // 112-01: computed from the FILTERED list on render (the old code counted the raw list once after loading).
  const kpis = useMemo(() => portfolioKennzahlen(projects, szenarien), [projects, szenarien]);
  const aktivitaeten = useMemo(() => letzteAktivitaeten(projects, szenarien, 5), [projects, szenarien]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // B-87-12: list(sort) takes no limit (express, demo and supabase all ignored the
      // old second argument). All projects are needed anyway: the count uses them,
      // the list below shows the first five by updated_date.
      const projectsData = await Project.list('-updated_date');
      setProjects(projectsData);
      // Liability (12.10.2026): the screening KPI counts the projects whose newest energy screening stays below the
      // reference guide value (energieScreening.js) — never a GEG proof.
      setSzenarien(await bitApi.entities.EnergyScenario.list().catch(() => []));
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    }
    setIsLoading(false);
  };

  const getPhaseColor = (phase) => {
    const colors = {
      feasibility: "bg-blue-100 text-blue-800",
      design: "bg-purple-100 text-purple-800",
      construction: "bg-orange-100 text-orange-800",
      handover: "bg-green-100 text-green-800"
    };
    return colors[phase] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"
        >
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("Portfolio (Projektentwicklung)")}
            </h1>
            <p className="text-slate-600 mt-1">Durchgängige Plattform für den Gebäude-Lebenszyklus — Machbarkeit → BIM → Übergabe</p>
          </div>
          {/* 72-08 (CONSISTENCY-13): a project is created in one place — the
              form on /Projects — not by landing on the feasibility study. */}
          <Link to={NEUES_PROJEKT}>
            <Button className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
              <Plus className="w-4 h-4 mr-2" />
              Neues Projekt
            </Button>
          </Link>
        </motion.div>

        {/* KPI-Karten — 112-01: only figures with a data source (see the file header). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-blue-50 mb-2">
                <Building className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1" data-portfolio-anzahl>{kpis.anzahl.toLocaleString("de-DE")}</h3>
              {/* 112-01 review: counts every visible project (no status filter), so the label says "Projekte", not "Aktive". */}
              <p className="text-xs text-slate-500" data-portfolio-anzahl-label>{t("Projekte")}</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-violet-50 mb-2">
                <Calculator className="w-6 h-6 text-violet-600" />
              </div>
              {/* Sum of the areas entered per project (building_area / area_net), not a computed BGF. */}
              <h3 className="text-2xl font-bold text-slate-800 mb-1" data-portfolio-flaeche>
                {kpis.flaecheM2 == null ? "—" : Math.round(kpis.flaecheM2).toLocaleString("de-DE")}
              </h3>
              <p className="text-xs text-slate-500">{t("Fläche lt. Projektangaben (m²)")}</p>
              <p className="text-[10px] text-muted-foreground">
                {kpis.flaecheM2 == null
                  ? t("Keine Flächenangabe in den Projekten")
                  : t("{{n}} von {{gesamt}} Projekten mit Flächenangabe")
                      .replace("{{n}}", String(kpis.mitFlaeche))
                      .replace("{{gesamt}}", String(kpis.anzahl))}
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-emerald-50 mb-2">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1" data-energie-screening-kpi>
                {kpis.screening.mitErgebnis
                  ? `${kpis.screening.eingehalten} / ${kpis.screening.mitErgebnis}`
                  : "—"}
              </h3>
              <p className="text-xs text-slate-500">{t("Energie-Screening: Richtwert eingehalten")}</p>
              <p className="text-[10px] text-slate-400">{t(KEIN_GEG_NACHWEIS)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Hauptinhalt */}
        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* 112-01 review: the five most recently changed visible projects (list sorted by -updated_date, no status filter). */}
          <div className="lg:col-span-2">
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Building className="w-5 h-5 text-emerald-600" />
                  {t("Zuletzt geänderte Projekte")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {projects.slice(0, 5).map((project) => (
                    <div key={project.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
                          <Building className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-800">{project.name}</h4>
                          <p className="text-sm text-slate-600">{project.client}</p>
                          <p className="text-xs text-slate-500">{project.location?.city}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={getPhaseColor(project.status)}>
                          {labelFor(STATUS_LABELS, project.status)}
                        </Badge>
                        <p className="text-sm text-slate-500 mt-1">
                          {tagDe(project.updated_date)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                
                {projects.length === 0 && (
                  <div className="text-center py-12">
                    <Building className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-600 mb-2">Noch keine Projekte</h3>
                    <p className="text-slate-500 mb-4">Starte mit der ersten Machbarkeitsstudie</p>
                    <Link to={NEUES_PROJEKT}>
                      <Button>Erstes Projekt anlegen</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Aktivitäten & Schnellzugriff */}
          <div className="space-y-6">
            
            {/* Schnellzugriff */}
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-slate-800">Schnellzugriff</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link to={createPageUrl("RealEstateFeasibility")}>
                  <Button className="w-full justify-start bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
                    <MapPin className="w-4 h-4 mr-2" />
                    Neue Machbarkeitsstudie
                  </Button>
                </Link>
                <Link to={createPageUrl("BimViewer")}>
                  <Button variant="outline" className="w-full justify-start">
                    <Eye className="w-4 h-4 mr-2" />
                    BIM-Modell importieren
                  </Button>
                </Link>
                {/* Straight to the designer tab; /EnergyAnalysis only redirects there. */}
                <Link to={`${createPageUrl("ComplexDesigner")}?tab=energy`}>
                  <Button variant="outline" className="w-full justify-start">
                    <Zap className="w-4 h-4 mr-2" />
                    Energieanalyse starten
                  </Button>
                </Link>
                <Link to={createPageUrl("Finance")}>
                  <Button variant="outline" className="w-full justify-start">
                    <Euro className="w-4 h-4 mr-2" />
                    Wirtschaftlichkeitsanalyse
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Letzte Aktivitäten — 112-01: from record timestamps (letzteAktivitaeten), empty state otherwise.
                The former "Systemzustand" card (fixed 98/94/100 %) is gone: no endpoint reports module health. */}
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Calendar className="w-5 h-5 text-emerald-600" />
                  {t("Letzte Aktivitäten")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aktivitaeten.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-portfolio-aktivitaeten-leer>{t("Noch keine Aktivitäten")}</p>
                ) : (
                  <div className="space-y-4" data-portfolio-aktivitaeten>
                    {aktivitaeten.map((a) => (
                      <div key={a.id} className="flex items-start gap-3">
                        {a.art === "screening"
                          ? <Zap className="w-4 h-4 text-muted-foreground" />
                          : <Building className="w-4 h-4 text-muted-foreground" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {a.projektName || t("(ohne Namen)")} – {a.art === "screening"
                              ? t("Energie-Screening gespeichert")
                              : a.art === "angelegt" ? t("Projekt angelegt") : t("Projektdaten geändert")}
                          </p>
                          <p className="text-xs text-muted-foreground">{tagDe(a.datum)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-4 text-[10px] text-muted-foreground">{t("Aus den Anlage- und Änderungsdaten der Projekte und den gespeicherten Energie-Screenings.")}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}