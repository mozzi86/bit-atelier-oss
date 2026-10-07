// Gemeinsamer SVG-Drag-Hook (Phase 34, PW-02b) — nach dem reifsten Muster im
// Repo (SketchCanvas): reine Pointer-Events mit setPointerCapture, typisierte
// Drag-Payloads, rAF-Drosselung (das letzte Move geht NIE verloren),
// pointercancel-Cleanup und Tap-Erkennung über eine Pixel-Toleranz.
//
// Der Hook ist bewusst koordinaten-agnostisch: er liefert rohe Pointer-Events
// plus Client-Pixel-Deltas — die Umrechnung nach Metern/viewBox-Einheiten
// macht der Aufrufer (sie hängt von dessen Transformationsmodell ab).
//
// Verwendung:
//   const { startDrag } = useSvgDrag({ onDrag, onDragEnd, onTap });
//   <circle onPointerDown={(e) => startDrag(e, { kind: "vert", idx })} />
//
//   onDrag(payload, event, { dx, dy, moved })  — rAF-gedrosselt während des Ziehens
//   onDragEnd(payload, event, { cancelled })   — nach echtem Drag (moved) oder pointercancel
//   onTap(payload, event)                      — Loslassen ohne Bewegung > tapTolPx

import { useEffect, useRef } from "react";

/**
 * @typedef {object} SvgDragOptions
 * @property {(payload: any, event: PointerEvent, info: {dx: number, dy: number, moved: boolean}) => void} [onDrag]
 *   rAF-throttled while dragging; dx/dy in client pixels since pointerdown
 * @property {(payload: any, event: PointerEvent, info: {cancelled: boolean}) => void} [onDragEnd]
 *   after a real drag (moved) or pointercancel
 * @property {(payload: any, event: PointerEvent) => void} [onTap] release without movement > tapTolPx
 * @property {number} [tapTolPx] tap tolerance in client pixels (default 10)
 */

/**
 * Shared SVG drag hook (Phase 34, PW-02b) — see the file header for the contract.
 * @param {SvgDragOptions} [options]
 * @returns {{ startDrag: (e: any, payload: any) => void, cancelDrag: () => void, isDragging: () => boolean }}
 */
export function useSvgDrag({ onDrag, onDragEnd, onTap, tapTolPx = 10 } = {}) {
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const lastEvtRef = useRef(null);
  // Callbacks über Ref — startDrag bindet Listener einmal je Drag, die
  // Handler sollen trotzdem immer den frischesten Render-Stand sehen.
  const cbRef = useRef(null);
  cbRef.current = { onDrag, onDragEnd, onTap, tapTolPx };

  const flush = () => {
    rafRef.current = 0;
    const d = dragRef.current;
    const e = lastEvtRef.current;
    if (!d || !e) return;
    cbRef.current.onDrag?.(d.payload, e, {
      dx: e.clientX - d.sx,
      dy: e.clientY - d.sy,
      moved: d.moved,
    });
  };

  const startDrag = (e, payload) => {
    if (dragRef.current) return; // nie zwei Drags parallel (Multi-Touch: erster gewinnt)
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      /* Capture optional — Maus funktioniert auch ohne */
    }
    const d = { payload, sx: e.clientX, sy: e.clientY, moved: false, pointerId: e.pointerId };
    dragRef.current = d;

    const move = (ev) => {
      if (dragRef.current !== d || ev.pointerId !== d.pointerId) return;
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > cbRef.current.tapTolPx) d.moved = true;
      lastEvtRef.current = ev;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    };
    const end = (ev) => {
      if (dragRef.current !== d || ev.pointerId !== d.pointerId) return;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        flush(); // letztes Move vor dem Ende noch anwenden
      }
      dragRef.current = null;
      lastEvtRef.current = null;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      try {
        target.releasePointerCapture?.(ev.pointerId);
      } catch {
        /* schon freigegeben */
      }
      if (ev.type !== "pointercancel" && !d.moved) cbRef.current.onTap?.(d.payload, ev);
      else cbRef.current.onDragEnd?.(d.payload, ev, { cancelled: ev.type === "pointercancel" });
    };
    // Dank Pointer-Capture kommen move/up/cancel am Ziel an — keine window-Listener nötig.
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    // 75-01: programmatic cancel (Esc during a drag). Behaves like pointercancel —
    // listeners removed, capture released, onDragEnd({cancelled:true}) once.
    d.cancel = () => {
      if (dragRef.current !== d) return;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      dragRef.current = null;
      const last = lastEvtRef.current;
      lastEvtRef.current = null;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      try {
        target.releasePointerCapture?.(d.pointerId);
      } catch {
        /* schon freigegeben */
      }
      cbRef.current.onDragEnd?.(d.payload, last, { cancelled: true });
    };
  };

  /** Cancels the running drag (if any) — see d.cancel above. */
  const cancelDrag = () => {
    dragRef.current?.cancel?.();
  };

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      dragRef.current = null;
    },
    []
  );

  return { startDrag, cancelDrag, isDragging: () => !!dragRef.current };
}
