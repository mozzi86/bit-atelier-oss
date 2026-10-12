// ProjektKennzahlen — project-bound feasibility figures at the top of the page
// "Machbarkeit" (88-09, RE-23…25): GRZ/GFZ/BMZ target vs. actual (BauNVO §§ 19–21),
// full-storey check per storey, residual land value. Unlike the sample tabs below
// (72-16), these inputs belong to the active project and are saved (entity Machbarkeit).
//
// In:  the active project (useProject), building model figures (useBuildingProgram →
//      programMetrics; taken over only on click). Rules: src/lib/machbarkeit/kennzahlen.js.
// Out: UI; data-testids mk-karte, mk-<field>, mk-geschoss-neu, mk-g-<i>-<field>, mk-g-voll-<i>,
//      mk-modell, mk-speichern, mk-ist (data-grz, data-grz2, data-gfz, data-bmz, data-voll),
//      mk-hinweis (data-code), mk-bodenwert (data-wert), mk-fehler, mk-gespeichert.
import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { massDerNutzung, residualwert, RESIDUAL_STANDARD } from "@/lib/machbarkeit/kennzahlen";

const LEER = { grundstueck_m2: "", grz_max: "", gfz_max: "", bmz_max: "", grundflaeche_m2: "", nebenanlagen_m2: "", baumasse_m3: "", geschosse: [], residual: { modus: "verkauf" } };
const fmt = (v, s = 2) => (v == null ? "—" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: s }));
const eur = (v) => (v == null ? "—" : Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));

export default function ProjektKennzahlen() {
  const { t } = useI18n();
  const { project } = useProject();
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const [recId, setRecId] = useState(/** @type {string|null} */ (null));
  const [m, setM] = useState(/** @type {Record<string, any>} */ (LEER));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [gespeichert, setGespeichert] = useState(false);

  useEffect(() => {
    if (!project?.id) return;
    let weg = false;
    bitApi.entities.Machbarkeit.filter({ project_id: project.id }).then((rows) => {
      if (weg) return;
      const r = Array.isArray(rows) ? rows[0] : null;
      setRecId(r?.id || null);
      setM(r ? { ...LEER, ...r, residual: { modus: "verkauf", ...(r.residual || {}) } } : LEER);
    }).catch((e) => setFehler(`${t("Kennzahlen konnten nicht geladen werden")}: ${e instanceof Error ? e.message : String(e)}`));
    return () => { weg = true; };
  }, [project?.id, t]);

  if (!project) return null;
  const mass = massDerNutzung(m);
  const res = residualwert(m.residual, m.grundstueck_m2 === "" ? null : Number(m.grundstueck_m2));
  const setze = (k, v) => { setGespeichert(false); setM((x) => ({ ...x, [k]: v })); };
  const setzeR = (k, v) => { setGespeichert(false); setM((x) => ({ ...x, residual: { ...x.residual, [k]: v } })); };
  const setzeG = (i, k, v) => { setGespeichert(false); setM((x) => ({ ...x, geschosse: x.geschosse.map((g, j) => (j === i ? { ...g, [k]: v } : g)) })); };

  const ausModell = () => {
    const h = Number(store.storeyHeight) || 3;
    const a = Math.round(pm.footArea);
    setGespeichert(false);
    setM((x) => ({
      ...x,
      grundflaeche_m2: String(a),
      // [ASSUMED] ground level = finished floor of the ground floor; storey i (0 = EG) has its ceiling top at (i+1) × h.
      geschosse: Array.from({ length: pm.storeys }, (_, i) => ({ name: i === 0 ? "EG" : `${i}. OG`, flaeche_m2: String(a), flaeche_h230_m2: String(a), doK_ueber_gelaende_m: String((i + 1) * h), hoehe_m: String(h) })),
      residual: { ...x.residual, bgf_m2: String(Math.round(pm.bgf)) },
    }));
  };

  const speichern = async () => {
    setFehler(null);
    try {
      const { id: _id, ...rest } = m;
      const payload = { ...rest, project_id: project.id };
      if (recId) await bitApi.entities.Machbarkeit.update(recId, payload);
      else setRecId((await bitApi.entities.Machbarkeit.create(payload)).id);
      setGespeichert(true);
    } catch (e) { setFehler(`${t("Kennzahlen konnten nicht gespeichert werden")}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const feld = (k, label, wert, onChange) => (
    <div className="space-y-1">
      <label htmlFor={`mk-${k}`} className="text-xs text-slate-500">{t(label)}</label>
      <Input id={`mk-${k}`} data-testid={`mk-${k}`} type="number" step="any" className="h-8" value={wert ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
  const zeile = (label, ist, soll, testid) => {
    const ueber = ist != null && soll != null && soll !== "" && ist > Number(soll) + 1e-9;
    return (
      <tr className="border-b last:border-0" data-testid={testid}>
        <td className="py-1 px-2">{t(label)}</td>
        <td className={`py-1 px-2 text-right tabular-nums ${ueber ? "text-amber-700 font-medium" : ""}`}>{fmt(ist, 3)}</td>
        <td className="py-1 px-2 text-right tabular-nums text-slate-500">{soll === "" || soll == null ? "—" : fmt(Number(soll), 3)}</td>
      </tr>
    );
  };

  return (
    <Card data-testid="mk-karte" className="border-emerald-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>{t("Projektkennzahlen (gespeichert)")}: {project.name}</span>
          <span className="flex gap-2">
            {pm.footArea > 0 && <Button size="sm" variant="outline" data-testid="mk-modell" onClick={ausModell}>{t("Aus Gebäudemodell übernehmen")}</Button>}
            <Button size="sm" data-testid="mk-speichern" onClick={speichern}>{t("Speichern")}</Button>
          </span>
        </CardTitle>
        <p className="text-xs text-slate-500">{t("Maß der baulichen Nutzung (BauNVO §§ 19–21), Vollgeschosse und Residualwert — Werte dieses Projekts, anders als die Beispielrechnung darunter.")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {feld("grundstueck_m2", "Grundstück (m²)", m.grundstueck_m2, (v) => setze("grundstueck_m2", v))}
          {feld("grz_max", "GRZ zulässig", m.grz_max, (v) => setze("grz_max", v))}
          {feld("gfz_max", "GFZ zulässig", m.gfz_max, (v) => setze("gfz_max", v))}
          {feld("bmz_max", "BMZ zulässig", m.bmz_max, (v) => setze("bmz_max", v))}
          {feld("grundflaeche_m2", "Grundfläche Hauptanlage (m²)", m.grundflaeche_m2, (v) => setze("grundflaeche_m2", v))}
          {feld("nebenanlagen_m2", "§ 19 Abs. 4-Flächen (m²)", m.nebenanlagen_m2, (v) => setze("nebenanlagen_m2", v))}
          {feld("baumasse_m3", "Baumasse (m³, leer = aus Geschossen)", m.baumasse_m3, (v) => setze("baumasse_m3", v))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-1 px-1">{t("Geschoss")}</th>
                <th className="py-1 px-1">{t("Fläche (m²)")}</th>
                <th className="py-1 px-1">{t("davon ≥ 2,30 m licht (m²)")}</th>
                <th className="py-1 px-1">{t("Deckenoberkante über Gelände (m)")}</th>
                <th className="py-1 px-1">{t("Geschosshöhe (m)")}</th>
                <th className="py-1 px-1">{t("Vollgeschoss?")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {m.geschosse.map((g, i) => {
                const v = mass.geschosse[i];
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 px-1"><Input className="h-8 w-24" data-testid={`mk-g-${i}-name`} aria-label={t("Geschoss")} value={g.name ?? ""} onChange={(e) => setzeG(i, "name", e.target.value)} /></td>
                    {["flaeche_m2", "flaeche_h230_m2", "doK_ueber_gelaende_m", "hoehe_m"].map((k) => (
                      <td key={k} className="py-1 px-1"><Input className="h-8 w-28" type="number" step="any" data-testid={`mk-g-${i}-${k}`} aria-label={k} value={g[k] ?? ""} onChange={(e) => setzeG(i, k, e.target.value)} /></td>
                    ))}
                    <td className="py-1 px-1 text-xs" data-testid={`mk-g-voll-${i}`} data-voll={v?.voll === null ? "" : String(v?.voll)}>
                      {v?.voll === true ? t("ja") : v?.voll === false ? t("nein") : "—"}<div className="text-slate-400">{t(v?.grund || "")}</div>
                    </td>
                    <td className="py-1 px-1"><Button size="sm" variant="ghost" onClick={() => setze("geschosse", m.geschosse.filter((_, j) => j !== i))}>×</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Button size="sm" variant="ghost" data-testid="mk-geschoss-neu" onClick={() => setze("geschosse", [...m.geschosse, { name: "", flaeche_m2: "", flaeche_h230_m2: "", doK_ueber_gelaende_m: "", hoehe_m: "" }])}>
            + {t("Geschoss")}
          </Button>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <table className="w-full text-sm" data-testid="mk-ist" data-grz={mass.grz ?? ""} data-grz2={mass.grz2 ?? ""} data-gfz={mass.gfz ?? ""} data-bmz={mass.bmz ?? ""} data-voll={mass.vollgeschosse}>
              <thead><tr className="text-left text-xs text-slate-400 border-b"><th className="py-1 px-2">{t("Kennzahl")}</th><th className="py-1 px-2 text-right">{t("Ist")}</th><th className="py-1 px-2 text-right">{t("zulässig")}</th></tr></thead>
              <tbody>
                {zeile("GRZ (§ 19 BauNVO)", mass.grz, m.grz_max, "mk-z-grz")}
                {zeile("GRZ inkl. § 19 Abs. 4", mass.grz2, mass.grz2_max, "mk-z-grz2")}
                {zeile("GFZ (§ 20 BauNVO)", mass.gfz, m.gfz_max, "mk-z-gfz")}
                {zeile("BMZ (§ 21 BauNVO)", mass.bmz, m.bmz_max, "mk-z-bmz")}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">{t("Vollgeschosse")}: {mass.vollgeschosse} · {t("Geschossfläche")}: {fmt(mass.gf_m2, 1)} m² · {t("Baumasse")}: {fmt(mass.baumasse_m3, 1)} m³</p>
            <ul className="mt-2 space-y-0.5 text-xs">
              {mass.hinweise.map((h) => <li key={h.code} data-testid="mk-hinweis" data-code={h.code} className={h.stufe === "warn" ? "text-amber-700" : "text-slate-500"}>{h.stufe === "warn" ? "⚠ " : "ℹ "}{t(h.text)}</li>)}
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("Residualwertverfahren (tragbarer Bodenwert)")}</p>
            <div className="flex gap-3 text-sm">
              {[["verkauf", "Verkauf"], ["ertrag", "Ertragswert"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="radio" name="mk-modus" data-testid={`mk-modus-${k}`} checked={(m.residual?.modus || "verkauf") === k} onChange={() => setzeR("modus", k)} /> {t(l)}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {feld("r-flaeche_m2", "Verkaufs-/Mietfläche (m²)", m.residual?.flaeche_m2, (v) => setzeR("flaeche_m2", v))}
              {(m.residual?.modus || "verkauf") === "verkauf"
                ? feld("r-preis_eur_m2", "Verkaufspreis (€/m²)", m.residual?.preis_eur_m2, (v) => setzeR("preis_eur_m2", v))
                : feld("r-miete_eur_m2_monat", "Miete (€/m² Monat)", m.residual?.miete_eur_m2_monat, (v) => setzeR("miete_eur_m2_monat", v))}
              {feld("r-bgf_m2", "BGF (m²)", m.residual?.bgf_m2, (v) => setzeR("bgf_m2", v))}
              {feld("r-baukosten_eur_m2_bgf", "Baukosten KG 300+400 (€/m² BGF)", m.residual?.baukosten_eur_m2_bgf, (v) => setzeR("baukosten_eur_m2_bgf", v))}
              {feld("r-gewinn_anteil", "Wagnis und Gewinn (Anteil)", m.residual?.gewinn_anteil ?? "", (v) => setzeR("gewinn_anteil", v))}
              {feld("r-nebenkosten_anteil", "Baunebenkosten (Anteil)", m.residual?.nebenkosten_anteil ?? "", (v) => setzeR("nebenkosten_anteil", v))}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {[["Erlös", res.erloes], ["Baukosten", res.baukosten], ["Baunebenkosten", res.nebenkosten], ["Finanzierung", res.finanzierung], ["Wagnis und Gewinn", res.gewinn], ["Residuum", res.residuum]].map(([l, v]) => (
                  <tr key={String(l)} className="border-b last:border-0"><td className="py-0.5 px-2">{t(String(l))}</td><td className="py-0.5 px-2 text-right tabular-nums">{eur(v)}</td></tr>
                ))}
                <tr data-testid="mk-bodenwert" data-wert={res.bodenwert ?? ""}>
                  <td className="py-1 px-2 font-semibold">{t("Tragbarer Bodenwert")}</td>
                  <td className="py-1 px-2 text-right tabular-nums font-semibold">{eur(res.bodenwert)}{res.bodenwert_je_m2 != null && <span className="ml-1 text-xs text-slate-500">({eur(res.bodenwert_je_m2)}/m²)</span>}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-400">
              {t("Standardsätze, solange leer: Nebenkosten {n} %, Finanzierung {f} % p. a. auf die halben Kosten über {b} Monate, Wagnis und Gewinn {g} % vom Erlös, Erwerbsnebenkosten {e} % [Annahme].")
                .replace("{n}", String(RESIDUAL_STANDARD.nebenkosten_anteil * 100)).replace("{f}", String(RESIDUAL_STANDARD.finanzierung_zins * 100))
                .replace("{b}", String(RESIDUAL_STANDARD.bauzeit_monate)).replace("{g}", String(RESIDUAL_STANDARD.gewinn_anteil * 100))
                .replace("{e}", String(RESIDUAL_STANDARD.erwerbsnebenkosten_anteil * 100))}
            </p>
          </div>
        </div>
        {gespeichert && <p className="text-sm text-emerald-700" data-testid="mk-gespeichert">{t("Gespeichert")}</p>}
        {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="mk-fehler">{fehler}</p>}
      </CardContent>
    </Card>
  );
}
