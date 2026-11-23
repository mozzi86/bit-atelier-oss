import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { NumberField, Stat } from "@core/components/Field";
import { Calculator } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { pxAreaToM2 } from "@core/lib/geo";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { EN as EN_KOSTEN_PAUSCHAL } from "@core/lib/i18nTeile/kosten-pauschal-kd09.js";
import { GRUNDSTUECK_JE_GRUNDFLAECHE, PAUSCHAL_SAETZE, pauschalKosten } from "@designer/lib/pauschalKosten";

englischErgaenzen(EN_KOSTEN_PAUSCHAL); // lazy part (KD-09): the assumption notes below

const eur = (n) => `€${Math.round(n).toLocaleString("de-DE")}`;

// Derives a cost estimate from the complex design. complexData + onCostUpdate(costs).
export default function CostCalculator({ complexData, onCostUpdate }) {
  const buildings = complexData?.buildings || [];
  const energy = complexData?.energy_systems || [];
  const { t } = useI18n();
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // [ASSUMED] default rates (units and status: lib/pauschalKosten.js PAUSCHAL_SAETZE).
  const [rates, setRates] = useState({ ...PAUSCHAL_SAETZE });

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

  // KD-09: the flat model lives in lib/pauschalKosten.js; infrastructure is priced on an ASSUMED site area of
  // GRUNDSTUECK_JE_GRUNDFLAECHE × footprint (the factor 4 of the original formula, numbers unchanged).
  const { grundstueck_m2: grundstueckM2, ...costs } = useMemo(
    () => pauschalKosten({ bgf, footprint, totalKw, rates }),
    [bgf, footprint, totalKw, rates]
  );

  // Push computed costs up whenever they change.
  useEffect(() => {
    onCostUpdate?.(costs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costs.total_cost]);

  // Mirror the flat estimate into the shared store; the AVA cost control shows it as the budget of the building
  // model. KD-09: `grundstuecksFaktor` (new, optional field) tells it the estimate rests on the [ASSUMED] site factor.
  useEffect(() => {
    store.set({
      costEstimate: {
        total: Math.round(costs.total_cost),
        bgf: Math.round(bgf),
        perM2: Math.round(costs.total_cost / bgf || 0),
        grundstuecksFaktor: GRUNDSTUECK_JE_GRUNDFLAECHE,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costs.total_cost, bgf]);

  return (
    <div className="space-y-4">
      {pm.footArea > 0 && (
        <div className="text-xs text-muted-foreground bg-muted border border-border rounded px-2 py-1 inline-flex">
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
          <p className="text-xs text-muted-foreground" data-testid="kosten-annahme">
            {t("Annahme: Infrastruktur auf {f} × Grundfläche ≈ {m} m² Grundstück (entspricht GRZ {grz}); Kostensätze sind Richtwerte, keine Kostenberechnung.")
              .replace("{f}", String(GRUNDSTUECK_JE_GRUNDFLAECHE))
              .replace("{m}", Math.round(grundstueckM2).toLocaleString("de-DE"))
              .replace("{grz}", (1 / GRUNDSTUECK_JE_GRUNDFLAECHE).toLocaleString("de-DE"))}
          </p>
          <div className="rounded-lg bg-muted p-4">
            <div className="text-xs text-muted-foreground">Gesamtkosten</div>
            <div className="text-2xl font-bold text-foreground">{eur(costs.total_cost)}</div>
            <div className="text-xs text-muted-foreground mt-1">{eur(costs.cost_per_m2)} / m² BGF</div>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
