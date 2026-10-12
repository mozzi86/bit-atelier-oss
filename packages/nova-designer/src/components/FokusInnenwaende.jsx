// 75-12: interior walls of ONE unit in the apartment focus (WohnungsFokus) — move the wall
// between two rooms in 12.5 cm steps (octametre, DIN 4172). The data lives in
// werkstatt_layer.raumGrenzen (solver input, raumGrenzen.js); this section only calls the host
// callback, the tessellation re-reads the layer and the plan redraws from data — the focus
// never writes the store (75-09 rule). Exterior walls belong to the massing, unit boundaries
// to the band solver: neither appears here.
//
// In:  zonen (the focus unit's zones, already moved), raumGrenzen (layer map, m), onChange.
// Out: rendering; onChange(newMap) with entries in metres (0 removes the entry).
//
// [ASSUMED] Buttons instead of a drag handle on the edge: exact on the grid, keyboard-usable
// and stable in E2E; a drag handle in the plan is follow-up work.

import React, { useMemo, useRef, useState } from "react";
import { useI18n } from "@core/lib/i18n";
import { kurzRaumname } from "@designer/lib/massstab";
import { innenwaende, RAUMGRENZE_RASTER_M } from "@designer/lib/raumGrenzen";
import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";

const de2 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * Interior-wall list with grow buttons per side, reset and undo/redo.
 * @param {object} p
 * @param {Array<object>} p.zonen zones of the focused unit (all storeys of the unit are fine)
 * @param {Record<string, number>|null} [p.raumGrenzen] werkstatt_layer.raumGrenzen (m)
 * @param {(m: Record<string, number>) => void} p.onChange the ONE write path (host → setCfg)
 */
export default function FokusInnenwaende({ zonen, raumGrenzen = null, onChange }) {
  const { t } = useI18n();
  const karte = raumGrenzen && typeof raumGrenzen === "object" ? raumGrenzen : {};
  const waende = useMemo(() => innenwaende(zonen || []), [zonen]);
  const stack = useRef(leererStack());
  const [stand, setStand] = useState({ p: 0, f: 0 });
  const sync = () => setStand({ p: stack.current.past.length, f: stack.current.future.length });

  const setze = (key, wert) => {
    const neu = { ...karte };
    const w = Math.round(Number(wert) * 1000) / 1000;
    if (Math.abs(w) < 1e-9) delete neu[key]; else neu[key] = w;
    stack.current = merke(stack.current, karte);
    onChange(neu);
    sync();
  };
  const undo = () => { const r = zurueck(stack.current, karte); if (!r) return; stack.current = r.stack; onChange(r.snapshot || {}); sync(); };
  const redo = () => { const r = vor(stack.current, karte); if (!r) return; stack.current = r.stack; onChange(r.snapshot || {}); sync(); };

  if (!waende.length) {
    return (
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-400" data-testid="fk-innenwaende" data-anzahl={0}>
        {t("Keine verschiebbaren Innenwände in dieser Wohnung.")}
      </div>
    );
  }
  const r = RAUMGRENZE_RASTER_M;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5" data-testid="fk-innenwaende" data-anzahl={waende.length}>
      <div className="flex items-center justify-between font-semibold text-slate-700">
        <span>{t("Innenwände")}</span>
        <span className="flex gap-1">
          <button type="button" data-testid="fk-iw-undo" onClick={undo} disabled={!stand.p}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-40">↶ {t("Rückgängig")}</button>
          <button type="button" data-testid="fk-iw-redo" onClick={redo} disabled={!stand.f}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-40">↷ {t("Wiederholen")}</button>
        </span>
      </div>
      <div className="text-[11px] text-slate-500">{t("Wand zwischen zwei Räumen verschieben — Schritt 12,5 cm (Oktameter), Außenwände gehören dem Massing.")}</div>
      {waende.map((w) => {
        const versatz = Number(karte[w.key]) || 0;
        const a = kurzRaumname(w.a), b = kurzRaumname(w.b);
        return (
          <div key={w.key} className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-1.5"
            data-testid="fk-iw" data-key={w.key} data-versatz={versatz} data-breite-a={Math.round(w.breiteA * 1000) / 1000} data-breite-b={Math.round(w.breiteB * 1000) / 1000}>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={`${a} | ${b}`}>{a} | {b}</span>
            <button type="button" data-testid="fk-iw-a" disabled={w.spielraumPlus + 1e-6 < r} onClick={() => setze(w.key, versatz + r)}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title={`${a} ${t("größer")} (+12,5 cm)`}>{a} +</button>
            <button type="button" data-testid="fk-iw-b" disabled={w.spielraumMinus + 1e-6 < r} onClick={() => setze(w.key, versatz - r)}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title={`${b} ${t("größer")} (+12,5 cm)`}>{b} +</button>
            <span className="w-16 text-right tabular-nums text-slate-500" data-testid="fk-iw-wert">{versatz ? `${versatz > 0 ? "+" : "−"}${de2(Math.abs(versatz))} m` : "0"}</span>
            <button type="button" data-testid="fk-iw-reset" disabled={!versatz} onClick={() => setze(w.key, 0)}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">{t("zurücksetzen")}</button>
          </div>
        );
      })}
    </div>
  );
}
