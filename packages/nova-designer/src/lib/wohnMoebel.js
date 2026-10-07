// Wohnmöblierung für den WohnungsFokus 1:50 (75-09, MS-09, Blatt 07 des Lösungskatalogs).
//
// Reine Lib — KEIN React, keine Seiteneffekte, kein Store. Alle Koordinaten in METERN
// (Zonen-Koordinatensystem: Zone-Points führen {x, z}; Items führen x/y, wobei y der
// z-Achse der Zone entspricht — Konvention aus moebel.js).
//
// In:
//   items    Möbel-Items {id, typ, x, y, rot, aufschlag?} (x/y = Mitte in m, rot ∈ {0,90,180,270})
//   zonen    {points: [{x, z}], level, name, art, we?} (aus tesseliere, ·WT-Zonen ohne id)
//   fenster  Fenstersegmente [{a:{x,z}, b:{x,z}}] (aus raumOeffnungen.oeffnungenAmRaum)
//   stufe    Bewegungsflächen-Stufe "standard" | "B" | "R" (DIN 18040-2 über accessibility)
// Out:
//   Rechtecke {x, y, w, h} in m (x/y = linke obere Ecke), Warnlisten (status immer "warn"),
//   Item-Listen, Platzierungs-Ergebnisse.
//
// Fachliche Quellen:
//   - Blatt 07 (Textextrakt `.planning/quellen/massing-studio/2026-09-20_…:183-204`):
//     Möbelmaße, Bewegungsflächen-Standardwerte, Auto-Möblierungs-Inventar, Regeln
//     („blockiert = setzt nicht", „zwei Bewegungsflächen dürfen überlappen", „Rückseite bündig").
//   - DIN 18040-2 (Stufen B 1,20 m / R 1,50 m) über accessibility.bewegungsflaeche (A8/A9).
//   - DIN 18100 (Türmaße — siehe Kommentar an WOHN_GRUPPE in moebel.js; Nutzerentscheidung
//     D-P75-09-A vom 23.09.2026: b = Rohbaumaß 885 / 1010 mm, lichte Breite abgeleitet).
//
// Import-Grenze: wohnMoebel importiert moebel/accessibility/massstab/proportion — moebel.js
// importiert NIE wohnMoebel.js (Zyklusverbot aus dem Plan).

import {
  moebelById, itemRect, itemAusdehnung, kollidiert, imRaum, punktImPolygon,
  snapRaster, zoneKey, bewegungsflaecheRect, WOHN_GRUPPE, EIGENE_GRUPPE,
} from "@designer/lib/moebel";
import { bewegungsflaeche } from "@designer/lib/accessibility";
import { kurzRaumname } from "@designer/lib/massstab";
import { istAchsparallelesRechteck } from "@core/lib/proportion";

// ---- Stufen -------------------------------------------------------------------------------

/**
 * Movement-area levels offered in the focus UI (75-09, Blatt 07).
 * "standard" = Blatt-07-Richtwerte je Möbel, "B"/"R" = DIN 18040-2 depths via
 * accessibility.bewegungsflaeche (1,20 / 1,50 m) for the "haupt" sides.
 */
export const BEWEGUNG_STUFEN = ["standard", "B", "R"];

// [ASSUMED] Default level "standard": MBO §50 requires accessibility only for the
// apartments of ONE storey, so the base level is the Blatt-07 standard; user can
// switch to B/R per apartment. Open question in 75-09-SUMMARY (default confirm).
/** Default movement-area level. */
export const STUFE_DEFAULT = "standard";

// ---- Seiten-Richtungen ---------------------------------------------------------------------

/**
 * Item-side → world direction per rotation. Item frame at rot 0: vorn = +y (same side
 * as benutzerseite, ASR convention in moebel.js), links = −x; rotations turn the frame
 * (rot 90 maps vorn +y → −x, links −x → −y, i.e. vector (x,y) → (−y,x) per 90°).
 * "vorn" is identical to the bewegungsflaecheRect side (rot 0 +y / 90 −x / 180 −y / 270 +x).
 * @type {Record<number, {vorn:string, hinten:string, links:string, rechts:string}>}
 */
export const SEITE_RICHTUNG = {
  0:   { vorn: "+y", hinten: "−y", links: "−x", rechts: "+x" },
  90:  { vorn: "−x", hinten: "+x", links: "−y", rechts: "+y" },
  180: { vorn: "−y", hinten: "+y", links: "+x", rechts: "−x" },
  270: { vorn: "+x", hinten: "−x", links: "+y", rechts: "−y" },
};

/**
 * Unit vector {x, y} for a direction token ("+x"|"−x"|"+y"|"−y") from SEITE_RICHTUNG.
 * @param {string} d direction token
 * @returns {{x:number, y:number}}
 */
function dirVec(d) {
  switch (d) {
    case "+x": return { x: 1, y: 0 };
    case "−x": return { x: -1, y: 0 };
    case "+y": return { x: 0, y: 1 };
    default:   return { x: 0, y: -1 }; // "−y"
  }
}

/**
 * World direction of an item side at its rotation (unknown rot behaves like 0,
 * same fallback as itemAusdehnung in moebel.js).
 * @param {{rot?:number}} item
 * @param {"vorn"|"hinten"|"links"|"rechts"} seite
 * @returns {{x:number, y:number}} unit vector
 */
function seitenVec(item, seite) {
  const rot = [0, 90, 180, 270].includes(item?.rot) ? item.rot : 0;
  return dirVec(SEITE_RICHTUNG[rot][seite]);
}

// ---- Kleine Geometrie-Helfer (lokal, moebel.js exportiert sie nicht) ------------------------

/**
 * Strict AABB overlap of two rects {x, y, w, h} in m (same semantics as the private
 * rectsUeberlappen in moebel.js — edge-touching is NOT an overlap).
 * @param {{x:number,y:number,w:number,h:number}|null|undefined} a
 * @param {{x:number,y:number,w:number,h:number}|null|undefined} b
 * @returns {boolean}
 */
function rechteckeUeberlappen(a, b) {
  return !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Tolerance (metres) for movement-BAND vs body tests: the EPS_BUNDIG nudge (~1e-9) that
// keeps wall-flush furniture legal can turn an exact band-touching-body into a ~2e-9
// overlap. Shrinking the band by TOL_BANDBODY before the strict test makes touching
// (zero-clearance) layouts pass while any real overlap (> 1 µm) still counts.
// [ASSUMED] 1e-6 m — far below the 0.05 m furniture grid, far above the nudge.
const TOL_BANDBODY = 1e-6;

/**
 * Does a movement-area BAND overlap a body rect, ignoring zero-clearance touching?
 * The band is shrunk by TOL_BANDBODY on every side before the strict AABB test.
 * @param {{x:number,y:number,w:number,h:number}} band metres
 * @param {{x:number,y:number,w:number,h:number}} body metres
 * @returns {boolean}
 */
function bandTrifftKoerper(band, body) {
  if (!band || !body) return false;
  const w = band.w - 2 * TOL_BANDBODY, h = band.h - 2 * TOL_BANDBODY;
  if (w <= 0 || h <= 0) return false;
  return rechteckeUeberlappen({ x: band.x + TOL_BANDBODY, y: band.y + TOL_BANDBODY, w, h }, body);
}

/**
 * Bounding box of a zone polygon ({x, z} points) in metres.
 * @param {Array<{x:number,z:number}>} points
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null} null when < 3 finite points
 */
function bboxAusPolygon(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const xs = points.map((p) => p.x).filter(Number.isFinite);
  const ys = points.map((p) => p.z).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Distance point → line segment (metres).
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} a segment start
 * @param {{x:number,y:number}} b segment end
 * @returns {number} metres
 */
function distPunktSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Distance between two line segments (metres) — exact enough for axis-parallel room
 * geometry: intersecting → 0, otherwise the minimum of the four point-segment distances.
 * [ASSUMED] the four-point approximation equals the true segment distance for the
 * axis-parallel wall/door cases this lib sees (no skewed furniture geometry).
 * @param {{x:number,y:number}} a1
 * @param {{x:number,y:number}} a2
 * @param {{x:number,y:number}} b1
 * @param {{x:number,y:number}} b2
 * @returns {number} metres
 */
function distSegmentSegment(a1, a2, b1, b2) {
  return Math.min(
    distPunktSegment(a1, b1, b2), distPunktSegment(a2, b1, b2),
    distPunktSegment(b1, a1, a2), distPunktSegment(b2, a1, a2),
  );
}

/**
 * Distance rect → segment (metres): the segment is sampled every ≤ 0.05 m and each
 * sample is clamped into the rect. [ASSUMED] 0.05 m sampling — finer than every
 * threshold used here (0.10 m window rule), so no relevant case is missed.
 * @param {{x:number,y:number,w:number,h:number}} rect metres
 * @param {{a:{x:number,z:number}, b:{x:number,z:number}}} seg window segment (zone coords)
 * @returns {number} metres
 */
function distRectZuSegment(rect, seg) {
  const ax = seg.a.x, ay = seg.a.z, bx = seg.b.x, by = seg.b.z;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / 0.05));
  let min = Infinity;
  for (let i = 0; i <= steps; i++) {
    const px = ax + ((bx - ax) * i) / steps;
    const py = ay + ((by - ay) * i) / steps;
    // Clamp the sample into the rect → distance 0 when inside.
    const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.w));
    const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.h));
    min = Math.min(min, Math.hypot(dx, dy));
  }
  return min;
}

/**
 * Does the item type carry a rule flag? (regeln live on the WOHN_GRUPPE types.)
 * @param {{typ:string}} item
 * @param {string} regel e.g. "nicht_vor_fenster" | "in_bewegungsflaeche_ok"
 * @returns {boolean}
 */
function hatRegel(item, regel) {
  return (moebelById(item?.typ)?.regeln || []).includes(regel);
}

// Tolerance constants (metres):
// TOL_RAUM = 0.005 — sperrGrund/checks accept bodies flush against walls: punktImPolygon
//   counts the TOP/RIGHT polygon border as OUTSIDE and BOTTOM/LEFT as INSIDE (ray-casting
//   asymmetry in moebel.js:331), so an exact bündig placement (Blatt 07 :198 „Rückseite
//   bündig") would fail the raw corner test on south/east walls. imRaumTolerant shrinks
//   the body by TOL_RAUM before testing; 5 mm is invisible (0.38 px at 1:50) and far below
//   the 0.05 m furniture grid. [ASSUMED]
const TOL_RAUM = 0.005;
// Corner inset (metres) when testing whether a movement area stays inside the room:
// bands of wall-flush furniture touch the border exactly; 1 mm inset decides “inside”.
const TOL_BAND = 0.001;

/**
 * Clamp an item centre so the body stays fully inside the room bbox (metres) — used for
 * derived placements (night tables at the bed head, coffee tables before the sofa) whose
 * computed centre may hang over a wall. Rooms smaller than the body yield the far-edge
 * clamp; gueltig rejects those anyway.
 * @param {{x:number,y:number}} mitte candidate centre in m
 * @param {{w:number,h:number}} ausdehnung body extent in m
 * @param {{x0:number,y0:number,x1:number,y1:number}} bb room bbox in m
 * @returns {{x:number,y:number}} clamped centre in m
 */
function clampInBbox(mitte, ausdehnung, bb) {
  const { w, h } = ausdehnung;
  return {
    x: Math.min(Math.max(mitte.x, bb.x0 + w / 2), bb.x1 - w / 2),
    y: Math.min(Math.max(mitte.y, bb.y0 + h / 2), bb.y1 - h / 2),
  };
}

/**
 * Rect fully inside the zone polygon? All four corners are pulled TOL_E toward the
 * rect centre before the point-in-polygon test, so rects exactly touching a wall
 * (wall-flush furniture, movement bands of flush items) count as inside.
 * @param {{x:number,y:number,w:number,h:number}} rect metres
 * @param {Array<{x:number,z:number}>} points zone polygon
 * @param {number} [tolE] corner inset in metres
 * @returns {boolean}
 */
function rectInPolygon(rect, points, tolE = TOL_BAND) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const ecken = [
    [rect.x, rect.y], [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h],
  ];
  return ecken.every(([ex, ey]) => {
    const ix = ex + Math.sign(cx - ex) * Math.min(tolE, rect.w / 4);
    const iy = ey + Math.sign(cy - ey) * Math.min(tolE, rect.h / 4);
    return punktImPolygon(ix, iy, points);
  });
}

/**
 * Item body inside the room with wall tolerance (see TOL_RAUM): the rect is shrunk by
 * tol from every side before the corner test — flush-at-wall items pass, items really
 * hanging over the border (> tol) fail.
 * @param {{typ:string,x:number,y:number,rot?:number}} item
 * @param {Array<{x:number,z:number}>} points zone polygon
 * @param {number} [tol] metres
 * @returns {boolean}
 */
export function imRaumTolerant(item, points, tol = TOL_RAUM) {
  const r = itemRect(item);
  if (r.w <= 2 * tol || r.h <= 2 * tol) return imRaum(item, points); // degenerate → strict
  return rectInPolygon({ x: r.x + tol, y: r.y + tol, w: r.w - 2 * tol, h: r.h - 2 * tol }, points, 0);
}

// ---- Bewegungsflächen ------------------------------------------------------------------------

/**
 * Movement-area depth (metres) of one side definition per level (75-09, Blatt 07 +
 * DIN 18040-2): role "haupt" → the level depth from accessibility.bewegungsflaeche
 * (B 1,20 / R 1,50 m); role "fest" → always the Blatt-07 standard value (e.g. dining
 * table side seats stay 0,80 m at every level).
 * @param {{rolle?:string, standard:number}} seiteDef side definition from bewegung.seiten
 * @param {string} [stufe] "standard" | "B" | "R"
 * @returns {number} depth in metres
 */
export function bewegungTiefe(seiteDef, stufe = STUFE_DEFAULT) {
  const std = Number(seiteDef?.standard) || 0;
  if (seiteDef?.rolle === "haupt" && (stufe === "B" || stufe === "R")) return bewegungsflaeche(stufe);
  return std;
}

/**
 * Round a metre value to 1e-12 — kills binary float noise (e.g. 2 − 0.9 − 0.9 =
 * 0.20000000000000007) so callers/tests can compare movement rects literally. Far below
 * any furniture resolution (grid 0.05 m), far above Number.EPSILON.
 * @param {number} v metres
 * @returns {number} metres
 */
const r12 = (v) => Math.round(v * 1e12) / 1e12;

/**
 * All movement-area rects of an item (metres), attached to the body over the FULL edge
 * length of their side, in world direction per SEITE_RICHTUNG (identical to the
 * bewegungsflaecheRect convention for "vorn").
 * Types WITHOUT a bewegung field fall back to the ASR A1.2 user-side band of moebel.js
 * (1,00 m standard, level B/R via bewegungsflaecheRect) when they have benutzerseite;
 * types without benutzerseite (and unknown types) have none.
 * @param {{typ:string,x:number,y:number,rot?:number}} item furniture item (centre in m)
 * @param {string} [stufe] "standard" | "B" | "R"
 * @returns {Array<{x:number,y:number,w:number,h:number,seite:string,tiefe:number}>} rects in m
 */
export function bewegungsflaechen(item, stufe = STUFE_DEFAULT) {
  const typ = moebelById(item?.typ);
  if (!typ) return [];
  const seiten = typ.bewegung?.seiten;
  if (!Array.isArray(seiten) || !seiten.length) {
    // Fallback: ASR user-side band (existing office catalogue types). stufe "standard"
    // passes undefined so bewegungsflaecheRect stays byte-identical (moebel.js contract).
    if (!typ.benutzerseite) return [];
    const rect = bewegungsflaecheRect(item, stufe === "B" || stufe === "R" ? stufe : undefined);
    if (!rect) return [];
    const rot = [0, 90, 180, 270].includes(item?.rot) ? item.rot : 0;
    const tiefe = rot === 90 || rot === 270 ? rect.w : rect.h;
    return [{ x: r12(rect.x), y: r12(rect.y), w: r12(rect.w), h: r12(rect.h), seite: "vorn", tiefe }];
  }
  const r = itemRect(item);
  const out = [];
  for (const sd of seiten) {
    const tiefe = bewegungTiefe(sd, stufe);
    if (!(tiefe > 0)) continue;
    const d = seitenVec(item, sd.seite);
    // Rect adjoining the body edge in direction d over the full edge length.
    const rect = d.y === 1
      ? { x: r.x, y: r.y + r.h, w: r.w, h: tiefe }              // +y (below the body)
      : d.y === -1
        ? { x: r.x, y: r.y - tiefe, w: r.w, h: tiefe }          // −y (above the body)
        : d.x === -1
          ? { x: r.x - tiefe, y: r.y, w: tiefe, h: r.h }        // −x (left of the body)
          : { x: r.x + r.w, y: r.y, w: tiefe, h: r.h };         // +x (right of the body)
    out.push({ x: r12(rect.x), y: r12(rect.y), w: r12(rect.w), h: r12(rect.h), seite: sd.seite, tiefe });
  }
  return out;
}

// ---- Türen (MSB-14) ----------------------------------------------------------------------------

/**
 * Door-swing geometry of a door item (metres): hinge, closed leaf end, open leaf end,
 * the 90° arc as a 9-point polyline (like MoebelDraufsicht.tuerBogen — no SVG arc flags)
 * and the swing bounding box. The door line is the item's b-edge through its centre;
 * the swing goes to the item's FRONT side (SEITE_RICHTUNG.vorn); hinge at the LEFT end
 * for aufschlag "links" (default) / RIGHT end for "rechts" — “left/right” as seen in
 * swing direction (Blatt 07 :193 „Aufschlag 90°").
 * @param {{typ:string,x:number,y:number,rot?:number,aufschlag?:string}} item door item (centre in m)
 * @returns {{scharnier:{x:number,y:number}, geschlossen:{x:number,y:number},
 *   offen:{x:number,y:number}, bogen:Array<{x:number,y:number}>,
 *   aabb:{x:number,y:number,w:number,h:number}, radius:number}|null} null for non-door types
 */
export function tuerAufschlag(item) {
  const typ = moebelById(item?.typ);
  if (!typ?.tuer) return null;
  // Swing radius = b = raw-opening width (Rohbaumaß, D-P75-09-A) — a few cm larger than
  // the clear width tuer.lichte_m, i.e. the conservative (larger) swing envelope.
  const b = typ.b;
  const rot = [0, 90, 180, 270].includes(item?.rot) ? item.rot : 0;
  const cx = Number(item?.x) || 0, cy = Number(item?.y) || 0;
  // World direction of the item's local +x axis (the b axis) at this rotation:
  // rot 0 → +x, 90 → +y, 180 → −x, 270 → −y (same frame mapping as SEITE_RICHTUNG).
  const bDir = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][rot / 90];
  const links = (item?.aufschlag || "links") !== "rechts";
  const scharnier = { x: cx - bDir.x * (b / 2) * (links ? 1 : -1), y: cy - bDir.y * (b / 2) * (links ? 1 : -1) };
  const geschlossen = { x: 2 * cx - scharnier.x, y: 2 * cy - scharnier.y };
  const vorn = dirVec(SEITE_RICHTUNG[rot].vorn);
  const offen = { x: scharnier.x + vorn.x * b, y: scharnier.y + vorn.y * b };
  // 90° arc, 9 points from the closed to the open leaf end (shortest rotation sense).
  const a0 = Math.atan2(geschlossen.y - scharnier.y, geschlossen.x - scharnier.x);
  const a1 = Math.atan2(offen.y - scharnier.y, offen.x - scharnier.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const bogen = [];
  for (let i = 0; i <= 8; i++) {
    const a = a0 + (delta * i) / 8;
    bogen.push({ x: scharnier.x + Math.cos(a) * b, y: scharnier.y + Math.sin(a) * b });
  }
  // Bounding box over hinge, closed AND open leaf end — the quarter arc stays inside
  // these three points (convexity of the 90° sector).
  const xs = [scharnier.x, geschlossen.x, offen.x];
  const ys = [scharnier.y, geschlossen.y, offen.y];
  const aabb = {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  };
  return { scharnier, geschlossen, offen, bogen, aabb, radius: b };
}

/**
 * Exact rect-vs-quarter-disc hit test for a door swing (metres).
 * PROOF: the swing is the quarter disc {p : |p − hinge| ≤ r} ∩ aabb — inside the hinge's
 * quadrant box the circle arc bounds exactly that point set, because the arc spans the
 * full 90° between the two aabb sides through the closed/open leaf ends. So: rect hits
 * the swing ⟺ rect ∩ aabb ≠ ∅ AND the rect point closest to the hinge is within r.
 * @param {{x:number,y:number,w:number,h:number}} rect metres
 * @param {{scharnier:{x:number,y:number}, aabb:{x:number,y:number,w:number,h:number}, radius:number}} aufschlag from tuerAufschlag
 * @returns {boolean}
 */
export function rechteckTrifftAufschlag(rect, aufschlag) {
  if (!rect || !aufschlag) return false;
  if (!rechteckeUeberlappen(rect, aufschlag.aabb)) return false;
  const s = aufschlag.scharnier;
  // Clamp the hinge into the rect → the rect's closest point to the hinge.
  const px = Math.max(rect.x, Math.min(s.x, rect.x + rect.w));
  const py = Math.max(rect.y, Math.min(s.y, rect.y + rect.h));
  return Math.hypot(px - s.x, py - s.y) < aufschlag.radius;
}

// ---- Fenster ----------------------------------------------------------------------------------

/**
 * Window segments only (input = output of raumOeffnungen.oeffnungenAmRaum; doors and
 * other kinds are dropped — the focus furniture rules apply to windows only, MSB-13).
 * @param {Array<{kind:string,a:{x:number,z:number},b:{x:number,z:number}}>} oeffnungen
 * @returns {Array<{a:{x:number,z:number},b:{x:number,z:number}}>}
 */
export function fensterSegmente(oeffnungen) {
  return (oeffnungen || []).filter((o) => o?.kind === "window").map((o) => ({ a: o.a, b: o.b }));
}

// ---- Sperrende Kollision (nur Fokus-UI; ASR/Innenausbau bleiben warn) ---------------------------

/**
 * Why a candidate move/rotate/insert is BLOCKED in the apartment focus (Blatt 07 :198
 * „blockiert = setzt nicht"), or null when the candidate is valid. Check order (plan):
 * 1. "tuer_nicht_an_wand" — a door whose centre line is farther than 0.15 m [ASSUMED]
 *    from every polygon edge (a door belongs into a wall, not into the room).
 * 2. "ausserhalb" — a NON-door body not inside the room (walls belong to the massing;
 *    the focus never moves them).
 * 3. "kollision" — body overlap with another item (same id exempt: the moved item's own
 *    previous position is part of `items`).
 * 4. "vor_fenster" — a type with rule "nicht_vor_fenster" (wardrobe, Blatt 07 :186)
 *    closer than 0.10 m [ASSUMED] to a window segment.
 * NOTE: blocking is a FOCUS-UI decision only — kollisionsWarnungen/moebelChecks (ASR,
 * interior fit-out) keep warning instead of blocking (liability: warn, never fail).
 * @param {Array<object>} items existing items of the zone (may contain the candidate's old state)
 * @param {{id:string,typ:string,x:number,y:number,rot?:number}} candidate item (centre in m)
 * @param {Array<{x:number,z:number}>} polygon zone points (metres)
 * @param {{fenster?:Array<{a:{x:number,z:number},b:{x:number,z:number}}>}} [opt] window segments
 * @returns {null|{grund:"tuer_nicht_an_wand"|"ausserhalb"|"kollision"|"vor_fenster", mitId?:string, text:string}}
 */
export function sperrGrund(items, kandidat, polygon, { fenster = [] } = {}) {
  const typ = moebelById(kandidat?.typ);
  if (!typ) return null; // unknown type → drawing skips it anyway (T-75-09-02)
  const name = typ.name || kandidat.typ;
  const istTuer = !!typ.tuer;

  // 1. door on a wall? Centre line (the b-edge through the centre) near any polygon edge.
  if (istTuer) {
    const b = typ.b;
    const rot = [0, 90, 180, 270].includes(kandidat.rot) ? kandidat.rot : 0;
    const horizontal = rot === 0 || rot === 180;
    const l1 = horizontal
      ? { x: kandidat.x - b / 2, y: kandidat.y } : { x: kandidat.x, y: kandidat.y - b / 2 };
    const l2 = horizontal
      ? { x: kandidat.x + b / 2, y: kandidat.y } : { x: kandidat.x, y: kandidat.y + b / 2 };
    const pts = polygon || [];
    // [ASSUMED] 0.15 m max distance door line → wall edge (half of a 24 cm interior
    // wall + tolerance; user feedback may tighten this).
    const anWand = pts.some((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return distSegmentSegment(l1, l2, { x: p.x, y: p.z }, { x: q.x, y: q.z }) <= 0.15;
    });
    if (!anWand) {
      return { grund: "tuer_nicht_an_wand", text: "Türen müssen an einer Wand liegen (max. 0,15 m Abstand)." };
    }
  }

  // 2. body inside the room? (doors exempt — they sit half in the wall by design)
  if (!istTuer && polygon?.length >= 3 && !imRaumTolerant(kandidat, polygon)) {
    return { grund: "ausserhalb", text: `${name} ragt aus dem Raum heraus.` };
  }

  // 3. body collision (same id = the item's own previous state → never a conflict)
  for (const it of items || []) {
    if (!it || it.id === kandidat.id) continue;
    if (kollidiert(kandidat, it)) {
      const nameMit = moebelById(it.typ)?.name || it.typ;
      return { grund: "kollision", mitId: it.id, text: `${name} würde ${nameMit} überlappen.` };
    }
  }

  // 4. wardrobe (etc.) in front of a window? Blatt 07 :186 „nicht vor Fenster".
  if ((typ.regeln || []).includes("nicht_vor_fenster") && (fenster || []).length) {
    const r = itemRect(kandidat);
    const zu = Math.min(...fenster.map((f) => distRectZuSegment(r, f)));
    if (zu < 0.1) { // [ASSUMED] 0.10 m min distance body → window segment
      return { grund: "vor_fenster", text: `${name} steht vor einem Fenster.` };
    }
  }
  return null;
}

/**
 * Boolean form of sperrGrund — true when the focus UI must reject the candidate.
 * @param {Array<object>} items
 * @param {object} kandidat
 * @param {Array<{x:number,z:number}>} polygon
 * @param {{fenster?:Array}} [opt]
 * @returns {boolean}
 */
export function kollisionSperrend(items, kandidat, polygon, opt) {
  return sperrGrund(items, kandidat, polygon, opt) !== null;
}

/**
 * Snap a non-door item flush to a nearby wall (Blatt 07 :198 „Einrasten an Wand,
 * Rückseite bündig"): when a body edge is closer than fangM to a room edge of an
 * axis-parallel rectangular room, move the body flush; then snap to MOEBEL_RASTER.
 * Doors are never moved (they belong to their wall opening). Non-rect rooms return
 * the item unchanged (no bbox semantics there).
 * @param {{typ:string,x:number,y:number,rot?:number}} item candidate (centre in m)
 * @param {Array<{x:number,z:number}>} polygon zone points
 * @param {number} [fangM=0.15] catch distance in metres [ASSUMED — user feedback]
 * @returns {{typ:string,x:number,y:number,rot?:number}} snapped COPY (centre in m, grid-snapped)
 */
export function anWandEinrasten(item, polygon, fangM = 0.15) {
  if (moebelById(item?.typ)?.tuer) return item; // doors stay where they are
  const pts4 = (polygon || []).map((p) => ({ x: p.x, y: p.z }));
  if (!istAchsparallelesRechteck(pts4)) return item;
  const bb = bboxAusPolygon(polygon);
  if (!bb) return item;
  const { w, h } = itemAusdehnung(item);
  let cx = Number(item.x) || 0, cy = Number(item.y) || 0;
  // One snap per axis; when both edges of an axis are within fangM (room barely wider
  // than the body) the near-side order N/S then W/O decides — deterministic.
  if (Math.abs(cy - h / 2 - bb.y0) < fangM) cy = bb.y0 + h / 2;
  else if (Math.abs(cy + h / 2 - bb.y1) < fangM) cy = bb.y1 - h / 2;
  if (Math.abs(cx - w / 2 - bb.x0) < fangM) cx = bb.x0 + w / 2;
  else if (Math.abs(cx + w / 2 - bb.x1) < fangM) cx = bb.x1 - w / 2;
  return { ...item, x: snapRaster(cx), y: snapRaster(cy) };
}

// ---- Checks (warn, nie fail) ---------------------------------------------------------------------

const de2 = (n) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STUFEN_LABEL = { standard: "Standard", B: "B", R: "R" };

/**
 * Apartment-focus checks for one room — like moebelChecks (moebel.js) these are WARNINGS
 * only, never "fail" (liability decision, KD-14 convention: the tool advises, the
 * planner decides). Additions over moebelChecks (Blatt 07 :196-199): movement bands per
 * level, door swings (MSB-14), the window rule, and the Blatt-07 exception that TWO
 * MOVEMENT AREAS MAY OVERLAP EACH OTHER (:199 — you never stand everywhere at once),
 * so band-vs-band is NOT a warning. Items with rule "in_bewegungsflaeche_ok" (night
 * table, coffee table, dining tables — low/thin furniture [ASSUMED]) may stand inside
 * foreign movement areas without warning.
 * @param {Array<object>} items zone items (metres)
 * @param {Array<{x:number,z:number}>} polygon zone points
 * @param {string} [stufe] "standard" | "B" | "R"
 * @param {{fenster?:Array<{a:{x:number,z:number},b:{x:number,z:number}}>}} [opt]
 * @returns {Array<{status:"warn", itemId:string, art:string, text:string}>}
 */
export function wohnMoebelChecks(items, polygon, stufe = STUFE_DEFAULT, { fenster = [] } = {}) {
  const liste = (items || []).filter((it) => it && moebelById(it.typ)); // T-75-09-02: skip junk
  const warnungen = [];
  const stufenText = STUFEN_LABEL[stufe] || STUFEN_LABEL.standard;
  const bands = new Map(liste.map((it) => [it.id, bewegungsflaechen(it, stufe)]));
  const aufschlaege = liste.map((it) => ({ it, a: tuerAufschlag(it) })).filter((x) => x.a);

  for (const it of liste) {
    const typ = moebelById(it.typ);
    const name = typ.name || it.typ;
    const body = itemRect(it);

    // Body outside the room (wall-flush stays legal, see imRaumTolerant). Doors are
    // exempt like in sperrGrund: their symbol straddles the wall line by design.
    if (!typ.tuer && polygon?.length >= 3 && !imRaumTolerant(it, polygon)) {
      warnungen.push({ status: "warn", itemId: it.id, art: "ausserhalb", text: `${name} ragt aus dem Raum heraus.` });
    }
    // Wardrobe etc. in front of a window (Blatt 07 :186).
    if ((typ.regeln || []).includes("nicht_vor_fenster")) {
      for (const f of fenster || []) {
        if (distRectZuSegment(body, f) < 0.1) { // [ASSUMED] 0.10 m wie sperrGrund
          warnungen.push({ status: "warn", itemId: it.id, art: "fenster", text: `${name} steht vor einem Fenster.` });
          break;
        }
      }
    }
    // Standing in a FOREIGN movement area (exempt types may — low furniture).
    if (!hatRegel(it, "in_bewegungsflaeche_ok")) {
      for (const other of liste) {
        if (other.id === it.id) continue;
        const band = (bands.get(other.id) || []).find((b) => bandTrifftKoerper(b, body));
        if (band) {
          const nameOther = moebelById(other.typ)?.name || other.typ;
          warnungen.push({
            status: "warn", itemId: it.id, art: "bewegungsflaeche",
            text: `${name} steht in der Bewegungsfläche von ${nameOther} (${de2(band.tiefe)} m, Stufe ${stufenText}).`,
          });
        }
      }
    }
    // Own movement areas must stay inside the room (Blatt 07 :199: overlapping a WALL
    // means “too tight”; overlapping another AREA is fine and stays unreported).
    for (const b of bands.get(it.id) || []) {
      if (polygon?.length >= 3 && !rectInPolygon(b, polygon)) {
        warnungen.push({
          status: "warn", itemId: it.id, art: "wand",
          text: `Bewegungsfläche vor ${name} reicht über die Wand.`,
        });
        break; // one warning per item is enough
      }
    }
  }

  // Door swings (MSB-14, Blatt 07 :193 „Aufschlag darf keine Bewegungsfläche schneiden"):
  // swing vs furniture bodies and vs foreign movement areas.
  for (const { it: tuer, a } of aufschlaege) {
    const nameTuer = moebelById(tuer.typ)?.name || tuer.typ;
    for (const other of liste) {
      if (other.id === tuer.id) continue;
      const nameOther = moebelById(other.typ)?.name || other.typ;
      if (rechteckTrifftAufschlag(itemRect(other), a)) {
        warnungen.push({
          status: "warn", itemId: tuer.id, art: "tuer_moebel",
          text: `Türaufschlag von ${nameTuer} trifft ${nameOther}.`,
        });
      }
      for (const b of bands.get(other.id) || []) {
        if (rechteckTrifftAufschlag(b, a)) {
          warnungen.push({
            status: "warn", itemId: tuer.id, art: "tuer_bewegung",
            text: `Türaufschlag von ${nameTuer} schneidet die Bewegungsfläche von ${nameOther}.`,
          });
          break;
        }
      }
    }
  }
  return warnungen;
}

/**
 * Movement-area compliance count over several rooms (focus KPI, Blatt 07 :201
 * „Bewegungsflächen-Nachweis DIN 18040-2"): how many areas exist, how many are free
 * of conflicts, and the conflicts themselves. A band conflicts when a non-exempt
 * foreign body overlaps it, it reaches over a wall, or a door swing cuts it.
 * @param {Array<{zone:{name?:string,points:Array<{x:number,z:number}>}, items:Array<object>, fenster?:Array}>} raeume
 * @param {string} [stufe] "standard" | "B" | "R"
 * @returns {{anzahl:number, frei:number, konflikte:Array<{raum:string,itemId:string,text:string}>}}
 */
export function bewegungsNachweis(raeume, stufe = STUFE_DEFAULT) {
  let anzahl = 0;
  const konflikte = [];
  const konfliktBands = new Set();
  for (const raum of raeume || []) {
    const zone = raum?.zone;
    const items = (raum?.items || []).filter((it) => it && moebelById(it.typ));
    const raumName = kurzRaumname(zone?.name || "");
    const polygon = zone?.points;
    const bands = new Map(items.map((it) => [it.id, bewegungsflaechen(it, stufe)]));
    for (const it of items) {
      const name = moebelById(it.typ)?.name || it.typ;
      for (const b of bands.get(it.id) || []) {
        anzahl++;
        const key = `${raumName}#${it.id}#${b.seite}`;
        const merken = (text) => {
          if (!konfliktBands.has(key)) {
            konfliktBands.add(key);
            konflikte.push({ raum: raumName, itemId: it.id, text });
          }
        };
        // Foreign body inside the band (exempt low furniture doesn't count, Blatt 07).
        for (const other of items) {
          if (other.id === it.id || hatRegel(other, "in_bewegungsflaeche_ok")) continue;
          if (bandTrifftKoerper(b, itemRect(other))) {
            merken(`Bewegungsfläche vor ${name}: ${moebelById(other.typ)?.name || other.typ} steht darin.`);
          }
        }
        // Band over the wall.
        if (polygon?.length >= 3 && !rectInPolygon(b, polygon)) {
          merken(`Bewegungsfläche vor ${name} reicht über die Wand.`);
        }
        // Door swing cutting the band.
        for (const other of items) {
          if (other.id === it.id) continue;
          const a = tuerAufschlag(other);
          if (a && rechteckTrifftAufschlag(b, a)) {
            merken(`Türaufschlag von ${moebelById(other.typ)?.name || other.typ} schneidet die Bewegungsfläche vor ${name}.`);
          }
        }
      }
    }
  }
  return { anzahl, frei: anzahl - konfliktBands.size, konflikte };
}

// ---- Klassifikation -----------------------------------------------------------------------------

/**
 * Room type for auto-furnishing (plan deviation 5): zone.art alone does NOT separate
 * sleeping from living — the presets file „Schlafen", „Wohnen/Essen" and „Kind/Büro"
 * all under ART.aufenthalt (wohnungsTypen.js:49-55) — so classify via art AND the short
 * room name. [ASSUMED] keyword lists; unrecognised aufenthalt rooms get NO furniture
 * (null) rather than guessed inventory.
 * @param {{name?:string, art?:string, raumart?:string}} zone
 * @returns {"schlafen"|"wohnen"|"kind"|"kueche"|"bad"|null}
 */
export function raumTypFuer(zone) {
  const art = zone?.art;
  if (art === "kueche") return "kueche";
  if (art === "sanitaer") return "bad";
  if (art === "flur" || art === "abstell" || zone?.raumart === "flur") return null;
  if (art !== "aufenthalt") return null;
  const n = kurzRaumname(zone?.name || "").toLowerCase();
  if (n.includes("schlaf")) return "schlafen";
  if (n.includes("kind") || n.includes("büro") || n.includes("buero")) return "kind";
  if (n.includes("wohn") || n.includes("ess")) return "wohnen";
  return null;
}

/**
 * Occupant count of a unit-type entry (plan deviation 6 — there is no `personen` field):
 * read „/nP" from the type name (e.g. „3-Zi/3P"), else the `zimmer` count, else 2.
 * [ASSUMED] fallback 2 (two-person household is the planning default here).
 * @param {{name?:string, zimmer?:number}|null|undefined} eintrag unit-type entry
 * @returns {number} persons (≥ 1)
 */
export function personenFuerTyp(eintrag) {
  const m = /\/(\d+)\s*P\b/i.exec(String(eintrag?.name || ""));
  if (m) return Math.max(1, Number(m[1]));
  const z = Number(eintrag?.zimmer);
  if (Number.isFinite(z) && z > 0) return Math.max(1, Math.round(z));
  return 2;
}

// ---- Platzierung (Auto-Möblierung) ----------------------------------------------------------------

// [ASSUMED] 5 cm gap between night table and bed body — one raster cell; keeps the
// strict AABB test green (edge-touching would be fine too, but snapping could push the
// table INTO the bed, see 75-09 dev notes).
const ABSTAND_NACHTTISCH = 0.05;
// [ASSUMED] 0.40 m between sofa front edge and coffee table (Blatt 07 gives no value;
// reach distance from the seat is the usual planning rule).
const ABSTAND_COUCHTISCH = 0.4;
// [ASSUMED] dining-table grid 0.10 m, max 4000 candidates (DoS guard T-75-09-02).
const TISCH_RASTER = 0.1;
const TISCH_MAX_KANDIDATEN = 4000;

/**
 * Is a candidate placement valid? (plan Task 1): sperrGrund null AND all own movement
 * areas inside the room AND own areas do not hit a FOREIGN BODY (exempt low furniture
 * skipped) AND foreign areas/door swings do not hit the new body (skipped entirely when
 * the new type itself is exempt — a coffee table may live inside the sofa's area).
 * @param {object} kandidat
 * @param {Array<object>} items existing items
 * @param {Array<{x:number,z:number}>} polygon
 * @param {{stufe?:string, fenster?:Array}} [opt]
 * @returns {boolean}
 */
function gueltig(kandidat, items, polygon, { stufe = STUFE_DEFAULT, fenster = [] } = {}) {
  if (sperrGrund(items, kandidat, polygon, { fenster }) !== null) return false;
  const eigene = bewegungsflaechen(kandidat, stufe);
  for (const b of eigene) {
    if (!rectInPolygon(b, polygon)) return false;
  }
  const neuBefreit = hatRegel(kandidat, "in_bewegungsflaeche_ok");
  const bodyNeu = itemRect(kandidat);
  for (const other of items || []) {
    if (!other || other.id === kandidat.id || !moebelById(other.typ)) continue;
    if (!hatRegel(other, "in_bewegungsflaeche_ok")) {
      // Own bands must stay clear of regular furniture bodies.
      if (eigene.some((b) => rechteckeUeberlappen(b, itemRect(other)))) return false;
    }
    if (!neuBefreit) {
      // Foreign bands / door swings must stay clear of the new body.
      if (bewegungsflaechen(other, stufe).some((b) => rechteckeUeberlappen(b, bodyNeu))) return false;
      const a = tuerAufschlag(other);
      if (a && rechteckTrifftAufschlag(bodyNeu, a)) return false;
    }
  }
  return true;
}

/**
 * Wall ids and their item rotation (back AGAINST the wall): N = ymin (rot 0, hinten −y),
 * O = xmax (rot 90, hinten +x), S = ymax (rot 180, hinten +y), W = xmin (rot 270, hinten −x).
 */
const WAND_ROT = { N: 0, O: 90, S: 180, W: 270 };
const WAND_GEGENUEBER = { N: "S", S: "N", O: "W", W: "O" };

/**
 * Ordered wall list of a rectangular room: longer walls first (tie-break N, O, S, W per
 * plan), walls carrying window segments LAST (wardrobes/beds avoid windows, Blatt 07
 * :186); when `bezug` names a wall (e.g. the bed's wall), its OPPOSITE wall moves to the
 * front (plan: wardrobe “gegenüber” the bed).
 * @param {{x0:number,y0:number,x1:number,y1:number}} bb room bbox in m
 * @param {Array<{a:{x:number,z:number},b:{x:number,z:number}}>} fenster window segments
 * @param {string|null} [bezug] wall id ("N"|"O"|"S"|"W") to place opposite of
 * @returns {Array<{wand:string, rot:number, laenge:number, entlang:"x"|"y"}>}
 */
function wandReihenfolge(bb, fenster, bezug = null) {
  const fensterAn = (wand) => (fenster || []).some((f) => {
    const eps = 0.05; // [ASSUMED] segment near the wall line counts as “on” that wall
    switch (wand) {
      case "N": return Math.abs(f.a.z - bb.y0) < eps && Math.abs(f.b.z - bb.y0) < eps;
      case "S": return Math.abs(f.a.z - bb.y1) < eps && Math.abs(f.b.z - bb.y1) < eps;
      case "W": return Math.abs(f.a.x - bb.x0) < eps && Math.abs(f.b.x - bb.x0) < eps;
      default:  return Math.abs(f.a.x - bb.x1) < eps && Math.abs(f.b.x - bb.x1) < eps;
    }
  });
  const reihen = { N: 0, O: 1, S: 2, W: 3 }; // plan tie-break order
  const waende = [
    { wand: "N", rot: 0, laenge: bb.x1 - bb.x0, entlang: "x" },
    { wand: "S", rot: 180, laenge: bb.x1 - bb.x0, entlang: "x" },
    { wand: "O", rot: 90, laenge: bb.y1 - bb.y0, entlang: "y" },
    { wand: "W", rot: 270, laenge: bb.y1 - bb.y0, entlang: "y" },
  ];
  waende.sort((a, b) => {
    const fa = fensterAn(a.wand) ? 1 : 0, fb = fensterAn(b.wand) ? 1 : 0;
    if (fa !== fb) return fa - fb;                       // window walls last
    if (b.laenge !== a.laenge) return b.laenge - a.laenge; // longer walls first
    return reihen[a.wand] - reihen[b.wand];              // tie: N, O, S, W
  });
  if (bezug && WAND_GEGENUEBER[bezug]) {
    const ziel = WAND_GEGENUEBER[bezug];
    const i = waende.findIndex((w) => w.wand === ziel);
    if (i > 0) waende.unshift(...waende.splice(i, 1));
  }
  return waende;
}

/**
 * Centre of an item with its BACK flush against a wall, at one of three along-wall
 * positions (plan cascade: Mitte → bündig links → bündig rechts; “links” = the smaller
 * coordinate end [ASSUMED]). Flush coordinates are NOT grid-snapped — snapping would
 * break exact bündigkeit when walls are off-grid (deviation noted in the SUMMARY);
 * the Mitte position is snapped. clampInBbox keeps border-coincident edges legal.
 * @param {string} wand
 * @param {number} rot
 * @param {"x"|"y"} entlang
 * @param {{x0:number,y0:number,x1:number,y1:number}} bb
 * @param {{b:number,t:number}} masse type dims in m
 * @param {"mitte"|"links"|"rechts"} pos
 * @returns {{x:number,y:number,rot:number}}
 */
function wandKandidat(wand, rot, entlang, bb, masse, pos) {
  const { b, t } = masse;
  const min = entlang === "x" ? bb.x0 : bb.y0;
  const max = entlang === "x" ? bb.x1 : bb.y1;
  let along = pos === "mitte" ? snapRaster((min + max) / 2) : pos === "links" ? min + b / 2 : max - b / 2;
  along = Math.max(min + b / 2, Math.min(max - b / 2, along)); // wall shorter than body → clamped
  const flush = { N: bb.y0 + t / 2, S: bb.y1 - t / 2, W: bb.x0 + t / 2, O: bb.x1 - t / 2 }[wand];
  const mitte = entlang === "x" ? { x: along, y: flush } : { x: flush, y: along };
  const gedreht = rot === 90 || rot === 270;
  const sicher = clampInBbox(mitte, { w: gedreht ? t : b, h: gedreht ? b : t }, bb);
  return { x: sicher.x, y: sicher.y, rot };
}

/**
 * Place one furniture type into a zone — deterministic candidate cascade, the FIRST
 * valid candidate wins (plan Task 1):
 * - wall furniture (beds, wardrobes, sofa, kitchen counter, desk): walls long→short
 *   (window walls last, `bezug`'s opposite first), per wall Mitte → flush left → flush
 *   right, back against the wall;
 * - night table: left/right beside the bed head, same rotation (needs a bed in `items`);
 * - coffee table: 0.40 m in front of the sofa's front edge, centred (needs the sofa);
 * - dining tables: 0.10 m grid over the room sorted by distance to the room centre
 *   (≤ 4000 candidates, DoS guard);
 * - doors: null — use platziereTuer.
 * @param {{points:Array<{x:number,z:number}>, name?:string, level?:number}} zone
 * @param {Array<object>} items existing items of the zone
 * @param {string} typId catalogue id (WOHN_GRUPPE or MOEBEL_KATALOG)
 * @param {{stufe?:string, fenster?:Array, idPrefix?:string, nr?:number|string, bezug?:string|null}} [opt]
 *   idPrefix+nr build the item id (`${idPrefix}${nr}`); bezug = wall id to place opposite of
 * @returns {object|null} placed item {id, typ, x, y, rot} or null (no valid spot)
 */
export function platziereTyp(zone, items, typId, { stufe = STUFE_DEFAULT, fenster = [], idPrefix = "", nr = 1, bezug = null } = {}) {
  const typ = moebelById(typId);
  const polygon = zone?.points;
  if (!typ || !polygon || polygon.length < 3 || typ.tuer) return null;
  const bb = bboxAusPolygon(polygon);
  if (!bb) return null;
  const id = `${idPrefix}${nr}`;
  const opt = { stufe, fenster };
  const basis = { id, typ: typId, rot: 0 };
  const versuch = (x, y, rot) => {
    const k = { ...basis, x, y, rot };
    return gueltig(k, items, polygon, opt) ? k : null;
  };

  // Relative placements first (night table beside the bed, coffee table before the sofa).
  if (typId === "nachttisch") {
    const bett = (items || []).find((it) => it.typ === "doppelbett" || it.typ === "einzelbett");
    if (bett) {
      const bt = moebelById(bett.typ);
      const rot = [0, 90, 180, 270].includes(bett.rot) ? bett.rot : 0;
      const hinten = dirVec(SEITE_RICHTUNG[rot].hinten);     // head direction
      const seitlich = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][rot / 90]; // local +x
      const br = itemRect(bett);
      // Head offset: night tables align with the head end, not the bed centre.
      const tiefenAchse = hinten.x !== 0 ? br.w / 2 : br.h / 2; // half bed depth along hinten
      const kopf = { x: bett.x + hinten.x * tiefenAchse, y: bett.y + hinten.y * tiefenAchse };
      const seitBetrag = bt.b / 2 + ABSTAND_NACHTTISCH + typ.b / 2;
      for (const vz of [-1, 1]) { // left of the head first, then right (plan order)
        const x = kopf.x + seitlich.x * seitBetrag * vz;
        const y = kopf.y + seitlich.y * seitBetrag * vz;
        const sicher = clampInBbox({ x, y }, itemAusdehnung({ ...basis, rot }), bb);
        const k = versuch(sicher.x, sicher.y, rot);
        if (k) return k;
      }
    }
  }
  if (typId === "couchtisch") {
    const sofa = (items || []).find((it) => it.typ === "sofa_3");
    if (sofa) {
      const rot = [0, 90, 180, 270].includes(sofa.rot) ? sofa.rot : 0;
      const vorn = dirVec(SEITE_RICHTUNG[rot].vorn);
      const sr = itemRect(sofa);
      const sofaTiefe = vorn.x !== 0 ? sr.w : sr.h;
      const ctTiefe = vorn.x !== 0 ? typ.t : typ.t; // coffee table keeps its own depth
      const dist = sofaTiefe / 2 + ABSTAND_COUCHTISCH + ctTiefe / 2;
      const x = sofa.x + vorn.x * dist, y = sofa.y + vorn.y * dist;
      const sicher = clampInBbox({ x: snapRaster(x), y: snapRaster(y) }, itemAusdehnung({ ...basis, rot }), bb);
      const k = versuch(sicher.x, sicher.y, rot);
      if (k) return k;
    }
  }

  // Dining tables: grid over the room, sorted by distance to the room centre.
  if (typId === "esstisch_4" || typId === "esstisch_6") {
    const { w, h } = itemAusdehnung(basis); // rot 0
    const mitteRaum = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
    const kandidaten = [];
    for (let gx = bb.x0 + w / 2; gx <= bb.x1 - w / 2 + 1e-9; gx += TISCH_RASTER) {
      for (let gy = bb.y0 + h / 2; gy <= bb.y1 - h / 2 + 1e-9; gy += TISCH_RASTER) {
        kandidaten.push({ x: gx, y: gy });
        if (kandidaten.length >= TISCH_MAX_KANDIDATEN) break;
      }
      if (kandidaten.length >= TISCH_MAX_KANDIDATEN) break;
    }
    kandidaten.sort((p, q) =>
      (Math.hypot(p.x - mitteRaum.x, p.y - mitteRaum.y) - Math.hypot(q.x - mitteRaum.x, q.y - mitteRaum.y))
      || (p.x - q.x) || (p.y - q.y)); // deterministic tie-break
    for (const p of kandidaten) {
      const sicher = clampInBbox(p, { w, h }, bb);
      const k = versuch(sicher.x, sicher.y, 0);
      if (k) return k;
    }
    return null;
  }

  // Wall cascade (beds, wardrobes, sofa, kitchen counter, desk — everything else).
  for (const { wand, rot, entlang } of wandReihenfolge(bb, fenster, bezug)) {
    for (const pos of ["mitte", "links", "rechts"]) {
      const p = wandKandidat(wand, rot, entlang, bb, { b: typ.b, t: typ.t }, pos);
      const k = versuch(p.x, p.y, p.rot);
      if (k) return k;
    }
  }
  return null;
}

/**
 * Place a door (MSB-14): centred on the LONGEST room edge whose swing points INTO the
 * room and hits no furniture body; further edges in the same order; null when none
 * works. Doors are furniture items with `aufschlag` (plan decision — no wall openings).
 * @param {{points:Array<{x:number,z:number}>}} zone
 * @param {Array<object>} items existing items (bodies the swing must avoid)
 * @param {string} typId "tuer_885" | "tuer_1010"
 * @param {{idPrefix?:string, nr?:number|string, stufe?:string}} [opt]
 * @returns {object|null} door item {id, typ, x, y, rot, aufschlag} or null
 */
export function platziereTuer(zone, items, typId, { idPrefix = "", nr = 1, stufe = STUFE_DEFAULT } = {}) {
  const typ = moebelById(typId);
  const polygon = zone?.points;
  if (!typ?.tuer || !polygon || polygon.length < 3) return null;
  const bb = bboxAusPolygon(polygon);
  if (!bb) return null;
  const id = `${idPrefix}${nr}`;
  // Rectangular rooms: the four bbox edges, longest first (tie-break N, O, S, W as in
  // wandReihenfolge). Each edge has exactly one rotation swinging into the room.
  const kanten = [
    { wand: "N", laenge: bb.x1 - bb.x0 }, { wand: "S", laenge: bb.x1 - bb.x0 },
    { wand: "O", laenge: bb.y1 - bb.y0 }, { wand: "W", laenge: bb.y1 - bb.y0 },
  ].sort((a, b) => (b.laenge - a.laenge) || ({ N: 0, O: 1, S: 2, W: 3 })[a.wand] - ({ N: 0, O: 1, S: 2, W: 3 })[b.wand]);
  for (const { wand } of kanten) {
    const rot = WAND_ROT[wand]; // swing (vorn) points into the room for this rotation
    const entlangX = wand === "N" || wand === "S";
    // Doors sit ON the wall line: the centre line (b-edge through the centre) lies exactly
    // on the room edge, the 0.10 m symbol depth straddles the wall half/half — unlike
    // furniture, which wandKandidat flushes INTO the room by t/2.
    const along = snapRaster(entlangX ? (bb.x0 + bb.x1) / 2 : (bb.y0 + bb.y1) / 2);
    const wandLinie = { N: bb.y0, S: bb.y1, W: bb.x0, O: bb.x1 }[wand];
    const p = entlangX ? { x: along, y: wandLinie } : { x: wandLinie, y: along };
    const kandidat = { id, typ: typId, x: p.x, y: p.y, rot, aufschlag: "links" };
    if (sperrGrund(items, kandidat, polygon) !== null) continue;
    const a = tuerAufschlag(kandidat);
    const trifft = (items || []).some((it) => it && it.id !== id && moebelById(it.typ)
      && rechteckTrifftAufschlag(itemRect(it), a));
    if (!trifft) return kandidat;
  }
  return null;
}

// ---- Auto-Möblierung -----------------------------------------------------------------------------

/** Id prefix of auto-placed items — istAutoItem and the focus “remove auto” action key on it. */
export const AUTO_ID_PREFIX = "auto-";

/**
 * Was this item created by autoMoeblierung? (ids `auto-<slug>-<n>`)
 * @param {{id?:string}|null|undefined} item
 * @returns {boolean}
 */
export function istAutoItem(item) {
  return String(item?.id || "").startsWith(AUTO_ID_PREFIX);
}

// Local slug (moebel.js keeps its slug private): lower-case, ASCII-folded, dashes.
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "raum";

/**
 * Auto-furnish ONE zone deterministically (Blatt 07 :200 basic inventory per room type;
 * nothing is ever forced — what does not fit is dropped with a note, and occupied rooms
 * are NEVER overwritten). Inventory:
 *   schlafen = Doppelbett + 2 × Nachttisch + largest fitting wardrobe (300 → 100)
 *   kind     = Einzelbett + Schreibtisch 120 + largest fitting wardrobe
 *   wohnen   = Sofa 3-Sitzer + Couchtisch + Esstisch 6 P (personen ≥ 5) else 4 P
 *              (6 P does not fit → 4 P + note)
 *   kueche   = Küchenzeile 3,00 m, else the 1,80 m catalogue counter (fallback)
 *   bad/null = nothing + note (sanitary auto-furnishing is NOT part of 75-09)
 * Ids: `auto-<slug(zoneKey)>-<n>` — globally unique because MoeblierungsPlan uses
 * `it-${id}` as React key across ALL rooms.
 * @param {{points:Array<{x:number,z:number}>, name?:string, level?:number, art?:string}} zone
 * @param {{personen?:number, stufe?:string, vorhandene?:Array<object>, fenster?:Array}} [opt]
 * @returns {{items:Array<object>, hinweise:string[]}} items in m; hinweise in German
 */
export function autoMoeblierung(zone, { personen = 2, stufe = STUFE_DEFAULT, vorhandene = [], fenster = [] } = {}) {
  if ((vorhandene || []).length > 0) {
    return { items: [], hinweise: ["belegt — vorhandene Möbel werden nie überschrieben."] };
  }
  const pts = (zone?.points || []).map((p) => ({ x: p.x, y: p.z }));
  if (!istAchsparallelesRechteck(pts)) {
    return { items: [], hinweise: ["kein Rechteck — Auto-Möblierung nur für achsparallele Rechteckräume."] };
  }
  const raumTyp = raumTypFuer(zone);
  const raumName = kurzRaumname(zone?.name || "");
  if (raumTyp === null || raumTyp === "bad") {
    return {
      items: [],
      hinweise: [`${raumName}: keine Auto-Möblierung (Bad-/Sanitärräume und Flure sind nicht Teil von 75-09).`],
    };
  }

  const basis = AUTO_ID_PREFIX + slug(zoneKey(zone)) + "-";
  const items = [];
  const hinweise = [];
  let nr = 0;
  // One platziereTyp attempt per setze call; failed attempts leave the id unused (gaps
  // are fine — uniqueness is what MoeblierungsPlan's React keys need).
  const setze = (typId, opt = {}) => {
    nr += 1;
    const it = platziereTyp(zone, items, typId, { stufe, fenster, idPrefix: basis, nr, ...opt });
    if (it) items.push(it);
    return it;
  };
  const fehlt = (typId) => hinweise.push(`${moebelById(typId)?.name || typId} passt nicht in den Raum — entfällt.`);

  const schrankKaskade = (bezug) => {
    for (const s of ["schrank_300", "schrank_250", "schrank_200", "schrank_150", "schrank_100"]) {
      if (setze(s, { bezug })) return s;
    }
    hinweise.push("Kein Kleiderschrank passt in den Raum.");
    return null;
  };

  if (raumTyp === "schlafen" || raumTyp === "kind") {
    const bettTyp = raumTyp === "schlafen" ? "doppelbett" : "einzelbett";
    const bett = setze(bettTyp);
    if (!bett) fehlt(bettTyp);
    // Wardrobe opposite the bed's wall (Blatt 07: wardrobe doors swingable, “gegenüber”).
    const bettWand = bett ? wandFuerRot(bett.rot) : null;
    if (raumTyp === "kind") {
      if (!setze("schreibtisch_kind", { bezug: bettWand })) fehlt("schreibtisch_kind");
    } else {
      // Two night tables beside the head (only meaningful with a bed).
      if (bett) {
        if (!setze("nachttisch")) fehlt("nachttisch");
        if (!setze("nachttisch")) fehlt("nachttisch");
      }
    }
    schrankKaskade(bettWand);
  } else if (raumTyp === "wohnen") {
    const sofa = setze("sofa_3");
    if (!sofa) fehlt("sofa_3");
    if (sofa && !setze("couchtisch")) fehlt("couchtisch");
    // Dining table by occupant count (Blatt 07 :200 „Esstisch nach Personenzahl der WE").
    if (personen >= 5) {
      if (!setze("esstisch_6")) {
        hinweise.push("Esstisch 6 P passt nicht — Esstisch 4 P gesetzt.");
        if (!setze("esstisch_4")) fehlt("esstisch_4");
      }
    } else if (!setze("esstisch_4")) fehlt("esstisch_4");
  } else if (raumTyp === "kueche") {
    // Counter ≥ 3.00 m (Blatt 07 :189); the 1.80 m catalogue counter is the fallback.
    if (!setze("kuechenzeile_300") && !setze("kuechenzeile")) {
      hinweise.push("Keine Küchenzeile passt in den Raum.");
    }
  }
  return { items, hinweise };
}

/**
 * Wall id an item's rotation puts its BACK against (inverse of WAND_ROT) — used to give
 * the wardrobe the bed's wall as `bezug` so it prefers the opposite wall.
 * @param {number} rot 0|90|180|270
 * @returns {"N"|"O"|"S"|"W"}
 */
function wandFuerRot(rot) {
  return { 0: "N", 90: "O", 180: "S", 270: "W" }[rot] || "N";
}

// ---- Katalog für den Fokus ------------------------------------------------------------------------

/**
 * Catalogue groups for the focus furniture panel: the living group PLUS an “Eigene”
 * group when the project has custom types (same pattern as katalogMitEigenen, but the
 * office catalogue stays out of the apartment focus).
 * @param {Array<object>|null|undefined} eigene custom types (complexData.moebel_eigene)
 * @returns {Array<{gruppe:string, typen:Array<object>}>}
 */
export function fokusKatalog(eigene) {
  const liste = eigene || [];
  return liste.length ? [WOHN_GRUPPE, { gruppe: EIGENE_GRUPPE, typen: liste }] : [WOHN_GRUPPE];
}
