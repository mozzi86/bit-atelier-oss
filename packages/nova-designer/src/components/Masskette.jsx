// <Masskette> — ONE SVG dimension chain for the focus plan (1:50) and the
// massing studio (1:200/1:500), Phase 75-15 (MS-09, MSB-23).
//
// Draws what lib/masskette.js computes: continuous dimension line, extension
// lines from every measured point, 45° slashes, numbers centred above and
// parallel to the line (never upside down), optional overall dimension as a
// second chain outside. Sizes are screen pixels (px() of the host plan), so the
// chain looks the same at every zoom; numbers carry no unit — the host writes
// "Maße in m" once next to the scale chip.
//
// In:  measured points (m), offset (m), side, the host plan's live X/Z/px/SCALE.
// Out: a <g> of SVG lines and texts; pointer-transparent.

import React from "react";
import { kettenPaar, formatMeter } from "@designer/lib/masskette";

/**
 * @param {object} p
 * @param {Array<{x:number,z:number}>} p.punkte measured points in metres (model x/z)
 * @param {(x:number)=>number} p.X model x (m) → viewBox x
 * @param {(z:number)=>number} p.Z model z (m) → viewBox y
 * @param {(n:number)=>number} p.px screen px → viewBox units (letterbox-correct)
 * @param {number} p.SCALE viewBox units per metre
 * @param {number} [p.offsetM=0.5] distance of the dimension line from the measured edge (m)
 * @param {1|-1} [p.seite=1] side of the chain (see seiteVon in lib/masskette)
 * @param {boolean} [p.gesamt=true] add the overall dimension as a second chain outside
 * @param {(m:number)=>string} [p.format=formatMeter] number format (default: m, 2 decimals, comma, no unit)
 * @param {string} [p.farbe="#334155"] stroke/fill colour
 * @param {number} [p.schriftPx=9] font height in screen px
 * @param {string} [p.testid] data-testid of the group
 * @param {Record<string, string|number|boolean|undefined>} [p.daten] extra data-* attributes for the group
 */
export default function Masskette({
  punkte, X, Z, px, SCALE, offsetM = 0.5, seite = 1, gesamt = true, format = formatMeter,
  farbe = "#334155", schriftPx = 9, testid, daten,
}) {
  const pxJeM = SCALE / (px(1) || 1); // screen px per metre
  const { teil, gesamt: ges } = kettenPaar({ punkte, offsetM, seite, pxJeM, schrift: schriftPx, format, gesamt });
  if (!teil.texte.length) return null;
  const L = ({ a, b }, key, breite) => <line key={key} x1={X(a.x)} y1={Z(a.z)} x2={X(b.x)} y2={Z(b.z)} strokeWidth={breite} />;
  const kette = (g, prefix) => (
    <g key={prefix} data-kette={prefix}>
      {L(g.linie, `${prefix}-l`, px(0.9))}
      {g.hilfslinien.map((h, i) => L(h, `${prefix}-h${i}`, px(0.6)))}
      {g.striche.map((s, i) => L(s, `${prefix}-s${i}`, px(1.6)))}
      {g.texte.map((t, i) => {
        const tx = X(t.x), ty = Z(t.z);
        return (
          <React.Fragment key={`${prefix}-t${i}`}>
            {t.hinweis && L(t.hinweis, `${prefix}-hw${i}`, px(0.6))}
            <text
              x={tx} y={ty} textAnchor="middle" fontSize={px(schriftPx)} fill={farbe} stroke="none"
              style={{ fontVariantNumeric: "tabular-nums" }}
              transform={t.winkel ? `rotate(${t.winkel} ${tx} ${ty})` : undefined}
              data-mass={t.laengeM.toFixed(2)} data-aussen={t.aussen ? "1" : undefined}
            >
              {t.text}
            </text>
          </React.Fragment>
        );
      })}
    </g>
  );
  return (
    <g data-testid={testid} data-masskette stroke={farbe} strokeLinecap="butt" style={{ pointerEvents: "none" }} {...daten}>
      {kette(teil, "teil")}
      {ges && kette(ges, "gesamt")}
    </g>
  );
}
