import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect } from "react";
import { Project } from "@/entities/Project";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { 
  Building, 
  Zap, 
  Euro, 
  TrendingUp, 
  MapPin,
  Calculator,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Eye,
  Plus
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { createPageUrl } from "@core/utils";
import { STATUS_LABELS, labelFor } from "../components/projects/labels";
import { useI18n } from "@core/lib/i18n";

// Opens the create form on /Projects (Projects.jsx reads ?neu=1).
const NEUES_PROJEKT = `${createPageUrl("Projects")}?neu=1`;

export default function AtelierDeveloper() {
  // 72-08 (N-02): the h1 is the menu title (src/navigation.js), same key.
  const { t } = useI18n();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kpis, setKpis] = useState({
    total_projects: 0,
    total_gfa: 0,
    avg_efficiency: 0,
    avg_energy_savings: 0,
    total_value: 0,
    compliant_projects: 0
  });

  const [recentActivity, setRecentActivity] = useState([
    {
      id: 1,
      type: "feasibility",
      message: "Eco Village München – Baumassen-Szenario A freigegeben",
      timestamp: "vor 2 Stunden",
      status: "success"
    },
    {
      id: 2,
      type: "energy",
      message: "Bürohochhaus Berlin – GEG-Konformität erreicht",
      timestamp: "vor 4 Stunden",
      status: "success"
    },
    {
      id: 3,
      type: "bim",
      message: "Wohnanlage – IFC-Modell importiert",
      timestamp: "vor 6 Stunden",
      status: "info"
    }
  ]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const projectsData = await Project.list('-updated_date', 10);
      setProjects(projectsData);
      
      // Calculate KPIs (mock data for now)
      setKpis({
        total_projects: projectsData.length,
        total_gfa: 125000,
        avg_efficiency: 82.4,
        avg_energy_savings: 23.1,
        total_value: 45600000,
        compliant_projects: Math.floor(projectsData.length * 0.89)
      });
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

  const getStatusIcon = (status) => {
    switch(status) {
      case "success": return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "error": return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default: return <Eye className="w-4 h-4 text-blue-500" />;
    }
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

        {/* KPI-Karten */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-blue-50 mb-2">
                <Building className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{kpis.total_projects.toLocaleString("de-DE")}</h3>
              <p className="text-xs text-slate-500">Aktive Projekte</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-violet-50 mb-2">
                <Calculator className="w-6 h-6 text-violet-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{Math.round(kpis.total_gfa / 1000).toLocaleString("de-DE")} Tsd.</h3>
              <p className="text-xs text-slate-500">BGF gesamt (m²)</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-emerald-50 mb-2">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{kpis.avg_efficiency.toLocaleString("de-DE")} %</h3>
              <p className="text-xs text-slate-500">Ø Flächeneffizienz</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-amber-50 mb-2">
                <Zap className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{kpis.avg_energy_savings.toLocaleString("de-DE")} %</h3>
              <p className="text-xs text-slate-500">Energieeinsparung</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-teal-50 mb-2">
                <Euro className="w-6 h-6 text-teal-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">{(kpis.total_value / 1000000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Mio. €</h3>
              <p className="text-xs text-slate-500">Portfoliowert</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-emerald-50 mb-2">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-1">
                {kpis.total_projects
                  ? `${Math.round((kpis.compliant_projects / kpis.total_projects) * 100).toLocaleString("de-DE")} %`
                  : "—"}
              </h3>
              <p className="text-xs text-slate-500">GEG-konform</p>
            </CardContent>
          </Card>
        </div>

        {/* Hauptinhalt */}
        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* Aktive Projekte */}
          <div className="lg:col-span-2">
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Building className="w-5 h-5 text-emerald-600" />
                  Aktive Projekte
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
                          {project.updated_date
                            ? new Date(project.updated_date).toLocaleDateString("de-DE", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              })
                            : "—"}
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

            {/* Letzte Aktivitäten */}
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Calendar className="w-5 h-5 text-emerald-600" />
                  Letzte Aktivitäten
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3">
                      {getStatusIcon(activity.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {activity.message}
                        </p>
                        <p className="text-xs text-slate-500">
                          {activity.timestamp}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Systemzustand */}
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-slate-800">Systemzustand</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>BIM-Verarbeitung</span>
                    <span>98 %</span>
                  </div>
                  <Progress value={98} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Energieberechnungen</span>
                    <span>94 %</span>
                  </div>
                  <Progress value={94} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>KI-Assistent</span>
                    <span>100 %</span>
                  </div>
                  <Progress value={100} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}