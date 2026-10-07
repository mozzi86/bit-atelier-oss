import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Stat } from "@core/components/Field";
import { Home, Plus, Trash2 } from "lucide-react";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const normalize = (data) => (Array.isArray(data) ? data : Object.values(data || {}));

// Wohnungsmix-Editor. data = [{ type, count, area, rent_sqm }]
export default function UnitMixEditor({ data, massingData, onChange }) {
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const rows = normalize(data);

  const update = (i, patch) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    onChange([...rows, { type: "Neuer Wohnungstyp", count: 0, area: 50, rent_sqm: 15 }]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  const totalUnits = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const totalArea = rows.reduce((s, r) => s + (Number(r.count) || 0) * (Number(r.area) || 0), 0);
  const monthlyRent = rows.reduce(
    (s, r) => s + (Number(r.count) || 0) * (Number(r.area) || 0) * (Number(r.rent_sqm) || 0),
    0
  );
  const gfa = massingData?.total_gfa || 0;

  return (
    <div className="space-y-6">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Wohneinheiten" value={totalUnits} accent="text-blue-600" />
        <Stat label="Wohnfläche" value={`${totalArea.toLocaleString("de-DE")} m²`} />
        <Stat label="Mtl. Sollmiete" value={`${Math.round(monthlyRent).toLocaleString("de-DE")} €`} accent="text-emerald-600" />
        <Stat label="Flächeneffizienz" value={gfa ? `${Math.round((totalArea / gfa) * 100)} %` : "—"} />
      </div>
      {pm.footArea > 0 && (
        <p className="text-xs text-slate-500">
          Modell: {Math.round(pm.ngf).toLocaleString("de-DE")} m² NGF als Referenz für die Gesamtwohnfläche
        </p>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="w-4 h-4" /> Wohnungsmix
          </CardTitle>
          <Button size="sm" onClick={addRow}>
            <Plus className="w-4 h-4 mr-1" /> Typ
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 text-xs text-slate-500 px-1 mb-2">
            <span>Typ</span><span>Anzahl</span><span>Fläche m²</span><span>€/m²</span><span></span>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center">
                <Input value={r.type} onChange={(e) => update(i, { type: e.target.value })} />
                <Input type="number" value={r.count} onChange={(e) => update(i, { count: Number(e.target.value) })} />
                <Input type="number" value={r.area} onChange={(e) => update(i, { area: Number(e.target.value) })} />
                <Input type="number" value={r.rent_sqm} onChange={(e) => update(i, { rent_sqm: Number(e.target.value) })} />
                <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeRow(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
