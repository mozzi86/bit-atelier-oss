// Wohnungs-Fokusansicht (TESS-07 + 75-09 Blatt 07, MS-09): Einzel-WE-Detailplan
// mit echtem 1:50-Arbeitsmaßstab, Räumen, zweizeiligen Labels in echten
// Bildschirm-px (MSB-12/MSB-16), Maßketten, 5-m-Balken, abgedimmten Nachbar-WEs
// und Sprungbrettern zu Innenausbau und den Checks dieser einen WE.
//
// 75-09: Maßstab-Chip „1:50 | Auto" (UI-Zustand, kein Store-Feld — Muster 75-05);
// „Auto" = das heutige Einpassen auf die WE und bleibt der Zustand beim Öffnen
// [ASSUMED: eine WE ist bei 1:50 breiter als die Planspalte]. Der Fokus schreibt
// NIE in den Store und nie direkt in complexData (Task 6: nur Callbacks nach oben).
//
// In:  plan (usePlanModel), we (Schlüssel „WE 0-1"), zonen (Store-Räume),
//      checks (checksJeWe-Eintrag), nonce (Zoom-Trigger der Werkstatt).
// Out: Rendering. Fenster/Türen der Hülle rendert BimPlan2D selbst (envOpenings).

import React, { useMemo, useRef, useState } from "react";
import { ArrowLeft, Sofa, ListChecks, AlertTriangle, RotateCw, Trash2, FlipHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useI18n } from "@core/lib/i18n";
import { polygonAreaM } from "@core/lib/useBuildingProgram";
import { kurzRaumname, lodFuer, labelKollision } from "@designer/lib/massstab";
import { CSS_PX_JE_M } from "@designer/lib/isoKamera";
import BimPlan2D from "./BimPlan2D";
import MoebelSchicht from "./MoebelSchicht";
import Masskette from "./Masskette";
import { seiteVon } from "@designer/lib/masskette";
import KatalogPanel from "./KatalogPanel";
import { MoebelLegende } from "./MoebelDraufsicht";
// 75-09 Task 6: furniture data path — the focus writes ONLY through
// onMoeblierungChange (never the store, never complexData directly).
import {
  zoneKey, moebelFuerZone, mitMoebelFuerZone, verschiebeItem, setzeEigeneTypen,
  kollisionsWarnungen, MOEBEL_RASTER, moebelById,
} from "@designer/lib/moebel";
import {
  bewegungsflaechen, fensterSegmente, sperrGrund, anWandEinrasten, wohnMoebelChecks,
  autoMoeblierung, istAutoItem, fokusKatalog, platziereTyp, platziereTuer,
  BEWEGUNG_STUFEN, STUFE_DEFAULT, bewegungsNachweis,
} from "@designer/lib/wohnMoebel";
import { oeffnungenAmRaum } from "@designer/lib/raumOeffnungen";
// 75-09 Task 7: KPI column (proportion rule from @core — one source) + the
// unit iso (isoSzeneAusModell maps model metres into the MassingView3D frame).
import { istAchsparallelesRechteck, proportionHinweis, PHI_AUSNAHMEN } from "@core/lib/proportion";
import { isoSzeneAusModell } from "@designer/lib/isoKamera";
import MassingView3D from "./MassingView3D";
// 75-14: zone doors (MSB-14/17), wardrobe-wall marker, quality list; door-swing
// toggles run over the shared undo stack (UNDO-01) — the host owns the data.
import ZonenTueren from "./ZonenTueren";
import { kantenVon } from "@designer/lib/wohnungsErschliessung";
import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";

const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 2 });

const WT_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

// [ASSUMED] plan height in CSS px: 560 in fixed-scale mode (visible window
// ≈ 6.6 m at 1:50 — enough to read a room), 420 in Auto mode (today's value).
const HOEHE_1_50 = 560;
const HOEHE_AUTO = 420;
// Referentially-stable empty list for MassingView3D's required `setbacks` prop
// (the focus iso has no setback strips). NOT frozen — a frozen array would be
// typed `readonly` and fail the prop type (75-08 lesson, KEINE pattern).
const KEINE_SETBACKS = [];

// Bounding-Box einer Zonen-Liste (Meter).
function zonenBBox(zonen) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const z of zonen) {
    for (const p of z.points || []) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ };
}

/**
 * Apartment focus view (TESS-07 + 75-09).
 * @param {object} p
 * @param {object} p.plan usePlanModel result
 * @param {string} p.we focused unit key ("WE 0-1")
 * @param {Array<object>} p.zonen store zones of all levels
 * @param {object|null} p.checks checksJeWe entry for this unit
 * @param {number} p.nonce zoom trigger from the workshop
 * @param {() => void} p.onClose
 * @param {() => void} p.onGotoInnenausbau
 * @param {() => void} [p.onGotoChecks]
 * @param {Record<string, Array<object>>} [p.moeblierung] complexData.moeblierung (75-09)
 * @param {Array<object>} [p.moebelEigene] complexData.moebel_eigene (75-09)
 * @param {(m: Record<string, Array<object>>) => void} [p.onMoeblierungChange]
 *   the ONE write path (75-09) — without it the focus only displays furniture
 * @param {boolean} [p.speicherbar] draft has name + location ("save draft" possible)
 * @param {object|null} [p.woflv] woflvJeWe entry for this unit (Task 7 — one calc path)
 * @param {number} [p.personen] occupant count of the unit type (auto-furnishing, Task 6)
 * @param {boolean} [p.fensterNaeherung] window rule is OFF → daylight KPI is an approximation (Task 7)
 * @param {Record<string, "links"|"rechts">|null} [p.tuerAufschlaege] 75-14: door swing overrides (werkstatt_layer)
 * @param {(m: Record<string, "links"|"rechts">) => void} [p.onTuerAufschlaegeChange] 75-14: the ONE write path for swings
 * @param {{eintraege: Array<object>, zaehler: {ok:number, warn:number, fail:number}}|null} [p.qualitaet]
 *   75-14: raumQualitaet.pruefeWohnung result of this unit (computed by the workshop — one calc path)
 * @param {(zone: object) => boolean} [p.balkonAktiv] 75-13: is the balcony switch of this room on (workshop reads the layer)
 * @param {(zone: object, an: boolean) => void} [p.onBalkonToggle] 75-13: the ONE write path for the balcony switch
 */
export default function WohnungsFokus({
  plan, we, zonen, checks, nonce, onClose, onGotoInnenausbau, onGotoChecks,
  moeblierung, moebelEigene, onMoeblierungChange, speicherbar,
  woflv = null, personen = 2, fensterNaeherung = false,
  tuerAufschlaege = null, onTuerAufschlaegeChange, qualitaet = null,
  balkonAktiv, onBalkonToggle,
}) {
  const { t } = useI18n();
  const fokusNonce = useRef(0);

  // ---- 75-14: door swings over the undo stack --------------------------------
  // Snapshots are the whole override map (small, JSON-comparable). The stack is
  // local to this focus session; the data itself lives in werkstatt_layer via the
  // host callback — the tesselation re-reads it, so the plan redraws from data.
  const tuerStack = useRef(leererStack());
  const [tuerStand, setTuerStand] = useState({ p: 0, f: 0 });
  const tuerSync = () => setTuerStand({ p: tuerStack.current.past.length, f: tuerStack.current.future.length });
  const tuerEditierbar = typeof onTuerAufschlaegeChange === "function";
  const aufschlagMap = tuerAufschlaege && typeof tuerAufschlaege === "object" ? tuerAufschlaege : {};
  const tuerToggle = (zoneName, idx, tuer) => {
    if (!tuerEditierbar) return;
    const key = `${level}|${zoneName}|${idx}`;
    tuerStack.current = merke(tuerStack.current, aufschlagMap);
    onTuerAufschlaegeChange({ ...aufschlagMap, [key]: tuer?.aufschlag === "rechts" ? "links" : "rechts" });
    tuerSync();
  };
  const tuerUndo = () => {
    const r = zurueck(tuerStack.current, aufschlagMap);
    if (!r || !tuerEditierbar) return;
    tuerStack.current = r.stack; onTuerAufschlaegeChange(r.snapshot || {}); tuerSync();
  };
  const tuerRedo = () => {
    const r = vor(tuerStack.current, aufschlagMap);
    if (!r || !tuerEditierbar) return;
    tuerStack.current = r.stack; onTuerAufschlaegeChange(r.snapshot || {}); tuerSync();
  };

  // 75-09 Task 5: scale mode — null = "Auto" (fit the unit, today's behaviour
  // and the state on open). 50 = fixed 1:50 (pxJeMeter(50) ≈ 75.59 CSS px/m).
  const [massstab, setMassstab] = useState(null);
  // Local click counter: re-firing the SAME scale (after free zooming) must
  // re-centre the plan — BimPlan2D's scale effect listens on focus.nonce.
  const [chipKlick, setChipKlick] = useState(0);

  // 75-13: balcony zones of the unit are drawn (hatch) but are not rooms —
  // they stay out of the room lists, areas, furniture and dimension chains.
  const fokusZonen = useMemo(() => (zonen || []).filter((z) => z.we === we && z.raumart !== "balkon"), [zonen, we]);
  const balkonZonen = useMemo(() => (zonen || []).filter((z) => z.we === we && z.raumart === "balkon"), [zonen, we]);
  const nachbarZonen = useMemo(() => (zonen || []).filter((z) => z.level === (fokusZonen[0]?.level ?? 0) && z.we && z.we !== we && z.raumart !== "balkon"), [zonen, we, fokusZonen]);
  const bbox = useMemo(() => zonenBBox([...fokusZonen, ...balkonZonen]), [fokusZonen, balkonZonen]);
  const gesamtFlaeche = fokusZonen.reduce((s, z) => s + (z.flaeche_m2 ?? polygonAreaM(z.points)), 0);
  const flurZonen = fokusZonen.filter((z) => z.raumart === "flur");
  const wohnZonen = fokusZonen.filter((z) => z.raumart !== "flur");

  const level = fokusZonen[0]?.level ?? 0;

  // focus-Prop für BimPlan2D: bei neuem nonce auf die WE-BBox zoomen; im
  // Maßstabsmodus fährt der Maßstab-Effekt von BimPlan2D (Task 2) dieselbe
  // BBox-Mitte an — der Chip-Klick-Zähler gibt die „erneut anfahren"-Nonce
  // (zweiter Klick auf denselben Chip stellt 1:50 nach freiem Zoom wieder her).
  const focus = bbox
    ? { nonce: (nonce || ++fokusNonce.current) + chipKlick, bbox }
    : { nonce: chipKlick, reset: true };

  const st = checks ? (WT_STATUS[checks.status] || WT_STATUS.offen) : WT_STATUS.offen;

  // ---- 75-09 Task 6: furniture in the focus -----------------------------------
  // Editable ONLY through onMoeblierungChange (host wiring → updateComplexData
  // ('moeblierung', …) — the focus NEVER writes the store or complexData).
  const editierbar = typeof onMoeblierungChange === "function";
  // Custom types into the register (InteriorDesigner pattern :238) so
  // moebelById/itemRect know them during this render.
  setzeEigeneTypen(moebelEigene || []);

  const [sel, setSel] = useState(null);          // { key, id } of the selected item
  const [aktivKey, setAktivKey] = useState(null); // active room key (catalogue target)
  const [sperre, setSperre] = useState(true);     // blocking collision ON [ASSUMED default]
  const [stufe, setStufe] = useState(STUFE_DEFAULT); // movement-area level
  const [sperrHinweis, setSperrHinweis] = useState(null); // why a move was rejected
  const [autoHinweise, setAutoHinweise] = useState([]);   // auto-furnishing notes

  /** Items of one focus zone (moeblierung keys level:name — ·WT zones carry no id). */
  const itemsFuerZone = (z) => moebelFuerZone(moeblierung, z);
  /** Window segments per zone key — the openings BimPlan2D shows in the focus
   *  (autoEnvOpenings; NOT the workshop ticks — 75-11 boundary, SUMMARY note). */
  const fensterJeZone = useMemo(() => {
    const map = new Map();
    for (const z of fokusZonen) {
      const oeff = oeffnungenAmRaum(z, {
        walls: plan?.model?.walls, envOpenings: plan?.envOpenings, entranceCfg: plan?.entranceCfg,
        customWalls: plan?.customWalls, customWindows: plan?.customWindows,
      });
      map.set(zoneKey(z), fensterSegmente(oeff));
    }
    return map;
  }, [fokusZonen, plan]);
  const fensterFuer = (z) => fensterJeZone.get(zoneKey(z)) || [];

  /** Collision ids (red overlay) from the UNCHANGED kollisionsWarnungen (warn). */
  const kollisionIds = useMemo(() => {
    const set = new Set();
    for (const z of fokusZonen) {
      for (const w of kollisionsWarnungen(itemsFuerZone(z))) {
        (w.itemIds || []).forEach((id) => set.add(id));
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusZonen, moeblierung]);

  /** Warnings per room: wohnMoebelChecks (movement areas, doors, windows) PLUS
   *  kollisionsWarnungen (body overlaps) — the same amber list content as
   *  MoeblierungsPlan (moebelChecks + koll); both are warn-only, never fail. */
  const warnungen = useMemo(() => {
    const out = [];
    for (const z of fokusZonen) {
      const items = itemsFuerZone(z);
      if (!items.length) continue;
      const raum = kurzRaumname(z.name);
      const key = zoneKey(z);
      for (const w of wohnMoebelChecks(items, z.points, stufe, { fenster: fensterFuer(z) })) {
        out.push({ ...w, raum, key });
      }
      for (const w of kollisionsWarnungen(items)) {
        out.push({ ...w, raum, key });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusZonen, moeblierung, stufe, fensterJeZone]);

  const zoneZuKey = (key) => fokusZonen.find((z) => zoneKey(z) === key) || null;

  /** The ONE write path: replace one zone's items inside complexData.moeblierung. */
  const schreibe = (zone, items) => {
    if (!editierbar) return;
    onMoeblierungChange(mitMoebelFuerZone(moeblierung, zone, items));
  };

  /**
   * Try to place `kandidat` (move / rotate / toggle): with `sperre` ON a
   * sperrGrund rejects the change (the item stays at its last valid spot and
   * fk-sperre-hinweis names the reason); OFF = warning only (data-kollision).
   * @param {object} zone
   * @param {object} kandidat candidate item (same id as the original)
   * @returns {boolean} written?
   */
  const versucheSetzen = (zone, kandidat) => {
    const items = itemsFuerZone(zone);
    if (sperre) {
      const grund = sperrGrund(items, kandidat, zone.points, { fenster: fensterFuer(zone) });
      if (grund) { setSperrHinweis(grund.text); return false; }
    }
    setSperrHinweis(null);
    schreibe(zone, items.map((it) => (it.id === kandidat.id ? kandidat : it)));
    return true;
  };

  /** Drag/arrow move — raw metres from the layer; snapping happens here. */
  const bewege = (key, id, xM, yM) => {
    const zone = zoneZuKey(key);
    if (!zone || !editierbar) return;
    const it = itemsFuerZone(zone).find((x) => x.id === id);
    if (!it) return;
    const kandidat = anWandEinrasten(verschiebeItem(it, xM, yM), zone.points);
    versucheSetzen(zone, kandidat);
  };
  /** Rotate +90° (double-click, button, R key) through the same gate. */
  const drehe = (key, id) => {
    const zone = zoneZuKey(key);
    if (!zone || !editierbar) return;
    const it = itemsFuerZone(zone).find((x) => x.id === id);
    if (!it) return;
    versucheSetzen(zone, { ...it, rot: (((it.rot || 0) + 90) % 360) });
  };
  /** Door swing side links ↔ rechts (MSB-14). */
  const wechsleAnschlag = (key, id) => {
    const zone = zoneZuKey(key);
    if (!zone || !editierbar) return;
    const it = itemsFuerZone(zone).find((x) => x.id === id);
    if (!it || !moebelById(it.typ)?.tuer) return;
    versucheSetzen(zone, { ...it, aufschlag: it.aufschlag === "rechts" ? "links" : "rechts" });
  };
  const loesche = (key, id) => {
    const zone = zoneZuKey(key);
    if (!zone || !editierbar) return;
    schreibe(zone, itemsFuerZone(zone).filter((x) => x.id !== id));
    setSel(null);
  };
  /** Catalogue insert into the ACTIVE room: doors via platziereTuer (on the
   *  longest wall, swing into the room), everything else via platziereTyp.
   *  null → "kein freier Platz" hint instead of forcing a collision. */
  const fuegeEin = (typId) => {
    const zone = zoneZuKey(aktivKey);
    if (!zone || !editierbar) return;
    const items = itemsFuerZone(zone);
    const nr = `fk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const fenster = fensterFuer(zone);
    const platziert = moebelById(typId)?.tuer
      ? platziereTuer(zone, items, typId, { idPrefix: nr, nr: 1 })
      : platziereTyp(zone, items, typId, { stufe, fenster, idPrefix: nr, nr: 1 });
    if (!platziert) {
      setSperrHinweis(t("Kein freier Platz für dieses Möbel in diesem Raum."));
      return;
    }
    setSperrHinweis(null);
    schreibe(zone, [...items, platziert]);
    setSel({ key: aktivKey, id: platziert.id });
  };
  /** Auto-furnish every EMPTY room of the unit in ONE write (deterministic,
   *  occupied rooms are never overwritten — Blatt 07 :200). */
  const autoMoebliere = () => {
    if (!editierbar) return;
    let next = moeblierung || {};
    const hinweise = [];
    for (const z of fokusZonen) {
      const items = moebelFuerZone(next, z);
      const r = autoMoeblierung(z, { personen, stufe, vorhandene: items, fenster: fensterJeZone.get(zoneKey(z)) || [] });
      // autoMoeblierung already names the room in some hints — prefix only
      // when the hint does not start with the room name (no double prefix).
      const raum = kurzRaumname(z.name);
      hinweise.push(...r.hinweise.map((h) => (h.startsWith(raum) ? h : `${raum}: ${h}`)));
      if (r.items.length) next = mitMoebelFuerZone(next, z, [...items, ...r.items]);
    }
    onMoeblierungChange(next);
    setAutoHinweise(hinweise);
    setSperrHinweis(null);
  };
  /** Remove ONLY auto items of this unit (istAutoItem) — user-placed stay. */
  const autoEntfernen = () => {
    if (!editierbar) return;
    let next = moeblierung || {};
    for (const z of fokusZonen) {
      const items = moebelFuerZone(next, z);
      const uebrig = items.filter((it) => !istAutoItem(it));
      if (uebrig.length !== items.length) next = mitMoebelFuerZone(next, z, uebrig);
    }
    onMoeblierungChange(next);
    setAutoHinweise([]);
  };

  /** Keyboard on the plan wrapper ONLY (no window listeners — 75-08 pattern):
   *  R rotates, Del/Backspace deletes, arrows move one 5-cm raster step;
   *  modifier combos pass through untouched (Ctrl+Z etc.). */
  const onPlanKeyDown = (ev) => {
    // 75-14: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo/redo the door-swing toggles.
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && tuerEditierbar) {
      const k = String(ev.key).toLowerCase();
      if (k === "z" && !ev.shiftKey) { ev.preventDefault(); tuerUndo(); return; }
      if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); tuerRedo(); return; }
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!sel || !editierbar) return;
    const schritt = MOEBEL_RASTER; // 0.05 m — the drag grid
    let dx = 0, dy = 0;
    switch (ev.key) {
      case "r": case "R": ev.preventDefault(); drehe(sel.key, sel.id); return;
      case "Delete": case "Backspace": ev.preventDefault(); loesche(sel.key, sel.id); return;
      case "ArrowLeft": dx = -schritt; break;
      case "ArrowRight": dx = schritt; break;
      case "ArrowUp": dy = -schritt; break;
      case "ArrowDown": dy = schritt; break;
      default: return;
    }
    ev.preventDefault();
    const zone = zoneZuKey(sel.key);
    const it = zone ? itemsFuerZone(zone).find((x) => x.id === sel.id) : null;
    if (it) bewege(sel.key, sel.id, it.x + dx, it.y + dy);
  };

  const selItem = sel ? (zoneZuKey(sel.key) ? itemsFuerZone(zoneZuKey(sel.key)).find((it) => it.id === sel.id) : null) : null;
  const katalog = useMemo(() => fokusKatalog(moebelEigene), [moebelEigene]);

  // ---- 75-09 Task 7: KPI column (one calc path each) ----------------------------
  // Movement-area compliance over the focus rooms (wohnMoebel.bewegungsNachweis).
  const nachweis = useMemo(() => bewegungsNachweis(
    fokusZonen.map((z) => ({ zone: z, items: itemsFuerZone(z), fenster: fensterJeZone.get(zoneKey(z)) || [] })),
    stufe,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [fokusZonen, moeblierung, stufe, fensterJeZone]);

  // Proportion per room (φ, office standard D-P75-03): bbox of the room,
  // PHI_AUSNAHMEN rooms show "—" (no φ requirement).
  const proportionen = useMemo(() => fokusZonen.map((z) => {
    const name = kurzRaumname(z.name);
    if (!Array.isArray(z.points) || z.points.length < 3) {
      return { name, status: "offen", text: "", ausnahme: true };
    }
    if (PHI_AUSNAHMEN.includes(z.art)) return { name, status: "offen", text: "", ausnahme: true };
    const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
    const bbox = { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
    const hinweis = proportionHinweis(bbox, {
      istRechteck: istAchsparallelesRechteck(z.points.map((p) => ({ x: p.x, y: p.z }))),
      kanten: { w: t("Breite"), d: t("Tiefe") },
    });
    return { name, status: hinweis.status, text: hinweis.text, ausnahme: false };
  }), [fokusZonen, t]);

  // Daylight 1/8 (MBO §47): count the EXISTING checks with the belichtung_ key
  // prefix from the workshop's checks prop — NO second computation here.
  const belichtung = useMemo(() => {
    const liste = (checks?.checks || []).filter((c) => String(c.key).startsWith("belichtung_"));
    return {
      pass: liste.filter((c) => c.status === "pass").length,
      warn: liste.filter((c) => c.status === "warn").length,
      offen: liste.filter((c) => c.status === "offen").length,
    };
  }, [checks]);

  // Iso of the unit: model footprint + focus zones through isoSzeneAusModell
  // (pure mapping). This is the ONLY MassingView3D on the workshop tab — Radix
  // tabs do not mount the massing tab at the same time, and neither
  // WohnungsWerkstatt nor ComplexDesigner render another instance (T-75-09-04).
  const isoKameraRef = useRef(null);
  // 75-13: the balcony slab of the unit rides along (MassingView3D draws raumart "balkon" flat).
  const szene = useMemo(() => isoSzeneAusModell(
    plan?.model?.footprint,
    [...fokusZonen, ...balkonZonen],
    { storeys: plan?.storeys, storeyHeight: plan?.storeyHeight },
  ), [plan, fokusZonen, balkonZonen]);

  /**
   * Chip handler: sets the scale mode and bumps the local nonce counter so a
   * second click on the active chip re-centres/re-scales the plan.
   * @param {number|null} wert 50 or null (Auto)
   */
  const waehleMassstab = (wert) => {
    setMassstab(wert);
    setChipKlick((n) => n + 1);
  };

  return (
    <Card data-testid="wt-fokus">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t("Fokusansicht")}: {we}
            <Badge className={st.color}>{checks ? st.label : t("keine Checks")}</Badge>
          </span>
          <span className="flex items-center gap-2">
            {/* 75-09 Task 5: scale chip group (native buttons — every new shadcn
                instance would cost a tsc legacy error). */}
            <span role="group" data-testid="fk-massstab" className="inline-flex rounded-md border border-slate-300 overflow-hidden">
              <button
                type="button"
                data-wert="50"
                aria-pressed={massstab === 50}
                onClick={() => waehleMassstab(50)}
                className={`px-2 py-0.5 text-xs ${massstab === 50 ? "bg-sky-100 text-sky-800" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                1:50
              </button>
              <button
                type="button"
                data-wert="auto"
                aria-pressed={massstab === null}
                onClick={() => waehleMassstab(null)}
                className={`border-l border-slate-300 px-2 py-0.5 text-xs ${massstab === null ? "bg-sky-100 text-sky-800" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {t("Auto")}
              </button>
            </span>
            {/* 75-15: the unit stands here ONCE — the dimension chains carry bare numbers. */}
            <span className="text-[11px] text-slate-500" data-testid="fk-mass-einheit">{t("Maße in m")}</span>
            <Button size="sm" variant="outline" onClick={onGotoInnenausbau} data-testid="wt-fokus-innenausbau">
              <Sofa className="w-3.5 h-3.5 mr-1" /> {t("Zum Innenausbau")}
            </Button>
            {/* Sprungbrett 2 (Plan 61-05 Task 3): zurück in den Geschossplan,
                Check-Card dieser WE aufgeklappt und angescrollt. */}
            {onGotoChecks && (
              <Button size="sm" variant="outline" onClick={onGotoChecks} data-testid="wt-fokus-checks">
                <ListChecks className="w-3.5 h-3.5 mr-1" /> {t("Checks dieser WE")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("Zurück")}
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 75-09 Task 6: furniture toolbar (native elements, all strings via
            t(...)). Only rendered when the host wired furniture (editierbar) —
            without wiring the focus stays the 61-05 read-only view. */}
        {editierbar && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" data-testid="fk-werkzeuge">
            <button
              type="button" data-testid="fk-auto" onClick={autoMoebliere}
              className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-sky-800 hover:bg-sky-100"
            >
              {t("Auto-Möblierung")}
            </button>
            <button
              type="button" data-testid="fk-auto-entfernen" onClick={autoEntfernen}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
            >
              {t("Auto-Möbel entfernen")}
            </button>
            {/* Movement-area level: Standard (Blatt 07) | B | R (DIN 18040-2). */}
            <span role="group" data-testid="fk-stufe" className="inline-flex overflow-hidden rounded-md border border-slate-300">
              {BEWEGUNG_STUFEN.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  data-wert={s}
                  aria-pressed={stufe === s}
                  onClick={() => setStufe(s)}
                  className={`${i ? "border-l border-slate-300" : ""} px-2 py-1 ${stufe === s ? "bg-sky-100 text-sky-800" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  title={t("Bewegungsflächen-Stufe")}
                >
                  {s === "standard" ? t("Standard") : s}
                </button>
              ))}
            </span>
            <label className="flex items-center gap-1 text-slate-600 select-none">
              <input
                type="checkbox" data-testid="fk-sperre" checked={sperre}
                onChange={(e) => setSperre(e.target.checked)}
              />
              {t("Kollision sperrt")}
            </label>
            {/* Honest persistence hint — always visible (T-75-09-05). */}
            <span className="text-[11px] text-slate-500" data-testid="fk-speicher-hinweis">
              {t("Möbel gelten sofort im Innenausbau, dauerhaft erst mit „Entwurf speichern“.")}
              {!speicherbar && <> {t("Dafür braucht der Entwurf Name und Standort.")}</>}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            {/* Keyboard wrapper (tabIndex) — Task 6 binds R/Del/arrows here
                (React onKeyDown ONLY, no window/document listeners). */}
            <div tabIndex={0} onKeyDown={onPlanKeyDown} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 rounded">
              <BimPlan2D
                model={plan.model}
                mode="grundriss"
                level={level}
                storeyHeight={plan.storeyHeight}
                readOnly
                customZones={plan.zones}
                layerVis={{ labels: false }}
                envOpenings={plan.envOpenings}
                unit={plan.unit}
                focus={focus}
                massstab={massstab}
                height={massstab ? HOEHE_1_50 : HOEHE_AUTO}
                overlay={({ X, Z, SCALE, zoom, px, pxJeM, sicht, rawMeters, bounds }) => {
                  // 75-09 Task 5 (MSB-12): ONE label source — two lines (short
                  // name via kurzRaumname, area in m²), sizes in REAL screen px
                  // via the letterbox-corrected px() from the overlay (MSB-16:
                  // vp.px() would shrink labels ≈1.5× in the height-limited SVG).
                  // Collision like BimPlan2D :300-330 (75-11 pattern): rectangles
                  // in screen px, bigger rooms first, only the LABEL hides — the
                  // room outline always stays.
                  const zf = zoom || 1;
                  const px2 = px || ((n) => n / zf); // fallback for safety; overlay always provides px
                  const bildPxJeU = pxJeM && SCALE ? pxJeM / SCALE : 1; // CSS px per viewBox unit
                  const fsName = px2(11);
                  const fsArea = px2(9);
                  const zeilenAbstand = px2(13);

                  // Label candidates: centre of each focus zone, biggest area first.
                  const kandidaten = fokusZonen
                    .map((z, i) => ({ z, i }))
                    .filter(({ z }) => Array.isArray(z.points) && z.points.length >= 3)
                    .map(({ z, i }) => {
                      const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
                      const cz = z.points.reduce((s, p) => s + p.z, 0) / z.points.length;
                      const fl = z.flaeche_m2 ?? polygonAreaM(z.points);
                      const name = kurzRaumname(z.name);
                      // Screen-px rectangle around the two-line label (text width
                      // ≈ 0.6 · fontSize · chars, 75-05 pattern). Anchored at the
                      // visible viewport (sicht) so off-screen labels never eat
                      // collision budget.
                      const sx = sicht ? (X(cx) - sicht.x) * bildPxJeU : X(cx);
                      const sy = sicht ? (Z(cz) - sicht.y) * bildPxJeU : Z(cz);
                      const breite = Math.max(name.length, 4) * 0.6 * 11;
                      return {
                        z, i, cx, cz, fl, name,
                        rect: { x0: sx - breite / 2, y0: sy - 13, x1: sx + breite / 2, y1: sy + 13 },
                      };
                    })
                    .sort((a, b) => b.fl - a.fl || a.i - b.i);
                  const sichtbar = new Set(labelKollision(kandidaten.map((k) => k.rect)));

                  return (
                    <g
                      data-testid="fk-overlay"
                      data-px-je-m={pxJeM != null ? pxJeM.toFixed(2) : undefined}
                      data-massstab-fokus={massstab ?? "auto"}
                    >
                      {/* 75-13: balcony in front of the facade — thin outline + hatch (slab, not a room). */}
                      <defs>
                        <pattern id="fk-balkon-schraffur" width={px2(6)} height={px2(6)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <line x1="0" y1="0" x2="0" y2={px2(6)} stroke="#0369a1" strokeWidth={px2(0.6)} />
                        </pattern>
                      </defs>
                      {balkonZonen.map((z, i) => (
                        <polygon key={`bk-${i}`} points={z.points.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}
                          fill="url(#fk-balkon-schraffur)" stroke="#0369a1" strokeWidth={px2(0.8)} style={{ pointerEvents: "none" }}
                          data-testid="fk-balkon" data-raum={z.raum} data-m2={Math.round((z.flaeche_m2 || 0) * 100) / 100} />
                      ))}
                      {/* Nachbar-WEs abdunkeln (halbtransparentes Overlay je Fremdzone) */}
                      {nachbarZonen.map((z, i) => {
                        if (!z.points || z.points.length < 3) return null;
                        const d = z.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
                        return <path key={`dim-${i}`} d={d} fill="#f8fafc" fillOpacity="0.65" stroke="none" style={{ pointerEvents: "none" }} />;
                      })}
                      {/* Räume der Fokus-WE: Kontur (teal) + zweizeiliges Label.
                          `pos` = Index in der sortierten Kandidatenliste — labelKollision
                          gibt Positionen in DERSELBEN Reihenfolge zurück (nicht k.i). */}
                      {kandidaten.map((k, pos) => (
                        <g key={`fr-${k.i}`} style={{ pointerEvents: "none" }}>
                          <path
                            d={k.z.points.map((p, j) => `${j ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z"}
                            fill="none" stroke="#0f766e" strokeWidth={px2(1)} strokeDasharray="4 2"
                          />
                          {sichtbar.has(pos) && (
                            // ONE <text> per room with two tspans (name + area) —
                            // a label is one collision rectangle; two sibling
                            // <text> elements would touch/overlap each other by
                            // sub-pixels and fail the pairwise bbox check.
                            <text
                              x={X(k.cx)} y={Z(k.cz)} textAnchor="middle" fontSize={fsName}
                              fill="#0f766e" data-fokus-label={k.name}
                            >
                              <tspan x={X(k.cx)} dy={-zeilenAbstand * 0.15} fontWeight="600">{k.name}</tspan>
                              <tspan x={X(k.cx)} dy={zeilenAbstand} fontSize={fsArea}>
                                {Math.round(k.fl).toLocaleString("de-DE")} m²
                              </tspan>
                            </text>
                          )}
                        </g>
                      ))}
                      {/* 75-15 (MSB-23): architectural dimension chains instead
                          of one axis-parallel pair per room (61-05 simplification).
                          ONE chain below the unit (room widths along the bottom
                          facade from the zone edges) + overall, ONE chain on the
                          right (room depths) with the numbers parallel to the
                          line (-90°). Only rooms that touch the respective
                          facade cut the chain [ASSUMED: 5 cm tolerance]; if none
                          does (odd layouts) every room edge counts. Numbers carry
                          no unit — "Maße in m" sits next to the scale chip. */}
                      {(() => {
                        const rechtecke = fokusZonen
                          .filter((z) => Array.isArray(z.points) && z.points.length >= 3)
                          .map((z) => {
                            const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
                            return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
                          });
                        if (!rechtecke.length) return null;
                        const xMax = Math.max(...rechtecke.map((r) => r.x1)), xMin = Math.min(...rechtecke.map((r) => r.x0));
                        const zMax = Math.max(...rechtecke.map((r) => r.z1)), zMin = Math.min(...rechtecke.map((r) => r.z0));
                        const mitte = { x: (xMin + xMax) / 2, z: (zMin + zMax) / 2 };
                        const TOL = 0.05;
                        const anUnten = rechtecke.filter((r) => Math.abs(r.z1 - zMax) < TOL);
                        const anRechts = rechtecke.filter((r) => Math.abs(r.x1 - xMax) < TOL);
                        const xCuts = [...new Set((anUnten.length ? anUnten : rechtecke).flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
                        const zCuts = [...new Set((anRechts.length ? anRechts : rechtecke).flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
                        const unten = xCuts.map((x) => ({ x, z: zMax }));
                        const rechts = zCuts.map((z) => ({ x: xMax, z }));
                        const gemeinsam = { X, Z, px: px2, SCALE, offsetM: 0.5, schriftPx: 9, farbe: "#334155" };
                        return (
                          <>
                            <Masskette {...gemeinsam} punkte={unten} seite={seiteVon(unten, mitte)} testid="fk-mass-unten" daten={{ "data-fokus-mass": "unten" }} />
                            <Masskette {...gemeinsam} punkte={rechts} seite={seiteVon(rechts, mitte)} testid="fk-mass-rechts" daten={{ "data-fokus-mass": "rechts" }} />
                          </>
                        );
                      })()}
                      {/* 75-14 (MSB-14/17): zone doors — opening in wall thickness, leaf,
                          90° arc, strokes in screen px; click toggles the swing side
                          over the undo stack. Furniture doors (MoebelSchicht) are
                          separate items and keep their own attribute. */}
                      <ZonenTueren
                        zonen={fokusZonen} X={X} Z={Z} SCALE={SCALE} px={px2} prefix="fk"
                        onToggle={tuerEditierbar ? tuerToggle : undefined}
                        titelFuer={(tr) => `${t("Tür")} ${Math.round((tr.breite_m || 0) * 100)} cm · ${t("Anschlag")}: ${tr.aufschlag === "rechts" ? t("rechts") : t("links")}${tuerEditierbar ? ` — ${t("Klick dreht den Aufschlag")}` : ""}`}
                      />
                      {/* 75-14 Task 4: wardrobe wall marker — thin line 5 cm inside the
                          chosen wall of every bedroom/child room, tooltip "3,00 m Schrank". */}
                      {(qualitaet?.eintraege || []).filter((e) => e.regel === "schrankwand" && Number.isInteger(e.wand)).map((e, i) => {
                        const zone = fokusZonen.find((z) => String(z.name) === e.raum);
                        const k = zone ? kantenVon(zone).find((q) => q.i === e.wand) : null;
                        if (!zone || !k) return null;
                        const cx = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length;
                        const cz = zone.points.reduce((s, p) => s + p.z, 0) / zone.points.length;
                        const dx = (k.b.x - k.a.x) / k.laenge, dz = (k.b.z - k.a.z) / k.laenge;
                        let nx = -dz, nz = dx;
                        if ((cx - k.a.x) * nx + (cz - k.a.z) * nz < 0) { nx = -nx; nz = -nz; }
                        const off = 0.05; // m inside the wall line
                        return (
                          <g key={`sw-${i}`} data-testid="fk-schrankwand" data-raum={e.raum} data-stufe={e.stufe} data-frei={e.wert}>
                            <title>{`${(e.wert || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m ${t("Schrank")} — ${e.text}`}</title>
                            <line
                              x1={X(k.a.x + nx * off)} y1={Z(k.a.z + nz * off)} x2={X(k.b.x + nx * off)} y2={Z(k.b.z + nz * off)}
                              stroke={e.stufe === "ok" ? "#059669" : "#d97706"} strokeWidth={px2(2.5)} strokeDasharray={`${px2(6)} ${px2(3)}`} style={{ pointerEvents: "stroke" }}
                            />
                          </g>
                        );
                      })}
                      {/* 75-09 Task 6: the SHARED furniture layer (prefix fk) —
                          rooms as click areas (fk-raum), movement areas per
                          level (bewegungsflaechen), bodies, door symbols,
                          drag/tap/double-click. Neighbours are NOT editable
                          (zonen = fokusZonen only). Screen-constant sizes via
                          px (letterbox-correct, Task 2). */}
                      <MoebelSchicht
                        prefix="fk"
                        overlayTestid="fk-moebel"
                        X={X} Z={Z} SCALE={SCALE} rawMeters={rawMeters} bounds={bounds}
                        px={px2}
                        zonen={fokusZonen}
                        keyFuer={zoneKey}
                        itemsFuer={itemsFuerZone}
                        aktivKey={aktivKey}
                        onAktivChange={editierbar ? setAktivKey : undefined}
                        sel={sel}
                        onSelect={editierbar ? setSel : undefined}
                        onMove={editierbar ? bewege : undefined}
                        onRotate={editierbar ? drehe : undefined}
                        kollisionIds={kollisionIds}
                        bewegungFuer={(item) => bewegungsflaechen(item, stufe)}
                      />
                      {/* 5-m-Balken + Maßstabsanzeige — NUR bei festem Maßstab,
                          unten links in der SICHT (sicht.x/y = viewBox-Ursprung).
                          Länge: 5 m · SCALE viewBox-Einheiten (lodFuer(50).balkenM). */}
                      {massstab && sicht && (
                        <g data-testid="fk-balken" style={{ pointerEvents: "none" }}>
                          {(() => {
                            const balkenM = lodFuer(massstab).balkenM; // 5 m at 1:50
                            const laengeU = balkenM * SCALE;           // viewBox units
                            const xL = sicht.x + px2(16);
                            const yB = sicht.y + sicht.h - px2(18);
                            return (
                              <>
                                <line x1={xL} y1={yB} x2={xL + laengeU} y2={yB} stroke="#0f172a" strokeWidth={px2(2)} />
                                <line x1={xL} y1={yB - px2(4)} x2={xL} y2={yB + px2(4)} stroke="#0f172a" strokeWidth={px2(2)} />
                                <line x1={xL + laengeU} y1={yB - px2(4)} x2={xL + laengeU} y2={yB + px2(4)} stroke="#0f172a" strokeWidth={px2(2)} />
                                <text x={xL + laengeU / 2} y={yB - px2(6)} textAnchor="middle" fontSize={px2(9)} fill="#0f172a" stroke="none">
                                  {balkenM} m
                                </text>
                              </>
                            );
                          })()}
                        </g>
                      )}
                    </g>
                  );
                }}
              />
            </div>
            {/* Actual-scale readout (Task 5): "1:50" while the chip scale holds,
                "≈ 1:n" once the user zoomed freely (n from the live pxJeM). */}
            {massstab && (
              <div className="mt-1 text-[11px] text-slate-500" data-testid="fk-massstab-ist">
                {t("Maßstab")}: <FokusMassstabIst massstab={massstab} />
              </div>
            )}
            {/* 75-14: door-swing undo/redo (UNDO-01) — only when the host wired the write path. */}
            {tuerEditierbar && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500" data-testid="fk-tueren-leiste"
                data-tueren={fokusZonen.reduce((s, z) => s + (Array.isArray(z.tueren) ? z.tueren.length : 0), 0)}>
                <span>{t("Türen")}: {fokusZonen.reduce((s, z) => s + (Array.isArray(z.tueren) ? z.tueren.length : 0), 0)} · {t("Klick auf eine Tür dreht den Aufschlag")}</span>
                <button type="button" data-testid="fk-tuer-undo" onClick={tuerUndo} disabled={!tuerStand.p}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  title={t("Rückgängig (Strg+Z)")}>↶ {t("Rückgängig")}</button>
                <button type="button" data-testid="fk-tuer-redo" onClick={tuerRedo} disabled={!tuerStand.f}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  title={t("Wiederholen (Strg+Y)")}>↷ {t("Wiederholen")}</button>
              </div>
            )}
            {editierbar && (
              <>
                {/* Blocking-collision reason (role=status so screen readers announce it). */}
                {sperrHinweis && (
                  <div role="status" data-testid="fk-sperre-hinweis" className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    {sperrHinweis}
                  </div>
                )}
                {/* Auto-furnishing notes (occupied rooms, non-rect rooms, misses). */}
                {autoHinweise.length > 0 && (
                  <div className="mt-2 space-y-0.5 text-[11px] text-slate-500" data-testid="fk-auto-hinweise">
                    {autoHinweise.map((h, i) => <div key={i}>{h}</div>)}
                  </div>
                )}
                {/* Selection actions (rotate / swing side for doors / delete). */}
                {selItem && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5" data-testid="fk-aktionen">
                    <span className="mr-1 text-xs font-medium text-sky-800">
                      {moebelById(selItem.typ)?.name || selItem.typ}
                    </span>
                    <button type="button" data-testid="fk-drehen" onClick={() => drehe(sel.key, sel.id)}
                      className="inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">
                      <RotateCw className="mr-1 h-3 w-3" /> 90°
                    </button>
                    {moebelById(selItem.typ)?.tuer && (
                      <button type="button" data-testid="fk-anschlag" onClick={() => wechsleAnschlag(sel.key, sel.id)}
                        className="inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">
                        <FlipHorizontal className="mr-1 h-3 w-3" /> {t("Anschlag")}: {selItem.aufschlag === "rechts" ? t("rechts") : t("links")}
                      </button>
                    )}
                    <button type="button" data-testid="fk-loeschen" onClick={() => loesche(sel.key, sel.id)}
                      className="inline-flex items-center rounded border border-red-200 bg-white px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50">
                      <Trash2 className="mr-1 h-3 w-3" /> {t("Löschen")}
                    </button>
                    <span className="ml-auto text-[10px] text-slate-500">{t("R dreht · Entf löscht · Pfeile verschieben (5 cm)")}</span>
                  </div>
                )}
                {/* Warnings per room (warn only — like MoeblierungsPlan, amber). */}
                {warnungen.length > 0 && (
                  <div className="mt-2 space-y-1" data-testid="fk-warnungen">
                    {warnungen.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                        <button type="button" className="font-medium underline-offset-2 hover:underline"
                          onClick={() => { setAktivKey(w.key); setSel({ key: w.key, id: w.itemId }); }}>
                          {w.raum}
                        </button>
                        <span>{w.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Catalogue: living group (+ custom types). Insert needs an
                    active room — the hint says so (MoeblierungsPlan pattern). */}
                {/* 75-13: balcony switch at the ACTIVE room — outer rooms only (a facade
                    window segment exists); inner rooms show no switch. */}
                {typeof onBalkonToggle === "function" && aktivKey && (() => {
                  const zone = zoneZuKey(aktivKey);
                  if (!zone || zone.raumart === "flur") return null;
                  const aussen = zone.fensterpflicht === true || fensterFuer(zone).length > 0;
                  if (!aussen) return null;
                  const an = typeof balkonAktiv === "function" && balkonAktiv(zone);
                  return (
                    <label className="mt-2 flex items-center gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-900" data-testid="fk-balkon-schalter" data-raum={zone.name} data-an={an ? "1" : "0"}>
                      <input type="checkbox" checked={!!an} onChange={(e) => onBalkonToggle(zone, e.target.checked)} />
                      {t("Balkon")} · {String(zone.name).replace(/ \([^)]*\) ·WT$/, "")} ({t("1,5 m tief, 0,5 m Rand")} [ASSUMED])
                    </label>
                  );
                })()}
                <div className="mt-2">
                  {!aktivKey && (
                    <div className="mb-1 text-[11px] text-amber-700" data-testid="fk-hinweis-raum">{t("Zuerst einen Raum im Plan anklicken.")}</div>
                  )}
                  <KatalogPanel
                    titel={t("Wohnmöbel")}
                    katalog={katalog}
                    onAdd={fuegeEin}
                    chipTitle={(ty) => `${ty.name} (${ty.b.toLocaleString("de-DE")} × ${ty.t.toLocaleString("de-DE")} m)`}
                    renderChip={(ty) => <span data-katalog-typ={ty.id}>{ty.name}</span>}
                  />
                  <div className="mt-2"><MoebelLegende /></div>
                </div>
              </>
            )}
          </div>

          {/* Seitenleiste: WE-Kopf + KPIs (75-09 Task 7) + Checks + Iso der WE */}
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
              <div className="font-semibold text-sm">{we}</div>
              <div>{t("Geschoss")}: {level === 0 ? t("EG") : `${level}. ${t("OG")}`}</div>
              <div>{t("Raumfläche")}: {de1(gesamtFlaeche)} m² ({wohnZonen.length} {t("Räume")} + {flurZonen.length} {t("Flur")})</div>
            </div>

            {/* 75-09 Task 7: KPI card — WoFlV (same list as the workshop table,
                ONE calc path via the `woflv` prop), movement-area compliance
                per level, φ proportion per room, daylight 1/8 from the EXISTING
                checks (no second computation). Numbers de-DE. */}
            <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-2" data-testid="fk-kpi">
              <div data-testid="fk-kpi-woflv" data-wert={woflv ? de2(woflv.wohnflaeche_m2 ?? woflv.mfg_m2 ?? 0) : undefined}>
                <div className="font-semibold text-slate-700">
                  {woflv?.nutzung === "gewerbe" ? "MF/G" : t("Wohnfläche (WoFlV)")}
                </div>
                {woflv ? (
                  <>
                    <div className="text-base font-semibold text-slate-900">
                      {de2(woflv.nutzung === "gewerbe" ? woflv.mfg_m2 : woflv.wohnflaeche_m2)} m²
                    </div>
                    <div className="text-[10px] text-slate-500">{t("Brutto-Raumfläche")}: {de1(woflv.brutto_m2)} m²</div>
                  </>
                ) : (
                  <div className="text-slate-400">—</div>
                )}
              </div>

              <div data-testid="fk-kpi-bewegung" data-anzahl={nachweis.anzahl} data-frei={nachweis.frei}
                data-konflikte={nachweis.konflikte.length} data-stufe={stufe}>
                <div className="font-semibold text-slate-700">{t("Bewegungsflächen-Nachweis")}</div>
                <div className="text-slate-600">
                  {nachweis.anzahl} {t("Flächen")} · {nachweis.frei} {t("frei")} · {nachweis.konflikte.length} {t("Konflikte")}
                </div>
                {nachweis.konflikte.slice(0, 3).map((k, i) => (
                  <div key={i} className="text-[10px] text-amber-700">{k.raum}: {k.text}</div>
                ))}
                <div className="text-[10px] text-slate-400">
                  {t("Stufe")}: {stufe === "standard" ? t("Standard (Blatt 07)") : `DIN 18040-2 ${stufe}`}
                </div>
              </div>

              <div data-testid="fk-kpi-proportion">
                <div className="font-semibold text-slate-700">{t("Proportion je Raum")}</div>
                {proportionen.map((p, i) => (
                  <div key={i} className="flex justify-between gap-2 text-[11px]" data-raum={p.name} data-status={p.status}>
                    <span className="text-slate-600">{p.name}</span>
                    <span className={p.status === "gruen" ? "text-emerald-600" : p.status === "gelb" ? "text-amber-600" : "text-slate-400"}>
                      {p.ausnahme ? "—" : p.text}
                    </span>
                  </div>
                ))}
                <div className="text-[10px] text-slate-400">φ · {t("Bürostandard")}</div>
              </div>

              <div data-testid="fk-kpi-belichtung" data-pass={belichtung.pass} data-warn={belichtung.warn} data-offen={belichtung.offen}>
                <div className="font-semibold text-slate-700">{t("Belichtung 1/8")}</div>
                <div className="text-slate-600">
                  {belichtung.pass} {t("passiert")} · {belichtung.warn} {t("warnend")} · {belichtung.offen} {t("offen")}
                </div>
                {fensterNaeherung && (
                  <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
                    data-testid="fk-fenster-naeherung">
                    {t("Fensterlage genähert (je 3,5 m) — Belichtung ist ein Richtwert")}
                  </span>
                )}
              </div>
            </div>

            {/* 75-14 Task 5: room-quality list of this unit (raumQualitaet via the
                workshop — ONE calc path). fail = planning error (access, bath from
                living room, < 10 m², < 2,40 m), warn = office standard (ratio,
                wardrobe wall). Only rendered when the rule is on (qualitaet given). */}
            {qualitaet && (
              <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1" data-testid="fk-qualitaet"
                data-ok={qualitaet.zaehler?.ok ?? 0} data-warn={qualitaet.zaehler?.warn ?? 0} data-fail={qualitaet.zaehler?.fail ?? 0}>
                <div className="flex items-center justify-between font-semibold text-slate-700">
                  <span>{t("Raumqualität")}</span>
                  <span className="text-[10px] font-normal text-slate-500">
                    {qualitaet.zaehler?.ok ?? 0} ok · {qualitaet.zaehler?.warn ?? 0} warn · {qualitaet.zaehler?.fail ?? 0} fail
                  </span>
                </div>
                {(qualitaet.eintraege || []).length === 0 && <div className="text-slate-400">{t("Keine Befunde.")}</div>}
                {(qualitaet.eintraege || []).map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]" data-regel={e.regel} data-stufe={e.stufe}>
                    <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${e.stufe === "fail" ? "bg-red-500" : e.stufe === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                    <span>
                      <span className="font-medium">{e.raum === "WE" ? we : kurzRaumname(e.raum)}</span>
                      <span className="text-slate-500"> — {e.text}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 75-09 Task 7: iso of the unit — focus zones extruded as teal
                volumes inside the (glassy) building body. Fixed 240 px height
                [ASSUMED] because MassingView3D is h-full. Furniture changes do
                NOT touch the iso (rooms only — furniture boxes are out of scope). */}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-b">
                {t("Iso der WE")}
              </div>
              <div data-iso-fokus="1" style={{ height: 240 }}>
                {szene ? (
                  <MassingView3D
                    poly={szene.poly}
                    siteW={szene.siteW}
                    siteD={szene.siteD}
                    height={szene.height}
                    setbacks={KEINE_SETBACKS}
                    fokusZonen={szene.fokusZonen}
                    geschossHoehe={plan?.storeyHeight || 3}
                    kameraRef={isoKameraRef}
                    info={{ name: we, geschosse: plan?.storeys, bgfM2: gesamtFlaeche }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-3 text-center text-xs text-slate-400">
                    {t("Iso nicht verfügbar — Grundriss-Modell unvollständig.")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-2">
                <ListChecks className="w-3.5 h-3.5" /> {t("Checks dieser WE")}
              </div>
              {checks ? (
                <div className="space-y-1">
                  {checks.checks.map((c) => {
                    const cs = WT_STATUS[c.status] || WT_STATUS.offen;
                    return (
                      <div key={c.key} className="flex items-start gap-2 text-[11px]">
                        <span className={`mt-0.5 inline-block h-2 w-2 rounded-full ${cs.dot}`} />
                        <span>
                          <span className="font-medium">{c.label}</span>
                          <span className="text-slate-500"> — {c.detail}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-500">{t("Keine Check-Daten für diese WE.")}</div>
              )}
            </div>

            <Button size="sm" variant="outline" className="w-full" onClick={onGotoInnenausbau}>
              <Sofa className="w-3.5 h-3.5 mr-1" /> {t("Zum Innenausbau")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Live scale readout for the fixed-scale chip: reads data-px-je-m from the focus
 * overlay every animation frame (cheap attribute read) and shows "1:50" while
 * the on-screen scale still matches the chip (±1.5 %), else "≈ 1:n" with
 * n = round(CSS_PX_JE_M / pxJeM) — the honest label after free zooming.
 * @param {{massstab: number}} p chip denominator
 */
function FokusMassstabIst({ massstab }) {
  const [ist, setIst] = useState(null);
  const raf = useRef(0);
  React.useEffect(() => {
    const lesen = () => {
      const overlay = document.querySelector('[data-testid="fk-overlay"]');
      const wert = Number(overlay?.getAttribute("data-px-je-m"));
      if (Number.isFinite(wert) && wert > 0) setIst(wert);
      raf.current = requestAnimationFrame(lesen);
    };
    raf.current = requestAnimationFrame(lesen);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  if (ist == null) return <>1:{massstab}</>;
  const ziel = CSS_PX_JE_M / massstab;
  if (Math.abs(ist - ziel) <= ziel * 0.015) return <>1:{massstab}</>;
  return <>{`≈ 1:${Math.round(CSS_PX_JE_M / ist)}`}</>;
}
