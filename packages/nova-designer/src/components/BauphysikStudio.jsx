import React, { useEffect, useMemo } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { NumberField, Stat } from "@core/components/Field";
import {
  Layers, AlertTriangle, ThermometerSun, Droplets, ArrowUp, ArrowDown, X, Plus, Wind,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceArea,
} from "recharts";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { WALL_COMPOSITES, compositeById } from "@core/lib/buildingModel";
import {
  MATERIAL_KATALOG, materialById, aufbauFromComposite,
  glaser, taupunktAusLuft, bauphysikChecks, U_REFERENZ_AUSSENWAND,
} from "@designer/lib/bauteilAufbau";
import { useProject } from "@core/lib/ProjectContext";
import { useSiteClimate } from "@designer/lib/useSiteClimate";
import { usePlanModel } from "@designer/lib/usePlanModel";

// de-DE-Formatter: de1 (°C, dB) · de2 (U, f_Rsi, R) · de3 nur wo nötig.
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// STATUS_STYLE kennt nur pass/warn/fail — "offen" lokal ergänzt (WB_STATUS-Muster,
// WaermebrueckenPlanner.jsx). "fail" wird in diesem Panel bewusst NIE gerendert.
const BP_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

// ---- Schichtstapel-SVG ------------------------------------------------------
// Rendert den Aufbau innen (links) → außen (rechts) maßstäblich, mit dem bislang
// ungenutzten hatch-Feld der Kataloge als SVG-Pattern. Tauwasser-Zonen (x in mm
// ab innerer Oberfläche, deckungsgleich mit den wirksamen Schichten) rot markiert;
// hinterlüftete Schichten abgedimmt (außenklimagleich).
function SchichtStapel({ layers, zonen, abgeschnittenAb }) {
  const W = 720, H = 210, M = 46, TOP = 26, BH = 130;
  const totalD = layers.reduce((s, l) => s + (Number(l.d) || 0), 0);
  if (!layers.length || totalD <= 0) {
    return <div className="text-sm text-slate-500 py-8 text-center">Keine Schichten — Aufbau wählen oder Schicht hinzufügen.</div>;
  }
  const sx = (W - 2 * M) / totalD;
  let x = M;
  const rects = layers.map((l, i) => {
    const mat = materialById(l.material);
    const w = (Number(l.d) || 0) * sx;
    const r = { x, w, mat, l, i, dim: abgeschnittenAb >= 0 && i >= abgeschnittenAb };
    x += w;
    return r;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Schichtaufbau">
      <defs>
        <pattern id="bp-concrete" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#475569" strokeWidth="0.7" />
          <circle cx="4" cy="3" r="0.7" fill="#475569" />
        </pattern>
        <pattern id="bp-brick" width="12" height="8" patternUnits="userSpaceOnUse">
          <rect width="12" height="8" fill="none" />
          <line x1="0" y1="0" x2="12" y2="0" stroke="#7c2d12" strokeWidth="0.7" />
          <line x1="6" y1="0" x2="6" y2="8" stroke="#7c2d12" strokeWidth="0.7" />
        </pattern>
        <pattern id="bp-insul" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 4 Q2 0 4 4 T8 4" fill="none" stroke="#b45309" strokeWidth="0.8" />
        </pattern>
        <pattern id="bp-block" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#475569" strokeWidth="0.6" />
        </pattern>
        <pattern id="bp-wood" width="6" height="6" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#713f12" strokeWidth="0.6" />
        </pattern>
      </defs>
      <text x={M - 8} y={TOP + BH / 2} textAnchor="end" fontSize="11" fontWeight="600" className="fill-rose-600">innen</text>
      <text x={W - M + 8} y={TOP + BH / 2} textAnchor="start" fontSize="11" fontWeight="600" className="fill-sky-600">außen</text>
      {rects.map((r) => (
        <g key={r.i} opacity={r.dim ? 0.45 : 1}>
          <rect x={r.x} y={TOP} width={r.w} height={BH} fill={r.mat?.color || "#f8fafc"} stroke="#334155" strokeWidth="0.8" />
          {r.mat && r.mat.hatch !== "none" && (
            <rect x={r.x} y={TOP} width={r.w} height={BH} fill={`url(#bp-${r.mat.hatch})`} stroke="none" />
          )}
          <title>{`${r.mat?.name || r.l.name || "unbekannt"} · ${r.l.d} mm`}</title>
          {r.w > 26 && (
            <text x={r.x + r.w / 2} y={TOP + BH / 2} textAnchor="middle" fontSize="9" className="fill-slate-800"
              transform={`rotate(-90 ${r.x + r.w / 2} ${TOP + BH / 2})`}>
              {(r.mat?.name || r.l.name || "?").slice(0, 24)}
            </text>
          )}
          <text x={r.x + r.w / 2} y={TOP + BH + 14} textAnchor="middle" fontSize="9" className="fill-slate-500">{r.l.d}</text>
        </g>
      ))}
      {/* Tauwasser-Zonen (x mm → Stapel-Koordinaten; wirksame Schichten = Präfix) */}
      {(zonen || []).map((z, i) => (
        <g key={`z${i}`}>
          <rect x={M + z.vonMm * sx} y={TOP} width={Math.max(2, (z.bisMm - z.vonMm) * sx)} height={BH}
            fill="#f43f5e" opacity="0.3" stroke="#e11d48" strokeWidth="1" strokeDasharray="4 2" />
          <text x={M + ((z.vonMm + z.bisMm) / 2) * sx} y={TOP - 8} textAnchor="middle" fontSize="10" fontWeight="700" className="fill-rose-600">Tauwasser</text>
        </g>
      ))}
      <text x={M} y={TOP + BH + 30} fontSize="9" className="fill-slate-400">Dicken in mm, maßstäblich · Gesamt {totalD} mm</text>
    </svg>
  );
}

// Session-eindeutige uid je Schichtzeile: key={i} ließe bei move/remove
// DOM-Zustand (Fokus, offene Selects, uncommitted Eingaben) an der falschen
// Zeile kleben. Bewusst KEINE WeakMap über Objektidentität — setLayer erzeugt
// bei jedem Tastendruck ein neues Objekt (Remount = Fokusverlust beim Tippen).
let layerUid = 0;
const mitUid = (l) => (l._uid ? l : { ...l, _uid: ++layerUid });

export default function BauphysikStudio() {
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const klima = useSiteClimate(project?.location);

  // Wandaufbau des Gebäudemodells (BitBimStudio-Hülle), falls dort gewählt.
  const modellCompositeId = plan.model?.walls?.[0]?.composite || null;

  // --- Panel-State ("bauphysik:"-Präfix — modulweiter panelCache) -----------------
  const [quelle, setQuelle] = usePanelState("bauphysik:quelle", "modell");
  const [layers, setLayers] = usePanelState("bauphysik:layers", null); // null = noch nie initialisiert
  const [thetaI, setThetaI] = usePanelState("bauphysik:thetaI", 20);
  const [phiI, setPhiI] = usePanelState("bauphysik:phiI", 50);
  const [thetaE, setThetaE] = usePanelState("bauphysik:thetaE", -5);
  const [thetaEDirty, setThetaEDirty] = usePanelState("bauphysik:thetaEDirty", false);
  const [phiE, setPhiE] = usePanelState("bauphysik:phiE", 80);

  // Kältester Monat aus dem Standort-Klima als θe-Vorschlag (Dirty-Schutz).
  // Monate ohne Daten (temp: null vom Proxy) ausfiltern — null gewänne sonst
  // an milden Standorten als "kältester" Monat und setzte θe = 0.
  const kaeltester = useMemo(() => {
    const gueltig = (klima.months || []).filter((m) => Number.isFinite(m.temp));
    if (!gueltig.length) return null;
    return gueltig.reduce((min, m) => (m.temp < min.temp ? m : min), gueltig[0]);
  }, [klima.months]);

  useEffect(() => {
    if (!thetaEDirty && kaeltester) setThetaE(Math.round(kaeltester.temp));
  }, [kaeltester, thetaEDirty, setThetaE]);

  // Aufbau-Initialisierung aus der gewählten Quelle.
  const quellComposite = quelle === "eigen" ? null
    : compositeById(quelle === "modell" ? (modellCompositeId || "cavity") : quelle);

  // Nicht-eigene Aufbauten folgen ihrer Quelle: der BimModel-Load trifft asynchron
  // ein (Init-once sähe immer den "cavity"-Fallback) und der Projektwechsel tauscht
  // das Composite. Handänderungen setzen quelle="eigen" (editLayers) und sind damit
  // geschützt; quellComposite ist referenzstabil (Modul-Konstante aus WALL_COMPOSITES),
  // der Effekt feuert also nur bei echtem Quellwechsel.
  useEffect(() => {
    if (quelle !== "eigen" && quellComposite) setLayers(aufbauFromComposite(quellComposite).layers.map(mitUid));
  }, [quelle, quellComposite, setLayers]);

  // Projekt-Guard: panelCache ist modulweit und überlebt den Projektwechsel —
  // projektfremde Dirty-/Eigen-Zustände zurücksetzen (θe-Vorschlag greift wieder,
  // ein im alten Projekt gebauter Eigen-Aufbau geht zurück auf "modell" und wird
  // oben aus der neuen Quelle re-initialisiert). Tab-Wechsel im selben Projekt
  // bleibt unangetastet.
  const [bpProjekt, setBpProjekt] = usePanelState("bauphysik:projekt", project?.id ?? null);
  useEffect(() => {
    if (project?.id && bpProjekt !== project.id) {
      setBpProjekt(project.id);
      setThetaEDirty(false);
      if (quelle === "eigen") setQuelle("modell");
    }
  }, [project?.id, bpProjekt, quelle, setBpProjekt, setThetaEDirty, setQuelle]);

  const aktSchichten = useMemo(() => layers || [], [layers]);

  const onQuelle = (v) => {
    setQuelle(v);
    const c = compositeById(v === "modell" ? (modellCompositeId || "cavity") : v);
    if (c) setLayers(aufbauFromComposite(c).layers.map(mitUid));
  };
  // Jede Handänderung macht den Aufbau zum "eigenen" (ehrliche Select-Anzeige).
  const editLayers = (next) => {
    setLayers(next);
    if (quelle !== "eigen") setQuelle("eigen");
  };
  const setLayer = (i, patch) => editLayers(aktSchichten.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const moveLayer = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= aktSchichten.length) return;
    const next = [...aktSchichten];
    [next[i], next[j]] = [next[j], next[i]];
    editLayers(next);
  };
  const removeLayer = (i) => editLayers(aktSchichten.filter((_, k) => k !== i));
  const addLayer = (innen) => {
    const neu = mitUid({ material: "mw035", d: 100 });
    editLayers(innen ? [neu, ...aktSchichten] : [...aktSchichten, neu]);
  };

  // --- Rechnen -----------------------------------------------------------------
  const g = useMemo(
    () => glaser(aktSchichten, { thetaI, phiI, thetaE, phiE }),
    [aktSchichten, thetaI, phiI, thetaE, phiE],
  );
  const checks = useMemo(
    () => bauphysikChecks({ U: g.U, tauwasser: g.tauwasser, fRsi: g.fRsi, hatSchichten: aktSchichten.length > 0, hatUnbekannte: g.hatUnbekannte, glaserOffen: g.glaserOffen }),
    [g, aktSchichten.length],
  );
  const ampelStyle = BP_STATUS[checks.ampel] || BP_STATUS.offen;
  const tpInnen = taupunktAusLuft(thetaI, phiI);
  const abgeschnittenAb = g.belueftet ? aktSchichten.findIndex((l) => materialById(l.material)?.luft === "belueftet") : -1;

  const chartData = useMemo(
    () => g.punkte.map((p) => ({ x: Math.round(p.xMm * 10) / 10, theta: Math.round(p.theta * 10) / 10, taupunkt: Math.round(p.taupunkt * 10) / 10 })),
    [g.punkte],
  );

  return (
    <div className="space-y-4">
      {/* Persistenter Disclaimer — Pflicht, nicht konditional */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Konzept-Richtwerte mit [ASSUMED]-Materialkennwerten (U-Wert nach d/λ-Summe, Tauwasser
          als vereinfachtes Glaser-Verfahren mit Magnus-Formel, Wand/horizontaler Wärmestrom) —
          <strong> kein Nachweis nach DIN 4108-3, DIN EN ISO 6946 oder GEG</strong>.
        </span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-teal-600" />
          <h2 className="text-lg font-bold text-slate-800">Bauphysik-Studio — Schichtaufbau, U-Wert &amp; Tauwasser</h2>
        </div>
        <Badge className={ampelStyle.color}>{ampelStyle.label}</Badge>
      </div>

      {/* Aufbau + Editor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Layers className="w-4 h-4" /> Bauteilaufbau (innen → außen)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3 items-end">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">Aufbau-Quelle</div>
              <Select value={quelle} onValueChange={onQuelle}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="modell">
                    {`Aus Gebäudemodell${modellCompositeId ? ` (${compositeById(modellCompositeId)?.name || modellCompositeId})` : " (kein Aufbau gewählt → Standard)"}`}
                  </SelectItem>
                  {WALL_COMPOSITES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.rw ? ` · R'w ${c.rw} dB` : ""}</SelectItem>
                  ))}
                  <SelectItem value="eigen">Eigener Aufbau</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => addLayer(true)}><Plus className="w-4 h-4 mr-1" /> Schicht innen</Button>
              <Button variant="outline" size="sm" onClick={() => addLayer(false)}><Plus className="w-4 h-4 mr-1" /> Schicht außen</Button>
            </div>
          </div>

          <div className="space-y-2">
            {aktSchichten.map((l, i) => {
              const mat = materialById(l.material);
              return (
                <div key={l._uid ?? i} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-slate-400 text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <Select value={l.material || ""} onValueChange={(v) => setLayer(i, { material: v })}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={l.name ? `${l.name} (ohne Kennwerte)` : "Material wählen"} />
                      </SelectTrigger>
                      <SelectContent>
                        {MATERIAL_KATALOG.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}{m.lambda ? ` · λ ${de2(m.lambda).replace(",00", ",0")}` : ""}{m.sd != null ? ` · sd ${m.sd} m` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28 shrink-0">
                    <NumberField label="" value={l.d} onChange={(v) => setLayer(i, { d: Math.max(0, v) })} suffix="mm" min={0} />
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveLayer(i, -1)} disabled={i === 0} aria-label="nach innen"><ArrowUp className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveLayer(i, 1)} disabled={i === aktSchichten.length - 1} aria-label="nach außen"><ArrowDown className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => removeLayer(i)} aria-label="entfernen"><X className="w-4 h-4" /></Button>
                  {mat?.luft === "belueftet" && <Badge variant="outline" className="text-sky-600 border-sky-200 shrink-0"><Wind className="w-3 h-3 mr-1" />belüftet</Badge>}
                </div>
              );
            })}
          </div>

          <SchichtStapel layers={aktSchichten} zonen={g.zonen} abgeschnittenAb={abgeschnittenAb} />
          {g.belueftet && (
            <div className="text-xs text-slate-500">
              Ab der belüfteten Luftschicht liegt Außenklima an — Schicht {abgeschnittenAb + 1} und alles Äußere
              zählen nicht zu U-Wert/Tauwasser (abgedimmt dargestellt), R_se wird durch R_si ersetzt.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Klima-Randbedingungen */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><ThermometerSun className="w-4 h-4" /> Klima-Randbedingungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* [ASSUMED] φ ≥ 5 % — Leereingabe-Schutz: leeres NumberField liefert 0,
                Taupunkt(φ=0) ≈ −130 °C staucht sonst Stat + Diagramm-Y-Achse. */}
            <NumberField label="Innen-Temperatur" value={thetaI} onChange={setThetaI} suffix="°C" />
            <NumberField label="Innen-Feuchte" value={phiI} onChange={(v) => setPhiI(Math.max(5, Math.min(100, v)))} suffix="%" min={5} />
            <NumberField label="Außen-Temperatur" value={thetaE} onChange={(v) => { setThetaE(v); setThetaEDirty(true); }} suffix="°C" />
            <NumberField label="Außen-Feuchte" value={phiE} onChange={(v) => setPhiE(Math.max(5, Math.min(100, v)))} suffix="%" min={5} />
          </div>
          {kaeltester && (
            <div className="text-xs text-slate-500">
              Standort-Klima{klima.offline ? " (offline-Näherung)" : ""}: kältester Monat {kaeltester.month} mit {de1(kaeltester.temp)} °C
              {thetaEDirty
                ? <Button variant="link" size="sm" className="h-auto p-0 pl-1 text-xs" onClick={() => { setThetaE(Math.round(kaeltester.temp)); setThetaEDirty(false); }}>übernehmen</Button>
                : " — als Außen-Temperatur übernommen."}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kennwerte */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="U-Wert (Richtwert)" value={`${de2(g.U)} W/(m²K)`} accent={g.U <= U_REFERENZ_AUSSENWAND ? "text-emerald-600" : "text-amber-600"} />
        <Stat label="R_T gesamt" value={`${de2(g.RT)} m²K/W`} />
        <Stat label="sd gesamt (wirksam)" value={`${de2(g.sdGesamt)} m`} />
        <Stat label="θ innere Oberfläche" value={`${de1(g.thetaSi)} °C`} />
        <Stat label="Taupunkt Raumluft" value={`${de1(tpInnen)} °C`} />
        <Stat label="f_Rsi (Rsi 0,25)" value={de2(g.fRsi)} accent={g.fRsi >= 0.7 ? "text-emerald-600" : "text-amber-600"} />
      </div>

      {/* Diagramm */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Droplets className="w-4 h-4" /> Temperatur &amp; Taupunkt im Querschnitt</CardTitle>
        </CardHeader>
        <CardContent>
          {g.tauwasser && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 mb-3">
              <Droplets className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Tauwasserausfall im Querschnitt möglich (Taupunkt erreicht die Bauteiltemperatur) — Aufbau prüfen. Richtwert-Aussage, kein DIN-4108-3-Nachweis.</span>
            </div>
          )}
          {chartData.length > 1 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="x" type="number" domain={[0, "dataMax"]} unit=" mm" tick={{ fontSize: 11 }}
                    label={{ value: "Bauteiltiefe ab innerer Oberfläche", position: "insideBottom", offset: -4, fontSize: 11 }} />
                  <YAxis unit=" °C" tick={{ fontSize: 11 }} width={52} />
                  <Tooltip formatter={(v, name) => [`${de1(v)} °C`, name]} labelFormatter={(x) => `Tiefe ${de1(x)} mm`} />
                  <Legend />
                  {g.zonen.map((z, i) => (
                    <ReferenceArea key={i} x1={z.vonMm} x2={z.bisMm} fill="#f43f5e" fillOpacity={0.15} />
                  ))}
                  <Line type="monotone" dataKey="theta" name="Bauteiltemperatur θ" stroke="#ea580c" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="taupunkt" name="Taupunkt (aus Dampfdruck)" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-sm text-slate-500 py-8 text-center">Schichten definieren, um den Verlauf zu sehen.</div>
          )}
        </CardContent>
      </Card>

      {/* Checks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prüfungen (Richtwerte)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.items.map((it) => {
            const s = BP_STATUS[it.status] || BP_STATUS.offen;
            return (
              <div key={it.key} className="flex items-center gap-3 rounded-lg border p-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">{it.label}</div>
                  <div className="text-xs text-slate-500">{it.detail}</div>
                </div>
                <Badge className={s.color}>{s.label}</Badge>
              </div>
            );
          })}
          {aktSchichten.length > 0 && (
            <div className="text-xs text-slate-400 pt-1">
              {g.belueftet
                ? `${aktSchichten.length} Schichten, davon ${abgeschnittenAb} wirksam (Rest hinterlüftet)`
                : `${aktSchichten.length} Schichten, alle wirksam`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
