import React from "react";

// Generische Katalog-Seitenleiste (Phase 34, PW-03) — extrahiert aus der
// Möbelkatalog-Leiste des InteriorDesigner (Vorbild MOEBEL_KATALOG).
// Bewusst simpel gehalten wie das Original: Gruppen-Überschriften + Klick-Chips,
// KEINE Suche, KEIN Drag&Drop (Klick-statt-Drag ist dort eine dokumentierte
// Entscheidung). Fachplaner-Reiter übergeben ihren eigenen Katalog.
//
// katalog: [{ gruppe, typen: [{ id, name, ...meta }] }]
// onAdd(typId) — Klick auf einen Chip
// chipTitle?(typ) — Tooltip je Chip (Default: name)
// renderChip?(typ) — eigener Chip-Inhalt (Default: name)
/**
 * @param {{ titel?: string, katalog: Array<{gruppe: string, typen: Array<any>}>, onAdd?: (typId: string) => void,
 *   chipTitle?: (typ: any) => string, renderChip?: (typ: any) => any }} props
 *   (typisiert, damit tsc die optionalen Props nicht als Pflicht liest — Phase 43)
 */
export default function KatalogPanel({ titel, katalog, onAdd, chipTitle, renderChip }) {
  return (
    <div className="rounded-lg border bg-slate-50 p-2 space-y-2 self-start">
      {titel && <div className="text-xs font-semibold text-slate-600">{titel}</div>}
      {(katalog || []).map((g) => (
        <div key={g.gruppe} className="space-y-1">
          <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{g.gruppe}</div>
          <div className="flex flex-wrap gap-1">
            {(g.typen || []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onAdd?.(t.id)}
                title={chipTitle ? chipTitle(t) : t.name}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-sky-50 hover:border-sky-300 transition-colors"
              >
                {renderChip ? renderChip(t) : t.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
