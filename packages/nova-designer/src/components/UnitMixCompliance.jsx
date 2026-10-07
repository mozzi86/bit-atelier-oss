import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { Plus, Trash2, Home, Car, ShieldCheck, Gauge, Users } from "lucide-react";
import { UNIT_TYPES, unitInfo, computeMix, checkCompliance, STATUS_STYLE } from "@designer/lib/compliance";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const m2 = (n) => `${Math.round(n).toLocaleString("de-DE")} m²`;

const DEFAULT_MIX = [
  { type: "t2", share: 40, area: 65 },
  { type: "t3", share: 35, area: 88 },
  { type: "t1", share: 15, area: 45 },
  { type: "t4", share: 10, area: 112 },
];

const Stat = ({ icon: Icon, label, value, sub, tint }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1"><Icon className={`w-3.5 h-3.5 ${tint}`} /> {label}</div>
    <div className="text-xl font-bold text-slate-800">{value}</div>
    {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
  </div>
);

// Rapid residential feasibility (Spacio-style): auto unit mix + compliance check.
// Fallback nur, solange kein Grundstück gezeichnet/gespeichert ist (KD-11).
const SITE_AREA_FALLBACK = 3500;

export default function UnitMixCompliance({ siteArea: siteAreaProp = null, parking = null }) {
  const { projectId } = useProject();
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const [residentialNUF, setResidentialNUF] = useState(4000);
  const [mix, setMix] = useState(DEFAULT_MIX);
  const [footprint, setFootprint] = useState(900);
  const [siteArea, setSiteArea] = useState(siteAreaProp ?? SITE_AREA_FALLBACK);
  const [siteAreaAssumed, setSiteAreaAssumed] = useState(siteAreaProp == null);
  const [parkingProvided, setParkingProvided] = useState(60);
  // null = nicht erfasst ⇒ Regel gilt als „nicht geprüft" (kein stiller Default).
  const [bikesProvided, setBikesProvided] = useState(null);
  const [barrierFreeProvided, setBarrierFreeProvided] = useState(null);
  const [parkKey, setParkKey] = useState(1.0);
  const [gfzLimit, setGfzLimit] = useState(1.2);
  // null = keine GRZ-Grenze aus B-Plan hinterlegt ⇒ Regel „nicht geprüft".
  // Bewusst KEIN stiller Default 0,4 (KD-03).
  const [grzLimit, setGrzLimit] = useState(null);
  const [maxFloors, setMaxFloors] = useState(8);
  const [efficiency, setEfficiency] = useState(0.8);

  // Prefill from the project's space program.
  useEffect(() => {
    if (!projectId) return;
    bitApi.entities.SpaceProgram.filter({ project_id: projectId }).then((rows) => {
      const sp = rows[0];
      if (!sp) return;
      setFootprint(sp.footprint ?? 900);
      if (sp.site_area != null) { setSiteArea(sp.site_area); setSiteAreaAssumed(false); }
      setEfficiency(sp.efficiency ?? 0.8);
      const wohnen = (sp.items || []).find((i) => i.use === "wohnen");
      if (wohnen) setResidentialNUF((wohnen.area || 70) * (wohnen.count || 0));
      const park = (sp.items || []).find((i) => i.use === "parken");
      if (park) setParkingProvided(park.count || 0);
    });
  }, [projectId]);

  // KD-12: Stellplatzschlüssel und vorhandene Stellplätze aus dem Reiter
  // „Gebäude & Nutzung" übernehmen — der dort erfasste parking_key wurde
  // bisher nirgends verrechnet. Explizite Erfassung schlägt den Prefill
  // aus dem Raumprogramm.
  useEffect(() => {
    const key = Number(parking?.parking_key);
    if (Number.isFinite(key) && key > 0) setParkKey(key);
    const total = Number(parking?.total_spaces);
    if (Number.isFinite(total) && total > 0) setParkingProvided(total);
    const bikes = Number(parking?.bike_spaces);
    if (Number.isFinite(bikes) && bikes > 0) setBikesProvided(bikes);
  }, [parking?.parking_key, parking?.total_spaces, parking?.bike_spaces]);

  // Gezeichnete Grundstücksfläche aus der Baufeld-Planung übernehmen.
  useEffect(() => {
    if (siteAreaProp > 0) { setSiteArea(siteAreaProp); setSiteAreaAssumed(false); }
  }, [siteAreaProp]);

  // Geschossfläche aus dem Gebäudemodell übernehmen (eine Quelle),
  // sofern dort ein Footprint gesetzt ist. Aktualisiert bei Modelländerung.
  useEffect(() => {
    if (pm.footArea > 0) setFootprint(Math.round(pm.footArea));
  }, [pm.footArea]);

  const setRow = (i, patch) => setMix((arr) => arr.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setMix((arr) => [...arr, { type: "studio", share: 10, area: 32 }]);
  const delRow = (i) => setMix((arr) => arr.filter((_, idx) => idx !== i));

  const mixResult = useMemo(() => computeMix(residentialNUF, mix), [residentialNUF, mix]);
  const bgf = mixResult.livingArea / Math.max(0.3, efficiency);
  const floors = Math.max(1, Math.ceil(bgf / Math.max(1, footprint)));
  const check = useMemo(
    () => checkCompliance({ siteArea, footprint, bgf, floors, units: mixResult.units, parkingProvided, bikesProvided, barrierFreeProvided, parkKey, gfzLimit, grzLimit, maxFloors, mixRows: mixResult.rows }),
    [siteArea, footprint, bgf, floors, mixResult, parkingProvided, bikesProvided, barrierFreeProvided, parkKey, gfzLimit, grzLimit, maxFloors]
  );
  const density = siteArea ? (mixResult.units / (siteArea / 10000)) : 0;

  const verdictStyle =
    check.checked === 0 ? "bg-slate-400"
      : check.fails > 0 ? "bg-rose-500"
        : check.warns > 0 ? "bg-amber-500"
          : "bg-emerald-500";

  return (
    <div className="space-y-4">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m · NGF {Math.round(pm.ngf).toLocaleString("de-DE")} m² ≈ {Math.max(1, Math.round(pm.ngf / 75))} Wohneinheiten à 75 m²
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-4">
      {/* Mix editor */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Home className="w-4 h-4" /> Wohnungsmix</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-[1fr_64px_70px_70px_28px] gap-2 text-[11px] text-slate-400 px-1">
              <span>Typ</span><span className="text-right">Anteil %</span><span className="text-right">m²/WE</span><span className="text-right">WE</span><span />
            </div>
            {mix.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_70px_70px_28px] gap-2 items-center">
                <Select value={r.type} onValueChange={(v) => setRow(i, { type: v, area: r.area || unitInfo(v).default })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(UNIT_TYPES).map(([k, u]) => <SelectItem key={k} value={k}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="h-9 text-right" type="number" value={r.share} onChange={(e) => setRow(i, { share: Number(e.target.value) })} />
                <Input className="h-9 text-right" type="number" value={r.area} onChange={(e) => setRow(i, { area: Number(e.target.value) })} />
                <div className="text-right text-sm font-medium tabular-nums text-slate-700">{mixResult.rows[i]?.count ?? 0}</div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500" onClick={() => delRow(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addRow} className="w-full mt-1"><Plus className="w-3.5 h-3.5 mr-1" /> Wohnungstyp</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Rahmenwerte</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500">Wohn-NUF m²</label><Input type="number" value={residentialNUF} onChange={(e) => setResidentialNUF(Number(e.target.value))} /></div>
            <div><label className="text-xs text-slate-500">Geschossfläche m²</label><Input type="number" value={footprint} onChange={(e) => setFootprint(Number(e.target.value))} /></div>
            <div>
              <label className="text-xs text-slate-500">Grundstück m²{siteAreaAssumed && <span className="text-amber-600"> (Annahme)</span>}</label>
              <Input type="number" value={siteArea} onChange={(e) => { setSiteArea(Number(e.target.value)); setSiteAreaAssumed(false); }} />
            </div>
            <div><label className="text-xs text-slate-500">Stellplätze vorh.</label><Input type="number" value={parkingProvided} onChange={(e) => setParkingProvided(Number(e.target.value))} /></div>
            <div>
              <label className="text-xs text-slate-500">Fahrradstellplätze vorh.</label>
              <Input type="number" placeholder="nicht erfasst" value={bikesProvided ?? ""}
                onChange={(e) => setBikesProvided(e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div><label className="text-xs text-slate-500">Stellplatzschlüssel</label><Input type="number" step="0.1" value={parkKey} onChange={(e) => setParkKey(Number(e.target.value))} /></div>
            <div><label className="text-xs text-slate-500">GFZ-Grenze</label><Input type="number" step="0.1" value={gfzLimit} onChange={(e) => setGfzLimit(Number(e.target.value))} /></div>
            <div>
              <label className="text-xs text-slate-500">GRZ-Grenze (B-Plan)</label>
              <Input type="number" step="0.05" placeholder="nicht hinterlegt" value={grzLimit ?? ""}
                onChange={(e) => setGrzLimit(e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-slate-500">Barrierefrei erreichb. WE</label>
              <Input type="number" placeholder="nicht erfasst" value={barrierFreeProvided ?? ""}
                onChange={(e) => setBarrierFreeProvided(e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div><label className="text-xs text-slate-500">Max. Geschosse</label><Input type="number" value={maxFloors} onChange={(e) => setMaxFloors(Number(e.target.value))} /></div>
          </CardContent>
        </Card>
      </div>

      {/* KPIs + compliance */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat icon={Home} label="Wohneinheiten" value={mixResult.units} sub={`Ø ${Math.round(mixResult.avg)} m²`} tint="text-blue-500" />
          <Stat icon={Gauge} label="GFZ / GRZ" value={`${check.gfz.toFixed(2)} / ${check.grz.toFixed(2)}`} tint="text-violet-500" />
          <Stat icon={Car} label="Stellplätze" value={`${parkingProvided}/${check.parkingRequired}`} sub="vorh./erf." tint="text-slate-500" />
          <Stat icon={Users} label="Dichte" value={`${Math.round(density)} WE/ha`} sub={`${floors} Geschosse`} tint="text-amber-500" />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Compliance-Check</span>
              <Badge className={`${verdictStyle} text-white`}>
                {check.verdict}{check.score !== null ? ` · ${check.score} %` : ""}
              </Badge>
            </CardTitle>
            <p className="text-[11px] text-slate-500">
              {check.checked} von {check.total} Regeln geprüft
              {check.unchecked > 0 && ` · ${check.unchecked} ohne hinterlegte Vorgabe (zählt nicht in den Score)`}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {check.items.map((it) => {
              const s = STATUS_STYLE[it.status];
              return (
                <div key={it.key} className="flex items-center gap-3 rounded-lg border p-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800">{it.label}</div>
                    <div className="text-[11px] text-slate-500">{it.detail}</div>
                  </div>
                  <Badge className={`${s.color} shrink-0`}>{s.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
