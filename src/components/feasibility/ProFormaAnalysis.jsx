import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Button } from "@core/components/ui/button";
import { Euro, TrendingUp, FileText } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

// Standard-Baukostenkennwert (€/m² BGF) zur Vorbelegung der Baukosten aus der BGF.
const BGF_RATE = 2400;

export default function ProFormaAnalysis({ data, projectData, onChange }) {
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const [financials, setFinancials] = useState(data || {
    land_cost: 0, construction_cost: 0, soft_costs: 0,
    total_project_cost: 0, annual_noi: 0, cap_rate: 0.08, roi: 0, irr: 0
  });

  // Baukosten aus der BGF des Gebäudemodells vorbelegen (eine Quelle), solange
  // noch kein eigener Baukostenwert eingegeben wurde. Footprint muss gesetzt sein.
  useEffect(() => {
    if (pm.footArea > 0 && !(financials.construction_cost > 0)) {
      const construction_cost = Math.round(pm.bgf * BGF_RATE);
      setFinancials((f) => {
        const updated = { ...f, construction_cost };
        updated.total_project_cost = (updated.land_cost || 0) + construction_cost + (updated.soft_costs || 0);
        updated.yield_on_cost = updated.total_project_cost > 0 ? ((updated.annual_noi / updated.total_project_cost) * 100) : 0;
        onChange?.(updated);
        return updated;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pm.bgf, pm.footArea]);

  const update = (field, value) => {
    const updated = { ...financials, [field]: parseFloat(value) || 0 };
    updated.total_project_cost = (updated.land_cost || 0) + (updated.construction_cost || 0) + (updated.soft_costs || 0);
    updated.yield_on_cost = updated.total_project_cost > 0 ? ((updated.annual_noi / updated.total_project_cost) * 100) : 0;
    setFinancials(updated);
    onChange(updated);
  };

  const formatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Euro className="w-5 h-5 text-green-600" />
              Kostenstruktur
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: 'land_cost', label: 'Grundstückskosten (€)' },
              { key: 'construction_cost', label: 'Baukosten (€)' },
              { key: 'soft_costs', label: 'Baunebenkosten / Honorare (€)' },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input type="number" value={financials[key]} onChange={(e) => update(key, e.target.value)} />
              </div>
            ))}
            <div className="p-3 bg-slate-100 rounded-lg">
              <p className="text-sm text-slate-500">Gesamtprojektkosten</p>
              <p className="text-xl font-bold">{formatter.format(financials.total_project_cost)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Rendite
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: 'annual_noi', label: 'Jahresreinertrag NOI (€)' },
              { key: 'cap_rate', label: 'Kapitalisierungszinssatz (z. B. 0,08)' },
              { key: 'irr', label: 'Ziel-IRR / interner Zinsfuß (z. B. 0,15)' },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input type="number" step="0.01" value={financials[key]} onChange={(e) => update(key, e.target.value)} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 rounded-lg text-center">
                <p className="text-xs text-slate-500">Rendite auf Gesamtkosten</p>
                <p className="text-lg font-bold text-green-800">{(financials.yield_on_cost || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg text-center">
                <p className="text-xs text-slate-500">IRR</p>
                <p className="text-lg font-bold text-blue-800">{((financials.irr || 0) * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}