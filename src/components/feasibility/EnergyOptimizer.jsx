import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Progress } from "@core/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Label } from "@core/components/ui/label";
import { NumberField, Stat } from "@core/components/Field";
import { Zap, Sun } from "lucide-react";

const CERTS = ["DGNB Silber", "DGNB Gold", "DGNB Platin", "LEED Gold", "LEED Platinum", "KfW-40"];

// Energy & sustainability. data = { pv_potential, energy_savings, green_building_cert }
export default function EnergyOptimizer({ data, massingData, onChange }) {
  const buildings = massingData?.buildings || [];
  const roofArea = buildings.reduce((s, b) => s + (b.footprint || 0), 0);
  // ~0.15 kWp per m² usable roof; estimate annual yield at ~950 kWh/kWp.
  const estPv = Math.round(roofArea * 0.15);
  const annualYield = Math.round((data.pv_potential || 0) * 950);
  const savings = Math.round((data.energy_savings || 0) * 100);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-4 h-4" /> Energie & Nachhaltigkeit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <NumberField label="PV-Leistung" suffix="kWp" value={data.pv_potential} onChange={(v) => onChange({ pv_potential: v })} />
          <div className="text-xs text-slate-500">
            Geschätztes Dachpotenzial: <span className="font-medium text-slate-700">{estPv} kWp</span> ({roofArea.toLocaleString("de-DE")} m² Dachfläche)
          </div>
          <NumberField label="Energieeinsparung (0–1)" value={data.energy_savings} onChange={(v) => onChange({ energy_savings: v })} />
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Zertifizierung</Label>
            <Select value={data.green_building_cert} onValueChange={(v) => onChange({ green_building_cert: v })}>
              <SelectTrigger><SelectValue placeholder="Zertifikat..." /></SelectTrigger>
              <SelectContent>
                {CERTS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="w-4 h-4 text-amber-500" /> Ertrag & Bilanz
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="PV-Jahresertrag" value={`${annualYield.toLocaleString("de-DE")} kWh`} accent="text-amber-600" />
            <Stat label="Zertifikat" value={data.green_building_cert || "—"} accent="text-emerald-600" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-500">Energieeinsparung</span>
              <span className="font-medium">{savings} %</span>
            </div>
            <Progress value={savings} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
