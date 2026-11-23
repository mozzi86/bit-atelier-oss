// 115-12 (D-115-47): the selected room in the apartment planner's storey plan — outline, eight handles (edges and
// corners), snap lines, live size text and the "rule" ghost of a hand-edited room. Pure display plus pointer / key
// hand-over: every drag runs through the host's shared drag hook (useSvgDrag) and the pure geometry module
// (@designer/lib/raumBearbeiten); this layer never computes or writes a room.
//
// Look (115-DESIGN: flat, calm, accent = black): plan ink for the outline, white square handles with an ink edge, a
// 6 % ink tint as the only fill. The plan sheet stays light in dark mode (BimPlan2D paints it), so the plan colours
// are fixed sheet colours here — design tokens would turn white on the white sheet.
//
// In:  the room corners in plan metres (rule, hand or live preview), the plan transformers X / Z / px of the
//      BimPlan2D overlay (LIVE values — never cached), texts, callbacks.
// Out: SVG; onKoerperDown / onGriffDown(e, seiten) on pointer down, onTaste(e) on key down (arrow keys, Esc).

import React, { useState } from "react";

/** Plan ink of the selection (same value as BimPlan2D's scale bar and north arrow). */
const PLAN_TINTE = "#0f172a";
/** Sheet white of the handles. */
const PLAN_WEISS = "#ffffff";
/** Calm grey of the rule ghost (plan auxiliary line). */
const PLAN_HILFSLINIE = "#64748b";

/** Visible handle edge, screen px [ASSUMED 8 px: readable at 1:100, not louder than the room label]. */
const GRIFF_PX = 8;
/** Pointer hit area of a handle, screen px — 115-DESIGN §4: 32 px with the mouse. */
const TREFFER_PX = 32;
/**
 * Below this short side (screen px) the hit areas move outwards, so the room body in the middle stays grabbable
 * [ASSUMED 72 px = two hit areas plus a finger of body].
 */
const KLEIN_PX = 72;

/** @typedef {{x: number, z: number}} Pkt plan metres */
/** @typedef {{a: -1|0|1, c: -1|0|1}} Seiten sides a handle moves (raumBearbeiten.js) */

/** Sides per handle: corners 0…3 of the zone, then edges 0…3 (edge i runs from corner i to corner i + 1). @type {Seiten[]} */
const GRIFF_SEITEN = [
  { a: -1, c: -1 }, { a: 1, c: -1 }, { a: 1, c: 1 }, { a: -1, c: 1 },
  { a: 0, c: -1 }, { a: 1, c: 0 }, { a: 0, c: 1 }, { a: -1, c: 0 },
];

/**
 * Resize cursor for a handle from its direction away from the room centre on screen.
 * @param {number} dx screen x (right positive) @param {number} dy screen y (down positive)
 * @returns {string} CSS cursor
 */
function griffZeiger(dx, dy) {
  if (Math.abs(dx) > 2 * Math.abs(dy)) return "ew-resize";
  if (Math.abs(dy) > 2 * Math.abs(dx)) return "ns-resize";
  return dx * dy > 0 ? "nwse-resize" : "nesw-resize";
}

/**
 * Selection layer of one room.
 * @param {object} p
 * @param {Pkt[]} p.punkte corners of the shown room in plan metres (4 for a rectangle; any polygon for a room that cannot be edited)
 * @param {(x: number) => number} p.X plan metres → viewBox x (BimPlan2D overlay)
 * @param {(z: number) => number} p.Z plan metres → viewBox y
 * @param {(n: number) => number} p.px screen px → viewBox units
 * @param {boolean} p.editierbar rectangular room: handles and body drag; false = outline only (the room follows its rule)
 * @param {Pkt[]|null} [p.regelPunkte] corners of the rule rectangle of a hand-edited room (ghost), plan metres
 * @param {Array<[Pkt, Pkt]>} [p.fangLinien] snap lines that hold an edge right now, plan metres
 * @param {string} [p.massText] live size, e.g. "3,60 × 4,20 m"
 * @param {string} p.name accessible name of the room (name, size, how to move it)
 * @param {string} [p.griffTitel] tooltip of a handle
 * @param {(e: any) => void} [p.onKoerperDown] pointer down on the room body (move)
 * @param {(e: any, seiten: Seiten) => void} [p.onGriffDown] pointer down on a handle (resize)
 * @param {(e: any) => void} [p.onTaste] key down while the room has the focus (arrow keys nudge, Esc deselects)
 * @param {{current: any}} [p.elRef] ref of the focusable room body (the host focuses it after a selection by pointer)
 */
export default function RaumGriffe({ punkte, X, Z, px, editierbar, regelPunkte = null, fangLinien = [], massText = "", name, griffTitel = "", onKoerperDown, onGriffDown, onTaste, elRef }) {
  const [fokus, setFokus] = useState(false);
  if (!Array.isArray(punkte) || punkte.length < 3) return null;
  const s = punkte.map((q) => ({ x: X(q.x), y: Z(q.z) }));
  const d = `${s.map((q, i) => `${i ? "L" : "M"}${q.x},${q.y}`).join(" ")} Z`;
  const cx = s.reduce((m, q) => m + q.x, 0) / s.length, cy = s.reduce((m, q) => m + q.y, 0) / s.length;
  const oben = Math.min(...s.map((q) => q.y));
  const e1 = px(1) || 1;
  /** @type {Array<{x: number, y: number, seiten: Seiten}>} */
  const griffe = [];
  let aus = 0;
  if (editierbar && s.length === 4) {
    s.forEach((q, i) => griffe.push({ x: q.x, y: q.y, seiten: GRIFF_SEITEN[i] }));
    s.forEach((q, i) => { const n = s[(i + 1) % 4]; griffe.push({ x: (q.x + n.x) / 2, y: (q.y + n.y) / 2, seiten: GRIFF_SEITEN[4 + i] }); });
    const kurzPx = Math.min(Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y), Math.hypot(s[3].x - s[0].x, s[3].y - s[0].y)) / e1;
    aus = px(Math.max(0, Math.min(12, (KLEIN_PX - kurzPx) / 2)));
  }
  const g = px(GRIFF_PX), tr = px(TREFFER_PX);
  const fs = px(11);
  return (
    <g data-testid="wt-raum-auswahl" data-editierbar={editierbar ? "1" : "0"}>
      {regelPunkte && regelPunkte.length >= 3 && (
        <polygon points={regelPunkte.map((q) => `${X(q.x)},${Z(q.z)}`).join(" ")} fill="none" stroke={PLAN_HILFSLINIE}
          strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" data-testid="wt-raum-regel" />
      )}
      {fangLinien.map(([a, b], i) => (
        <line key={`fang-${i}`} x1={X(a.x)} y1={Z(a.z)} x2={X(b.x)} y2={Z(b.z)} stroke={PLAN_TINTE} strokeWidth={px(1)}
          strokeDasharray={`${px(2)} ${px(3)}`} pointerEvents="none" data-testid="wt-raum-fang" />
      ))}
      {/* focus ring: a second, wider outline — visible focus without the browser's bounding-box outline */}
      {fokus && <path d={d} fill="none" stroke={PLAN_TINTE} strokeOpacity="0.3" strokeWidth={px(5)} strokeLinejoin="round" pointerEvents="none" data-testid="wt-raum-fokus" />}
      <path
        ref={elRef} d={d} tabIndex={0} role="group" aria-label={name}
        fill={PLAN_TINTE} fillOpacity="0.06" stroke={PLAN_TINTE} strokeWidth={px(1.5)} strokeLinejoin="round"
        // a room that cannot be edited lets the pointer through to the unit below (click / drag keep their unit meaning)
        style={{ cursor: editierbar ? "move" : "default", outline: "none" }} pointerEvents={editierbar ? "auto" : "none"}
        data-testid="wt-raum-koerper"
        onPointerDown={editierbar ? onKoerperDown : undefined}
        onKeyDown={onTaste} onFocus={() => setFokus(true)} onBlur={() => setFokus(false)}
      />
      {massText && (
        <text x={cx} y={oben - px(10)} fontSize={fs} fontWeight="600" textAnchor="middle" fill={PLAN_TINTE}
          stroke={PLAN_WEISS} strokeWidth={px(3)} paintOrder="stroke" pointerEvents="none" data-testid="wt-raum-mass"
          style={{ fontVariantNumeric: "tabular-nums" }}>{massText}</text>
      )}
      {griffe.map((h, i) => {
        const dx = h.x - cx, dy = h.y - cy, l = Math.hypot(dx, dy) || 1;
        // hit area: 32 px, pushed outwards for small rooms; the visible handle stays on the edge
        const tx = h.x + (dx / l) * aus, ty = h.y + (dy / l) * aus;
        return (
          <g key={`griff-${i}`}>
            <rect x={h.x - g / 2} y={h.y - g / 2} width={g} height={g} fill={PLAN_WEISS} stroke={PLAN_TINTE} strokeWidth={px(1.25)} pointerEvents="none" />
            <rect x={tx - tr / 2} y={ty - tr / 2} width={tr} height={tr} fill="transparent" style={{ cursor: griffZeiger(dx, dy) }}
              data-testid="wt-raum-griff" data-a={h.seiten.a} data-c={h.seiten.c}
              onPointerDown={(e) => onGriffDown?.(e, h.seiten)}>
              {griffTitel && <title>{griffTitel}</title>}
            </rect>
          </g>
        );
      })}
    </g>
  );
}
