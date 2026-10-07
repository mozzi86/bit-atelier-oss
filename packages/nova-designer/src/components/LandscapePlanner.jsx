import React, { useEffect, useMemo, useState } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Trees, Car, Bike, Droplets, Flame, AlertTriangle,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { LAGEPLAN_DEFAULT } from "@designer/lib/lageplan";
import { gruenflaecheAusLayer } from "@designer/lib/pflanzen";
import AussenanlagenEditor from "./AussenanlagenEditor";
import {
  DEFAULT_KFZ_SCHLUESSEL, DEFAULT_FAHRRAD_SCHLUESSEL,
  DEFAULT_BARRIEREFREI_PCT, DEFAULT_BARRIEREFREI_MIN, BF_STPL_MASS,
  DEFAULT_STPL_BREITE, DEFAULT_STPL_LAENGE, DEFAULT_FLAECHENFAKTOR,
  PSI_DACH, PSI_BEFESTIGT, PSI_GRUEN, DEFAULT_REGEN_R, DEFAULT_REGENDAUER_MIN,
  DEFAULT_FW_BREITE,
  erfKfzStellplaetze, erfFahrradStellplaetze, erfBarrierefrei,
  stellplatzFlaecheJe, stellplatzFlaecheGesamt, versiegelungsgrad,
  gruenflaecheAnteil, abflussFlaeche, spitzenabflussQ, rueckhaltevolumen,
  aussenanlagenChecks,
} from "@designer/lib/landscape";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

/**
 * @param {{ complexData?: any }} props complexData (Phase 37): location + site_parcel for the Lageplan sub-view,
 *   site_area as the default plot size
 */
export default function LandscapePlanner({ complexData } = {}) {
  const { t } = useI18n();
  const { project } = useProject();
  // Geometrie READ-only aus der gemeinsamen Quelle — nie duplizieren.
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // Phase 37: the Außenanlagen layer is owned here (one useFachlayer per field, KD-17) so the KPI side can
  // read the drawn green area while the editor writes it.
  const [ansicht, setAnsicht] = useState("kennzahlen");
  const [aussenLayer, setAussenLayer] = useFachlayer(project?.id, "aussenanlagen_layer", LAGEPLAN_DEFAULT);
  const planGruen = useMemo(() => gruenflaecheAusLayer(aussenLayer), [aussenLayer]);

  // WE-Näherung aus NGF (im Projekt etabliert: max(1, round(ngf/75))).
  const weDefault = Math.max(1, Math.round(pm.ngf / 75)) || 1;

  // Lokaler State (useState only — keine DB, kein bitApi, keine Store-Persistenz).
  const [we, setWe] = usePanelState("landscape:we", weDefault);
  const [weDirty, setWeDirty] = usePanelState("landscape:weDirty", false);

  // Plot defaults to the parcel area reported by SiteDesigner (KD-11) when the project has one.
  const [plot, setPlot] = usePanelState("landscape:plot", Number(complexData?.site_area) > 0 ? Math.round(Number(complexData.site_area)) : 3500);

  // KFZ-Stellplätze
  const [kfzSchluessel, setKfzSchluessel] = usePanelState("landscape:kfzSchluessel", DEFAULT_KFZ_SCHLUESSEL);
  const [stplBreite, setStplBreite] = usePanelState("landscape:stplBreite", DEFAULT_STPL_BREITE);
  const [stplLaenge, setStplLaenge] = usePanelState("landscape:stplLaenge", DEFAULT_STPL_LAENGE);
  const [flaechenfaktor, setFlaechenfaktor] = usePanelState("landscape:flaechenfaktor", DEFAULT_FLAECHENFAKTOR);
  const [vorhandenKfz, setVorhandenKfz] = usePanelState("landscape:vorhandenKfz", 0);

  // Fahrrad & barrierefrei
  const [fahrradBasis, setFahrradBasis] = usePanelState("landscape:fahrradBasis", "we");
  const [fahrradSchluessel, setFahrradSchluessel] = usePanelState("landscape:fahrradSchluessel", DEFAULT_FAHRRAD_SCHLUESSEL);
  const [barrierefreiPct, setBarrierefreiPct] = usePanelState("landscape:barrierefreiPct", DEFAULT_BARRIEREFREI_PCT);
  const [barrierefreiMin, setBarrierefreiMin] = usePanelState("landscape:barrierefreiMin", DEFAULT_BARRIEREFREI_MIN);
  const [barrierefreiVorh, setBarrierefreiVorh] = usePanelState("landscape:barrierefreiVorh", 0);

  // Entwässerung & Versiegelung
  const [psiDach, setPsiDach] = usePanelState("landscape:psiDach", PSI_DACH);
  const [psiBefestigt, setPsiBefestigt] = usePanelState("landscape:psiBefestigt", PSI_BEFESTIGT);
  const [psiGruen, setPsiGruen] = usePanelState("landscape:psiGruen", PSI_GRUEN);
  const [regenR, setRegenR] = usePanelState("landscape:regenR", DEFAULT_REGEN_R);
  const [regendauer, setRegendauer] = usePanelState("landscape:regendauer", DEFAULT_REGENDAUER_MIN);
  const [gruenflaeche, setGruenflaeche] = usePanelState("landscape:gruenflaeche", 0);
  // GARTEN-04: green polygons drawn on the Lageplan feed this number until the user overrides it by hand.
  const [gruenDirty, setGruenDirty] = usePanelState("landscape:gruenflaecheDirty", false);
  useEffect(() => {
    if (!gruenDirty && planGruen > 0 && planGruen !== gruenflaeche) setGruenflaeche(planGruen);
  }, [planGruen, gruenDirty, gruenflaeche, setGruenflaeche]);
  const gruenAusPlan = !gruenDirty && planGruen > 0;

  // Feuerwehr-Aufstellflächen
  const [fwErforderlich, setFwErforderlich] = usePanelState("landscape:fwErforderlich", "ja");
  const [fwBreite, setFwBreite] = usePanelState("landscape:fwBreite", DEFAULT_FW_BREITE);
  const [fwZufahrt, setFwZufahrt] = usePanelState("landscape:fwZufahrt", 3.5);

  // WE aus dem Modell vorbelegen — nur solange Nutzer:in nichts geändert hat (Dirty-Flag).
  useEffect(() => {
    if (!weDirty && pm.ngf > 0) setWe(Math.max(1, Math.round(pm.ngf / 75)) || 1);
  }, [pm.ngf, weDirty, setWe]);

  const kpi = useMemo(() => {
    const erfKfz = erfKfzStellplaetze(we, kfzSchluessel);
    const erfBike = erfFahrradStellplaetze({ we, bgf: pm.bgf, schluessel: fahrradSchluessel, basis: fahrradBasis });
    const erfBf = erfBarrierefrei(erfKfz, barrierefreiPct, barrierefreiMin);
    const flJe = stellplatzFlaecheJe(stplBreite, stplLaenge, flaechenfaktor);
    const flGes = stellplatzFlaecheGesamt(erfKfz, stplBreite, stplLaenge, flaechenfaktor);
    const vgrad = versiegelungsgrad({ footArea: pm.footArea, stellplatzflaeche: flGes, gruenflaeche, plot });
    const ggrad = gruenflaecheAnteil(gruenflaeche, plot);
    const aRed = abflussFlaeche({ footArea: pm.footArea, psiDach, stellplatzflaeche: flGes, psiBefestigt, gruenflaeche, psiGruen });
    const Q = spitzenabflussQ(regenR, aRed);
    const V = rueckhaltevolumen(Q, regendauer);
    const checks = aussenanlagenChecks({
      erfKfz, vorhandenKfz, erfBarrierefrei: erfBf, barrierefreiVorh,
      versiegelung: vgrad, gruen: ggrad, volumen: V, fwBreite, plot,
    });
    return { erfKfz, erfBike, erfBf, flJe, flGes, vgrad, ggrad, aRed, Q, V, checks };
  }, [
    we, plot, kfzSchluessel, stplBreite, stplLaenge, flaechenfaktor, vorhandenKfz,
    fahrradBasis, fahrradSchluessel, barrierefreiPct, barrierefreiMin, barrierefreiVorh,
    psiDach, psiBefestigt, psiGruen, regenR, regendauer, gruenflaeche, fwBreite,
    pm.footArea, pm.bgf,
  ]);

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Konzept-Richtwerte für die Außenanlagenplanung — kein Genehmigungsnachweis.</strong>{" "}
          Stellplatz-, Begrünungs- und Entwässerungsanforderungen sind kommunal unterschiedlich
          (Stellplatzsatzung, Entwässerungssatzung der Gemeinde) und durch Fachplaner:in zu prüfen.
        </span>
      </div>

      <Tabs value={ansicht} onValueChange={setAnsicht}>
        <TabsList>
          <TabsTrigger value="kennzahlen" data-testid="ls-tab-kennzahlen">{t("Kennzahlen")}</TabsTrigger>
          <TabsTrigger value="lageplan" data-testid="ls-tab-lageplan">{t("Lageplan")}</TabsTrigger>
        </TabsList>
        <TabsContent value="lageplan" className="pt-3">
          <AussenanlagenEditor complexData={complexData} layer={aussenLayer} setLayer={setAussenLayer} />
        </TabsContent>
        <TabsContent value="kennzahlen" className="pt-3 space-y-4">
      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · BGF {de(pm.bgf)} m² · Grundfläche {de(pm.footArea)} m² ≈ {Math.max(1, Math.round(pm.ngf / 75))} WE à 75 m²
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eingabe-Cards */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Trees className="w-4 h-4" /> Grundstück & Bezug</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Wohneinheiten (WE)" value={we} suffix="WE" min={0} onChange={(v) => { setWe(v); setWeDirty(true); }} />
              <NumberField label="Grundstücksfläche" value={plot} suffix="m²" min={0} onChange={setPlot} />
              <Stat label="Bebaute Fläche (Footprint)" value={`${de(pm.footArea)} m²`} accent="text-slate-700" />
              <Stat label="BGF (aus Modell)" value={`${de(pm.bgf)} m²`} accent="text-slate-700" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Car className="w-4 h-4" /> KFZ-Stellplätze</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Stellplatzschlüssel je WE" value={kfzSchluessel} step={0.1} suffix="Stpl./WE" min={0} onChange={setKfzSchluessel} />
              <NumberField label="Stellplatzmaß Breite" value={stplBreite} step={0.1} suffix="m" min={0} onChange={setStplBreite} />
              <NumberField label="Stellplatzmaß Länge" value={stplLaenge} step={0.1} suffix="m" min={0} onChange={setStplLaenge} />
              <NumberField label="Flächenfaktor inkl. Fahrgasse" value={flaechenfaktor} step={0.1} suffix="× netto" min={0} onChange={setFlaechenfaktor} />
              <NumberField label="Vorhandene KFZ-Stellplätze" value={vorhandenKfz} suffix="Stpl." min={0} onChange={setVorhandenKfz} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Bike className="w-4 h-4" /> Fahrrad- & barrierefreie Stellplätze</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Fahrrad-Bemessungsbasis</label>
                <Select value={fahrradBasis} onValueChange={setFahrradBasis}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="we">je WE</SelectItem>
                    <SelectItem value="bgf">je 100 m² BGF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Fahrradstellplätze-Schlüssel" value={fahrradSchluessel} step={0.1} suffix="Stpl." min={0} onChange={setFahrradSchluessel} />
              <NumberField label="Barrierefreier Anteil" value={barrierefreiPct} step={0.5} suffix="%" min={0} onChange={setBarrierefreiPct} />
              <NumberField label="Mindest barrierefreie Stpl." value={barrierefreiMin} suffix="Stpl." min={0} onChange={setBarrierefreiMin} />
              <NumberField label="Vorhandene barrierefreie Stpl." value={barrierefreiVorh} suffix="Stpl." min={0} onChange={setBarrierefreiVorh} />
              <Stat label="Maß barrierefreier Stpl." value={BF_STPL_MASS} accent="text-slate-700" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Droplets className="w-4 h-4" /> Entwässerung & Versiegelung</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Abflussbeiwert ψ Dach" value={psiDach} step={0.05} suffix="ψ" min={0} onChange={setPsiDach} />
              <NumberField label="ψ befestigt/Asphalt" value={psiBefestigt} step={0.05} suffix="ψ" min={0} onChange={setPsiBefestigt} />
              <NumberField label="ψ Grün" value={psiGruen} step={0.05} suffix="ψ" min={0} onChange={setPsiGruen} />
              <NumberField label="Bemessungsregen r" value={regenR} step={5} suffix="l/(s·ha)" min={0} onChange={setRegenR} />
              <NumberField label="Regendauer" value={regendauer} step={5} suffix="min" min={0} onChange={setRegendauer} />
              <div className="space-y-1">
                <NumberField label="Begrünte/unversiegelte Fläche" value={gruenflaeche} suffix="m²" min={0} onChange={(v) => { setGruenflaeche(v); setGruenDirty(true); }} />
                {gruenAusPlan && <Badge className="bg-emerald-100 text-emerald-800" data-testid="ls-gruen-aus-plan">{t("aus Lageplan")}: {planGruen.toLocaleString("de-DE")} m²</Badge>}
                {gruenDirty && planGruen > 0 && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setGruenDirty(false)} data-testid="ls-gruen-uebernehmen">{t("aus Lageplan übernehmen")} ({planGruen.toLocaleString("de-DE")} m²)</Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Flame className="w-4 h-4" /> Feuerwehr-Aufstellflächen (DIN 14090)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Aufstellfläche erforderlich</label>
                <Select value={fwErforderlich} onValueChange={setFwErforderlich}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Breite Aufstell-/Bewegungsfläche" value={fwBreite} step={0.5} suffix="m" min={0} onChange={setFwBreite} />
              <NumberField label="Zufahrtsbreite" value={fwZufahrt} step={0.1} suffix="m" min={0} onChange={setFwZufahrt} />
              <Stat label="Hinweis Löschwasser" value="Brandschutz → Phase 18" accent="text-slate-700" />
            </CardContent>
          </Card>
        </div>

        {/* KPIs + Plausibilitäts-Checks */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Erf. KFZ-Stellplätze (Richtwert)" value={`${de(kpi.erfKfz)} Stpl.`} accent="text-blue-600" />
            <Stat label="Erf. Fahrradstellplätze (Richtwert)" value={`${de(kpi.erfBike)} Stpl.`} accent="text-blue-600" />
            <Stat label="Erf. barrierefreie Stpl. (Richtwert)" value={`${de(kpi.erfBf)} Stpl.`} accent="text-slate-800" />
            <Stat label="Gesamt Stellplatzfläche (Richtwert)" value={`${de(kpi.flGes)} m²`} accent="text-slate-800" />
            <Stat label="Versiegelungsgrad (Richtwert)" value={`${Math.round(kpi.vgrad * 100)} %`} accent="text-violet-600" />
            <Stat label="Begrünungsgrad (Richtwert)" value={`${Math.round(kpi.ggrad * 100)} %`} accent="text-emerald-600" />
            <Stat label="Spitzenabfluss Q (Richtwert)" value={`${de(kpi.Q)} l/s`} accent="text-cyan-600" />
            <Stat label="Regenrückhaltevolumen (Richtwert)" value={`${de(kpi.V)} m³`} accent="text-amber-600" />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Trees className="w-4 h-4" /> Plausibilität (Richtwert)</span>
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
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
