import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { 
  Zap, 
  Thermometer, 
  TrendingUp, 
  Calculator,
  FileText,
  CheckCircle,
  BarChart3,
  Sun
} from "lucide-react";
import { motion } from "framer-motion";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

export default function EnergyAnalysis() {
  const { project: selectedProject } = useProject();
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const [buildings, setBuildings] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Anzeige-Fallback: fehlende Werte als "—", Einheit nur bei vorhandenem Wert
  const fmt = (v, unit = "") => (v === null || v === undefined || v === "" ? "—" : `${v}${unit}`);

  useEffect(() => {
    if (selectedProject) {
      loadBuildings();
      loadScenarios();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  const loadBuildings = async () => {
    if (!selectedProject) return;
    const data = await bitApi.entities.Building.filter({ project_id: selectedProject.id });
    setBuildings(data);
  };

  const loadScenarios = async () => {
    if (!selectedProject) return;
    const data = await bitApi.entities.EnergyScenario.filter({ project_id: selectedProject.id });
    setScenarios(data);
  };

  const runEnergyCalculation = async () => {
    if (!selectedProject || (buildings.length === 0 && !(pm.footArea > 0))) return;

    setIsCalculating(true);

    // Bezugsfläche: BGF aus dem Gebäudemodell (eine Quelle) vorbelegen;
    // Fallback: Netto-Flächen der Building-Entitäten; sonst bisheriger Default (~600 m²).
    const buildingArea = buildings.reduce((s, b) => s + (Number(b.area_net) || 0), 0);
    const refArea = pm.footArea > 0 ? pm.bgf : buildingArea;

    // Simulate DIN 18599 calculation
    const mockResults = refArea > 0 ? {
      heating_demand_kwh: Math.round(75 * refArea),
      cooling_demand_kwh: Math.round(20 * refArea),
      electricity_demand_kwh: Math.round(46.6 * refArea),
      primary_energy_kwh: Math.round(148 * refArea),
      co2_emissions_kg: Math.round(30.8 * refArea),
      energy_cost_eur: Math.round(20.6 * refArea),
      specific_heating_demand: 75, // kWh/(m²·a)
      specific_primary_energy: 148 // kWh/(m²·a)
    } : {
      heating_demand_kwh: 45000,
      cooling_demand_kwh: 12000,
      electricity_demand_kwh: 28000,
      primary_energy_kwh: 89000,
      co2_emissions_kg: 18500,
      energy_cost_eur: 12400,
      specific_heating_demand: 75, // kWh/(m²·a)
      specific_primary_energy: 148 // kWh/(m²·a)
    };

    const newScenario = {
      project_id: selectedProject.id,
      name: `Baseline Scenario - ${new Date().toLocaleDateString()}`,
      scenario_type: "baseline",
      calculation_method: "DIN_18599",
      assumptions: {
        indoor_temp_heating: 20,
        indoor_temp_cooling: 26,
        air_change_rate: 0.5,
        usage_profile: "Office Standard",
        weather_dataset: selectedProject.try_year || "TRY2015"
      },
      monthly_results: {
        heating_demand: [8500, 7200, 5400, 2800, 800, 0, 0, 0, 1200, 4200, 6800, 8100],
        cooling_demand: [0, 0, 200, 800, 2200, 3800, 4200, 3900, 2100, 600, 0, 0],
        electricity_demand: [2400, 2200, 2300, 2200, 2400, 2600, 2800, 2700, 2400, 2300, 2200, 2500],
        pv_generation: [800, 1200, 2100, 3400, 4200, 4800, 4600, 3800, 2800, 1800, 1000, 600]
      },
      annual_summary: mockResults,
      geg_compliance: {
        reference_building_demand: 160, // kWh/(m²·a)
        calculated_demand: 148,
        compliance_factor: 0.925,
        passes_geg: true
      },
      calculation_date: new Date().toISOString()
    };

    await bitApi.entities.EnergyScenario.create(newScenario);
    setIsCalculating(false);
    loadScenarios();
  };

  const generateReport = () => {
    if (!selectedScenario) return;
    
    // Simulate PDF report generation
    console.log("Generating Energy Report for scenario:", selectedScenario.name);
    // In real implementation, this would generate and download a PDF
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
              Energie- & Klimaanalyse
            </h1>
            <p className="text-slate-600 mt-1">DIN-18599-Berechnung mit GEG-Konformitätsprüfung</p>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={runEnergyCalculation}
              disabled={!selectedProject || isCalculating}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg"
            >
              <Calculator className="w-4 h-4 mr-2" />
              {isCalculating ? "Berechnung läuft…" : "Analyse starten"}
            </Button>
            <Button 
              onClick={generateReport}
              disabled={!selectedScenario}
              variant="outline"
            >
              <FileText className="w-4 h-4 mr-2" />
              Bericht erstellen
            </Button>
          </div>
        </motion.div>

        {/* Ehrlichkeits-Banner (Phase 45): die Kennwerte unten sind DEMO-Platzhalter. */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="font-semibold shrink-0">Demo-Platzhalter:</span>
          <span>
            Diese Seite rechnet noch nicht — die Kennwerte (75 kWh/(m²·a) Heizwärme, GEG-Vergleich,
            Monatswerte) sind feste Beispielwerte, nur die Bezugsfläche kommt aus dem Gebäudemodell.
            Echte Richtwert-Analysen: Reiter „Energie" (Anlagen), „Bauphysik" (U-Wert/Tauwasser)
            und „Raumklima" (sommerlicher Wärmeschutz) im Komplex-Designer.
          </span>
        </div>

        {pm.footArea > 0 && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
            Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
          </div>
        )}

        {/* Project Selection */}
        <Card className="border-0 shadow-sm rounded-xl">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-800">Projektauswahl</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Projekt</label>
                <div className="h-10 flex items-center px-3 rounded-md border bg-slate-50 text-sm text-slate-700">
                  {selectedProject ? `${selectedProject.name} — ${selectedProject.location?.address || ""}` : "Oben Projekt wählen…"}
                </div>
              </div>

              {selectedProject && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Klimadaten</label>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-sm">
                      <div>Zone: {fmt(selectedProject.climate_zone)}</div>
                      <div>TRY: {selectedProject.try_year || "TRY2015"}</div>
                      <div>Standards: {selectedProject.standards?.length ? selectedProject.standards.join(", ") : "—"}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main Analysis Interface */}
        {selectedProject && (
          <div className="grid lg:grid-cols-3 gap-8">
            
            {/* Analysis Results */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Scenario Selector */}
              <Card className="border-0 shadow-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                    <BarChart3 className="w-5 h-5 text-emerald-600" />
                    Energie-Szenarien
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Select 
                    value={selectedScenario?.id || ""} 
                    onValueChange={(value) => {
                      const scenario = scenarios.find(s => s.id === value);
                      setSelectedScenario(scenario);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Szenario wählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {scenarios.map(scenario => (
                        <SelectItem key={scenario.id} value={scenario.id}>
                          {scenario.name} ({scenario.calculation_method})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* Results Display */}
              {selectedScenario && (
                <Tabs defaultValue="summary" className="space-y-4">
                  <TabsList className="grid w-full grid-cols-4 bg-slate-100">
                    <TabsTrigger value="summary">Übersicht</TabsTrigger>
                    <TabsTrigger value="monthly">Monatlich</TabsTrigger>
                    <TabsTrigger value="compliance">GEG-Prüfung</TabsTrigger>
                    <TabsTrigger value="systems">Anlagen</TabsTrigger>
                  </TabsList>

                  <TabsContent value="summary" className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
                        <CardContent className="p-4 text-center">
                          <div className="inline-flex p-2.5 rounded-xl bg-rose-50 mb-2">
                            <Thermometer className="w-6 h-6 text-rose-500" />
                          </div>
                          <div className="text-xs text-slate-500">Heizwärmebedarf</div>
                          <div className="text-2xl font-bold text-slate-800">{selectedScenario.annual_summary?.specific_heating_demand || 0}</div>
                          <div className="text-xs text-slate-500">kWh/(m²·a)</div>
                        </CardContent>
                      </Card>

                      <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
                        <CardContent className="p-4 text-center">
                          <div className="inline-flex p-2.5 rounded-xl bg-blue-50 mb-2">
                            <Zap className="w-6 h-6 text-blue-500" />
                          </div>
                          <div className="text-xs text-slate-500">Primärenergie</div>
                          <div className="text-2xl font-bold text-slate-800">{selectedScenario.annual_summary?.specific_primary_energy || 0}</div>
                          <div className="text-xs text-slate-500">kWh/(m²·a)</div>
                        </CardContent>
                      </Card>

                      <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
                        <CardContent className="p-4 text-center">
                          <div className="inline-flex p-2.5 rounded-xl bg-emerald-50 mb-2">
                            <TrendingUp className="w-6 h-6 text-emerald-600" />
                          </div>
                          <div className="text-xs text-slate-500">CO₂-Emissionen</div>
                          <div className="text-2xl font-bold text-slate-800">{(selectedScenario.annual_summary?.co2_emissions_kg / 1000).toFixed(1) || 0}</div>
                          <div className="text-xs text-slate-500">t CO₂/a</div>
                        </CardContent>
                      </Card>

                      <Card className="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
                        <CardContent className="p-4 text-center">
                          <div className="inline-flex p-2.5 rounded-xl bg-amber-50 mb-2">
                            <Sun className="w-6 h-6 text-amber-500" />
                          </div>
                          <div className="text-xs text-slate-500">Energiekosten</div>
                          <div className="text-2xl font-bold text-slate-800">€{(selectedScenario.annual_summary?.energy_cost_eur / 1000).toFixed(1) || 0}k</div>
                          <div className="text-xs text-slate-500">pro Jahr</div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="monthly">
                    <Card className="border-0 shadow-sm rounded-xl">
                      <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-800">Monatliche Energiebilanz</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="h-64 bg-slate-50 rounded-lg flex items-center justify-center">
                            <p className="text-slate-500">Diagramm der Monatswerte erscheint hier</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="compliance">
                    <Card className="border-0 shadow-sm rounded-xl">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                          <CheckCircle className="w-5 h-5 text-emerald-600" />
                          GEG-Konformitätsprüfung
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                          <div>
                            <h4 className="font-semibold text-emerald-800">Konformitätsstatus</h4>
                            <p className="text-sm text-emerald-600">Gebäude erfüllt die GEG-Anforderungen</p>
                          </div>
                          <CheckCircle className="w-8 h-8 text-emerald-600" />
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Primärenergie vs. Referenz</span>
                              <span>{((selectedScenario.geg_compliance?.compliance_factor || 1) * 100).toFixed(1)}%</span>
                            </div>
                            <Progress value={(selectedScenario.geg_compliance?.compliance_factor || 1) * 100} className="h-2" />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 pt-4">
                            <div className="text-center p-3 bg-slate-50 rounded-lg">
                              <div className="text-xs text-slate-500">Referenzgebäude</div>
                              <div className="text-2xl font-bold text-slate-800">{selectedScenario.geg_compliance?.reference_building_demand || 0}</div>
                              <div className="text-xs text-slate-500">kWh/(m²·a)</div>
                            </div>
                            <div className="text-center p-3 bg-emerald-50 rounded-lg">
                              <div className="text-xs text-slate-500">Berechneter Bedarf</div>
                              <div className="text-2xl font-bold text-emerald-700">{selectedScenario.geg_compliance?.calculated_demand || 0}</div>
                              <div className="text-xs text-slate-500">kWh/(m²·a)</div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="systems">
                    <Card className="border-0 shadow-sm rounded-xl">
                      <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-800">Übersicht Energiesysteme</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="p-4 border rounded-lg">
                            <h4 className="font-semibold text-slate-800 mb-2">Heizsystem</h4>
                            <div className="text-sm text-slate-600 space-y-1">
                              <div>Typ: Luft-Wasser-Wärmepumpe</div>
                              <div>COP: 3,2</div>
                              <div>Leistung: 45 kW</div>
                            </div>
                          </div>
                          
                          <div className="p-4 border rounded-lg">
                            <h4 className="font-semibold text-slate-800 mb-2">Lüftungsanlage</h4>
                            <div className="text-sm text-slate-600 space-y-1">
                              <div>Typ: Mechanisch mit Wärmerückgewinnung</div>
                              <div>Wirkungsgrad: 85 %</div>
                              <div>Luftwechselrate: 0,5 h⁻¹</div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}
            </div>

            {/* Building Information Panel */}
            <div className="space-y-6">
              <Card className="border-0 shadow-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-slate-800">Gebäudedaten</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {buildings.map(building => (
                    <div key={building.id} className="p-3 bg-slate-50 rounded-lg">
                      <div className="font-medium text-sm">{fmt(building.usage_type)}</div>
                      <div className="text-xs space-y-1 text-slate-600 mt-2">
                        <div>Nettofläche: {fmt(building.area_net, " m²")}</div>
                        <div>Beheizte Fläche: {fmt(building.area_heated, " m²")}</div>
                        <div>Geschosse: {fmt(building.storeys_above_ground)}</div>
                        <div>Baujahr: {fmt(building.year_built)}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-slate-800">Berechnungsstandards</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Methode:</span>
                    <Badge variant="outline">DIN 18599</Badge>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Klima:</span>
                    <Badge variant="outline">{selectedProject?.try_year || "TRY2015"}</Badge>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Standards:</span>
                    <Badge variant="outline">GEG</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-slate-800">Schnellaktionen</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" size="sm" className="w-full text-xs">
                    Sanierungsszenario anlegen
                  </Button>
                  <Button variant="outline" size="sm" className="w-full text-xs">
                    Szenarien vergleichen
                  </Button>
                  <Button variant="outline" size="sm" className="w-full text-xs">
                    PHPP-Export
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}