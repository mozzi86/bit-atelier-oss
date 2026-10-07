import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { NumberField, Stat } from "@core/components/Field";
import { MapPin, Check, X } from "lucide-react";
import { UTILITY_LABELS, labelFor } from "./labels";

// Grundstück & Baurecht. data = { parcel_area, zoning:{...}, utilities:{...} }
export default function SiteZoningPanel({ data, onChange }) {
  const zoning = data.zoning || {};
  const setbacks = zoning.setbacks || {};
  const utilities = data.utilities || {};

  const setZoning = (patch) => onChange({ zoning: { ...zoning, ...patch } });
  const setSetbacks = (patch) =>
    onChange({ zoning: { ...zoning, setbacks: { ...setbacks, ...patch } } });

  const maxGFA = (data.parcel_area || 0) * (zoning.far_max || 0);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4" /> Grundstück & Baurecht
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <NumberField
            label="Grundstücksfläche"
            suffix="m²"
            value={data.parcel_area}
            onChange={(v) => onChange({ parcel_area: v })}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="GFZ / FAR max" value={zoning.far_max} onChange={(v) => setZoning({ far_max: v })} />
            <NumberField label="Höhe max" suffix="m" value={zoning.height_max} onChange={(v) => setZoning({ height_max: v })} />
            <NumberField label="Stellplatzschlüssel" value={zoning.parking_ratio} onChange={(v) => setZoning({ parking_ratio: v })} />
            <NumberField label="Grünanteil min" value={zoning.green_space_min} onChange={(v) => setZoning({ green_space_min: v })} />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-2">Abstandsflächen (m)</div>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Vorne" value={setbacks.front} onChange={(v) => setSetbacks({ front: v })} />
              <NumberField label="Seite" value={setbacks.side} onChange={(v) => setSetbacks({ side: v })} />
              <NumberField label="Hinten" value={setbacks.rear} onChange={(v) => setSetbacks({ rear: v })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Erschließung</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {["water", "sewer", "electric", "gas"].map((u) => (
              <Button
                key={u}
                variant={utilities[u] ? "default" : "outline"}
                className="justify-start"
                aria-label={`${labelFor(UTILITY_LABELS, u)} ${utilities[u] ? "vorhanden" : "nicht vorhanden"}`}
                onClick={() => onChange({ utilities: { ...utilities, [u]: !utilities[u] } })}
              >
                {utilities[u] ? <Check className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                {labelFor(UTILITY_LABELS, u)}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abgeleitete Kennwerte</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Stat label="Max. BGF (GFZ)" value={`${maxGFA.toLocaleString("de-DE")} m²`} accent="text-blue-600" />
            <Stat
              label="Erschließung"
              value={
                <Badge className={Object.values(utilities).every(Boolean) ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                  {Object.values(utilities).filter(Boolean).length}/4 vorhanden
                </Badge>
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
