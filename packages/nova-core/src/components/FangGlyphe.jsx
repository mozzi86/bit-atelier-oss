// FangGlyphe — the snap marker of the drawing surfaces (phase 104-05). One glyph per snap kind, CAD convention:
// endpoint = square, midpoint = triangle, intersection = X, perpendicular = ⊥, nearest = hourglass; polar / ortho
// = a dashed tracking ray from the base point with its angle. Grid and free points show no glyph.
//
// In:  position in SVG user units of the host plan, the size of one screen pixel in those units, the snap kind,
//      optionally the ray (both ends in SVG units). Out: an SVG <g> (pointer-events off), colour from the design
//      token "erfolg" (snap) / "hinweis" (tracking ray).
// 107-07: the tracking ray takes the colour of its axis (strahlAchse: 0°/180° token "fehler" = x, 90°/270° token "erfolg"
// = y, other angles "hinweis") and never colour alone — the axis letter in the label and a dash pattern of its own per
// axis (skill bit-farbsehen). New glyphs: parallel / perpendicular track (∥ / ⊥ in the ray label), extension (ray from
// the edge end, → in the label), point on a guide line (diamond).
import React from "react";
import { strahlAchse } from "../lib/objektfang.js";

/** Token classes per axis token — written out in full so the CSS build keeps them (no composed class names). */
const ACHS_KLASSEN = Object.freeze({
  fehler: { strich: "stroke-fehler", text: "fill-fehler" },
  erfolg: { strich: "stroke-erfolg", text: "fill-erfolg" },
  hinweis: { strich: "stroke-hinweis", text: "fill-hinweis" },
});

/** Dash pattern per axis in screen px: x long dashes, y short dots, other angles the 104-05 pattern [ASSUMED]. */
const ACHS_STRICH = Object.freeze({ x: [9, 3], y: [2, 3], frei: [5, 4] });

/** Symbol in front of the angle label per kind (symbols, no words, so nothing to translate). */
const SPUR_ZEICHEN = Object.freeze({ ortho: "⊾ ", parallel: "∥ ", senkrecht: "⊥ ", verlaengerung: "→ ", polar: "" });

/** Snap kinds drawn as a tracking ray. */
const STRAHL_ARTEN = Object.freeze(["polar", "ortho", "parallel", "senkrecht", "verlaengerung"]);

/**
 * 107-07: token, dash and label of a tracking ray from its angle (pure, so the axis rule is testable).
 * @param {number} winkel_grad drafting angle, degrees
 * @param {string} art snap kind (polar, ortho, parallel, senkrecht, verlaengerung)
 * @returns {{achse: 'x'|'y'|null, token: 'fehler'|'erfolg'|'hinweis', strich: ReadonlyArray<number>, text: string}}
 *   strich in screen px; text e.g. "X 0°", "∥ Y 90°", "37,5°"
 */
export function strahlDarstellung(winkel_grad, art) {
  const a = strahlAchse(winkel_grad);
  const grad = Math.round(winkel_grad * 10) / 10;
  const zeichen = /** @type {Record<string, string>} */ (SPUR_ZEICHEN)[art] || "";
  const achse = a.achse ? `${a.achse.toUpperCase()} ` : "";
  return { achse: a.achse, token: a.token, strich: ACHS_STRICH[a.achse || "frei"], text: `${zeichen}${achse}${String(grad).replace(".", ",")}°` };
}

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
  else if (art === "hilfsgerade") glyphe = <path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} {...linie} />;
  else if (STRAHL_ARTEN.includes(art) && strahl) {
    const d = strahlDarstellung(strahl.winkel_grad, art);
    const k = ACHS_KLASSEN[d.token];
    glyphe = (
      <>
        <line x1={strahl.x1} y1={strahl.y1} x2={strahl.x2} y2={strahl.y2} className={k.strich} strokeWidth={1.2 * s} strokeDasharray={d.strich.map((v) => v * s).join(" ")}
          data-testid={`${testid}-strahl`} data-achse={d.achse || ""} data-token={d.token} />
        <path d={`M${x - r * 0.7},${y} L${x + r * 0.7},${y} M${x},${y - r * 0.7} L${x},${y + r * 0.7}`} className={k.strich} strokeWidth={1.5 * s} />
        <text x={x + 9 * s} y={y - 9 * s} fontSize={10 * s} className={k.text} data-testid={`${testid}-text`}>{d.text}</text>
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
