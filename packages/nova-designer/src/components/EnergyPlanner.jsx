import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Stat } from "@core/components/Field";
import { Zap, Plus, Trash2 } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const SYSTEM_TYPES = [
  "Wärmepumpe (Sole)",
  "Wärmepumpe (Luft)",
  "Photovoltaik",
  "Solarthermie",
  "Fernwärme",
  "BHKW",
  "Geothermie",
];

// Manage energy systems. complexData.energy_systems = [{ type, capacity_kw, coverage }]
export default function EnergyPlanner({ complexData, onEnergySystemsChange }) {
  const systems = complexData?.energy_systems || [];
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // Beheizte Fläche (BGF) für die Energie-Kennzahlen — aus dem Gebäudemodell
  // vorbelegt (eine Quelle), solange der Nutzer keinen eigenen Wert eingegeben hat.
  const [heatedArea, setHeatedArea] = useState(0);
  const [areaTouched, setAreaTouched] = useState(false);
  useEffect(() => {
    if (pm.footArea > 0 && !areaTouched) setHeatedArea(Math.round(pm.bgf));
  }, [pm.bgf, pm.footArea, areaTouched]);

  const add = () =>
    onEnergySystemsChange?.([...systems, { type: SYSTEM_TYPES[0], capacity_kw: 50, coverage: 0.3 }]);
  const upd = (i, patch) =>
    onEnergySystemsChange?.(systems.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i) => onEnergySystemsChange?.(systems.filter((_, idx) => idx !== i));

  const totalKw = systems.reduce((s, x) => s + (Number(x.capacity_kw) || 0), 0);
  const totalCoverage = Math.min(
    100,
    Math.round(systems.reduce((s, x) => s + (Number(x.coverage) || 0), 0) * 100)
  );
  const renewable = systems.filter((s) => /pumpe|photovolt|solar|geotherm/i.test(s.type)).length;

  return (
    <div className="space-y-6">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Installierte Leistung" value={`${totalKw.toLocaleString("de-DE")} kW`} accent="text-amber-600" />
        <Stat label="Bedarfsdeckung" value={`${totalCoverage} %`} accent="text-emerald-600" />
        <Stat label="Erneuerbare Systeme" value={`${renewable}/${systems.length || 0}`} />
        <Stat
          label="Spez. Leistung"
          value={heatedArea > 0 ? `${Math.round((totalKw * 1000) / heatedArea).toLocaleString("de-DE")} W/m²` : "—"}
          accent="text-sky-600"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500">Beheizte Fläche (BGF) m²</label>
        <Input
          type="number"
          className="w-32 h-8"
          value={heatedArea}
          onChange={(e) => { setAreaTouched(true); setHeatedArea(Number(e.target.value)); }}
        />
        {pm.footArea > 0 && !areaTouched && (
          <span className="text-[11px] text-emerald-600">aus dem Gebäudemodell vorbelegt</span>
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-4 h-4" /> Energiesysteme
          </CardTitle>
          <Button size="sm" onClick={add}><Plus className="w-4 h-4 mr-1" /> System</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {systems.length === 0 && <p className="text-sm text-slate-500">Noch keine Energiesysteme.</p>}
          {systems.map((s, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 items-center">
              <Select value={s.type} onValueChange={(v) => upd(i, { type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SYSTEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" value={s.capacity_kw} onChange={(e) => upd(i, { capacity_kw: Number(e.target.value) })} placeholder="kW" />
              <Input type="number" step="0.05" value={s.coverage} onChange={(e) => upd(i, { coverage: Number(e.target.value) })} placeholder="Deckung 0–1" />
              <Button variant="ghost" size="icon" className="text-red-500" onClick={() => remove(i)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
