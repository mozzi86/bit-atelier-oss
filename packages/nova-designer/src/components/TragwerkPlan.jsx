// Tragwerk-Plan im Statik-Tab (Phase 40, TRAG-01…05): Rohbau-Grundriss (BimPlan2D readOnly, nur
// Hülle/Wände/Stützen) mit Lasteinzugsflächen der echten Stützen, Träger zeichnen/ziehen/löschen,
// expliziter Berechnungslauf mit Ergebnistabelle je Stütze und Träger.
//
// In:  Konzept-Eingaben des Statik-Panels aus dem usePanelState-Cache (gk, Δg, qk, Betongüte,
//      Tragsystem, Spannweite), usePlanModel (Footprint, customColumns/-Walls/-Windows, storeys),
//      Fachlayer `statik_layer` (useFachlayer, KD-17).
// Out: Rendering + Verdrahtung; jede Zahl kommt aus @designer/lib/tragwerkPlan (Kern statics.js).

import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Layers, Move, PenTool, Play, Trash2, AlertTriangle, Undo2 } from "lucide-react";
import { NumberField } from "@core/components/Field";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { usePanelState } from "@core/lib/usePanelState";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { LOAD_CATEGORIES, betonFcd } from "@designer/lib/statics";
import {
  STATIK_LAYER_DEFAULT, LASTEINZUG_RASTER_ANZEIGE_M, AUSLASTUNG_WARN,
  layerHardened, stuetzenImLevel, neuerTraeger, verschiebeTraegerPunkt, aendereTraeger, loescheTraeger,
  lasteinzug, eingabenHash, berechnung, tragwerkChecks,
} from "@designer/lib/tragwerkPlan";
import BimPlan2D from "./BimPlan2D";

const T_STATUS = { ...STATUS_STYLE, offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" } };
// Colour per column for the load take-down cells (cycled).
const PALETTE = ["#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#6366f1"];
const de = (n, d = 0) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const geschoss = (lvl, t) => (lvl === 0 ? t("EG") : `${lvl}. ${t("OG")}`);
const ROHBAU_LAYER = { zones: false, labels: false, dimensions: false, openings: false };

/**
 * Tragwerk-Plan — propless; liest Projekt, Plan und die Konzeptwerte des Statik-Panels selbst.
 */
export default function TragwerkPlan() {
  const { t } = useI18n();
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const [rawLayer, setLayer] = useFachlayer(project?.id, "statik_layer", STATIK_LAYER_DEFAULT);
  const layer = useMemo(() => layerHardened(rawLayer), [rawLayer]);
  const setL = (fn) => setLayer((l) => layerHardened(typeof fn === "function" ? fn(layerHardened(l)) : fn));

  // Concept inputs of the panel (same defaults as StaticsPlanner so an unopened panel yields its values).
  const [gk] = usePanelState("statics:gk", 5.0);
  const [dg] = usePanelState("statics:dg", 1.5);
  const [qk] = usePanelState("statics:qk", LOAD_CATEGORIES.A.qk);
  const [betonguete] = usePanelState("statics:betonguete", "C25/30");
  const [tragsystem] = usePanelState("statics:tragsystem", "Skelettbau (Stützen/Riegel)");
  const [spannweite] = usePanelState("statics:spannweite", 14);
  const qFlaeche = (Number(gk) || 0) + (Number(dg) || 0) + (Number(qk) || 0);
  const fcd = betonFcd(betonguete);

  const storeys = Math.max(1, Math.round(plan?.storeys || 1));
  const [level, setLevel] = useState(0);
  const lvl = Math.min(level, storeys - 1);
  const [werkzeug, setWerkzeug] = useState("auswahl"); // auswahl | traeger
  const [draft, setDraft] = useState(null);           // first beam point {x,z}
  const [sel, setSel] = useState(null);               // beam id
  const [einzugsbreite, setEinzugsbreite] = useState(5.0);

  const footprint = plan?.model?.footprint || [];
  const stuetzen = plan?.customColumns || [];
  const hier = useMemo(() => stuetzenImLevel(stuetzen, lvl), [stuetzen, lvl]);
  const traegerHier = layer.traeger.filter((tr) => tr.level === lvl);
  const ez = useMemo(() => lasteinzug(footprint, hier, LASTEINZUG_RASTER_ANZEIGE_M), [footprint, hier]);
  const farbe = (idx) => PALETTE[Math.max(0, hier.findIndex((c) => (c._idx ?? hier.indexOf(c)) === idx)) % PALETTE.length];

  // Result of the last run — only shown for its storey; stale when inputs changed since.
  const ergebnis = layer.ergebnis && layer.ergebnis.level === lvl ? layer.ergebnis : null;
  const hashJetzt = useMemo(
    () => eingabenHash({ footprint, stuetzen, traeger: layer.traeger, level: lvl, storeys, qFlaeche, fcd, tragsystem, spannweite }),
    [footprint, stuetzen, layer.traeger, lvl, storeys, qFlaeche, fcd, tragsystem, spannweite],
  );
  const veraltet = !!ergebnis && ergebnis.hash !== hashJetzt;
  const checks = ergebnis ? ergebnis.checks : tragwerkChecks({ stuetzen: [], traeger: [], tragsystem, spannweite });
  const ergebnisJe = new Map((ergebnis?.stuetzen || []).map((s) => [s.idx, s]));
  const selTraeger = sel ? layer.traeger.find((tr) => tr.id === sel) || null : null;

  const rechnen = () => setL((l) => ({ ...l, ergebnis: berechnung({ layer: l, footprint, stuetzen, level: lvl, storeys, qFlaeche, fcd, tragsystem, spannweite }) }));
  const klick = (p) => {
    if (werkzeug !== "traeger") return;
    if (!draft) { setDraft(p); return; }
    setL((l) => neuerTraeger(l, { level: lvl, a: draft, b: p, stuetzen, einzugsbreite_m: einzugsbreite }).layer);
    setDraft(null);
  };
  const loeschen = () => { if (sel) { setL((l) => loescheTraeger(l, sel)); setSel(null); } };
  const toMetersRef = useRef(null);
  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => { const p = toMetersRef.current?.(e); if (p) setL((l) => verschiebeTraegerPunkt(l, d.id, d.ende, p, stuetzen)); },
    onTap: (d) => setSel(d.id),
  });

  if (!plan?.model) return null;

  return (
    <Card data-testid="tw-plan">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4" /> {t("Tragwerk auf dem Grundriss")} <span className="text-xs font-normal text-slate-400">{t("Vorbemessung, kein Nachweis")}</span></CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            <Select value={String(lvl)} onValueChange={(v) => { setLevel(+v); setDraft(null); setSel(null); }}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="tw-level"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: storeys }, (_, i) => <SelectItem key={i} value={String(i)}>{geschoss(i, t)}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant={werkzeug === "auswahl" ? "default" : "outline"} onClick={() => { setWerkzeug("auswahl"); setDraft(null); }} data-testid="tw-tool-auswahl"><Move className="w-3.5 h-3.5 mr-1" /> {t("Auswahl")}</Button>
            <Button size="sm" variant={werkzeug === "traeger" ? "default" : "outline"} onClick={() => { setWerkzeug("traeger"); setSel(null); }} data-testid="tw-tool-traeger"><PenTool className="w-3.5 h-3.5 mr-1" /> {t("Träger")}</Button>
            {draft && <Button size="sm" variant="ghost" onClick={() => setDraft(null)} aria-label={t("Startpunkt verwerfen")}><Undo2 className="w-4 h-4" /></Button>}
            <Button size="sm" onClick={rechnen} disabled={!hier.length && !traegerHier.length} data-testid="tw-berechnen"><Play className="w-3.5 h-3.5 mr-1" /> {t("Berechnung ausführen")}</Button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {werkzeug === "traeger"
            ? t("Zwei Klicks setzen einen Träger; Endpunkte fangen auf Stützen (0,6 m). Einzugsbreite unten einstellen.")
            : t("Rohbau aus dem Gebäudemodell (Hülle, Wände, Stützen). Farbflächen = Lasteinzug je Stütze (Rasterzuordnung). Träger anklicken, Endpunkte ziehen, Entf löscht.")}
          {" "}{t("Lasten")}: {de(qFlaeche, 1)} kN/m² · fcd {de(fcd / 1000, 1)} N/mm² · {tragsystem}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div tabIndex={0} className="outline-none" onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); loeschen(); } if (e.key === "Escape") { setDraft(null); setSel(null); } }}>
          <BimPlan2D
            model={plan.model}
            mode="grundriss"
            level={lvl}
            storeyHeight={plan.storeyHeight}
            readOnly
            layerVis={ROHBAU_LAYER}
            envOpenings={plan.envOpenings}
            elements={{ customWalls: plan.customWalls, customColumns: plan.customColumns, customWindows: plan.customWindows }}
            unit={plan.unit}
            height={440}
            overlayBounds={[...traegerHier.flatMap((tr) => [tr.a, tr.b]), ...(draft ? [draft] : [])]}
            overlay={({ X, Z, SCALE, toMeters, bounds }) => {
              toMetersRef.current = toMeters;
              const zeichnen = werkzeug === "traeger";
              const pe = zeichnen ? "none" : "auto";
              const r = LASTEINZUG_RASTER_ANZEIGE_M;
              return (
                <g data-testid="tw-overlay">
                  {/* Lasteinzug cells (drawing raster 1,0 m) */}
                  <g style={{ pointerEvents: "none" }}>
                    {ez.zellen.map((z, i) => (
                      <rect key={i} data-testid="tw-zelle" x={X(z.x - r / 2)} y={Z(z.z - r / 2)} width={r * SCALE} height={r * SCALE} fill={farbe(z.idx)} fillOpacity="0.22" />
                    ))}
                  </g>
                  {/* Träger */}
                  {traegerHier.map((tr) => {
                    const e = ergebnis?.traeger?.find((x) => x.id === tr.id);
                    const L = Math.hypot(tr.b.x - tr.a.x, tr.b.z - tr.a.z);
                    const istSel = sel === tr.id;
                    const mx = (tr.a.x + tr.b.x) / 2, mz = (tr.a.z + tr.b.z) / 2;
                    return (
                      <g key={tr.id} data-testid="tw-traeger" data-id={tr.id} data-len={L.toFixed(2)} data-h={e ? e.h_m : ""} style={{ pointerEvents: pe, cursor: zeichnen ? "inherit" : "pointer" }}
                        onClick={(ev) => { if (!zeichnen) { ev.stopPropagation(); setSel(tr.id); } }}>
                        <line x1={X(tr.a.x)} y1={Z(tr.a.z)} x2={X(tr.b.x)} y2={Z(tr.b.z)} stroke="transparent" strokeWidth="12" />
                        <line x1={X(tr.a.x)} y1={Z(tr.a.z)} x2={X(tr.b.x)} y2={Z(tr.b.z)} stroke={istSel ? "#0f172a" : "#334155"} strokeWidth={Math.max(3, tr.breite_m * SCALE)} strokeLinecap="square" opacity="0.85" />
                        <text x={X(mx)} y={Z(mz) - 6} textAnchor="middle" fontSize="8" fontWeight="600" fill="#0f172a" style={{ pointerEvents: "none" }}>
                          {e ? `h ${de(e.h_m * 100)} cm · M ${de(e.M_kNm)} kNm` : `L ${de(L, 1)} m`}
                        </text>
                        {!zeichnen && ["a", "b"].map((ende) => (
                          <circle key={ende} cx={X(tr[ende].x)} cy={Z(tr[ende].z)} r="5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" style={{ cursor: "move" }}
                            onPointerDown={(ev) => { if (ev.button !== 0) return; ev.stopPropagation(); setSel(tr.id); startDrag(ev, { id: tr.id, ende }); }} />
                        ))}
                      </g>
                    );
                  })}
                  {/* Stützen with labels */}
                  {ez.flaechen.map((f) => {
                    const e = ergebnisJe.get(f.idx);
                    const col = farbe(f.idx);
                    const rr = Math.max(5, (f.size * SCALE) / 2 + 3);
                    const warn = e && e.auslastung != null && e.auslastung > AUSLASTUNG_WARN;
                    return (
                      <g key={f.idx} data-testid="tw-stuetze" data-idx={f.idx} data-m2={f.flaeche_m2} data-auslastung={e?.auslastung ?? ""} style={{ pointerEvents: "none" }}>
                        <circle cx={X(f.x)} cy={Z(f.z)} r={rr} fill={warn ? "#fee2e2" : "#fff"} stroke={warn ? "#dc2626" : col} strokeWidth="2" />
                        <text x={X(f.x)} y={Z(f.z) + rr + 8} textAnchor="middle" fontSize="7.5" fontWeight="600" fill={warn ? "#b91c1c" : "#1e293b"}>
                          {e ? `N ${de(e.N_kN)} kN` : `A ${de(f.flaeche_m2)} m²`}
                        </text>
                        {e && e.Ac_erf_cm2 != null && (
                          <text x={X(f.x)} y={Z(f.z) + rr + 16} textAnchor="middle" fontSize="7" fill={warn ? "#b91c1c" : "#475569"}>
                            A_c {de(e.Ac_erf_cm2)}/{de(e.Ac_vorh_cm2)} cm²{warn ? " !" : ""}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {/* Draft start */}
                  {draft && <circle cx={X(draft.x)} cy={Z(draft.z)} r="4" fill="#d97706" style={{ pointerEvents: "none" }} />}
                  {/* Klick-Fläche im Werkzeug Träger */}
                  {zeichnen && (
                    <rect x="0" y="0" width={X(bounds.maxX) + X(bounds.minX)} height={Z(bounds.maxZ) + Z(bounds.minZ)} fill="transparent" style={{ cursor: "crosshair" }}
                      onClick={(e) => { const p = toMeters(e); if (p) klick(p); }} />
                  )}
                </g>
              );
            }}
          />
        </div>

        {/* Legende + Träger-Attribute */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span>{hier.length} {t("Stützen im Geschoss")} · {t("Lasteinzug je Farbe")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 h-1.5 bg-slate-700" /> {t("Träger")}</span>
          {werkzeug === "traeger" && (
            <span className="inline-flex items-center gap-2"><span>{t("Einzugsbreite neuer Träger")}</span>
              <span className="w-28"><NumberField label="" suffix="m" min={0.5} step="0.5" value={einzugsbreite} onChange={(v) => setEinzugsbreite(Math.max(0.5, v))} /></span>
            </span>
          )}
        </div>

        {selTraeger && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs" data-testid="tw-auswahl">
            <span>{t("Träger")} {selTraeger.id} · {de(Math.hypot(selTraeger.b.x - selTraeger.a.x, selTraeger.b.z - selTraeger.a.z), 2)} m · {selTraeger.vonIdx != null && selTraeger.nachIdx != null ? t("beidseitig auf Stützen") : t("freies Ende")}</span>
            <span className="inline-flex items-center gap-1">{t("Einzugsbreite")}
              <span className="w-24"><NumberField label="" suffix="m" min={0.5} step="0.5" value={selTraeger.einzugsbreite_m} onChange={(v) => setL((l) => aendereTraeger(l, selTraeger.id, { einzugsbreite_m: Math.max(0.5, v) }))} /></span>
            </span>
            <Button size="sm" variant="outline" className="h-7 text-red-600 ml-auto" onClick={loeschen} data-testid="tw-loeschen"><Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}</Button>
          </div>
        )}

        {/* Checks */}
        <div className="flex flex-wrap items-center gap-1" data-testid="tw-checks">
          {checks.map((c) => { const st = T_STATUS[c.status] || T_STATUS.offen; return <Badge key={c.key} className={st.color} title={c.detail} data-status={c.status}>{c.label}: {st.label}</Badge>; })}
          {veraltet && <Badge className="bg-amber-100 text-amber-800" data-testid="tw-veraltet">{t("Ergebnis veraltet — Eingaben geändert, neu rechnen")}</Badge>}
        </div>

        {/* Ergebnistabelle */}
        {ergebnis ? (
          <div className="space-y-2" data-testid="tw-tabelle" data-stand={ergebnis.stand}>
            <div className="text-xs text-slate-500">{t("Berechnungslauf")} {new Date(ergebnis.stand).toLocaleString("de-DE")} · {geschoss(ergebnis.level, t)} · q {de(ergebnis.qFlaeche_kNm2, 1)} kN/m² · Σ N {de(ergebnis.summeN_kN)} kN</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr><th className="text-left font-medium">{t("Stütze")}</th><th className="text-right font-medium">x / z (m)</th><th className="text-right font-medium">A_i (m²)</th><th className="text-right font-medium">{t("Geschosse")}</th><th className="text-right font-medium">N (kN)</th><th className="text-right font-medium">A_c erf. (cm²)</th><th className="text-right font-medium">A_c vorh. (cm²)</th><th className="text-right font-medium">{t("Auslastung")}</th><th className="text-left font-medium">Status</th></tr>
                </thead>
                <tbody>
                  {ergebnis.stuetzen.map((s) => { const st = T_STATUS[s.status] || T_STATUS.offen; return (
                    <tr key={s.idx} className="border-t" data-testid="tw-zeile" data-idx={s.idx} data-auslastung={s.auslastung ?? ""}>
                      <td className="py-0.5 text-slate-700">#{s.idx}</td>
                      <td className="text-right">{de(s.x, 2)} / {de(s.z, 2)}</td>
                      <td className="text-right">{de(s.einzug_m2, 1)}</td>
                      <td className="text-right">{s.geschosse}</td>
                      <td className="text-right font-medium">{de(s.N_kN)}</td>
                      <td className="text-right">{s.Ac_erf_cm2 == null ? "—" : de(s.Ac_erf_cm2)}</td>
                      <td className="text-right">{de(s.Ac_vorh_cm2)}</td>
                      <td className="text-right">{s.auslastung == null ? "—" : `${de(s.auslastung * 100)} %`}</td>
                      <td><Badge className={st.color}>{st.label}</Badge></td>
                    </tr>
                  ); })}
                  {ergebnis.stuetzen.length === 0 && <tr><td colSpan={9} className="py-1 text-slate-400">{t("Keine Stützen in diesem Geschoss.")}</td></tr>}
                </tbody>
              </table>
            </div>
            {ergebnis.traeger.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr><th className="text-left font-medium">{t("Träger")}</th><th className="text-right font-medium">L (m)</th><th className="text-right font-medium">q (kN/m)</th><th className="text-right font-medium">h (cm)</th><th className="text-right font-medium">M_Ed (kNm)</th><th className="text-right font-medium">V_Ed (kN)</th><th className="text-left font-medium">{t("Lager")}</th></tr>
                  </thead>
                  <tbody>
                    {ergebnis.traeger.map((tr) => (
                      <tr key={tr.id} className="border-t" data-testid="tw-traeger-zeile" data-id={tr.id}>
                        <td className="py-0.5 text-slate-700">{tr.id}</td><td className="text-right">{de(tr.L_m, 2)}</td><td className="text-right">{de(tr.qLin_kNm, 1)}</td>
                        <td className="text-right font-medium">{de(tr.h_m * 100)}</td><td className="text-right">{de(tr.M_kNm, 1)}</td><td className="text-right">{de(tr.V_kN, 1)}</td>
                        <td>{tr.angeschlossen ? t("beidseitig Stütze") : <span className="text-amber-700">{t("freies Ende")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400" data-testid="tw-kein-ergebnis">{t("Noch kein Berechnungslauf für dieses Geschoss — „Berechnung ausführen“.")}</p>
        )}

        {/* Träger-Liste */}
        {layer.traeger.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="tw-liste-traeger">
            {layer.traeger.map((tr) => (
              <button key={tr.id} type="button" data-id={tr.id} onClick={() => { setLevel(tr.level); setWerkzeug("auswahl"); setSel(tr.id); }}
                className={`rounded border px-2 py-0.5 text-[11px] ${sel === tr.id ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {tr.id} · {geschoss(tr.level, t)} · {de(Math.hypot(tr.b.x - tr.a.x, tr.b.z - tr.a.z), 1)} m
              </button>
            ))}
          </div>
        )}
        <div className="flex items-start gap-1.5 text-[11px] text-slate-500 border-t pt-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
          {t("Lasteinzug als Rasterzuordnung, Stützen tragen die Geschosse über ihnen (Skelettbau), Träger h ≈ L/12 — Richtwerte, kein Standsicherheitsnachweis.")}
        </div>
      </CardContent>
    </Card>
  );
}
