// <ZonenTueren> — door symbols of room zones (Plan 75-14 Task 2, MSB-14 / Auflage 13).
//
// Reads the door records the tesselation stores ON the zone (zone.tueren[], see
// tesselierung.js Tuer typedef) and draws, per door: the wall opening in wall
// thickness (75-07 WANDSTAERKEN: light partition 11,5 cm, apartment door in a
// 24 cm load-bearing wall), the door leaf as a line in opening width and the
// thin 90° swing arc; strokes in SCREEN pixels via the host's px() (75-09 MSB-16)
// so the symbol reads the same at every zoom. In the massing plan (1:200) only the
// opening is drawn (nurOeffnung) — leaf and arc would be sub-pixel noise there.
//
// A click on a door (focus only) toggles the swing side via onToggle — the host
// owns the data and the undo stack. Furniture doors (MoebelSchicht.TuerSymbol)
// are a different thing and keep their own data-tuer attribute; these zone doors
// carry data-tuer-zone so specs can count them apart.
//
// In:  zonen (with tueren), X/Z/SCALE (host plan), px (screen px → viewBox units).
// Out: a <g> of SVG shapes.

import React from "react";
import { tuerGeometrie } from "@designer/lib/wohnungsErschliessung";
import { WANDSTAERKEN } from "@designer/lib/tesselierung";

/**
 * @param {object} p
 * @param {Array<object>} p.zonen zones (only those with tueren are drawn)
 * @param {(x:number)=>number} p.X model x (m) → viewBox x
 * @param {(z:number)=>number} p.Z model z (m) → viewBox y
 * @param {number} p.SCALE viewBox units per metre
 * @param {(n:number)=>number} [p.px] screen px → viewBox units; default = viewBox units
 * @param {boolean} [p.nurOeffnung=false] massing mode: opening only, no leaf/arc
 * @param {(zoneName:string, idx:number, tuer:object) => void} [p.onToggle] click handler (focus)
 * @param {(tuer:object) => string} [p.titelFuer] tooltip text per door (host passes translated text)
 * @param {string} [p.prefix="fk"] data-testid prefix
 */
export default function ZonenTueren({ zonen, X, Z, SCALE, px = null, nurOeffnung = false, onToggle, titelFuer, prefix = "fk" }) {
  const p = px || ((n) => n);
  const out = [];
  for (const zone of Array.isArray(zonen) ? zonen : []) {
    const tueren = Array.isArray(zone?.tueren) ? zone.tueren : [];
    tueren.forEach((t, idx) => {
      const g = tuerGeometrie(zone, t);
      if (!g) return;
      const st = t.typ === "wohnung" ? WANDSTAERKEN.tragend : WANDSTAERKEN.leicht; // m
      const h = (st / 2) * SCALE; // half thickness in viewBox units
      const nx = g.normale.x, nz = g.normale.z;
      // Opening polygon: the leaf line (closed position) swept ± half the wall thickness.
      const a = g.scharnier, b = g.geschlossen;
      const pts = [
        `${X(a.x) - nx * h},${Z(a.z) - nz * h}`, `${X(b.x) - nx * h},${Z(b.z) - nz * h}`,
        `${X(b.x) + nx * h},${Z(b.z) + nz * h}`, `${X(a.x) + nx * h},${Z(a.z) + nz * h}`,
      ].join(" ");
      const bogen = g.bogen.map((q, i) => `${i ? "L" : "M"}${X(q.x)},${Z(q.z)}`).join(" ");
      const klickbar = typeof onToggle === "function";
      out.push(
        <g
          key={`${zone.name}-${idx}`}
          data-testid={`${prefix}-tuer`}
          data-tuer-zone={zone.name}
          data-tuer={t.aufschlag === "rechts" ? "rechts" : "links"}
          data-breite={String(t.breite_m)}
          data-typ={t.typ || "zimmer"}
          style={{ cursor: klickbar ? "pointer" : "default", pointerEvents: klickbar ? "auto" : "none" }}
          onClick={klickbar ? (e) => { e.stopPropagation(); onToggle(String(zone.name), idx, t); } : undefined}
        >
          {typeof titelFuer === "function" && <title>{titelFuer(t)}</title>}
          {/* Opening: white fill cuts the wall line; thin outline marks the reveals. */}
          <polygon points={pts} fill="#ffffff" stroke="#334155" strokeWidth={p(nurOeffnung ? 0.6 : 0.8)} data-tuer-oeffnung />
          {!nurOeffnung && (
            <>
              <line x1={X(g.scharnier.x)} y1={Z(g.scharnier.z)} x2={X(g.offen.x)} y2={Z(g.offen.z)}
                stroke="#0f172a" strokeWidth={p(1.4)} strokeLinecap="butt" data-tuer-blatt />
              <path d={bogen} fill="none" stroke="#475569" strokeWidth={p(0.6)} data-tuer-bogen />
              {/* Hit area for the click (the thin strokes are hard to hit). */}
              {klickbar && <circle cx={X((g.scharnier.x + g.geschlossen.x) / 2)} cy={Z((g.scharnier.z + g.geschlossen.z) / 2)} r={p(9)} fill="transparent" stroke="none" />}
            </>
          )}
        </g>,
      );
    });
  }
  if (!out.length) return null;
  return <g data-testid={`${prefix}-tueren`}>{out}</g>;
}
