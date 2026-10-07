// Präsentationsfreies Sketch-Rendering (Phase 34, PW-05): Linien, Kreise,
// Punkte, Constraint-Glyphen und Maß-Labels — OHNE eigenen Viewport-State.
// Die Welt→Ziel-Transformatoren X/Y und der Maßstab (Ziel-Einheiten je Meter)
// werden injiziert. Damit rendert dieselbe Komponente
//   (a) im Standalone-Sketcher (SketchCanvas: X/Y aus dessen view, +y oben) und
//   (b) als BimPlan2D-Overlay der Plan-Werkstatt (X/Z-Transformatoren des
//       Grundrisses; der Y-Flip Sketch↔Welt passiert BEIM AUFRUFER:
//       X_o = (wx) => X(origin.x + wx), Y_o = (wy) => Z(origin.z - wy)).
//
// Farbcodierung nach FreeCAD-Sketcher: vollbestimmt grün, Konflikt rot,
// Konstruktionsgeometrie blau gestrichelt, Auswahl teal.

import React from "react";
import { CONSTRAINT_GLYPHS, constraintRefs } from "../lib/sketchModel.js";

export const SKETCH_FARBEN = {
  normal: "#334155",
  voll: "#059669",
  konflikt: "#e11d48",
  konstruktion: "#2563eb",
  auswahl: "#0d9488",
  entwurf: "#94a3b8",
};

const LEER = new Set();

/**
 * @param sketch    Sketch-Modell (Maps points/lines/circles/constraints)
 * @param X/Y       Welt-Meter → Ziel-SVG-Einheiten (inkl. etwaigem Y-Flip!)
 * @param scale     Ziel-Einheiten je Meter (Kreisradien, live durchreichen)
 * @param selection Set ausgewählter IDs (optional)
 * @param lastSolve letztes Solver-Ergebnis {dof, conflicting} (optional)
 * @param hoverPt   ID des gehoverten Punkts (optional, vergrößert den Punkt)
 * @param onSelect  (id, additive) — Klick auf Constraint-Glyphen (optional;
 *                  ohne Handler sind die Glyphen klick-durchlässig)
 * @param masstab   Faktor auf Strichstärken/Punktradien/Schriftgrößen — 1 =
 *                  Standalone-Look; im BimPlan2D-Overlay ggf. verkleinern.
 */
export default function SketchGeometry({
  sketch,
  X,
  Y,
  scale,
  selection = LEER,
  lastSolve = null,
  hoverPt = null,
  onSelect,
  masstab = 1,
}) {
  const vollBestimmt = lastSolve && lastSolve.dof === 0 && lastSolve.conflicting.length === 0;
  const konfliktGeo = new Set();
  if (lastSolve) {
    for (const kid of lastSolve.conflicting) {
      const c = sketch.constraints.get(kid);
      if (c) for (const ref of constraintRefs(c)) konfliktGeo.add(ref);
    }
  }
  const farbe = (g) => {
    if (selection.has(g.id)) return SKETCH_FARBEN.auswahl;
    if (konfliktGeo.has(g.id)) return SKETCH_FARBEN.konflikt;
    if (g.construction) return SKETCH_FARBEN.konstruktion;
    if (vollBestimmt) return SKETCH_FARBEN.voll;
    return SKETCH_FARBEN.normal;
  };
  const m = masstab;

  return (
    <g data-sketch-geometry>
      {/* Linien */}
      {[...sketch.lines.values()].map((l) => {
        const a = sketch.points.get(l.p1);
        const b = sketch.points.get(l.p2);
        if (!a || !b) return null;
        return (
          <line
            key={l.id}
            x1={X(a.x)}
            y1={Y(a.y)}
            x2={X(b.x)}
            y2={Y(b.y)}
            stroke={farbe(l)}
            strokeWidth={(selection.has(l.id) ? 3.5 : 2.5) * m}
            strokeDasharray={l.construction ? `${6 * m} ${4 * m}` : undefined}
            strokeLinecap="round"
          />
        );
      })}

      {/* Kreise */}
      {[...sketch.circles.values()].map((c) => {
        const z = sketch.points.get(c.center);
        if (!z) return null;
        return (
          <circle
            key={c.id}
            cx={X(z.x)}
            cy={Y(z.y)}
            r={c.radius * scale}
            fill="none"
            stroke={farbe(c)}
            strokeWidth={(selection.has(c.id) ? 3.5 : 2.5) * m}
            strokeDasharray={c.construction ? `${6 * m} ${4 * m}` : undefined}
          />
        );
      })}

      {/* Punkte (über den Linien) */}
      {[...sketch.points.values()].map((p) => (
        <circle
          key={p.id}
          cx={X(p.x)}
          cy={Y(p.y)}
          r={(hoverPt === p.id ? 6 : 4.5) * m}
          fill={p.fixed ? "#334155" : "white"}
          stroke={farbe(p)}
          strokeWidth={(selection.has(p.id) ? 3 : 2) * m}
        />
      ))}

      {/* Constraint-Glyphen + Maß-Labels */}
      {[...sketch.constraints.values()].map((c) => {
        const pos = glyphPos(c, sketch);
        if (!pos) return null;
        const istMass = c.type === "distance" || c.type === "radius" || c.type === "angle";
        const text = istMass ? `${CONSTRAINT_GLYPHS[c.type]} ${massText(c)}` : CONSTRAINT_GLYPHS[c.type];
        return (
          <text
            key={c.id}
            x={X(pos.x)}
            y={Y(pos.y) - 8 * m}
            fontSize={(istMass ? 12 : 13) * m}
            textAnchor="middle"
            fill={
              lastSolve?.conflicting.includes(c.id)
                ? SKETCH_FARBEN.konflikt
                : selection.has(c.id)
                  ? SKETCH_FARBEN.auswahl
                  : "#64748b"
            }
            className={onSelect ? "cursor-pointer select-none" : "select-none"}
            style={onSelect ? undefined : { pointerEvents: "none" }}
            onPointerDown={
              onSelect
                ? (e) => {
                    e.stopPropagation();
                    onSelect(c.id, e.shiftKey || e.pointerType === "touch");
                  }
                : undefined
            }
          >
            {text}
          </text>
        );
      })}
    </g>
  );
}

/** Glyph-Position eines Constraints in Welt-Metern (exportiert für Hosts). */
export function glyphPos(c, sketch) {
  const mitteLinie = (id) => {
    const l = sketch.lines.get(id);
    if (!l) return null;
    const a = sketch.points.get(l.p1);
    const b = sketch.points.get(l.p2);
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  };
  switch (c.type) {
    case "horizontal":
    case "vertical":
      return mitteLinie(c.line);
    case "parallel":
    case "perpendicular":
    case "angle":
      return mitteLinie(c.a);
    case "distance": {
      const a = sketch.points.get(c.a);
      const b = sketch.points.get(c.b);
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    }
    case "coincident":
    case "lock": {
      const p = sketch.points.get(c.type === "lock" ? c.point : c.a);
      return p ? { x: p.x, y: p.y } : null;
    }
    case "pointOnLine": {
      const p = sketch.points.get(c.point);
      return p ? { x: p.x, y: p.y } : null;
    }
    case "radius": {
      const k = sketch.circles.get(c.circle);
      const z = k && sketch.points.get(k.center);
      return z ? { x: z.x, y: z.y + k.radius } : null;
    }
    default:
      return null;
  }
}

/** Maß-Beschriftung (Zahl, Winkel in Grad, benannter Parameter in ⟨⟩). */
export function massText(c) {
  if (typeof c.value !== "number") return `⟨${c.value}⟩`; // benannter Parameter
  if (c.type === "angle") return `${((c.value * 180) / Math.PI).toFixed(1)}°`;
  return `${c.value.toFixed(2).replace(".", ",")} m`;
}
