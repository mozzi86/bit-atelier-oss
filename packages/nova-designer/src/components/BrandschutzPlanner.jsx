import React, { useEffect, useMemo, useState } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  ShieldAlert, DoorOpen, Siren, Map, Gauge, AlertTriangle,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  NUTZUNGEN, ANLEITER_ARTEN, SCHUTZUMFANG, FEUERWEHRPLAN_BESTANDTEILE,
  DEFAULT_MAX_FLUCHTWEG, DEFAULT_FLAECHE_JE_TR, DEFAULT_FLAECHE_JE_MELDER,
  gebaeudeklasse, feuerwiderstand, istHochhaus, erfTreppenraeume,
  anleiterZulaessig, schutzumfangFlaeche, melderAnzahl, sonderbauTrigger,
  feuerwehrplanErforderlich, feuerwehrplanStatus, brandChecks,
} from "@designer/lib/fire";
import { useBuildingProgram, programMetrics, footprintWD } from "@core/lib/useBuildingProgram";
// Phase 38: der Fluchtweg-Plan (Phase 34) ist zum Brandschutz-Plan-Editor gewachsen
// (Fluchtwege, Brandabschnitte, Symbole, Melder-Raster) — eigene Komponente.
import BrandschutzPlanEditor from "./BrandschutzPlanEditor";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

export default function BrandschutzPlanner() {
  // Geometrie READ-only aus der gemeinsamen Quelle — nie duplizieren, nie zurückschreiben.
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // Lokaler State (useState only — keine DB, kein bitApi, keine Store-Persistenz).
  // Card 1 — Gebäudeklasse (BRAND-01)
  const [okf, setOkf] = usePanelState("brandschutz:okf", 0);
  const [okfDirty, setOkfDirty] = usePanelState("brandschutz:okfDirty", false);
  const [nutzung, setNutzung] = usePanelState("brandschutz:nutzung", "wohnen");
  const [groessteNE, setGroessteNE] = usePanelState("brandschutz:groessteNE", 0);
  const [neDirty, setNeDirty] = usePanelState("brandschutz:neDirty", false);
  const [freistehend, setFreistehend] = usePanelState("brandschutz:freistehend", "nein");

  // Card 2 — Rettungswege (BRAND-02)
  const [maxFluchtweg, setMaxFluchtweg] = usePanelState("brandschutz:maxFluchtweg", DEFAULT_MAX_FLUCHTWEG);
  const [laengsteFlucht, setLaengsteFlucht] = usePanelState("brandschutz:laengsteFlucht", 0);
  const [fluchtDirty, setFluchtDirty] = usePanelState("brandschutz:fluchtDirty", false);
  const [flaecheJeTr, setFlaecheJeTr] = usePanelState("brandschutz:flaecheJeTr", DEFAULT_FLAECHE_JE_TR);
  const [bruestung, setBruestung] = usePanelState("brandschutz:bruestung", 0);
  const [bruestungDirty, setBruestungDirty] = usePanelState("brandschutz:bruestungDirty", false);
  const [anleiterArt, setAnleiterArt] = usePanelState("brandschutz:anleiterArt", "drehleiter");

  // Card 3 — BMZ & Brandmeldetechnik (BRAND-03)
  const [bmaMode, setBmaMode] = usePanelState("brandschutz:bmaMode", "auto");
  const [schutzumfang, setSchutzumfang] = usePanelState("brandschutz:schutzumfang", "kat1");
  const [ueberwachteFlaeche, setUeberwachteFlaeche] = usePanelState("brandschutz:ueberwachteFlaeche", 0);
  const [flDirty, setFlDirty] = usePanelState("brandschutz:flDirty", false);
  const [flaecheJeMelder, setFlaecheJeMelder] = usePanelState("brandschutz:flaecheJeMelder", DEFAULT_FLAECHE_JE_MELDER);

  // Card 4 — Feuerwehrpläne (BRAND-04)
  const [fwpMode, setFwpMode] = usePanelState("brandschutz:fwpMode", "auto");
  const [bestandteile, setBestandteile] = usePanelState("brandschutz:bestandteile", {
    uebersichtsplan: "nein", geschossplaene: "nein", legende: "nein",
    laufkarten: "nein", abstimmung: "nein",
  });
  const setBestandteil = (key, v) => setBestandteile((prev) => ({ ...prev, [key]: v }));

  // Modell-/OKF-getriebene Vorbelegungen — nur solange Nutzer:in nichts geändert hat.
  // OKF ≈ (storeys−1)·storeyHeight [ASSUMED A1] — NICHT die Gesamthöhe (storeys·storeyHeight)!
  useEffect(() => {
    if (!okfDirty && pm.storeys > 0) setOkf(Math.round((pm.storeys - 1) * pm.storeyHeight * 10) / 10);
  }, [pm.storeys, pm.storeyHeight, okfDirty, setOkf]);
  useEffect(() => {
    if (!neDirty && pm.footArea > 0) setGroessteNE(Math.round(pm.footArea)); // [ASSUMED A13]
  }, [pm.footArea, neDirty, setGroessteNE]);
  useEffect(() => {
    // Längste Fluchtweglänge ≈ halbe Footprint-Diagonale. [ASSUMED A6]
    const wd = footprintWD(store.footprintM);
    if (!fluchtDirty && pm.footArea > 0) setLaengsteFlucht(Math.round(Math.sqrt(wd.w ** 2 + wd.d ** 2) / 2));
  }, [pm.footArea, fluchtDirty, store.footprintM, setLaengsteFlucht]);
  useEffect(() => {
    // Brüstungshöhe oberstes Geschoss ≈ OKF (für Anleiter-Zulässigkeit).
    if (!bruestungDirty) setBruestung(okf);
  }, [okf, bruestungDirty, setBruestung]);
  useEffect(() => {
    if (!flDirty && pm.bgf > 0) setUeberwachteFlaeche(Math.round(schutzumfangFlaeche(pm.bgf, schutzumfang)));
  }, [pm.bgf, schutzumfang, flDirty, setUeberwachteFlaeche]);

  const kpi = useMemo(() => {
    const gk = gebaeudeklasse({ okf, groessteNE, freistehend: freistehend === "ja" });
    const fw = feuerwiderstand(gk);
    const hochhaus = istHochhaus(okf);
    const sb = sonderbauTrigger({ okf, nutzung, groessteNE });
    const anleiterOk = anleiterArt === "nein" ? true : anleiterZulaessig(bruestung, anleiterArt);
    const erfTr = erfTreppenraeume({ footArea: pm.footArea, hochhaus, anleiterOk, flaecheJeTr });
    const bmaErforderlich = bmaMode === "auto" ? (hochhaus || sb.ist) : bmaMode === "ja";
    const melder = melderAnzahl(ueberwachteFlaeche, flaecheJeMelder);
    const fwpErf = fwpMode === "auto" ? feuerwehrplanErforderlich(bmaErforderlich, sb.ist) : fwpMode === "ja";
    const fwStatus = feuerwehrplanStatus(bestandteile);
    const checks = brandChecks({
      okf, groessteNE, freistehend: freistehend === "ja", nutzung,
      laengsteFlucht, maxFluchtweg, anleiterArt, bruestung, flaecheJeTr,
      footArea: pm.footArea, bmaMode, schutzumfang, ueberwachteFlaeche,
      flaecheJeMelder, fwpMode, feuerwehrBestandteile: bestandteile,
    });
    return { gk, fw, hochhaus, sb, anleiterOk, erfTr, bmaErforderlich, melder, fwpErf, fwStatus, checks };
  }, [
    okf, groessteNE, freistehend, nutzung, laengsteFlucht, maxFluchtweg,
    anleiterArt, bruestung, flaecheJeTr, pm.footArea, bmaMode, schutzumfang,
    ueberwachteFlaeche, flaecheJeMelder, fwpMode, bestandteile,
  ]);

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Brandschutz — Konzept-Richtwerte, kein prüffähiges Brandschutzkonzept und keine Abnahme.</strong>{" "}
          Gebäudeklasse, Rettungswege, Melderzahl und Feuerwehrplan-Checkliste sind Überschläge nach
          MBO / DIN und ersetzen kein Brandschutzkonzept nach Landesbauordnung. Erstellung und Abnahme
          durch Fachplaner:in Brandschutz / Prüfsachverständige:r und Bauaufsicht erforderlich.
        </span>
      </div>

      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · Grundfläche {de(pm.footArea)} m² · BGF {de(pm.bgf)} m² · OKF ≈ {de1((pm.storeys - 1) * pm.storeyHeight)} m (Näherung, überschreibbar)
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eingabe-Cards: 4 Fach-Cards */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="w-4 h-4" /> Gebäudeklasse & Anforderungen</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="OKF höchstes Geschoss" value={okf} step={0.1} suffix="m" min={0} onChange={(v) => { setOkf(v); setOkfDirty(true); }} />
              <NumberField label="Größte Nutzungseinheit" value={groessteNE} suffix="m²" min={0} onChange={(v) => { setGroessteNE(v); setNeDirty(true); }} />
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Nutzung</label>
                <Select value={nutzung} onValueChange={setNutzung}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(NUTZUNGEN).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Freistehend</label>
                <Select value={freistehend} onValueChange={setFreistehend}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 text-xs text-slate-500">
                OKF ≈ Fußbodenoberkante höchstes Aufenthaltsgeschoss (MBO §2) — nicht die Gesamthöhe. Landesbauordnungen können abweichen.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><DoorOpen className="w-4 h-4" /> Rettungswege & Fluchtweglängen</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Max. zulässige Fluchtweglänge" value={maxFluchtweg} step={1} suffix="m" min={0} onChange={setMaxFluchtweg} />
              <NumberField label="Längste geschätzte Fluchtweglänge" value={laengsteFlucht} suffix="m" min={0} onChange={(v) => { setLaengsteFlucht(v); setFluchtDirty(true); }} />
              <NumberField label="Fläche je notw. Treppenraum" value={flaecheJeTr} step={100} suffix="m²" min={0} onChange={setFlaecheJeTr} />
              <NumberField label="Brüstungshöhe oberstes Geschoss" value={bruestung} step={0.1} suffix="m" min={0} onChange={(v) => { setBruestung(v); setBruestungDirty(true); }} />
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">2. Rettungsweg über Anleiterung</label>
                <Select value={anleiterArt} onValueChange={setAnleiterArt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ANLEITER_ARTEN).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 text-xs text-slate-500">
                Feuerwehr-Aufstellflächen & Zufahrten (DIN 14090) im Reiter „Landschaft“.
              </div>
            </CardContent>
          </Card>

          {/* Brandschutz-Plan (Phase 38, BSP-01…04): Fluchtwege, Brandabschnitte, Symbole, Melder-Raster */}
          <BrandschutzPlanEditor
            maxFluchtweg={maxFluchtweg}
            onUebernehmen={(len) => { setLaengsteFlucht(len); setFluchtDirty(true); }}
          />

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Siren className="w-4 h-4" /> BMZ & Brandmeldetechnik</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">BMA erforderlich</label>
                <Select value={bmaMode} onValueChange={setBmaMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">automatisch (aus Hochhaus/Sonderbau)</SelectItem>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Schutzumfang (DIN 14675)</label>
                <Select value={schutzumfang} onValueChange={setSchutzumfang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCHUTZUMFANG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Überwachte Fläche" value={ueberwachteFlaeche} suffix="m²" min={0} onChange={(v) => { setUeberwachteFlaeche(v); setFlDirty(true); }} />
              <NumberField label="Fläche je Melder" value={flaecheJeMelder} step={5} suffix="m²" min={0} onChange={setFlaecheJeMelder} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Map className="w-4 h-4" /> Feuerwehrpläne (DIN 14095) & Abnahme</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Feuerwehrpläne erforderlich</label>
                <Select value={fwpMode} onValueChange={setFwpMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">automatisch (aus BMA/Sonderbau)</SelectItem>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {Object.entries(FEUERWEHRPLAN_BESTANDTEILE).map(([k, label]) => (
                <div key={k} className="space-y-1 col-span-2">
                  <label className="text-xs text-slate-500">{label}</label>
                  <Select value={bestandteile[k]} onValueChange={(v) => setBestandteil(k, v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ja">ja</SelectItem>
                      <SelectItem value="nein">nein</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Richtwert-KPIs + Zusammenfassung */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Gebäudeklasse (Richtwert)" value={`GK ${kpi.gk}`} accent="text-rose-600" />
            <Stat label="Feuerwiderstand (Richtwert)" value={kpi.fw} accent="text-orange-600" />
            <Stat label="Hochhaus (Richtwert)" value={kpi.hochhaus ? "ja" : "nein"} accent="text-red-600" />
            <Stat label="Notwendige Treppenräume (Richtwert)" value={de(kpi.erfTr)} accent="text-amber-600" />
            <Stat label="2. Rettungsweg (Konzept)" value={kpi.anleiterOk ? "Anleiterung zulässig" : "baulicher 2. RW erforderlich"} accent="text-slate-700" />
            <Stat label="Überwachte Fläche (Richtwert)" value={`${de(ueberwachteFlaeche)} m²`} accent="text-sky-600" />
            <Stat label="Melderanzahl (Überschlag)" value={`${de(kpi.melder)} Melder`} accent="text-violet-600" />
            <Stat label="BMA (Richtwert)" value={kpi.bmaErforderlich ? "erforderlich" : "nicht abgeleitet"} accent="text-cyan-700" />
            <Stat label="Feuerwehrpläne (Richtwert)" value={kpi.fwpErf ? `erforderlich (${kpi.fwStatus.erfuellt}/${kpi.fwStatus.gesamt})` : "nicht erforderlich"} accent="text-emerald-700" />
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
                Feuerwehr-Aufstellflächen & Zufahrten (DIN 14090) im Reiter „Landschaft“ — der Brandschutz-Reiter behandelt DIN 14095 (Feuerwehrpläne) und Konzept-Richtwerte.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
