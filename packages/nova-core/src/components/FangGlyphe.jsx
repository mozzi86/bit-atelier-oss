// FangGlyphe — the snap marker of the drawing surfaces (phase 104-05). One glyph per snap kind, CAD convention:
// endpoint = square, midpoint = triangle, intersection = X, perpendicular = ⊥, nearest = hourglass; polar / ortho
// = a dashed tracking ray from the base point with its angle. Grid and free points show no glyph.
//
// In:  position in SVG user units of the host plan, the size of one screen pixel in those units, the snap kind,
//      optionally the ray (both ends in SVG units). Out: an SVG <g> (pointer-events off), colour from the design
//      token "erfolg" (snap) / "hinweis" (tracking ray).
import React from "react";

/**
 * @param {{x: number, y: number, s: number, art: string, strahl?: {x1: number, y1: number, x2: number, y2: number, winkel_grad: number}|null,
 *   testid?: string, eckeTestid?: string|null}} props
 *   x, y: snapped point (SVG units); s: SVG units per screen pixel (glyph sizes are given in screen pixels);
 *   art: snap kind (objektfang.js); eckeTestid: extra test id of the endpoint square (98-02: "mm-fang-ecke")
 */
export default function FangGlyphe({ x, y, s, art, strahl = null, testid = "fang", eckeTestid = null }) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(s > 0)) return null;
  const r = 6 * s;
  const linie = { fill: "none", strokeWidth: 2 * s, className: "stroke-erfolg" };
  /** @type {React.ReactNode} */
  let glyphe = null;
  if (art === "endpunkt") glyphe = <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...linie} data-testid={eckeTestid || undefined} />;
  else if (art === "mitte") glyphe = <path d={`M${x},${y - r} L${x + r},${y + r * 0.8} L${x - r},${y + r * 0.8} Z`} {...linie} />;
  else if (art === "schnitt") glyphe = <path d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} {...linie} />;
  else if (art === "lot") glyphe = <path d={`M${x - r},${y + r} L${x + r},${y + r} M${x},${y + r} L${x},${y - r} M${x - r},${y + r - 0.6 * r} L${x - 0.4 * r},${y + r - 0.6 * r} L${x - 0.4 * r},${y + r}`} {...linie} />;
  else if (art === "naechster") glyphe = <path d={`M${x - r},${y - r} L${x + r},${y - r} L${x - r},${y + r} L${x + r},${y + r} Z`} {...linie} />;
  else if ((art === "polar" || art === "ortho") && strahl) {
    glyphe = (
      <>
        <line x1={strahl.x1} y1={strahl.y1} x2={strahl.x2} y2={strahl.y2} className="stroke-hinweis" strokeWidth={1 * s} strokeDasharray={`${5 * s} ${4 * s}`} />
        <path d={`M${x - r * 0.7},${y} L${x + r * 0.7},${y} M${x},${y - r * 0.7} L${x},${y + r * 0.7}`} className="stroke-hinweis" strokeWidth={1.5 * s} />
        <text x={x + 9 * s} y={y - 9 * s} fontSize={10 * s} className="fill-hinweis">{`${art === "ortho" ? "⊾ " : ""}${Math.round(strahl.winkel_grad * 10) / 10}°`}</text>
      </>
    );
  }
  if (!glyphe) return null;
  return <g data-testid={testid} data-art={art} style={{ pointerEvents: "none" }}>{glyphe}</g>;
}

/**
 * Ray ends for the glyph: from the base point through the snapped point and a bit beyond (SVG units).
 * @param {{x: number, y: number}} von base point (SVG units)
 * @param {{x: number, y: number}} bis snapped point (SVG units)
 * @param {number} ueber extension beyond the point (SVG units)
 * @param {number} winkel_grad drafting angle of the ray
 * @returns {{x1: number, y1: number, x2: number, y2: number, winkel_grad: number}}
 */
export function strahlEnden(von, bis, ueber, winkel_grad) {
  const d = Math.hypot(bis.x - von.x, bis.y - von.y) || 1;
  return { x1: von.x, y1: von.y, x2: bis.x + ((bis.x - von.x) / d) * ueber, y2: bis.y + ((bis.y - von.y) / d) * ueber, winkel_grad };
}
