// 261111-zs1: "Zeigen und Sagen" in the 2D plan of the BIM studio - the numbered pointing points, the text notes of the plan, and the
// quick buttons for the commonest creating commands. Rendered by BitBimStudio: the points and notes through the overlay render-prop of
// BimPlan2D (inside the plan's <svg>), the quick buttons as a small bar over the plan.
// Nothing here changes a model: a quick button calls the SAME register command a sentence ends in ("anlegen", "eigenschaft-setzen"),
// so it makes the same proposal - one code path; the person confirms on the proposal card.
//
// In:  points [{x, z, level}] and notes [{x, z, level, text, _idx}] in m, the storey shown, the plan transformers X/Z/px; for the bar the
//      buttons to show ({id, label, testid, onClick}) - which buttons apply is decided by the studio (it knows walls and selection).
// Out: <g data-testid="zeige-punkte"> / <g data-testid="plan-notizen"> and <div data-testid="zeigen-schnell">. Colours via token classes.
import React from "react";

/**
 * Numbered pointing points (1..4) and the plan notes of the shown storey.
 * @param {{punkte: ReadonlyArray<{x: number, z: number, level?: number}>, notizen: ReadonlyArray<any>, level: number,
 *   X: (x: number) => number, Z: (z: number) => number, px: (n: number) => number}} props
 *   punkte: pointing points in m; notizen: plan notes {x, z, level, text, _idx} in m; level: storey shown (0-based);
 *   X/Z: plan transformers (svg units); px(n): svg units of n screen pixels (sizes stay the same at every zoom).
 */
export default function ZeigePunktePlan({ punkte, notizen, level, X, Z, px }) {
  const hier = (punkte || []).map((p, i) => ({ ...p, nr: i + 1 })).filter((p) => (p.level ?? 0) === level);
  const texte = (notizen || []).filter((n) => (n.level ?? 0) === level);
  if (!hier.length && !texte.length) return null;
  return (
    <g style={{ pointerEvents: "none" }}>
      {texte.length > 0 && (
        <g data-testid="plan-notizen" className="text-foreground">
          {texte.map((n) => (
            <g key={n._idx} data-testid="plan-notiz" data-idx={n._idx}>
              {/* a note is a remark on the sheet: a small leader cross at its point, the text beside it */}
              <path d={`M${X(n.x) - px(4)},${Z(n.z)} L${X(n.x) + px(4)},${Z(n.z)} M${X(n.x)},${Z(n.z) - px(4)} L${X(n.x)},${Z(n.z) + px(4)}`}
                stroke="currentColor" strokeWidth={px(1.2)} />
              <text x={X(n.x) + px(6)} y={Z(n.z) - px(4)} fill="currentColor" fontSize={px(11)} fontStyle="italic">{n.text}</text>
            </g>
          ))}
        </g>
      )}
      {hier.length > 0 && (
        <g data-testid="zeige-punkte" className="text-primary">
          {hier.map((p) => (
            <g key={p.nr} data-testid="zeige-punkt" data-nr={p.nr}>
              <circle cx={X(p.x)} cy={Z(p.z)} r={px(7)} fill="none" stroke="currentColor" strokeWidth={px(1.5)} />
              <circle cx={X(p.x)} cy={Z(p.z)} r={px(1.5)} fill="currentColor" />
              <text x={X(p.x) + px(9)} y={Z(p.z) - px(8)} fill="currentColor" fontSize={px(12)} fontWeight="700">{p.nr}</text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

/**
 * The quick buttons over the plan. Shows nothing without buttons.
 * @param {{knoepfe: ReadonlyArray<{id: string, label: string, testid: string, onClick: () => void}>, hinweis?: string, className?: string}} props
 *   knoepfe: the buttons that apply now (labels already translated); hinweis: short translated line (e.g. "2 Punkte"), shown in front.
 */
export function ZeigenSchnellKnoepfe({ knoepfe, hinweis = "", className = "" }) {
  if (!knoepfe.length && !hinweis) return null;
  return (
    <div data-testid="zeigen-schnell" className={`flex flex-wrap items-center gap-1 rounded border border-border bg-card/95 px-2 py-1 text-xs shadow-sm ${className}`}>
      {hinweis && <span className="text-muted-foreground" data-testid="zeigen-schnell-hinweis">{hinweis}</span>}
      {knoepfe.map((k) => (
        <button key={k.id} type="button" data-testid={k.testid} onClick={k.onClick}
          className="rounded border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10">{k.label}</button>
      ))}
    </div>
  );
}
