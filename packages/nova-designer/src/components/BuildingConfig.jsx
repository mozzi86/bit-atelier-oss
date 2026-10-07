import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { NumberField, Stat } from "@core/components/Field";
import { Building, Car, Home, Plus, Trash2 } from "lucide-react";
import { useBuildingProgram, programMetrics, footprintWD } from "@core/lib/useBuildingProgram";
import { pxToM, mToPx } from "@core/lib/geo";

// Configure buildings, unit types and parking. data via complexData + callbacks.
export default function BuildingConfig({ complexData, onBuildingsChange, onUnitsChange, onParkingChange }) {
  const buildings = complexData?.buildings || [];
  const units = complexData?.unit_types || [];
  const parking = complexData?.parking || { total_spaces: 0, parking_key: 1, barrier_free_spaces: 0, ev_charging_stations: 0 };
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  // Maßstab zentral (@core/lib/geo): b.width/b.height sind Canvas-Pixel,
  // die Eingabefelder zeigen Meter. Keine lokalen Faktoren mehr.
  const parcel = complexData?.site_parcel;

  // Geschosse + Footprint-Maße aus dem Gebäudemodell in das erste Gebäude
  // übernehmen — oder ein neues Gebäude damit anlegen (eine Quelle, defensiv).
  const applyFromModel = () => {
    if (!(pm.footArea > 0)) return;
    const { w, d } = footprintWD(store.footprintM);
    const patch = { floors: pm.storeys, width: mToPx(Math.round(w), parcel), height: mToPx(Math.round(d), parcel) };
    if (buildings.length === 0) {
      onBuildingsChange?.([{ usage_type: "Aus Gebäudemodell", area_net: Math.round(pm.bgf), ...patch }]);
    } else {
      onBuildingsChange?.(buildings.map((b, idx) => (idx === 0 ? { ...b, area_net: Math.round(pm.bgf), ...patch } : b)));
    }
  };

  const updBuilding = (i, patch) =>
    onBuildingsChange?.(buildings.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const updUnit = (i, patch) =>
    onUnitsChange?.(units.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
  const addUnit = () => onUnitsChange?.([...units, { type: "Neuer Typ", count: 0, area: 50 }]);
  const removeUnit = (i) => onUnitsChange?.(units.filter((_, idx) => idx !== i));
  const updParking = (patch) => onParkingChange?.({ ...parking, ...patch });

  // KD-12: der erfasste Stellplatzschlüssel wird jetzt verrechnet.
  // Soll = Nutzungseinheiten × Schlüssel, aufgerundet. Ohne Einheiten oder
  // ohne Schlüssel gibt es kein Soll — dann "—" statt einer erfundenen Zahl.
  const unitCount = units.reduce((s, u) => s + (Number(u.count) || 0), 0);
  const parkKey = Number(parking.parking_key) || 0;
  const parkingRequired = unitCount > 0 && parkKey > 0 ? Math.ceil(unitCount * parkKey) : null;
  const parkingProvided = Number(parking.total_spaces) || 0;
  const parkingDelta = parkingRequired === null ? null : parkingProvided - parkingRequired;

  return (
    <div className="space-y-6">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m
        </div>
      )}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building className="w-4 h-4" /> Baukörper ({buildings.length})
          </CardTitle>
          {pm.footArea > 0 && (
            <Button size="sm" variant="outline" onClick={applyFromModel}>
              Aus Gebäudemodell übernehmen
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {buildings.length === 0 && <p className="text-sm text-slate-500">Setze Baukörper im Tab „Massing".</p>}
          {buildings.map((b, i) => {
            // KD-23: dieselbe Umrechnung wie in SiteDesigner und CostCalculator,
            // damit die angezeigten Meter mit BGF und Kosten zusammenpassen.
            const wM = pxToM(b.width, parcel);
            const dM = pxToM(b.height, parcel);
            const footM2 = wM * dM;
            return (
              <div key={b.id || i} className="border rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-500">Bezeichnung</span>
                    <Input value={b.usage_type || `Baukörper ${i + 1}`} onChange={(e) => updBuilding(i, { usage_type: e.target.value })} />
                  </div>
                  <NumberField label="Geschosse" value={b.floors} onChange={(v) => updBuilding(i, { floors: v })} />
                  <NumberField label="Breite (m)" value={b.width ? Math.round(wM) : b.width} onChange={(v) => updBuilding(i, { width: mToPx(v, parcel) })} />
                  <NumberField label="Tiefe (m)" value={b.height ? Math.round(dM) : b.height} onChange={(v) => updBuilding(i, { height: mToPx(v, parcel) })} />
                </div>
                {footM2 > 0 && (
                  <div className="text-xs text-slate-500">
                    Grundfläche {Math.round(footM2).toLocaleString("de-DE")} m² · BGF ≈{" "}
                    {Math.round(footM2 * (Number(b.floors) || 1)).toLocaleString("de-DE")} m²
                    {" "}bei {Number(b.floors) || 1} Geschoss(en)
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Home className="w-4 h-4" /> Nutzungseinheiten
            </CardTitle>
            <Button size="sm" onClick={addUnit}><Plus className="w-4 h-4 mr-1" /> Typ</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
                <Input value={u.type} onChange={(e) => updUnit(i, { type: e.target.value })} />
                <Input type="number" value={u.count} onChange={(e) => updUnit(i, { count: Number(e.target.value) })} />
                <Input type="number" value={u.area} onChange={(e) => updUnit(i, { area: Number(e.target.value) })} />
                <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeUnit(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            {units.length === 0 && <p className="text-sm text-slate-500">Noch keine Einheiten.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Car className="w-4 h-4" /> Stellplätze
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField label="Stellplätze gesamt" value={parking.total_spaces} onChange={(v) => updParking({ total_spaces: v })} />
            <NumberField label="Stellplatzschlüssel" value={parking.parking_key} onChange={(v) => updParking({ parking_key: v })} />
            <NumberField label="Barrierefrei" value={parking.barrier_free_spaces} onChange={(v) => updParking({ barrier_free_spaces: v })} />
            <NumberField label="E-Ladepunkte" value={parking.ev_charging_stations} onChange={(v) => updParking({ ev_charging_stations: v })} />
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <Stat label="E-Quote" value={parking.total_spaces ? `${Math.round((parking.ev_charging_stations / parking.total_spaces) * 100)} %` : "—"} />
              <Stat
                label={`Stellplatz-Soll${parkingRequired === null ? "" : ` (${unitCount} WE × ${parkKey.toLocaleString("de-DE")})`}`}
                value={parkingRequired === null ? "—" : `${parkingProvided.toLocaleString("de-DE")} / ${parkingRequired.toLocaleString("de-DE")}`}
              />
            </div>
            <div className="col-span-2 text-xs">
              {parkingRequired === null ? (
                <span className="text-slate-400">
                  Stellplatz-Soll erst berechenbar, wenn Nutzungseinheiten und Stellplatzschlüssel erfasst sind.
                </span>
              ) : parkingDelta >= 0 ? (
                <span className="text-emerald-700">
                  Stellplatznachweis erfüllt — {parkingDelta.toLocaleString("de-DE")} Stellplätze über dem Soll.
                </span>
              ) : (
                <span className="text-rose-700">
                  Stellplatznachweis nicht erfüllt — es fehlen {Math.abs(parkingDelta).toLocaleString("de-DE")} Stellplätze.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
