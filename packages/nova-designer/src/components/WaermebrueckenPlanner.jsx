import React, { useEffect, useMemo } from "react";
import { usePanelState } from "@core/lib/usePanelState";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import {
  ThermometerSnowflake, Ruler, TrendingUp, Gauge, AlertTriangle, Sigma,
} from "lucide-react";
import { NumberField, Stat } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { GEBAEUDESTANDARDS } from "@designer/lib/hvac";
import {
  VERFAHREN, AUSFUEHRUNG, PSI_KATALOG,
  DEFAULT_GT_KKH, DEFAULT_DELTA_T, DEFAULT_HT_MAX,
  DEFAULT_FENSTER_ANTEIL_PCT, DEFAULT_FENSTER_B, DEFAULT_FENSTER_H, DEFAULT_BALKON_BREITE,
  pauschalWert, umfangM, eckenAnzahl, huellflaeche, fensterAnzahl,
  laengenAusGeometrie, psiDefault, psiL, summePsiL, deltaUwbDetailliert,
  wirkung, verfahrensvergleich, wbChecks,
} from "@designer/lib/thermalBridges";
import { useBuildingProgram, programMetrics, footprintWD } from "@core/lib/useBuildingProgram";

// de-DE-Formatter: de ganzzahlig (kWh/a, m², W/K) · de1 (m, kW, %) · de2 (ψ) · de3 (ΔU_WB).
// Ohne de3 würde ein ΔU_WB von 0,046 als „0“ erscheinen.
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const de3 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// STATUS_STYLE kennt nur pass/warn/fail — der Status „offen“ würde beim Rendern
// crashen (weißer Tab). Lokale Erweiterung statt Eingriff in compliance.js
// (die Datei wird in alle Modul-Spiegel gespiegelt).
// Der Status „nicht erfüllt“ wird in diesem Panel bewusst NIE gerendert (Haftung).
const WB_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

const HERKUNFT_LABEL = { modell: "aus Modell", anteil: "aus Anteil", eingabe: "Eingabe" };

const JA_NEIN = [
  { v: "ja", label: "ja" },
  { v: "nein", label: "nein" },
];

export default function WaermebrueckenPlanner() {
  // --- Panel-State (alle Keys mit "waermebruecken:"-Präfix — modulweiter panelCache) ----
  const [verfahren, setVerfahren] = usePanelState("waermebruecken:verfahren", "pauschal");
  const [bauzustand, setBauzustand] = usePanelState("waermebruecken:bauzustand", "neubau");
  const [innendaemmung, setInnendaemmung] = usePanelState("waermebruecken:innendaemmung", "nein");
  const [deltaU, setDeltaU] = usePanelState("waermebruecken:deltaU", 0.10);
  const [deltaUDirty, setDeltaUDirty] = usePanelState("waermebruecken:deltaUDirty", false);
  const [aHuell, setAHuell] = usePanelState("waermebruecken:aHuell", 0);
  const [aHuellDirty, setAHuellDirty] = usePanelState("waermebruecken:aHuellDirty", false);
  const [dachImBezug, setDachImBezug] = usePanelState("waermebruecken:dachImBezug", "ja");
  const [bodenImBezug, setBodenImBezug] = usePanelState("waermebruecken:bodenImBezug", "ja");
  const [detailsById, setDetailsById] = usePanelState("waermebruecken:details", {});
  const [fensterAnteilPct, setFensterAnteilPct] = usePanelState("waermebruecken:fensterAnteilPct", DEFAULT_FENSTER_ANTEIL_PCT);
  const [fensterB, setFensterB] = usePanelState("waermebruecken:fensterB", DEFAULT_FENSTER_B);
  const [fensterH, setFensterH] = usePanelState("waermebruecken:fensterH", DEFAULT_FENSTER_H);
  const [balkonAnzahl, setBalkonAnzahl] = usePanelState("waermebruecken:balkonAnzahl", 0);
  const [balkonBreite, setBalkonBreite] = usePanelState("waermebruecken:balkonBreite", DEFAULT_BALKON_BREITE);
  const [stuetzenAnzahl, setStuetzenAnzahl] = usePanelState("waermebruecken:stuetzenAnzahl", 0);
  const [innenwandLaenge, setInnenwandLaenge] = usePanelState("waermebruecken:innenwandLaenge", 0);
  const [keller, setKeller] = usePanelState("waermebruecken:keller", "nein");
  const [dachform, setDachform] = usePanelState("waermebruecken:dachform", "flach");
  const [standard, setStandard] = usePanelState("waermebruecken:standard", "geg-neubau");
  const [qBedarfRef, setQBedarfRef] = usePanelState("waermebruecken:qBedarfRef", 55);
  const [qBedarfDirty, setQBedarfDirty] = usePanelState("waermebruecken:qBedarfDirty", false);
  const [bezugsflaeche, setBezugsflaeche] = usePanelState("waermebruecken:bezugsflaeche", 0);
  const [bezugsflaecheDirty, setBezugsflaecheDirty] = usePanelState("waermebruecken:bezugsflaecheDirty", false);
  const [gT, setGT] = usePanelState("waermebruecken:gT", DEFAULT_GT_KKH);
  const [deltaT, setDeltaT] = usePanelState("waermebruecken:deltaT", DEFAULT_DELTA_T);
  const [htMax, setHtMax] = usePanelState("waermebruecken:htMax", DEFAULT_HT_MAX);

  // --- Geometrie READ-ONLY aus dem Gebäudemodell (nie zurückschreiben) -------------------
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const P = useMemo(() => umfangM(store.footprintM), [store.footprintM]);
  const ecken = eckenAnzahl(store.footprintM);
  const wd = footprintWD(store.footprintM);

  const aHuellVorschlag = huellflaeche({
    umfang: P,
    hoehe: pm.height,
    grundflaeche: pm.footArea,
    dach: dachImBezug === "ja",
    boden: bodenImBezug === "ja",
  });

  useEffect(() => {
    if (!aHuellDirty && aHuellVorschlag > 0) setAHuell(Math.round(aHuellVorschlag));
  }, [aHuellVorschlag, aHuellDirty, setAHuell]);

  useEffect(() => {
    if (!bezugsflaecheDirty && pm.bgf > 0) setBezugsflaeche(Math.round(pm.bgf));
  }, [pm.bgf, bezugsflaecheDirty, setBezugsflaeche]);

  // --- Verfahren treibt ΔU_WB (Dirty-Schutz) ---------------------------------------------
  const onVerfahren = (k) => {
    setVerfahren(k);
    if (!deltaUDirty) {
      const p = pauschalWert(k, innendaemmung);
      if (p !== null) setDeltaU(p);
    }
  };
  const onInnendaemmung = (v) => {
    setInnendaemmung(v);
    if (!deltaUDirty) {
      const p = pauschalWert(verfahren, v);
      if (p !== null) setDeltaU(p);
    }
  };
  const onStandard = (k) => {
    setStandard(k);
    if (!qBedarfDirty) setQBedarfRef(GEBAEUDESTANDARDS[k]?.bedarf ?? 55);
  };

  // --- Abgeleitete Längen ------------------------------------------------------------------
  const laengen = useMemo(
    () =>
      laengenAusGeometrie(
        { umfang: P, hoehe: pm.height, storeys: pm.storeys, storeyHeight: pm.storeyHeight, ecken },
        {
          fensterAnteilPct, fensterB, fensterH, balkonAnzahl, balkonBreite,
          stuetzenAnzahl, innenwandLaenge, keller, dachform, bauzustand, innendaemmung,
        },
      ),
    [P, pm.height, pm.storeys, pm.storeyHeight, ecken, fensterAnteilPct, fensterB, fensterH,
      balkonAnzahl, balkonBreite, stuetzenAnzahl, innenwandLaenge, keller, dachform, bauzustand, innendaemmung],
  );

  const nF = useMemo(
    () => fensterAnzahl({ umfang: P, hoehe: pm.height }, { fensterAnteilPct, fensterB, fensterH }),
    [P, pm.height, fensterAnteilPct, fensterB, fensterH],
  );

  // Längen-Vorbelegung je Zeile, sofern nicht manuell überschrieben.
  useEffect(() => {
    setDetailsById((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(laengen).forEach(([k, l]) => {
        if (next[k]?.laengeDirty) return;
        const gerundet = Math.round(l);
        if ((next[k]?.laenge ?? null) !== gerundet) {
          next[k] = { ...(next[k] || {}), laenge: gerundet };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [laengen, setDetailsById]);

  const setDetail = (key, fn) => setDetailsById((mp) => ({ ...mp, [key]: fn(mp[key] || {}) }));

  const onQualitaet = (key, q) =>
    setDetail(key, (r) => ({ ...r, qualitaet: q, psi: r.psiDirty ? r.psi : psiDefault(key, q) }));

  // Systemgrenze: bei vorhandenem Keller ist die Kelleraußenwand die Grenze,
  // der Sockel wird dann standardmäßig NICHT zusätzlich angesetzt (Doppelzählung).
  const defaultAktiv = (key) => {
    const d = PSI_KATALOG[key];
    if (key === "sockel" && keller === "ja") return false;
    switch (d.bedingung) {
      case "keller": return keller === "ja";
      case "flachdach": return dachform === "flach";
      case "steildach": return dachform === "steil";
      case "bestand_innendaemmung": return bauzustand === "bestand" && innendaemmung === "ja";
      case "eingabe": return (laengen[key] || 0) > 0;
      default: return d.aktivDefault;
    }
  };

  const katalog = Object.keys(PSI_KATALOG).map((key) => {
    const row = detailsById[key] || {};
    const qualitaet = row.qualitaet || "standard";
    return {
      key,
      def: PSI_KATALOG[key],
      aktiv: row.aktivDirty ? !!row.aktiv : defaultAktiv(key),
      laenge: row.laengeDirty ? Number(row.laenge) || 0 : Math.round(laengen[key] || 0),
      qualitaet,
      psi: row.psiDirty ? Number(row.psi) || 0 : psiDefault(key, qualitaet),
    };
  });

  // --- Berechnung ---------------------------------------------------------------------------
  const kpi = useMemo(() => {
    const rows = katalog
      .filter((r) => r.aktiv)
      .map((r) => ({ key: r.key, aktiv: true, laenge: r.laenge, psi: r.psi, qualitaet: r.qualitaet }));
    const sumPsiL = summePsiL(rows);
    const dUdet = deltaUwbDetailliert(rows, aHuell);
    const dUeff = verfahren === "detailliert" ? dUdet : deltaU;
    const qRef = (Number(qBedarfRef) || 0) * (Number(bezugsflaeche) || 0);
    const w = wirkung({ deltaUwb: dUeff, aHuell, gT, qRef, dT: deltaT, bgf: bezugsflaeche, htMax });
    const vgl = verfahrensvergleich({ aHuell, gT, qRef, dT: deltaT, bgf: bezugsflaeche, deltaUwbDet: dUdet });
    const checks = wbChecks({
      verfahren, innendaemmung, aHuell, deltaUwb: dUeff, deltaUwbDet: dUdet,
      htMax, gT, rows, balkonAnzahl, einsparPotenzialKwh: vgl.einsparPotenzialKwh,
    });
    return { rows, sumPsiL, dUdet, dUeff, qRef, w, vgl, checks };
  }, [katalog, aHuell, verfahren, deltaU, qBedarfRef, bezugsflaeche, gT, deltaT, htMax, innendaemmung, balkonAnzahl]);

  const aktivAnzahl = kpi.rows.length;
  const ohneLaenge = kpi.rows.filter((r) => (Number(r.laenge) || 0) <= 0).length;
  const verdictStyle = WB_STATUS[kpi.checks.ampel === "neutral" ? "offen" : kpi.checks.ampel] || WB_STATUS.warn;

  return (
    <div className="space-y-4">
      {/* Persistenter Disclaimer — Pflicht, nicht konditional */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>Wärmebrücken — Konzept-Richtwerte, kein Wärmebrückennachweis und kein GEG-Nachweis.</strong>{" "}
          Zuschlagsverfahren (ΔU_WB), ψ-Werte, Längen und die Wirkung auf Heizwärmebedarf und Heizlast
          sind Überschläge und ersetzen keine Gleichwertigkeitsprüfung nach DIN 4108 Beiblatt 2, keine
          Wärmebrückenberechnung nach DIN EN ISO 10211 und keinen Nachweis nach GEG § 24. ψ-Werte sind
          projektspezifisch durch Fachplanung / Wärmebrückenberechnung zu bestimmen; Mindestwärmeschutz
          und Feuchteschutz (DIN 4108-2/-3) werden hier nicht geprüft. Alle Werte überschreibbar.
        </span>
      </div>

      <div className="text-xs text-slate-500">
        Heizlast/Heizwärmebedarf → Reiter „Haustechnik (TGA)“; Anlagen &amp; Bedarfsdeckung → Reiter
        „Energie“; Effizienzhaus-Stufen → Reiter „Förderungen“. Hier nur der Wärmebrücken-Anteil.
      </div>

      <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex">
        Aus Gebäudemodell: {pm.storeys} Geschosse · Grundfläche {de(pm.footArea)} m² · Umfang ≈ {de1(P)} m
        · Höhe {de1(pm.height)} m · Hüllfläche ≈ {de(aHuell)} m²
      </div>

      {P === 0 && (
        <div className="text-xs text-slate-500">
          Kein Footprint gezeichnet — Bounding-Box-Näherung {de1(wd?.w || 0)} × {de1(wd?.d || 0)} m;
          Umfang/Hüllfläche bitte eingeben.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* --- Card 1: Verfahren & Zuschlag -------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ThermometerSnowflake className="w-4 h-4" /> Verfahren &amp; Zuschlag
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 mb-1">Verfahren</div>
              <Select value={verfahren} onValueChange={onVerfahren}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(VERFAHREN).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-slate-500 mt-1">{VERFAHREN[verfahren]?.hinweis}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Bauzustand</div>
                <Select value={bauzustand} onValueChange={setBauzustand}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="neubau">Neubau</SelectItem>
                    <SelectItem value="bestand">Bestand (Sanierung)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Innendämmung &gt; 50 % Außenwandfläche mit einbindenden Massivdecken</div>
                <Select value={innendaemmung} onValueChange={onInnendaemmung}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JA_NEIN.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {verfahren === "detailliert" ? (
                <Stat label="ΔU_WB detailliert berechnet (Richtwert)" value={`${de3(kpi.dUdet)} W/(m²K)`} />
              ) : (
                <NumberField
                  label="Wärmebrückenzuschlag ΔU_WB"
                  value={deltaU}
                  step="0.01"
                  suffix="W/(m²K)"
                  onChange={(v) => { setDeltaU(v); setDeltaUDirty(true); }}
                />
              )}
              <NumberField
                label="Hüllfläche A (wärmeübertragend)"
                value={aHuell}
                suffix="m²"
                onChange={(v) => { setAHuell(v); setAHuellDirty(true); }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Dachfläche im Bezug</div>
                <Select value={dachImBezug} onValueChange={(v) => { setDachImBezug(v); setAHuellDirty(false); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JA_NEIN.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Bodenplatte bzw. Kellerdecke im Bezug</div>
                <Select value={bodenImBezug} onValueChange={(v) => { setBodenImBezug(v); setAHuellDirty(false); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JA_NEIN.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat label="ΔH'_T-Zuschlag (Richtwert)" value={`${de3(kpi.w.htZuschlag)} W/(m²K)`} />
              <Stat label="Wärmebrücken-Verlustkoeffizient H_WB (Richtwert)" value={`${de(kpi.w.hWb)} W/K`} />
            </div>
            <div className="text-[11px] text-slate-500">
              ΔH'_T = ΔU_WB, exakt 1:1 — der Zuschlag wirkt vollflächig auf die Hüllfläche.
            </div>
            <div className="text-[11px] text-slate-500">
              GEG § 24 i. V. m. DIN 4108 Beiblatt 2:2019-06 — Gleichwertigkeit (Kategorie A/B) ist je
              Detail nachzuweisen; dieses Panel führt den Nachweis nicht.
            </div>
          </CardContent>
        </Card>

        {/* --- Card 3: Wirkung auf Energie --------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4" /> Wirkung auf Energie
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 mb-1">Gebäudestandard (Referenzbasis)</div>
              <Select value={standard} onValueChange={onStandard}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(GEBAEUDESTANDARDS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Spez. Heizwärmebedarf (Referenz)"
                value={qBedarfRef}
                suffix="kWh/(m²·a)"
                onChange={(v) => { setQBedarfRef(v); setQBedarfDirty(true); }}
              />
              <NumberField
                label="Bezugsfläche (BGF)"
                value={bezugsflaeche}
                suffix="m²"
                onChange={(v) => { setBezugsflaeche(v); setBezugsflaecheDirty(true); }}
              />
              <NumberField label="Heizgradstunden G_t" value={gT} suffix="kKh/a" onChange={setGT} />
              <NumberField label="Temperaturdifferenz Heizlast ΔT" value={deltaT} suffix="K" onChange={setDeltaT} />
              <NumberField label="Höchstwert H'_T (Vergleich)" value={htMax} step="0.01" suffix="W/(m²K)" onChange={setHtMax} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat label="Referenz-Heizwärmebedarf (Richtwert)" value={`${de(kpi.qRef)} kWh/a`} />
              <Stat label="Wärmebrücken-Wärmeverlust Q_WB (Richtwert)" value={`${de(kpi.w.qWb)} kWh/a`} />
              <Stat label="spez. Q_WB (Richtwert)" value={`${de1(kpi.w.spezQwb)} kWh/(m²·a)`} />
              <Stat label="Anteil am Heizwärmebedarf (Richtwert)" value={`${de1(kpi.w.anteilPct)} %`} />
              <Stat label="Heizlast-Anteil (Richtwert)" value={`${de1(kpi.w.heizlastKw)} kW`} />
              <Stat label="H'_T-Anteil am Höchstwert (Richtwert)" value={`${de1(kpi.w.htAnteilPct)} %`} />
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
              Einsparpotenzial durch Gleichwertigkeitsnachweis (0,10 → 0,05): ≈{" "}
              <strong>{de(kpi.vgl.einsparPotenzialKwh)} kWh/a</strong> bzw.{" "}
              {de1(kpi.vgl.einsparPotenzialPct)} % des Heizwärmebedarfs.
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th className="py-1 pr-2 font-medium">Verfahren</th>
                    <th className="py-1 pr-2 font-medium text-right">ΔU_WB</th>
                    <th className="py-1 pr-2 font-medium text-right">Q_WB kWh/a</th>
                    <th className="py-1 pr-2 font-medium text-right">Anteil %</th>
                    <th className="py-1 pr-2 font-medium text-right">Heizlast kW</th>
                    <th className="py-1 font-medium text-right">Differenz ggü. pauschal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {kpi.vgl.zeilen.map((z) => (
                    <tr key={z.key}>
                      <td className="py-1 pr-2 text-slate-700">{z.label}</td>
                      <td className="py-1 pr-2 text-right">{de3(z.deltaUwb)}</td>
                      <td className="py-1 pr-2 text-right">{de(z.qWb)}</td>
                      <td className="py-1 pr-2 text-right">{de1(z.anteilPct)}</td>
                      <td className="py-1 pr-2 text-right">{de1(z.heizlastKw)}</td>
                      <td className={`py-1 text-right ${z.einsparungKwh < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        {de(z.einsparungKwh)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-[11px] text-slate-500">
              Der Anteil ist eine <strong>Zuordnung</strong>, kein Aufschlag — die Kennwerte je
              Gebäudestandard enthalten typische Wärmebrücken bereits implizit.
            </div>
            <div className="text-[11px] text-slate-500">
              Heizlast und Heizwärmebedarf werden im Reiter „Haustechnik (TGA)“ gerechnet; dort gibt es
              keinen separaten Wärmebrückenzuschlag. Für eine Sensitivitätsbetrachtung den spez.
              Heizwärmebedarf dort manuell um Δq erhöhen — hier wird nichts automatisch übernommen.
            </div>
          </CardContent>
        </Card>

        {/* --- Card 2: Detailkatalog (volle Breite) ------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="w-4 h-4" /> Detailkatalog (ψ · l)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid md:grid-cols-4 gap-3">
              <NumberField label="Fensterflächenanteil der Fassade" value={fensterAnteilPct} suffix="%" onChange={setFensterAnteilPct} />
              <NumberField label="Standard-Fensterbreite" value={fensterB} step="0.01" suffix="m" onChange={setFensterB} />
              <NumberField label="Standard-Fensterhöhe" value={fensterH} step="0.01" suffix="m" onChange={setFensterH} />
              <NumberField label="Anzahl auskragender Balkone" value={balkonAnzahl} suffix="Stk." onChange={setBalkonAnzahl} />
              <NumberField label="Balkonbreite" value={balkonBreite} step="0.01" suffix="m" onChange={setBalkonBreite} />
              <NumberField label="Anzahl Fassadenstützen (je Geschoss)" value={stuetzenAnzahl} suffix="Stk." onChange={setStuetzenAnzahl} />
              <NumberField label="Länge Innenwand-Einbindungen (gesamt)" value={innenwandLaenge} suffix="m" onChange={setInnenwandLaenge} />
              <div>
                <div className="text-xs text-slate-500 mb-1">Keller vorhanden</div>
                <Select value={keller} onValueChange={setKeller}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JA_NEIN.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Dachform</div>
                <Select value={dachform} onValueChange={setDachform}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flach">Flachdach (Attika)</SelectItem>
                    <SelectItem value="steil">Steildach (Traufe/Ortgang)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="divide-y border rounded-lg">
              {katalog.map((r) => (
                <div key={r.key} className={`grid md:grid-cols-12 gap-2 items-end p-2 ${r.aktiv ? "" : "opacity-50"}`}>
                  <div className="md:col-span-4 flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setDetail(r.key, (d) => ({ ...d, aktiv: !r.aktiv, aktivDirty: true }))}
                      className={`mt-1 shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors ${
                        r.aktiv ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {r.aktiv ? "aktiv" : "inaktiv"}
                    </button>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{r.def.label}</div>
                      <Badge className="bg-slate-100 text-slate-600 mt-0.5" title={r.def.regel}>
                        {HERKUNFT_LABEL[r.def.herkunft]}
                      </Badge>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <NumberField
                      label="Länge"
                      value={r.laenge}
                      suffix="m"
                      onChange={(v) => setDetail(r.key, (d) => ({ ...d, laenge: v, laengeDirty: true }))}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <div className="text-xs text-slate-500 mb-1">Ausführungsqualität</div>
                    <Select value={r.qualitaet} onValueChange={(q) => onQualitaet(r.key, q)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(AUSFUEHRUNG).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    {/* ψ ohne min — negative Werte bei Außenmaßbezug (Gebäudekante) sind physikalisch korrekt und müssen eingebbar bleiben */}
                    <NumberField
                      label="ψ"
                      value={r.psi}
                      step="0.01"
                      suffix="W/(mK)"
                      onChange={(v) => setDetail(r.key, (d) => ({ ...d, psi: v, psiDirty: true }))}
                    />
                    <div className="text-[10px] text-slate-400 mt-0.5">Richtwert {de2(psiDefault(r.key, r.qualitaet))}</div>
                  </div>
                  <div className="md:col-span-1 text-right text-xs text-slate-700 pb-2">
                    <div className="text-[10px] text-slate-400">ψ·l</div>
                    {de1(psiL(r))} W/K
                  </div>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <Stat label="Σ ψ·l (Richtwert)" value={`${de1(kpi.sumPsiL)} W/K`} />
              <Stat label="ΔU_WB detailliert (Richtwert)" value={`${de3(kpi.dUdet)} W/(m²K)`} />
              <Stat label="Aktive Details / Längen offen" value={`${aktivAnzahl} / ${ohneLaenge}`} />
              <Stat label="Fensteranzahl (aus Anteil)" value={`${de(Math.round(nF))} Stk.`} />
            </div>
            <div className="text-[11px] text-slate-500 flex items-start gap-1">
              <Sigma className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                ψ-Werte sind Konzept-Richtwerte — verbindliche Werte aus DIN 4108 Beiblatt 2,
                Herstellerkatalog (Planungsatlas Hochbau, KS-/Ziegel-Katalog) oder Berechnung nach
                DIN EN ISO 10211. Bei Außenmaßbezug sind negative ψ möglich (Gebäudekante); negative Werte
                sind im ψ-Feld ausdrücklich zulässig.
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Fensteranschlüsse sind nicht aus dem Gebäudemodell ableitbar (keine Öffnungen im
              gemeinsamen Modell-Datensatz) — Längen werden über den Fensterflächenanteil und ein
              Standard-Fenstermaß genähert.
            </div>
            <div className="text-[11px] text-slate-500">
              Systemgrenze: beheizter Bereich — bei unbeheiztem Keller ist die Kellerdecke die Grenze;
              Sockel/Bodenplatte NICHT zusätzlich ansetzen.
            </div>
          </CardContent>
        </Card>

        {/* --- Card 4: Zusammenfassung & Ampel ------------------------------------------ */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><Gauge className="w-4 h-4" /> Zusammenfassung &amp; Ampel</span>
              <Badge className={verdictStyle.color}>{kpi.checks.verdict}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid md:grid-cols-5 gap-2">
              <Stat label="Verfahren (Richtwert)" value={VERFAHREN[verfahren]?.label || verfahren} />
              <Stat label="ΔU_WB (Richtwert)" value={`${de3(kpi.dUeff)} W/(m²K)`} />
              <Stat label="Q_WB (Richtwert)" value={`${de(kpi.w.qWb)} kWh/a`} />
              <Stat label="Anteil (Richtwert)" value={`${de1(kpi.w.anteilPct)} %`} />
              <Stat label="Einsparpotenzial (Richtwert)" value={`${de(kpi.vgl.einsparPotenzialKwh)} kWh/a`} />
            </div>
            {kpi.checks.items.map((it) => {
              const s = WB_STATUS[it.status] || WB_STATUS.warn;
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
              Bewertung nur OK / Hinweis / offen — keine automatische ‚nicht erfüllt‘-Aussage.
              Gleichwertigkeitsnachweis und Mindestwärmeschutz bleiben bewusst offen: diese Leistungen
              erbringt das Panel nicht.
            </div>
            <div className="text-xs text-slate-500">
              Heizlast/Heizwärmebedarf → Reiter „Haustechnik (TGA)“; Anlagen → Reiter „Energie“;
              Effizienzhaus-Stufen → Reiter „Förderungen“.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
