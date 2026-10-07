import React from "react";
import { AlertTriangle, Car, Eraser } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { NumberField } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useI18n } from "@core/lib/i18n";
import { WT_MARKER } from "@designer/lib/tesselierung";
import { zonenBBox } from "@designer/lib/keller";
import BimPlan2D from "./BimPlan2D";

const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const TG_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

// Colours per garage zone kind (overlay, level -1 drawn over the EG hull — D-P61-09).
// Dark mode: explicit text colours on light tints (REVIEW-DARKMODE lesson).
const FARBE = {
  stellplatz: { fill: "#e0f2fe", stroke: "#0369a1", text: "#0c4a6e" },
  bf: { fill: "#fef3c7", stroke: "#b45309", text: "#78350f" },
  konflikt: { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" },
  fahrgasse: { fill: "#e2e8f0", stroke: "#64748b", text: "#334155" },
  rampe: { fill: "#ddd6fe", stroke: "#6d28d9", text: "#3b0764" },
};

/**
 * Tiefgaragen-Planner (Phase 62-02) — sub view of the Werkstatt tab next to the
 * Kellerabteile. Rendering and wiring only; the logic lives in @designer/lib/tiefgarage.
 *
 * @param {object} p
 * @param {object} p.plan usePlanModel result (model, storeyHeight, unit)
 * @param {ReturnType<import("@designer/lib/tiefgarage").tiefgarageLayout>} p.ergebnis
 * @param {Array<{key:string,label:string,status:string,detail:string}>} p.checks tiefgarageChecks result
 * @param {object} p.optionen layer.tiefgarage.optionen (hardened)
 * @param {(patch: object) => void} p.setOptionen
 * @param {boolean} p.aktiv garage applied to the store
 * @param {boolean} p.tesselierungAngewendet storey tessellation applied (prerequisite: WE count)
 * @param {boolean} p.kellerAktiv cellar applied — the garage then takes the head end and the cellar moves behind it
 * @param {() => void} p.onAnwenden
 * @param {() => void} p.onEntfernen
 * @param {object|null} p.mengenPersistiert layer.tiefgarage.mengen (AVA hand-over)
 */
export default function TiefgaragenPlaner({
  plan, ergebnis, checks, optionen, setOptionen, aktiv, tesselierungAngewendet, kellerAktiv,
  onAnwenden, onEntfernen, mengenPersistiert,
}) {
  const { t } = useI18n();
  const zonen = ergebnis?.zonen || [];
  const mengen = ergebnis?.mengen || {};
  const nachweis = ergebnis?.nachweis || {};
  const geig = ergebnis?.geig || {};
  const ohneMarker = (name) => String(name || "").replace(WT_MARKER, "");
  const pct = Math.round((optionen.rampeNeigung || 0.15) * 100);

  const mengenZeilen = [
    { key: "stellplaetze_stk", label: t("Stellplätze"), einheit: "Stk", wert: mengen.stellplaetze_stk, ganz: true },
    { key: "barrierefrei_stk", label: t("davon barrierefrei"), einheit: "Stk", wert: mengen.barrierefrei_stk, ganz: true },
    { key: "stellplatz_m2", label: t("Stellplatzfläche"), einheit: "m²", wert: mengen.stellplatz_m2 },
    { key: "verkehr_m2", label: t("Verkehrsfläche (Fahrgasse + Rampe)"), einheit: "m²", wert: mengen.verkehr_m2 },
    { key: "rampe_lfm", label: t("Rampe"), einheit: "lfm", wert: mengen.rampe_lfm },
    { key: "nutzflaeche_m2", label: t("Nutzfläche Garage"), einheit: "m²", wert: mengen.nutzflaeche_m2 },
  ];
  const persistiertAktuell = !!mengenPersistiert && JSON.stringify(mengenPersistiert) === JSON.stringify(mengen);

  return (
    <div className="space-y-4" data-testid="tg-planer">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Linke Spalte: Steuerung + Optionen */}
        <div className="space-y-4 xl:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Car className="w-4 h-4" /> {t("Tiefgarage")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-slate-500">
                {t("Stellplatz-Raster, Fahrgasse und Rampe auf Geschoss −1 im Kopfbereich des Footprints; die Kellerabteile rücken dahinter. Richtwerte GaStellV/EAR, Checks nur pass/warn/offen — Landesrecht prüfen.")}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={onAnwenden} disabled={aktiv || !tesselierungAngewendet} data-testid="tg-anwenden">
                  {t("Tiefgarage anwenden")}
                </Button>
                <Button size="sm" variant="outline" onClick={onEntfernen} disabled={!aktiv} data-testid="tg-entfernen">
                  <Eraser className="w-3.5 h-3.5 mr-1" /> {t("Tiefgarage entfernen")}
                </Button>
              </div>
              {!tesselierungAngewendet && (
                <div className="text-xs text-amber-700">{t("Zuerst die Tesselierung der Geschosse anwenden (WE-Zahl für den Nachweis).")}</div>
              )}
              <div className="flex flex-wrap gap-1" data-testid="tg-checks">
                {(checks || []).map((c) => {
                  const st = TG_STATUS[c.status] || TG_STATUS.offen;
                  return <Badge key={c.key} className={st.color} title={c.detail} data-status={c.status}>{c.label}: {st.label}</Badge>;
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Richtwerte")} <span className="text-xs font-normal text-slate-400">[ASSUMED]</span></CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NumberField label={kellerAktiv ? t("Garagenlänge (Rest = Keller)") : t("Garagenlänge (leer = ganzer Footprint)")}
                suffix="m" min={0} step="0.5" value={optionen.laenge_m ?? ""}
                onChange={(v) => setOptionen({ laenge_m: v === "" || v == null ? null : Math.max(0, v) })} />
              <label className="block text-xs text-slate-600">
                {t("Anordnung")}
                <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                  value={optionen.anordnung} data-testid="tg-anordnung"
                  onChange={(e) => setOptionen({ anordnung: e.target.value })}>
                  <option value="senkrecht">{t("90° (Senkrechtaufstellung)")}</option>
                  <option value="laengs">{t("Längsaufstellung")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={!!optionen.gegenverkehr} data-testid="tg-opt-gegenverkehr"
                  onChange={(e) => setOptionen({ gegenverkehr: e.target.checked })} />
                {t("Gegenverkehr in der Fahrgasse (sonst Einbahn)")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t("Rampenneigung")} suffix="%" min={2} max={50} step="1" value={pct}
                  onChange={(v) => setOptionen({ rampeNeigung: Math.max(0.02, Math.min(0.5, (Number(v) || 15) / 100)) })} />
                <NumberField label={t("Barrierefrei (leer = Quote)")} suffix="Stk" min={0} step="1" value={optionen.barrierefreiAnzahl ?? ""}
                  onChange={(v) => setOptionen({ barrierefreiAnzahl: v === "" || v == null ? null : Math.max(0, Math.round(v)) })} />
                <NumberField label={t("Stellplätze je WE")} suffix="×" min={0} step="0.1" value={optionen.kfzSchluessel}
                  onChange={(v) => setOptionen({ kfzSchluessel: Math.max(0, v) })} />
                <NumberField label={t("oberirdisch vorhanden")} suffix="Stk" min={0} step="1" value={optionen.oberirdisch_stk}
                  onChange={(v) => setOptionen({ oberirdisch_stk: Math.max(0, Math.round(v)) })} />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={!!optionen.rampeZweispurig}
                  onChange={(e) => setOptionen({ rampeZweispurig: e.target.checked })} />
                {t("Rampe zweispurig (≥ 5,00 m)")}
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={!!optionen.nutzungWohnen}
                  onChange={(e) => setOptionen({ nutzungWohnen: e.target.checked })} />
                {t("Wohngebäude (GEIG §6, sonst §7)")}
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={!!optionen.lueftungMaschinell} data-testid="tg-opt-lueftung"
                  onChange={(e) => setOptionen({ lueftungMaschinell: e.target.checked })} />
                {t("maschinelle Lüftung + CO-Warnanlage vorgesehen")}
              </label>
              <div className="text-[10px] text-slate-400">
                {t("Regelstellplatz 2,50 × 5,00 m, Wandzuschlag 0,10 m, barrierefrei 3,50 m, Fahrgasse 6,00 m bei 90°, Rampe ≤ 15 %, lichte Höhe ≥ 2,00 m, Klassen 100/1.000 m² — GaStellV Bayern / M-GarVO / EAR 05, alle Richtwerte, kein Norm-Anspruch.")}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rechte Spalte: UG-Plan + Nachweis + Mengen */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("Tiefgarage (UG, Geschoss −1)")} — {t("Hülle des EG als Orientierung")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BimPlan2D
                model={plan.model}
                mode="grundriss"
                level={0}
                storeyHeight={plan.storeyHeight}
                readOnly
                customZones={[]}
                unit={plan.unit}
                height={420}
                overlay={({ X, Z }) => (
                  <g data-testid="tg-overlay">
                    {zonen.map((z, i) => {
                      if (!z.points || z.points.length < 3) return null;
                      const art = z.rampe ? "rampe" : z.fahrgasse ? "fahrgasse" : z.konflikt ? "konflikt" : z.bf ? "bf" : "stellplatz";
                      const f = FARBE[art];
                      const d = z.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
                      const b = zonenBBox(z);
                      const cx = X((b.x0 + b.x1) / 2), cy = Z((b.z0 + b.z1) / 2);
                      const breit = Math.abs(X(b.x1) - X(b.x0)), hoch = Math.abs(Z(b.z1) - Z(b.z0));
                      const drehen = art === "stellplatz" || art === "bf" || art === "konflikt" ? breit < hoch : false;
                      const label = z.stellplatz ? `${z.stellplatz}${z.bf ? " ♿" : ""}` : ohneMarker(z.name);
                      const testid = z.stellplatz ? (z.konflikt ? "tg-stellplatz-konflikt" : "tg-stellplatz") : `tg-${art}`;
                      return (
                        <g key={`tg-${i}`} data-testid={testid}>
                          <path d={d} fill={f.fill} fillOpacity={aktiv ? 0.85 : 0.5} stroke={f.stroke}
                            strokeWidth={z.fahrgasse ? 0.8 : 1} strokeDasharray={aktiv ? undefined : "3 2"} />
                          {z.fahrgasse && z.einbahn && (
                            // One-way arrow along the longer side of the Fahrgasse (EAR one-way guidance).
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill={f.text}>→ → →</text>
                          )}
                          <text x={cx} y={z.fahrgasse && z.einbahn ? cy + 10 : cy} textAnchor="middle" dominantBaseline="middle"
                            fontSize={z.stellplatz ? "6.5" : "7.5"} fill={f.text} fontWeight="600"
                            transform={drehen ? `rotate(-90 ${cx} ${cy})` : undefined}>
                            {label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="font-semibold text-slate-600">{aktiv ? t("Im Modell (Geschoss −1)") : t("Vorschau — noch nicht angewendet")}</span>
                <span data-testid="tg-anzahl">{mengen.stellplaetze_stk || 0} {t("Stellplätze")}</span>
                <span>{ergebnis?.module || 0} {t("Modul(e)")}{ergebnis?.einseitig ? ` · ${t("einseitig")}` : ""}</span>
                <span>{t("Länge")} {de1(ergebnis?.laenge_m)} m</span>
                <span>{t("Klasse")}: {ergebnis?.klasse || "—"}</span>
              </div>
              {(ergebnis?.hinweise || []).map((h) => (
                <div key={h} className="mt-2 flex items-start gap-2 rounded border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                  <span>{h}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("Stellplatz-Nachweis")}</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs" data-testid="tg-nachweis">
                  <tbody>
                    <tr className="border-b border-slate-100"><td className="py-1">{t("erforderlich (WE × Schlüssel)")}</td><td className="py-1 text-right font-medium">{nachweis.erforderlich ?? 0}</td></tr>
                    <tr className="border-b border-slate-100"><td className="py-1">{t("Tiefgarage")}</td><td className="py-1 text-right font-medium">{nachweis.tg_stk ?? 0}</td></tr>
                    <tr className="border-b border-slate-100"><td className="py-1">{t("oberirdisch (Landschafts-Tab)")}</td><td className="py-1 text-right font-medium">{nachweis.oberirdisch_stk ?? 0}</td></tr>
                    <tr className="border-b border-slate-100"><td className="py-1">{t("Differenz")}</td>
                      <td className={`py-1 text-right font-medium ${(nachweis.differenz ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{nachweis.differenz ?? 0}</td></tr>
                    <tr className="border-b border-slate-100"><td className="py-1">{t("barrierefrei erforderlich / vorhanden")}</td><td className="py-1 text-right font-medium">{nachweis.bfErforderlich ?? 0} / {nachweis.bfVorhanden ?? 0}</td></tr>
                    <tr><td className="py-1">{t("GEIG Leitungsinfrastruktur / Ladepunkte")}</td><td className="py-1 text-right font-medium">{geig.leitungsinfrastruktur_stk ?? 0} / {geig.ladepunkte_stk ?? 0}</td></tr>
                  </tbody>
                </table>
                <div className="mt-2 text-[10px] text-slate-400">{geig.regel || ""}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("Mengenliste (AVA-Übergabe)")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <table className="w-full text-xs" data-testid="tg-mengen">
                  <tbody>
                    {mengenZeilen.map((m) => (
                      <tr key={m.key} className="border-t border-slate-100 first:border-0">
                        <td className="py-1">{m.label}</td>
                        <td className="py-1 text-right font-medium whitespace-nowrap">
                          {m.ganz ? (Number(m.wert) || 0) : de1(m.wert)} {m.einheit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    {t("Konzept-Mengen aus dem Regel-Layout, keine geprüften AVA-Mengen. Übergabe-Schnittstelle; LV-Positionen entstehen daraus noch nicht (D-P61-10).")}
                    {" "}
                    {aktiv
                      ? (persistiertAktuell ? t("Im Projekt gespeichert (werkstatt_layer).") : t("Speichern läuft …"))
                      : t("Wird beim „Tiefgarage anwenden“ gespeichert.")}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
