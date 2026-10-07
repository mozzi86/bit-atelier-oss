import React from "react";
import { AlertTriangle, Eraser, Warehouse } from "lucide-react";
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
const K_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

// Colours per basement zone kind (overlay). D-P61-09: the basement is NOT
// rendered through BimPlan2D's level prop — createBuildingModel knows no
// basement — level 0 serves as hull orientation and the overlay draws level -1.
const FARBE = {
  abteil: { fill: "#ccfbf1", stroke: "#0f766e", text: "#134e4a" },
  gang: { fill: "#e2e8f0", stroke: "#64748b", text: "#334155" },
  technik: { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" },
  fahrrad: { fill: "#f5f5f4", stroke: "#a8a29e", text: "#44403c" },
  wasch: { fill: "#dbeafe", stroke: "#2563eb", text: "#1e3a8a" },
};

/**
 * Basement compartment planning (Phase 61-06, TESS-09) — sub view of the
 * Werkstatt tab. Rendering and wiring only; the logic lives in @designer/lib/keller.
 *
 * @param {object} p
 * @param {object} p.plan usePlanModel result (model, storeyHeight, unit)
 * @param {{zonen:Array<object>, zuordnung:Array<object>, mengen:object, hinweise:string[], reihen?:number}} p.ergebnis kellerLayout result
 * @param {Array<{key:string,label:string,status:string,detail:string}>} p.checks kellerChecks result
 * @param {object} p.optionen layer.keller.optionen (hardened)
 * @param {(patch: object) => void} p.setOptionen
 * @param {boolean} p.aktiv basement applied to the store
 * @param {boolean} p.tesselierungAngewendet storey tessellation applied (prerequisite)
 * @param {() => void} p.onAnwenden
 * @param {() => void} p.onEntfernen
 * @param {object|null} p.mengenPersistiert layer.keller.mengen (hand-over to AVA / Phase 62)
 */
export default function KellerabteilPlaner({
  plan, ergebnis, checks, optionen, setOptionen, aktiv, tesselierungAngewendet,
  onAnwenden, onEntfernen, mengenPersistiert,
}) {
  const { t } = useI18n();
  const zonen = ergebnis?.zonen || [];
  const zuordnung = ergebnis?.zuordnung || [];
  const mengen = ergebnis?.mengen || {};
  const ohneMarker = (name) => String(name || "").replace(WT_MARKER, "");

  // AVA hand-over (D-P61-10): this quantity list is the HAND-OVER INTERFACE
  // (UI + werkstatt_layer.keller.mengen). The deep integration — LV positions
  // from basement zones in nova-ausschreibung — is NOT built (follow-up task);
  // @designer does not write into @ava, computeBimQuantities reads no zones.
  const mengenZeilen = [
    { key: "abteile_stk", label: t("Kellerabteile"), einheit: "Stk", wert: mengen.abteile_stk, ganz: true },
    { key: "abteile_m2", label: t("Abteilfläche"), einheit: "m²", wert: mengen.abteile_m2 },
    { key: "trennwaende_lfm", label: t("Abteil-Zwischenwände"), einheit: "lfm", wert: mengen.trennwaende_lfm },
    { key: "abteilfronten_lfm", label: t("Abteilfronten zum Gang (Gitterwand/Tür)"), einheit: "lfm", wert: mengen.abteilfronten_lfm },
    { key: "verkehr_m2", label: t("Verkehrsfläche Gang"), einheit: "m²", wert: mengen.verkehr_m2 },
    { key: "technik_m2", label: t("Technikraum"), einheit: "m²", wert: mengen.technik_m2 },
    { key: "fahrrad_m2", label: t("Fahrradraum"), einheit: "m²", wert: mengen.fahrrad_m2 },
    { key: "wasch_m2", label: t("Waschraum"), einheit: "m²", wert: mengen.wasch_m2 },
    { key: "gesamt_m2", label: t("Kellerfläche gesamt (Zonen)"), einheit: "m²", wert: mengen.gesamt_m2 },
  ];
  const persistiertAktuell = !!mengenPersistiert && JSON.stringify(mengenPersistiert) === JSON.stringify(mengen);

  return (
    <div className="space-y-4" data-testid="keller-planer">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Linke Spalte: Steuerung + Optionen */}
        <div className="space-y-4 xl:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Warehouse className="w-4 h-4" /> {t("Kellerabteile")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-slate-500">
                {t("Ein Abteil je WE aus der aktuellen Tesselierung; ändert sich der Wohnungsmix, zieht der Keller nach. Geschoss −1, Phase 62 (Tiefgarage) baut im selben UG weiter.")}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={onAnwenden} disabled={aktiv || !tesselierungAngewendet} data-testid="keller-anwenden">
                  {t("Keller anwenden")}
                </Button>
                <Button size="sm" variant="outline" onClick={onEntfernen} disabled={!aktiv} data-testid="keller-entfernen">
                  <Eraser className="w-3.5 h-3.5 mr-1" /> {t("Keller entfernen")}
                </Button>
              </div>
              {!tesselierungAngewendet && (
                <div className="text-xs text-amber-700">{t("Zuerst die Tesselierung der Geschosse anwenden.")}</div>
              )}
              <div className="flex flex-wrap gap-1" data-testid="keller-checks">
                {(checks || []).map((c) => {
                  const st = K_STATUS[c.status] || K_STATUS.offen;
                  return <Badge key={c.key} className={st.color} title={c.detail}>{c.label}: {st.label}</Badge>;
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Richtwerte")} <span className="text-xs font-normal text-slate-400">[ASSUMED]</span></CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* two columns: three fields with a unit suffix do not fit the 1/4 column */}
              <div className="grid grid-cols-2 gap-2" data-testid="keller-abteil-groessen">
                <NumberField label={t("Abteil min")} suffix="m²" min={1} value={optionen.abteilMin_m2}
                  onChange={(v) => setOptionen({ abteilMin_m2: Math.max(1, v) })} />
                <NumberField label={t("Abteil Ziel")} suffix="m²" min={1} value={optionen.abteilZiel_m2}
                  onChange={(v) => setOptionen({ abteilZiel_m2: Math.max(1, v) })} />
                <NumberField label={t("Abteil max")} suffix="m²" min={1} value={optionen.abteilMax_m2}
                  onChange={(v) => setOptionen({ abteilMax_m2: Math.max(1, v) })} />
                <NumberField label={t("Abteiltiefe max")} suffix="m" min={1.5} step="0.1" value={optionen.abteilTiefeMax_m}
                  onChange={(v) => setOptionen({ abteilTiefeMax_m: Math.max(1.5, v) })} />
              </div>
              <NumberField label={t("Gangbreite")} suffix="m" min={0.8} step="0.05" value={optionen.gang_b}
                onChange={(v) => setOptionen({ gang_b: Math.max(0.8, v) })} />
              <div className="space-y-2">
                <div className="text-xs text-slate-500">{t("Pflichtflächen")}</div>
                <div className="grid grid-cols-2 gap-2 items-end">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={!!optionen.technik} data-testid="keller-opt-technik"
                      onChange={(e) => setOptionen({ technik: e.target.checked })} />
                    {t("Technikraum")}
                  </label>
                  <NumberField label={t("Technik")} suffix="m²" min={0} value={optionen.technik_m2}
                    onChange={(v) => setOptionen({ technik_m2: Math.max(0, v) })} />
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={!!optionen.fahrrad}
                      onChange={(e) => setOptionen({ fahrrad: e.target.checked })} />
                    {t("Fahrradraum")}
                  </label>
                  <NumberField label={t("je WE")} suffix="m²" min={0} step="0.1" value={optionen.fahrradJeWe_m2}
                    onChange={(v) => setOptionen({ fahrradJeWe_m2: Math.max(0, v) })} />
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={!!optionen.wasch} data-testid="keller-opt-wasch"
                      onChange={(e) => setOptionen({ wasch: e.target.checked })} />
                    {t("Waschraum")}
                  </label>
                  <NumberField label={t("Wasch")} suffix="m²" min={0} value={optionen.wasch_m2}
                    onChange={(v) => setOptionen({ wasch_m2: Math.max(0, v) })} />
                </div>
              </div>
              <div className="text-[10px] text-slate-400">
                {t("Abteil-Mindestgrößen sind je LBO/Förderung uneinheitlich (4–6 m²); Abteiltiefe ≤ 3 m (tiefere Footprints bekommen mehrere Gang-Reihen); Gang 1,10 m; Technik 10–15 m² je MFH; Fahrrad 1,5 m²/WE — alle Richtwerte, kein Norm-Anspruch.")}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rechte Spalte: UG-Plan + Listen */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("Kellergeschoss (UG, Geschoss −1)")} — {t("Hülle des EG als Orientierung")}
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
                  <g data-testid="keller-overlay">
                    {zonen.map((z, i) => {
                      if (!z.points || z.points.length < 3) return null;
                      const f = FARBE[z.keller] || FARBE.fahrrad;
                      const d = z.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
                      const b = zonenBBox(z);
                      const cx = X((b.x0 + b.x1) / 2), cy = Z((b.z0 + b.z1) / 2);
                      const hoch = Math.abs(X(b.x1) - X(b.x0)) < Math.abs(Z(b.z1) - Z(b.z0)) && z.keller === "abteil";
                      const label = z.keller === "abteil" ? `${z.abteil} (${z.we})` : ohneMarker(z.name);
                      return (
                        <g key={`k-${i}`} data-testid={z.keller === "abteil" ? "keller-abteil" : `keller-${z.keller}`}>
                          <path d={d} fill={f.fill} fillOpacity={aktiv ? 0.85 : 0.5} stroke={f.stroke}
                            strokeWidth={z.keller === "abteil" ? 1 : 0.8} strokeDasharray={aktiv ? undefined : "3 2"} />
                          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="7.5"
                            fill={f.text} fontWeight="600"
                            transform={hoch ? `rotate(-90 ${cx} ${cy})` : undefined}
                            data-testid={z.keller === "abteil" ? "keller-abteil-label" : undefined}>
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
                <span>{zonen.filter((z) => z.keller === "abteil").length} {t("Abteile")}</span>
                <span>{ergebnis?.reihen || 1} {t("Gang-Reihe(n)")} · {de1(optionen.gang_b)} m</span>
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
            {/* Zuordnung Abteil ↔ WE — identische Bezeichner wie im Plan */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("Zuordnung Abteil ↔ WE")}</CardTitle>
              </CardHeader>
              <CardContent>
                {zuordnung.length === 0 && (
                  <div className="text-xs text-slate-500">{t("Keine WEs — Tesselierung anwenden.")}</div>
                )}
                {zuordnung.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" data-testid="keller-zuordnung">
                      <thead>
                        <tr className="text-left text-[10px] text-slate-400">
                          <th className="py-1 font-normal">{t("WE")}</th>
                          <th className="py-1 font-normal">{t("Abteil")}</th>
                          <th className="py-1 font-normal text-right">m²</th>
                          <th className="py-1 font-normal text-right">{t("Status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zuordnung.map((z) => {
                          const st = K_STATUS[z.status] || K_STATUS.offen;
                          return (
                            <tr key={z.we} className="border-t border-slate-100" data-testid="keller-zuordnung-zeile">
                              <td className="py-1">{z.we}</td>
                              <td className="py-1 font-medium">{z.abteil ? `${z.abteil} (${z.we})` : `— ${t("kein Abteil")}`}</td>
                              <td className="py-1 text-right">{z.abteil ? de1(z.flaeche_m2) : "–"}</td>
                              <td className="py-1 text-right"><Badge className={st.color}>{st.label}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Mengenliste — AVA-Übergabe (D-P61-10) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("Mengenliste (AVA-Übergabe)")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <table className="w-full text-xs" data-testid="keller-mengen">
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
                    {t("Konzept-Mengen aus dem Regel-Layout, keine geprüften AVA-Mengen. Übergabe-Schnittstelle an AVA/Phase 62; LV-Positionen entstehen daraus noch nicht (offen, D-P61-10).")}
                    {" "}
                    {aktiv
                      ? (persistiertAktuell ? t("Im Projekt gespeichert (werkstatt_layer).") : t("Speichern läuft …"))
                      : t("Wird beim „Keller anwenden“ gespeichert.")}
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
