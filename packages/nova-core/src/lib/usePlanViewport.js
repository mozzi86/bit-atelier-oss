// Gemeinsamer 2D-Plan-Viewport (Phase 34, PW-02a) — extrahiert aus BimPlan2D.
// Modell: dynamische viewBox `${x} ${y} ${W/zoom} ${H/zoom}` über viewT
// {zoom, x, y}; Bildschirm→SVG-Einheiten über getScreenCTM (berücksichtigt
// Zoom/Pan UND preserveAspectRatio-Letterboxing — deshalb NICHT über
// getBoundingClientRect rechnen). Die reine Zoom-Mathe ist separat exportiert
// (Node-testbar ohne DOM).
//
// MSB-16 (75-09, Befund — notiert, nicht gefixt): px() nimmt die Breite
// (screenUnits: renderedW / W). Im HÖHENBEGRENZTEN SVG (w-full + maxHeight +
// preserveAspectRatio "meet") ist eine viewBox-Einheit aber
// min(rw/W, rh/H) · zoom CSS-px — px() liefert dort zu kleine Werte. Für neue
// Aufrufer (BimPlan2D-Overlays mit festem Maßstab) gibt es pxBild() über
// bildPxJeEinheit (Letterbox-korrekt); die Umstellung der Bestandsaufrufer
// (BimPlan2D-eigene Labels 75-11, ggf. Massing) ist ein eigener Plan.

import { useEffect, useRef, useState } from "react";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Screen pixels → viewBox units (Phase 75-01, MS-01). Handles, stroke widths
 * and hit areas drawn with this stay the same size on screen at every zoom.
 * The SVG is rendered `w-full`, so one viewBox unit is `renderedW / W · zoom`
 * screen pixels; the inverse is this function.
 * Hand check: screenUnits(10, 2, 560, 700) = 10 · 560 / 700 / 2 = 4.
 * @param {number} n size in screen pixels
 * @param {number} zoom current viewT.zoom (1 = unzoomed)
 * @param {number} W viewBox width in SVG units
 * @param {number} renderedW rendered width of the <svg> in CSS px (0 → W)
 * @returns {number} size in viewBox units
 */
export function screenUnits(n, zoom, W, renderedW) {
  const rw = renderedW > 0 ? renderedW : W;
  const z = zoom > 0 ? zoom : 1;
  return (n * W) / rw / z;
}

/**
 * Screen pixels per viewBox unit, LETTERBOX-corrected (75-09, MSB-16).
 * px()/screenUnits() divide by the rendered WIDTH only — correct while the SVG
 * (w-full + maxHeight, BimPlan2D) is width-limited. When the SVG is HEIGHT-
 * limited, preserveAspectRatio ("meet") fits the content to
 * min(rw/W, rh/H), so one viewBox unit is min(rw/W, rh/H) · zoom CSS px.
 * Fallbacks (before the ResizeObserver fires): rw ≤ 0 → the result is just
 * zoom (1 px per unit, same convention as screenUnits rw → W); rh ≤ 0 →
 * width-only formula zoom · rw/W (identical to 1/screenUnits).
 * Hand checks: (1, 488.6, 360, 790, 500) = min(790/488.6; 500/360) = 1.3889 ·
 * (2, 500, 360, 1000, 0) = 2 · 1000/500 = 4 · (1, 500, 360, 0, 360) = 1.
 * @param {number} zoom current viewT.zoom (1 = unzoomed)
 * @param {number} W viewBox width, SVG units
 * @param {number} H viewBox height, SVG units
 * @param {number} renderedW rendered SVG width, CSS px (0 = not measured yet)
 * @param {number} renderedH rendered SVG height, CSS px (0 = not measured yet)
 * @returns {number} CSS px per viewBox unit
 */
export function bildPxJeEinheit(zoom, W, H, renderedW, renderedH) {
  const z = zoom > 0 ? zoom : 1;
  if (!(W > 0) || !(H > 0)) return z;
  const rw = renderedW > 0 ? renderedW : 0;
  if (rw === 0) return z;                       // nothing measured → 1 px per unit
  if (!(renderedH > 0)) return (z * rw) / W;    // width-only (identical to 1/screenUnits)
  return z * Math.min(rw / W, renderedH / H);   // letterbox ("meet") fit
}

/**
 * Inverse of bildPxJeEinheit: the zoom at which one viewBox unit equals
 * `ziel` CSS px (75-09 — used by planZoomFuerMassstab to reach a fixed
 * screen scale like 1:50). Same fallbacks as bildPxJeEinheit so the
 * round-trip holds (|Δ| < 1e-9) in every branch.
 * Hand check: zoomFuerPxJeEinheit(2.7778, 488.6, 360, 790, 500) = 2.
 * @param {number} ziel target CSS px per viewBox unit
 * @param {number} W viewBox width, SVG units
 * @param {number} H viewBox height, SVG units
 * @param {number} renderedW rendered SVG width, CSS px
 * @param {number} renderedH rendered SVG height, CSS px
 * @returns {number} zoom (unclamped — the caller clamps to min/maxZoom)
 */
export function zoomFuerPxJeEinheit(ziel, W, H, renderedW, renderedH) {
  const target = Number(ziel);
  if (!Number.isFinite(target) || target <= 0) return 1;
  if (!(W > 0) || !(H > 0)) return 1;
  if (!(renderedW > 0)) return target;          // rw-0 branch of bildPxJeEinheit: zoom = ziel
  if (!(renderedH > 0)) return (target * W) / renderedW;
  return target / Math.min(renderedW / W, renderedH / H);
}

/**
 * View state with `zentrum` (viewBox units) at the viewport centre and a
 * clamped zoom (75-09 — the scale chip recentres on the focus bbox).
 * Centre invariant: x + W/zoom/2 = zentrum.x, y + H/zoom/2 = zentrum.y.
 * @param {number} zoom requested zoom (clamped to [minZoom, maxZoom])
 * @param {{x:number, y:number}} zentrum centre point in viewBox units
 * @param {number} W viewBox width, SVG units
 * @param {number} H viewBox height, SVG units
 * @param {number} minZoom
 * @param {number} maxZoom
 * @returns {{zoom:number, x:number, y:number}}
 */
export function zoomedCentered(zoom, zentrum, W, H, minZoom, maxZoom) {
  const nz = clamp(zoom, minZoom, maxZoom);
  return {
    zoom: nz,
    x: zentrum.x - W / nz / 2,
    y: zentrum.y - H / nz / 2,
  };
}

/**
 * Zoom um einen Anker in SVG-Einheiten (Wheel-Zoom auf den Cursor).
 * Invariante: der Punkt unter dem Anker bleibt exakt unter dem Anker —
 * (loc − x′)·zoom′ = (loc − x)·zoom.
 */
export function zoomedAt(viewT, loc, factor, minZoom, maxZoom) {
  const nz = clamp(viewT.zoom * factor, minZoom, maxZoom);
  const r = viewT.zoom / nz;
  return { zoom: nz, x: loc.x - (loc.x - viewT.x) * r, y: loc.y - (loc.y - viewT.y) * r };
}

/** Zoom um die Sichtfeld-Mitte (+/−-Buttons). */
export function zoomedAroundCenter(viewT, W, H, factor, minZoom, maxZoom) {
  const cx = viewT.x + W / viewT.zoom / 2;
  const cy = viewT.y + H / viewT.zoom / 2;
  return zoomedAt(viewT, { x: cx, y: cy }, factor, minZoom, maxZoom);
}

/**
 * Sichtfeld auf eine BBox in SVG-Einheiten legen (Zoom-auf-Auswahl, BIM-C).
 * box = {x0, y0, x1, y1}, padU = Rand in SVG-Einheiten.
 */
export function zoomedToBBox(box, W, H, padU, minZoom, maxZoom) {
  const wU = Math.max(10, Math.abs(box.x1 - box.x0) + padU * 2);
  const hU = Math.max(10, Math.abs(box.y1 - box.y0) + padU * 2);
  const nz = clamp(Math.min(W / wU, H / hU), minZoom, maxZoom);
  return {
    zoom: nz,
    x: (box.x0 + box.x1) / 2 - W / nz / 2,
    y: (box.y0 + box.y1) / 2 - H / nz / 2,
  };
}

/**
 * Viewport-Hook für SVG-Pläne.
 * @param svgRef ref auf das <svg>-Element (viewBox kommt aus diesem Hook)
 * @param W/H    SVG-Einheiten-Größe des Inhalts (darf sich dynamisch ändern —
 *               BimPlan2Ds SCALE hängt an der Modell-BBox)
 * @param attachKey optional: ändert sich dieser Wert, wird der Wheel-Listener
 *               neu registriert — nötig, wenn das <svg> KONDITIONAL gerendert
 *               wird (z.B. 2D/3D-Umschalter) und damit remountet; sonst hinge
 *               der Listener am alten, entsorgten Element.
 * Rückgabe: { viewT, viewBox, clientToLocal, zoomBy, resetView, zoomToBBox,
 *             beginPan, panMove, endPan, isPanning, px, renderedW,
 *             renderedH, pxBild, zoomZentriert }   (75-09: die letzten drei additiv)
 * px(n) (75-01): n Bildschirm-Pixel → viewBox-Einheiten bei aktuellem Zoom
 * und gerenderter Breite (siehe screenUnits).
 * pxBild(n) (75-09): dasselbe LETTERBOX-korrekt (n Bildschirm-Pixel →
 * viewBox-Einheiten über min(rw/W, rh/H)) — für höhenbegrenzte SVGs (MSB-16).
 * zoomZentriert(zoom, zentrum) (75-09): setzt die Sicht auf einen Zoom (geklemt)
 * mit `zentrum` (viewBox-Einheiten) in der Mitte — für den festen Maßstab.
 * Pan-Vertrag (Mitteltaste): down → beginPan(e); move → if (panMove(e)) return;
 * up/leave → endPan().
 */
export function usePlanViewport({ svgRef, W, H, minZoom = 0.3, maxZoom = 12, wheelFactor = 1.15, attachKey }) {
  const [viewT, setViewT] = useState({ zoom: 1, x: 0, y: 0 });
  // Rendered <svg> width in CSS px (75-01): needed to express handle sizes in
  // screen pixels — the SVG is `w-full`, so W ≠ rendered width.
  const [renderedW, setRenderedW] = useState(0);
  // Rendered <svg> HEIGHT in CSS px (75-09, MSB-16): the letterbox-correct
  // screen scale needs BOTH axes — a height-limited SVG (w-full + maxHeight)
  // fits its content by min(rw/W, rh/H), not rw/W alone.
  const [renderedH, setRenderedH] = useState(0);
  const panRef = useRef(null);
  // Aktuelle Maße/Grenzen über Ref, damit der einmalig registrierte
  // Wheel-Listener und die Setter nie mit veralteten Werten rechnen.
  const dims = useRef(null);
  dims.current = { W, H, minZoom, maxZoom, wheelFactor };

  // Bildschirm-Pixel → SVG-Einheiten (roh; Meter-Umrechnung macht der Aufrufer).
  const clientToLocal = (e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(ctm.inverse());
  };
  const clientToLocalRef = useRef(clientToLocal);
  clientToLocalRef.current = clientToLocal;

  // Mausrad-Zoom auf den Cursor — nativer Listener (passive:false), sonst
  // scrollt die Seite mit (Muster aus BimPlan2D beibehalten).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const d = dims.current;
      const loc = clientToLocalRef.current(e);
      if (!loc) return;
      const f = e.deltaY < 0 ? d.wheelFactor : 1 / d.wheelFactor;
      setViewT((v) => zoomedAt(v, loc, f, d.minZoom, d.maxZoom));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    // Track the rendered width (75-01) and height (75-09). Same attachKey
    // lifetime as the wheel listener — after a remount the observer must
    // follow the new element.
    const rect0 = svg.getBoundingClientRect();
    setRenderedW(rect0.width || 0);
    setRenderedH(rect0.height || 0);
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        const cr = entries[0]?.contentRect;
        if (cr?.width > 0) setRenderedW(cr.width);
        if (cr?.height > 0) setRenderedH(cr.height);
      });
      ro.observe(svg);
    }
    return () => {
      svg.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
    // svgRef ist ein stabiler Ref-Container; Registrierung einmal je Mount —
    // bzw. erneut, wenn attachKey das Remount des <svg> signalisiert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachKey]);

  const zoomBy = (f) =>
    setViewT((v) => {
      const d = dims.current;
      return zoomedAroundCenter(v, d.W, d.H, f, d.minZoom, d.maxZoom);
    });
  const resetView = () => setViewT({ zoom: 1, x: 0, y: 0 });
  const zoomToBBox = (box, padU = 30) =>
    setViewT(() => {
      const d = dims.current;
      return zoomedToBBox(box, d.W, d.H, padU, d.minZoom, d.maxZoom);
    });

  const beginPan = (e) => {
    panRef.current = { x: e.clientX, y: e.clientY };
  };
  const panMove = (e) => {
    if (!panRef.current) return false;
    const svg = svgRef.current;
    if (!svg) return true;
    const rect = svg.getBoundingClientRect();
    const d = dims.current;
    // Deltas VOR dem setState festhalten — panRef wird gleich überschrieben.
    const dx = e.clientX - panRef.current.x;
    const dy = e.clientY - panRef.current.y;
    setViewT((v) => ({
      ...v,
      x: v.x - (dx * (d.W / v.zoom)) / (rect.width || 1),
      y: v.y - (dy * (d.H / v.zoom)) / (rect.height || 1),
    }));
    panRef.current = { x: e.clientX, y: e.clientY };
    return true;
  };
  const endPan = () => {
    const was = !!panRef.current;
    panRef.current = null;
    return was;
  };
  const isPanning = () => !!panRef.current;

  return {
    viewT,
    viewBox: `${viewT.x} ${viewT.y} ${W / viewT.zoom} ${H / viewT.zoom}`,
    clientToLocal,
    zoomBy,
    resetView,
    zoomToBBox,
    beginPan,
    panMove,
    endPan,
    isPanning,
    // 75-01: screen-pixel sizes for handles/strokes/hit areas.
    px: (n) => screenUnits(n, viewT.zoom, W, renderedW),
    renderedW,
    // 75-09 (MSB-16): rendered SVG height in CSS px (0 until measured) +
    // letterbox-correct screen-pixel → viewBox conversion + centred zoom set.
    renderedH,
    pxBild: (n) => {
      const s = bildPxJeEinheit(viewT.zoom, W, H, renderedW, renderedH);
      return s > 0 ? n / s : screenUnits(n, viewT.zoom, W, renderedW);
    },
    zoomZentriert: (zoom, zentrum) =>
      setViewT(() => {
        const d = dims.current;
        return zoomedCentered(zoom, zentrum, d.W, d.H, d.minZoom, d.maxZoom);
      }),
  };
}
