import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Badge } from "@core/components/ui/badge";
import { Calculator, Euro, FileText, Download } from "lucide-react";

// HOAI 2021 fee rates for different building types
const HOAI_FEE_RATES = {
  "I": { min: 2.39, avg: 2.84, max: 3.29, description: "Sehr einfache Gebäude" },
  "II": { min: 2.84, avg: 3.37, max: 3.90, description: "Einfache Gebäude" },
  "III": { min: 3.37, avg: 4.00, max: 4.63, description: "Gebäude mit durchschnittlichen Anforderungen" },
  "IV": { min: 4.00, avg: 4.75, max: 5.50, description: "Gebäude mit überdurchschnittlichen Anforderungen" },
  "V": { min: 4.75, avg: 5.64, max: 6.53, description: "Sehr anspruchsvolle Gebäude" }
};

// HOAI phase distribution percentages
const HOAI_PHASES = [
  { phase: 1, name: "Grundlagenermittlung", percentage: 2, description: "Klären und Beraten" },
  { phase: 2, name: "Vorplanung", percentage: 7, description: "Planungskonzept und Kostenschätzung" },
  { phase: 3, name: "Entwurfsplanung", percentage: 15, description: "Durcharbeiten des Konzepts und Kostenberechnung" },
  { phase: 4, name: "Genehmigungsplanung", percentage: 3, description: "Erarbeiten der Genehmigungsvorlagen" },
  { phase: 5, name: "Ausführungsplanung", percentage: 25, description: "Ausführungsreife Planungslösung" },
  { phase: 6, name: "Vorbereitung der Vergabe", percentage: 10, description: "Mengenermittlung und Leistungsverzeichnisse" },
  { phase: 7, name: "Mitwirkung bei der Vergabe", percentage: 4, description: "Einholen und Prüfen der Angebote" },
  { phase: 8, name: "Objektüberwachung", percentage: 32, description: "Bauüberwachung und Dokumentation" },
  { phase: 9, name: "Objektbetreuung", percentage: 2, description: "Begehung und Mängelfeststellung" }
];

export default function HOAIFeeCalculator() {
  const [calculation, setCalculation] = useState({
    construction_cost: 0,
    complexity_zone: "III",
    fee_rate: "avg",
    building_type: "residential",
    plattform_prozent: 15, // BIT-Atelier platform fee
    special_services: false
  });

  const [results, setResults] = useState(null);

  const calculateFees = () => {
    const { construction_cost, complexity_zone, fee_rate, plattform_prozent } = calculation;
    
    if (!construction_cost || construction_cost <= 0) return;

    // Base fee calculation
    const feeRate = HOAI_FEE_RATES[complexity_zone][fee_rate];
    const baseFee = (construction_cost * feeRate) / 100;

    // BIT-Atelier platform fee
    const platformFee = (baseFee * plattform_prozent) / 100;
    const architectFee = baseFee - platformFee;

    // Phase breakdown
    const phaseBreakdown = HOAI_PHASES.map(phase => ({
      ...phase,
      amount: (baseFee * phase.percentage) / 100,
      architect_amount: (architectFee * phase.percentage) / 100,
      platform_amount: (platformFee * phase.percentage) / 100
    }));

    // Investment metrics
    const totalProjectValue = construction_cost + baseFee;
    const roiBasedOnFees = ((baseFee / construction_cost) * 100).toFixed(2);

    setResults({
      construction_cost,
      base_fee: baseFee,
      architect_fee: architectFee,
      platform_fee: platformFee,
      total_project_value: totalProjectValue,
      roi_percentage: roiBasedOnFees,
      phase_breakdown: phaseBreakdown,
      fee_rate_used: feeRate
    });
  };

  const updateCalculation = (field, value) => {
    setCalculation(prev => ({
      ...prev,
      [field]: field === 'construction_cost' ? parseFloat(value) || 0 : value
    }));
  };

  const formatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0
  });

  return (
    <div className="space-y-8">
      <Card className="border-0 shadow-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">HOAI-Honorarrechner</h2>
              <p className="text-blue-100 mt-1">Architektenhonorare nach HOAI 2021 berechnen</p>
            </div>
            <Calculator className="w-12 h-12 opacity-80" />
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Input Parameters */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                Projektparameter
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Baukosten (€)</Label>
                <Input
                  type="number"
                  placeholder="z. B. 2500000"
                  value={calculation.construction_cost || ''}
                  onChange={(e) => updateCalculation('construction_cost', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Honorarzone</Label>
                <Select 
                  value={calculation.complexity_zone} 
                  onValueChange={(value) => updateCalculation('complexity_zone', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(HOAI_FEE_RATES).map(([zone, data]) => (
                      <SelectItem key={zone} value={zone}>
                        Zone {zone} – {data.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Honorarsatz</Label>
                <Select 
                  value={calculation.fee_rate} 
                  onValueChange={(value) => updateCalculation('fee_rate', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="min">Mindestsatz</SelectItem>
                    <SelectItem value="avg">Mittelsatz</SelectItem>
                    <SelectItem value="max">Höchstsatz</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>BIT-Atelier-Plattformgebühr (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="25"
                  step="1"
                  value={calculation.plattform_prozent}
                  onChange={(e) => updateCalculation('plattform_prozent', e.target.value)}
                />
                <p className="text-xs text-slate-500">Plattformgebühr, abgezogen vom gesamten HOAI-Honorar</p>
              </div>

              <Button 
                onClick={calculateFees}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600"
                disabled={!calculation.construction_cost}
              >
                HOAI-Honorar berechnen
              </Button>
            </CardContent>
          </Card>

          {/* Fee Structure Info */}
          <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Aktuelle Honorarzone</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Badge variant="outline" className="w-full justify-center py-2">
                  Zone {calculation.complexity_zone}
                </Badge>
                <p className="text-sm text-slate-600 text-center">
                  {HOAI_FEE_RATES[calculation.complexity_zone]?.description}
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center">
                    <p className="font-semibold">{HOAI_FEE_RATES[calculation.complexity_zone]?.min}%</p>
                    <p className="text-slate-500">Mindestsatz</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">{HOAI_FEE_RATES[calculation.complexity_zone]?.avg}%</p>
                    <p className="text-slate-500">Mittelsatz</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">{HOAI_FEE_RATES[calculation.complexity_zone]?.max}%</p>
                    <p className="text-slate-500">Höchstsatz</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-6">
          {results && (
            <>
              {/* Fee Summary */}
              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Euro className="w-5 h-5 text-green-600" />
                    Ergebnis der Honorarberechnung
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <p className="text-sm text-slate-600">HOAI-Honorar gesamt</p>
                        <p className="text-2xl font-bold text-blue-800">
                          {formatter.format(results.base_fee)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {results.fee_rate_used}% der Baukosten
                        </p>
                      </div>
                      
                      <div className="p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-slate-600">Anteil Architekt</p>
                        <p className="text-2xl font-bold text-green-800">
                          {formatter.format(results.architect_fee)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Nach Abzug der Plattformgebühr ({calculation.plattform_prozent}%)
                        </p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-sm text-slate-600">BIT-Atelier-Gebühr</p>
                        <p className="text-2xl font-bold text-purple-800">
                          {formatter.format(results.platform_fee)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Plattform-Servicegebühr
                        </p>
                      </div>
                      
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-sm text-slate-600">Gesamtprojektwert</p>
                        <p className="text-2xl font-bold text-slate-800">
                          {formatter.format(results.total_project_value)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Baukosten + Honorar
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Phase Breakdown */}
              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    Aufteilung nach HOAI-Leistungsphasen
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {results.phase_breakdown.map((phase) => (
                      <div key={phase.phase} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-semibold">
                              LPH {phase.phase}: {phase.name}
                            </h4>
                            <p className="text-sm text-slate-600">{phase.description}</p>
                          </div>
                          <Badge variant="outline">
                            {phase.percentage}%
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                          <div>
                            <p className="text-slate-500">Honorar der Phase</p>
                            <p className="font-semibold">{formatter.format(phase.amount)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Anteil Architekt</p>
                            <p className="font-semibold text-green-600">{formatter.format(phase.architect_amount)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Plattformgebühr</p>
                            <p className="font-semibold text-purple-600">{formatter.format(phase.platform_amount)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <Button className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600">
                      <FileText className="w-4 h-4 mr-2" />
                      HOAI-Bericht erstellen
                    </Button>
                    <Button variant="outline" className="flex-1">
                      <Download className="w-4 h-4 mr-2" />
                      Als Excel exportieren
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}