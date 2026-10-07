import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Loader2, Layers, Home, Gauge, Car, Check, Wand2, Trophy } from "lucide-react";
import { InvokeLLM } from "@core/integrations/Core";
import { useProject } from "@core/lib/ProjectContext";
import { computeMix, checkCompliance, unitInfo } from "@designer/lib/compliance";
import { useBuildingProgram, rectFootprint, programMetrics } from "@core/lib/useBuildingProgram";

const m2 = (n) => `${Math.round(n).toLocaleString("de-DE")} m²`;

// Deterministic design strategies — geometry & mix vary; metrics are computed
// exactly so the comparison is trustworthy. The LLM adds ranking + rationale.
const STRATEGIES = [
  { key: "hochpunkt", name: "Kompakter Hochpunkt", grz: 0.25, desc: "Schlanker Fußabdruck, mehr Geschosse, viel Freifläche.",
    mix: [{ type: "studio", share: 10 }, { type: "t1", share: 30 }, { type: "t2", share: 45 }, { type: "t3", share: 15 }] },
  { key: "block", name: "Urbaner Block", grz: 0.40, desc: "Blockrand-Typologie, ausgewogener Mix, mittlere Höhe.",
    mix: [{ type: "t1", share: 15 }, { type: "t2", share: 40 }, { type: "t3", share: 35 }, { type: "t4", share: 10 }] },
  { key: "hoefe", name: "Familienhöfe", grz: 0.35, desc: "Größere Wohnungen, niedrigere Höhe, Hofqualität.",
    mix: [{ type: "t2", share: 25 }, { type: "t3", share: 45 }, { type: "t4", share: 30 }] },
  { key: "dichte", name: "Maximale Dichte", grz: 0.45, desc: "Hohe Ausnutzung, kompakte Einheiten.",
    mix: [{ type: "studio", share: 20 }, { type: "t1", share: 40 }, { type: "t2", share: 30 }, { type: "t3", share: 10 }] },
];

// score kann null sein (keine einzige Regel prüfbar) — dann neutral darstellen.
const scoreColor = (n) => (n === null || n === undefined ? "text-slate-400" : n >= 75 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
const scoreLabel = (n) => (n === null || n === undefined ? "—" : `${n} %`);
// Sortier-Schlüssel: ungeprüfte Varianten nicht vor geprüfte einsortieren.
const scoreKey = (v) => (v.check.score === null ? -1 : v.check.score);

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    recommendation: { type: "string", description: "Welche Variante empfiehlst du und warum (1-2 Sätze)?" },
    assessments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          comment: { type: "string", description: "1 Satz fachliche Einschätzung" },
        },
      },
    },
  },
};

// Fallback nur, solange kein Grundstück gezeichnet/gespeichert ist (KD-11).
const SITE_AREA_FALLBACK = 3500;

export default function GenerativeLayout({ siteArea: siteAreaProp = null }) {
  const { projectId, project } = useProject();
  const store = useBuildingProgram(); // gemeinsame Quelle: Footprint + Geschosse
  const metrics = programMetrics(store);
  const [recId, setRecId] = useState(null);
  const [siteArea, setSiteArea] = useState(siteAreaProp ?? SITE_AREA_FALLBACK);
  const [siteAreaAssumed, setSiteAreaAssumed] = useState(siteAreaProp == null);
  const [residentialNUF, setResidentialNUF] = useState(4500);
  const [efficiency, setEfficiency] = useState(0.8);
  const [parkKey, setParkKey] = useState(1.0);
  const [gfzLimit, setGfzLimit] = useState(1.2);
  // null = keine GRZ-Grenze hinterlegt ⇒ Regel „nicht geprüft" (KD-03).
  const [grzLimit, setGrzLimit] = useState(null);
  const [maxFloors, setMaxFloors] = useState(10);
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState(null); // { recommendation, byKey }
  const [adopted, setAdopted] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    bitApi.entities.SpaceProgram.filter({ project_id: projectId }).then((rows) => {
      const sp = rows[0];
      if (!sp) return;
      setRecId(sp.id);
      if (sp.site_area != null) { setSiteArea(sp.site_area); setSiteAreaAssumed(false); }
      setEfficiency(sp.efficiency ?? 0.8);
      const wohnen = (sp.items || []).find((i) => i.use === "wohnen");
      if (wohnen) setResidentialNUF((wohnen.area || 70) * (wohnen.count || 0));
    });
  }, [projectId]);

  // Gezeichnete Grundstücksfläche aus der Baufeld-Planung übernehmen.
  useEffect(() => {
    if (siteAreaProp > 0) { setSiteArea(siteAreaProp); setSiteAreaAssumed(false); }
  }, [siteAreaProp]);

  // Compute all variants with exact metrics.
  const variants = useMemo(() => {
    return STRATEGIES.map((s) => {
      const footprint = Math.max(50, Math.round(s.grz * siteArea));
      const mixR = computeMix(residentialNUF, s.mix);
      const bgf = mixR.livingArea / Math.max(0.3, efficiency);
      const floors = Math.max(1, Math.ceil(bgf / footprint));
      const units = mixR.units;
      const parkingProvided = Math.ceil(units * parkKey); // each variant provides its own
      const check = checkCompliance({ siteArea, footprint, bgf, floors, units, parkingProvided, parkKey, gfzLimit, grzLimit, maxFloors, mixRows: mixR.rows });
      return { ...s, footprint, floors, bgf, units, avg: mixR.avg, mixRows: mixR.rows, check, density: siteArea ? units / (siteArea / 10000) : 0 };
    });
  }, [siteArea, residentialNUF, efficiency, parkKey, gfzLimit, grzLimit, maxFloors]);

  const generate = async () => {
    setLoading(true); setAi(null);
    try {
      const summary = variants.map((v) => ({
        key: v.key, name: v.name, strategie: v.desc,
        geschosse: v.floors, grz: +v.check.grz.toFixed(2), gfz: +v.check.gfz.toFixed(2),
        wohneinheiten: v.units, ø_wohnung_m2: Math.round(v.avg), dichte_we_ha: Math.round(v.density),
        compliance_score: v.check.score, geprueft: `${v.check.checked}/${v.check.total}`, konform: v.check.verdict,
      }));
      const prompt =
        `Du bist Städtebau-/Wohnungsbau-Experte (BauNVO, GRZ/GFZ, Wohnungsmix). ` +
        `Bewerte die folgenden automatisch erzeugten Entwurfsvarianten für „${project?.name || "das Projekt"}" ` +
        `und gib eine klare Empfehlung. Antworte auf Deutsch.\n\nVarianten:\n${JSON.stringify(summary, null, 2)}`;
      const res = await InvokeLLM({ prompt, response_json_schema: VARIANT_SCHEMA, add_context_from_internet: false });
      const obj = typeof res === "string" ? JSON.parse(res) : res;
      const byKey = {};
      (obj.assessments || []).forEach((a) => { byKey[a.key] = a.comment; });
      setAi({ recommendation: obj.recommendation || "", byKey });
    } catch {
      // graceful fallback: heuristic recommendation (highest compliance, then most units)
      const best = [...variants].sort((a, b) => scoreKey(b) - scoreKey(a) || b.units - a.units)[0];
      const byKey = Object.fromEntries(variants.map((v) => [v.key, v.desc]));
      setAi({ recommendation: `Heuristische Empfehlung: „${best.name}" (höchste Compliance bei guter Ausnutzung).`, byKey, fallback: true });
    }
    setLoading(false);
  };

  const adopt = async (v) => {
    if (!projectId) return;
    const items = [
      { use: "parken", area: 25, count: Math.ceil(v.units * parkKey) },
      { use: "wohnen", area: Math.round(v.avg) || 70, count: v.units },
    ];
    const payload = { project_id: projectId, footprint: v.footprint, site_area: siteArea, efficiency, items };
    if (recId) await bitApi.entities.SpaceProgram.update(recId, payload);
    else { const r = await bitApi.entities.SpaceProgram.create(payload); setRecId(r.id); }
    // Zusätzlich in die gemeinsame Quelle (Gebäudemodell/Massing) schreiben:
    // Grundfläche der Variante als Rechteck mit Seitenverhältnis 1.4:1
    // (w * d = footprint, w = 1.4 * d => d = sqrt(footprint / 1.4)).
    const depth = Math.sqrt(v.footprint / 1.4);
    const width = 1.4 * depth;
    store.set({ footprintM: rectFootprint(width, depth), storeys: v.floors });
    setAdopted(v.key);
    toast.success(`Variante „${v.name}" ins Raumprogramm übernommen`);
    toast.success("In Gebäudemodell & Massing übernommen");
  };

  // best score for highlighting
  const bestKey = useMemo(() => {
    if (!variants.length) return null;
    return [...variants].sort((a, b) => scoreKey(b) - scoreKey(a) || b.units - a.units)[0].key;
  }, [variants]);

  return (
    <div className="space-y-4">
      {/* Stand aus der gemeinsamen Quelle (Gebäudemodell/Massing) */}
      {metrics.footArea > 0 && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs border-emerald-300 bg-emerald-50 text-emerald-700">
            Aus Gebäudemodell: BGF {m2(metrics.bgf)} · {metrics.storeys} Geschosse
          </Badge>
        </div>
      )}

      {/* Controls */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Grundstück m²{siteAreaAssumed && <span className="text-amber-600"> (Annahme)</span>}</label>
            <Input className="w-28" type="number" value={siteArea} onChange={(e) => { setSiteArea(Number(e.target.value)); setSiteAreaAssumed(false); }} />
          </div>
          <div><label className="text-xs text-slate-500 block mb-1">Wohn-NUF m²</label><Input className="w-28" type="number" value={residentialNUF} onChange={(e) => setResidentialNUF(Number(e.target.value))} /></div>
          <div><label className="text-xs text-slate-500 block mb-1">GFZ-Grenze</label><Input className="w-24" type="number" step="0.1" value={gfzLimit} onChange={(e) => setGfzLimit(Number(e.target.value))} /></div>
          <div><label className="text-xs text-slate-500 block mb-1">GRZ-Grenze</label><Input className="w-24" type="number" step="0.05" placeholder="—" value={grzLimit ?? ""} onChange={(e) => setGrzLimit(e.target.value === "" ? null : Number(e.target.value))} /></div>
          <div><label className="text-xs text-slate-500 block mb-1">Max. Gesch.</label><Input className="w-24" type="number" value={maxFloors} onChange={(e) => setMaxFloors(Number(e.target.value))} /></div>
          <Button onClick={generate} disabled={loading || !projectId} className="bg-gradient-to-r from-emerald-600 to-teal-600 ml-auto">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
            {loading ? "KI bewertet…" : "Varianten generieren & bewerten"}
          </Button>
        </CardContent>
      </Card>

      {ai?.recommendation && (
        <Card className="border-0 bg-gradient-to-br from-purple-50 to-indigo-50">
          <CardContent className="p-4 flex gap-3">
            <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-800">KI-Empfehlung{ai.fallback ? " (offline)" : ""}</div>
              <p className="text-sm text-slate-600">{ai.recommendation}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Variant cards */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {variants.map((v) => {
          const isBest = v.key === bestKey;
          const isAdopted = v.key === adopted;
          return (
            <Card key={v.key} className={`relative ${isBest ? "ring-2 ring-emerald-400" : ""}`}>
              {isBest && <Badge className="absolute -top-2 left-3 bg-emerald-500 text-white"><Trophy className="w-3 h-3 mr-1" /> Top</Badge>}
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{v.name}</CardTitle>
                <p className="text-[11px] text-slate-500">{v.desc}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* mini stacking */}
                <div className="flex flex-col-reverse gap-0.5">
                  {Array.from({ length: Math.min(v.floors, 12) }).map((_, i) => (
                    <div key={i} className="h-1.5 rounded-sm bg-blue-400" style={{ width: `${30 + (i * 60) / Math.max(1, Math.min(v.floors, 12))}%` }} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded bg-slate-50 py-1.5"><div className="text-sm font-bold text-slate-800">{v.units}</div><div className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><Home className="w-3 h-3" />WE</div></div>
                  <div className="rounded bg-slate-50 py-1.5"><div className="text-sm font-bold text-slate-800">{v.floors}</div><div className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><Layers className="w-3 h-3" />Gesch.</div></div>
                  <div className="rounded bg-slate-50 py-1.5"><div className="text-sm font-bold text-slate-800">{v.check.gfz.toFixed(2)}</div><div className="text-[10px] text-slate-500">GFZ</div></div>
                  <div className="rounded bg-slate-50 py-1.5"><div className="text-sm font-bold text-slate-800">{v.check.grz.toFixed(2)}</div><div className="text-[10px] text-slate-500">GRZ</div></div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 flex items-center gap-1"><Car className="w-3 h-3" /> {Math.ceil(v.units * parkKey)} SP</span>
                  <span className="text-slate-500">Ø {Math.round(v.avg)} m²</span>
                  <span className={`font-semibold flex items-center gap-1 ${scoreColor(v.check.score)}`}><Gauge className="w-3 h-3" />{scoreLabel(v.check.score)}</span>
                </div>
                {ai?.byKey?.[v.key] && <p className="text-[11px] text-slate-500 border-t pt-2">{ai.byKey[v.key]}</p>}
                <Button size="sm" variant={isAdopted ? "default" : "outline"} className={`w-full ${isAdopted ? "bg-emerald-600" : ""}`} onClick={() => adopt(v)}>
                  <Check className="w-3.5 h-3.5 mr-1" /> {isAdopted ? "Übernommen" : "Übernehmen"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400">
        Kennzahlen werden exakt aus Grundstück, Wohn-NUF und Strategie berechnet; die KI liefert Ranking & Begründung.
        „Übernehmen" schreibt Fußabdruck + Wohnprogramm ins Raumprogramm und in Gebäudemodell & Massing (gemeinsame Quelle).
      </p>
    </div>
  );
}
