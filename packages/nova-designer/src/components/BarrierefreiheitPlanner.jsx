import React, { useEffect, useMemo } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Building2, Users, Move, Bath, Gauge, AlertTriangle,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  AUSBAUSTUFEN, KABINE_BREITE, KABINE_TIEFE, BEWEGUNG_B, BEWEGUNG_R,
  TUER_BREITE_B, TUER_BREITE_R, TUER_HOEHE, FLUR_BREITE, WC_SEITLICH, DEFAULT_R_QUOTE,
  aufzugPflicht, kabineOk, weAusNgf, erfBarrierefreiErreichbar, erfRollstuhlgerecht,
  bewegungsflaeche, tuerBreiteOk, sanitaerOk, bfChecks,
} from "@designer/lib/accessibility";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

export default function BarrierefreiheitPlanner() {
  // Geometrie READ-only aus der gemeinsamen Quelle — nie duplizieren, nie zurückschreiben.
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // Lokaler State (useState only — keine DB, kein bitApi, keine Store-Persistenz).
  // Card 1 — Erschließung & Aufzug (BF-01)
  const [okf, setOkf] = usePanelState("barrierefrei:okf", 0);
  const [okfDirty, setOkfDirty] = usePanelState("barrierefrei:okfDirty", false);
  const [aufzugMode, setAufzugMode] = usePanelState("barrierefrei:aufzugMode", "auto");
  const [kabineB, setKabineB] = usePanelState("barrierefrei:kabineB", KABINE_BREITE);
  const [kabineT, setKabineT] = usePanelState("barrierefrei:kabineT", KABINE_TIEFE);
  const [erschliessung, setErschliessung] = usePanelState("barrierefrei:erschliessung", "ja");

  // Card 2 — Wohnungsquoten B/R (BF-02)
  const [we, setWe] = usePanelState("barrierefrei:we", 0);
  const [weDirty, setWeDirty] = usePanelState("barrierefrei:weDirty", false);
  const [quotePct, setQuotePct] = usePanelState("barrierefrei:quotePct", DEFAULT_R_QUOTE);
  const [vorhErreichbar, setVorhErreichbar] = usePanelState("barrierefrei:vorhErreichbar", 0);
  const [vorhR, setVorhR] = usePanelState("barrierefrei:vorhR", 0);

  // Card 3 — Bewegungsflächen & Türbreiten (BF-03)
  const [stufe, setStufe] = usePanelState("barrierefrei:stufe", "B");
  const [bewegung, setBewegung] = usePanelState("barrierefrei:bewegung", BEWEGUNG_B);
  const [bewDirty, setBewDirty] = usePanelState("barrierefrei:bewDirty", false);
  const [tuerBreite, setTuerBreite] = usePanelState("barrierefrei:tuerBreite", TUER_BREITE_B);
  const [tuerDirty, setTuerDirty] = usePanelState("barrierefrei:tuerDirty", false);
  const [tuerHoehe, setTuerHoehe] = usePanelState("barrierefrei:tuerHoehe", TUER_HOEHE);
  const [flur, setFlur] = usePanelState("barrierefrei:flur", FLUR_BREITE);

  // Card 4 — Sanitärräume (BF-04)
  const [saniStufe, setSaniStufe] = usePanelState("barrierefrei:saniStufe", "R");
  const [saniBewegung, setSaniBewegung] = usePanelState("barrierefrei:saniBewegung", BEWEGUNG_R);
  const [saniDirty, setSaniDirty] = usePanelState("barrierefrei:saniDirty", false);
  const [wcSeitlich, setWcSeitlich] = usePanelState("barrierefrei:wcSeitlich", WC_SEITLICH);
  const [dusche, setDusche] = usePanelState("barrierefrei:dusche", "ja");
  const [waschtisch, setWaschtisch] = usePanelState("barrierefrei:waschtisch", "ja");

  // Modell-/standardgetriebene Vorbelegungen — nur solange Nutzer:in nichts geändert hat.
  // OKF ≈ (storeys−1)·storeyHeight [ASSUMED A1] — NICHT die Gesamthöhe (storeys·storeyHeight)!
  useEffect(() => {
    if (!okfDirty && pm.storeys > 0) setOkf(Math.round((pm.storeys - 1) * pm.storeyHeight * 10) / 10);
  }, [pm.storeys, pm.storeyHeight, okfDirty, setOkf]);
  useEffect(() => {
    if (!weDirty && pm.ngf > 0) setWe(weAusNgf(pm.ngf)); // WE ≈ max(1, round(ngf/75)) [ASSUMED A6]
  }, [pm.ngf, weDirty, setWe]);
  useEffect(() => {
    // Ausbaustufen-Wechsel belegt den Zielwert neu, solange nicht manuell überschrieben.
    if (!bewDirty) setBewegung(bewegungsflaeche(stufe));
  }, [stufe, bewDirty, setBewegung]);
  useEffect(() => {
    if (!tuerDirty) setTuerBreite(stufe === "R" ? TUER_BREITE_R : TUER_BREITE_B);
  }, [stufe, tuerDirty, setTuerBreite]);
  useEffect(() => {
    if (!saniDirty) setSaniBewegung(bewegungsflaeche(saniStufe));
  }, [saniStufe, saniDirty, setSaniBewegung]);

  const kpi = useMemo(() => {
    const pflicht = aufzugMode === "auto" ? aufzugPflicht(pm.storeys, okf) : aufzugMode === "ja";
    const kab = kabineOk(kabineB, kabineT);
    const erfErr = erfBarrierefreiErreichbar(we, pm.storeys, pflicht);
    const erfR = erfRollstuhlgerecht(we, quotePct);
    const checks = bfChecks({
      storeys: pm.storeys, okf, aufzugMode, kabineB, kabineT, erschliessung,
      we, quotePct, vorhErreichbar, vorhR, stufe, bewegung, tuerBreite, tuerHoehe, flur,
      saniStufe, saniBewegung, saniDusche: dusche, saniWcSeitlich: wcSeitlich, saniWaschtisch: waschtisch,
    });
    return { pflicht, kab, erfErr, erfR, checks };
  }, [
    pm.storeys, okf, aufzugMode, kabineB, kabineT, erschliessung, we, quotePct,
    vorhErreichbar, vorhR, stufe, bewegung, tuerBreite, tuerHoehe, flur,
    saniStufe, saniBewegung, dusche, wcSeitlich, waschtisch,
  ]);

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Barrierefreiheit — Konzept-Richtwerte nach DIN 18040, kein Nachweis nach Landesbauordnung.</strong>{" "}
          Aufzugspflicht, Wohnungsquoten (barrierefrei/rollstuhlgerecht), Bewegungsflächen und Türbreiten
          sind Überschläge nach DIN 18040 / MBO und sind bundeslandabhängig. Prüfung und Nachweis durch
          Bauvorlageberechtigte:r / Fachplanung erforderlich.
        </span>
      </div>

      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · NGF {de(pm.ngf)} m² · OKF ≈ {de1((pm.storeys - 1) * pm.storeyHeight)} m · ≈ {de(weAusNgf(pm.ngf))} WE (Näherungen, überschreibbar)
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eingabe-Cards: 4 Fach-Cards */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4" /> Erschließung & Aufzug</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="OKF höchstes Geschoss" value={okf} step={0.1} suffix="m" min={0} onChange={(v) => { setOkf(v); setOkfDirty(true); }} />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Aufzug erforderlich</label>
                <Select value={aufzugMode} onValueChange={setAufzugMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">automatisch (aus Geschossen/OKF)</SelectItem>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Aufzugskabine Breite" value={kabineB} step={0.05} suffix="m" min={0} onChange={setKabineB} />
              <NumberField label="Aufzugskabine Tiefe" value={kabineT} step={0.05} suffix="m" min={0} onChange={setKabineT} />
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Stufenlose Erschließung (Eingang/Wege)</label>
                <Select value={erschliessung} onValueChange={setErschliessung}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 text-xs text-slate-500">
                Bewegungsfläche vor dem Aufzug ≥ 1,50 × 1,50 m (DIN 18040). OKF ≈ Fußbodenoberkante höchstes Geschoss — nicht die Gesamthöhe. Aufzugspflicht ist bundeslandabhängig.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Users className="w-4 h-4" /> Wohnungsquoten barrierefrei (B) / rollstuhlgerecht (R)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Wohnungen gesamt (WE)" value={we} step={1} suffix="Stk." min={0} onChange={(v) => { setWe(v); setWeDirty(true); }} />
              <NumberField label="R-Quote (rollstuhlgerecht)" value={quotePct} step={1} suffix="%" min={0} onChange={setQuotePct} />
              <NumberField label="Vorhandene barrierefrei erreichbare WE" value={vorhErreichbar} step={1} suffix="Stk." min={0} onChange={setVorhErreichbar} />
              <NumberField label="Vorhandene rollstuhlgerechte WE" value={vorhR} step={1} suffix="Stk." min={0} onChange={setVorhR} />
              <div className="col-span-2 text-xs text-slate-500">
                Barrierefreie KFZ-Stellplätze im Reiter „Landschaft“. Quoten sind bundeslandabhängig (Landesbauordnung).
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Move className="w-4 h-4" /> Bewegungsflächen & Türbreiten</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Ausbaustufe</label>
                <Select value={stufe} onValueChange={setStufe}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUSBAUSTUFEN).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Geplante Bewegungsfläche (quadratisch)" value={bewegung} step={0.05} suffix="m" min={0} onChange={(v) => { setBewegung(v); setBewDirty(true); }} />
              <NumberField label="Geplante lichte Türbreite" value={tuerBreite} step={0.05} suffix="m" min={0} onChange={(v) => { setTuerBreite(v); setTuerDirty(true); }} />
              <NumberField label="Lichte Türhöhe" value={tuerHoehe} step={0.05} suffix="m" min={0} onChange={setTuerHoehe} />
              <NumberField label="Flurbreite (Wohnung)" value={flur} step={0.05} suffix="m" min={0} onChange={setFlur} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Bath className="w-4 h-4" /> Sanitärräume</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Bad-Ausbaustufe</label>
                <Select value={saniStufe} onValueChange={setSaniStufe}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUSBAUSTUFEN).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Bewegungsfläche vor Objekten" value={saniBewegung} step={0.05} suffix="m" min={0} onChange={(v) => { setSaniBewegung(v); setSaniDirty(true); }} />
              <NumberField label="Seitliche Fläche neben WC" value={wcSeitlich} step={0.05} suffix="m" min={0} onChange={setWcSeitlich} />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Bodengleiche Dusche</label>
                <Select value={dusche} onValueChange={setDusche}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Waschtisch unterfahrbar</label>
                <Select value={waschtisch} onValueChange={setWaschtisch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Richtwert-KPIs + Zusammenfassung */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Aufzugspflicht (Richtwert)" value={kpi.pflicht ? "ja" : "nein"} accent="text-rose-600" />
            <Stat label="Aufzugskabine (Richtwert)" value={kpi.kab ? "ausreichend" : "unter 1,10 × 1,40 m"} accent="text-orange-600" />
            <Stat label="Wohnungen gesamt (Konzept)" value={`${de(we)} WE`} accent="text-slate-700" />
            <Stat label="Erf. barrierefrei erreichbar (Richtwert)" value={`${de(kpi.erfErr)} WE`} accent="text-sky-600" />
            <Stat label="Erf. rollstuhlgerecht (Richtwert)" value={`${de(kpi.erfR)} WE`} accent="text-violet-600" />
            <Stat label="Erf. Bewegungsfläche (Richtwert)" value={`${de1(bewegungsflaeche(stufe))} m`} accent="text-amber-600" />
            <Stat label="Türbreite (Richtwert)" value={tuerBreiteOk(tuerBreite, stufe) ? "ausreichend" : "zu gering"} accent="text-cyan-700" />
            <Stat label="Sanitär (Richtwert)" value={sanitaerOk({ stufe: saniStufe, bewegung: saniBewegung, dusche, wcSeitlich, waschtisch }) ? "plausibel" : "Hinweis"} accent="text-emerald-700" />
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
                Barrierefreie KFZ-Stellplätze (Anzahl & Maß 3,50 × 5,00 m) im Reiter „Landschaft“ — der Barrierefreiheit-Reiter behandelt die gebäudeinterne DIN 18040 (Erschließung, Aufzug, Wohnungen, Bewegungsflächen, Sanitär).
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
