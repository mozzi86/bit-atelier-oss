// EntwaesserungPlanner (Phase 63-03, ENTW-01/02/03/04/05) — the drainage sub-tab of the
// Haustechnik panel. THREE cards on the libs built in 63-01/63-02 (entwaesserung.js,
// gefaelledaemmung.js), plus checks (pass/warn/offen) and a quantity list for the AVA hand-over:
//   1. Schmutzwasser & Rückstau — sewage flow from the sanitary inputs (panel cache), ground
//      pipes from netz_layer (gewerk abwasser) with an additive slope override, backwater level
//      coupled to the basement/underground garage (werkstatt_layer, READ-ONLY).
//   2. Gefälledämmung — readOnly roof plan (flat roof = footprint [ASSUMED Attika]) with roof
//      drains / emergency overflows set on it, tapered-insulation thickness map, ridges, flow
//      arrows, U-values and thickness tiers (gefaelledaemmung.gefaelleplan).
//   3. Jahrhundertregen & Rückhalt — the site-plan core (LageplanPlan) with the retention
//      catalogue (swale / trench / swale-trench / retention roof as areas, cisterns as points),
//      the DIN 1986-100 flood balance and the emergency roof drainage.
//
// In:  project (useProject), plan (usePlanModel: footprint, storeys, dachform), panel cache
//      (haustechnik:we, haustechnik:sanitaerJeWe), netz_layer (READ + the additive gefaelle_pct
//      write), entwaesserung_layer (OWNED here), werkstatt_layer + aussenanlagen_layer (READ).
// Out: rendering + wiring; every number comes from @designer/lib/entwaesserung / gefaelledaemmung.
// No second pipe model (KD-17): the pipes stay in netz_layer, this tab only reads them and adds
// the slope override. No second plan editor: zoom/pan/envelope come from BimPlan2D / LageplanPlan.

import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Move, Check, Undo2, Trash2, AlertTriangle, Droplet, CloudRain, Gauge, Ruler } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, programMetrics, polygonAreaM } from "@core/lib/useBuildingProgram";
import { usePanelState } from "@core/lib/usePanelState";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { NumberField } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { DEFAULT_SANITAER_JE_WE } from "@designer/lib/hvac";
import {
  parzelleInMetern, polygonFlaecheM2, neuesElement, verschiebeElement, loescheElement,
  neueFlaeche, verschiebeFlaechenPunkt, aendereFlaeche, loescheFlaeche, flaechenSummen, LAGEPLAN_DEFAULT,
} from "@designer/lib/lageplan";
import {
  ENTW_DEFAULT, layerHardened as entwHardened, neuerDachpunkt, verschiebeDachpunkt, loescheDachpunkt,
  RUECKSTAU_MASSNAHMEN, schmutzwasser, grundleitungen, rueckstauCheck, abflusswirksam, ueberflutung,
  notentwaesserung, rueckhaltVolumen, REGEN_ARTEN, REGEN_KATALOG, REGEN_TYPEN,
  entwaesserungChecks, entwaesserungMengen,
} from "@designer/lib/entwaesserung";
import { gefaelleplan, uWerteDach, gefaelleChecks, gefaelleMengen, RASTER_M } from "@designer/lib/gefaelledaemmung";
import { netzHardened, NETZ_DEFAULT, aendereKante } from "@designer/lib/tgaNetz";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { GRUEN_ARTEN } from "@designer/lib/pflanzen";
import BimPlan2D from "./BimPlan2D";
import LageplanPlan from "./LageplanPlan";
import KatalogPanel from "./KatalogPanel";

// The checks know pass/warn/offen (never fail — a licensed drainage design replaces this, T-17-04).
const T_STATUS = { ...STATUS_STYLE, offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" } };
const de = (n, d = 0) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const centroid = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });

// Thickness-map colour: interpolate light → dark blue between dmin and dmax (a readable wedge).
const HELL = [219, 234, 254], DUNKEL = [30, 64, 175];
/** @param {number} d thickness m @param {number} dmin @param {number} dmax @returns {string} css rgb */
function dickenFarbe(d, dmin, dmax) {
  const t = dmax > dmin ? Math.min(1, Math.max(0, (d - dmin) / (dmax - dmin))) : 0;
  const c = HELL.map((h, i) => Math.round(h + (DUNKEL[i] - h) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Drainage sub-tab — like TgaNetzEditor it reads project/plan/panel cache itself.
 * @param {{ complexData?: any }} [props] complexData from ComplexDesigner (site_parcel for the
 *   Lageplan parcel outline; without it LageplanPlan sizes the plan from the footprint + margin).
 * @returns {JSX.Element}
 */
export default function EntwaesserungPlanner({ complexData = null } = {}) {
  const { t } = useI18n();
  const { project } = useProject();
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const plan = usePlanModel(project?.id);

  // Layers. entwaesserung_layer is OWNED here (KD-17, one writer per field). netz_layer is
  // READ here plus the additive gefaelle_pct override — TgaNetzEditor owns it but the two are
  // never mounted at once (konzept | netz | entwaesserung sub-tabs), and saveBimModel merges.
  const [entwRaw, setEntwRaw] = useFachlayer(project?.id, "entwaesserung_layer", ENTW_DEFAULT);
  const entw = useMemo(() => entwHardened(entwRaw), [entwRaw]);
  const setEntw = (fn) => setEntwRaw((l) => entwHardened(typeof fn === "function" ? fn(entwHardened(l)) : fn));
  const [netzRaw, setNetzRaw] = useFachlayer(project?.id, "netz_layer", NETZ_DEFAULT);
  const netz = useMemo(() => netzHardened(netzRaw), [netzRaw]);
  const setNetz = (fn) => setNetzRaw((l) => netzHardened(typeof fn === "function" ? fn(netzHardened(l)) : fn));
  const [wtLayer] = useFachlayer(project?.id, "werkstatt_layer", WERKSTATT_DEFAULT); // READ-ONLY
  const [aussenLayer] = useFachlayer(project?.id, "aussenanlagen_layer", LAGEPLAN_DEFAULT); // READ-ONLY (A_red)

  // Sanitary inputs from the panel cache (owned by the Konzept tab; same keys → same values).
  const weDefault = Math.max(1, Math.round(pm.ngf / 75)) || 1;
  const [we] = usePanelState("haustechnik:we", weDefault);
  const [sanitaerJeWe] = usePanelState("haustechnik:sanitaerJeWe", DEFAULT_SANITAER_JE_WE);

  // Stable identity: the model object changes only when the store changes, but the
  // `|| []` fallback would create a new array each render and churn the memos below.
  const footprint = useMemo(() => plan?.model?.footprint || [], [plan?.model]);
  const footArea = useMemo(() => polygonAreaM(footprint), [footprint]);
  const parzelleM = useMemo(() => parzelleInMetern(complexData?.site_parcel), [complexData?.site_parcel]);
  const storeyHeight = Number(plan?.storeyHeight) || 3;
  const dachform = plan?.dachform || "flach";
  const kellerAktiv = Boolean(wtLayer?.keller?.aktiv);
  const tiefgarageAktiv = Boolean(wtLayer?.tiefgarage?.aktiv);

  // --- Karte 1: Schmutzwasser & Rückstau ---------------------------------------
  const sw = useMemo(() => schmutzwasser({ we, sanitaerJeWe }), [we, sanitaerJeWe]);
  const rueckstau = useMemo(() => rueckstauCheck({
    ebene_m: entw.rueckstau.ebene_m, massnahme: entw.rueckstau.massnahme,
    kellerAktiv, tiefgarageAktiv, storeyHeight,
  }), [entw.rueckstau, kellerAktiv, tiefgarageAktiv, storeyHeight]);
  const gl = useMemo(() => grundleitungen(netz, {
    storeyHeight, kellerAktiv, kanalsohle_m: entw.rueckstau.kanalsohle_m, dnDefault: sw.dn || 100,
  }), [netz, storeyHeight, kellerAktiv, entw.rueckstau.kanalsohle_m, sw.dn]);

  const setMassnahme = (m) => setEntw((l) => ({ ...l, rueckstau: { ...l.rueckstau, massnahme: m } }));
  const setRueckstauZahl = (feld, v) => setEntw((l) => ({ ...l, rueckstau: { ...l.rueckstau, [feld]: v } }));
  const setGefaelle = (id, v) => setNetz((n) => aendereKante(n, id, { gefaelle_pct: Number.isFinite(v) ? v : null }));

  // --- Karte 2: Gefälledämmung (Flachdach) -------------------------------------
  const dach = entw.dach;
  const gefPlan = useMemo(() => gefaelleplan(footprint, dach.ablaeufe, {
    gefaelle_pct: dach.gefaelle_pct, dmin_m: dach.dmin_m,
  }), [footprint, dach.ablaeufe, dach.gefaelle_pct, dach.dmin_m]);
  const uWerte = useMemo(() => uWerteDach({ dmin_m: gefPlan.dmin_m, dmax_m: gefPlan.dmax_m }), [gefPlan.dmin_m, gefPlan.dmax_m]);
  const [dachWerkzeug, setDachWerkzeug] = useState("auswahl"); // auswahl | ablauf | not
  const [selDach, setSelDach] = useState(null); // { id }
  const dachToMeters = useRef(null);
  const dachKlick = (p) => {
    if (dachWerkzeug === "ablauf") setEntw((l) => neuerDachpunkt(l, "ablaeufe", p).layer);
    else if (dachWerkzeug === "not") setEntw((l) => neuerDachpunkt(l, "notueberlaeufe", p).layer);
  };
  const { startDrag: startDachDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const p = dachToMeters.current?.(e);
      if (!p) return;
      const liste = dach.ablaeufe.some((a) => a.id === d.id) ? "ablaeufe" : "notueberlaeufe";
      setEntw((l) => verschiebeDachpunkt(l, liste, d.id, p));
    },
    onTap: (d) => setSelDach({ id: d.id }),
  });
  const loescheDach = () => { if (selDach) { setEntw((l) => loescheDachpunkt(l, selDach.id)); setSelDach(null); } };
  const setDachZahl = (feld, v) => setEntw((l) => ({ ...l, dach: { ...l.dach, [feld]: v } }));

  // --- Karte 3: Jahrhundertregen & Rückhalt ------------------------------------
  const regen = entw.regen;
  const rueckhalt = entw.rueckhalt;
  const [regenWerkzeug, setRegenWerkzeug] = useState("auswahl"); // auswahl | flaeche | zisterne
  const [regenArt, setRegenArt] = useState("mulde");
  const [zisterne, setZisterne] = useState(REGEN_KATALOG[0].typen[0].id);
  const [draft, setDraft] = useState([]); // retention area under construction [{x,z}]
  const [selRH, setSelRH] = useState(null); // { kind: "el"|"fl", id }
  const rhToMeters = useRef(null);
  const regenKlick = (p) => {
    if (regenWerkzeug === "zisterne") { setEntw((l) => ({ ...l, rueckhalt: neuesElement(l.rueckhalt, { typ: zisterne, x: p.x, z: p.z }).layer })); return; }
    if (regenWerkzeug === "flaeche") setDraft((d) => [...d, p]);
  };
  const rhAbschliessen = () => {
    if (draft.length >= 3) setEntw((l) => ({ ...l, rueckhalt: neueFlaeche(l.rueckhalt, { art: regenArt, points: draft }).layer }));
    setDraft([]);
  };
  const { startDrag: startRhDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const p = rhToMeters.current?.(e);
      if (!p) return;
      setEntw((l) => ({ ...l, rueckhalt: d.kind === "el" ? verschiebeElement(l.rueckhalt, d.id, p) : verschiebeFlaechenPunkt(l.rueckhalt, d.id, d.idx, p) }));
    },
    onTap: (d) => setSelRH({ kind: d.kind, id: d.id }),
  });
  const loescheRH = () => {
    if (!selRH) return;
    setEntw((l) => ({ ...l, rueckhalt: selRH.kind === "el" ? loescheElement(l.rueckhalt, selRH.id) : loescheFlaeche(l.rueckhalt, selRH.id) }));
    setSelRH(null);
  };
  const setRegenZahl = (feld, v) => setEntw((l) => ({ ...l, regen: { ...l.regen, [feld]: v } }));
  const setRegenArtFl = (id, art) => setEntw((l) => ({ ...l, rueckhalt: aendereFlaeche(l.rueckhalt, id, { art }) }));

  // A_red from footprint + drawn site areas (aussenanlagen_layer, READ-ONLY).
  const aRedInput = useMemo(() => {
    const summen = flaechenSummen(aussenLayer);
    let gruen = 0, befestigt = 0;
    for (const [art, m2] of Object.entries(summen)) {
      if (GRUEN_ARTEN.includes(art)) gruen += m2;
      else if (art === "befestigt") befestigt += m2;
    }
    return { footArea, befestigt_m2: befestigt, gruen_m2: gruen };
  }, [aussenLayer, footArea]);
  const aRed = useMemo(() => abflusswirksam(aRedInput), [aRedInput]);
  const bilanz = useMemo(() => ueberflutung({ r30_100: regen.r30_100, aRed, qAb_ls: regen.qAb_ls, dauer_min: regen.dauer_min }), [regen, aRed]);
  const rhVol = useMemo(() => rueckhaltVolumen(rueckhalt), [rueckhalt]);
  const aDach = footArea; // flat roof = footprint [ASSUMED Attika]
  const notEntw = useMemo(() => notentwaesserung({
    r5_100: regen.r5_100, aDach, nAblaeufe: dach.ablaeufe.length, nNot: dach.notueberlaeufe.length,
  }), [regen.r5_100, aDach, dach.ablaeufe.length, dach.notueberlaeufe.length]);

  // --- Checks + Mengen ---------------------------------------------------------
  const gefChecks = useMemo(() => gefaelleChecks(gefPlan, { dachform, nNot: dach.notueberlaeufe.length }), [gefPlan, dachform, dach.notueberlaeufe.length]);
  const checks = useMemo(() => [
    ...entwaesserungChecks({ sw, gl, rueckstau, bilanz, rueckhalt: rhVol, not: notEntw, dachform }),
    ...gefChecks,
  ], [sw, gl, rueckstau, bilanz, rhVol, notEntw, dachform, gefChecks]);
  const mengenRoh = useMemo(() => entwaesserungMengen({
    gl, dach: { ablaeufe: dach.ablaeufe, notueberlaeufe: dach.notueberlaeufe },
    rueckstau: entw.rueckstau, rueckhalt: rhVol, gefaelleMengen: gefaelleMengen(gefPlan),
  }), [gl, dach, entw.rueckstau, rhVol, gefPlan]);
  // Dedupe by key: entwaesserungMengen AND gefaelleMengen both emit "ablaeufe"
  // (same drains counted by two libs) — the AVA list must not show a row twice.
  // First occurrence wins (the drainage lib's row carries the DN in its label).
  const mengen = useMemo(() => {
    const gesehen = new Set();
    return mengenRoh.filter((m) => {
      if (gesehen.has(m.key)) return false;
      gesehen.add(m.key);
      return true;
    });
  }, [mengenRoh]);

  if (!plan?.model) return null;
  const dachZeichnen = dachWerkzeug !== "auswahl";
  const dpe = dachZeichnen ? "none" : "auto";
  const regenZeichnen = regenWerkzeug !== "auswahl";
  const rpe = regenZeichnen ? "none" : "auto";
  const top = Math.max(0, (Number(plan?.storeys) || 1) - 1);

  return (
    <div className="space-y-4" data-testid="ew-plan">
      {/* Persistent liability disclaimer — never conditionally hidden (T-17-04). */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          <strong>{t("Entwässerungs-Konzept — keine Entwässerungsplanung, kein Nachweis nach DIN 1986-100 / DIN EN 12056.")}</strong>{" "}
          {t("Schmutz- und Regenwasserwerte sind Überschläge mit Richtwerten; die Genehmigungsfähige Planung erstellt ein Fachplaner.")}
        </span>
      </div>

      {/* --- Karte 1: Schmutzwasser & Rückstau --- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Droplet className="w-4 h-4 text-sky-600" /> {t("Schmutzwasser & Rückstau")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs text-slate-500">{t("Aus dem Konzept-Tab")}: <b>{we} {t("WE")}</b> · <b>{sanitaerJeWe} {t("Sanitärobjekte/WE")}</b></div>
              <div className="rounded-lg border bg-slate-50 p-3" data-testid="ew-sw" data-qww={sw.qww_ls} data-dn={sw.dn}>
                <div className="text-sm text-slate-700">ΣDU <b>{de(sw.sumDU, 1)}</b> → Q_ww <b>{de(sw.qww_ls, 2)} l/s</b></div>
                <div className="text-xs text-slate-500 mt-1">{t("Grundleitung")} <b>DN {sw.dn}</b> {t("bei")} ≥ {de(sw.gefaelleMin_pct, 1)} % <span className="text-slate-400">(DIN EN 12056-2, K = 0,5 [ASSUMED])</span></div>
              </div>
              {/* Rückstau (DIN 1986-100 §13) */}
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-sm font-medium text-slate-700">{t("Rückstauebene")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label={t("Rückstauebene")} value={entw.rueckstau.ebene_m} step={0.1} suffix="m" onChange={(v) => setRueckstauZahl("ebene_m", v)} />
                  <NumberField label={t("Kanalsohle")} value={entw.rueckstau.kanalsohle_m} step={0.1} suffix="m" onChange={(v) => setRueckstauZahl("kanalsohle_m", v)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500" htmlFor="ew-rueckstau-massnahme">{t("Maßnahme")}</label>
                  <select
                    id="ew-rueckstau-massnahme"
                    data-testid="ew-rueckstau-massnahme"
                    value={entw.rueckstau.massnahme}
                    onChange={(e) => setMassnahme(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  >
                    {Object.entries(RUECKSTAU_MASSNAHMEN).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2 rounded-md border p-2" data-testid="ew-rueckstau-status" data-status={rueckstau.status}>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${(T_STATUS[rueckstau.status] || T_STATUS.offen).dot}`} />
                  <span className="text-xs text-slate-600">{rueckstau.detail}</span>
                </div>
                {(kellerAktiv || tiefgarageAktiv) && (
                  <div className="text-[11px] text-slate-500">{t("Geführt aus Werkstatt-Layer")}: {kellerAktiv ? t("Keller") : ""}{kellerAktiv && tiefgarageAktiv ? " · " : ""}{tiefgarageAktiv ? t("Tiefgarage") : ""}</div>
                )}
              </div>
            </div>
            {/* Grundleitungen aus dem Netz (gewerk abwasser) */}
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-700">{t("Grundleitungen")} <span className="text-xs font-normal text-slate-400">({t("aus dem Netz, Gewerk Abwasser")})</span></div>
              {gl.kanten.length === 0 && <div className="text-xs text-slate-400">{t("Keine Abwasser-Leitungen — im Sub-Tab „Netz“ zeichnen.")}</div>}
              <div className="space-y-1.5 max-h-72 overflow-auto pr-1">
                {gl.kanten.map((k) => (
                  <div key={k.id} className="flex items-center gap-2 rounded border p-1.5 text-xs" data-testid="ew-grundleitung" data-id={k.id} data-gefaelle={k.gefaelle_pct}>
                    <span className="font-mono text-slate-600">{k.id}</span>
                    <span className="text-slate-500">DN {k.dn} · {de(k.L_m, 1)} m · {de(k.drop_m, 3)} m {t("Gefälle")}</span>
                    {k.override && <Badge className="bg-sky-100 text-sky-700 shrink-0">{t("Override")}</Badge>}
                    <label className="ml-auto flex items-center gap-1 shrink-0">
                      <span className="text-slate-400">%</span>
                      <input
                        type="number" step="0.1" min="0" value={k.gefaelle_pct}
                        data-testid="ew-gefaelle-input" data-id={k.id}
                        onChange={(e) => setGefaelle(k.id, e.target.value === "" ? null : Number(e.target.value))}
                        className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right tabular-nums"
                        aria-label={t("Gefälle-Override in Prozent")}
                      />
                    </label>
                  </div>
                ))}
              </div>
              {gl.kanten.length > 0 && (
                <div className="text-[11px] text-slate-500" data-testid="ew-grundleitung-summe">
                  {t("Längster Strang")} {de(gl.laengsterStrang_m, 1)} m · {t("Gefälle gesamt")} {de(gl.dropGesamt_m, 3)} m · {t("Sohle")} {de(gl.startsohle_m, 2)} → {de(gl.endsohle_m, 2)} m
                  {gl.anschluss ? ` · ${t("Übergabe")} ${gl.anschluss.name || gl.anschluss.id}` : ` · ${t("kein Kanalanschluss-Knoten")}`}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* --- Karte 2: Gefälledämmung --- */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><Ruler className="w-4 h-4 text-violet-600" /> {t("Gefälledämmung (Flachdach)")}</CardTitle>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant={dachWerkzeug === "auswahl" ? "default" : "outline"} onClick={() => { setDachWerkzeug("auswahl"); setSelDach(null); }} data-testid="ew-tool-auswahl"><Move className="w-3.5 h-3.5 mr-1" /> {t("Auswahl")}</Button>
              <Button size="sm" variant={dachWerkzeug === "ablauf" ? "default" : "outline"} onClick={() => { setDachWerkzeug("ablauf"); setSelDach(null); }} data-testid="ew-tool-ablauf"><Droplet className="w-3.5 h-3.5 mr-1" /> {t("Ablauf")}</Button>
              <Button size="sm" variant={dachWerkzeug === "not" ? "default" : "outline"} onClick={() => { setDachWerkzeug("not"); setSelDach(null); }} data-testid="ew-tool-not"><CloudRain className="w-3.5 h-3.5 mr-1" /> {t("Notüberlauf")}</Button>
              {selDach && <Button size="sm" variant="outline" className="text-red-600" onClick={loescheDach} data-testid="ew-loeschen"><Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}</Button>}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {dachform !== "flach"
              ? t("Dachform ist kein Flachdach — Gefälledämmung/Notentwässerung gelten für Flachdächer.")
              : dachWerkzeug === "ablauf" ? t("Ablauf-Werkzeug: in den Dachgrundriss klicken, um einen DN100-Ablauf zu setzen.")
              : dachWerkzeug === "not" ? t("Notüberlauf-Werkzeug: an die Attika klicken, um einen Notüberlauf zu setzen.")
              : t("Dickenkarte hell → dunkel, Grate zwischen Einzugsgebieten, Pfeile = Fließweg zum Ablauf. Punkte ziehen, Löschen nach Auswahl.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-[1fr_220px] gap-3">
            <div tabIndex={0} className="outline-none" onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && selDach) { e.preventDefault(); loescheDach(); } if (e.key === "Escape") setSelDach(null); }}>
              <BimPlan2D
                model={plan.model}
                mode="grundriss"
                level={top}
                storeyHeight={plan.storeyHeight}
                readOnly
                unit={plan.unit}
                height={420}
                overlayBounds={[...footprint, ...dach.ablaeufe, ...dach.notueberlaeufe]}
                overlay={({ X, Z, SCALE, toMeters, bounds }) => {
                  dachToMeters.current = toMeters;
                  const poly = (pts) => pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
                  const cell = RASTER_M * SCALE;
                  return (
                    <g data-testid="ew-dach-plan">
                      {/* roof outline (flat roof = footprint) */}
                      {footprint.length >= 3 && <polygon points={poly(footprint)} fill="#f8fafc" fillOpacity="0.4" stroke="#64748b" strokeWidth="1.2" />}
                      {/* thickness map: one rect per cell, light → dark by thickness */}
                      <g style={{ pointerEvents: "none" }}>
                        {gefPlan.zellen.map((c, i) => (
                          <rect key={i} data-testid="ew-zelle" data-d={c.d_m} data-idx={c.idx}
                            x={X(c.x) - cell / 2} y={Z(c.z) - cell / 2} width={cell} height={cell}
                            fill={dickenFarbe(c.d_m, gefPlan.dmin_m, gefPlan.dmax_m)} fillOpacity="0.85" stroke="none" />
                        ))}
                        {/* ridges between catchments */}
                        {gefPlan.grate.map((g, i) => (
                          <line key={i} data-testid="ew-grat" x1={X(g.a.x)} y1={Z(g.a.z)} x2={X(g.b.x)} y2={Z(g.b.z)} stroke="#0f172a" strokeWidth="1.4" />
                        ))}
                        {/* flow arrows (thinned by the lib) */}
                        {gefPlan.pfeile.map((p, i) => (
                          <line key={i} x1={X(p.x)} y1={Z(p.z)} x2={X(p.x + p.dx * 1.2)} y2={Z(p.z + p.dz * 1.2)} stroke="#2563eb" strokeWidth="1" markerEnd="url(#ew-pfeil)" opacity="0.7" />
                        ))}
                      </g>
                      <defs>
                        <marker id="ew-pfeil" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" /></marker>
                      </defs>
                      {/* roof drains */}
                      {dach.ablaeufe.map((a) => (
                        <g key={a.id} data-testid="ew-ablauf" data-id={a.id} style={{ pointerEvents: dpe, cursor: dachZeichnen ? "inherit" : "move" }}
                          onPointerDown={(ev) => { if (dachZeichnen || ev.button !== 0) return; ev.stopPropagation(); setSelDach({ id: a.id }); startDachDrag(ev, { id: a.id }); }}>
                          <circle cx={X(a.x)} cy={Z(a.z)} r={Math.max(4, 0.4 * SCALE)} fill="#0ea5e9" stroke={selDach?.id === a.id ? "#0f172a" : "#0369a1"} strokeWidth={selDach?.id === a.id ? 2.4 : 1.4} />
                          <text x={X(a.x)} y={Z(a.z) + 3} textAnchor="middle" fontSize="7" fill="#fff" style={{ pointerEvents: "none" }}>A</text>
                        </g>
                      ))}
                      {/* emergency overflows */}
                      {dach.notueberlaeufe.map((n) => (
                        <g key={n.id} data-testid="ew-not" data-id={n.id} style={{ pointerEvents: dpe, cursor: dachZeichnen ? "inherit" : "move" }}
                          onPointerDown={(ev) => { if (dachZeichnen || ev.button !== 0) return; ev.stopPropagation(); setSelDach({ id: n.id }); startDachDrag(ev, { id: n.id }); }}>
                          <rect x={X(n.x) - Math.max(4, 0.4 * SCALE)} y={Z(n.z) - Math.max(4, 0.4 * SCALE)} width={2 * Math.max(4, 0.4 * SCALE)} height={2 * Math.max(4, 0.4 * SCALE)} fill="#f59e0b" stroke={selDach?.id === n.id ? "#0f172a" : "#b45309"} strokeWidth={selDach?.id === n.id ? 2.4 : 1.4} />
                          <text x={X(n.x)} y={Z(n.z) + 3} textAnchor="middle" fontSize="7" fill="#fff" style={{ pointerEvents: "none" }}>N</text>
                        </g>
                      ))}
                      {/* click surface for the draw tools */}
                      {dachZeichnen && (
                        <rect x="0" y="0" width={X(bounds.maxX) + X(bounds.minX)} height={Z(bounds.maxZ) + Z(bounds.minZ)} fill="transparent" style={{ cursor: "crosshair" }}
                          onClick={(e) => { const p = toMeters(e); if (p) dachKlick(p); }} />
                      )}
                    </g>
                  );
                }}
              />
            </div>
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t("Gefälle")} value={dach.gefaelle_pct} step={0.5} suffix="%" min={0.5} onChange={(v) => setDachZahl("gefaelle_pct", v)} />
                <NumberField label={t("Dicke min")} value={dach.dmin_m} step={0.01} suffix="m" min={0.02} onChange={(v) => setDachZahl("dmin_m", v)} />
              </div>
              <div className="rounded border bg-slate-50 p-2 space-y-1">
                <div className="flex justify-between" data-testid="ew-dach-dmax" data-dmin={gefPlan.dmin_m} data-dmax={gefPlan.dmax_m}><span className="text-slate-500">{t("Dicke min/max")}</span><b>{de(gefPlan.dmin_m, 3)} / {de(gefPlan.dmax_m, 3)} m</b></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("Dachfläche")}</span><b>{de(gefPlan.flaeche_m2)} m²</b></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("Volumen Dämmung")}</span><b>{de(gefPlan.volumen_m3, 1)} m³</b></div>
                <div className="flex justify-between" data-testid="ew-dach-u" data-umin={uWerte.uMin} data-umax={uWerte.uMax}><span className="text-slate-500">U {t("min/max")}</span><b>{de(uWerte.uMin, 3)} / {de(uWerte.uMax, 3)}</b></div>
                <div className="text-[10px] text-slate-400">W/(m²K) · {uWerte.aufbau}</div>
              </div>
              {/* thickness tiers */}
              <div className="space-y-0.5" data-testid="ew-dach-staffeln">
                <div className="font-medium text-slate-600">{t("Dickenstaffeln")}</div>
                {gefPlan.staffeln.length === 0 && <div className="text-slate-400">{t("Keine Abläufe gesetzt.")}</div>}
                {gefPlan.staffeln.map((s, i) => (
                  <div key={i} className="flex justify-between border-b border-slate-100 py-0.5" data-von={s.von} data-bis={s.bis} data-m2={s.m2}>
                    <span className="text-slate-500">{de(s.von, 2)}–{de(s.bis, 2)} m</span><span>{de(s.m2)} m²</span>
                  </div>
                ))}
              </div>
              {/* per-drain list */}
              <div className="flex flex-wrap gap-1.5" data-testid="ew-liste-ablaeufe">
                {dach.ablaeufe.map((a) => (
                  <button key={a.id} type="button" data-id={a.id} onClick={() => { setDachWerkzeug("auswahl"); setSelDach({ id: a.id }); }}
                    className={`rounded border px-1.5 py-0.5 ${selDach?.id === a.id ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="inline-block w-2 h-2 rounded-full mr-1 bg-sky-500" />{t("Ablauf")} · {a.id}
                  </button>
                ))}
                {dach.notueberlaeufe.map((n) => (
                  <button key={n.id} type="button" data-id={n.id} onClick={() => { setDachWerkzeug("auswahl"); setSelDach({ id: n.id }); }}
                    className={`rounded border px-1.5 py-0.5 ${selDach?.id === n.id ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="inline-block w-2 h-2 rounded-sm mr-1 bg-amber-500" />{t("Notüberlauf")} · {n.id}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* --- Karte 3: Jahrhundertregen & Rückhalt --- */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><CloudRain className="w-4 h-4 text-cyan-600" /> {t("Jahrhundertregen & Rückhalt")}</CardTitle>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant={regenWerkzeug === "auswahl" ? "default" : "outline"} onClick={() => { setRegenWerkzeug("auswahl"); setDraft([]); setSelRH(null); }} data-testid="ew-tool-auswahl2"><Move className="w-3.5 h-3.5 mr-1" /> {t("Auswahl")}</Button>
              <Button size="sm" variant={regenWerkzeug === "flaeche" ? "default" : "outline"} onClick={() => { setRegenWerkzeug("flaeche"); setSelRH(null); }} data-testid="ew-tool-rueckhalt"><Droplet className="w-3.5 h-3.5 mr-1" /> {t("Rückhalt-Fläche")}</Button>
              <Button size="sm" variant={regenWerkzeug === "zisterne" ? "default" : "outline"} onClick={() => { setRegenWerkzeug("zisterne"); setSelRH(null); setDraft([]); }} data-testid="ew-tool-zisterne"><Droplet className="w-3.5 h-3.5 mr-1" /> {t("Zisterne")}</Button>
              {regenWerkzeug === "flaeche" && (
                <>
                  <select value={regenArt} onChange={(e) => setRegenArt(e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" data-testid="ew-regen-art" aria-label={t("Rückhalt-Art")}>
                    {Object.values(REGEN_ARTEN).map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} aria-label={t("Letzten Punkt entfernen")}><Undo2 className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-emerald-700" onClick={rhAbschliessen} disabled={draft.length < 3} data-testid="ew-abschliessen"><Check className="w-4 h-4 mr-1" /> {t("Abschließen")}</Button>
                </>
              )}
              {selRH && <Button size="sm" variant="outline" className="text-red-600" onClick={loescheRH} data-testid="ew-loeschen-rh"><Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}</Button>}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {regenWerkzeug === "flaeche" ? t("Ecken der Rückhalt-Fläche klicken (mind. drei), dann Abschließen. Mulde/Rigole zählen als Speichervolumen.")
              : regenWerkzeug === "zisterne" ? t("Zisterne im Katalog wählen, dann in den Lageplan klicken.")
              : t("Gebäude grau, Parzelle grün gestrichelt. Flächen- und Zisternen-Punkte ziehen, Löschen nach Auswahl.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`grid gap-3 ${regenWerkzeug === "zisterne" ? "lg:grid-cols-[1fr_240px]" : ""}`}>
            <div tabIndex={0} className="outline-none" onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && selRH) { e.preventDefault(); loescheRH(); } if (e.key === "Escape") { setDraft([]); setSelRH(null); } }}>
              <LageplanPlan
                plan={plan}
                parzelleM={parzelleM}
                extraBounds={[...rueckhalt.elemente, ...rueckhalt.flaechen.flatMap((f) => f.points), ...draft]}
                onKlick={regenZeichnen ? regenKlick : undefined}
                testid="ew-regen-plan"
                overlay={({ X, Z, SCALE, toMeters }) => {
                  rhToMeters.current = toMeters;
                  const poly = (pts) => pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
                  return (
                    <g>
                      {/* retention areas */}
                      {rueckhalt.flaechen.map((f) => {
                        const a = REGEN_ARTEN[f.art] || REGEN_ARTEN.mulde;
                        const m2 = polygonFlaecheM2(f.points);
                        const m3 = Math.round(m2 * (a.m3JeM2 || 0) * 10) / 10;
                        const istSel = selRH?.kind === "fl" && selRH.id === f.id;
                        const c = centroid(f.points);
                        return (
                          <g key={f.id} data-testid="ew-rueckhalt-fl" data-id={f.id} data-art={f.art} data-m3={m3} style={{ pointerEvents: rpe, cursor: regenZeichnen ? "inherit" : "pointer" }}
                            onClick={(ev) => { if (!regenZeichnen) { ev.stopPropagation(); setSelRH({ kind: "fl", id: f.id }); } }}>
                            <polygon points={poly(f.points)} fill={a.farbe} fillOpacity="0.5" stroke={istSel ? "#0f172a" : a.farbe} strokeWidth={istSel ? 2 : 1} />
                            <text x={X(c.x)} y={Z(c.z)} textAnchor="middle" fontSize="8" fontWeight="600" fill="#1e293b" style={{ pointerEvents: "none" }}>{de(m3, 1)} m³</text>
                            {istSel && !regenZeichnen && f.points.map((p, i) => (
                              <circle key={i} cx={X(p.x)} cy={Z(p.z)} r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" style={{ cursor: "move" }}
                                onPointerDown={(ev) => { if (ev.button !== 0) return; ev.stopPropagation(); startRhDrag(ev, { kind: "fl", id: f.id, idx: i }); }} />
                            ))}
                          </g>
                        );
                      })}
                      {/* draft area */}
                      {draft.length > 0 && (
                        <g style={{ pointerEvents: "none" }}>
                          {draft.length >= 3
                            ? <polygon points={poly(draft)} fill={(REGEN_ARTEN[regenArt] || REGEN_ARTEN.mulde).farbe} fillOpacity="0.25" stroke="#0891b2" strokeWidth="1.5" strokeDasharray="4 3" />
                            : <polyline points={poly(draft)} fill="none" stroke="#0891b2" strokeWidth="1.5" strokeDasharray="4 3" />}
                          {draft.map((p, i) => <circle key={i} cx={X(p.x)} cy={Z(p.z)} r="2.5" fill="#0891b2" />)}
                        </g>
                      )}
                      {/* cisterns (point elements) */}
                      {rueckhalt.elemente.map((e) => {
                        const ty = REGEN_TYPEN[e.typ];
                        const r = Math.max(4, ((ty?.radius_m || 1) ) * SCALE);
                        const istSel = selRH?.kind === "el" && selRH.id === e.id;
                        return (
                          <g key={e.id} data-testid="ew-rueckhalt-el" data-id={e.id} data-typ={e.typ} data-m3={ty?.volumen_m3 || 0} style={{ pointerEvents: rpe, cursor: regenZeichnen ? "inherit" : "move" }}
                            onPointerDown={(ev) => { if (regenZeichnen || ev.button !== 0) return; ev.stopPropagation(); setSelRH({ kind: "el", id: e.id }); startRhDrag(ev, { kind: "el", id: e.id }); }}>
                            <circle cx={X(e.x)} cy={Z(e.z)} r={r} fill="#38bdf8" fillOpacity="0.6" stroke={istSel ? "#0f172a" : "#0284c7"} strokeWidth={istSel ? 2 : 1.2} />
                            <text x={X(e.x)} y={Z(e.z) + r + 8} textAnchor="middle" fontSize="7" fill="#1e293b" style={{ pointerEvents: "none" }}>{ty?.name || e.typ}</text>
                          </g>
                        );
                      })}
                    </g>
                  );
                }}
              />
            </div>
            {regenWerkzeug === "zisterne" && (
              <div className="space-y-2">
                <div className="text-[11px] text-slate-600">{t("Gewählt")}: <b>{REGEN_TYPEN[zisterne]?.name}</b> · {de(REGEN_TYPEN[zisterne]?.volumen_m3)} m³</div>
                <KatalogPanel titel={t("Zisternen")} katalog={REGEN_KATALOG} onAdd={setZisterne}
                  chipTitle={(ty) => `${ty.name} · ${ty.volumen_m3} m³`}
                  renderChip={(ty) => <span className={ty.id === zisterne ? "font-semibold text-sky-800" : ""} data-testid={`ew-chip-${ty.id}`}>{ty.name}</span>} />
              </div>
            )}
          </div>

          {/* rain inputs + balance + emergency roof drainage */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="r(5,100)" value={regen.r5_100} step={10} suffix="l/(s·ha)" min={0} onChange={(v) => setRegenZahl("r5_100", v)} />
                <NumberField label="r(30,100)" value={regen.r30_100} step={10} suffix="l/(s·ha)" min={0} onChange={(v) => setRegenZahl("r30_100", v)} />
                <NumberField label={t("zul. Abfluss")} value={regen.qAb_ls} step={0.5} suffix="l/s" min={0} onChange={(v) => setRegenZahl("qAb_ls", v)} />
                <NumberField label={t("Dauer")} value={regen.dauer_min} step={5} suffix="min" min={1} onChange={(v) => setRegenZahl("dauer_min", v)} />
              </div>
              <div className="rounded-lg border bg-slate-50 p-2 text-xs space-y-1" data-testid="ew-bilanz" data-vrueck={bilanz.vRueck_m3} data-vvorh={rhVol.gesamt_m3} data-status={bilanz.vRueck_m3 <= 0 ? "pass" : rhVol.gesamt_m3 <= 0 ? "offen" : rhVol.gesamt_m3 >= bilanz.vRueck_m3 ? "pass" : "warn"}>
                <div className="font-medium text-slate-700">{t("Überflutungsnachweis (DIN 1986-100, vereinfacht)")}</div>
                <div className="flex justify-between"><span className="text-slate-500">A_red</span><b>{de(aRed, 1)} m²</b></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("Zufluss")}</span><b>{de(bilanz.zufluss_ls, 1)} l/s</b></div>
                <div className="flex justify-between"><span className="text-slate-500">V {t("erforderlich")}</span><b>{de(bilanz.vRueck_m3, 1)} m³</b></div>
                <div className="flex justify-between"><span className="text-slate-500">V {t("vorhanden")}</span><b>{de(rhVol.gesamt_m3, 1)} m³</b></div>
                {rhVol.zisternen > 0 && <div className="text-[11px] text-slate-400">{rhVol.zisternen} {t("Zisterne(n)")}</div>}
              </div>
            </div>
            <div className="space-y-2">
              <div className="rounded-lg border bg-slate-50 p-2 text-xs space-y-1" data-testid="ew-not-status" data-status={notEntw.status}>
                <div className="font-medium text-slate-700">{t("Notentwässerung (r 5,100)")}</div>
                <div className="flex justify-between"><span className="text-slate-500">Q {t("Dach")}</span><b>{de(notEntw.qDach_ls, 1)} l/s</b></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("Abläufe")}</span><b>{de(notEntw.qAblaeufe_ls, 1)} l/s ({dach.ablaeufe.length})</b></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("erforderlich Not")}</span><b>{de(notEntw.qNotErf_ls, 1)} l/s</b></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("Notüberläufe")}</span><b>{de(notEntw.qNotVorh_ls, 1)} l/s ({dach.notueberlaeufe.length})</b></div>
                <div className="text-[11px] text-slate-400">{t("Notüberläufe frei auf schadlos überflutbare Fläche.")}</div>
              </div>
              <div className="rounded-lg border bg-slate-50 p-2 text-xs" data-testid="ew-rueckhalt-summen">
                <div className="font-medium text-slate-700 mb-1">{t("Rückhalt je Art")}</div>
                {Object.keys(rhVol.je).length === 0 && <div className="text-slate-400">{t("Noch kein Rückhalt gezeichnet.")}</div>}
                {Object.entries(rhVol.je).map(([art, m3]) => (
                  <div key={art} className="flex justify-between border-b border-slate-100 py-0.5"><span className="text-slate-500">{art === "zisterne" ? t("Zisternen") : t(REGEN_ARTEN[art]?.name || art)}</span><b>{de(m3, 1)} m³</b></div>
                ))}
              </div>
            </div>
          </div>

          {/* retention lists */}
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-semibold text-slate-700 mb-1">{t("Rückhalt-Flächen")} ({rueckhalt.flaechen.length})</div>
              <div className="flex flex-wrap gap-1.5" data-testid="ew-liste-flaechen">
                {rueckhalt.flaechen.map((f) => (
                  <button key={f.id} type="button" data-id={f.id} onClick={() => { setRegenWerkzeug("auswahl"); setSelRH({ kind: "fl", id: f.id }); }}
                    className={`rounded border px-1.5 py-0.5 ${selRH?.kind === "fl" && selRH.id === f.id ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: (REGEN_ARTEN[f.art] || REGEN_ARTEN.mulde).farbe }} />{t(REGEN_ARTEN[f.art]?.name || f.art)} · {de(polygonFlaecheM2(f.points))} m²
                  </button>
                ))}
              </div>
              {selRH?.kind === "fl" && (
                <select value={rueckhalt.flaechen.find((f) => f.id === selRH.id)?.art || "mulde"} onChange={(e) => setRegenArtFl(selRH.id, e.target.value)} className="mt-1.5 h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs" aria-label={t("Rückhalt-Art ändern")}>
                  {Object.values(REGEN_ARTEN).map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                </select>
              )}
            </div>
            <div>
              <div className="font-semibold text-slate-700 mb-1">{t("Zisternen")} ({rueckhalt.elemente.length})</div>
              <div className="flex flex-wrap gap-1.5" data-testid="ew-liste-elemente">
                {rueckhalt.elemente.map((e) => (
                  <button key={e.id} type="button" data-id={e.id} onClick={() => { setRegenWerkzeug("auswahl"); setSelRH({ kind: "el", id: e.id }); }}
                    className={`rounded border px-1.5 py-0.5 ${selRH?.kind === "el" && selRH.id === e.id ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="inline-block w-2 h-2 rounded-full mr-1 bg-sky-400" />{REGEN_TYPEN[e.typ]?.name || e.typ} · {e.id}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* --- Checks + Mengen (AVA-Übergabe) --- */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gauge className="w-4 h-4" /> {t("Prüfungen")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1.5" data-testid="ew-checks">
              {checks.map((c) => { const st = T_STATUS[c.status] || T_STATUS.offen; return (
                <div key={c.key} className="flex items-center gap-2 rounded-lg border p-2" data-status={c.status}>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                  <div className="flex-1 min-w-0"><div className="text-sm font-medium text-slate-800">{c.label}</div><div className="text-[11px] text-slate-500">{c.detail}</div></div>
                  <Badge className={`${st.color} shrink-0`}>{st.label}</Badge>
                </div>
              ); })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Ruler className="w-4 h-4" /> {t("Mengen (AVA-Übergabe)")}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-0.5 text-xs" data-testid="ew-mengen">
              {mengen.length === 0 && <div className="text-slate-400">{t("Noch keine Mengen — Netz, Abläufe oder Rückhalt anlegen.")}</div>}
              {mengen.map((m, i) => (
                // Index in the key: entwaesserungMengen and gefaelleMengen can
                // both emit a row keyed "ablaeufe" (drains counted twice from
                // two libs) — duplicate React keys warned on render.
                <div key={`${m.key}-${i}`} className="flex justify-between border-b border-slate-100 py-0.5" data-testid="ew-menge" data-key={m.key} data-menge={m.menge}>
                  <span className="text-slate-600">{m.label}</span><span className="tabular-nums">{de(m.menge, 1)} {m.einheit}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
