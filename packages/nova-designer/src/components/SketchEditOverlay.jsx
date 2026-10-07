// Sketch-Editing DIREKT im Grundriss der Plan-Werkstatt (Phase 34-05, PW-05
// Ausbau): wird als overlay-Render-Prop von BimPlan2D gerendert und bekommt
// die LIVE-Transformatoren (X/Z/SCALE/toMeters). Koordinaten-Konvention:
// Sketch (+y nach oben, FreeCAD) ↔ Plan (Z nach unten):
//   sketch.x = welt.x · sketch.y = −welt.z  (und zurück).
// Werkzeuge bewusst schlank: Linienzug zeichnen (Fang auf Punkte = Auto-
// Koinzidenz, Auto-H/V) und Punkte regelkonform ziehen (Solver-Drag über
// temporäre Constraints). Constraints/Maße/Parameter pflegt der BIT Sketcher
// (/SketchStudio) — derselbe Sketch, dasselbe BimModel-Feld sketch_layer.

import React from "react";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import SketchGeometry from "@sketch/components/SketchGeometry.jsx";

const SNAP_M = 0.25;
const snap = (v) => Math.round(v / SNAP_M) * SNAP_M;
const AXIS_SNAP_DEG = 4;

/** Welt ({x,z}, Plan) → Sketch ({x,y}, +y oben). */
const weltZuSketch = (w) => ({ x: w.x, y: -w.z });

function axisAuto(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 0.5) return null;
  const winkel = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (winkel < AXIS_SNAP_DEG) return "horizontal";
  if (winkel > 90 - AXIS_SNAP_DEG) return "vertical";
  return null;
}

export default function SketchEditOverlay({
  sketch,
  version: _version, // erzwingt Re-Render nach Mutationen
  lastSolve,
  tool, // "select" | "line"
  draft, // {start: {pointId}|{x,y}, x, y} in Sketch-Koordinaten
  setDraft,
  onAddSegment, // (startSpec, endSpec, autoConstraint) => endPointId
  onDragPoint, // (pointId, x, y) — Solver-Drag
  onDragEnd,
  X,
  Z,
  SCALE,
  toMeters,
  bounds,
  zoom = 1,
}) {
  const Y = (wy) => Z(-wy);

  const snapPoint = (s) => {
    let best = null;
    // Zoombewusst (Review-Fix): 12 Bildschirm-nahe Einheiten — beim Reinzoomen
    // schrumpft der Fangradius in Metern, sonst wären kurze Segmente nie zeichenbar.
    let bestD = 12 / (SCALE * (zoom || 1));
    for (const p of sketch.points.values()) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  // Mitteltaste (Pan) gehört BimPlan2D — nur linke/rechte Taste stoppen
  // (Review-Fix: bedingungsloses stopPropagation blockierte das Pannen).
  const stoppeAusserPan = (e) => {
    if (e.button !== 1) e.stopPropagation();
  };

  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const w = toMeters(e);
      if (!w) return;
      const s = weltZuSketch(w);
      onDragPoint(d.pointId, snap(s.x), snap(s.y));
    },
    onDragEnd: () => onDragEnd(),
  });

  const klick = (e) => {
    e.stopPropagation();
    if (tool !== "line") return;
    const w = toMeters(e);
    if (!w) return;
    const roh = weltZuSketch(w);
    const hit = snapPoint(roh);
    const end = hit ? { pointId: hit.id } : { x: snap(roh.x), y: snap(roh.y) };
    if (!draft) {
      setDraft({ start: end, x: roh.x, y: roh.y });
      return;
    }
    const startPt = draft.start.pointId ? sketch.points.get(draft.start.pointId) : draft.start;
    if (!startPt) {
      setDraft({ start: end, x: roh.x, y: roh.y }); // Startpunkt wurde gelöscht
      return;
    }
    const endPt = end.pointId ? sketch.points.get(end.pointId) : end;
    const startId = onAddSegment(draft.start, end, endPt ? axisAuto(startPt, endPt) : null);
    setDraft({ start: { pointId: startId }, x: roh.x, y: roh.y }); // Linienzug fortsetzen
  };

  const doppelklick = (e) => {
    e.stopPropagation();
    setDraft(null); // Linienzug beenden
  };

  const startRes = draft && (draft.start.pointId ? sketch.points.get(draft.start.pointId) : draft.start);

  // Gummiband folgt dem Cursor (Review-Fix: vorher nur bei Klicks aktualisiert).
  const bewege = (e) => {
    if (!draft || tool !== "line") return;
    const w = toMeters(e);
    if (!w) return;
    const s = weltZuSketch(w);
    setDraft((d) => (d ? { ...d, x: s.x, y: s.y } : d));
  };

  return (
    <g data-sketch-edit>
      {/* Klick-Fläche über dem ganzen Plan (X(minX)=PAD·SCALE ⇒ Breite = X(max)+X(min)) */}
      <rect
        x="0"
        y="0"
        width={X(bounds.maxX) + X(bounds.minX)}
        height={Z(bounds.maxZ) + Z(bounds.minZ)}
        fill="transparent"
        style={{ cursor: tool === "line" ? "crosshair" : "default" }}
        onClick={klick}
        onDoubleClick={doppelklick}
        onMouseMove={bewege}
        onMouseDown={stoppeAusserPan}
      />

      {/* klick-durchlässig (Review-Fix): sonst schluckten gefüllte Punkte/Linien
          die Klicks der Zeichenfläche — Fang übernimmt snapPoint. */}
      <g style={{ pointerEvents: "none" }}>
        <SketchGeometry sketch={sketch} X={X} Y={Y} scale={SCALE} lastSolve={lastSolve} masstab={0.7} />
      </g>

      {/* Gummiband des Linienzugs */}
      {draft && startRes && (
        <line
          x1={X(startRes.x)}
          y1={Y(startRes.y)}
          x2={X(draft.x)}
          y2={Y(draft.y)}
          stroke="#94a3b8"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Drag-Handles über den Punkten (Auswahl-Werkzeug) */}
      {tool === "select" &&
        [...sketch.points.values()].map((p) => (
          <circle
            key={`h${p.id}`}
            cx={X(p.x)}
            cy={Y(p.y)}
            r={7}
            fill="transparent"
            stroke="transparent"
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              if (e.button !== 0) return; // Mitteltaste = Pan
              startDrag(e, { pointId: p.id });
            }}
            onMouseDown={stoppeAusserPan}
            onClick={(e) => e.stopPropagation()}
          />
        ))}
    </g>
  );
}
