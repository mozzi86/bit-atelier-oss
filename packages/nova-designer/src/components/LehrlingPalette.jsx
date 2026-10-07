// Cursor-following context palette (Phase 75-04, MS-04) - "der Lehrling":
// a small card that trails the pointer by ~120 ms, keeps 28 px away, never
// covers the polygon under edit and never leaves the container. Appears
// 150 ms after a handle is hovered/dragged, disappears 300 ms after leaving.
//
// In:  anker (pointer, px in container), meide (bbox to avoid, px), viewport
//      (container size, px), zeilen (<= 4 entries: { text } or { knopf, onClick }),
//      sichtbar (bool).
// Out: absolutely positioned <div role="status"> inside a `relative` parent.
// No pointer events except on its buttons. [ASSUMED] timings from Blatt 04.

import React, { useEffect, useRef, useState } from "react";
import { palettePosition, lerp } from "@core/lib/palettePosition";

/** Max palette size in px [ASSUMED] Blatt 04. */
export const PALETTE_MAX = { w: 220, h: 120 };
const EIN_MS = 150, AUS_MS = 300, LERP_T = 0.18;

/**
 * @param {{
 *   anker: {x:number,y:number}|null,
 *   meide: {x0:number,y0:number,x1:number,y1:number}|null,
 *   viewport: {w:number,h:number},
 *   zeilen: Array<{text?: string, knopf?: string, onClick?: () => void, ariaLabel?: string, ton?: string}>,
 *   sichtbar: boolean,
 * }} props
 */
export default function LehrlingPalette({ anker, meide, viewport, zeilen = [], sichtbar }) {
  const [offen, setOffen] = useState(false);
  const [pos, setPos] = useState(null);
  const zielRef = useRef(null);
  const posRef = useRef(null);
  const rafRef = useRef(0);
  const reduziert = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  // Show after 150 ms, hide after 300 ms; timers are cleared on every change.
  useEffect(() => {
    const t = setTimeout(() => setOffen(!!sichtbar), sichtbar ? EIN_MS : AUS_MS);
    return () => clearTimeout(t);
  }, [sichtbar]);

  // Target position from the pure placement rule; follow with inertia per frame.
  useEffect(() => {
    if (!anker || !viewport) return undefined;
    const ziel = palettePosition(anker, PALETTE_MAX, meide, viewport);
    zielRef.current = ziel;
    if (reduziert || !posRef.current) {
      posRef.current = { x: ziel.x, y: ziel.y };
      setPos({ ...posRef.current, ecke: ziel.ecke });
      return undefined;
    }
    const step = () => {
      const z = zielRef.current, p = posRef.current;
      if (!z || !p) return;
      const nx = lerp(p.x, z.x, LERP_T), ny = lerp(p.y, z.y, LERP_T);
      posRef.current = { x: nx, y: ny };
      setPos({ x: nx, y: ny, ecke: z.ecke });
      if (Math.abs(nx - z.x) > 0.5 || Math.abs(ny - z.y) > 0.5) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = 0;
    };
    if (!rafRef.current) rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [anker, meide, viewport, reduziert]);

  if (!offen || !pos) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-lehrling-palette
      data-ecke={pos.ecke}
      className="absolute z-20 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-md"
      style={{ left: pos.x, top: pos.y, maxWidth: PALETTE_MAX.w, maxHeight: PALETTE_MAX.h, pointerEvents: "none" }}
    >
      {zeilen.slice(0, 4).map((z, i) =>
        z.knopf ? (
          <button
            key={i}
            type="button"
            onClick={z.onClick}
            aria-label={z.ariaLabel || z.knopf}
            className="mt-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[12px] hover:bg-slate-50"
            style={{ pointerEvents: "auto" }}
          >
            {z.knopf}
          </button>
        ) : (
          <div key={i} className={`font-mono tabular-nums ${z.ton === "gold" ? "text-amber-700" : z.ton === "muted" ? "text-slate-400" : ""}`}>{z.text}</div>
        )
      )}
    </div>
  );
}
