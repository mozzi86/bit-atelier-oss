// Geschoss-Möblierungsplan (Phase 43, MOEBEL-02) — alle Räume eines Geschosses mit ihren
// Möbeln in EINEM Plan, als Overlay auf BimPlan2D (readOnly; Plan-Werkstatt Phase 34).
//
// In:  plan (usePlanModel: model, envOpenings, customWalls/-Columns/-Windows, storeys, unit),
//      zones (Store-Räume [{points,level,name,…}]), level, moeblierung-Zugriff über
//      keyFuer/itemsFuer/onItemsChange, Katalog, aktiver Raum (aktivKey).
// Out: Rendering + Verdrahtung. Geometrie und Checks kommen aus @designer/lib/moebel:
//      Ziehen (PW-02b-Hook in MoebelSchicht) → verschiebeItem (5-cm-Raster),
//      Doppelklick → drehen, Klick auf einen Raum → aktiver Raum (Katalog fügt
//      dort ein), Warnungen je Raum.
// Kein zweiter Editor: Hülle, Öffnungen, Innenwände zeichnet BimPlan2D (`elements`);
// die Möbel-Ebene selbst ist MoebelSchicht.jsx (75-09 Task 4) — geteilt mit dem
// WohnungsFokus, Drag/Rendering leben dort an EINER Stelle.

import React, { useMemo, useState } from "react";
import { AlertTriangle, RotateCw, Trash2, LayoutGrid } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { polygonAreaM } from "@core/lib/useBuildingProgram";
import {
  moebelById, moebelChecks, kollisionsWarnungen, verschiebeItem,
} from "@designer/lib/moebel";
import BimPlan2D from "./BimPlan2D";
import KatalogPanel from "./KatalogPanel";
import MoebelSchicht from "./MoebelSchicht";
import { MoebelLegende } from "./MoebelDraufsicht";

const geschossLabel = (lvl, t) => (lvl === 0 ? t("EG") : `${lvl}. ${t("OG")}`);

// BBox-Mitte einer Zone (Meter) — Einfügepunkt neuer Möbel.
function zonenMitte(zone) {
  const xs = zone.points.map((p) => p.x), zs = zone.points.map((p) => p.z);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...zs) + Math.max(...zs)) / 2 };
}

/**
 * Geschoss-Möblierungsplan.
 * @param {object} p
 * @param {object} p.plan usePlanModel-Ergebnis
 * @param {Array<object>} p.zones Store-Räume aller Geschosse
 * @param {number} p.level aktives Geschoss (0 = EG)
 * @param {(lvl:number) => void} p.onLevelChange
 * @param {(zone:object) => string} p.keyFuer Schlüssel einer Zone in complexData.moeblierung
 * @param {(zone:object) => Array<object>} p.itemsFuer Möbel einer Zone
 * @param {(zone:object, items:Array<object>) => void} p.onItemsChange
 * @param {Array<object>} p.katalog Möbelkatalog ([{gruppe, typen}])
 * @param {string|null} p.aktivKey Schlüssel des aktiven Raums
 * @param {(key:string|null) => void} p.onAktivChange
 */
export default function MoeblierungsPlan({
  plan, zones, level, onLevelChange, keyFuer, itemsFuer, onItemsChange, katalog, aktivKey, onAktivChange,
}) {
  const { t } = useI18n();
  const storeys = Math.max(1, Math.round(plan?.storeys || 1));
  const lvl = Math.min(Math.max(0, level), storeys - 1);
  const zonenImLevel = useMemo(
    () => (zones || []).filter((z) => (z.level ?? 0) === lvl && Array.isArray(z.points) && z.points.length >= 3),
    [zones, lvl],
  );
  const zoneZuKey = (key) => zonenImLevel.find((z) => keyFuer(z) === key) || null;
  const aktiv = aktivKey ? zoneZuKey(aktivKey) : null;
  const [sel, setSel] = useState(null); // { key, id } des gewählten Möbels

  // Warnungen je Raum des Geschosses (moebelChecks + Überlappungen) — nur warn, nie fail.
  const warnungen = useMemo(() => {
    const out = [];
    const kollisionIds = new Set();
    zonenImLevel.forEach((z) => {
      const items = itemsFuer(z);
      if (!items.length) return;
      const koll = kollisionsWarnungen(items);
      koll.forEach((w) => w.itemIds.forEach((id) => kollisionIds.add(id)));
      [...moebelChecks(items, z.points), ...koll].forEach((w) => out.push({ ...w, raum: z.name || t("Raum"), key: keyFuer(z) }));
    });
    return { liste: out, kollisionIds };
  }, [zonenImLevel, itemsFuer, keyFuer, t]);

  const patchItems = (zone, fn) => onItemsChange(zone, fn(itemsFuer(zone)));
  const moveTo = (key, id, x, y) => {
    const z = zoneZuKey(key);
    if (z) patchItems(z, (items) => items.map((it) => (it.id === id ? verschiebeItem(it, x, y) : it)));
  };
  const rotate = (key, id) => {
    const z = zoneZuKey(key);
    if (z) patchItems(z, (items) => items.map((it) => (it.id === id ? { ...it, rot: ((it.rot || 0) + 90) % 360 } : it)));
  };
  const remove = (key, id) => {
    const z = zoneZuKey(key);
    if (z) patchItems(z, (items) => items.filter((it) => it.id !== id));
    setSel(null);
  };
  const addTyp = (typId) => {
    if (!aktiv) return;
    const m = zonenMitte(aktiv);
    // Einfügepunkt auf das Drag-Raster (5 cm) legen — sonst trägt das erste Möbel eine
    // ungerundete BBox-Mitte und springt beim ersten Ziehen um bis zu 2,5 cm.
    const item = { ...verschiebeItem({ id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, typ: typId, x: m.x, y: m.y, rot: 0 }, m.x, m.y) };
    patchItems(aktiv, (items) => [...items, item]);
    setSel({ key: aktivKey, id: item.id });
  };

  // Drag lives in MoebelSchicht (75-09 Task 4 — ONE furniture layer, shared with
  // the apartment focus); this host keeps state, snapping (verschiebeItem) and
  // persistence only.

  const selItem = sel ? (zoneZuKey(sel.key) ? itemsFuer(zoneZuKey(sel.key)).find((it) => it.id === sel.id) : null) : null;
  const gesamtMoebel = zonenImLevel.reduce((s, z) => s + itemsFuer(z).length, 0);

  if (!plan?.model) return null;

  return (
    <div className="space-y-3" data-testid="moeblierungs-plan">
      {/* Geschoss-Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <LayoutGrid className="w-4 h-4 text-slate-500" />
        {Array.from({ length: storeys }, (_, i) => {
          const n = (zones || []).filter((z) => (z.level ?? 0) === i && z.points?.length >= 3).length;
          return (
            <button
              key={i}
              type="button"
              data-testid={`mp-level-${i}`}
              onClick={() => onLevelChange?.(i)}
              className={`rounded border px-2 py-0.5 text-xs transition-colors ${i === lvl ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {geschossLabel(i, t)} <span className="text-slate-400">({n})</span>
            </button>
          );
        })}
        <span className="ml-auto text-xs text-slate-500">
          {zonenImLevel.length} {t("Räume")} · {gesamtMoebel} {t("Möbel")}
          {aktiv ? <> · {t("aktiv")}: <b className="text-slate-700">{aktiv.name}</b></> : <> · {t("Raum anklicken, dann Katalog")}</>}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_190px] gap-3">
        <div className="space-y-2 min-w-0">
          <div className="rounded-lg border bg-white overflow-hidden">
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
              overlay={({ X, Z, SCALE, rawMeters, bounds }) => (
                // 75-09 Task 4: the shared furniture layer renders rooms, movement
                // areas, bodies and door symbols; visible output identical to the
                // Phase-43 inline version (same colours, strokes, texts, testids).
                <MoebelSchicht
                  prefix="mp"
                  X={X} Z={Z} SCALE={SCALE} rawMeters={rawMeters} bounds={bounds}
                  zonen={zonenImLevel}
                  keyFuer={keyFuer}
                  itemsFuer={itemsFuer}
                  aktivKey={aktivKey}
                  onAktivChange={onAktivChange}
                  sel={sel}
                  onSelect={setSel}
                  onMove={moveTo}
                  onRotate={rotate}
                  kollisionIds={warnungen.kollisionIds}
                />
              )}
            />
          </div>
          <MoebelLegende />
          {selItem && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5" data-testid="mp-aktionen">
              <span className="text-xs font-medium text-sky-800 mr-1">
                {moebelById(selItem.typ)?.name || selItem.typ} · {zoneZuKey(sel.key)?.name}
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => rotate(sel.key, sel.id)} data-testid="mp-drehen">
                <RotateCw className="w-3.5 h-3.5 mr-1" /> 90°
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-red-600" onClick={() => remove(sel.key, sel.id)} data-testid="mp-loeschen">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Löschen")}
              </Button>
              <span className="text-[10px] text-slate-500 ml-auto">{t("Ziehen verschiebt (5-cm-Raster) · Doppelklick dreht")}</span>
            </div>
          )}
          {warnungen.liste.length > 0 && (
            <div className="space-y-1" data-testid="mp-warnungen">
              {warnungen.liste.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
                  <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => { onAktivChange?.(w.key); setSel({ key: w.key, id: w.itemId }); }}>
                    {w.raum}
                  </button>
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Katalog — fügt in den aktiven Raum ein */}
        <div className="space-y-2 self-start">
          {aktiv ? (
            <div className="text-[11px] text-slate-600">
              {t("Einfügen in")} <b>{aktiv.name}</b> · {Math.round(polygonAreaM(aktiv.points))} m²
            </div>
          ) : (
            <div className="text-[11px] text-amber-700" data-testid="mp-hinweis-raum">{t("Zuerst einen Raum im Plan anklicken.")}</div>
          )}
          <KatalogPanel
            titel={t("Möbelkatalog")}
            katalog={katalog}
            onAdd={aktiv ? addTyp : undefined}
            chipTitle={(ty) => `${ty.name} (${ty.b.toLocaleString("de-DE")} × ${ty.t.toLocaleString("de-DE")} m)`}
          />
        </div>
      </div>
    </div>
  );
}
