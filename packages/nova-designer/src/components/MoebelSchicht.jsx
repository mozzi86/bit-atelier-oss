// MoebelSchicht — the ONE furniture layer for BimPlan2D overlays (75-09 Task 4).
//
// Extracted from MoeblierungsPlan.jsx (Phase 43, MOEBEL-02) so the interior
// fit-out plan (prefix "mp") and the apartment focus (prefix "fk", 75-09) share
// the SAME editor: rooms as click areas, movement areas, furniture bodies,
// door symbols (MSB-14), drag / tap / double-click. Hard project rule: no
// second furniture editor — state and persistence ALWAYS stay with the host
// component; this layer only renders and reports raw intents.
//
// In:  overlay transformers from BimPlan2D (X, Z, SCALE, rawMeters, bounds),
//      optional px (screen-pixel function, letterbox-correct — with it, strokes
//      and fonts stay constant on screen; without it the exact Phase-43 numbers),
//      zones + per-zone item lists + callbacks (onMove raw metres — the host
//      snaps/blocks), selection state, collision ids.
// Out: SVG <g> for the overlay render-prop; React text nodes only, no
//      innerHTML, no window/document listeners (pointer handling via
//      useSvgDrag's pointer capture).

import React, { useRef } from "react";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import {
  itemRect, itemAusdehnung, bewegungsflaecheRect, moebelById,
} from "@designer/lib/moebel";
import { tuerAufschlag } from "@designer/lib/wohnMoebel";

// Category colours (Realprojekt template) — moved here verbatim from
// MoeblierungsPlan.jsx so ONE layer owns the furniture look (75-09 Task 4).
const KAT_FARBE = {
  desk: { fill: "#9ec5ff", stroke: "#0f62fe" },
  chair: { fill: "#e6edf3", stroke: "#afb8c1" },
  furn: { fill: "#d8dee4", stroke: "#8b949e" },
  sanitaer: { fill: "#d8dee4", stroke: "#8b949e" },
};

// Door colour — amber, same family as MoebelDraufsicht's OEFFNUNG_FARBE.door,
// so a door means the same thing in the room card and in the plan.
const TUER_FARBE = "#d97706";
// Opening fill = the plan background (BimPlan2D's <rect fill="#f8fafc">): the
// bright rect visually cuts the wall line where the door sits.
const TUER_OEFFNUNG_FILL = "#f8fafc";

/**
 * Door symbol (MSB-14, Blatt 07 :193 + D-P75-09-A): opening as a bright rect
 * over the door line in symbol depth, door LEAF as a solid line from the hinge
 * to the open end, 90° swing arc as a dashed polyline (9 points from
 * wohnMoebel.tuerAufschlag — no SVG arc flags), clear width in cm as a small
 * label at the door centre. Readable direction via data-tuer="links|rechts".
 * @param {object} p
 * @param {{typ:string,x:number,y:number,rot?:number,aufschlag?:string}} p.item door item (centre in metres)
 * @param {(x:number)=>number} p.X metres → SVG units
 * @param {(z:number)=>number} p.Z metres → SVG units (y axis)
 * @param {number} p.SCALE SVG units per metre
 * @param {((n:number)=>number)|null} [p.px] screen px → SVG units (optional; without it fixed numbers)
 * @param {boolean} [p.sel] selected — leaf turns selection blue
 * @returns {JSX.Element|null} null for non-door types
 */
export function TuerSymbol({ item, X, Z, SCALE, px = null, sel = false }) {
  const typ = moebelById(item?.typ);
  if (!typ?.tuer) return null;
  const a = tuerAufschlag(item);
  if (!a) return null;
  const r = itemRect(item);
  const aufschlag = item.aufschlag === "rechts" ? "rechts" : "links";
  // Strokes/label: with px() constant on screen (focus at fixed scale),
  // without px() the room-card numbers (leaf 1.5, arc 1, text 8).
  const blattBreite = px ? px(2) : 1.5;
  const bogenBreite = px ? px(1) : 1;
  const bogenDash = px ? `${px(3)} ${px(2)}` : "3 2";
  const schrift = px ? px(9) : 8;
  const lichteCm = Math.round((typ.tuer.lichte_m || 0) * 100);
  return (
    <g data-tuer={aufschlag} data-lichte={String(typ.tuer.lichte_m)}>
      {/* Opening: bright rect over the wall line, symbol depth = type t (metres). */}
      <rect
        x={X(r.x)} y={Z(r.y)} width={r.w * SCALE} height={r.h * SCALE}
        fill={TUER_OEFFNUNG_FILL} data-koerper
      />
      {/* Swing arc (dashed polyline, 9 points) — from the closed to the open leaf end. */}
      <polyline
        points={a.bogen.map((p) => `${X(p.x)},${Z(p.y)}`).join(" ")}
        fill="none" stroke={TUER_FARBE} strokeWidth={bogenBreite} strokeDasharray={bogenDash}
        pointerEvents="none" data-tuer-bogen
      />
      {/* Door leaf: hinge → open end (90° swing). */}
      <line
        x1={X(a.scharnier.x)} y1={Z(a.scharnier.y)} x2={X(a.offen.x)} y2={Z(a.offen.y)}
        stroke={sel ? "#0f62fe" : TUER_FARBE} strokeWidth={blattBreite} strokeLinecap="round"
        pointerEvents="none" data-tuer-blatt
      />
      {/* Clear width in cm at the door centre. */}
      <text
        x={X(item.x)} y={Z(item.y)} textAnchor="middle" dominantBaseline="central"
        fontSize={schrift} fill={TUER_FARBE} fontWeight="600" pointerEvents="none"
      >
        {lichteCm}
      </text>
    </g>
  );
}

/**
 * Shared furniture layer for a BimPlan2D overlay (see file header).
 * @param {object} p
 * @param {(x:number)=>number} p.X metres → SVG units (live from the overlay — never cache)
 * @param {(z:number)=>number} p.Z metres → SVG units
 * @param {number} p.SCALE SVG units per metre (bbox-dynamic)
 * @param {(e:any)=>({x:number,z:number}|null)} p.rawMeters pointer event → metres (overlay)
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} p.bounds model bbox in metres
 * @param {((n:number)=>number)|null} [p.px] screen px → SVG units (overlay, letterbox-correct);
 *   without it the EXACT Phase-43 sizes (strokes 0.8/1.6/1.2, font max(5, min(8, SCALE·0.35)),
 *   name rule w·SCALE ≥ 24 && h·SCALE ≥ 9) — MoeblierungsPlan stays visually identical
 * @param {Array<object>} p.zonen zones to render [{points:[{x,z}], name, …}]
 * @param {(zone:object)=>string} p.keyFuer zone → moeblierung key
 * @param {(zone:object)=>Array<object>} p.itemsFuer zone → furniture items
 * @param {string|null} [p.aktivKey] active room key (highlighted)
 * @param {(key:string|null)=>void} [p.onAktivChange] room click/tap
 * @param {{key:string,id:string}|null} [p.sel] selected item
 * @param {(sel:{key:string,id:string}|null)=>void} [p.onSelect] selection change (null = deselect)
 * @param {(key:string, id:string, xM:number, yM:number)=>void} [p.onMove] drag — RAW metres, the host snaps/blocks
 * @param {(key:string, id:string)=>void} [p.onRotate] double-click — the host rotates +90°
 * @param {Set<string>|null} [p.kollisionIds] ids of overlapping items (red overlay)
 * @param {((item:object)=>Array<{x:number,y:number,w:number,h:number,seite?:string,tiefe?:number}>)|null} [p.bewegungFuer]
 *   movement areas per item (default: the ASR band bewegungsflaecheRect as a 0/1-element list)
 * @param {string} [p.prefix] testid prefix ("mp" interior fit-out, "fk" focus)
 * @param {string} [p.overlayTestid] override for the root <g> testid — the
 *   focus host wraps this layer inside its OWN root group that already carries
 *   data-testid="fk-overlay" (with data-px-je-m, plan Task 5); without the
 *   override both groups would claim "fk-overlay" and break Playwright strict
 *   mode. Default `{prefix}-overlay` (mp stays exactly as Phase 43).
 */
export default function MoebelSchicht({
  X, Z, SCALE, rawMeters, bounds, px = null, zonen, keyFuer, itemsFuer,
  aktivKey = null, onAktivChange, sel = null, onSelect, onMove, onRotate,
  kollisionIds = null, bewegungFuer = null, prefix = "mp", overlayTestid = null,
}) {
  // Drag exactly like Phase 43 (MoeblierungsPlan :105-126): rawMeters into a
  // ref EVERY render (SCALE/bbox are dynamic — never cache), grip offset so the
  // item does not jump to the cursor, pointer capture via useSvgDrag (no window
  // listeners), stopPropagation on pointerdown (otherwise BimPlan2D pans —
  // 61-07 lesson).
  const rawMetersRef = useRef(null);
  rawMetersRef.current = rawMeters;
  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const p = rawMetersRef.current?.(e);
      if (!p) return;
      onMove?.(d.key, d.id, p.x + d.offX, p.z + d.offY);
    },
    onTap: (d) => { onSelect?.({ key: d.key, id: d.id }); onAktivChange?.(d.key); },
  });
  const onItemDown = (key, item) => (e) => {
    if (e.button !== 0) return;
    const p = rawMetersRef.current?.(e);
    if (!p) return;
    e.stopPropagation(); // sonst pannt BimPlan2D (61-07-Lehre)
    onSelect?.({ key, id: item.id });
    onAktivChange?.(key);
    startDrag(e, { key, id: item.id, offX: item.x - p.x, offY: item.y - p.z });
  };

  // Movement areas per item: host-provided (focus: wohnMoebel.bewegungsflaechen
  // per level) or the ASR A1.2 default band as a 0/1-element list.
  /** @type {(item:object)=>Array<{x:number,y:number,w:number,h:number,seite?:string,tiefe?:number}>} */
  const flaechen = bewegungFuer
    || ((item) => {
      const bf = bewegungsflaecheRect(item);
      return bf ? [bf] : [];
    });

  // Screen-px sizes: with px() constant on screen; without px() the exact
  // Phase-43 numbers so MoeblierungsPlan renders pixel-identical.
  const strichKoerper = px ? px(1) : 0.8;
  const strichSel = px ? px(2) : 1.6;
  const strichKollision = px ? px(1.5) : 1.2;
  const strichBand = px ? px(1) : 0.8;
  const bandDash = px ? `${px(3)} ${px(2)}` : "3 2";
  const schrift = px ? px(9) : null; // null → the SCALE formula below
  const raumStrich = px ? px(1.5) : 1.5;
  // Name rule: without px the viewBox-unit thresholds (w ≥ 24 && h ≥ 9);
  // with px a screen-pixel width (≥ 28 px — 75-09 Task 4).
  const nameSichtbar = (r) => (px
    ? r.w * SCALE >= px(28)
    : r.w * SCALE >= 24 && r.h * SCALE >= 9);

  return (
    <g data-testid={overlayTestid || `${prefix}-overlay`}>
      {/* Klick ins Leere: Möbel abwählen (Raum bleibt aktiv). Mitteltaste/Pan läuft weiter.
          Rect-Formel unverändert aus Phase 43 übernommen. */}
      <rect
        x="0" y="0"
        width={X(bounds.maxX) + X(bounds.minX)} height={Z(bounds.maxZ) + Z(bounds.minZ)}
        fill="transparent"
        onClick={(e) => { e.stopPropagation(); onSelect?.(null); }}
      />
      {/* Räume als Klickflächen — aktiver Raum mit Rahmen */}
      {zonen.map((z) => {
        const key = keyFuer(z);
        const d = z.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
        const istAktiv = key === aktivKey;
        return (
          <path
            key={`r-${key}`}
            d={d}
            data-testid={`${prefix}-raum`}
            data-key={key}
            data-aktiv={istAktiv ? "1" : "0"}
            fill={istAktiv ? "rgba(14,165,233,0.10)" : "transparent"}
            stroke={istAktiv ? "#0284c7" : "none"}
            strokeWidth={raumStrich}
            strokeDasharray={istAktiv ? "4 3" : undefined}
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onAktivChange?.(key); onSelect?.(null); }}
          />
        );
      })}
      {/* Bewegungsflächen (grün gestrichelt) unter den Möbeln */}
      {zonen.flatMap((z) => itemsFuer(z).map((item) => flaechen(item).map((bf, i) => {
        const rot = [0, 90, 180, 270].includes(item.rot) ? item.rot : 0;
        const tiefe = bf.tiefe ?? (rot === 90 || rot === 270 ? bf.w : bf.h);
        return (
          <rect
            key={`bf-${item.id}-${i}`} x={X(bf.x)} y={Z(bf.y)} width={bf.w * SCALE} height={bf.h * SCALE}
            fill="rgba(45,164,78,0.10)" stroke="#2da44e" strokeWidth={strichBand} strokeDasharray={bandDash}
            style={{ pointerEvents: "none" }}
            data-bewegung="1" data-seite={bf.seite || "vorn"} data-tiefe={tiefe} data-item={item.id}
          />
        );
      })))}
      {/* Möbel — ziehbar, Doppelklick dreht; Tür-Items als TuerSymbol (MSB-14) */}
      {zonen.flatMap((z) => {
        const key = keyFuer(z);
        return itemsFuer(z).map((item) => {
          // T-75-09-02: stored junk (unknown type, non-finite centre) is skipped.
          const typ = moebelById(item?.typ);
          if (!typ || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return null;
          const r = itemRect(item);
          const c = KAT_FARBE[typ.kategorie] || KAT_FARBE.furn;
          const istSel = sel?.id === item.id && sel?.key === key;
          const koll = !!kollisionIds?.has?.(item.id);
          const ausdehnung = itemAusdehnung(item);
          return (
            <g
              key={`it-${item.id}`}
              data-testid={`${prefix}-item`}
              data-key={key}
              data-id={item.id}
              data-x={item.x}
              data-y={item.y}
              data-rot={item.rot || 0}
              data-typ={item.typ}
              data-breite-m={ausdehnung.w}
              data-tiefe-m={ausdehnung.h}
              data-kollision={koll ? "1" : undefined}
              style={{ cursor: "grab" }}
              onPointerDown={onItemDown(key, item)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => { e.stopPropagation(); onRotate?.(key, item.id); }}
            >
              {typ.tuer ? (
                <TuerSymbol item={item} X={X} Z={Z} SCALE={SCALE} px={px} sel={istSel} />
              ) : (
                <>
                  <rect x={X(r.x)} y={Z(r.y)} width={r.w * SCALE} height={r.h * SCALE}
                    fill={c.fill} stroke={istSel ? "#0f62fe" : c.stroke} strokeWidth={istSel ? strichSel : strichKoerper}
                    strokeDasharray={istSel ? "4 2" : undefined} rx="1" data-koerper />
                  {koll && (
                    <rect x={X(r.x)} y={Z(r.y)} width={r.w * SCALE} height={r.h * SCALE}
                      fill="rgba(229,72,77,0.18)" stroke="#e5484d" strokeWidth={strichKollision} strokeDasharray="3 2" rx="1" pointerEvents="none" />
                  )}
                  {nameSichtbar(r) && (
                    <text x={X(r.x + r.w / 2)} y={Z(r.y + r.h / 2)} textAnchor="middle" dominantBaseline="central"
                      fontSize={schrift ?? Math.max(5, Math.min(8, SCALE * 0.35))} fill="#334155" pointerEvents="none">
                      {typ.name || item.typ}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        });
      })}
    </g>
  );
}
