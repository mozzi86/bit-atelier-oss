// 106-03 (review fix): overlay of the open proposals in the 2D plan (Grundriss) - the plan counterpart of the 3D ghost.
// Rendered by the BIM studio through the overlay render-prop of BimPlan2D (inside the plan's <svg>): one outline per
// shape of planFormen(). Form, not only colour (guard rail 5): a blocked proposal is a SOLID outline, every other
// one DASHED (like the 3D preview: the dashed 'warnung' outline, the solid 'fehler' outline); the token classes
// (text-warnung, text-fehler) add the colour. Nothing here changes a model; pointer events pass through.
//
// In:  speicher (vorschlagSpeicher), modell accessor, plan transformers X(m), Z(m), SCALE (svg units per m), level (storey shown).
// Out: <g data-testid="plan-vorschau"> with <polygon>/<line> per shape (data-vorschlag-id, data-stufe, data-form).
import React, { useSyncExternalStore } from "react";
import { planFormen } from "@core/lib/zeigen/planVorschau.js";

/**
 * @param {{speicher: ReturnType<typeof import("@core/lib/zeigen/vorschlagSpeicher.js").vorschlagSpeicher>, modell: () => any,
 *   projektId?: string|number|null, geschosshoehe_m?: number, level: number, X: (x: number) => number, Z: (z: number) => number, SCALE: number}} props
 *   level: storey the plan shows (0-based); only shapes of that storey are drawn; X/Z/SCALE are the plan's LIVE transformers (never cached).
 */
export default function PlanVorschau({ speicher, modell, projektId = null, geschosshoehe_m, level, X, Z, SCALE }) {
  const stand = useSyncExternalStore(speicher.abonnieren, speicher.stand);
  if (!stand.offen.length) return null;
  const m = modell();
  return (
    <g data-testid="plan-vorschau" style={{ pointerEvents: "none" }}>
      {stand.offen.flatMap((v) => {
        const gesperrt = v.pruefung?.stufe === "fehler";
        const klasse = gesperrt ? "text-fehler" : "text-warnung";
        const strich = gesperrt ? undefined : "6 4";
        return planFormen(m, v, { projektId, geschosshoehe_m }).filter((f) => f.level === level).map((f, i) => {
          const pts = f.punkte.map((q) => `${X(q.x)},${Z(q.z)}`).join(" ");
          const gemeinsam = { "data-vorschlag-id": v.id, "data-stufe": v.pruefung?.stufe ?? "ok", "data-form": gesperrt ? "durchgezogen" : "gestrichelt",
            className: klasse, stroke: "currentColor", strokeDasharray: strich, fill: "none" };
          return f.typ === "flaeche"
            ? <polygon key={`${v.id}-${i}`} {...gemeinsam} points={pts} strokeWidth={Math.max(1.5, SCALE * 0.04)} strokeLinejoin="round" />
            : <polyline key={`${v.id}-${i}`} {...gemeinsam} points={pts} strokeWidth={Math.max(2, SCALE * 0.06)} strokeLinecap="round" />;
        });
      })}
    </g>
  );
}
