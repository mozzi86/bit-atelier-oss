import React from "react";
import { modelDims } from "@core/lib/bimElements";

// Schematic, parametric architectural drawings generated from the building's
// dimensions (floors / footprint). Line-drawing style, suitable for reports.

const STROKE = "#334155";
const THIN = "#94a3b8";
const DIM = "#64748b";

function DimLine({ x1, y1, x2, y2, label, vertical }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DIM} strokeWidth="0.8" />
      <line x1={x1} y1={y1 - (vertical ? 0 : 3)} x2={x1} y2={y1 + (vertical ? 0 : 3)} stroke={DIM} strokeWidth="0.8" />
      <line x1={x2} y1={y2 - (vertical ? 0 : 3)} x2={x2} y2={y2 + (vertical ? 0 : 3)} stroke={DIM} strokeWidth="0.8" />
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 2} fontSize="9" fill={DIM} textAnchor="middle"
        transform={vertical ? `rotate(-90 ${(x1 + x2) / 2} ${(y1 + y2) / 2})` : undefined}>{label}</text>
    </g>
  );
}

// --- Floor plan (Grundriss) ----------------------------------------------
export function FloorPlan({ building, project }) {
  const { w, d } = modelDims(building);
  const VBW = 820, M = 70;
  const scale = (VBW - 2 * M) / w;
  const pw = w * scale, ph = d * scale;
  const x0 = M, y0 = M;
  const cols = Math.max(2, Math.round(w / 6));
  const rows = Math.max(2, Math.round(d / 6));
  const cellW = pw / cols, cellH = ph / rows;
  const VBH = ph + 2 * M;

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto bg-white">
      {/* outer wall (double line) */}
      <rect x={x0} y={y0} width={pw} height={ph} fill="#f8fafc" stroke={STROKE} strokeWidth="2.4" />
      <rect x={x0 + 5} y={y0 + 5} width={pw - 10} height={ph - 10} fill="none" stroke={THIN} strokeWidth="0.8" />
      {/* interior partitions */}
      {Array.from({ length: cols - 1 }).map((_, i) => (
        <line key={`v${i}`} x1={x0 + cellW * (i + 1)} y1={y0 + 5} x2={x0 + cellW * (i + 1)} y2={y0 + ph - 5} stroke={THIN} strokeWidth="1" />
      ))}
      {Array.from({ length: rows - 1 }).map((_, i) => (
        <line key={`h${i}`} x1={x0 + 5} y1={y0 + cellH * (i + 1)} x2={x0 + pw - 5} y2={y0 + cellH * (i + 1)} stroke={THIN} strokeWidth="1" />
      ))}
      {/* stair / core */}
      <rect x={x0 + pw / 2 - cellW / 2} y={y0 + ph / 2 - cellH / 2} width={cellW} height={cellH} fill="#e2e8f0" stroke={STROKE} strokeWidth="1.2" />
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={`s${i}`} x1={x0 + pw / 2 - cellW / 2} y1={y0 + ph / 2 - cellH / 2 + (cellH / 6) * i} x2={x0 + pw / 2 + cellW / 2} y2={y0 + ph / 2 - cellH / 2 + (cellH / 6) * i} stroke={DIM} strokeWidth="0.6" />
      ))}
      <text x={x0 + pw / 2} y={y0 + ph / 2 + 3} fontSize="8" fill={DIM} textAnchor="middle">TRH</text>
      {/* entrance door opening (bottom middle) */}
      <rect x={x0 + pw / 2 - cellW / 2} y={y0 + ph - 3} width={cellW} height="6" fill="#fff" />
      <path d={`M ${x0 + pw / 2 - cellW / 2} ${y0 + ph} A ${cellW} ${cellW} 0 0 1 ${x0 + pw / 2 + cellW / 2} ${y0 + ph}`} fill="none" stroke={THIN} strokeWidth="0.8" />
      {/* room labels */}
      <text x={x0 + cellW / 2} y={y0 + cellH / 2} fontSize="9" fill={DIM} textAnchor="middle">Raum 1</text>
      <text x={x0 + pw - cellW / 2} y={y0 + cellH / 2} fontSize="9" fill={DIM} textAnchor="middle">Raum 2</text>
      {/* dimensions */}
      <DimLine x1={x0} y1={y0 - 18} x2={x0 + pw} y2={y0 - 18} label={`${w.toFixed(1)} m`} />
      <DimLine x1={x0 - 18} y1={y0} x2={x0 - 18} y2={y0 + ph} label={`${d.toFixed(1)} m`} vertical />
      {/* north arrow */}
      <g transform={`translate(${VBW - 34} ${36})`}>
        <line x1="0" y1="12" x2="0" y2="-12" stroke={STROKE} strokeWidth="1.4" />
        <path d="M 0 -12 L 4 -4 L -4 -4 Z" fill={STROKE} />
        <text x="0" y="24" fontSize="9" fill={STROKE} textAnchor="middle">N</text>
      </g>
      <text x={x0} y={VBH - 6} fontSize="9" fill={DIM}>Grundriss Regelgeschoss · {project?.name || ""} · M ~1:200 (schematisch)</text>
    </svg>
  );
}

// --- Elevation (Ansicht) -------------------------------------------------
export function Elevation({ building, project }) {
  const { w, floors, floorH } = modelDims(building);
  const totalH = floors * floorH;
  const VBW = 820, M = 70;
  const scale = (VBW - 2 * M) / w;
  const fw = w * scale, fh = totalH * scale, sh = floorH * scale;
  const x0 = M, gy = M + fh; // ground y
  const VBH = fh + 2 * M;
  const winPerFloor = Math.max(2, Math.round(w / 4));
  const wWin = (fw / winPerFloor) * 0.55, gap = (fw / winPerFloor);

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto bg-white">
      {/* sky/ground */}
      <line x1={x0 - 30} y1={gy} x2={x0 + fw + 30} y2={gy} stroke={STROKE} strokeWidth="2" />
      {Array.from({ length: 14 }).map((_, i) => (
        <line key={i} x1={x0 - 30 + i * ((fw + 60) / 14)} y1={gy} x2={x0 - 36 + i * ((fw + 60) / 14)} y2={gy + 6} stroke={DIM} strokeWidth="0.6" />
      ))}
      {/* facade */}
      <rect x={x0} y={M} width={fw} height={fh} fill="#f8fafc" stroke={STROKE} strokeWidth="2" />
      {/* roof parapet */}
      <rect x={x0 - 4} y={M - 5} width={fw + 8} height="5" fill="#e2e8f0" stroke={STROKE} strokeWidth="1" />
      {/* floor lines + windows */}
      {Array.from({ length: floors }).map((_, i) => {
        const fy = gy - sh * (i + 1);
        return (
          <g key={i}>
            <line x1={x0} y1={gy - sh * i} x2={x0 + fw} y2={gy - sh * i} stroke={THIN} strokeWidth="0.8" />
            {Array.from({ length: winPerFloor }).map((_, j) => (
              <rect key={j} x={x0 + gap * j + (gap - wWin) / 2} y={fy + sh * 0.22} width={wWin} height={sh * 0.5}
                fill="#cfe3ff" stroke={STROKE} strokeWidth="0.8" />
            ))}
          </g>
        );
      })}
      {/* entrance */}
      <rect x={x0 + fw / 2 - gap * 0.3} y={gy - sh * 0.75} width={gap * 0.6} height={sh * 0.75} fill="#475569" stroke={STROKE} strokeWidth="1" />
      {/* height dimension + level labels */}
      <DimLine x1={x0 + fw + 22} y1={M} x2={x0 + fw + 22} y2={gy} label={`${totalH.toFixed(1)} m`} vertical />
      {Array.from({ length: floors + 1 }).map((_, i) => (
        <text key={i} x={x0 - 10} y={gy - sh * i + 3} fontSize="8" fill={DIM} textAnchor="end">{i === 0 ? "±0,00" : `+${(i * floorH).toFixed(2)}`}</text>
      ))}
      <text x={x0} y={VBH - 6} fontSize="9" fill={DIM}>Ansicht Süd · {project?.name || ""} · {floors} Geschosse · M ~1:200 (schematisch)</text>
    </svg>
  );
}

// --- Section (Schnitt) ---------------------------------------------------
export function Section({ building, project }) {
  const { d, floors, floorH } = modelDims(building);
  const totalH = floors * floorH;
  const VBW = 820, M = 70;
  const scale = (VBW - 2 * M) / d;
  const sw = d * scale, shh = totalH * scale, sh = floorH * scale;
  const x0 = M, gy = M + shh;
  const VBH = shh + 2 * M;

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto bg-white">
      {/* ground & foundation */}
      <line x1={x0 - 30} y1={gy} x2={x0 + sw + 30} y2={gy} stroke={STROKE} strokeWidth="2" />
      <rect x={x0 - 6} y={gy} width={sw + 12} height="10" fill="#e2e8f0" stroke={STROKE} strokeWidth="1.2" />
      {/* storeys with slabs */}
      {Array.from({ length: floors }).map((_, i) => {
        const fy = gy - sh * (i + 1);
        return (
          <g key={i}>
            {/* slab (filled = cut) */}
            <rect x={x0} y={gy - sh * (i + 1)} width={sw} height={6} fill={STROKE} />
            {/* room void */}
            <rect x={x0 + 2} y={fy + 6} width={sw - 4} height={sh - 6} fill="#f8fafc" stroke={THIN} strokeWidth="0.6" />
            {/* outer walls (cut) */}
            <rect x={x0 - 6} y={fy} width="6" height={sh} fill={STROKE} />
            <rect x={x0 + sw} y={fy} width="6" height={sh} fill={STROKE} />
            <text x={x0 + 8} y={gy - sh * i - 8} fontSize="8" fill={DIM}>{i === 0 ? "EG" : `${i}. OG`}</text>
          </g>
        );
      })}
      {/* roof */}
      <rect x={x0 - 6} y={M - 6} width={sw + 12} height="6" fill={STROKE} />
      {/* dims */}
      <DimLine x1={x0 + sw + 22} y1={M} x2={x0 + sw + 22} y2={gy} label={`${totalH.toFixed(1)} m`} vertical />
      <DimLine x1={x0} y1={gy + 22} x2={x0 + sw} y2={gy + 22} label={`${d.toFixed(1)} m`} />
      {/* storey height note */}
      <DimLine x1={x0 - 22} y1={gy - sh} x2={x0 - 22} y2={gy} label={`${floorH.toFixed(2)} m`} vertical />
      <text x={x0} y={VBH - 6} fontSize="9" fill={DIM}>Schnitt A–A · {project?.name || ""} · lichte Höhe {floorH.toFixed(2)} m · M ~1:200 (schematisch)</text>
    </svg>
  );
}

export const DRAWING_TYPES = [
  { key: "plan", label: "Grundriss", Comp: FloorPlan },
  { key: "elevation", label: "Ansicht", Comp: Elevation },
  { key: "section", label: "Schnitt", Comp: Section },
];
