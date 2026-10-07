// Fire-protection plan symbols as React SVG (Phase 38, BSP-03) — schematic approximations of the
// DIN 14034-6 / ISO 7010 pictograms ([ASSUMED], see SYMBOLE_DIN14034 in brandschutzPlan.js).
//
// In:  typ (catalogue key), centre x/y in SVG units, size in SVG units, sel (selected).
// Out: one <g> per symbol; SymbolLegende renders the same shapes at 16 px for legends.
// No data here — colours, short codes and shapes come from the catalogue.

import React from "react";
import { SYMBOLE_DIN14034 } from "@designer/lib/brandschutzPlan";

/**
 * One symbol in the plan.
 * @param {{ typ: string, x: number, y: number, size?: number, sel?: boolean }} p size = edge length / diameter in SVG units
 */
export default function FeuerwehrSymbol({ typ, x, y, size = 14, sel = false }) {
  const s = SYMBOLE_DIN14034[typ];
  if (!s) return null;
  const h = size / 2;
  const stroke = sel ? "#0f172a" : "#ffffff";
  const sw = sel ? 2 : 1;
  const text = (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(5, size * 0.42)} fontWeight="700"
      fill={s.form === "kreis" && typ === "rauchmelder" ? s.farbe : "#ffffff"} style={{ pointerEvents: "none" }}>
      {s.kurz}
    </text>
  );
  if (s.form === "kreis") {
    if (typ === "rauchmelder") {
      // white disc, red ring, red centre dot — the "point detector" reading
      return (
        <g>
          <circle cx={x} cy={y} r={h} fill="#ffffff" stroke={s.farbe} strokeWidth={Math.max(1.5, size * 0.12)} />
          <circle cx={x} cy={y} r={Math.max(1.5, size * 0.16)} fill={s.farbe} />
          {sel && <circle cx={x} cy={y} r={h + 2.5} fill="none" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="3 2" />}
        </g>
      );
    }
    return (
      <g>
        <circle cx={x} cy={y} r={h} fill={s.farbe} stroke={stroke} strokeWidth={sw} />
        {text}
      </g>
    );
  }
  if (s.form === "pfeil") {
    // arrow pointing +x (access direction) with the short code above
    const w = size * 1.4, hh = size * 0.5;
    const pts = [
      [x - w / 2, y - hh * 0.35], [x + w * 0.1, y - hh * 0.35], [x + w * 0.1, y - hh * 0.8], [x + w / 2, y],
      [x + w * 0.1, y + hh * 0.8], [x + w * 0.1, y + hh * 0.35], [x - w / 2, y + hh * 0.35],
    ].map((p) => p.join(",")).join(" ");
    return (
      <g>
        <polygon points={pts} fill={s.farbe} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <text x={x - w * 0.15} y={y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(5, size * 0.36)} fontWeight="700" fill="#ffffff" style={{ pointerEvents: "none" }}>{s.kurz}</text>
      </g>
    );
  }
  // quadrat (default): filled square with white border and short code
  return (
    <g>
      <rect x={x - h} y={y - h} width={size} height={size} rx={size * 0.1} fill={s.farbe} stroke={stroke} strokeWidth={sw} />
      {text}
    </g>
  );
}

/**
 * Legend row: small symbol + label (+ count).
 * @param {{ typ: string, anzahl?: number, label?: string }} p
 */
export function SymbolLegende({ typ, anzahl, label }) {
  const s = SYMBOLE_DIN14034[typ];
  if (!s) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
      <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true"><FeuerwehrSymbol typ={typ} x={10} y={8} size={12} /></svg>
      {label || s.label}{anzahl != null ? ` (${anzahl})` : ""}
    </span>
  );
}
