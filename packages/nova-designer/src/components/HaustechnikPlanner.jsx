import React, { useEffect, useMemo } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  Thermometer, Wind, Droplet, Zap, Gauge, AlertTriangle,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import {
  GEBAEUDESTANDARDS, WAERMEERZEUGER, LUEFTUNGSSYSTEME,
  DEFAULT_LUFTWECHSEL, DEFAULT_AUSSENLUFT_P, DEFAULT_PERSONEN_JE_WE,
  DEFAULT_TRINKWASSER_LPD, DEFAULT_WW_ANTEIL_PCT, DEFAULT_SANITAER_JE_WE,
  DEFAULT_VA_M2, DEFAULT_KW_JE_WE, DEFAULT_GZF, DEFAULT_PV_KWP_M2, DEFAULT_PV_ERTRAG,
  heizlastKW, jahresHeizwaermebedarf, waermepumpeStrombedarf, lueftungVolumenstrom,
  trinkwasserBedarf, warmwasserBedarf, trinkwasserJahrM3, elektroAnschlusswert,
  pvPotenzial, tgaChecks,
} from "@designer/lib/hvac";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { useI18n } from "@core/lib/i18n";
import TgaNetzEditor from "./TgaNetzEditor";
// Phase 63-03: drainage sub-tab (ENTW-01…05) — its own layer, its own cards.
import EntwaesserungPlanner from "./EntwaesserungPlanner";

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

export default function HaustechnikPlanner({ complexData = null } = {}) {
  const { t } = useI18n();
  // Phase 41: Sub-Ansichten „Konzept" (bisheriges Panel) | „Netz" (Leitungszug-Editor).
  // Phase 63-03: „Entwässerung" (EntwaesserungPlanner) als dritter Sub-Tab.
  const [ansicht, setAnsicht] = usePanelState("haustechnik:ansicht", "konzept");
  // Geometrie READ-only aus der gemeinsamen Quelle — nie duplizieren, nie zurückschreiben.
  const store = useBuildingProgram();
  const pm = programMetrics(store);

  // WE-Näherung aus NGF (im Projekt etabliert: max(1, round(ngf/75))).
  const weDefault = Math.max(1, Math.round(pm.ngf / 75)) || 1;

  // Lokaler State (useState only — keine DB, kein bitApi, keine Store-Persistenz).
  // Heizung (TGA-01)
  const [standard, setStandard] = usePanelState("haustechnik:standard", "geg-neubau");
  const [qHeizlast, setQHeizlast] = usePanelState("haustechnik:qHeizlast", GEBAEUDESTANDARDS["geg-neubau"].heizlast);
  const [qHeizlastDirty, setQHeizlastDirty] = usePanelState("haustechnik:qHeizlastDirty", false);
  const [qBedarf, setQBedarf] = usePanelState("haustechnik:qBedarf", GEBAEUDESTANDARDS["geg-neubau"].bedarf);
  const [qBedarfDirty, setQBedarfDirty] = usePanelState("haustechnik:qBedarfDirty", false);
  const [beheizteFlaeche, setBeheizteFlaeche] = usePanelState("haustechnik:beheizteFlaeche", 0);
  const [areaTouched, setAreaTouched] = usePanelState("haustechnik:areaTouched", false);
  const [erzeuger, setErzeuger] = usePanelState("haustechnik:erzeuger", "wp-luft");
  const [jaz, setJaz] = usePanelState("haustechnik:jaz", WAERMEERZEUGER["wp-luft"].jaz);
  const [jazDirty, setJazDirty] = usePanelState("haustechnik:jazDirty", false);

  // Lüftung (TGA-02)
  const [lueftungssystem, setLueftungssystem] = usePanelState("haustechnik:lueftungssystem", "zentral-wrg");
  const [lueftBasis, setLueftBasis] = usePanelState("haustechnik:lueftBasis", "luftwechsel");
  const [luftwechsel, setLuftwechsel] = usePanelState("haustechnik:luftwechsel", DEFAULT_LUFTWECHSEL);
  const [luftvolumen, setLuftvolumen] = usePanelState("haustechnik:luftvolumen", 0);
  const [volDirty, setVolDirty] = usePanelState("haustechnik:volDirty", false);
  const [aussenluft, setAussenluft] = usePanelState("haustechnik:aussenluft", DEFAULT_AUSSENLUFT_P);
  const [wrgEta, setWrgEta] = usePanelState("haustechnik:wrgEta", LUEFTUNGSSYSTEME["zentral-wrg"].eta);
  const [wrgDirty, setWrgDirty] = usePanelState("haustechnik:wrgDirty", false);

  // Sanitär (TGA-03)
  const [we, setWe] = usePanelState("haustechnik:we", weDefault);
  const [weDirty, setWeDirty] = usePanelState("haustechnik:weDirty", false);
  const [personenJeWe, setPersonenJeWe] = usePanelState("haustechnik:personenJeWe", DEFAULT_PERSONEN_JE_WE);
  const [personen, setPersonen] = usePanelState("haustechnik:personen", () => Math.round(weDefault * DEFAULT_PERSONEN_JE_WE));
  const [personenDirty, setPersonenDirty] = usePanelState("haustechnik:personenDirty", false);
  const [trinkwasser, setTrinkwasser] = usePanelState("haustechnik:trinkwasser", DEFAULT_TRINKWASSER_LPD);
  const [wwAnteil, setWwAnteil] = usePanelState("haustechnik:wwAnteil", DEFAULT_WW_ANTEIL_PCT);
  const [sanitaerJeWe, setSanitaerJeWe] = usePanelState("haustechnik:sanitaerJeWe", DEFAULT_SANITAER_JE_WE);

  // Elektro / PV (TGA-04)
  const [elBasis, setElBasis] = usePanelState("haustechnik:elBasis", "va-m2");
  const [vaM2, setVaM2] = usePanelState("haustechnik:vaM2", DEFAULT_VA_M2);
  const [kwJeWe, setKwJeWe] = usePanelState("haustechnik:kwJeWe", DEFAULT_KW_JE_WE);
  const [gzf, setGzf] = usePanelState("haustechnik:gzf", DEFAULT_GZF);
  const [pvNutzen, setPvNutzen] = usePanelState("haustechnik:pvNutzen", "nein");
  const [dachflaeche, setDachflaeche] = usePanelState("haustechnik:dachflaeche", 0);
  const [dachDirty, setDachDirty] = usePanelState("haustechnik:dachDirty", false);
  const [kwpJeM2, setKwpJeM2] = usePanelState("haustechnik:kwpJeM2", DEFAULT_PV_KWP_M2);
  const [pvErtrag, setPvErtrag] = usePanelState("haustechnik:pvErtrag", DEFAULT_PV_ERTRAG);
  const [ladepunkte, setLadepunkte] = usePanelState("haustechnik:ladepunkte", 0);

  // Modell-Vorbelegungen — nur solange Nutzer:in nichts geändert hat (Dirty-Flags).
  useEffect(() => {
    if (!areaTouched && pm.bgf > 0) setBeheizteFlaeche(Math.round(pm.bgf));
  }, [pm.bgf, areaTouched, setBeheizteFlaeche]);
  useEffect(() => {
    // Nettoluftvolumen ≈ NGF · Geschosshöhe. [ASSUMED A14]
    if (!volDirty && pm.ngf > 0) setLuftvolumen(Math.round(pm.ngf * pm.storeyHeight));
  }, [pm.ngf, pm.storeyHeight, volDirty, setLuftvolumen]);
  useEffect(() => {
    if (!weDirty && pm.ngf > 0) setWe(Math.max(1, Math.round(pm.ngf / 75)) || 1);
  }, [pm.ngf, weDirty, setWe]);
  useEffect(() => {
    if (!personenDirty) setPersonen(Math.round(we * personenJeWe));
  }, [we, personenJeWe, personenDirty, setPersonen]);
  useEffect(() => {
    // Dachfläche ≈ Footprint (nur bei Flachdach plausibel, überschreibbar). [ASSUMED A14]
    if (!dachDirty && pm.footArea > 0) setDachflaeche(Math.round(pm.footArea));
  }, [pm.footArea, dachDirty, setDachflaeche]);

  // Standard-/Erzeuger-/System-getriebene Defaults mit Dirty-Schutz:
  // Auswahlwechsel überschreibt manuell gesetzte Werte NICHT.
  const onStandard = (k) => {
    setStandard(k);
    if (!qHeizlastDirty) setQHeizlast(GEBAEUDESTANDARDS[k]?.heizlast ?? 50);
    if (!qBedarfDirty) setQBedarf(GEBAEUDESTANDARDS[k]?.bedarf ?? 55);
  };
  const onErzeuger = (k) => {
    setErzeuger(k);
    if (!jazDirty) setJaz(WAERMEERZEUGER[k]?.jaz ?? 3.5);
  };
  const onLueftungssystem = (k) => {
    setLueftungssystem(k);
    if (!wrgDirty) setWrgEta(LUEFTUNGSSYSTEME[k]?.eta ?? 80);
  };

  const istWP = erzeuger === "wp-luft" || erzeuger === "wp-sole";
  const hatWrg = Boolean(LUEFTUNGSSYSTEME[lueftungssystem]?.wrg);

  const kpi = useMemo(() => {
    const heizlast = heizlastKW(qHeizlast, beheizteFlaeche);
    const bedarf = jahresHeizwaermebedarf(qBedarf, beheizteFlaeche);
    const wpStrom = istWP ? waermepumpeStrombedarf(bedarf, jaz) : 0;
    const volumenstrom = lueftungVolumenstrom({
      basis: lueftBasis === "luftwechsel" ? "luftwechsel" : "personen",
      n: luftwechsel, volumen: luftvolumen, personen, aussenluft,
    });
    const tw = trinkwasserBedarf(personen, trinkwasser);
    const ww = warmwasserBedarf(tw, wwAnteil);
    const twJahr = trinkwasserJahrM3(tw);
    const anschluss = elektroAnschlusswert({ basis: elBasis, vaM2, bezugsflaeche: beheizteFlaeche, kwJeWe, we, gzf });
    const pv = pvNutzen === "ja" ? pvPotenzial({ dachflaeche, kwpJeM2, ertrag: pvErtrag }) : null;
    const checks = tgaChecks({ standard, qHeizlast, erzeuger, lueftungssystem, beheizteFlaeche, we });
    return { heizlast, bedarf, wpStrom, volumenstrom, tw, ww, twJahr, anschluss, pv, checks };
  }, [
    standard, qHeizlast, qBedarf, beheizteFlaeche, erzeuger, jaz, istWP,
    lueftungssystem, lueftBasis, luftwechsel, luftvolumen, aussenluft,
    personen, we, trinkwasser, wwAnteil,
    elBasis, vaM2, kwJeWe, gzf, pvNutzen, dachflaeche, kwpJeM2, pvErtrag,
  ]);

  return (
    <div className="space-y-4">
      {/* Persistenter Haftungs-Disclaimer — NICHT konditional ausblenden. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Konzept-Richtwerte (TGA) — keine Anlagenplanung, kein GEG-/DIN-Nachweis.</strong>{" "}
          Heizlast, Energiebedarf, Volumenströme, Wasser- und Anschlusswerte sind Überschläge
          und ersetzen keine Berechnung nach GEG / DIN V 18599 / DIN EN 12831. Auslegung durch
          TGA-Fachplaner:in erforderlich.
        </span>
      </div>

      {pm.footArea > 0 && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
          Aus Gebäudemodell: {pm.storeys} Geschosse · BGF {de(pm.bgf)} m² · NGF {de(pm.ngf)} m² ≈ {Math.max(1, Math.round(pm.ngf / 75))} WE à 75 m²
        </div>
      )}

      <Tabs value={ansicht} onValueChange={setAnsicht}>
        <TabsList>
          <TabsTrigger value="konzept" data-testid="ht-tab-konzept">{t("Konzept")}</TabsTrigger>
          <TabsTrigger value="netz" data-testid="ht-tab-netz">{t("Netz")}</TabsTrigger>
          <TabsTrigger value="entwaesserung" data-testid="ht-tab-entwaesserung">{t("Entwässerung")}</TabsTrigger>
        </TabsList>
        <TabsContent value="netz">
          <TgaNetzEditor />
        </TabsContent>
        <TabsContent value="entwaesserung">
          <EntwaesserungPlanner complexData={complexData} />
        </TabsContent>
        <TabsContent value="konzept">
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eingabe-Cards: 4 Gewerke */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Thermometer className="w-4 h-4" /> Heizung / Wärme (Konzept-Überschlag)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Gebäudestandard</label>
                <Select value={standard} onValueChange={onStandard}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(GEBAEUDESTANDARDS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NumberField label="Spez. Heizlast" value={qHeizlast} step={1} suffix="W/m²" min={0} onChange={(v) => { setQHeizlast(v); setQHeizlastDirty(true); }} />
              <NumberField label="Beheizte Fläche" value={beheizteFlaeche} suffix="m²" min={0} onChange={(v) => { setBeheizteFlaeche(v); setAreaTouched(true); }} />
              <NumberField label="Spez. Heizwärmebedarf" value={qBedarf} step={1} suffix="kWh/(m²·a)" min={0} onChange={(v) => { setQBedarf(v); setQBedarfDirty(true); }} />
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Wärmeerzeuger</label>
                <Select value={erzeuger} onValueChange={onErzeuger}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(WAERMEERZEUGER).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {istWP && (
                <NumberField label="Jahresarbeitszahl (JAZ)" value={jaz} step={0.1} min={0} onChange={(v) => { setJaz(v); setJazDirty(true); }} />
              )}
              <div className="col-span-2 text-xs text-slate-500">
                GEG §71: 65 % erneuerbare Energien beim Heizungstausch — Hinweis, kein Nachweis.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Wind className="w-4 h-4" /> Lüftung (Konzept-Überschlag)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Lüftungssystem</label>
                <Select value={lueftungssystem} onValueChange={onLueftungssystem}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LUEFTUNGSSYSTEME).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Bemessungsbasis</label>
                <Select value={lueftBasis} onValueChange={setLueftBasis}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="luftwechsel">über Luftwechselrate</SelectItem>
                    <SelectItem value="personen">über Personen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {lueftBasis === "luftwechsel" && (
                <NumberField label="Luftwechselrate n" value={luftwechsel} step={0.1} suffix="1/h" min={0} onChange={setLuftwechsel} />
              )}
              <NumberField label="Luftvolumen netto" value={luftvolumen} suffix="m³" min={0} onChange={(v) => { setLuftvolumen(v); setVolDirty(true); }} />
              {lueftBasis === "personen" && (
                <NumberField label="Personenzahl" value={personen} suffix="P" min={0} onChange={(v) => { setPersonen(v); setPersonenDirty(true); }} />
              )}
              {lueftBasis === "personen" && (
                <NumberField label="Außenluft je Person" value={aussenluft} step={5} suffix="m³/(h·P)" min={0} onChange={setAussenluft} />
              )}
              {hatWrg && (
                <NumberField label="WRG-Wirkungsgrad" value={wrgEta} step={5} suffix="%" min={0} onChange={(v) => { setWrgEta(v); setWrgDirty(true); }} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Droplet className="w-4 h-4" /> Sanitär (Konzept-Überschlag)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField label="Wohneinheiten (WE)" value={we} suffix="WE" min={0} onChange={(v) => { setWe(v); setWeDirty(true); }} />
              <NumberField label="Personen je WE" value={personenJeWe} step={0.5} suffix="P/WE" min={0} onChange={setPersonenJeWe} />
              <NumberField label="Trinkwasserbedarf" value={trinkwasser} step={5} suffix="l/(P·d)" min={0} onChange={setTrinkwasser} />
              <NumberField label="Warmwasseranteil" value={wwAnteil} step={5} suffix="%" min={0} onChange={setWwAnteil} />
              <NumberField label="Sanitärobjekte je WE" value={sanitaerJeWe} suffix="Obj." min={0} onChange={setSanitaerJeWe} />
              <Stat label="Entwässerung" value="DN-Konzept — Fachplanung" accent="text-slate-700" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Zap className="w-4 h-4" /> Elektro / PV (Konzept-Überschlag)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">Bemessungsbasis</label>
                <Select value={elBasis} onValueChange={setElBasis}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="va-m2">je m² (VA/m²)</SelectItem>
                    <SelectItem value="we">je WE (kW/WE)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {elBasis === "va-m2" && (
                <NumberField label="Spez. Anschlusswert" value={vaM2} step={5} suffix="VA/m²" min={0} onChange={setVaM2} />
              )}
              {elBasis === "we" && (
                <NumberField label="Anschlusswert je WE" value={kwJeWe} step={0.5} suffix="kW/WE" min={0} onChange={setKwJeWe} />
              )}
              <NumberField label="Gleichzeitigkeitsfaktor" value={gzf} step={0.05} min={0} onChange={setGzf} />
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">PV-Dachpotenzial nutzen</label>
                <Select value={pvNutzen} onValueChange={setPvNutzen}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">ja</SelectItem>
                    <SelectItem value="nein">nein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {pvNutzen === "ja" && (
                <NumberField label="Dachfläche" value={dachflaeche} suffix="m²" min={0} onChange={(v) => { setDachflaeche(v); setDachDirty(true); }} />
              )}
              {pvNutzen === "ja" && (
                <NumberField label="PV-Leistungsdichte" value={kwpJeM2} step={0.01} suffix="kWp/m²" min={0} onChange={setKwpJeM2} />
              )}
              {pvNutzen === "ja" && (
                <NumberField label="Spez. PV-Ertrag" value={pvErtrag} step={25} suffix="kWh/(kWp·a)" min={0} onChange={setPvErtrag} />
              )}
              <NumberField label="Ladepunkte E-Mobilität" value={ladepunkte} suffix="Stk." min={0} onChange={setLadepunkte} />
              <Stat label="E-Mobilität" value="GEIG-Leitungsinfrastruktur prüfen" accent="text-slate-700" />
            </CardContent>
          </Card>
        </div>

        {/* Richtwert-KPIs + Zusammenfassung */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Heizlast (Richtwert)" value={`${de(kpi.heizlast)} kW`} accent="text-rose-600" />
            <Stat label="Heizwärmebedarf (Richtwert)" value={`${de(kpi.bedarf)} kWh/a`} accent="text-orange-600" />
            <Stat label="WP-Strombedarf (Richtwert)" value={istWP ? `${de(kpi.wpStrom)} kWh/a` : "—"} accent="text-violet-600" />
            <Stat label="Lüftungs-Volumenstrom (Richtwert)" value={`${de(kpi.volumenstrom)} m³/h`} accent="text-sky-600" />
            <Stat label="Trinkwasser (Richtwert)" value={`${de(kpi.tw)} l/d`} accent="text-cyan-600" />
            <Stat label="Trinkwasser p. a. (Richtwert)" value={`${de(kpi.twJahr)} m³/a`} accent="text-cyan-700" />
            <Stat label="Warmwasser (Richtwert)" value={`${de(kpi.ww)} l/d`} accent="text-blue-600" />
            <Stat label="Elektro-Anschlusswert (Richtwert)" value={`${de1(kpi.anschluss)} kW`} accent="text-amber-600" />
            {kpi.pv && (
              <Stat label="PV-Leistung (Richtwert)" value={`${de(kpi.pv.kwp)} kWp`} accent="text-emerald-600" />
            )}
            {kpi.pv && (
              <Stat label="PV-Ertrag (Richtwert)" value={`${de(kpi.pv.kwhA)} kWh/a`} accent="text-emerald-700" />
            )}
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
                Anlagenkonfiguration & Bedarfsdeckung im Reiter „Energie“ — der TGA-Reiter berechnet nur Konzept-Bedarfe.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
