// TGA-Netz-Editor (Phase 41, NETZ-01…04) — Leitungen ziehen, sehen, verknüpfen, als Overlay
// auf dem readOnly-Grundriss der Plan-Werkstatt (BimPlan2D) im Haustechnik-Reiter.
//
// In:  usePlanModel (Hülle, Innenwände via `elements`), Store-Räume (useBuildingProgram.zones),
//      Konzeptwerte des Haustechnik-Panels über den usePanelState-Cache (qHeizlast, luftwechsel,
//      vaM2), Fachlayer `netz_layer` (useFachlayer, KD-17).
// Out: Rendering + Verdrahtung: Knoten setzen, Leitungen je Gewerk/Geschoss ziehen und an Knoten
//      verknüpfen, Knoten ziehen (Kanten folgen), löschen; Strangschema, Kennwerte je Strang,
//      Checks (pass/warn/offen), Mengen als AVA-Übergabe. Alle Logik in @designer/lib/tgaNetz.
// Kein zweiter Plan-Editor: Zoom/Pan/Hülle/Innenwände kommen aus BimPlan2D.

import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Move, Plus, PenTool, Route, Check, Undo2, Trash2, AlertTriangle, Gauge, GitBranch } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram } from "@core/lib/useBuildingProgram";
import { usePanelState } from "@core/lib/usePanelState";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { GEBAEUDESTANDARDS, DEFAULT_LUFTWECHSEL, DEFAULT_VA_M2 } from "@designer/lib/hvac";
import {
  GEWERKE_TGA, GEWERK_KEYS, KNOTEN_ARTEN, ART_KEYS, NETZ_DEFAULT,
  netzHardened, kantenLaenge, knotenImLevel, kantenImLevel, naechsterKnoten,
  neuerKnoten, neueKante, verschiebeKnoten, aendereKnoten, aendereKante, loescheKnoten, loescheKante,
  strangKennwerte, netzChecks, netzMengen, strangschema,
} from "@designer/lib/tgaNetz";
import BimPlan2D from "./BimPlan2D";
import StrangSchema from "./StrangSchema";

const N_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 2 });
const geschoss = (lvl, t) => (lvl === 0 ? t("EG") : `${lvl}. ${t("OG")}`);

/** Node symbol per kind — SVG shape around (cx, cy), r in SVG units. */
function KnotenSymbol({ art, cx, cy, r, farbe, sel, spannt }) {
  const stroke = sel ? "#0f172a" : farbe;
  const sw = sel ? 2.2 : 1.4;
  const common = { fill: "#fff", stroke, strokeWidth: sw };
  switch (art) {
    case "erzeuger":
      return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} fill={farbe} />;
    case "verteiler":
      return <polygon points={`${cx},${cy - r * 1.2} ${cx + r * 1.2},${cy} ${cx},${cy + r * 1.2} ${cx - r * 1.2},${cy}`} {...common} />;
    case "anschluss":
      return <polygon points={`${cx},${cy - r * 1.2} ${cx + r * 1.15},${cy + r} ${cx - r * 1.15},${cy + r}`} {...common} fill={farbe} />;
    case "schacht":
      return (
        <g>
          <circle cx={cx} cy={cy} r={r * 1.5} {...common} strokeDasharray={spannt ? undefined : "2 2"} />
          <circle cx={cx} cy={cy} r={r * 0.5} fill={farbe} />
        </g>
      );
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} fill={farbe} />;
  }
}

/**
 * Leitungszug-Editor — propless, liest Projekt/Plan/Räume selbst.
 */
export default function TgaNetzEditor() {
  const { t } = useI18n();
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const { zones } = useBuildingProgram();
  const [layer, setLayer] = useFachlayer(project?.id, "netz_layer", NETZ_DEFAULT);
  const netz = useMemo(() => netzHardened(layer), [layer]);
  // Every write goes through the lib and refreshes the hand-over quantities in the layer.
  const setNetz = (fn) => setLayer((l) => {
    const neu = netzHardened(typeof fn === "function" ? fn(netzHardened(l)) : fn);
    return { ...neu, mengen: netzMengen(neu) };
  });

  // Concept inputs of the Haustechnik panel (same usePanelState cache, no prop drilling).
  const [qHeizlast] = usePanelState("haustechnik:qHeizlast", GEBAEUDESTANDARDS["geg-neubau"].heizlast);
  const [luftwechsel] = usePanelState("haustechnik:luftwechsel", DEFAULT_LUFTWECHSEL);
  const [vaM2] = usePanelState("haustechnik:vaM2", DEFAULT_VA_M2);

  const storeys = Math.max(1, Math.round(plan?.storeys || 1));
  const [level, setLevel] = useState(0);
  const lvl = Math.min(level, storeys - 1);
  const [werkzeug, setWerkzeug] = useState("auswahl"); // auswahl | knoten | leitung
  const [gewerk, setGewerk] = useState("heizung");
  const [art, setArt] = useState("auslass");
  const [dn, setDn] = useState(GEWERKE_TGA.heizung.dnDefault);
  const [levelBis, setLevelBis] = useState(0);
  const [draft, setDraft] = useState(null); // { von: id|null, points: [{x,z}] }
  const [sel, setSel] = useState(null);     // { typ: "knoten"|"kante", id }

  const wechsleGewerk = (g) => { setGewerk(g); setDn(GEWERKE_TGA[g]?.dnDefault ?? null); };
  const knotenHier = useMemo(() => knotenImLevel(netz, lvl), [netz, lvl]);
  const kantenHier = useMemo(() => kantenImLevel(netz, lvl), [netz, lvl]);
  const selKnoten = sel?.typ === "knoten" ? netz.knoten.find((k) => k.id === sel.id) : null;
  const selKante = sel?.typ === "kante" ? netz.kanten.find((e) => e.id === sel.id) : null;

  const checks = useMemo(() => netzChecks(netz, zones), [netz, zones]);
  const kennwerte = useMemo(
    () => strangKennwerte(netz, zones, { qHeizlast, storeyHeight: plan?.storeyHeight || 3, luftwechsel, vaM2 }),
    [netz, zones, qHeizlast, plan?.storeyHeight, luftwechsel, vaM2],
  );
  const mengen = useMemo(() => netzMengen(netz), [netz]);
  const schema = useMemo(() => strangschema(netz, storeys), [netz, storeys]);

  // ---- editing ----
  const knotenSetzen = (p) => {
    const nah = naechsterKnoten(netz, lvl, p);
    if (nah) { setSel({ typ: "knoten", id: nah.id }); return; }
    setNetz((n) => {
      const r = neuerKnoten(n, { gewerk, art, level: lvl, x: p.x, z: p.z, levelBis: art === "schacht" ? Math.max(lvl, levelBis) : lvl });
      return r.netz;
    });
  };
  const leitungKlick = (p) => {
    const nah = naechsterKnoten(netz, lvl, p);
    if (!draft) {
      setDraft({ von: nah?.id ?? null, points: [nah ? { x: nah.x, z: nah.z } : p] });
      return;
    }
    if (nah && nah.id !== draft.von) {
      leitungAbschliessen(nah.id, { x: nah.x, z: nah.z });
      return;
    }
    setDraft((d) => ({ ...d, points: [...d.points, p] }));
  };
  const leitungAbschliessen = (nachId = null, endpunkt = null) => {
    if (!draft) return;
    const pts = endpunkt ? [...draft.points, endpunkt] : draft.points;
    if (pts.length < 2) { setDraft(null); return; }
    setNetz((n) => neueKante(n, { gewerk, level: lvl, dn, von: draft.von, nach: nachId, points: pts }).netz);
    setDraft(null);
  };
  const loeschen = () => {
    if (selKnoten) setNetz((n) => loescheKnoten(n, selKnoten.id));
    if (selKante) setNetz((n) => loescheKante(n, selKante.id));
    setSel(null);
  };

  // Drag (Werkzeug auswahl): toMeters (25 cm) from the overlay, refreshed every render.
  const toMetersRef = useRef(null);
  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const p = toMetersRef.current?.(e);
      if (p) setNetz((n) => verschiebeKnoten(n, d.id, p));
    },
    onTap: (d) => setSel({ typ: "knoten", id: d.id }),
  });

  if (!plan?.model) return null;

  const symbolR = 4.5;

  return (
    <div className="space-y-4" data-testid="tn-editor">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Seitenleiste: Werkzeug, Gewerk, Art, DN, Geschoss, Auswahl */}
        <div className="space-y-4 xl:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><Route className="w-4 h-4" /> {t("Leitungsnetz")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant={werkzeug === "auswahl" ? "default" : "outline"} onClick={() => { setWerkzeug("auswahl"); setDraft(null); }} data-testid="tn-tool-auswahl">
                  <Move className="w-3.5 h-3.5 mr-1" /> {t("Auswahl")}
                </Button>
                <Button size="sm" variant={werkzeug === "knoten" ? "default" : "outline"} onClick={() => { setWerkzeug("knoten"); setDraft(null); }} data-testid="tn-tool-knoten">
                  <Plus className="w-3.5 h-3.5 mr-1" /> {t("Knoten")}
                </Button>
                <Button size="sm" variant={werkzeug === "leitung" ? "default" : "outline"} onClick={() => { setWerkzeug("leitung"); setSel(null); }} data-testid="tn-tool-leitung">
                  <PenTool className="w-3.5 h-3.5 mr-1" /> {t("Leitung")}
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                {werkzeug === "knoten" && t("Klick setzt einen Knoten (0,25-m-Raster); Klick auf einen Knoten wählt ihn.")}
                {werkzeug === "leitung" && t("Klick startet an einem Knoten oder frei, weitere Klicks setzen Stützpunkte, Klick auf einen Knoten schließt verknüpft ab.")}
                {werkzeug === "auswahl" && t("Knoten und Leitungen anklicken; Knoten ziehen — Leitungen folgen. Entf löscht.")}
              </p>

              <label className="block text-xs text-slate-600">
                {t("Gewerk")}
                <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={gewerk} onChange={(e) => wechsleGewerk(e.target.value)} data-testid="tn-gewerk">
                  {GEWERK_KEYS.map((g) => <option key={g} value={g}>{GEWERKE_TGA[g].label} — {GEWERKE_TGA[g].medium}</option>)}
                </select>
              </label>
              {werkzeug === "knoten" && (
                <label className="block text-xs text-slate-600">
                  {t("Knoten-Art")}
                  <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={art} onChange={(e) => setArt(e.target.value)} data-testid="tn-art">
                    {ART_KEYS.map((a) => <option key={a} value={a}>{KNOTEN_ARTEN[a].label}</option>)}
                  </select>
                </label>
              )}
              {werkzeug === "knoten" && art === "schacht" && (
                <label className="block text-xs text-slate-600">
                  {t("Steigstrang bis")}
                  <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={Math.max(lvl, levelBis)} onChange={(e) => setLevelBis(Number(e.target.value))} data-testid="tn-levelbis">
                    {Array.from({ length: storeys }, (_, i) => i).filter((i) => i >= lvl).map((i) => <option key={i} value={i}>{geschoss(i, t)}</option>)}
                  </select>
                </label>
              )}
              {werkzeug === "leitung" && (
                <label className="block text-xs text-slate-600">
                  {t("Nennweite")} ({GEWERKE_TGA[gewerk].einheit}) <span className="text-slate-400">[ASSUMED]</span>
                  <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={dn ?? ""} onChange={(e) => setDn(e.target.value === "" ? null : Number(e.target.value))} data-testid="tn-dn">
                    <option value="">{t("offen")}</option>
                    {GEWERKE_TGA[gewerk].dnListe.map((d) => <option key={d} value={d}>{gewerk === "elektro" ? `${de1(d)} mm²` : `DN ${d}`}</option>)}
                  </select>
                </label>
              )}

              <div>
                <div className="text-xs text-slate-600 mb-1">{t("Geschoss")}</div>
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: storeys }, (_, i) => (
                    <button key={i} type="button" data-testid={`tn-level-${i}`} onClick={() => { setLevel(i); setDraft(null); setSel(null); }}
                      className={`rounded border px-2 py-0.5 text-xs ${i === lvl ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {geschoss(i, t)} <span className="text-slate-400">({kantenImLevel(netz, i).length})</span>
                    </button>
                  ))}
                </div>
              </div>

              {draft && (
                <div className="flex flex-wrap items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="tn-draft">
                  <span>{t("Leitung")}: {draft.points.length} {t("Punkte")} · {de1(kantenLaenge(draft.points))} m</span>
                  <Button size="sm" variant="ghost" className="h-6" onClick={() => setDraft((d) => (d && d.points.length > 1 ? { ...d, points: d.points.slice(0, -1) } : null))} aria-label={t("Letzten Punkt entfernen")}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-emerald-700" onClick={() => leitungAbschliessen(null, null)} disabled={draft.points.length < 2} data-testid="tn-abschliessen">
                    <Check className="w-3.5 h-3.5 mr-1" /> {t("Abschließen")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {(selKnoten || selKante) && (
            <Card data-testid="tn-auswahl">
              <CardHeader className="pb-2"><CardTitle className="text-base">{selKnoten ? t("Knoten") : t("Leitung")}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                {selKnoten && (
                  <>
                    <div className="text-slate-600">{GEWERKE_TGA[selKnoten.gewerk].label} · {KNOTEN_ARTEN[selKnoten.art].label} · {geschoss(selKnoten.level, t)}{selKnoten.levelBis > selKnoten.level ? ` – ${geschoss(selKnoten.levelBis, t)}` : ""}</div>
                    <label className="block text-slate-600">
                      {t("Name")}
                      <Input className="mt-1 h-7 text-xs" value={selKnoten.name || ""} placeholder={`${KNOTEN_ARTEN[selKnoten.art].label} ${selKnoten.id}`}
                        onChange={(e) => setNetz((n) => aendereKnoten(n, selKnoten.id, { name: e.target.value }))} data-testid="tn-name" />
                    </label>
                    {selKnoten.art === "schacht" && (
                      <label className="block text-slate-600">
                        {t("Steigstrang bis")}
                        <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs" value={selKnoten.levelBis}
                          onChange={(e) => setNetz((n) => aendereKnoten(n, selKnoten.id, { levelBis: Number(e.target.value) }))}>
                          {Array.from({ length: storeys }, (_, i) => i).filter((i) => i >= selKnoten.level).map((i) => <option key={i} value={i}>{geschoss(i, t)}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="text-slate-500">x {de2(selKnoten.x)} m · z {de2(selKnoten.z)} m</div>
                  </>
                )}
                {selKante && (
                  <>
                    <div className="text-slate-600">{GEWERKE_TGA[selKante.gewerk].label} · {geschoss(selKante.level, t)} · {de1(kantenLaenge(selKante.points))} m · {selKante.von || "—"} → {selKante.nach || "—"}</div>
                    <label className="block text-slate-600">
                      {t("Nennweite")} ({GEWERKE_TGA[selKante.gewerk].einheit})
                      <select className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs" value={selKante.dn ?? ""}
                        onChange={(e) => setNetz((n) => aendereKante(n, selKante.id, { dn: e.target.value === "" ? null : Number(e.target.value) }))} data-testid="tn-kante-dn">
                        <option value="">{t("offen")}</option>
                        {GEWERKE_TGA[selKante.gewerk].dnListe.map((d) => <option key={d} value={d}>{selKante.gewerk === "elektro" ? `${de1(d)} mm²` : `DN ${d}`}</option>)}
                      </select>
                    </label>
                  </>
                )}
                <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={loeschen} data-testid="tn-loeschen">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("Prüfung")} <span className="text-xs font-normal text-slate-400">pass / warn / offen</span></CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1" data-testid="tn-checks">
                {checks.map((c) => {
                  const st = N_STATUS[c.status] || N_STATUS.offen;
                  return <Badge key={c.key} className={st.color} title={c.detail} data-status={c.status}>{c.label}: {st.label}</Badge>;
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plan + Listen */}
        <div className="space-y-3 xl:col-span-3">
          <div className="rounded-lg border bg-white overflow-hidden" tabIndex={0}
            onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); loeschen(); } if (e.key === "Escape") { setDraft(null); setSel(null); } }}>
            <BimPlan2D
              model={plan.model}
              mode="grundriss"
              level={lvl}
              storeyHeight={plan.storeyHeight}
              readOnly
              customZones={zones}
              envOpenings={plan.envOpenings}
              elements={{ customWalls: plan.customWalls, customColumns: plan.customColumns, customWindows: plan.customWindows }}
              unit={plan.unit}
              height={480}
              overlayBounds={[...knotenHier.map((k) => ({ x: k.x, z: k.z })), ...(draft?.points || [])]}
              overlay={({ X, Z, SCALE, toMeters, bounds }) => {
                toMetersRef.current = toMeters;
                const tf = { X, Z };
                return (
                  <g data-testid="tn-overlay">
                    {/* Klick-Fläche für die Zeichenwerkzeuge; im Werkzeug „Auswahl" bleibt der Plan frei (Pan/Zoom). */}
                    {werkzeug !== "auswahl" && (
                      <rect x="0" y="0" width={X(bounds.maxX) + X(bounds.minX)} height={Z(bounds.maxZ) + Z(bounds.minZ)}
                        fill="transparent" style={{ cursor: "crosshair" }}
                        onClick={(e) => { const p = toMeters(e); if (!p) return; if (werkzeug === "knoten") knotenSetzen(p); else leitungKlick(p); }}
                        onDoubleClick={(e) => { e.stopPropagation(); if (werkzeug === "leitung") leitungAbschliessen(null, null); }} />
                    )}
                    {/* Kanten */}
                    {kantenHier.map((e) => {
                      const farbe = GEWERKE_TGA[e.gewerk].farbe;
                      const istSel = sel?.typ === "kante" && sel.id === e.id;
                      const pts = e.points.map((p) => `${tf.X(p.x)},${tf.Z(p.z)}`).join(" ");
                      const mid = e.points[Math.floor(e.points.length / 2)];
                      const offen = !e.von || !e.nach;
                      return (
                        <g key={e.id} data-testid="tn-kante" data-id={e.id} data-von={e.von || ""} data-nach={e.nach || ""} data-len={kantenLaenge(e.points).toFixed(2)}
                          // In den Zeichenwerkzeugen klick-durchlässig, sonst schluckt die Kante den Klick auf die Zeichenfläche darunter.
                          style={{ cursor: werkzeug === "auswahl" ? "pointer" : "inherit", pointerEvents: werkzeug === "auswahl" ? "auto" : "none" }}
                          onClick={(ev) => { if (werkzeug === "auswahl") { ev.stopPropagation(); setSel({ typ: "kante", id: e.id }); } }}>
                          {/* breite unsichtbare Trefferlinie */}
                          <polyline points={pts} fill="none" stroke="transparent" strokeWidth="10" />
                          {istSel && <polyline points={pts} fill="none" stroke="#0f172a" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.35" />}
                          <polyline points={pts} fill="none" stroke={farbe} strokeWidth="2.2" strokeDasharray={offen ? "5 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />
                          {e.dn != null && (
                            <text x={tf.X(mid.x) + 4} y={tf.Z(mid.z) - 3} fontSize="7" fill={farbe} fontWeight="600" style={{ pointerEvents: "none" }}>
                              {e.gewerk === "elektro" ? `${de1(e.dn)} mm²` : `DN ${e.dn}`}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {/* Draft */}
                    {draft && draft.points.length > 0 && (
                      <g style={{ pointerEvents: "none" }}>
                        <polyline points={draft.points.map((p) => `${tf.X(p.x)},${tf.Z(p.z)}`).join(" ")} fill="none" stroke="#d97706" strokeWidth="2" strokeDasharray="4 3" />
                        {draft.points.map((p, i) => <circle key={i} cx={tf.X(p.x)} cy={tf.Z(p.z)} r="2.5" fill="#d97706" />)}
                      </g>
                    )}
                    {/* Knoten */}
                    {knotenHier.map((k) => {
                      const farbe = GEWERKE_TGA[k.gewerk].farbe;
                      const istSel = sel?.typ === "knoten" && sel.id === k.id;
                      const spannt = k.art === "schacht" && k.levelBis > k.level;
                      return (
                        <g key={k.id} data-testid="tn-knoten" data-id={k.id} data-art={k.art} data-gewerk={k.gewerk} data-x={k.x} data-z={k.z}
                          // Klick-durchlässig in den Zeichenwerkzeugen: der Klick auf einen Knoten muss die Zeichenfläche erreichen
                          // (Leitung startet/endet dort über naechsterKnoten), sonst versinkt er im Knoten.
                          style={{ cursor: werkzeug === "auswahl" ? "grab" : "inherit", pointerEvents: werkzeug === "auswahl" ? "auto" : "none" }}
                          onPointerDown={(ev) => { if (werkzeug !== "auswahl" || ev.button !== 0) return; ev.stopPropagation(); setSel({ typ: "knoten", id: k.id }); startDrag(ev, { id: k.id }); }}
                          onClick={(ev) => { if (werkzeug === "auswahl") { ev.stopPropagation(); setSel({ typ: "knoten", id: k.id }); } }}>
                          <circle cx={tf.X(k.x)} cy={tf.Z(k.z)} r={symbolR * 2.4} fill="transparent" />
                          <KnotenSymbol art={k.art} cx={tf.X(k.x)} cy={tf.Z(k.z)} r={symbolR} farbe={farbe} sel={istSel} spannt={spannt} />
                          {(k.name || istSel) && (
                            <text x={tf.X(k.x) + symbolR * 1.8} y={tf.Z(k.z) - symbolR} fontSize="7" fill="#334155" style={{ pointerEvents: "none" }}>
                              {k.name || `${KNOTEN_ARTEN[k.art].label} ${k.id}`}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {/* Legende oben links */}
                    <g style={{ pointerEvents: "none" }}>
                      {GEWERK_KEYS.filter((g) => kantenHier.some((e) => e.gewerk === g) || knotenHier.some((k) => k.gewerk === g)).map((g, i) => (
                        <g key={g}>
                          <line x1={14} y1={14 + i * 10} x2={30} y2={14 + i * 10} stroke={GEWERKE_TGA[g].farbe} strokeWidth="2.2" />
                          <text x={34} y={14 + i * 10} fontSize="7" dominantBaseline="central" fill="#475569">{GEWERKE_TGA[g].label}</text>
                        </g>
                      ))}
                    </g>
                    {/* SCALE only used to keep the symbol radius readable when zoomed far out */}
                    {SCALE < 6 && <text x={14} y={Z(bounds.maxZ) + Z(bounds.minZ) - 6} fontSize="7" fill="#94a3b8" style={{ pointerEvents: "none" }}>{t("Hineinzoomen für Details")}</text>}
                  </g>
                );
              }}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("Leitungen")} {geschoss(lvl, t)} ({kantenHier.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs" data-testid="tn-kanten-liste">
                {kantenHier.length === 0 && <p className="text-slate-400">{t("Noch keine Leitungen in diesem Geschoss.")}</p>}
                {kantenHier.map((e) => (
                  <button key={e.id} type="button" data-id={e.id} onClick={() => { setWerkzeug("auswahl"); setSel({ typ: "kante", id: e.id }); }}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left ${sel?.id === e.id ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <span className="inline-block w-3 h-1.5 rounded" style={{ background: GEWERKE_TGA[e.gewerk].farbe }} />
                    <span className="text-slate-700">{GEWERKE_TGA[e.gewerk].label}</span>
                    <span className="text-slate-500">{e.dn != null ? (e.gewerk === "elektro" ? `${de1(e.dn)} mm²` : `DN ${e.dn}`) : t("DN offen")}</span>
                    <span className="ml-auto text-slate-600">{de1(kantenLaenge(e.points))} m</span>
                    {(!e.von || !e.nach) && <span className="text-amber-700" title={t("offenes Ende")}>⚠</span>}
                  </button>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("Knoten")} {geschoss(lvl, t)} ({knotenHier.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs" data-testid="tn-knoten-liste">
                {knotenHier.length === 0 && <p className="text-slate-400">{t("Noch keine Knoten in diesem Geschoss.")}</p>}
                {knotenHier.map((k) => (
                  <button key={k.id} type="button" data-id={k.id} onClick={() => { setWerkzeug("auswahl"); setSel({ typ: "knoten", id: k.id }); }}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left ${sel?.id === k.id ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GEWERKE_TGA[k.gewerk].farbe }} />
                    <span className="text-slate-700">{k.name || KNOTEN_ARTEN[k.art].label}</span>
                    <span className="text-slate-500">{GEWERKE_TGA[k.gewerk].label}</span>
                    {k.art === "schacht" && k.levelBis > k.level && <span className="ml-auto text-slate-500">{geschoss(k.level, t)}–{geschoss(k.levelBis, t)}</span>}
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Strangschema + Kennwerte + Mengen */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="w-4 h-4" /> {t("Strangschema")} <span className="text-xs font-normal text-slate-400">{t("automatisch aus dem Netz")}</span></CardTitle>
          </CardHeader>
          <CardContent>
            <StrangSchema daten={schema} kennwerte={kennwerte} leerText={t("Noch kein Strang — Schacht, Verteiler oder Erzeuger setzen.")} />
            {kennwerte.length > 0 && (
              <table className="mt-3 w-full text-xs" data-testid="tn-kennwerte">
                <thead className="text-slate-500">
                  <tr><th className="text-left font-medium">{t("Strang")}</th><th className="text-left font-medium">{t("Gewerk")}</th><th className="text-right font-medium">{t("Räume")}</th><th className="text-right font-medium">m²</th><th className="text-right font-medium">{t("Auslässe")}</th><th className="text-right font-medium">{t("Bedarf")} <span className="text-slate-400">[ASSUMED]</span></th></tr>
                </thead>
                <tbody>
                  {kennwerte.map((k) => (
                    <tr key={`${k.gewerk}-${k.strangId ?? "-"}`} className="border-t">
                      <td className="py-0.5 text-slate-700">{k.name}</td>
                      <td className="text-slate-600">{GEWERKE_TGA[k.gewerk].label}</td>
                      <td className="text-right">{k.raeume}</td>
                      <td className="text-right">{de1(k.flaeche_m2)}</td>
                      <td className="text-right">{k.auslaesse}</td>
                      <td className="text-right font-medium">{de1(k.kennwert)} {k.einheit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Gauge className="w-4 h-4" /> {t("Mengen")} <span className="text-xs font-normal text-slate-400">{t("AVA-Übergabe")}</span></CardTitle></CardHeader>
          <CardContent className="text-xs space-y-2" data-testid="tn-mengen">
            {mengen.kanten_stk === 0 && mengen.knoten.length === 0 && <p className="text-slate-400">{t("Noch nichts gezeichnet.")}</p>}
            {mengen.lfm.length > 0 && (
              <table className="w-full">
                <tbody>
                  {mengen.lfm.map((m) => (
                    <tr key={`${m.gewerk}-${m.dn}`} className="border-t">
                      <td className="py-0.5 text-slate-700">{GEWERKE_TGA[m.gewerk].label}</td>
                      <td className="text-slate-500">{m.dn != null ? (m.gewerk === "elektro" ? `${de1(m.dn)} mm²` : `DN ${m.dn}`) : t("DN offen")}</td>
                      <td className="text-right font-medium">{de2(m.lfm)} lfm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mengen.knoten.length > 0 && (
              <table className="w-full">
                <tbody>
                  {mengen.knoten.map((m) => (
                    <tr key={`${m.gewerk}-${m.art}`} className="border-t">
                      <td className="py-0.5 text-slate-700">{GEWERKE_TGA[m.gewerk].label}</td>
                      <td className="text-slate-500">{KNOTEN_ARTEN[m.art].label}</td>
                      <td className="text-right font-medium">{m.stk} Stk</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mengen.kanten_stk > 0 && (
              <div className="text-slate-500 border-t pt-1">{mengen.straenge_stk} {t("Stränge")} · {mengen.kanten_stk} {t("Leitungen")} · {layer?.mengen ? t("im Projekt gespeichert") : t("Speichern läuft")}</div>
            )}
            <div className="flex items-start gap-1.5 text-[11px] text-slate-500 border-t pt-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
              {t("Konzeptnetz — Trassen und Nennweiten sind Richtwerte, keine Rohrnetzberechnung.")}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
