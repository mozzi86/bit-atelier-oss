// KostenstaendeKarte — cost control card "Kostenstände DIN 276" (88-08, RE-22): the six
// stages of cost determination side by side (recorded snapshot or live value), change
// against the previous stage, share of the construction cost ceiling with a traffic
// light; set the ceiling, record a stage (snapshot with date).
//
// In:  live values in euros net from CostControl (LV estimate, prognosis, billed +
//      approved change orders, building-model estimate); project from useProject().
//      Loads/creates KostenStand records and writes Project.baukostenobergrenze.
// Out: the card; data-testids ks-karte, ks-zeile (data-stufe, data-betrag, data-ampel,
//      data-herkunft), ks-aktuell, ks-obergrenze, ks-obergrenze-speichern, ks-erfassen
//      (per row), ks-betrag, ks-datum, ks-speichern, ks-fehler.
import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import {
  kostenstaendeZusammenstellen, aktuellerStand, kostenStandRecord, AMPEL_SCHWELLEN,
} from "@ava/lib/kostenstaende";

const eur = (v) => (v == null ? "—" : Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));
const pct = (a) => (a == null ? "—" : `${(a * 100).toFixed(1).replace(".", ",")} %`);
const AMPEL_KLASSE = { gruen: "bg-emerald-500", gelb: "bg-amber-400", rot: "bg-rose-600" };
const AMPEL_TEXT = { gruen: "unter der Obergrenze", gelb: "nahe der Obergrenze", rot: "über der Obergrenze" };

/**
 * @param {{live: {kostenschaetzung?: number|null, kostenberechnung?: number|null, kostenvoranschlag?: number|null,
 *   kostenanschlag?: number|null, kostenfeststellung?: number|null}}} props live values, euros net
 */
export default function KostenstaendeKarte({ live }) {
  const { t } = useI18n();
  const { project } = useProject();
  const projektId = project?.id || null;
  const [records, setRecords] = useState(/** @type {Array<any>} */ ([]));
  const [obergrenze, setObergrenze] = useState(/** @type {number|null} */ (null));
  const [obergrenzeText, setObergrenzeText] = useState("");
  const [erfassen, setErfassen] = useState(/** @type {null | {stufe: string, betrag: string, datum: string}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  const laden = useCallback(async () => {
    if (!projektId) return;
    try {
      const r = await bitApi.entities.KostenStand.filter({ project_id: projektId });
      setRecords(Array.isArray(r) ? r : []);
    } catch (e) {
      setFehler(`${t("Kostenstände konnten nicht geladen werden")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projektId, t]);

  useEffect(() => { laden(); }, [laden]);
  useEffect(() => {
    const o = Number(/** @type {any} */ (project)?.baukostenobergrenze);
    setObergrenze(Number.isFinite(o) && o > 0 ? o : null);
    setObergrenzeText(Number.isFinite(o) && o > 0 ? String(o) : "");
  }, [project]);

  const zeilen = kostenstaendeZusammenstellen({ records, obergrenze, live: { ...live, kostenschaetzung: live.kostenschaetzung ?? /** @type {any} */ (project)?.estimated_cost } });
  const aktuell = aktuellerStand(zeilen);

  const obergrenzeSpeichern = async () => {
    if (!projektId) return;
    setFehler(null);
    const s = obergrenzeText.trim().replace(",", ".");
    const wert = s === "" ? null : Number(s);
    if (wert !== null && (!Number.isFinite(wert) || wert <= 0)) { setFehler(t("Obergrenze muss eine positive Zahl sein")); return; }
    try {
      await bitApi.entities.Project.update(projektId, { baukostenobergrenze: wert });
      setObergrenze(wert);
    } catch (e) {
      setFehler(`${t("Obergrenze konnte nicht gespeichert werden")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const standSpeichern = async () => {
    if (!projektId || !erfassen) return;
    setFehler(null);
    try {
      const rec = kostenStandRecord({ projectId: projektId, stufe: erfassen.stufe, betrag: erfassen.betrag, datum: erfassen.datum, quelle: "erfasst" });
      await bitApi.entities.KostenStand.create(rec);
      setErfassen(null);
      await laden();
    } catch (e) {
      setFehler(`${t("Kostenstand konnte nicht gespeichert werden")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!projektId) return null;
  return (
    <Card data-testid="ks-karte">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("Kostenstände DIN 276")}</CardTitle>
        <p className="text-xs text-slate-400">
          {t("Alle Stufen auf derselben Basis erfassen (z. B. KG 300 + 400, netto). Die Ampel ist ein Hinweis, keine Feststellung.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="ks-obergrenze" className="text-xs font-medium text-slate-600">{t("Baukostenobergrenze (€ netto)")}</label>
            <Input id="ks-obergrenze" data-testid="ks-obergrenze" type="number" step="any" className="w-48"
              value={obergrenzeText} onChange={(e) => setObergrenzeText(e.target.value)} placeholder={t("nicht vereinbart")} />
          </div>
          <Button size="sm" variant="outline" data-testid="ks-obergrenze-speichern" onClick={obergrenzeSpeichern}>{t("Speichern")}</Button>
          {aktuell && (
            <p className="text-sm" data-testid="ks-aktuell" data-ampel={aktuell.ampel || ""}>
              {t("Aktueller Stand")}: <span className="font-medium">{t(aktuell.label)}</span> {eur(aktuell.betrag)}
              {aktuell.ampel && <> · {pct(aktuell.anteilObergrenze)} {t("der Obergrenze")} — {t(AMPEL_TEXT[aktuell.ampel])}</>}
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-2 px-2">{t("Stufe")}</th>
                <th className="py-2 px-2">{t("LPH")}</th>
                <th className="py-2 px-2 text-right">{t("Betrag (netto)")}</th>
                <th className="py-2 px-2">{t("Quelle")}</th>
                <th className="py-2 px-2 text-right">{t("Δ zur Vorstufe")}</th>
                <th className="py-2 px-2 text-right">{t("Anteil Obergrenze")}</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.key} className="border-b last:border-0" data-testid="ks-zeile" data-stufe={z.key}
                  data-betrag={z.betrag ?? ""} data-ampel={z.ampel || ""} data-herkunft={z.herkunft || ""}>
                  <td className="py-1.5 px-2 font-medium" title={z.norm}>{t(z.label)}{z.vorlaeufig && <span className="ml-1 text-xs text-amber-700">({t("vorläufig")})</span>}</td>
                  <td className="py-1.5 px-2 text-slate-500">{z.lph}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{eur(z.betrag)}</td>
                  <td className="py-1.5 px-2 text-xs text-slate-500">
                    {z.herkunft === "erfasst" ? `${t("erfasst")} ${z.datum ? new Date(z.datum).toLocaleDateString("de-DE") : ""}` : z.herkunft === "live" ? `${t("live")}: ${t(z.quelle)}` : "—"}
                  </td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${z.deltaVorstufe > 0 ? "text-rose-600" : z.deltaVorstufe < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                    {z.deltaVorstufe == null ? "—" : `${eur(z.deltaVorstufe)} (${pct(z.deltaVorstufeAnteil)})`}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {z.ampel && <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${AMPEL_KLASSE[z.ampel]}`} aria-label={t(AMPEL_TEXT[z.ampel])} />}
                    {pct(z.anteilObergrenze)}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <Button size="sm" variant="ghost" data-testid="ks-erfassen"
                      onClick={() => setErfassen({ stufe: z.key, betrag: z.betrag == null ? "" : String(z.betrag), datum: new Date().toISOString().slice(0, 10) })}>
                      {z.herkunft === "live" ? t("Festschreiben") : t("Erfassen")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {erfassen && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3">
            <p className="w-full text-sm font-medium">{t(zeilen.find((z) => z.key === erfassen.stufe)?.label || "")}</p>
            <div className="space-y-1">
              <label htmlFor="ks-betrag" className="text-xs text-slate-600">{t("Betrag (€ netto)")}</label>
              <Input id="ks-betrag" data-testid="ks-betrag" type="number" step="any" className="w-48" value={erfassen.betrag}
                onChange={(e) => setErfassen({ ...erfassen, betrag: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label htmlFor="ks-datum" className="text-xs text-slate-600">{t("Datum")}</label>
              <Input id="ks-datum" data-testid="ks-datum" type="date" className="w-44" value={erfassen.datum}
                onChange={(e) => setErfassen({ ...erfassen, datum: e.target.value })} />
            </div>
            <Button size="sm" data-testid="ks-speichern" onClick={standSpeichern}>{t("Speichern")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setErfassen(null)}>{t("Abbrechen")}</Button>
          </div>
        )}
        {fehler && <p className="text-sm text-rose-700" role="alert" data-testid="ks-fehler">{fehler}</p>}
        <p className="text-xs text-slate-400">
          {t("Ampel: grün unter {g} %, gelb ab {g} %, rot über {r} % der Obergrenze [Annahme Büro].")
            .replaceAll("{g}", String(AMPEL_SCHWELLEN.gelbAb * 100)).replace("{r}", String(AMPEL_SCHWELLEN.rotUeber * 100))}
        </p>
      </CardContent>
    </Card>
  );
}
