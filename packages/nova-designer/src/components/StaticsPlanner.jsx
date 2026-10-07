import React, { useEffect, useMemo, useState } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Frame, Layers, Mountain, Building2, AlertTriangle, Boxes, Activity,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  LOAD_CATEGORIES, BETON_GRADES,
  deckenstaerke, gesamtlast, gebaeudelast, gruendungslast,
  betonFcd, stuetzenVordim, bewehrungMasse, betonvolumenDecken, vorbemessungChecks,
} from "@designer/lib/statics";
import { useBuildingProgram, programMetrics, footprintWD } from "@core/lib/useBuildingProgram";
import ErdbebenSimulation from "@designer/components/ErdbebenSimulation";
// Phase 40: Tragwerk auf dem Grundriss (Lasteinzug je echter Stütze, Träger, Berechnungslauf).
import TragwerkPlan from "./TragwerkPlan";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

const BAUWEISEN = [
  "Mauerwerk", "Stahlbeton", "Holzbau", "Stahlbau", "Hybrid",
];
const TRAGSYSTEME = [
  "Wandbau (Schottenbau)", "Skelettbau (Stützen/Riegel)", "Mischsystem",
];
// value "holz" steuert deckenstaerke (l/20); alle übrigen → l/30 (flachdecke).
const DECKENSYSTEME = [
  { value: "flachdecke", label: "Stahlbeton-Flachdecke" },
  { value: "plattenbalken", label: "Stahlbeton-Plattenbalkendecke" },
  { value: "hohldielen", label: "Hohldielen" },
  { value: "holz", label: "Holz-Balkendecke" },
  { value: "clt", label: "Brettsperrholz (CLT)" },
];
const AUSSTEIFUNGEN = [
  "Treppenhaus-/Aufzugskern", "Aussteifende Wände (Scheiben)", "Verbände (Stahl)", "Rahmen",
];
const GRUENDUNGSARTEN = [
  "Flachgründung (Streifen)", "Flachgründung (Platte/Bodenplatte)", "Tiefgründung (Pfähle)",
];

export default function StaticsPlanner() {
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const { d } = footprintWD(store.footprintM);

  // Lokaler State (useState only — keine DB, kein bitApi, kein store.set).
  const [bauweise, setBauweise] = usePanelState("statics:bauweise", "Stahlbeton");
  const [tragsystem, setTragsystem] = usePanelState("statics:tragsystem", "Skelettbau (Stützen/Riegel)");
  const [deckensystem, setDeckensystem] = usePanelState("statics:deckensystem", "flachdecke");
  const [aussteifung, setAussteifung] = usePanelState("statics:aussteifung", "Treppenhaus-/Aufzugskern");

  const [spannweite, setSpannweite] = usePanelState("statics:spannweite", Math.round(d) || 14);
  const [spannweiteDirty, setSpannweiteDirty] = usePanelState("statics:spannweiteDirty", false);

  const [nutzungskategorie, setNutzungskategorie] = usePanelState("statics:nutzungskategorie", "A");
  const [qk, setQk] = usePanelState("statics:qk", LOAD_CATEGORIES.A.qk);
  const [qkDirty, setQkDirty] = usePanelState("statics:qkDirty", false);
  const [gk, setGk] = usePanelState("statics:gk", 5.0);
  const [dg, setDg] = usePanelState("statics:dg", 1.5);
  const [schneezone, setSchneezone] = usePanelState("statics:schneezone", "2");
  const [sk, setSk] = usePanelState("statics:sk", 0.85);
  const [windzone, setWindzone] = usePanelState("statics:windzone", "2");

  const [gruendungsart, setGruendungsart] = usePanelState("statics:gruendungsart", "Flachgründung (Platte/Bodenplatte)");
  const [zulSohldruck, setZulSohldruck] = usePanelState("statics:zulSohldruck", 200);
  const [grundwasser, setGrundwasser] = usePanelState("statics:grundwasser", "nein");

  const [betonguete, setBetonguete] = usePanelState("statics:betonguete", "C25/30");
  const [erdbebenzone, setErdbebenzone] = usePanelState("statics:erdbebenzone", "0");
  const [simOpen, setSimOpen] = useState(false);

  // Spannweite aus Gebäudetiefe vorbelegen — nur solange Nutzer:in nichts geändert hat.
  useEffect(() => {
    if (!spannweiteDirty && d > 0) setSpannweite(Math.round(d));
  }, [d, spannweiteDirty, setSpannweite]);

  // Kategoriewechsel setzt qk nur, wenn qk nicht manuell überschrieben wurde.
  const onKategorie = (k) => {
    setNutzungskategorie(k);
    if (!qkDirty) setQk(LOAD_CATEGORIES[k]?.qk ?? 2.0);
  };

  const kpi = useMemo(() => {
    const dicke = deckenstaerke(spannweite, deckensystem === "holz" || deckensystem === "clt" ? "holz" : "flachdecke", false);
    const gPro = gesamtlast({ gk, dg, qk, footArea: pm.footArea });
    const N = gebaeudelast(gPro, pm.storeys);
    const sigma = gruendungslast({ N, footArea: pm.footArea });
    const fcd = betonFcd(betonguete);
    const Ac = stuetzenVordim({ gesamtlastProGeschoss: gPro, storeys: pm.storeys, footArea: pm.footArea, einzugA: spannweite * spannweite, fcd });
    const vol = betonvolumenDecken(dicke, pm.bgf);
    const bewehr = bewehrungMasse(vol, "decke");
    const checks = vorbemessungChecks({ sigma, zulSohldruck, gesamtlastProGeschoss: gPro, storeys: pm.storeys, footArea: pm.footArea });
    return { dicke, gPro, N, sigma, Ac, vol, bewehr, checks };
  }, [spannweite, deckensystem, gk, dg, qk, betonguete, zulSohldruck, pm.footArea, pm.storeys, pm.bgf]);

  const sohl = kpi.checks.items.find((i) => i.key === "sohldruck");
  const sohlStyle = STATUS_STYLE[sohl?.status || "warn"];

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Vorbemessung / Richtwerte — kein Standsicherheitsnachweis nach Eurocode.</strong>{" "}
          Tragwerksplanung durch Fachplaner:in erforderlich.
        </span>
      </div>

      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · Höhe {de(pm.height)} m · Grundfläche {de(pm.footArea)} m²
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eingabe-Cards */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Frame className="w-4 h-4" /> Tragsystem & Bauweise</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Bauweise</label>
                <Select value={bauweise} onValueChange={setBauweise}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BAUWEISEN.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Tragsystem</label>
                <Select value={tragsystem} onValueChange={setTragsystem}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TRAGSYSTEME.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Deckensystem</label>
                <Select value={deckensystem} onValueChange={setDeckensystem}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DECKENSYSTEME.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Aussteifung</label>
                <Select value={aussteifung} onValueChange={setAussteifung}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{AUSSTEIFUNGEN.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4" /> Decken & Spannweiten</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <NumberField label="Maßgebende Stützweite" value={spannweite} suffix="m" min={0} onChange={(v) => { setSpannweite(v); setSpannweiteDirty(true); }} />
              </div>
              <Stat label="Geschossanzahl" value={de(pm.storeys)} accent="text-slate-700" />
              <Stat label="Geschosshöhe (m)" value={pm.storeyHeight?.toLocaleString("de-DE")} accent="text-slate-700" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Boxes className="w-4 h-4" /> Lasten</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Nutzungskategorie</label>
                <Select value={nutzungskategorie} onValueChange={onKategorie}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LOAD_CATEGORIES).map(([k, c]) => <SelectItem key={k} value={k}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <NumberField label="Nutzlast qk (kN/m²)" value={qk} min={0} onChange={(v) => { setQk(v); setQkDirty(true); }} />
              <NumberField label="Eigenlast Decke gk (kN/m²)" value={gk} min={0} onChange={setGk} />
              <NumberField label="Ausbaulast Δg (kN/m²)" value={dg} min={0} onChange={setDg} />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Schneelastzone</label>
                <Select value={schneezone} onValueChange={setSchneezone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["1", "2", "3"].map((o) => <SelectItem key={o} value={o}>Zone {o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <NumberField label="sk Schneelast (kN/m²)" value={sk} min={0} onChange={setSk} />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Windzone</label>
                <Select value={windzone} onValueChange={setWindzone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["1", "2", "3", "4"].map((o) => <SelectItem key={o} value={o}>WZ {o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Mountain className="w-4 h-4" /> Gründung & Baugrund</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Gründungsart</label>
                <Select value={gruendungsart} onValueChange={setGruendungsart}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{GRUENDUNGSARTEN.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <NumberField label="zul. Sohldruck" value={zulSohldruck} suffix="kN/m²" min={0} onChange={setZulSohldruck} />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Grundwasserstand relevant</label>
                <Select value={grundwasser} onValueChange={setGrundwasser}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nein">nein</SelectItem>
                    <SelectItem value="ja">ja (Auftrieb prüfen)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4" /> Material & Erdbeben</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Betongüte</label>
                <Select value={betonguete} onValueChange={setBetonguete}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(BETON_GRADES).map(([k, g]) => <SelectItem key={k} value={k}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Betonstahl</label>
                <Select value="B500B" disabled>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="B500B">B500B</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Erdbebenzone (EC8 / früher DIN 4149)</label>
                <Select value={erdbebenzone} onValueChange={setErdbebenzone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["0", "1", "2", "3"].map((o) => <SelectItem key={o} value={o}>Zone {o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <button
                type="button"
                onClick={() => setSimOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                <Activity className="w-4 h-4" /> Erdbeben-Simulation starten
              </button>
            </CardContent>
          </Card>
        </div>

        {/* KPIs + Sohldruck-Check */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Deckenstärke (Richtwert)" value={`${de(kpi.dicke)} cm`} accent="text-blue-600" />
            <Stat label="Gesamtlast/Geschoss (Richtwert)" value={`${de(kpi.gPro)} kN`} accent="text-slate-800" />
            <Stat label="Vertikale Gebäudelast (Richtwert)" value={`${de(kpi.N)} kN`} accent="text-slate-800" />
            <Stat label="Gründungslast σ (Richtwert)" value={`${de(kpi.sigma)} kN/m²`} accent="text-violet-600" />
            <Stat label="Stützenquerschnitt A_c (Richtwert)" value={`${de(kpi.Ac)} cm²`} accent="text-amber-600" />
            <Stat label="Bewehrung Decke (Richtwert)" value={`${de(kpi.bewehr)} kg`} accent="text-slate-800" />
            <Stat label="Betonvolumen Decken (Richtwert)" value={`${de(kpi.vol)} m³`} accent="text-slate-800" />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Mountain className="w-4 h-4" /> Sohldruck-Check (Richtwert)</span>
                <Badge className={`${sohlStyle.color}`}>{sohlStyle.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {kpi.checks.items.map((it) => {
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

      {/* Phase 40 (TRAG-01…05): Rohbau-Plan mit Lasteinzug, Trägern und Berechnungslauf */}
      <TragwerkPlan />

      <ErdbebenSimulation
        open={simOpen}
        onClose={() => setSimOpen(false)}
        zone={erdbebenzone}
        storeys={pm.storeys}
        height={pm.height}
        gebaeudelastKN={kpi.N}
      />
    </div>
  );
}
