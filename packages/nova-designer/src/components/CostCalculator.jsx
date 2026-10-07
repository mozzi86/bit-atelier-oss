import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { NumberField, Stat } from "@core/components/Field";
import { Calculator } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { pxAreaToM2 } from "@core/lib/geo";

const eur = (n) => `€${Math.round(n).toLocaleString("de-DE")}`;

// Derives a cost estimate from the complex design. complexData + onCostUpdate(costs).
export default function CostCalculator({ complexData, onCostUpdate }) {
  const buildings = complexData?.buildings || [];
  const energy = complexData?.energy_systems || [];
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  const [rates, setRates] = useState({
    construction: 2400, // €/m² BGF
    infrastructure: 180, // €/m² site (designated)
    energy: 1200, // €/kW
    site_prep: 95, // €/m² footprint
  });

  // BGF und Grundfläche bevorzugt aus dem gemeinsamen Gebäudemodell (eine Quelle);
  // Fallback auf die aus complexData.buildings abgeleiteten Werte.
  // b.width/b.height sind Canvas-Pixel — Umrechnung ausschließlich über @core/lib/geo.
  const parcel = complexData?.site_parcel;
  const bgfBuildings = useMemo(
    () =>
      buildings.reduce(
        (s, b) => s + pxAreaToM2((b.width || 0) * (b.height || 0), parcel) * (b.floors || 1),
        0
      ),
    [buildings, parcel]
  );
  const footprintBuildings = useMemo(
    () => buildings.reduce((s, b) => s + pxAreaToM2((b.width || 0) * (b.height || 0), parcel), 0),
    [buildings, parcel]
  );
  const bgf = pm.footArea > 0 ? pm.bgf : bgfBuildings;
  const footprint = pm.footArea > 0 ? pm.footArea : footprintBuildings;
  const totalKw = energy.reduce((s, x) => s + (Number(x.capacity_kw) || 0), 0);

  const costs = useMemo(() => {
    const construction_cost = bgf * rates.construction;
    const infrastructure_cost = footprint * 4 * rates.infrastructure;
    const energy_system_cost = totalKw * rates.energy;
    const site_preparation_cost = footprint * rates.site_prep;
    const total_cost =
      construction_cost + infrastructure_cost + energy_system_cost + site_preparation_cost;
    return {
      construction_cost,
      infrastructure_cost,
      energy_system_cost,
      site_preparation_cost,
      total_cost,
      cost_per_m2: bgf ? total_cost / bgf : 0,
    };
  }, [bgf, footprint, totalKw, rates]);

  // Push computed costs up whenever they change.
  useEffect(() => {
    onCostUpdate?.(costs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costs.total_cost]);

  // Schätzung in den gemeinsamen Store spiegeln (Quelle für AVA-Kostenkontrolle).
  useEffect(() => {
    store.set({
      costEstimate: {
        total: Math.round(costs.total_cost),
        bgf: Math.round(bgf),
        perM2: Math.round(costs.total_cost / bgf || 0),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costs.total_cost, bgf]);

  return (
    <div className="space-y-4">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="w-4 h-4" /> Kostenkennwerte
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <NumberField label="Bau €/m² BGF" value={rates.construction} onChange={(v) => setRates((r) => ({ ...r, construction: v }))} />
          <NumberField label="Infrastruktur €/m²" value={rates.infrastructure} onChange={(v) => setRates((r) => ({ ...r, infrastructure: v }))} />
          <NumberField label="Energie €/kW" value={rates.energy} onChange={(v) => setRates((r) => ({ ...r, energy: v }))} />
          <NumberField label="Baufeld €/m²" value={rates.site_prep} onChange={(v) => setRates((r) => ({ ...r, site_prep: v }))} />
          <div className="col-span-2 text-xs text-slate-500">
            BGF ≈ {Math.round(bgf).toLocaleString("de-DE")} m² · Grundfläche ≈ {Math.round(footprint).toLocaleString("de-DE")} m² · {totalKw} kW
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kostenschätzung (DIN 276)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Bauwerk" value={eur(costs.construction_cost)} />
            <Stat label="Infrastruktur" value={eur(costs.infrastructure_cost)} />
            <Stat label="Energietechnik" value={eur(costs.energy_system_cost)} />
            <Stat label="Baufeld" value={eur(costs.site_preparation_cost)} />
          </div>
          <div className="rounded-lg bg-emerald-50 p-4">
            <div className="text-xs text-emerald-700">Gesamtkosten</div>
            <div className="text-2xl font-bold text-emerald-700">{eur(costs.total_cost)}</div>
            <div className="text-xs text-emerald-600 mt-1">{eur(costs.cost_per_m2)} / m² BGF</div>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
