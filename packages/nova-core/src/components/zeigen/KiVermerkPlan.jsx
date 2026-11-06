// 106-11: marks of the elements touched by unreleased AI changes in the 2D plan (Grundriss) - the screen counterpart of the marks
// on the printed sheet (planGrafik kiMarken). Rendered through the overlay render-prop of BimPlan2D (inside the plan's <svg>):
// a DASHED frame a little outside the element plus a "?" (form, not colour alone - guard rail 5; text-warnung adds the colour).
// Pointer events pass through; nothing here changes a model.
//
// In:  modell accessor (studio state), guids (planStand.js ModellStand.guids), projektId, generated hull walls (106-11 review: a
//      changed hull-wall opening marks its hull wall), level shown, plan transformers X/Z/SCALE.
// Out: <g data-testid="ki-vermerk-plan"> with one <g data-testid="ki-vermerk-marke" data-guid> per marked element on this storey.
import React from "react";
import { kiMarkierungen, markenRahmen } from "@core/lib/zeigen/planStand.js";

/** Gap between element and frame in m on screen [ASSUMED: 0.15 m, the 1.5 mm of the 1:100 sheet]. */
const RAND_M = 0.15;

/**
 * @param {{modell: () => any, guids: ReadonlyArray<string>, projektId?: string|number|null, huellWaende?: ReadonlyArray<any>|null, level: number,
 *   X: (x: number) => number, Z: (z: number) => number, SCALE: number}} props  huellWaende: generated hull walls shown (m); level: storey
 *   shown (0-based); X/Z/SCALE: the plan's LIVE transformers (svg units, SCALE per m).
 */
export default function KiVermerkPlan({ modell, guids, projektId = null, huellWaende = null, level, X, Z, SCALE }) {
  if (!guids?.length) return null;
  const marken = kiMarkierungen(modell(), guids, { projektId, huellWaende }).filter((m) => m.level === level);
  if (!marken.length) return null;
  return (
    <g data-testid="ki-vermerk-plan" style={{ pointerEvents: "none" }} className="text-warnung">
      {marken.map((m) => {
        const r = markenRahmen(m.punkte, RAND_M);
        return (
          <g key={m.guid} data-testid="ki-vermerk-marke" data-guid={m.guid} data-form="gestrichelt">
            <polygon points={r.map((q) => `${X(q.x)},${Z(q.z)}`).join(" ")} fill="none" stroke="currentColor" strokeDasharray="6 3"
              strokeWidth={Math.max(1.5, SCALE * 0.04)} strokeLinejoin="round" />
            <text x={X(r[1].x) + 3} y={Z(r[1].z) + 4} fill="currentColor" fontSize={Math.max(11, SCALE * 0.35)} fontWeight="700">?</text>
          </g>
        );
      })}
    </g>
  );
}
