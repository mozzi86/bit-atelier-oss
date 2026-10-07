import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { NumberField, Stat } from "@core/components/Field";
import { Car } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const normalize = (data) => (Array.isArray(data) ? data : Object.values(data || {}));

// Parking & mobility. data = { provided_spaces, ev_stations, bicycle_spaces, required_spaces }
export default function ParkingCalculator({ data, unitData, zoningData, onChange }) {
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  // Referenz aus dem Gebäudemodell: ~Wohneinheiten als NGF / 75 m² je WE.
  const modelUnits = pm.footArea > 0 ? Math.max(1, Math.round(pm.ngf / 75)) : 0;
  const units = normalize(unitData).reduce((s, u) => s + (Number(u.count) || 0), 0);
  const ratio = zoningData?.parking_ratio || 1;
  const required = Math.ceil(units * ratio);
  const provided = data.provided_spaces || 0;
  const compliant = provided >= required;

  // Keep required_spaces in sync with the derived value.
  React.useEffect(() => {
    if (data.required_spaces !== required) onChange({ required_spaces: required });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required]);

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
            <Car className="w-4 h-4" /> Stellplätze & Mobilität
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-slate-600">
            {units} Einheiten × Schlüssel {ratio} ={" "}
            <span className="font-semibold text-slate-800">{required} erforderlich</span>
          </div>
          {modelUnits > 0 && (
            <p className="text-xs text-slate-500">
              ~{modelUnits.toLocaleString("de-DE")} WE aus Modell (NGF/75) als Referenz für den Stellplatzschlüssel
            </p>
          )}
          <NumberField label="Bereitgestellte Stellplätze" value={data.provided_spaces} onChange={(v) => onChange({ provided_spaces: v })} />
          <NumberField label="E-Ladestationen" value={data.ev_stations} onChange={(v) => onChange({ ev_stations: v })} />
          <NumberField label="Fahrradstellplätze" value={data.bicycle_spaces} onChange={(v) => onChange({ bicycle_spaces: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bilanz</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Stat label="Erforderlich" value={required} />
          <Stat label="Bereitgestellt" value={provided} accent={compliant ? "text-emerald-600" : "text-red-600"} />
          <Stat label="E-Quote" value={provided ? `${Math.round(((data.ev_stations || 0) / provided) * 100)} %` : "—"} />
          <Stat
            label="Konformität"
            value={
              <Badge className={compliant ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                {compliant ? `OK (+${provided - required})` : `${required - provided} fehlen`}
              </Badge>
            }
          />
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
