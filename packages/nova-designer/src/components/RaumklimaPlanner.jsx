import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { NumberField, Stat } from "@core/components/Field";
import {
  ThermometerSun, AlertTriangle, Compass, SunDim, Wind, Home,
} from "lucide-react";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { openingTypeById } from "@core/lib/buildingModel";
import { useProject } from "@core/lib/ProjectContext";
import { autoEnvOpenings } from "@designer/lib/autoOpenings";
import { useSiteClimate } from "@designer/lib/useSiteClimate";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { useFachlayer } from "@designer/lib/useFachlayer";
import {
  fensterZuRaeumen, screeningJeGeschoss, raumklimaChecks,
  klimaregionAusKlima, bauartVorschlag, FC_OPTIONEN,
} from "@designer/lib/raumklima";

const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const de3 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pct = (n) => `${Math.round((Number(n) || 0) * 100)} %`;

// STATUS_STYLE kennt nur pass/warn/fail — "offen" lokal ergänzt (WB_STATUS-
// Muster, WaermebrueckenPlanner.jsx). "fail" wird hier bewusst NIE gerendert.
const RK_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

const geschossLabel = (lvl) => (lvl === 0 ? "EG" : `${lvl}. OG`);

// Persistente Einstellungen (raumklima_layer im BimModel, KD-17 via useFachlayer):
// null = "automatisch aus Standort/Modell ableiten".
const LAYER_DEFAULT = {
  northAngle: 0, klimaregion: null, bauart: null,
  nachtlueftung: "erhoeht", fcId: "ohne", sonnenschutzglas: false,
};

export default function RaumklimaPlanner() {
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const klima = useSiteClimate(project?.location);
  const [layer, setLayer] = useFachlayer(project?.id, "raumklima_layer", LAYER_DEFAULT);
  const set = (patch) => setLayer((s) => ({ ...LAYER_DEFAULT, ...s, ...patch }));
  const cfg = { ...LAYER_DEFAULT, ...(layer || {}) };

  // --- Fenster der Hülle normalisieren (KLIMA-02) -----------------------------
  // Benutzerplatzierte envOpenings (typeId → Katalogmaße + g) und Auto-Fenster
  // (explizite Maße, g aus dem Standard-Fenstertyp). customWindows sitzen auf
  // Innenwänden und bleiben bewusst außen vor (kein solarer Eintrag).
  const fenster = useMemo(() => {
    const walls = plan.model?.walls || [];
    const platziert = (plan.envOpenings || []).map((o) => {
      const ty = openingTypeById(o.kind, o.typeId);
      return { ...o, width: ty.w, height: ty.h, g: ty.g };
    });
    const auto = autoEnvOpenings(
      walls,
      plan.entranceCfg ? { entrance: plan.entranceCfg } : {},
      platziert.map((o) => ({ level: o.level, edge: o.edge, u: o.u, width: o.width })),
    );
    const gDefault = openingTypeById("window", "single").g;
    return [...platziert, ...auto]
      .filter((o) => o.kind === "window")
      .map((o) => ({
        level: o.level, edge: o.edge, u: o.u,
        breite: o.width, hoehe: o.height, g: o.g ?? gDefault,
      }));
  }, [plan.model, plan.envOpenings, plan.entranceCfg]);

  // --- Zuordnung + Screening + DIN-Richtwert ----------------------------------
  const zuordnung = useMemo(
    () => fensterZuRaeumen({
      fenster, waende: plan.model?.walls || [], zonen: plan.zones || [], northAngle: cfg.northAngle,
    }),
    [fenster, plan.model, plan.zones, cfg.northAngle],
  );
  const screening = useMemo(
    () => screeningJeGeschoss({ proRaum: zuordnung.proRaum, storeys: plan.storeys }),
    [zuordnung, plan.storeys],
  );

  const regionAuto = klimaregionAusKlima(klima.months);
  const bauartAuto = bauartVorschlag(plan.model?.walls?.[0]?.composite);
  const optionen = useMemo(() => ({
    klimaregion: cfg.klimaregion || regionAuto || "B",
    bauart: cfg.bauart || bauartAuto,
    nachtlueftung: cfg.nachtlueftung,
    fc: (FC_OPTIONEN.find((o) => o.id === cfg.fcId) || FC_OPTIONEN[0]).fc,
    sonnenschutzglas: cfg.sonnenschutzglas,
  }), [cfg.klimaregion, cfg.bauart, cfg.nachtlueftung, cfg.fcId, cfg.sonnenschutzglas, regionAuto, bauartAuto]);
  const checks = useMemo(
    () => raumklimaChecks({ geschosse: screening.geschosse, ohneRaum: zuordnung.ohneRaum, optionen }),
    [screening, zuordnung, optionen],
  );
  const ampelStyle = RK_STATUS[checks.ampel] || RK_STATUS.offen;

  const heissester = useMemo(() => {
    const gueltig = (klima.months || []).filter((m) => Number.isFinite(m.temp));
    if (!gueltig.length) return null;
    return gueltig.reduce((max, m) => (m.temp > max.temp ? m : max), gueltig[0]);
  }, [klima.months]);

  const levels = [...screening.geschosse.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {/* Persistenter Disclaimer — Pflicht, nicht konditional */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Screening mit [ASSUMED]-Richtwerten (Orientierungsgewichte, Verglasungs-Kennwerte)
          und vereinfachtes Sonneneintragskennwert-Verfahren in Anlehnung an DIN 4108-2 Abschn. 8.3 —
          <strong> kein Nachweis des sommerlichen Wärmeschutzes</strong>. Klima: Open-Meteo-Mehrjahresmittel
          {klima.years ? ` ${klima.years}` : ""}{klima.offline ? " (offline-Näherung)" : ""}.
        </span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ThermometerSun className="w-5 h-5 text-teal-600" />
          <h2 className="text-lg font-bold text-slate-800">Raumklima — kritischster Raum je Geschoss</h2>
        </div>
        <Badge className={ampelStyle.color}>{ampelStyle.label}</Badge>
      </div>

      {/* Standort-Klima (KLIMA-01) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Heißester Monat (Mittel)" value={heissester ? `${heissester.month} · ${de1(heissester.temp)} °C` : "—"} />
        <Stat label="Tagesmaxima heißester Monat" value={heissester && Number.isFinite(heissester.tMax) ? `${de1(heissester.tMax)} °C` : "—"} />
        <Stat label="Globalstrahlung (Jahr)" value={klima.annualRad ? `${Math.round(klima.annualRad)} kWh/m²` : "—"} />
        <Stat label="Sommer-Klimaregion" value={`${optionen.klimaregion}${cfg.klimaregion ? "" : regionAuto ? " (auto)" : " (Standard)"}`} />
      </div>

      {/* Randbedingungen */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Compass className="w-4 h-4" /> Randbedingungen</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Klimaregion</div>
            <Select value={cfg.klimaregion || "auto"} onValueChange={(v) => set({ klimaregion: v === "auto" ? null : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{`Automatisch${regionAuto ? ` (${regionAuto})` : ""}`}</SelectItem>
                <SelectItem value="A">A — sommerkühl</SelectItem>
                <SelectItem value="B">B — gemäßigt</SelectItem>
                <SelectItem value="C">C — sommerheiß</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Bauart</div>
            <Select value={cfg.bauart || "auto"} onValueChange={(v) => set({ bauart: v === "auto" ? null : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{`Automatisch (${bauartAuto})`}</SelectItem>
                <SelectItem value="leicht">leicht</SelectItem>
                <SelectItem value="mittel">mittel</SelectItem>
                <SelectItem value="schwer">schwer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Nachtlüftung</div>
            <Select value={cfg.nachtlueftung} onValueChange={(v) => set({ nachtlueftung: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ohne">ohne</SelectItem>
                <SelectItem value="erhoeht">erhöht (n ≥ 2/h)</SelectItem>
                <SelectItem value="hoch">hoch (n ≥ 5/h)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Sonnenschutz (F_c)</div>
            <Select value={cfg.fcId} onValueChange={(v) => set({ fcId: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FC_OPTIONEN.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{`${o.name} (${o.fc.toLocaleString("de-DE")})`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Verglasung</div>
            <Select value={cfg.sonnenschutzglas ? "ssg" : "std"} onValueChange={(v) => set({ sonnenschutzglas: v === "ssg" })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="std">Standard (g 0,6)</SelectItem>
                <SelectItem value="ssg">Sonnenschutzglas (g ≤ 0,4)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <NumberField label="Nordabweichung" value={cfg.northAngle}
            onChange={(v) => set({ northAngle: ((Math.round(v) % 360) + 360) % 360 })} suffix="°" min={0} max={359} />
        </CardContent>
      </Card>

      {/* Ranking je Geschoss (KLIMA-04/05) */}
      {levels.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            <Home className="w-6 h-6 mx-auto mb-2 text-slate-300" />
            Räume im Gebäudemodell zeichnen (Zone-Werkzeug im Reiter Gebäudemodell) —
            dann erscheint hier das Raum-Ranking je Geschoss.
          </CardContent>
        </Card>
      ) : levels.map((lvl) => {
        const raeume = screening.geschosse.get(lvl);
        const info = checks.jeGeschoss.find((g) => g.level === lvl);
        const s = RK_STATUS[info?.status] || RK_STATUS.offen;
        return (
          <Card key={lvl}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><SunDim className="w-4 h-4" /> {geschossLabel(lvl)} — Raum-Ranking</span>
                <Badge className={s.color}>{s.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {raeume.map((r, idx) => (
                <div key={r.key} className={`rounded-lg border p-2 ${r.key === info?.kritisch?.key ? "border-teal-300 bg-teal-50/50" : ""}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="w-6 text-xs text-slate-400 text-right shrink-0">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800">
                        {r.name}{r.key === info?.kritisch?.key ? " — kritischster Raum" : ""}{r.dachRaum ? " · Dachlage" : ""}
                      </div>
                      <div className="text-xs text-slate-500">
                        {de1(r.flaeche)} m² · Fenster {de1(r.fensterFlaeche)} m² ({r.fenster.length} Stk.) · f_WG {pct(r.fWG)}
                        {r.fenster.length > 0 && ` · ${[...new Set(r.fenster.map((f) => f.orient))].join("/")}`}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 shrink-0">
                      Kennwert <span className="font-semibold text-slate-700">{de3(r.kennwert)}</span>
                    </div>
                  </div>
                  {r.key === info?.kritisch?.key && info?.din?.anwendbar && (
                    <div className="mt-2 pt-2 border-t text-xs text-slate-600 grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>S_vorh <span className="font-semibold">{de3(info.din.sVorh)}</span></div>
                      <div>S_zul <span className="font-semibold">{de3(info.din.sZul)}</span></div>
                      <div>S1 {de3(info.din.anteile.s1)} · S2 {de3(info.din.anteile.s2)}</div>
                      <div>S3 {de3(info.din.anteile.s3)} · S5 {de3(info.din.anteile.s5)}</div>
                    </div>
                  )}
                  {r.key === info?.kritisch?.key && !info?.din && r.nachweisFrei && r.fenster.length > 0 && (
                    <div className="mt-2 pt-2 border-t text-xs text-emerald-700">
                      f_WG unter der Freistellungsgrenze — kein Kennwert-Nachweis erforderlich (Richtwert).
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Checks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Wind className="w-4 h-4" /> Prüfungen (Richtwerte)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.items.map((it) => {
            const st = RK_STATUS[it.status] || RK_STATUS.offen;
            return (
              <div key={it.key} className="flex items-center gap-3 rounded-lg border p-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">{it.label}</div>
                  <div className="text-xs text-slate-500">{it.detail}</div>
                </div>
                <Badge className={st.color}>{st.label}</Badge>
              </div>
            );
          })}
          <div className="text-xs text-slate-400 pt-1">
            {fenster.length} Hüllfenster berücksichtigt (platzierte + Auto-Fenster; Innenwand-Öffnungen ohne solaren Eintrag).
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
