import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Save, Layers, Building2, Maximize2, Ruler, Boxes } from "lucide-react";
import { USES, usageInfo, itemArea, autoStack, floorLabel } from "@designer/lib/spaceProgram";
import { useProject } from "@core/lib/ProjectContext";
import { programmAusBestand } from "@designer/lib/bestandsProgramm";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const m2 = (n) => `${Math.round(n).toLocaleString("de-DE")} m²`;

const DEFAULT_ITEMS = [
  { use: "parken", area: 25, count: 40 },
  { use: "handel", area: 150, count: 4 },
  { use: "buero", area: 25, count: 60 },
  { use: "wohnen", area: 70, count: 48 },
];

const Stat = ({ icon: Icon, label, value, sub, tint }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1"><Icon className={`w-3.5 h-3.5 ${tint}`} /> {label}</div>
    <div className="text-xl font-bold text-slate-800">{value}</div>
    {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
  </div>
);

// Raumprogramm / area brief → BGF, required storeys and a vertical stacking diagram.
// Fallback nur, solange kein Grundstück gezeichnet ist — dann sichtbar als Annahme.
const SITE_AREA_FALLBACK = 3500;

export default function SpaceProgram({ siteArea: siteAreaProp = null }) {
  const { projectId, project } = useProject();
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const [recId, setRecId] = useState(null);
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [footprint, setFootprint] = useState(900);
  const [siteArea, setSiteArea] = useState(siteAreaProp ?? SITE_AREA_FALLBACK);
  // true, solange der Wert weder gezeichnet noch gespeichert ist (KD-11).
  const [siteAreaAssumed, setSiteAreaAssumed] = useState(siteAreaProp == null);

  // Gezeichnete Grundstücksfläche aus der Baufeld-Planung übernehmen.
  useEffect(() => {
    if (siteAreaProp > 0) { setSiteArea(siteAreaProp); setSiteAreaAssumed(false); }
  }, [siteAreaProp]);
  const [efficiency, setEfficiency] = useState(0.8);

  useEffect(() => {
    if (!projectId) return;
    bitApi.entities.SpaceProgram.filter({ project_id: projectId }).then((rows) => {
      const r = rows[0];
      if (r) {
        setRecId(r.id);
        setItems(r.items?.length ? r.items : DEFAULT_ITEMS);
        setFootprint(r.footprint ?? 900);
        setSiteArea(r.site_area ?? siteAreaProp ?? SITE_AREA_FALLBACK);
        setSiteAreaAssumed(r.site_area == null && siteAreaProp == null);
        setEfficiency(r.efficiency ?? 0.8);
      } else {
        setRecId(null); setItems(DEFAULT_ITEMS); setFootprint(900);
        setSiteArea(siteAreaProp ?? SITE_AREA_FALLBACK); setSiteAreaAssumed(siteAreaProp == null); setEfficiency(0.8);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Geschossfläche je Geschoss aus dem Gebäudemodell übernehmen (eine Quelle),
  // sofern dort ein Footprint gesetzt ist. Aktualisiert bei Änderung des Modells.
  useEffect(() => {
    if (pm.footArea > 0) setFootprint(Math.round(pm.footArea));
  }, [pm.footArea]);

  // ---- Brücke zum IFC-Bestand (26.08.2026) ---------------------------------------
  // Bis hierher war SpaceProgram vom echten Gebäude entkoppelt: ohne eigenen Datensatz
  // fiel der Reiter auf DEFAULT_ITEMS (Wohn-Vorgaben) zurück — auch bei einem Bürobau.
  // Der Bestand wird NICHT still übernommen: er wird angeboten, mit Herkunft und Zahlen,
  // und erst auf Klick eingesetzt.
  const [bestand, setBestand] = useState(null);
  useEffect(() => {
    if (!projectId) { setBestand(null); return; }
    let weg = false;
    Promise.all([
      bitApi.entities.BimSnapshot.filter({ project_id: projectId }).catch(() => []),
      bitApi.entities.AsrRaum.filter({ project_id: projectId }).catch(() => []),
    ]).then(([snaps, asr]) => {
      if (weg) return;
      const snap = (snaps || [])[0];
      if (!snap) { setBestand(null); return; }
      const abgeleitet = programmAusBestand(snap, asr || []);
      setBestand(abgeleitet.kennzahlen.raeume > 0 ? abgeleitet : null);
    });
    return () => { weg = true; };
  }, [projectId]);

  const bestandUebernehmen = () => {
    if (!bestand?.items?.length) return;
    setItems(bestand.items);
    toast.success(`${bestand.kennzahlen.raeume} Räume aus dem IFC-Bestand übernommen `
      + `(${Math.round(bestand.kennzahlen.flaeche).toLocaleString("de-DE")} m² NUF) — „Speichern" schreibt sie ins Projekt.`);
  };

  const setItem = (i, patch) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { use: "wohnen", area: 70, count: 1 }]);
  const delItem = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));

  const totalNUF = items.reduce((s, it) => s + itemArea(it), 0);
  const stack = useMemo(() => autoStack(items, footprint, efficiency), [items, footprint, efficiency]);
  const gfz = siteArea ? stack.totalBGF / siteArea : 0;
  const grz = siteArea ? footprint / siteArea : 0;

  const save = async () => {
    const payload = { project_id: projectId, items, footprint: Number(footprint), site_area: Number(siteArea), efficiency: Number(efficiency) };
    if (recId) await bitApi.entities.SpaceProgram.update(recId, payload);
    else { const r = await bitApi.entities.SpaceProgram.create(payload); setRecId(r.id); }
    toast.success("Raumprogramm gespeichert");
  };

  return (
    <div className="space-y-4">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: BGF {Math.round(pm.bgf).toLocaleString("de-DE")} m² · {pm.storeys} Geschosse · Höhe {Math.round(pm.height).toLocaleString("de-DE")} m · Grundfläche {Math.round(pm.footArea).toLocaleString("de-DE")} m²/Geschoss
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-4">
      {/* Brief */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><Building2 className="w-4 h-4" /> Raumprogramm</span>
              <Button size="sm" onClick={save} className="bg-gradient-to-r from-emerald-600 to-teal-600"><Save className="w-3.5 h-3.5 mr-1" /> Speichern</Button>
            </CardTitle>
            {project && <p className="text-xs text-slate-400">{project.name}</p>}
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Angebot aus dem IFC-Bestand — mit Zahlen und Herkunft, damit die
                Übernahme eine Entscheidung ist und keine stille Datenänderung. */}
            {bestand && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-emerald-900">
                    <div className="font-semibold flex items-center gap-1.5">
                      <Boxes className="w-3.5 h-3.5" /> Bestand im IFC-Modell erfasst
                    </div>
                    <div className="mt-0.5 text-emerald-800">
                      {bestand.kennzahlen.raeume} Räume ·{" "}
                      {Math.round(bestand.kennzahlen.flaeche).toLocaleString("de-DE")} m² NUF ·{" "}
                      {bestand.kennzahlen.geschosse.join(", ")}
                    </div>
                    <div className="mt-1 space-y-0.5 text-[11px] text-emerald-700">
                      {bestand.gruppen.map((g) => (
                        <div key={g.gruppe}>
                          {g.label}: {g.anzahl} Räume, {Math.round(g.flaeche).toLocaleString("de-DE")} m²
                          {g.beispiele.length > 0 && (
                            <span className="text-emerald-600/70"> — z. B. {g.beispiele.slice(0, 3).join(", ")}</span>
                          )}
                        </div>
                      ))}
                      {bestand.unklassifiziert.anzahl > 0 && (
                        <div className="text-amber-700">
                          {bestand.unklassifiziert.anzahl} Räume ohne DIN-277-Gruppe
                          ({Math.round(bestand.unklassifiziert.flaeche).toLocaleString("de-DE")} m²) —
                          nicht zugeordnet, im Modell nachklassifizieren
                        </div>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 border-emerald-400 text-emerald-800"
                    onClick={bestandUebernehmen}>
                    übernehmen
                  </Button>
                </div>
                <p className="text-[10px] text-emerald-600/80">{bestand.herkunft}</p>
              </div>
            )}
            <div className="grid grid-cols-[1fr_70px_60px_90px_28px] gap-2 text-[11px] text-slate-400 px-1">
              <span>Nutzung</span><span className="text-right">m²/Einh.</span><span className="text-right">Anz.</span><span className="text-right">NUF</span><span />
            </div>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_60px_90px_28px] gap-2 items-center">
                <Select value={it.use} onValueChange={(v) => setItem(i, { use: v, area: it.area || usageInfo(v).unit })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(USES).map(([k, u]) => <SelectItem key={k} value={k}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="h-9 text-right" type="number" value={it.area} onChange={(e) => setItem(i, { area: Number(e.target.value) })} />
                <Input className="h-9 text-right" type="number" value={it.count} onChange={(e) => setItem(i, { count: Number(e.target.value) })} />
                <div className="text-right text-sm tabular-nums text-slate-600">{m2(itemArea(it))}</div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500" onClick={() => delItem(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addItem} className="w-full mt-1"><Plus className="w-3.5 h-3.5 mr-1" /> Nutzung hinzufügen</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Ruler className="w-4 h-4" /> Rahmenwerte</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500">Geschossfläche m²</label><Input type="number" value={footprint} onChange={(e) => setFootprint(Number(e.target.value))} /></div>
            <div>
              <label className="text-xs text-slate-500">Grundstück m²{siteAreaAssumed && <span className="text-amber-600"> (Annahme)</span>}</label>
              <Input type="number" value={siteArea} onChange={(e) => { setSiteArea(Number(e.target.value)); setSiteAreaAssumed(false); }} />
            </div>
            <div><label className="text-xs text-slate-500">Effizienz (NUF/BGF)</label><Input type="number" step="0.05" value={efficiency} onChange={(e) => setEfficiency(Number(e.target.value))} /></div>
          </CardContent>
        </Card>
      </div>

      {/* Result: KPIs + stacking */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat icon={Maximize2} label="NUF gesamt" value={m2(totalNUF)} tint="text-blue-500" />
          <Stat icon={Building2} label="BGF gesamt" value={m2(stack.totalBGF)} tint="text-emerald-500" />
          <Stat icon={Layers} label="Geschosse nötig" value={stack.floorsNeeded} sub={`${m2(footprint)}/Geschoss`} tint="text-violet-500" />
          <Stat icon={Layers} label="GFZ / GRZ" value={`${gfz.toFixed(2)} / ${grz.toFixed(2)}`} tint="text-amber-500" />
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4" /> Stacking (EG unten)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col-reverse gap-1">
              {stack.floors.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[11px] text-slate-400 text-right">{floorLabel(i)}</span>
                  <div className="flex-1 h-7 rounded overflow-hidden flex bg-slate-100 border">
                    {f.segments.map((s, j) => (
                      <div key={j} title={`${s.label}: ${m2(s.area)}`} style={{ width: `${(s.area / footprint) * 100}%`, background: s.color }}
                        className="h-full flex items-center justify-center text-[9px] text-white/90 overflow-hidden whitespace-nowrap">
                        {(s.area / footprint) > 0.16 ? s.label : ""}
                      </div>
                    ))}
                    {f.free > 1 && <div style={{ width: `${(f.free / footprint) * 100}%` }} className="h-full" />}
                  </div>
                </div>
              ))}
              {stack.floors.length === 0 && <p className="text-sm text-slate-400">Programm leer.</p>}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4">
              {[...new Set(items.map((it) => it.use))].map((k) => (
                <span key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="w-3 h-3 rounded-sm" style={{ background: usageInfo(k).color }} /> {usageInfo(k).label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
