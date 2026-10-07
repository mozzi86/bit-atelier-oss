// Außenanlagen-Editor (Phase 37, GARTEN-01…05): plants from the catalogue and area polygons on the generic
// site plan (LageplanPlan), with climate/light suitability, checks, quantities and the building shadow.
//
// In:  complexData (location, site_parcel), the aussenanlagen_layer owned by LandscapePlanner ({layer, setLayer}),
//      usePlanModel (footprint, storeys), useSiteClimate, useOsmEnvironment.
// Out: rendering + wiring; every number comes from @designer/lib/pflanzen, lageplan, sonnenstand.

import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Trees, Move, Sprout, Hexagon, Check, Undo2, Trash2, Sun, AlertTriangle } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { useSiteClimate } from "@designer/lib/useSiteClimate";
import { useOsmEnvironment } from "@designer/lib/useOsmEnvironment";
import {
  layerHardened, parzelleInMetern, polygonFlaecheM2, neuesElement, verschiebeElement, loescheElement,
  neueFlaeche, verschiebeFlaechenPunkt, aendereFlaeche, loescheFlaeche, flaechenSummen,
} from "@designer/lib/lageplan";
import { sunPosition, sonnenstunden, lichtKlasse, schattenPolygone } from "@designer/lib/sonnenstand";
import {
  PFLANZEN_KATALOG, PFLANZEN_TYPEN, FLAECHEN_ARTEN, klimaAmStandort, eignung, aussenanlagenPlanChecks, pflanzenMengen,
} from "@designer/lib/pflanzen";
import LageplanPlan from "./LageplanPlan";
import KatalogPanel from "./KatalogPanel";

const T_STATUS = { ...STATUS_STYLE, offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" } };
/** Colours per suitability status (plan symbols + badges). */
const EIGNUNG_FARBE = {
  geeignet: { fill: "#4ade80", stroke: "#15803d", badge: "bg-emerald-100 text-emerald-800" },
  bedingt: { fill: "#fcd34d", stroke: "#b45309", badge: "bg-amber-100 text-amber-800" },
  ungeeignet: { fill: "#fca5a5", stroke: "#b91c1c", badge: "bg-red-100 text-red-800" },
  offen: { fill: "#e2e8f0", stroke: "#64748b", badge: "bg-slate-100 text-slate-600" },
};
/** Shadow preview date/time ([ASSUMED] 21 June, 15:00 — long afternoon shadow at the growing peak). */
const SCHATTEN_MONAT = 6, SCHATTEN_STUNDE = 15;
const de = (n, d = 0) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const centroid = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });

/**
 * @param {{ complexData?: any, layer: object, setLayer: (fn: any) => void }} props layer/setLayer = aussenanlagen_layer (owned by LandscapePlanner)
 */
export default function AussenanlagenEditor({ complexData, layer: rawLayer, setLayer }) {
  const { t } = useI18n();
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const layer = useMemo(() => layerHardened(rawLayer), [rawLayer]);
  const setL = (fn) => setLayer((l) => layerHardened(typeof fn === "function" ? fn(layerHardened(l)) : fn));

  const location = complexData?.location || project?.location || null;
  const climate = useSiteClimate(location);
  const osm = useOsmEnvironment(location);
  const klima = useMemo(() => klimaAmStandort(climate), [climate]);
  const parzelleM = useMemo(() => parzelleInMetern(complexData?.site_parcel), [complexData?.site_parcel]);
  const footprint = plan?.model?.footprint || [];
  const hoehe = Math.max(3, (Number(plan?.storeys) || 1) * (Number(plan?.storeyHeight) || 3));
  const lat = Number.isFinite(Number(location?.lat)) ? Number(location.lat) : 49;

  const [werkzeug, setWerkzeug] = useState("auswahl"); // auswahl | pflanze | flaeche
  const [typ, setTyp] = useState("feldahorn");
  const [art, setArt] = useState("gruen");
  const [draft, setDraft] = useState([]);   // area polygon under construction [{x,z}]
  const [sel, setSel] = useState(null);     // { kind: "el"|"fl", id }
  const [schatten, setSchatten] = useState(false);

  // Light class per placed plant from the building shadow (Apr–Sep mean sun hours).
  const lichtJe = useMemo(() => {
    const out = {};
    for (const e of layer.elemente) { const h = sonnenstunden(e, footprint, hoehe, lat); out[e.id] = { stunden: h, klasse: lichtKlasse(h) }; }
    return out;
  }, [layer.elemente, footprint, hoehe, lat]);
  const lichtKlassen = useMemo(() => Object.fromEntries(Object.entries(lichtJe).map(([id, v]) => [id, v.klasse])), [lichtJe]);
  const eignungJe = useMemo(() => Object.fromEntries(layer.elemente.map((e) => [e.id, eignung(e.typ, { klima, licht: lichtKlassen[e.id] })])), [layer.elemente, klima, lichtKlassen]);
  const checks = useMemo(() => aussenanlagenPlanChecks(layer, { footprint, parzelleM, klima, lichtJeElement: lichtKlassen }), [layer, footprint, parzelleM, klima, lichtKlassen]);
  const mengen = useMemo(() => pflanzenMengen(layer), [layer]);
  const summen = useMemo(() => flaechenSummen(layer), [layer]);
  const schattenPolys = useMemo(() => (schatten ? schattenPolygone(footprint, hoehe, sunPosition(lat, SCHATTEN_MONAT, SCHATTEN_STUNDE)) : null), [schatten, footprint, hoehe, lat]);
  const katalogEignung = (ty) => eignung(ty, { klima }).status; // climate only — light is known once placed

  const klick = (p) => {
    if (werkzeug === "pflanze") { setL((l) => neuesElement(l, { typ, x: p.x, z: p.z }).layer); return; }
    if (werkzeug === "flaeche") setDraft((d) => [...d, p]);
  };
  const abschliessen = () => {
    if (draft.length >= 3) setL((l) => neueFlaeche(l, { art, points: draft }).layer);
    setDraft([]);
  };
  const loeschen = () => {
    if (!sel) return;
    setL((l) => (sel.kind === "el" ? loescheElement(l, sel.id) : loescheFlaeche(l, sel.id)));
    setSel(null);
  };
  const toMetersRef = useRef(null);
  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const p = toMetersRef.current?.(e);
      if (!p) return;
      setL((l) => (d.kind === "el" ? verschiebeElement(l, d.id, p) : verschiebeFlaechenPunkt(l, d.id, d.idx, p)));
    },
    onTap: (d) => setSel({ kind: d.kind, id: d.id }),
  });

  if (!plan?.model) return null;
  const zeichnen = werkzeug !== "auswahl";
  const pe = zeichnen ? "none" : "auto";
  const selEl = sel?.kind === "el" ? layer.elemente.find((e) => e.id === sel.id) : null;
  const selFl = sel?.kind === "fl" ? layer.flaechen.find((f) => f.id === sel.id) : null;
  const selTyp = selEl ? PFLANZEN_TYPEN[selEl.typ] : null;

  return (
    <Card data-testid="la-plan">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Trees className="w-4 h-4" /> {t("Lageplan — Außenanlagen")} <span className="text-xs font-normal text-slate-400">{t("Konzept, keine Pflanzplanung")}</span></CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant={werkzeug === "auswahl" ? "default" : "outline"} onClick={() => { setWerkzeug("auswahl"); setDraft([]); }} data-testid="la-tool-auswahl"><Move className="w-3.5 h-3.5 mr-1" /> {t("Auswahl")}</Button>
            <Button size="sm" variant={werkzeug === "pflanze" ? "default" : "outline"} onClick={() => { setWerkzeug("pflanze"); setSel(null); setDraft([]); }} data-testid="la-tool-pflanze"><Sprout className="w-3.5 h-3.5 mr-1" /> {t("Pflanze")}</Button>
            <Button size="sm" variant={werkzeug === "flaeche" ? "default" : "outline"} onClick={() => { setWerkzeug("flaeche"); setSel(null); }} data-testid="la-tool-flaeche"><Hexagon className="w-3.5 h-3.5 mr-1" /> {t("Fläche")}</Button>
            {werkzeug === "flaeche" && (
              <>
                <select value={art} onChange={(e) => setArt(e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" data-testid="la-art" aria-label={t("Flächenart")}>
                  {Object.values(FLAECHEN_ARTEN).map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} aria-label={t("Letzten Punkt entfernen")}><Undo2 className="w-4 h-4" /></Button>
                <Button size="sm" variant="ghost" className="text-emerald-700" onClick={abschliessen} disabled={draft.length < 3} data-testid="la-abschliessen"><Check className="w-4 h-4 mr-1" /> {t("Abschließen")}</Button>
              </>
            )}
            <Button size="sm" variant={schatten ? "default" : "outline"} onClick={() => setSchatten((s) => !s)} data-testid="la-schatten" title={t("Gebäudeschatten 21. Juni 15:00")}><Sun className="w-3.5 h-3.5 mr-1" /> {t("Schatten")}</Button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {werkzeug === "pflanze" && t("Typ im Katalog wählen, dann in den Plan klicken. Kreis = Kronendurchmesser, Farbe = Eignung am Standort (Klima + Licht).")}
          {werkzeug === "flaeche" && t("Ecken der Fläche klicken (mindestens drei), dann Abschließen oder Doppelklick. Grün/Beet zählen als unversiegelt in den Kennzahlen.")}
          {werkzeug === "auswahl" && t("Gebäude grau, Parzelle grün gestrichelt, OSM-Bestandsbäume als Kontext. Pflanzen und Flächenpunkte ziehen, Entf löscht.")}
        </p>
        <div className="flex flex-wrap gap-2 text-[11px]" data-testid="la-klima">
          {klima.offline
            ? <Badge className="bg-slate-100 text-slate-600">{t("Klimadaten offline")}</Badge>
            : <Badge className="bg-sky-100 text-sky-800">{t("Winterhärtezone")} {klima.zone} · T_min ≈ {de(klima.tExtrem, 0)} °C · {de(klima.niederschlag_mm)} mm/a{klima.trocken ? ` · ${t("trocken")}` : ""}</Badge>}
          {osm?.offline && <Badge className="bg-slate-100 text-slate-600">{t("OSM-Kontext offline")}</Badge>}
          {!osm?.offline && osm?.trees?.length > 0 && <Badge className="bg-lime-100 text-lime-800">{osm.trees.length} {t("OSM-Bestandsbäume (Umkreis 300 m)")}</Badge>}
          {!parzelleM && <Badge className="bg-amber-100 text-amber-800" data-testid="la-parzelle-hinweis">{t("Parzelle generisch — im Tab „Standort & Karte“ zeichnen")}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`grid gap-3 ${werkzeug === "pflanze" ? "lg:grid-cols-[1fr_260px]" : ""}`}>
          <div tabIndex={0} className="outline-none" onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); loeschen(); } if (e.key === "Escape") { setDraft([]); setSel(null); } }}>
            <LageplanPlan
              plan={plan}
              parzelleM={parzelleM}
              osm={osm}
              schattenPolys={schattenPolys}
              extraBounds={[...layer.elemente, ...layer.flaechen.flatMap((f) => f.points), ...draft]}
              onKlick={zeichnen ? klick : undefined}
              overlay={({ X, Z, SCALE, toMeters }) => {
                toMetersRef.current = toMeters;
                const poly = (pts) => pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
                return (
                  <g data-testid="la-overlay">
                    {/* areas */}
                    {layer.flaechen.map((f) => {
                      const a = FLAECHEN_ARTEN[f.art] || FLAECHEN_ARTEN.gruen;
                      const m2 = polygonFlaecheM2(f.points);
                      const istSel = sel?.kind === "fl" && sel.id === f.id;
                      const c = centroid(f.points);
                      return (
                        <g key={f.id} data-testid="la-flaeche" data-id={f.id} data-art={f.art} data-m2={m2} style={{ pointerEvents: pe, cursor: zeichnen ? "inherit" : "pointer" }}
                          onClick={(ev) => { if (!zeichnen) { ev.stopPropagation(); setSel({ kind: "fl", id: f.id }); } }}>
                          <polygon points={poly(f.points)} fill={a.farbe} fillOpacity="0.5" stroke={istSel ? "#0f172a" : a.farbe} strokeWidth={istSel ? 2 : 1} />
                          <text x={X(c.x)} y={Z(c.z)} textAnchor="middle" fontSize="8" fontWeight="600" fill="#1e293b" style={{ pointerEvents: "none" }}>{de(m2)} m²</text>
                          {istSel && !zeichnen && f.points.map((p, i) => (
                            <circle key={i} cx={X(p.x)} cy={Z(p.z)} r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" style={{ cursor: "move" }}
                              onPointerDown={(ev) => { if (ev.button !== 0) return; ev.stopPropagation(); startDrag(ev, { kind: "fl", id: f.id, idx: i }); }} />
                          ))}
                        </g>
                      );
                    })}
                    {/* draft area */}
                    {draft.length > 0 && (
                      <g style={{ pointerEvents: "none" }}>
                        {draft.length >= 3
                          ? <polygon points={poly(draft)} fill={(FLAECHEN_ARTEN[art] || FLAECHEN_ARTEN.gruen).farbe} fillOpacity="0.25" stroke="#d97706" strokeWidth="1.5" strokeDasharray="4 3" />
                          : <polyline points={poly(draft)} fill="none" stroke="#d97706" strokeWidth="1.5" strokeDasharray="4 3" />}
                        {draft.map((p, i) => <circle key={i} cx={X(p.x)} cy={Z(p.z)} r="2.5" fill="#d97706" />)}
                        {draft.length >= 3 && <text x={X(centroid(draft).x)} y={Z(centroid(draft).z)} textAnchor="middle" fontSize="8" fontWeight="600" fill="#92400e">{de(polygonFlaecheM2(draft))} m²</text>}
                      </g>
                    )}
                    {/* plants */}
                    {layer.elemente.map((e) => {
                      const ty = PFLANZEN_TYPEN[e.typ];
                      const st = eignungJe[e.id]?.status || "offen";
                      const col = EIGNUNG_FARBE[st];
                      const r = Math.max(4, ((ty?.krone_m || 1) / 2) * SCALE);
                      const istSel = sel?.kind === "el" && sel.id === e.id;
                      return (
                        <g key={e.id} data-testid="la-element" data-id={e.id} data-typ={e.typ} data-eignung={st} data-licht={lichtKlassen[e.id] || ""} style={{ pointerEvents: pe, cursor: zeichnen ? "inherit" : "move" }}
                          onPointerDown={(ev) => { if (zeichnen || ev.button !== 0) return; ev.stopPropagation(); startDrag(ev, { kind: "el", id: e.id }); }}>
                          <circle cx={X(e.x)} cy={Z(e.z)} r={r} fill={col.fill} fillOpacity="0.55" stroke={istSel ? "#0f172a" : col.stroke} strokeWidth={istSel ? 2 : 1.2} />
                          <circle cx={X(e.x)} cy={Z(e.z)} r="1.8" fill={col.stroke} />
                          <text x={X(e.x)} y={Z(e.z) + r + 8} textAnchor="middle" fontSize="7" fill="#1e293b" style={{ pointerEvents: "none" }}>{ty?.name || e.typ}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              }}
            />
          </div>
          {werkzeug === "pflanze" && (
            <div className="space-y-2">
              <div className="text-[11px] text-slate-600">{t("Gewählt")}: <b>{PFLANZEN_TYPEN[typ]?.name}</b> · {t("Krone")} {de(PFLANZEN_TYPEN[typ]?.krone_m, 1)} m · {t("Höhe")} {de(PFLANZEN_TYPEN[typ]?.hoehe_m, 1)} m</div>
              <KatalogPanel titel={t("Pflanzenkatalog")} katalog={PFLANZEN_KATALOG} onAdd={setTyp}
                chipTitle={(ty) => `${ty.name} · ${ty.licht.join("/")} · Zone ≥ ${ty.zone_min} · ${t("Trockenheit")} ${ty.trockenheit}`}
                renderChip={(ty) => {
                  const st = katalogEignung(ty.id);
                  return (
                    <span className={`inline-flex items-center gap-1 ${ty.id === typ ? "font-semibold text-sky-800" : ""}`} data-testid={`la-chip-${ty.id}`} data-eignung={st}>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: EIGNUNG_FARBE[st].stroke }} />{ty.name}
                    </span>
                  );
                }} />
              <p className="text-[10px] text-slate-400">{t("Punktfarbe = Klima-Eignung am Standort (Winterhärte, Niederschlag). Licht wird nach dem Platzieren aus dem Gebäudeschatten geprüft.")}</p>
            </div>
          )}
        </div>

        {/* selection bar */}
        {(selEl || selFl) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs" data-testid="la-auswahl">
            {selEl && (
              <>
                <span><b>{selTyp?.name || selEl.typ}</b> · {selEl.id} · {de(selEl.x, 1)} / {de(selEl.z, 1)} m</span>
                <Badge className={EIGNUNG_FARBE[eignungJe[selEl.id]?.status || "offen"].badge} data-testid="la-auswahl-eignung">{eignungJe[selEl.id]?.status}</Badge>
                <span className="text-slate-600">{t("Licht")}: {lichtKlassen[selEl.id]} ({de(lichtJe[selEl.id]?.stunden, 1)} h/Tag)</span>
                {(eignungJe[selEl.id]?.gruende || []).map((g, i) => <span key={i} className="text-slate-600">· {g}</span>)}
              </>
            )}
            {selFl && (
              <>
                <span><b>{t(FLAECHEN_ARTEN[selFl.art]?.name || selFl.art)}</b> · {selFl.id} · {de(polygonFlaecheM2(selFl.points))} m²</span>
                <select value={selFl.art} onChange={(e) => setL((l) => aendereFlaeche(l, selFl.id, { art: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs" data-testid="la-auswahl-art" aria-label={t("Flächenart ändern")}>
                  {Object.values(FLAECHEN_ARTEN).map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                </select>
              </>
            )}
            <Button size="sm" variant="outline" className="h-7 text-red-600 ml-auto" onClick={loeschen} data-testid="la-loeschen"><Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}</Button>
          </div>
        )}

        {/* checks */}
        <div className="flex flex-wrap items-center gap-1" data-testid="la-checks">
          {checks.map((c) => { const st = T_STATUS[c.status] || T_STATUS.offen; return <Badge key={c.key} className={st.color} title={c.detail} data-status={c.status}>{c.label}: {st.label}</Badge>; })}
        </div>

        {/* quantities + lists */}
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1" data-testid="la-mengen">
            <div className="font-semibold text-slate-700">{t("Mengen")}</div>
            {mengen.length === 0 && !Object.keys(summen).length && <div className="text-slate-400">{t("Noch nichts platziert.")}</div>}
            {mengen.map((m) => <div key={m.typ} className="flex justify-between border-b border-slate-100 py-0.5"><span>{m.name} <span className="text-slate-400">({m.gruppe})</span></span><span>{m.anzahl} {t("Stk.")} · {de(m.krone_m2)} m² {t("Krone")}</span></div>)}
            {Object.entries(summen).map(([a, m2]) => <div key={a} className="flex justify-between border-b border-slate-100 py-0.5" data-testid="la-summe" data-art={a} data-m2={m2}><span>{t(FLAECHEN_ARTEN[a]?.name || a)}</span><span>{de(m2)} m²</span></div>)}
          </div>
          <div className="space-y-2">
            <div>
              <div className="font-semibold text-slate-700 mb-1">{t("Pflanzen")} ({layer.elemente.length})</div>
              <div className="flex flex-wrap gap-1.5" data-testid="la-liste-elemente">
                {layer.elemente.map((e) => (
                  <button key={e.id} type="button" data-id={e.id} onClick={() => { setWerkzeug("auswahl"); setSel({ kind: "el", id: e.id }); }}
                    className={`rounded border px-1.5 py-0.5 ${sel?.kind === "el" && sel.id === e.id ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: EIGNUNG_FARBE[eignungJe[e.id]?.status || "offen"].stroke }} />{PFLANZEN_TYPEN[e.typ]?.name || e.typ} · {e.id}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold text-slate-700 mb-1">{t("Flächen")} ({layer.flaechen.length})</div>
              <div className="flex flex-wrap gap-1.5" data-testid="la-liste-flaechen">
                {layer.flaechen.map((f) => (
                  <button key={f.id} type="button" data-id={f.id} onClick={() => { setWerkzeug("auswahl"); setSel({ kind: "fl", id: f.id }); }}
                    className={`rounded border px-1.5 py-0.5 ${sel?.kind === "fl" && sel.id === f.id ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: (FLAECHEN_ARTEN[f.art] || FLAECHEN_ARTEN.gruen).farbe }} />{t(FLAECHEN_ARTEN[f.art]?.name || f.art)} · {de(polygonFlaecheM2(f.points))} m²
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          {t("Eignung nach Richtwerten (USDA-Zone aus Monatsminima, 600-mm-Trockenheitsgrenze, Sonnenstunden nur aus dem eigenen Baukörper) — kein Ersatz für Pflanzplanung, Baumschutz- und Nachbarrechtsabstände.")}
        </p>
      </CardContent>
    </Card>
  );
}
