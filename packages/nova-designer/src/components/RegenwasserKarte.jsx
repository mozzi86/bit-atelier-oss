// 91-02: card "Regenwassernutzung" in the drainage planner (EntwaesserungPlanner). Shows the
// DIN 1989-1 concept figures of useRegenwasser — yield vs demand (with the coverage bar that makes
// the conflict visible: a multi-storey roof covers only part of the toilet demand), storage, the
// cistern under the garage slab and the dedicated services room — and edits the stored settings
// (entwaesserung_layer.nutzung) through ONE callback; the planner owns the layer.
//
// In:  rw (useRegenwasser result), onNutzung(patch) → planner merges into entwaesserung_layer.nutzung.
// Out: rendered card; data-testids rw-karte (data-aktiv, data-speicher, data-deckung), rw-aktiv,
//      rw-wc, rw-garten, rw-garten-flaeche, rw-retention, rw-ueberlauf, rw-kpi-* (data-wert = raw number), rw-zisterne, rw-technikraum.
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { CloudRain } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { UEBERLAUF_MASSNAHMEN, WC_L_JE_PERSON_TAG, GARTEN_L_JE_M2_JAHR, TROCKENTAGE } from "@designer/lib/regenwassernutzung";

const de = (n, d = 0) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });

/**
 * @param {{rw: ReturnType<typeof import("@designer/lib/useRegenwasser").useRegenwasser>, onNutzung: (patch: object) => void}} props
 */
export default function RegenwasserKarte({ rw, onNutzung }) {
  const { t } = useI18n();
  const n = rw.nutzung, er = rw.ertrag, be = rw.bedarf, sp = rw.speicher, zi = rw.zisterne, raum = rw.technikraum;
  const deckungPct = sp.deckung === null ? null : Math.round(sp.deckung * 100);
  const balken = be.gesamt_m3a > 0 ? Math.min(100, (er.m3a / be.gesamt_m3a) * 100) : 0;
  const kpi = (id, label, wert, einheit, hinweis, roh) => (
    <div className="rounded-lg border bg-slate-50 p-2" data-testid={`rw-kpi-${id}`} data-wert={roh ?? ""}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-base font-semibold tabular-nums text-slate-800">{wert} <span className="text-xs font-normal text-slate-500">{einheit}</span></div>
      {hinweis && <div className="text-[10px] text-slate-400">{hinweis}</div>}
    </div>
  );
  return (
    <Card data-testid="rw-karte" data-aktiv={n.aktiv ? "1" : "0"} data-speicher={sp.gesamt_m3} data-deckung={deckungPct ?? ""}
      data-klima={rw.klimaStatus} data-we={rw.eingaben.we} data-we-quelle={rw.eingaben.weQuelle} data-niederschlag={er.niederschlag_mm} data-dach={rw.eingaben.footArea_m2}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <CloudRain className="w-4 h-4" /> {t("Regenwassernutzung")}
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">{t("Projektvorgabe · Nachhaltigkeitskonzept")}</span>
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs font-normal text-slate-600">
            <input type="checkbox" checked={n.aktiv} onChange={(e) => onNutzung({ aktiv: e.target.checked })} data-testid="rw-aktiv" />
            {t("Regenwasser für WC und Garten nutzen")}
          </label>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {!n.aktiv && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">{t("Abgeschaltet — die Projektvorgabe verlangt die Nutzung des Regenwassers für WC-Spülung und Gartenbewässerung.")}</div>
        )}
        {n.aktiv && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {kpi("ertrag", t("Ertrag"), de(er.m3a), "m³/a", `${de(er.niederschlag_mm)} mm/a${rw.klimaStatus === "laedt" ? ` · ${t("Klima wird geladen …")}` : er.niederschlagGeschaetzt ? ` · ${t("geschätzt")}` : ""}`, er.m3a)}
              {kpi("bedarf", t("Bedarf"), de(be.gesamt_m3a), "m³/a", `${t("WC")} ${de(be.wc_m3a)} · ${t("Garten")} ${de(be.garten_m3a)}`, be.gesamt_m3a)}
              {kpi("speicher", t("Speicher"), de(sp.gesamt_m3), "m³", sp.rueckhalt_m3 > 0 ? `${de(sp.nutz_m3)} ${t("Nutzung")} + ${de(sp.rueckhalt_m3)} ${t("Rückhalt")}` : `${TROCKENTAGE} ${t("Trockentage")}`)}
              {kpi("deckung", t("Deckungsgrad"), deckungPct === null ? "—" : de(deckungPct), "%", sp.begrenzt === "ertrag" ? t("durch die Dachfläche begrenzt") : sp.begrenzt === "bedarf" ? t("durch den Bedarf begrenzt") : "")}
              {kpi("einsparung", t("Trinkwasser gespart"), de(sp.einsparung_m3a), "m³/a", undefined, sp.einsparung_m3a)}
            </div>
            {/* Yield vs demand: the bar makes the conflict visible instead of promising "100 % rainwater". */}
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                <span>{t("Ertrag im Verhältnis zum Bedarf")}</span><span className="tabular-nums">{de(er.m3a)} / {de(be.gesamt_m3a)} m³/a</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`${t("Deckungsgrad")} ${deckungPct ?? 0} %`}>
                <div className={`h-full ${deckungPct !== null && deckungPct < 50 ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${balken}%` }} />
              </div>
              {deckungPct !== null && deckungPct < 50 && (
                <div className="mt-1 text-[11px] text-amber-800" data-testid="rw-zielkonflikt">
                  {t("Die Auffangfläche deckt nur einen Teil des Betriebswassers — den Rest liefert die Trinkwasser-Nachspeisung. Ein Gründach senkt den Ertrag weiter.")}
                </div>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border p-2" data-testid="rw-zisterne" data-lage={zi.lage} data-passt={zi.passt === null ? "" : zi.passt ? "1" : "0"}>
                <div className="font-medium text-slate-700">{zi.lage === "unter_tg" ? t("Zisterne unter der Tiefgarage") : t("Zisterne im Erdreich")}</div>
                <div className="text-slate-600">{de(zi.volumen_m3)} m³ · {de(zi.grundflaeche_m2, 1)} m² × {de(zi.nutzhoehe_m, 1)} m {t("Nutzhöhe")}</div>
                {zi.lage === "unter_tg" && zi.passt === false && <div className="text-amber-800">{t("Passt nicht unter die TG — nötige Nutzhöhe")} {de(zi.hoeheNoetig_m, 2)} m</div>}
                {zi.lage === "unter_tg" && zi.passt === null && <div className="text-slate-500">{t("TG-Fläche noch unbekannt — Tiefgarage in der Werkstatt anwenden.")}</div>}
                {zi.lage !== "unter_tg" && <div className="text-slate-500">{t("Ohne Tiefgarage liegt die Zisterne im Erdreich (Lageplan).")}</div>}
              </div>
              <div className="rounded-lg border p-2" data-testid="rw-technikraum" data-m2={raum.m2}>
                <div className="font-medium text-slate-700">{t(raum.name)} · {de(raum.m2)} m²</div>
                <div className="text-slate-600">{rw.eingaben.kellerAktiv ? t("Im Keller als Pflichtraum vorgesehen.") : t("Kein Keller angewendet — Raum im Untergeschoss neben der Zisterne vorsehen.")}</div>
                <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-500">{raum.inhalt.map((x) => <li key={x}>{t(x)}</li>)}</ul>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={n.wc} onChange={(e) => onNutzung({ wc: e.target.checked })} data-testid="rw-wc" />{t("WC-Spülung")} ({WC_L_JE_PERSON_TAG} l/{t("Person und Tag")}, {de(be.personen, 1)} {t("Personen")})</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={n.garten} onChange={(e) => onNutzung({ garten: e.target.checked })} data-testid="rw-garten" />{t("Gartenbewässerung")} ({GARTEN_L_JE_M2_JAHR} l/m² {t("und Jahr")})</label>
                <label className="flex items-center gap-1.5">
                  {t("Bewässerte Fläche")}
                  <input type="number" min="0" className="h-7 w-24 rounded border border-slate-300 bg-white px-1.5 text-xs" value={n.gartenFlaeche_m2 ?? ""}
                    placeholder={de(rw.eingaben.gruenflaeche_m2)} onChange={(e) => onNutzung({ gartenFlaeche_m2: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })} data-testid="rw-garten-flaeche" />
                  m² <span className="text-slate-400">{n.gartenFlaeche_m2 === null ? t("(aus dem Lageplan)") : ""}</span>
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={n.retentionInZisterne} onChange={(e) => onNutzung({ retentionInZisterne: e.target.checked })} data-testid="rw-retention" />{t("Rückhaltevolumen zusätzlich in der Zisterne")} ({de(rw.eingaben.rueckhalt_m3, 1)} m³)</label>
                <label className="block">
                  <span className="text-slate-500">{t("Überlauf der Zisterne")}</span>
                  <select className="mt-0.5 h-7 w-full rounded-md border border-slate-300 bg-white px-1.5 text-xs" value={n.ueberlaufMassnahme} onChange={(e) => onNutzung({ ueberlaufMassnahme: e.target.value })} data-testid="rw-ueberlauf">
                    {Object.entries(UEBERLAUF_MASSNAHMEN).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </>
        )}
        <div className="text-[10px] text-slate-400">{t("Konzeptwerte nach DIN 1989-1 (vereinfachtes Verfahren, Richtwerte [ASSUMED]) — ersetzt keine Fachplanung der Regenwassernutzungsanlage.")}</div>
      </CardContent>
    </Card>
  );
}
