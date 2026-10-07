// Brandschutz-Plan-Editor (Phase 38, BSP-01…04) — successor of FluchtwegPlan (Phase 34 example
// layer): one readOnly BimPlan2D with four tools on top — Auswahl, Fluchtweg (as before),
// Brandabschnitt (polygon with red hatch), Symbol (DIN 14034-6 approximations) — plus the
// detector grid overlay. Persisted in the exclusive BimModel field `brandschutz_layer` (KD-17).
//
// In:  maxFluchtweg (m, from the panel), onUebernehmen(len) — hands the longest route to the panel;
//      reads plan/zones/footprint via usePlanModel, flaecheJeMelder from the panel's usePanelState cache.
// Out: rendering and wiring only; every rule lives in @designer/lib/brandschutzPlan and fire.js.

import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Route, PenTool, Check, Undo2, Trash2, Move, Flame, Plus, ScanLine, FileDown } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { usePanelState } from "@core/lib/usePanelState";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { polygonAreaM } from "@core/lib/useBuildingProgram";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { fluchtwegLaenge, melderAnzahl, DEFAULT_FLAECHE_JE_MELDER } from "@designer/lib/fire";
import {
  SYMBOLE_DIN14034, SYMBOL_KATALOG, LAYER_DEFAULT, PLAN_FARBEN, BRANDABSCHNITT_MAX_M2,
  layerHardened, neuerAbschnitt, neuesSymbol, verschiebeSymbol, loescheElement, setzeMelder,
  brandabschnittFlaeche, melderRaster, symbolLegende, brandschutzPlanChecks,
} from "@designer/lib/brandschutzPlan";
import { svgZuPng, feuerwehrplanPdf } from "@designer/lib/feuerwehrplanPdf";
import BimPlan2D from "./BimPlan2D";
import KatalogPanel from "./KatalogPanel";
import FeuerwehrSymbol, { SymbolLegende } from "./FeuerwehrSymbol";

const B_STATUS = { ...STATUS_STYLE, offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" } };
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const de0 = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const geschoss = (lvl, t) => (lvl === 0 ? t("EG") : `${lvl}. ${t("OG")}`);
const centroid = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });

/**
 * @param {{ maxFluchtweg: number, onUebernehmen?: (len: number) => void, pdfKnopf?: React.ReactNode }} p
 *   pdfKnopf: optional action rendered in the header (38-03 hands in the Feuerwehrplan button)
 */
export default function BrandschutzPlanEditor({ maxFluchtweg, onUebernehmen, pdfKnopf = null }) {
  const { t } = useI18n();
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const [rawLayer, setLayer] = useFachlayer(project?.id, "brandschutz_layer", LAYER_DEFAULT);
  const layer = useMemo(() => layerHardened(rawLayer), [rawLayer]);
  const setL = (fn) => setLayer((l) => layerHardened(typeof fn === "function" ? fn(layerHardened(l)) : fn));
  const [flaecheJeMelderPanel] = usePanelState("brandschutz:flaecheJeMelder", DEFAULT_FLAECHE_JE_MELDER);
  const flaecheJeMelder = layer.melder.flaecheJeMelder ?? flaecheJeMelderPanel;

  const storeys = Math.max(1, Math.round(plan?.storeys || 1));
  const [level, setLevel] = useState(0);
  const lvl = Math.min(level, storeys - 1);
  const [werkzeug, setWerkzeug] = useState("auswahl"); // auswahl | fluchtweg | brandabschnitt | symbol
  const [symbolTyp, setSymbolTyp] = useState("feuerloescher");
  const [draft, setDraft] = useState([]); // [{x,z}] for fluchtweg / brandabschnitt
  const [sel, setSel] = useState(null);   // { art: "fluchtweg"|"brandabschnitt"|"symbol", id }

  const footprint = plan?.model?.footprint || [];
  const wegeHier = layer.fluchtwege.filter((f) => f.level === lvl);
  const abschnitteHier = layer.brandabschnitte.filter((b) => b.level === lvl);
  const symboleHier = layer.symbole.filter((s) => s.level === lvl);
  const melderPunkte = useMemo(() => (layer.melder.aktiv ? melderRaster(footprint, flaecheJeMelder) : []), [layer.melder.aktiv, footprint, flaecheJeMelder]);
  const laengster = layer.fluchtwege.reduce((s, f) => Math.max(s, fluchtwegLaenge(f.points)), 0);
  const checks = useMemo(() => brandschutzPlanChecks(layer, { footprint, level: lvl, maxFluchtweg, flaecheJeMelder }), [layer, footprint, lvl, maxFluchtweg, flaecheJeMelder]);
  const legende = useMemo(() => symbolLegende(layer, lvl), [layer, lvl]);
  const selObj = sel
    ? (sel.art === "fluchtweg" ? layer.fluchtwege : sel.art === "brandabschnitt" ? layer.brandabschnitte : layer.symbole).find((e) => e.id === sel.id) || null
    : null;

  // ---- editing ----
  const wechsleWerkzeug = (w) => { setWerkzeug(w); setDraft([]); if (w !== "auswahl") setSel(null); };
  const klick = (p) => {
    if (werkzeug === "symbol") {
      setL((l) => neuesSymbol(l, { level: lvl, typ: symbolTyp, x: p.x, z: p.z }).layer);
      return;
    }
    if (werkzeug === "fluchtweg" || werkzeug === "brandabschnitt") setDraft((d) => [...d, p]);
  };
  const abschliessen = () => {
    if (werkzeug === "fluchtweg" && draft.length >= 2) {
      setL((l) => ({ ...l, fluchtwege: [...l.fluchtwege, { id: `fw_${l.fluchtwege.length + 1}_${draft.length}`, level: lvl, points: draft }] }));
    }
    if (werkzeug === "brandabschnitt" && draft.length >= 3) {
      setL((l) => neuerAbschnitt(l, { level: lvl, points: draft }).layer);
    }
    setDraft([]);
  };
  const loeschen = () => {
    if (!sel) return;
    setL((l) => loescheElement(l, sel.art, sel.id));
    setSel(null);
  };
  const toMetersRef = useRef(null);
  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => { const p = toMetersRef.current?.(e); if (p) setL((l) => verschiebeSymbol(l, d.id, p)); },
    onTap: (d) => setSel({ art: "symbol", id: d.id }),
  });

  // Feuerwehrplan (BSP-05): the editor's own plan SVG (selection cleared) → PNG → A4-quer sheet.
  const planRef = useRef(null);
  const [pdfStatus, setPdfStatus] = useState("");
  const exportPdf = async () => {
    setSel(null); setDraft([]);
    await new Promise((r) => setTimeout(r, 50)); // let React repaint without selection frames
    const svg = planRef.current?.querySelector("svg");
    if (!svg) { setPdfStatus(t("Keine Zeichnung gefunden.")); return; }
    try {
      setPdfStatus(t("PDF wird erzeugt …"));
      // scale 2 ≈ 1.100 px on A4 quer — scale 3 gab 4,9 MB je Blatt bei kaum sichtbarem Gewinn
      const png = await svgZuPng(svg, 2);
      const legendeZeilen = [
        { farbe: PLAN_FARBEN.fluchtweg, label: t("Fluchtweg"), anzahl: wegeHier.length, art: "linie" },
        { farbe: PLAN_FARBEN.brandabschnitt, label: t("Brandabschnitt (Schraffur)"), anzahl: abschnitteHier.length, art: "flaeche" },
        ...(layer.melder.aktiv ? [{ farbe: PLAN_FARBEN.melder, label: `${t("Melder-Raster")} (${de0(flaecheJeMelder)} m²/Melder)`, anzahl: melderPunkte.length, art: "punkt" }] : []),
        ...legende.map((l) => ({ farbe: l.farbe, label: `${l.label} — ${SYMBOLE_DIN14034[l.typ].kurz}`, anzahl: l.anzahl, art: "symbol" })),
      ];
      const hinweise = checks.filter((c) => c.status === "warn").map((c) => `${c.label}: ${c.detail}`);
      const r = await feuerwehrplanPdf({
        png, projekt: project?.name || "BIT-Atelier", geschoss: geschoss(lvl, t),
        datum: new Date().toLocaleDateString("de-DE"), legende: legendeZeilen, hinweise,
      });
      setPdfStatus(`${t("PDF erzeugt")}: ${r.dateiname} (${r.seiten} ${t("Seite")})`);
    } catch (e) {
      setPdfStatus(`${t("PDF fehlgeschlagen")}: ${e?.message || e}`);
    }
  };

  if (!plan?.model) return null;
  const mindestPunkte = werkzeug === "brandabschnitt" ? 3 : 2;

  return (
    <Card data-testid="bs-editor">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Flame className="w-4 h-4" /> {t("Brandschutz-Plan")}</CardTitle>
          <div className="flex items-center gap-1">
            <Select value={String(lvl)} onValueChange={(v) => { setLevel(+v); setDraft([]); setSel(null); }}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="bs-level"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: storeys }, (_, i) => <SelectItem key={i} value={String(i)}>{geschoss(i, t)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={exportPdf} data-testid="bs-pdf" title={t("Feuerwehrplan als PDF (A4 quer, Konzeptblatt nach DIN 14095)")}>
              <FileDown className="w-3.5 h-3.5 mr-1" /> {t("Feuerwehrplan (PDF)")}
            </Button>
            {pdfKnopf}
          </div>
        </div>
        {pdfStatus && <p className="text-[11px] text-slate-500 mt-1" data-testid="bs-pdf-status">{pdfStatus}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Button size="sm" variant={werkzeug === "auswahl" ? "default" : "outline"} onClick={() => wechsleWerkzeug("auswahl")} data-testid="bs-tool-auswahl"><Move className="w-3.5 h-3.5 mr-1" /> {t("Auswahl")}</Button>
          <Button size="sm" variant={werkzeug === "fluchtweg" ? "default" : "outline"} onClick={() => wechsleWerkzeug("fluchtweg")} data-testid="bs-tool-fluchtweg"><Route className="w-3.5 h-3.5 mr-1" /> {t("Fluchtweg")}</Button>
          <Button size="sm" variant={werkzeug === "brandabschnitt" ? "default" : "outline"} onClick={() => wechsleWerkzeug("brandabschnitt")} data-testid="bs-tool-brandabschnitt"><PenTool className="w-3.5 h-3.5 mr-1" /> {t("Brandabschnitt")}</Button>
          <Button size="sm" variant={werkzeug === "symbol" ? "default" : "outline"} onClick={() => wechsleWerkzeug("symbol")} data-testid="bs-tool-symbol"><Plus className="w-3.5 h-3.5 mr-1" /> {t("Symbol")}</Button>
          <Button size="sm" variant={layer.melder.aktiv ? "default" : "outline"} onClick={() => setL((l) => setzeMelder(l, { aktiv: !l.melder.aktiv }))} data-testid="bs-melder-toggle" title={t("Melder-Raster aus melderAnzahl() — Überschlag")}>
            <ScanLine className="w-3.5 h-3.5 mr-1" /> {t("Melder-Raster")}{layer.melder.aktiv ? ` (${melderPunkte.length})` : ""}
          </Button>
          {(werkzeug === "fluchtweg" || werkzeug === "brandabschnitt") && draft.length > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))} aria-label={t("Letzten Punkt entfernen")}><Undo2 className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="text-emerald-700" onClick={abschliessen} disabled={draft.length < mindestPunkte} data-testid="bs-abschliessen"><Check className="w-4 h-4 mr-1" /> {t("Abschließen")}</Button>
            </>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {werkzeug === "fluchtweg" && t("Klicke den Weg vom entferntesten Aufenthaltsort bis zum Ausgang/Treppenraum (0,25-m-Raster), dann Abschließen.")}
          {werkzeug === "brandabschnitt" && t("Klicke die Ecken des Brandabschnitts (mindestens drei), dann Abschließen — rote Schraffur, Fläche gegen 1.600 m² (MBO § 30, Richtwert).")}
          {werkzeug === "symbol" && t("Symbol im Katalog wählen, dann in den Plan klicken. Schematische Zeichen nach DIN 14034-6 [ASSUMED].")}
          {werkzeug === "auswahl" && t("Elemente anklicken; Symbole ziehen; Entf löscht. Grundriss aus dem Gebäudemodell (read-only), alles im Projekt gespeichert.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className={werkzeug === "symbol" ? "grid lg:grid-cols-[1fr_200px] gap-3" : ""}>
          <div ref={planRef} tabIndex={0} className="outline-none" onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); loeschen(); } if (e.key === "Escape") { setDraft([]); setSel(null); } }}>
            <BimPlan2D
              model={plan.model}
              mode="grundriss"
              level={lvl}
              storeyHeight={plan.storeyHeight}
              readOnly
              customZones={plan.zones}
              envOpenings={plan.envOpenings}
              elements={{ customWalls: plan.customWalls, customColumns: plan.customColumns, customWindows: plan.customWindows }}
              unit={plan.unit}
              height={440}
              overlayBounds={[...wegeHier.flatMap((f) => f.points), ...abschnitteHier.flatMap((b) => b.points), ...symboleHier.map((s) => ({ x: s.x, z: s.z })), ...draft]}
              overlay={({ X, Z, SCALE, toMeters, bounds }) => {
                toMetersRef.current = toMeters;
                const zeichnen = werkzeug !== "auswahl";
                const pe = zeichnen ? "none" : "auto"; // drawing tools: children must not swallow the click (41-02 lesson)
                const symSize = Math.max(10, SCALE * 0.9);
                return (
                  <g data-testid="bs-overlay">
                    <defs>
                      <pattern id="bs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="6" stroke={PLAN_FARBEN.brandabschnitt} strokeWidth="1.2" />
                      </pattern>
                    </defs>
                    {/* Brandabschnitte — rote Schraffur, Name + Fläche */}
                    {abschnitteHier.map((b) => {
                      const c = centroid(b.points);
                      const m2 = brandabschnittFlaeche(b.points);
                      const istSel = sel?.art === "brandabschnitt" && sel.id === b.id;
                      return (
                        <g key={b.id} data-testid="bs-abschnitt" data-id={b.id} data-m2={m2.toFixed(1)} style={{ pointerEvents: pe, cursor: zeichnen ? "inherit" : "pointer" }}
                          onClick={(e) => { if (!zeichnen) { e.stopPropagation(); setSel({ art: "brandabschnitt", id: b.id }); } }}>
                          <polygon points={b.points.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")} fill="url(#bs-hatch)" fillOpacity="0.9"
                            stroke={PLAN_FARBEN.brandabschnitt} strokeWidth={istSel ? 2.4 : 1.4} strokeDasharray={m2 > BRANDABSCHNITT_MAX_M2 ? "6 3" : undefined} />
                          <text x={X(c.x)} y={Z(c.z)} textAnchor="middle" fontSize="8" fontWeight="600" fill="#7f1d1d" style={{ pointerEvents: "none" }}>
                            {b.name}<tspan x={X(c.x)} dy="9" fontSize="7" fontWeight="400">{de0(m2)} m²{m2 > BRANDABSCHNITT_MAX_M2 ? " !" : ""}</tspan>
                          </text>
                        </g>
                      );
                    })}
                    {/* Melder-Raster */}
                    {melderPunkte.map((p, i) => (
                      <g key={`m${i}`} data-testid="bs-melder" style={{ pointerEvents: "none" }}>
                        <circle cx={X(p.x)} cy={Z(p.z)} r={Math.max(2.5, SCALE * 0.22)} fill={PLAN_FARBEN.melder} fillOpacity="0.35" stroke={PLAN_FARBEN.melder} strokeWidth="1" />
                        <circle cx={X(p.x)} cy={Z(p.z)} r="1.2" fill={PLAN_FARBEN.melder} />
                      </g>
                    ))}
                    {/* Fluchtwege (Bestand): grün, zu lang rot, Länge am Ende */}
                    {wegeHier.map((f) => {
                      const len = fluchtwegLaenge(f.points);
                      const zuLang = maxFluchtweg > 0 && len > maxFluchtweg;
                      const farbe = zuLang ? PLAN_FARBEN.fluchtwegZuLang : PLAN_FARBEN.fluchtweg;
                      const last = f.points[f.points.length - 1];
                      const istSel = sel?.art === "fluchtweg" && sel.id === f.id;
                      const pts = f.points.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
                      return (
                        <g key={f.id} data-testid="bs-fluchtweg" data-id={f.id} data-len={len.toFixed(2)} style={{ pointerEvents: pe, cursor: zeichnen ? "inherit" : "pointer" }}
                          onClick={(e) => { if (!zeichnen) { e.stopPropagation(); setSel({ art: "fluchtweg", id: f.id }); } }}>
                          <polyline points={pts} fill="none" stroke="transparent" strokeWidth="10" />
                          <polyline points={pts} fill="none" stroke={farbe} strokeWidth={istSel ? 3.2 : 2} strokeDasharray="6 3" strokeLinejoin="round" strokeLinecap="round" />
                          {f.points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Z(p.z)} r="2.2" fill={farbe} />)}
                          <text x={X(last.x) + 5} y={Z(last.z) - 4} fontSize="8.5" fontWeight="600" fill={zuLang ? "#dc2626" : "#166534"} style={{ pointerEvents: "none" }}>{de1(len)} m{zuLang ? " !" : ""}</text>
                        </g>
                      );
                    })}
                    {/* Symbole */}
                    {symboleHier.map((s) => {
                      const istSel = sel?.art === "symbol" && sel.id === s.id;
                      return (
                        <g key={s.id} data-testid="bs-symbol" data-id={s.id} data-typ={s.typ} data-x={s.x} data-z={s.z}
                          style={{ pointerEvents: pe, cursor: zeichnen ? "inherit" : "grab" }}
                          onPointerDown={(e) => { if (zeichnen || e.button !== 0) return; e.stopPropagation(); setSel({ art: "symbol", id: s.id }); startDrag(e, { id: s.id }); }}
                          onClick={(e) => { if (!zeichnen) { e.stopPropagation(); setSel({ art: "symbol", id: s.id }); } }}>
                          <circle cx={X(s.x)} cy={Z(s.z)} r={symSize} fill="transparent" />
                          <FeuerwehrSymbol typ={s.typ} x={X(s.x)} y={Z(s.z)} size={symSize} sel={istSel} />
                        </g>
                      );
                    })}
                    {/* Draft (amber) */}
                    {draft.length > 0 && (
                      <g style={{ pointerEvents: "none" }}>
                        {werkzeug === "brandabschnitt"
                          ? <polygon points={draft.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")} fill={PLAN_FARBEN.draft} fillOpacity="0.12" stroke={PLAN_FARBEN.draft} strokeWidth="2" strokeDasharray="4 3" />
                          : <polyline points={draft.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")} fill="none" stroke={PLAN_FARBEN.draft} strokeWidth="2" strokeDasharray="4 3" />}
                        {draft.map((p, i) => <circle key={i} cx={X(p.x)} cy={Z(p.z)} r="2.5" fill={PLAN_FARBEN.draft} />)}
                        {werkzeug === "fluchtweg" && (
                          <text x={X(draft[draft.length - 1].x) + 5} y={Z(draft[draft.length - 1].z) - 4} fontSize="8.5" fontWeight="600" fill="#92400e">{de1(fluchtwegLaenge(draft))} m</text>
                        )}
                        {werkzeug === "brandabschnitt" && draft.length >= 3 && (
                          <text x={X(centroid(draft).x)} y={Z(centroid(draft).z)} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#92400e">{de0(brandabschnittFlaeche(draft))} m²</text>
                        )}
                      </g>
                    )}
                    {/* Klick-Fläche in den Zeichenwerkzeugen */}
                    {zeichnen && (
                      <rect x="0" y="0" width={X(bounds.maxX) + X(bounds.minX)} height={Z(bounds.maxZ) + Z(bounds.minZ)} fill="transparent" style={{ cursor: "crosshair" }}
                        onClick={(e) => { const p = toMeters(e); if (p) klick(p); }}
                        onDoubleClick={(e) => { e.stopPropagation(); abschliessen(); }} />
                    )}
                  </g>
                );
              }}
            />
          </div>
          {werkzeug === "symbol" && (
            <div className="space-y-2 self-start">
              <div className="text-[11px] text-slate-600">{t("Gewählt")}: <b>{SYMBOLE_DIN14034[symbolTyp]?.label}</b></div>
              <KatalogPanel titel={t("Symbole")} katalog={SYMBOL_KATALOG} onAdd={setSymbolTyp}
                chipTitle={(ty) => `${ty.name} — ${ty.norm}`}
                renderChip={(ty) => (
                  <span className={`inline-flex items-center gap-1 ${ty.id === symbolTyp ? "font-semibold text-sky-800" : ""}`} data-testid={`bs-chip-${ty.id}`}>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><FeuerwehrSymbol typ={ty.id} x={7} y={7} size={11} /></svg>{ty.name}
                  </span>
                )} />
            </div>
          )}
        </div>

        {/* Legende */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600" data-testid="bs-legende">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-0 border-t-2 border-dashed" style={{ borderColor: PLAN_FARBEN.fluchtweg }} />{t("Fluchtweg")} (≤ {de0(maxFluchtweg)} m grün, sonst rot)</span>
          <span className="inline-flex items-center gap-1.5"><svg width="16" height="12"><defs><pattern id="bs-hatch-legende" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke={PLAN_FARBEN.brandabschnitt} strokeWidth="1" /></pattern></defs><rect width="16" height="12" fill="url(#bs-hatch-legende)" stroke={PLAN_FARBEN.brandabschnitt} /></svg>{t("Brandabschnitt")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PLAN_FARBEN.melder, opacity: 0.6 }} />{t("Melder-Raster")} ({de0(flaecheJeMelder)} m²/Melder, {t("Überschlag")} {melderAnzahl(polygonAreaM(footprint), flaecheJeMelder)})</span>
          {legende.map((l) => <SymbolLegende key={l.typ} typ={l.typ} anzahl={l.anzahl} />)}
        </div>

        {/* Auswahl */}
        {selObj && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs" data-testid="bs-auswahl">
            {sel.art === "fluchtweg" && <span>{t("Fluchtweg")} · {de1(fluchtwegLaenge(selObj.points))} m · {selObj.points.length} {t("Punkte")}</span>}
            {sel.art === "brandabschnitt" && (
              <>
                <span>{t("Brandabschnitt")} · {de0(brandabschnittFlaeche(selObj.points))} m²</span>
                <Input className="h-7 w-44 text-xs" value={selObj.name} onChange={(e) => setL((l) => ({ ...l, brandabschnitte: l.brandabschnitte.map((b) => (b.id === selObj.id ? { ...b, name: e.target.value } : b)) }))} data-testid="bs-abschnitt-name" />
              </>
            )}
            {sel.art === "symbol" && <span>{SYMBOLE_DIN14034[selObj.typ]?.label} · {SYMBOLE_DIN14034[selObj.typ]?.norm}</span>}
            <Button size="sm" variant="outline" className="h-7 text-red-600 ml-auto" onClick={loeschen} data-testid="bs-loeschen"><Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}</Button>
          </div>
        )}

        {/* Checks */}
        <div className="flex flex-wrap gap-1" data-testid="bs-checks">
          {checks.map((c) => { const st = B_STATUS[c.status] || B_STATUS.offen; return <Badge key={c.key} className={st.color} title={c.detail} data-status={c.status}>{c.label}: {st.label}</Badge>; })}
        </div>

        {/* Listen */}
        <div className="grid md:grid-cols-3 gap-2 text-xs">
          <div className="space-y-1" data-testid="bs-liste-fluchtweg">
            <div className="font-medium text-slate-600">{t("Fluchtwege")} ({layer.fluchtwege.length})</div>
            {layer.fluchtwege.map((f) => { const len = fluchtwegLaenge(f.points); const zuLang = maxFluchtweg > 0 && len > maxFluchtweg; return (
              <button key={f.id} type="button" data-id={f.id} onClick={() => { setLevel(f.level); wechsleWerkzeug("auswahl"); setSel({ art: "fluchtweg", id: f.id }); }}
                className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left ${sel?.id === f.id ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className={zuLang ? "text-red-600 font-medium" : "text-slate-600"}>{geschoss(f.level, t)} · {de1(len)} m{zuLang ? ` — über ${de0(maxFluchtweg)} m!` : ""}</span>
              </button>
            ); })}
            {layer.fluchtwege.length > 0 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500">{t("Längster")}: <b>{de1(laengster)} m</b></span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => onUebernehmen?.(Math.round(laengster))} disabled={!laengster} data-testid="bs-uebernehmen">{t("In Prüfung übernehmen")}</Button>
              </div>
            )}
          </div>
          <div className="space-y-1" data-testid="bs-liste-brandabschnitt">
            <div className="font-medium text-slate-600">{t("Brandabschnitte")} ({layer.brandabschnitte.length})</div>
            {layer.brandabschnitte.map((b) => { const m2 = brandabschnittFlaeche(b.points); return (
              <button key={b.id} type="button" data-id={b.id} onClick={() => { setLevel(b.level); wechsleWerkzeug("auswahl"); setSel({ art: "brandabschnitt", id: b.id }); }}
                className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left ${sel?.id === b.id ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="text-slate-700">{b.name}</span><span className={m2 > BRANDABSCHNITT_MAX_M2 ? "text-red-600 font-medium" : "text-slate-500"}>{geschoss(b.level, t)} · {de0(m2)} m²</span>
              </button>
            ); })}
          </div>
          <div className="space-y-1" data-testid="bs-liste-symbol">
            <div className="font-medium text-slate-600">{t("Symbole")} ({layer.symbole.length})</div>
            {layer.symbole.map((s) => (
              <button key={s.id} type="button" data-id={s.id} onClick={() => { setLevel(s.level); wechsleWerkzeug("auswahl"); setSel({ art: "symbol", id: s.id }); }}
                className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left ${sel?.id === s.id ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <SymbolLegende typ={s.typ} /><span className="ml-auto text-slate-500">{geschoss(s.level, t)}</span>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
