// SVG-Zeichenfläche des Sketchers. Interaktionsmuster nach BimPlan2D
// (getScreenCTM-Inverse für Pixel→Welt, 0,25-m-Snap, Mitteltaste = Pan,
// Wheel = Zoom auf Cursor) — Koordinaten in Metern, +y nach oben (FreeCAD-Konvention).
//
// Eingabegeräte: Maus, Stift (Apple Pencil / S-Pen, pointerType "pen") und
// Touch. Touch-Regeln: 1 Finger = Tippen/Ziehen (Zeichnen-Aktionen erst beim
// pointerup, damit ein zweiter Finger keine Punkte setzt), 2 Finger =
// Pinch-Zoom + Pan, größere Fang-/Treffer-Radien. touch-action:none nimmt
// dem Browser Scroll/Doppeltipp-Zoom auf der Fläche.
//
// Farbcodierung nach FreeCAD-Sketcher: vollbestimmt grün, Konflikt rot,
// Konstruktionsgeometrie blau gestrichelt, Auswahl teal (App-Selektionsfarbe).

import React, { useRef, useState, useCallback, useEffect } from "react";
import SketchGeometry, { SKETCH_FARBEN } from "./SketchGeometry.jsx";

const VB_W = 1000;
const VB_H = 640;
const SNAP_M = 0.25; // Raster-Snap wie BimPlan2D
const AXIS_SNAP_DEG = 4; // Auto-Constraint horizontal/vertikal beim Zeichnen
const TAP_TOL_PX = 10; // Bewegungstoleranz, bis ein Touch-Tap als Tap gilt

/** Fang-/Treffer-Radien in View-Pixeln, fingerfreundlich bei Touch. */
const snapRadius = (pointerType) => (pointerType === "touch" ? 26 : 12);
const hitRadius = (pointerType) => (pointerType === "touch" ? 18 : 8);

// Geometrie-Farben leben in SketchGeometry (Phase 34: gemeinsames Rendering
// für Standalone-Sketcher UND Plan-Werkstatt-Overlay); hier nur der Entwurf.
const FARBEN = SKETCH_FARBEN;

export default function SketchCanvas({
  sketch,
  version: _version, // erzwingt Re-Render nach Modell-Mutationen
  tool,
  selection,
  lastSolve,
  onSelect,
  onClearSelection,
  onAddPoint,
  onAddSegment, // (startPointIdOrNull, {x,y} | {pointId}, autoConstraint) — Linienzug
  onAddCircle,
  onDragPoint, // (pointId, x, y)
  onDragEnd,
}) {
  const svgRef = useRef(null);
  const [view, setView] = useState({ cx: 5, cy: 3, scale: 55 }); // Weltmitte + px/m
  const [draft, setDraft] = useState(null); // {start: {pointId}|{x,y}, x, y}
  const [hoverPt, setHoverPt] = useState(null);
  const dragRef = useRef(null); // {pointId, moved}
  const dragPosRef = useRef(null); // letzte Client-Position während Drag (rAF liest hier — nie stale)
  const panRef = useRef(null); // Maus-Mitteltaste
  const rafRef = useRef(0);
  const pointersRef = useRef(new Map()); // pointerId -> {x, y} (Client-Pixel)
  const gestureRef = useRef(null); // Pinch: {dist, view, anchor, inert}
  const tapRef = useRef(null); // Touch: Aktion erst beim pointerup

  // Werkzeugwechsel bricht einen aktiven Entwurf ab — sonst zeichnet der
  // Kreis-Modus mit dem alten Linien-Startpunkt weiter (und umgekehrt).
  useEffect(() => setDraft(null), [tool]);

  // ---- Transformationen ----
  const X = useCallback((wx) => VB_W / 2 + (wx - view.cx) * view.scale, [view]);
  const Y = useCallback((wy) => VB_H / 2 - (wy - view.cy) * view.scale, [view]);

  /** Client-Pixel → View-Koordinaten (berücksichtigt viewBox, Muster BimPlan2D). */
  const clientToView = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }, []);

  const viewToWorld = useCallback(
    (v) => ({ x: view.cx + (v.x - VB_W / 2) / view.scale, y: view.cy - (v.y - VB_H / 2) / view.scale }),
    [view]
  );
  const toWorld = useCallback((clientX, clientY) => viewToWorld(clientToView(clientX, clientY)), [clientToView, viewToWorld]);

  const snap = (v) => Math.round(v / SNAP_M) * SNAP_M;

  /** nächster bestehender Punkt im Fangradius, sonst null */
  const snapPoint = useCallback(
    (w, pointerType) => {
      let best = null;
      let bestD = snapRadius(pointerType) / view.scale;
      for (const p of sketch.points.values()) {
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    },
    [sketch, view.scale]
  );

  /** Trefferprüfung Linien/Kreise */
  const hitLine = useCallback(
    (w, pointerType) => {
      const tolM = hitRadius(pointerType) / view.scale;
      for (const l of sketch.lines.values()) {
        const a = sketch.points.get(l.p1);
        const b = sketch.points.get(l.p2);
        if (distPointSegment(w, a, b) < tolM) return l;
      }
      for (const c of sketch.circles.values()) {
        const z = sketch.points.get(c.center);
        if (Math.abs(Math.hypot(w.x - z.x, w.y - z.y) - c.radius) < tolM) return c;
      }
      return null;
    },
    [sketch, view.scale]
  );

  // ---- Primäraktion (Maus/Stift: pointerdown · Touch: pointerup als Tap) ----
  const primaryAction = (w, { pointerType, shiftKey }) => {
    // Touch hat kein Shift: Taps auf Geometrie togglen additiv, leere Fläche leert
    const additive = shiftKey || pointerType === "touch";

    if (tool === "select") {
      const hit = snapPoint(w, pointerType);
      if (hit) {
        onSelect(hit.id, additive);
        return;
      }
      const seg = hitLine(w, pointerType);
      if (seg) onSelect(seg.id, additive);
      else if (!shiftKey) onClearSelection();
      return;
    }

    if (tool === "point") {
      onAddPoint(snap(w.x), snap(w.y));
      return;
    }

    if (tool === "line") {
      const hit = snapPoint(w, pointerType);
      const end = hit ? { pointId: hit.id } : { x: snap(w.x), y: snap(w.y) };
      const start = draft && resolveStart(draft.start, sketch);
      if (!start) {
        // kein Draft ODER Draft-Startpunkt wurde gelöscht → neu ansetzen
        setDraft({ start: end, x: w.x, y: w.y });
      } else {
        const auto = axisAuto(start, end);
        const startId = onAddSegment(draft.start, end, auto);
        setDraft({ start: { pointId: startId }, x: w.x, y: w.y }); // Linienzug fortsetzen
      }
      return;
    }

    if (tool === "circle") {
      const start = draft && resolveStart(draft.start, sketch);
      if (!start) {
        const hit = snapPoint(w, pointerType);
        setDraft({ start: hit ? { pointId: hit.id } : { x: snap(w.x), y: snap(w.y) }, x: w.x, y: w.y });
      } else {
        const r = Math.max(SNAP_M, snap(Math.hypot(w.x - start.x, w.y - start.y)));
        onAddCircle(draft.start, r);
        setDraft(null);
      }
    }
  };

  // ---- Pointer-Handling ----
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Zweiter Finger → Pinch-Geste: laufende Einzel-Finger-Aktionen abbrechen
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        view: { ...view },
        anchor: toWorld(mid.x, mid.y),
      };
      if (dragRef.current) {
        dragRef.current = null;
        onDragEnd();
      }
      tapRef.current = null;
      return;
    }
    if (pointersRef.current.size > 2 || gestureRef.current) return;

    const w = toWorld(e.clientX, e.clientY);

    if (e.button === 1) {
      e.preventDefault();
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    if (e.pointerType === "touch") {
      // Ziehen eines Punkts startet sofort (fühlt sich direkt an); alles
      // andere erst beim pointerup — ein zweiter Finger storniert es.
      if (tool === "select") {
        const hit = snapPoint(w, "touch");
        if (hit) {
          onSelect(hit.id, true);
          dragRef.current = { pointId: hit.id, moved: false };
          return;
        }
      }
      tapRef.current = { downX: e.clientX, downY: e.clientY, x: e.clientX, y: e.clientY, pointerType: "touch" };
      return;
    }

    // Maus/Stift: direkte Aktion beim Down (präzise Geräte)
    if (tool === "select") {
      const hit = snapPoint(w, e.pointerType);
      if (hit) {
        onSelect(hit.id, e.shiftKey);
        dragRef.current = { pointId: hit.id, moved: false };
        return;
      }
    }
    primaryAction(w, e);
  };

  const onPointerMove = (e) => {
    const tracked = pointersRef.current.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
    }

    // Pinch: Zoom um den Anker + Pan mit der Fingermitte
    if (gestureRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const g = gestureRef.current;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const scale = Math.max(8, Math.min(400, g.view.scale * (dist / g.dist)));
      const mid = clientToView((a.x + b.x) / 2, (a.y + b.y) / 2);
      // Anker-Weltpunkt bleibt unter der Fingermitte
      setView({
        scale,
        cx: g.anchor.x - (mid.x - VB_W / 2) / scale,
        cy: g.anchor.y + (mid.y - VB_H / 2) / scale,
      });
      return;
    }

    if (panRef.current) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      panRef.current = { x: e.clientX, y: e.clientY };
      const svg = svgRef.current;
      const k = VB_W / svg.getBoundingClientRect().width / view.scale;
      setView((v) => ({ ...v, cx: v.cx - dx * k, cy: v.cy + dy * k }));
      return;
    }

    if (dragRef.current) {
      dragRef.current.moved = true;
      // Immer die NEUESTE Position merken — der rAF-Callback liest die Ref,
      // damit das letzte Move vor dem Loslassen nie verworfen wird.
      dragPosRef.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (dragRef.current && dragPosRef.current) {
            const w = toWorld(dragPosRef.current.x, dragPosRef.current.y);
            onDragPoint(dragRef.current.pointId, snap(w.x), snap(w.y));
          }
        });
      }
      return;
    }

    if (tapRef.current) {
      tapRef.current.x = e.clientX;
      tapRef.current.y = e.clientY;
      return;
    }

    const w = toWorld(e.clientX, e.clientY);
    if (draft) setDraft((d) => ({ ...d, x: w.x, y: w.y }));
    if (e.pointerType !== "touch") setHoverPt(snapPoint(w, e.pointerType)?.id ?? null);
  };

  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);

    if (gestureRef.current) {
      // Geste endet, sobald weniger als 2 Finger; letzter Finger bleibt inert
      if (pointersRef.current.size < 2) gestureRef.current = pointersRef.current.size === 0 ? null : { ...gestureRef.current, inert: true };
      if (gestureRef.current?.inert && pointersRef.current.size === 0) gestureRef.current = null;
      return;
    }

    panRef.current = null;

    if (dragRef.current) {
      const wasDrag = dragRef.current.moved;
      const pointId = dragRef.current.pointId;
      dragRef.current = null;
      if (wasDrag) {
        // letzte Position noch anwenden (ein evtl. ausstehender rAF-Frame entfällt)
        if (dragPosRef.current) {
          const w = toWorld(dragPosRef.current.x, dragPosRef.current.y);
          onDragPoint(pointId, snap(w.x), snap(w.y));
        }
        onDragEnd();
      }
      dragPosRef.current = null;
      return;
    }

    if (tapRef.current) {
      const t = tapRef.current;
      tapRef.current = null;
      const moved = Math.hypot(t.x - t.downX, t.y - t.downY);
      // Zeichnen-Werkzeuge platzieren am Loslass-Punkt (Ziehen zum Zielen ok);
      // Auswahl-Taps nur, wenn der Finger ruhig blieb.
      if (tool === "select" && moved > TAP_TOL_PX) return;
      primaryAction(toWorld(t.x, t.y), { pointerType: t.pointerType, shiftKey: false });
    }
  };

  const onPointerCancel = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) gestureRef.current = null;
    tapRef.current = null;
    panRef.current = null;
    if (dragRef.current) {
      dragRef.current = null;
      onDragEnd();
    }
  };

  // Wheel-Zoom als NATIVER Listener (passive:false): React-onWheel ist passiv,
  // preventDefault ginge verloren und die Seite scrollt beim Zoomen mit.
  // Anker-Mathe komplett im setView-Callback mit frischem v — kein Drift bei
  // schnellen Wheel-Bursts durch veraltetes view in der Closure.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const vpt = clientToView(e.clientX, e.clientY);
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const w = { x: v.cx + (vpt.x - VB_W / 2) / v.scale, y: v.cy - (vpt.y - VB_H / 2) / v.scale };
        const scale = Math.max(8, Math.min(400, v.scale * f));
        const k = 1 - v.scale / scale;
        return { scale, cx: v.cx + (w.x - v.cx) * k, cy: v.cy + (w.y - v.cy) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [clientToView]);

  const onDoubleClick = () => setDraft(null); // Linienzug beenden (auch Doppeltipp)
  const onContextMenu = (e) => {
    e.preventDefault(); // unterdrückt auch das Long-Press-Menü auf Android
    setDraft(null);
  };

  // ---- Darstellung ----
  const gitter = [];
  {
    const x0 = Math.floor(view.cx - VB_W / 2 / view.scale);
    const x1 = Math.ceil(view.cx + VB_W / 2 / view.scale);
    const y0 = Math.floor(view.cy - VB_H / 2 / view.scale);
    const y1 = Math.ceil(view.cy + VB_H / 2 / view.scale);
    if (view.scale > 14) {
      for (let x = x0; x <= x1; x++)
        gitter.push(<line key={`gx${x}`} x1={X(x)} y1={0} x2={X(x)} y2={VB_H} stroke={x === 0 ? "#cbd5e1" : "#f1f5f9"} strokeWidth={x === 0 ? 1.5 : 1} />);
      for (let y = y0; y <= y1; y++)
        gitter.push(<line key={`gy${y}`} x1={0} y1={Y(y)} x2={VB_W} y2={Y(y)} stroke={y === 0 ? "#cbd5e1" : "#f1f5f9"} strokeWidth={y === 0 ? 1.5 : 1} />);
    }
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="w-full h-full bg-white rounded-lg border border-slate-200 touch-none select-none"
      style={{ cursor: tool === "select" ? (hoverPt ? "pointer" : "default") : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {gitter}

      {/* Geometrie + Punkte + Glyphen — gemeinsames Rendering (SketchGeometry) */}
      <SketchGeometry
        sketch={sketch}
        X={X}
        Y={Y}
        scale={view.scale}
        selection={selection}
        lastSolve={lastSolve}
        hoverPt={hoverPt}
        onSelect={onSelect}
      />

      {/* Entwurf (Gummiband) */}
      {draft && tool === "line" && (() => {
        const s = resolveStart(draft.start, sketch);
        if (!s) return null; // Draft-Startpunkt wurde gelöscht — nicht crashen
        return <line x1={X(s.x)} y1={Y(s.y)} x2={X(draft.x)} y2={Y(draft.y)} stroke={FARBEN.entwurf} strokeWidth={2} strokeDasharray="4 4" />;
      })()}
      {draft && tool === "circle" && (() => {
        const s = resolveStart(draft.start, sketch);
        if (!s) return null;
        return (
          <circle cx={X(s.x)} cy={Y(s.y)} r={Math.hypot(draft.x - s.x, draft.y - s.y) * view.scale}
            fill="none" stroke={FARBEN.entwurf} strokeWidth={2} strokeDasharray="4 4" />
        );
      })()}

    </svg>
  );
}

/** Startpunkt eines Entwurfs LIVE auflösen (nach Solve können Koordinaten wandern). */
function resolveStart(start, sketch) {
  return start.pointId ? sketch.points.get(start.pointId) : start;
}

/** Auto-Constraint horizontal/vertikal, wenn das Segment fast achsparallel ist. */
function axisAuto(a, end) {
  const b = end.pointId ? null : end;
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return null;
  const winkel = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (winkel < AXIS_SNAP_DEG) return "horizontal";
  if (winkel > 90 - AXIS_SNAP_DEG) return "vertical";
  return null;
}

function distPointSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

// glyphPos/massText leben jetzt in SketchGeometry.jsx (gemeinsames Rendering).
