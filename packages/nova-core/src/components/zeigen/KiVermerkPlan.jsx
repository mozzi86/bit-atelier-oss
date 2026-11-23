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
 *   X: (x: number) => number, Z: (z: number) => number, SCALE: number, drehung?: number, aufrecht?: ((x: number, y: number) => string|undefined)|null}} props  huellWaende: generated hull walls shown (m); level: storey
 *   shown (0-based); X/Z/SCALE: the plan's LIVE transformers (svg units, SCALE per m).
 *   115-04: drehung = rotation of the host plan (degrees counter-clockwise as seen, 0 | 90 | 180 | 270) and aufrecht(x, y) = its SVG
 *   transform that keeps a text upright about a point (undefined when not turned) — the "?" then sits at the corner the reader sees
 *   top-right. Without them the marks are drawn as before.
 */
export default function KiVermerkPlan({ modell, guids, projektId = null, huellWaende = null, level, X, Z, SCALE, drehung = 0, aufrecht = null }) {
  if (!guids?.length) return null;
  const marken = kiMarkierungen(modell(), guids, { projektId, huellWaende }).filter((m) => m.level === level);
  if (!marken.length) return null;
  return (
    <g data-testid="ki-vermerk-plan" style={{ pointerEvents: "none" }} className="text-warnung">
      {marken.map((m) => {
        const r = markenRahmen(m.punkte, RAND_M);
        // corners of the frame: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left in the model frame; a quarter turn to the left
        // brings the next one to the top-right as seen
        const ecke = r[(1 + Math.round((Number(drehung) || 0) / 90)) % 4] || r[1];
        return (
          <g key={m.guid} data-testid="ki-vermerk-marke" data-guid={m.guid} data-form="gestrichelt">
            <polygon points={r.map((q) => `${X(q.x)},${Z(q.z)}`).join(" ")} fill="none" stroke="currentColor" strokeDasharray="6 3"
              strokeWidth={Math.max(1.5, SCALE * 0.04)} strokeLinejoin="round" />
            <text x={X(ecke.x) + 3} y={Z(ecke.z) + 4} fill="currentColor" fontSize={Math.max(11, SCALE * 0.35)} fontWeight="700" transform={aufrecht?.(X(ecke.x), Z(ecke.z))}>?</text>
          </g>
        );
      })}
    </g>
  );
}
