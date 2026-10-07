import React, { useMemo, useRef } from "react";
import { itemRect, bewegungsflaecheRect, moebelById } from "@designer/lib/moebel";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import { TuerSymbol } from "./MoebelSchicht";

// Farben nach der ASR-Raumdatenblatt-Vorlage eines Referenzprojekts (anonymisiert).
const KAT_FARBE = {
  desk: { fill: "#9ec5ff", stroke: "#0f62fe" },
  chair: { fill: "#e6edf3", stroke: "#afb8c1" },
  furn: { fill: "#d8dee4", stroke: "#8b949e" },
  sanitaer: { fill: "#d8dee4", stroke: "#8b949e" },
};

// Öffnungen (Phase 43, MOEBEL-03): Fenster blau, Tür amber — dieselben Farbfamilien wie
// BimPlan2D (Fenster #3b82f6) und die Werkstatt-Türen, damit Raum-Karte und Geschossplan
// dasselbe meinen.
const OEFFNUNG_FARBE = { window: "#3b82f6", door: "#d97706" };
// Balkendicke einer Öffnung in Metern (Symbol, keine Wanddicke).
const OEFFNUNG_DICKE_M = 0.25;

// Client-Pixel → SVG-Nutzereinheiten. getScreenCTM berücksichtigt viewBox-Skalierung und
// das CSS-Maß (width 100 %). Fallback createSVGPoint für Browser ohne DOMPoint.
function clientToSvg(svg, e) {
  const ctm = svg?.getScreenCTM?.();
  if (!ctm) return null;
  const inv = ctm.inverse();
  if (typeof window !== "undefined" && typeof window.DOMPoint === "function") {
    const p = new window.DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    return { x: p.x, y: p.y };
  }
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(inv);
  return { x: p.x, y: p.y };
}

/**
 * Legende der Möbel-Darstellung (Farben wie oben) — geteilt von Raum-Karte und Geschossplan.
 */
export function MoebelLegende() {
  const eintrag = (fill, stroke, label, dash) => (
    <span className="inline-flex items-center gap-1.5" key={label}>
      <span
        className="inline-block w-3.5 h-2.5 rounded-[2px]"
        style={{ background: fill, border: `1px ${dash ? "dashed" : "solid"} ${stroke}` }}
      />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600" data-testid="moebel-legende">
      {eintrag("#9ec5ff", "#0f62fe", "Schreibtisch / Tisch")}
      {eintrag("#e6edf3", "#afb8c1", "Stuhl")}
      {eintrag("#d8dee4", "#8b949e", "Möbel / Sanitär")}
      {eintrag("rgba(45,164,78,.10)", "#2da44e", "Bewegungsfläche frei (1,00 m, ASR A1.2)", true)}
      {eintrag("rgba(229,72,77,.18)", "#e5484d", "Überlappung", true)}
      {eintrag(OEFFNUNG_FARBE.window, OEFFNUNG_FARBE.window, "Fenster")}
      {eintrag(OEFFNUNG_FARBE.door, OEFFNUNG_FARBE.door, "Tür (mit Anschlag)")}
    </div>
  );
}

// Gemeinsame Raum-Draufsicht (Innenausbau editierbar / ASR read-only):
// Zone-Umriss maßstäblich + Möbel + grün gestrichelte Bewegungsflächen (ASR A1.2)
// + optionales Band (ASR-Reiter) + Türen/Fenster an den Raumgrenzen + 1-m-Maßstabsbalken.
// Props:
//   polygon    Zone-Points [{x, z}] (Meter)
//   items      [{id, typ, x, y, rot}] (y ↔ z-Achse)
//   selectable Möbel anklickbar (Innenausbau)
//   onSelect   (id|null) — Klick auf Möbel bzw. Freifläche
//   selectedId aktuell gewähltes Möbel (blau gestrichelt hervorgehoben)
//   band       optionales Rechteck {x, z, w, d} (bewegungsflaeche aus asr.js)
//   kollisionIds Ids überlappender Möbel (KD-14) — rot gestrichelt überlagert
//   maxW/maxH  Ziel-Pixelmaß (Default 560×260 wie ASR-Karte)
//   onItemMove (id, x, y) — Phase 43: wenn gesetzt, sind Möbel ziehbar (useSvgDrag, PW-02b);
//              x/y = neue Mitte in Metern, ungerastert — der Aufrufer rastert (verschiebeItem)
//   onItemRotate (id) — Phase 43: Doppelklick auf ein Möbel
//   oeffnungen [{kind, a:{x,z}, b:{x,z}, width}] — Phase 43: Segmente aus raumOeffnungen.js
export default function MoebelDraufsicht({
  polygon, items = [], selectable = false, onSelect, selectedId = null, band = null,
  kollisionIds = [], maxW = 560, maxH = 260, onItemMove, onItemRotate, oeffnungen = [],
}) {
  const svgRef = useRef(null);
  const plan = useMemo(() => {
    if (!polygon || polygon.length < 3) return null;
    const xs = polygon.map((p) => p.x);
    const zs = polygon.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const PAD = 1.2; // Rand in Metern — lässt Bewegungsflächen am Raumrand sichtbar
    const wM = maxX - minX, hM = maxZ - minZ;
    const SCALE = Math.min(maxW / (wM + PAD * 2), maxH / (hM + PAD * 2));
    const W = (wM + PAD * 2) * SCALE, H = (hM + PAD * 2) * SCALE;
    const X = (x) => (x - minX + PAD) * SCALE;
    const Z = (z) => (z - minZ + PAD) * SCALE;
    const poly = polygon.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ");
    const mitte = { x: xs.reduce((s, v) => s + v, 0) / xs.length, z: zs.reduce((s, v) => s + v, 0) / zs.length };
    return { W, H, X, Z, SCALE, poly, minX, minZ, PAD, mitte };
  }, [polygon, maxW, maxH]);

  // Maus → Meter im Zonen-Koordinatensystem (Umkehrung von X/Z).
  const clientToMeters = (e) => {
    if (!plan) return null;
    const p = clientToSvg(svgRef.current, e);
    if (!p) return null;
    return { x: p.x / plan.SCALE + plan.minX - plan.PAD, y: p.y / plan.SCALE + plan.minZ - plan.PAD };
  };

  // Drag (Phase 43): Griffpunkt-Offset merken, damit das Möbel nicht auf den Cursor springt.
  const draggable = selectable && typeof onItemMove === "function";
  const { startDrag } = useSvgDrag({
    onDrag: (d, e) => {
      const p = clientToMeters(e);
      if (!p) return;
      onItemMove(d.id, p.x + d.offX, p.y + d.offY);
    },
    onTap: (d) => onSelect?.(d.id),
  });
  const onItemPointerDown = (it) => (e) => {
    if (!draggable || e.button !== 0) return;
    const p = clientToMeters(e);
    if (!p) return;
    // stopPropagation: ein umgebender Plan (BimPlan2D) würde sonst pannen (61-07-Lehre).
    e.stopPropagation();
    onSelect?.(it.id);
    startDrag(e, { id: it.id, offX: it.x - p.x, offY: it.y - p.y });
  };

  if (!plan) {
    return <p className="text-xs text-slate-400">Raum-Polygon unvollständig — Zone im Gebäudemodell prüfen.</p>;
  }

  const { W, H, X, Z, SCALE } = plan;

  // Türanschlag als Polylinie (8 Segmente) um das Scharnier — keine SVG-Arc-Flag-Rätsel.
  const tuerBogen = (s) => {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len, nz = dx / len;
    // Bogen ins Rauminnere: Normale zeigt zur Zonen-Mitte.
    const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
    if ((plan.mitte.x - mx) * nx + (plan.mitte.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
    const r = s.width || len;
    const a0 = Math.atan2(dz, dx);                 // Richtung Scharnier → Türblatt in der Wand
    const a1 = Math.atan2(nz, nx);                 // Richtung Scharnier → offenes Türblatt
    // kürzester Drehsinn von a0 nach a1 (Viertelkreis)
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (delta * i) / 8;
      pts.push(`${X(s.a.x + Math.cos(a) * r)},${Z(s.a.z + Math.sin(a) * r)}`);
    }
    return { blatt: { x: s.a.x + nx * r, z: s.a.z + nz * r }, pts: pts.join(" ") };
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={Math.max(140, H)}
      role="img"
      onClick={selectable ? () => onSelect?.(null) : undefined}
      style={selectable ? { touchAction: "none" } : undefined}
    >
      {/* Raumumriss */}
      <polygon points={plan.poly} fill="rgba(14, 165, 233, 0.06)" stroke="#0f172a" strokeWidth="1.5" />

      {/* Türen/Fenster an den Raumgrenzen (Phase 43, MOEBEL-03) — dekorativ, klick-durchlässig */}
      {oeffnungen.length > 0 && (
        <g data-testid="md-oeffnungen" style={{ pointerEvents: "none" }}>
          {oeffnungen.map((s, i) => {
            const farbe = OEFFNUNG_FARBE[s.kind] || OEFFNUNG_FARBE.window;
            const bogen = s.kind === "door" ? tuerBogen(s) : null;
            return (
              <g key={`oe${i}`} data-kind={s.kind}>
                <line
                  x1={X(s.a.x)} y1={Z(s.a.z)} x2={X(s.b.x)} y2={Z(s.b.z)}
                  stroke={farbe} strokeWidth={Math.max(2, OEFFNUNG_DICKE_M * SCALE)} strokeLinecap="butt"
                />
                {bogen && (
                  <>
                    <line x1={X(s.a.x)} y1={Z(s.a.z)} x2={X(bogen.blatt.x)} y2={Z(bogen.blatt.z)} stroke={farbe} strokeWidth="1.2" />
                    <polyline points={bogen.pts} fill="none" stroke={farbe} strokeWidth="1" strokeDasharray="3 2" />
                  </>
                )}
              </g>
            );
          })}
        </g>
      )}

      {/* optionales Bewegungsflächen-Band (ASR-Reiter, amber wie bisher) */}
      {band && band.w > 0 && band.d > 0 && (
        <rect
          x={X(band.x)} y={Z(band.z)} width={band.w * SCALE} height={band.d * SCALE}
          fill="rgba(245, 158, 11, 0.30)" stroke="#d97706" strokeWidth="1" strokeDasharray="4 3"
        />
      )}

      {/* Bewegungsflächen der Möbel (grün gestrichelt, ASR A1.2) — unter den Möbeln */}
      {items.map((it) => {
        const bf = bewegungsflaecheRect(it);
        if (!bf) return null;
        return (
          <rect
            key={`bf-${it.id}`}
            x={X(bf.x)} y={Z(bf.y)} width={bf.w * SCALE} height={bf.h * SCALE}
            fill="rgba(45, 164, 78, 0.10)" stroke="#2da44e" strokeWidth="1" strokeDasharray="4 3"
          />
        );
      })}

      {/* Möbel */}
      {items.map((it) => {
        const r = itemRect(it);
        const typ = moebelById(it.typ);
        const c = KAT_FARBE[typ?.kategorie] || KAT_FARBE.furn;
        const sel = selectable && it.id === selectedId;
        const koll = kollisionIds.includes(it.id);
        return (
          <g
            key={it.id}
            data-testid="md-item"
            data-id={it.id}
            data-x={it.x}
            data-y={it.y}
            data-rot={it.rot || 0}
            onClick={selectable ? (e) => { e.stopPropagation(); onSelect?.(it.id); } : undefined}
            onPointerDown={draggable ? onItemPointerDown(it) : undefined}
            onDoubleClick={selectable && onItemRotate ? (e) => { e.stopPropagation(); onItemRotate(it.id); } : undefined}
            style={selectable ? { cursor: draggable ? "grab" : "pointer" } : undefined}
          >
            {typ?.tuer ? (
              // 75-09 Task 4 (MSB-14): door furniture entries share the door symbol
              // with the plan layer (room-card SCALE, no px — fixed numbers).
              <TuerSymbol item={it} X={X} Z={Z} SCALE={SCALE} sel={sel} />
            ) : (
              <>
                <rect
                  x={X(r.x)} y={Z(r.y)} width={r.w * SCALE} height={r.h * SCALE}
                  fill={c.fill} stroke={sel ? "#0f62fe" : c.stroke}
                  strokeWidth={sel ? 2 : 1} strokeDasharray={sel ? "5 3" : undefined}
                  rx="1.5"
                />
                {/* Überlappung (KD-14): rote Überlagerung, unabhängig von der Auswahl */}
                {koll && (
                  <rect
                    x={X(r.x)} y={Z(r.y)} width={r.w * SCALE} height={r.h * SCALE}
                    fill="rgba(229, 72, 77, 0.18)" stroke="#e5484d" strokeWidth="1.5"
                    strokeDasharray="3 2" rx="1.5" pointerEvents="none"
                  />
                )}
                {/* Typ-Name nur wenn genug Platz (≥ 34 px breit) */}
                {r.w * SCALE >= 34 && r.h * SCALE >= 12 && (
                  <text
                    x={X(r.x + r.w / 2)} y={Z(r.y + r.h / 2)}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="8" fill="#334155" pointerEvents="none"
                  >
                    {typ?.name || it.typ}
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}

      {/* 1-m-Maßstabsbalken (Vorlagen-Muster), links unten */}
      <g>
        <line x1={8} y1={H - 8} x2={8 + SCALE} y2={H - 8} stroke="#0f172a" strokeWidth="2" />
        <line x1={8} y1={H - 12} x2={8} y2={H - 4} stroke="#0f172a" strokeWidth="1" />
        <line x1={8 + SCALE} y1={H - 12} x2={8 + SCALE} y2={H - 4} stroke="#0f172a" strokeWidth="1" />
        <text x={8 + SCALE / 2} y={H - 12} textAnchor="middle" fontSize="8" fill="#475569">1 m</text>
      </g>
    </svg>
  );
}
