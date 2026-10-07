import React, { useEffect, useMemo, useState } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Volume2, Waves, Footprints, Fan, Gauge, AlertTriangle, Compass,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  LAERMQUELLEN, RAUMARTEN, DECKENAUFBAU, TRENN_RICHTWERTE,
  TRITTSCHALL_GRENZE, TGA_GRENZE,
  laermpegelbereich, erfRwGes, schallChecks,
} from "@designer/lib/acoustics";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { useProject } from "@core/lib/ProjectContext";
import { openingTypeById, compositeById } from "@core/lib/buildingModel";
import { autoEnvOpenings } from "@designer/lib/autoOpenings";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { useFachlayer } from "@designer/lib/useFachlayer";
import {
  PLAN_RAUMARTEN, RAUMART_REIHE, RW_FENSTER_DEFAULT,
  zoneKey, effektiveRaumart, zonenAdjazenzen, fassadenBewertung, schallPlanChecks, rwUebernahme,
} from "@designer/lib/schallschutzPlan";
import { polygonSignedAreaXZ, outwardNormal } from "@designer/lib/raumklima";
import BimPlan2D from "./BimPlan2D";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

// "offen" ergänzen (WB_STATUS-Muster) — "fail" wird hier nie gerendert.
const SP_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

// Persistente Plan-Einstellungen (schallschutz_layer im BimModel, KD-17).
const PLAN_DEFAULT = {
  northAngle: 0,
  pegel: { N: 60, O: 60, S: 60, W: 60 },
  raumarten: {}, // { zoneKey: raumartId } — Default "wohnen"
  ausgenommen: [], // adjazenzKeys, per Klick als „gleiche WE" markiert
  rwFenster: RW_FENSTER_DEFAULT,
  rwTrennwand: TRENN_RICHTWERTE.wand_wohnungstrennend,
};

// Schallschutz-Plan (Phase 39, SCHALL-01/03/04): readOnly-Grundriss aus
// usePlanModel, Fassaden-Kanten nach Lärmpegel je Orientierung eingefärbt
// (R'w,res aus Katalog-Wand + Fensteranteil), wohnungstrennende Adjazenzen
// violett (Klick = „gleiche WE"-Ausnahme), Zonen-Klick schaltet die Raumart
// durch. Persistenz im exklusiven Feld "schallschutz_layer" (useFachlayer).
function SchallschutzPlanKarte({ raumart, onUebernehmen }) {
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const [layer, setLayer] = useFachlayer(project?.id, "schallschutz_layer", PLAN_DEFAULT);
  const [level, setLevel] = useState(0);
  const cfg = {
    ...PLAN_DEFAULT,
    ...(layer || {}),
    pegel: { ...PLAN_DEFAULT.pegel, ...(layer?.pegel || {}) },
  };
  const set = (patch) => setLayer((s) => ({ ...PLAN_DEFAULT, ...(s || {}), ...patch }));

  // Fensterfläche je Footprint-Kante über alle Geschosse (platzierte + Auto).
  const fensterJeKante = useMemo(() => {
    const walls = plan.model?.walls || [];
    const platziert = (plan.envOpenings || []).map((o) => {
      const ty = openingTypeById(o.kind, o.typeId);
      return { ...o, width: ty.w, height: ty.h };
    });
    const auto = autoEnvOpenings(
      walls,
      plan.entranceCfg ? { entrance: plan.entranceCfg } : {},
      platziert.map((o) => ({ level: o.level, edge: o.edge, u: o.u, width: o.width })),
    );
    const je = {};
    [...platziert, ...auto]
      .filter((o) => o.kind === "window")
      .forEach((f) => { je[f.edge] = (je[f.edge] || 0) + f.width * f.height; });
    return je;
  }, [plan.model, plan.envOpenings, plan.entranceCfg]);

  const rwWand = compositeById(plan.model?.walls?.[0]?.composite)?.rw ?? 50;
  // Fenster-R'w erst BEIM RECHNEN klemmen (20..60 dB) — nicht je Tastendruck
  // im Input, sonst wird "25" zu "205" (Math.max(20, "2") → 20, dann "5").
  const rwFensterEff = Math.min(60, Math.max(20, Number(cfg.rwFenster) || RW_FENSTER_DEFAULT));
  const fassaden = useMemo(
    () => fassadenBewertung({
      waende: plan.model?.walls || [], fensterJeKante, pegel: cfg.pegel,
      northAngle: cfg.northAngle, storeys: plan.storeys, storeyHeight: plan.storeyHeight,
      rwWand, rwFenster: rwFensterEff, raumart,
    }),
    // cfg ist je Render neu zusammengesetzt — auf die Primitive/layer-Felder abstellen.
    [plan.model, fensterJeKante, layer, plan.storeys, plan.storeyHeight, rwWand, raumart], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const adjazenzen = useMemo(
    () => zonenAdjazenzen({ zonen: plan.zones || [], raumarten: cfg.raumarten, ausgenommen: cfg.ausgenommen }),
    [plan.zones, layer], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const checks = useMemo(
    () => schallPlanChecks({ fassaden, adjazenzen, rwTrennwand: cfg.rwTrennwand }),
    [fassaden, adjazenzen, layer], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ampel = SP_STATUS[checks.ampel] || SP_STATUS.offen;

  // I-03 (external review 02.09.): the click cycle starts from the SAME room
  // type the calculation uses (effektiveRaumart: layer entry → zone.raumart →
  // wohnen). It used to start from "wohnen" regardless of zone.raumart, so a
  // Werkstatt corridor computed as flur needed four clicks to show as flur.
  const zyklusRaumart = (z) => {
    const key = zoneKey(z);
    const aktuell = effektiveRaumart(cfg.raumarten, z);
    const next = RAUMART_REIHE[(RAUMART_REIHE.indexOf(aktuell) + 1) % RAUMART_REIHE.length];
    set({ raumarten: { ...cfg.raumarten, [key]: next } });
  };
  const toggleAusnahme = (key) => {
    const hat = (cfg.ausgenommen || []).includes(key);
    set({ ausgenommen: hat ? cfg.ausgenommen.filter((k) => k !== key) : [...cfg.ausgenommen, key] });
  };

  // Umlaufrichtung des Footprints (wie fassadenBewertung in der Lib) für die
  // konkav-sichere Außennormale der Fassaden-Labels — der frühere
  // BBox-Zentrum-Test kippte an einspringenden L-/U-Kanten nach innen
  // (gleiches Muster wie der in raumklima.js dokumentierte/gefixte Bug).
  const umlauf = useMemo(() => {
    const walls = plan.model?.walls || [];
    const lvl0 = walls.filter((w) => (w.level ?? 0) === (walls[0]?.level ?? 0));
    const fp = [...lvl0].sort((a, b) => a.edge - b.edge).map((w) => w.a);
    return Math.sign(polygonSignedAreaXZ(fp)) || 1;
  }, [plan.model]);

  const worst = fassaden.length
    ? fassaden.reduce((m, f) => ((f.rwRes - f.erf) < (m.rwRes - m.erf) ? f : m), fassaden[0])
    : null;
  const adjImLevel = adjazenzen.filter((a) => a.level === level && a.relevant);
  const zonenImLevel = (plan.zones || []).filter((z) => (z.level ?? 0) === level);

  if (!plan.model) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="w-4 h-4" /> Schallschutz-Plan (Richtwerte)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={ampel.color}>{ampel.label}</Badge>
            <Select value={String(level)} onValueChange={(v) => setLevel(+v)}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: plan.storeys }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>{i === 0 ? "EG" : `${i}. OG`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Fassaden nach Lärmpegel je Orientierung eingefärbt (R'w,res = Wandaufbau „{compositeById(plan.model?.walls?.[0]?.composite)?.name || "Standard"}" R'w {de(rwWand)} dB + Fensteranteil).
          Zonen-Klick schaltet die Raumart durch; violette Segmente = wohnungstrennend (Klick = gleiche WE).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {["N", "O", "S", "W"].map((s) => (
            <NumberField key={s} label={`Pegel ${s}`} value={cfg.pegel[s]} step={5} suffix="dB(A)" min={0}
              onChange={(v) => set({ pegel: { ...cfg.pegel, [s]: Math.max(0, Math.round(v)) } })} />
          ))}
          {/* Roh durchlassen, Klemmen (20..60) erst onBlur — je Tastendruck
              klemmen machte zweistellige Eingaben < 20 unmöglich ("205 dB"). */}
          <NumberField label="Fenster R'w" value={cfg.rwFenster} step={1} suffix="dB" min={20}
            onChange={(v) => set({ rwFenster: v })}
            onBlur={() => set({ rwFenster: Math.min(60, Math.max(20, Math.round(Number(cfg.rwFenster) || RW_FENSTER_DEFAULT))) })} />
          <NumberField label="Trennwand R'w" value={cfg.rwTrennwand} step={1} suffix="dB" min={0}
            onChange={(v) => set({ rwTrennwand: Math.max(0, Math.round(v)) })} />
          <NumberField label="Nordabweichung" value={cfg.northAngle} step={5} suffix="°" min={0} max={359}
            onChange={(v) => set({ northAngle: ((Math.round(v) % 360) + 360) % 360 })} />
        </div>

        <BimPlan2D
          model={plan.model}
          mode="grundriss"
          level={level}
          storeyHeight={plan.storeyHeight}
          readOnly
          customZones={plan.zones}
          envOpenings={plan.envOpenings}
          unit={plan.unit}
          height={420}
          overlay={({ X, Z }) => {
            return (
              <g>
                {/* Fassaden-Kanten nach pass/warn (SCHALL-04) */}
                {fassaden.map((f) => {
                  const x1 = X(f.a.x), y1 = Z(f.a.z), x2 = X(f.b.x), y2 = Z(f.b.z);
                  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                  // Label nach außen versetzen: konkav-sichere Außennormale der
                  // Lib (outwardNormal + Umlauf) statt BBox-Zentrum-Test. Die
                  // Welt-Normale wird als Bildpunkt-Differenz in Screen-
                  // Koordinaten überführt — das erfasst auch eine gespiegelte
                  // Screen-Z-Achse der X()/Z()-Transformation.
                  const n = outwardNormal({ a: f.a, b: f.b }, umlauf);
                  const mwx = (f.a.x + f.b.x) / 2, mwz = (f.a.z + f.b.z) / 2;
                  let nx = X(mwx + n.nx) - X(mwx);
                  let ny = Z(mwz + n.nz) - Z(mwz);
                  const nl = Math.hypot(nx, ny) || 1;
                  nx /= nl; ny /= nl;
                  const farbe = f.status === "warn" ? "#dc2626" : f.status === "pass" ? "#16a34a" : "#94a3b8";
                  return (
                    <g key={`fa-${f.edge}`} style={{ pointerEvents: "none" }}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={farbe} strokeWidth="3.5"
                        strokeLinecap="round" opacity="0.85" />
                      <text x={mx + nx * 14} y={my + ny * 14} fontSize="8.5" fontWeight="600"
                        fill={farbe} textAnchor="middle">
                        {f.sektor} {de(f.dbA)} dB(A) · R'w {de1(f.rwRes)}/{de(f.erf)}
                      </text>
                    </g>
                  );
                })}
                {/* Zonen-Raumart (SCHALL-01): Klick schaltet durch */}
                {zonenImLevel.map((z) => {
                  const key = zoneKey(z);
                  // I-03: colour and letter follow the effective room type — the
                  // same one zonenAdjazenzen calculates with (zone.raumart of the
                  // Werkstatt zones included), not only the layer entry.
                  const art = PLAN_RAUMARTEN[effektiveRaumart(cfg.raumarten, z)];
                  const punkte = (z.points || []).map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
                  const sx = (z.points || []).reduce((s, p) => s + X(p.x), 0) / Math.max(1, z.points?.length || 1);
                  const sz = (z.points || []).reduce((s, p) => s + Z(p.z), 0) / Math.max(1, z.points?.length || 1);
                  return (
                    <g key={`zn-${key}`}>
                      <polygon points={punkte} fill={art.farbe} fillOpacity="0.10"
                        stroke="none" style={{ cursor: "pointer" }}
                        onClick={() => zyklusRaumart(z)} />
                      <text x={sx} y={sz} fontSize="8" fontWeight="700" fill={art.farbe}
                        textAnchor="middle" style={{ pointerEvents: "none" }}>{art.kurz}</text>
                    </g>
                  );
                })}
                {/* Wohnungstrennwände (SCHALL-03): Klick = gleiche WE (Ausnahme) */}
                {adjImLevel.map((a, i) => (
                  <g key={`adj-${a.key}-${i}`}>
                    <line x1={X(a.p1.x)} y1={Z(a.p1.z)} x2={X(a.p2.x)} y2={Z(a.p2.z)}
                      stroke="#7c3aed" strokeWidth={a.ausgenommen ? 2 : 4}
                      strokeDasharray={a.ausgenommen ? "3 4" : "none"} strokeLinecap="round"
                      opacity={a.ausgenommen ? 0.45 : 0.9} style={{ cursor: "pointer" }}
                      onClick={() => toggleAusnahme(a.key)} />
                    {!a.ausgenommen && (
                      <text x={(X(a.p1.x) + X(a.p2.x)) / 2} y={(Z(a.p1.z) + Z(a.p2.z)) / 2 - 4}
                        fontSize="8" fontWeight="600" fill="#7c3aed" textAnchor="middle"
                        style={{ pointerEvents: "none" }}>
                        {a.flur ? `Flur/Treppenraum ${de(a.anforderung)} dB` : `≥ ${de(a.anforderung)} dB`}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          }}
        />

        {/* Legende + Checks */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          {RAUMART_REIHE.map((id) => (
            <span key={id} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PLAN_RAUMARTEN[id].farbe }} />
              {PLAN_RAUMARTEN[id].kurz} = {PLAN_RAUMARTEN[id].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="w-4 h-0.5 bg-violet-600" /> wohnungstrennend
          </span>
        </div>
        <div className="space-y-2">
          {checks.items.map((it) => {
            const s = SP_STATUS[it.status] || SP_STATUS.offen;
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
        </div>
        {worst && (
          <div className="flex items-center justify-between pt-1 border-t">
            <span className="text-xs text-slate-500">
              Ungünstigste Fassade: Kante {worst.edge} ({worst.sektor}) — R'w,res {de1(worst.rwRes)} dB bei {de(worst.dbA)} dB(A)
            </span>
            <Button size="sm" variant="outline"
              onClick={() => onUebernehmen?.({ dbA: worst.dbA, rwAussen: rwUebernahme(worst.rwRes) })}>
              In Prüfung übernehmen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Farbverlauf Lärmpegelbereich: slate (leise) → amber (laut).
const BEREICH_ACCENT = {
  I: "text-slate-500",
  II: "text-slate-600",
  III: "text-slate-700",
  IV: "text-amber-500",
  V: "text-amber-600",
  VI: "text-amber-700",
  VII: "text-amber-800",
};

export default function SchallschutzPlanner() {
  // Geometrie READ-only aus der gemeinsamen Quelle — nie duplizieren, nie zurückschreiben.
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // Lokaler State (useState only — keine DB, kein bitApi, keine Store-Persistenz).
  // Card A — Außenlärm (SCHALL-01)
  const [dbA, setDbA] = usePanelState("schallschutz:dbA", 60);
  const [quelle, setQuelle] = usePanelState("schallschutz:quelle", "strasse");
  const [raumart, setRaumart] = usePanelState("schallschutz:raumart", "wohnen");

  // Card B — Luftschall (SCHALL-02): Ist-Werte, Vorbelegung = erf-Richtwert (Dirty-Flags)
  const [rwAussenIst, setRwAussenIst] = usePanelState("schallschutz:rwAussenIst", 0);
  const [rwAussenDirty, setRwAussenDirty] = usePanelState("schallschutz:rwAussenDirty", false);
  const [rwWandIst, setRwWandIst] = usePanelState("schallschutz:rwWandIst", TRENN_RICHTWERTE.wand_wohnungstrennend);
  const [rwWandDirty, setRwWandDirty] = usePanelState("schallschutz:rwWandDirty", false);
  const [rwDeckeIst, setRwDeckeIst] = usePanelState("schallschutz:rwDeckeIst", TRENN_RICHTWERTE.decke_wohnungstrennend);
  const [rwDeckeDirty, setRwDeckeDirty] = usePanelState("schallschutz:rwDeckeDirty", false);

  // Card C — Trittschall (SCHALL-03)
  const [deckenaufbau, setDeckenaufbau] = usePanelState("schallschutz:deckenaufbau", "massiv_estrich");

  // Card D — TGA-Geräusche (SCHALL-04)
  const [tgaPegel, setTgaPegel] = usePanelState("schallschutz:tgaPegel", 28);

  // Abgeleitete Richtwerte (live aus Außenlärm + Raumart).
  const bereich = laermpegelbereich(dbA);
  const erfAussen = erfRwGes(bereich, raumart);

  // Richtwert-getriebene Vorbelegungen — nur solange Nutzer:in nichts geändert hat.
  useEffect(() => {
    if (!rwAussenDirty) setRwAussenIst(erfAussen);
  }, [erfAussen, rwAussenDirty, setRwAussenIst]);
  useEffect(() => {
    if (!rwWandDirty) setRwWandIst(TRENN_RICHTWERTE.wand_wohnungstrennend);
  }, [rwWandDirty, setRwWandIst]);
  useEffect(() => {
    if (!rwDeckeDirty) setRwDeckeIst(TRENN_RICHTWERTE.decke_wohnungstrennend);
  }, [rwDeckeDirty, setRwDeckeIst]);

  const kpi = useMemo(() => {
    const lnwErwartet = (DECKENAUFBAU[deckenaufbau] || DECKENAUFBAU.ohne).lnw;
    const checks = schallChecks({
      dbA, raumart, rwAussenIst, rwTrennIst: rwWandIst, rwDeckeIst,
      deckenaufbau, tgaPegel,
    });
    return { lnwErwartet, checks };
  }, [dbA, raumart, rwAussenIst, rwWandIst, rwDeckeIst, deckenaufbau, tgaPegel]);

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Schallschutz — Konzept-Richtwerte nach DIN 4109, kein prüffähiger Schallschutznachweis.</strong>{" "}
          Lärmpegelbereich, R'w-, L'n,w- und Anlagenpegel-Werte sind Überschläge und ersetzen
          keinen Nachweis nach DIN 4109. Nachweis durch Bauakustiker:in erforderlich;
          alle Werte überschreibbar.
        </span>
      </div>

      <div className="text-xs text-slate-500">
        Anlagen-Auslegung → Reiter „Haustechnik (TGA)“; Raum-Sollpegel Arbeitsstätten → ASR-Raumdatenblatt.
      </div>

      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · Grundfläche {de(pm.footArea)} m² · BGF {de(pm.bgf)} m² · NGF {de(pm.ngf)} m²
        </div>
      )}

      {/* Schallschutz auf dem Grundriss (Phase 39) */}
      <SchallschutzPlanKarte
        raumart={raumart}
        onUebernehmen={({ dbA: planDbA, rwAussen }) => {
          setDbA(planDbA);
          setRwAussenIst(rwAussen);
          setRwAussenDirty(true);
        }}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eingabe-Cards A–D */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Volume2 className="w-4 h-4" /> Außenlärm & Lärmpegelbereich</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Maßgeblicher Außenlärmpegel" value={dbA} step={1} suffix="dB(A)" min={0} onChange={setDbA} />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Maßgebliche Lärmquelle</label>
                <Select value={quelle} onValueChange={setQuelle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LAERMQUELLEN).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Raumart (schutzbedürftige Räume)</label>
                <Select value={raumart} onValueChange={setRaumart}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(RAUMARTEN).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 text-xs text-slate-500">
                Lärmpegelbereich I–VII nach DIN 4109 (vereinfachte Bänder) — maßgeblicher
                Außenlärmpegel aus Lärmkarte / schalltechnischer Untersuchung.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Waves className="w-4 h-4" /> Luftschall — Außen- & Trennbauteile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Stat label="Erf. R'w,ges Außenbauteile (Richtwert)" value={`${de(erfAussen)} dB`} accent={BEREICH_ACCENT[bereich] || "text-slate-700"} />
              <NumberField label="Ist R'w,ges Außenbauteil" value={rwAussenIst} step={1} suffix="dB" min={0} onChange={(v) => { setRwAussenIst(v); setRwAussenDirty(true); }} />
              <NumberField label="Ist R'w Wohnungstrennwand" value={rwWandIst} step={1} suffix="dB" min={0} onChange={(v) => { setRwWandIst(v); setRwWandDirty(true); }} />
              <NumberField label="Ist R'w Wohnungstrenndecke" value={rwDeckeIst} step={1} suffix="dB" min={0} onChange={(v) => { setRwDeckeIst(v); setRwDeckeDirty(true); }} />
              <div className="col-span-2 text-xs text-slate-500">
                Richtwerte: Wohnungstrennwand R'w ≥ {de(TRENN_RICHTWERTE.wand_wohnungstrennend)} dB ·
                Wohnungstrenndecke R'w ≥ {de(TRENN_RICHTWERTE.decke_wohnungstrennend)} dB ·
                Wohnungseingangstür R'w ≥ {de(TRENN_RICHTWERTE.tuer_flur)} dB — überschreibbar.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Footprints className="w-4 h-4" /> Trittschall — Wohnungstrenndecken</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Gewählter Deckenaufbau</label>
                <Select value={deckenaufbau} onValueChange={setDeckenaufbau}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DECKENAUFBAU).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Stat label="L'n,w erwartet (Richtwert)" value={`${de(kpi.lnwErwartet)} dB`} accent={kpi.lnwErwartet <= TRITTSCHALL_GRENZE ? "text-emerald-600" : "text-amber-600"} />
              <Stat label="Grenze L'n,w (Richtwert)" value={`≤ ${de(TRITTSCHALL_GRENZE)} dB`} accent="text-slate-700" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Fan className="w-4 h-4" /> Anlagengeräusche (TGA)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Anlagen-Schalldruckpegel im schutzbedürftigen Raum" value={tgaPegel} step={1} suffix="dB(A)" min={0} onChange={setTgaPegel} />
              <Stat label="Grenze Anlagenpegel (Richtwert)" value={`≤ ${de(TGA_GRENZE)} dB(A)`} accent={tgaPegel <= TGA_GRENZE ? "text-emerald-600" : "text-amber-600"} />
              <div className="col-span-2 text-xs text-slate-500">
                Geräusche gebäudetechnischer Anlagen (Heizung, Lüftung, Aufzug) in fremden
                schutzbedürftigen Räumen — Anlagen-Auslegung im Reiter „Haustechnik (TGA)“.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Richtwert-KPIs + Zusammenfassung */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Lärmpegelbereich (Richtwert)" value={`Bereich ${bereich}`} accent={BEREICH_ACCENT[bereich] || "text-slate-700"} />
            <Stat label="Erf. R'w,ges Außenbauteile (Richtwert)" value={`${de(erfAussen)} dB`} accent="text-sky-600" />
            <Stat label="Wohnungstrennwand (Richtwert)" value={`R'w ≥ ${de(TRENN_RICHTWERTE.wand_wohnungstrennend)} dB`} accent="text-violet-600" />
            <Stat label="Wohnungstrenndecke (Richtwert)" value={`R'w ≥ ${de(TRENN_RICHTWERTE.decke_wohnungstrennend)} dB`} accent="text-violet-700" />
            <Stat label="Trittschall (Richtwert)" value={`L'n,w ≈ ${de(kpi.lnwErwartet)} dB`} accent={kpi.lnwErwartet <= TRITTSCHALL_GRENZE ? "text-emerald-600" : "text-amber-600"} />
            <Stat label="Anlagenpegel (Richtwert)" value={`${de(tgaPegel)} dB(A)`} accent={tgaPegel <= TGA_GRENZE ? "text-cyan-700" : "text-amber-600"} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Gauge className="w-4 h-4" /> Zusammenfassung & Plausibilität (Richtwert)</span>
                <Badge className={STATUS_STYLE[kpi.checks.warns > 0 ? "warn" : "pass"].color}>{kpi.checks.verdict}</Badge>
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
              <div className="text-xs text-slate-500 border-t pt-2">
                Anlagen-Auslegung im Reiter „Haustechnik (TGA)“, Raum-Sollpegel für Arbeitsstätten
                im ASR-Raumdatenblatt — der Schallschutz-Reiter zeigt nur Konzept-Richtwerte
                nach DIN 4109 (kein prüffähiger Schallschutznachweis).
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
