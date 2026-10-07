import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { NumberField, Stat } from "@core/components/Field";
import { Building, Plus, Trash2 } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { BUILDING_TYPE_LABELS, labelFor } from "./labels";

// Baumassenstudie. data = { buildings:[...], total_gfa, site_coverage, calculated_far }
export default function MassingGenerator({ data, siteData, onChange }) {
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const buildings = data.buildings || [];
  const parcel = siteData?.parcel_area || 0;
  const farMax = siteData?.zoning?.far_max || 0;

  const recompute = (list) => {
    const total_gfa = list.reduce(
      (s, b) => s + (b.footprint || 0) * (b.floors || 0) * (b.efficiency || 0.8),
      0
    );
    const coverage = list.reduce((s, b) => s + (b.footprint || 0), 0);
    onChange({
      buildings: list,
      total_gfa: Math.round(total_gfa),
      site_coverage: parcel ? +(coverage / parcel).toFixed(2) : 0,
      calculated_far: parcel ? +(total_gfa / parcel).toFixed(2) : 0,
    });
  };

  const updateBuilding = (i, patch) => {
    const list = buildings.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    recompute(list);
  };

  const addBuilding = () =>
    recompute([
      ...buildings,
      {
        id: `b${buildings.length + 1}`,
        type: "apartment_tower",
        footprint: pm.footArea > 0 ? Math.round(pm.footArea) : 600,
        floors: pm.footArea > 0 ? pm.storeys : 8,
        efficiency: 0.78,
        orientation: "south",
      },
    ]);

  // Erste Vorbelegung aus dem Gebäudemodell (eine Quelle): nur wenn noch keine
  // Baukörper existieren — Nutzereingaben werden nie überschrieben.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (pm.footArea > 0 && buildings.length === 0 && !seededRef.current) {
      seededRef.current = true;
      recompute([
        { id: "b1", type: "apartment_tower", footprint: Math.round(pm.footArea), floors: pm.storeys, efficiency: 0.8, orientation: "south" },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pm.footArea, pm.storeys]);

  const removeBuilding = (i) => recompute(buildings.filter((_, idx) => idx !== i));

  const far = data.calculated_far || 0;
  const compliant = far <= farMax;

  return (
    <div className="space-y-6">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Gesamt-BGF" value={`${(data.total_gfa || 0).toLocaleString("de-DE")} m²`} accent="text-blue-600" />
        <Stat label="Überbauung" value={`${Math.round((data.site_coverage || 0) * 100)} %`} />
        <Stat label="Erreichte GFZ" value={far} accent={compliant ? "text-emerald-600" : "text-red-600"} />
        <Stat
          label="GFZ-Konformität"
          value={
            <Badge className={compliant ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
              {compliant ? `OK (≤ ${farMax})` : `> ${farMax}`}
            </Badge>
          }
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building className="w-4 h-4" /> Baukörper ({buildings.length})
          </CardTitle>
          <Button size="sm" onClick={addBuilding}>
            <Plus className="w-4 h-4 mr-1" /> Baukörper
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {buildings.map((b, i) => (
            <div key={b.id || i} className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">{labelFor(BUILDING_TYPE_LABELS, b.type)} · {b.id}</span>
                <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeBuilding(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberField label="Grundfläche" suffix="m²" value={b.footprint} onChange={(v) => updateBuilding(i, { footprint: v })} />
                <NumberField label="Geschosse" value={b.floors} onChange={(v) => updateBuilding(i, { floors: v })} />
                <NumberField label="Effizienz" value={b.efficiency} onChange={(v) => updateBuilding(i, { efficiency: v })} />
                <NumberField label="Einheiten" value={b.units} onChange={(v) => updateBuilding(i, { units: v })} />
              </div>
              <div className="text-xs text-slate-500 mt-2">
                BGF dieses Baukörpers:{" "}
                {Math.round((b.footprint || 0) * (b.floors || 0) * (b.efficiency || 0.8)).toLocaleString("de-DE")} m²
              </div>
            </div>
          ))}
          {buildings.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">Noch keine Baukörper. Füge einen hinzu.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
