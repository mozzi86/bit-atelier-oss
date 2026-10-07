// RealEstateFeasibility.jsx — "Machbarkeit": feasibility study with site, massing,
// unit mix, parking, pro forma, energy, AI assistant and scenarios.
//
// 72-16 (N-17): every figure on this page is a fixed sample (the initial state
// below), not read from the current project, and edits in the tabs are not saved.
// The page therefore says so: a banner "Beispielrechnung mit Richtwerten" with a
// way to the real site capture (Komplex-Designer), a "Beispiel" mark on the KPI
// tiles and the AI suggestions. The two export buttons only wrote console.log and
// are replaced by a link to the real IFC export (Komplex-Designer, building model).
//
// In: nothing (no project data). Out: UI only.

import { seitenWurzel } from "@core/lib/utils";
import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { Card, CardContent } from "@core/components/ui/card";
import { Button, buttonVariants } from "@core/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import {
  MapPin,
  Building,
  Calculator,
  Zap,
  Car,
  Home,
  TrendingUp,
  Upload,
  Bot,
  CheckCircle,
  Eye,
  Info
} from "lucide-react";
import { motion } from "framer-motion";

import SiteZoningPanel from "../components/feasibility/SiteZoningPanel";
import MassingGenerator from "../components/feasibility/MassingGenerator";
import UnitMixEditor from "../components/feasibility/UnitMixEditor";
import ParkingCalculator from "../components/feasibility/ParkingCalculator";
import ProFormaAnalysis from "../components/feasibility/ProFormaAnalysis";
import EnergyOptimizer from "../components/feasibility/EnergyOptimizer";
import AIAssistant from "../components/feasibility/AIAssistant";
import ScenarioComparison from "../components/feasibility/ScenarioComparison";

// KPI tiles: key into the kpis state, German label (i18n key), icon and tint.
const KPI_KACHELN = [
  { key: "site_efficiency", label: "Grundstücksausnutzung", icon: Eye, feld: "bg-blue-50", farbe: "text-blue-600" },
  { key: "zoning_compliance", label: "Baurechtliche Konformität", icon: CheckCircle, feld: "bg-emerald-50", farbe: "text-emerald-600" },
  { key: "financial_viability", label: "Wirtschaftlichkeit", icon: TrendingUp, feld: "bg-violet-50", farbe: "text-violet-600" },
  { key: "sustainability_score", label: "Nachhaltigkeitsindex", icon: Zap, feld: "bg-teal-50", farbe: "text-teal-600" },
];

export default function RealEstateFeasibility() {
  const { t } = useI18n();
  const reiterRef = useRef(null);
  const [activeTab, setActiveTab] = useState("site");
  const [feasibilityData, setFeasibilityData] = useState({
    site: {
      parcel_area: 5000, // m²
      zoning: {
        far_max: 2.5,
        height_max: 45, // meters
        setbacks: { front: 5, rear: 8, side: 3 },
        parking_ratio: 1.2,
        green_space_min: 0.15
      },
      utilities: { water: true, sewer: true, electric: true, gas: true }
    },
    massing: {
      buildings: [
        {
          id: "b1",
          type: "apartment_tower",
          footprint: 800,
          floors: 12,
          height: 36,
          units: 144,
          efficiency: 0.78,
          orientation: "south"
        }
      ],
      total_gfa: 9600,
      site_coverage: 0.32,
      calculated_far: 1.92
    },
    unit_mix: [
      // Wohnungstypen sind freier Anzeigetext (im Wohnungsmix editierbar), keine Enum-Werte.
      { type: "1-Zimmer-Apartment", count: 36, area: 35, rent_sqm: 18 },
      { type: "2-Zimmer-Wohnung", count: 72, area: 55, rent_sqm: 16 },
      { type: "3-Zimmer-Wohnung", count: 36, area: 75, rent_sqm: 15 }
    ],
    parking: {
      required_spaces: 173,
      provided_spaces: 180,
      ev_stations: 18,
      bicycle_spaces: 288
    },
    financials: {
      land_cost: 2500000,
      construction_cost: 28800000,
      soft_costs: 4320000,
      total_project_cost: 35620000,
      annual_noi: 2847600,
      cap_rate: 0.08,
      roi: 0.127,
      irr: 0.145
    },
    sustainability: {
      pv_potential: 245, // kW
      energy_savings: 0.23,
      green_building_cert: "DGNB Gold"
    }
  });

  // Sample values [ASSUMED], see the file header — nothing on this page sets them.
  const [kpis] = useState({
    site_efficiency: 85,
    zoning_compliance: 98,
    financial_viability: 92,
    sustainability_score: 88
  });

  // No `action` field: AIAssistant renders an action as a button, and those
  // buttons ("Ausrichtung anpassen" …) had no handler — a button without effect.
  const [aiSuggestions] = useState([
    {
      type: "optimization",
      message: "Baukörper 15° nach Südosten drehen: +12 % PV-Ertrag (rund +47.000 € Jahreserlös)",
      impact: "high"
    },
    {
      type: "compliance",
      message: "Erreichte GFZ (1,92) liegt im Rahmen — 0,58 Ausnutzung sind noch möglich",
      impact: "medium"
    },
    {
      type: "market",
      message: "Marktanalyse empfiehlt für diesen Standort 20 % mehr 2-Zimmer-Wohnungen",
      impact: "low"
    }
  ]);

  const updateFeasibilityData = (section, data) => {
    setFeasibilityData(prev => ({
      ...prev,
      // Array sections (e.g. unit_mix) must be replaced, not object-merged.
      [section]: Array.isArray(data) ? data : { ...prev[section], ...data }
    }));
  };

  // "Alle anzeigen" opens the AI tab, where all suggestions are listed.
  const zeigeAlleVorschlaege = () => {
    setActiveTab("ai");
    reiterRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-4 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl shadow-xl">
              <Building className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
                Machbarkeit
              </h1>
              <p className="text-slate-600 mt-1">KI-gestützte Plattform für den Gebäude-Lebenszyklus — von der Machbarkeit über BIM bis zur Projektabwicklung</p>
            </div>
          </div>
        </motion.div>

        {/* Sample banner: the figures below belong to no project. */}
        <div
          role="note"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t("Beispielrechnung mit Richtwerten – nicht Ihr Projekt")}</p>
              <p className="text-sm">
                {t("Die Werte sind fest hinterlegte Richtwerte eines Beispiels und stammen nicht aus dem aktuellen Projekt. Änderungen in den Reitern werden nicht gespeichert.")}
              </p>
            </div>
          </div>
          <Link to="/ComplexDesigner?tab=site" className={`${buttonVariants({ variant: "outline", size: "sm" })} shrink-0`}>
            {t("Eigenes Grundstück im Komplex-Designer erfassen")}
          </Link>
        </div>

        {/* KPI-Übersicht (Beispielwerte) */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {KPI_KACHELN.map(({ key, label, icon: Icon, feld, farbe }) => (
            <Card key={key} className="border-0 shadow-sm rounded-xl bg-white hover:shadow-md transition-shadow">
              <CardContent className="relative p-6 text-center">
                <Badge variant="outline" className="absolute right-3 top-3 border-amber-300 bg-amber-50 text-amber-800">
                  {t("Beispiel")}
                </Badge>
                <div className={`p-2.5 rounded-xl ${feld} inline-flex mx-auto mb-3`}>
                  <Icon className={`w-7 h-7 ${farbe}`} />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-1">{kpis[key].toLocaleString("de-DE")} %</h3>
                <p className="text-xs text-slate-500">{t(label)}</p>
                <Progress value={kpis[key]} className="mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* KI-Vorschlagsleiste */}
        <Card className="border-0 shadow-xl rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Bot className="w-6 h-6" />
              <div className="flex-1">
                <h3 className="flex items-center gap-2 font-semibold">
                  {t("KI-Optimierungsvorschläge")}
                  <Badge className="bg-white text-emerald-800 hover:bg-white">{t("Beispiel")}</Badge>
                </h3>
                <div className="flex gap-4 mt-2">
                  {aiSuggestions.slice(0, 2).map((suggestion, index) => (
                    <Badge key={index} variant="secondary" className="bg-white/20 text-white">
                      {suggestion.message.substring(0, 60)}...
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={zeigeAlleVorschlaege}>{t("Alle anzeigen")}</Button>
            </div>
          </CardContent>
        </Card>

        {/* Hauptinhalt */}
        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <div ref={reiterRef} className="border-b border-slate-200 p-2 scroll-mt-4">
                {/* Wraps instead of a fixed 8-column grid, which cut the labels off. */}
                <TabsList className="flex w-full flex-wrap justify-start h-auto gap-1 bg-slate-100">
                  <TabsTrigger value="site" className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Grundstück & Baurecht
                  </TabsTrigger>
                  <TabsTrigger value="massing" className="flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Baumassenstudie
                  </TabsTrigger>
                  <TabsTrigger value="units" className="flex items-center gap-2">
                    <Home className="w-4 h-4" />
                    Wohnungsmix & Dichte
                  </TabsTrigger>
                  <TabsTrigger value="parking" className="flex items-center gap-2">
                    <Car className="w-4 h-4" />
                    Stellplätze & Mobilität
                  </TabsTrigger>
                  <TabsTrigger value="proforma" className="flex items-center gap-2">
                    <Calculator className="w-4 h-4" />
                    Wirtschaftlichkeit
                  </TabsTrigger>
                  <TabsTrigger value="energy" className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Energie & Nachhaltigkeit
                  </TabsTrigger>
                  <TabsTrigger value="ai" className="flex items-center gap-2">
                    <Bot className="w-4 h-4" />
                    KI-Assistent
                  </TabsTrigger>
                  <TabsTrigger value="scenarios" className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Szenarien
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="site" className="p-6">
                <SiteZoningPanel 
                  data={feasibilityData.site}
                  onChange={(data) => updateFeasibilityData('site', data)}
                />
              </TabsContent>

              <TabsContent value="massing" className="p-6">
                <MassingGenerator 
                  data={feasibilityData.massing}
                  siteData={feasibilityData.site}
                  onChange={(data) => updateFeasibilityData('massing', data)}
                />
              </TabsContent>

              <TabsContent value="units" className="p-6">
                <UnitMixEditor 
                  data={feasibilityData.unit_mix}
                  massingData={feasibilityData.massing}
                  onChange={(data) => updateFeasibilityData('unit_mix', data)}
                />
              </TabsContent>

              <TabsContent value="parking" className="p-6">
                <ParkingCalculator 
                  data={feasibilityData.parking}
                  unitData={feasibilityData.unit_mix}
                  zoningData={feasibilityData.site.zoning}
                  onChange={(data) => updateFeasibilityData('parking', data)}
                />
              </TabsContent>

              <TabsContent value="proforma" className="p-6">
                <ProFormaAnalysis 
                  data={feasibilityData.financials}
                  projectData={feasibilityData}
                  onChange={(data) => updateFeasibilityData('financials', data)}
                />
              </TabsContent>

              <TabsContent value="energy" className="p-6">
                <EnergyOptimizer 
                  data={feasibilityData.sustainability}
                  massingData={feasibilityData.massing}
                  onChange={(data) => updateFeasibilityData('sustainability', data)}
                />
              </TabsContent>

              <TabsContent value="ai" className="p-6">
                <AIAssistant 
                  suggestions={aiSuggestions}
                  feasibilityData={feasibilityData}
                />
              </TabsContent>

              <TabsContent value="scenarios" className="p-6">
                <ScenarioComparison 
                  baselineData={feasibilityData}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* The real IFC export lives with the building model (BitBimStudio). */}
        <p className="flex items-center justify-center gap-2 text-sm text-slate-600">
          <Upload className="w-4 h-4" aria-hidden="true" />
          <Link to="/ComplexDesigner?tab=bim" className="font-medium text-emerald-700 underline-offset-4 hover:underline">
            {t("IFC-Export im Komplex-Designer (Gebäudemodell)")}
          </Link>
        </p>
      </div>
    </div>
  );
}