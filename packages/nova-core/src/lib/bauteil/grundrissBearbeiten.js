// Hand edits of drawn walls in the floor plan (Grundriss-Bedienung): what happens to the openings of a wall when one of its ends
// moves or its length is typed (part 1), dragging the selection (part 2) and the typed length of the wall chain (part 3).
// The studio (BitBimStudio) applies the result through its setters, one undo step per gesture.
//
// Rule: an opening stores its MIDDLE as `u`, metres from the wall start a along a→b (oeffnungen.js). When the start a moves, `u` is
// computed again from the NEW start so the opening keeps its place in space (projected onto the new axis); when the end b moves or the
// length changes, a stays and so does `u`. Either way the middle is then clamped into the wall: at least half the width plus the edge
// clearance OEFFNUNG_RAND_M from both ends. An opening that does not fit any more (wall shorter than width + 2 × clearance) sits in the
// wall middle — it stays in the model, the existing fit check (oeffnungPasst) reports it as before.
//
// Coordinates are plan metres {x, z}. Pure: no React, no I/O; the input records are never mutated.
import { oeffnungsMasse, OEFFNUNG_RAND_M } from "./oeffnungen.js";

/**
 * Shortest wall a hand edit may leave, in m — the same limit as the click tool and the drawing agent (zeichnenModell.js MIN_WAND_M),
 * so a drag can never produce the zero-length wall a click refuses.
 */
export const MIN_WAND_LAENGE_M = 0.05;

/** @param {number} v metres @returns {number} rounded to the millimetre (no float noise in stored walls) */
const mm = (v) => Math.round(v * 1000) / 1000;

/**
 * @typedef {{x: number, z: number}} Pkt
 * @typedef {{ok: true, wand: any, oeffnungen: any[]} | {ok: false, grund: string}} WandErgebnis
 *   oeffnungen: the changed records of the wall's openings (same order as given); grund: German sentence for the hint line
 */

/**
 * Middle of an opening clamped into a wall of length `laenge_m` (see file head).
 * @param {number} u wanted middle in m from the wall start
 * @param {number} breite_m opening width in m
 * @param {number} laenge_m wall length in m
 * @returns {number} m from the wall start, millimetre-rounded
 */
export function oeffnungInWandKlemmen(u, breite_m, laenge_m) {
  const min = breite_m / 2 + OEFFNUNG_RAND_M;
  const max = laenge_m - breite_m / 2 - OEFFNUNG_RAND_M;
  if (min > max) return mm(laenge_m / 2);
  return mm(Math.min(Math.max(u, min), max));
}

/**
 * @param {Pkt} a @param {Pkt} b
 * @returns {number} m
 */
const laenge = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * New wall with its openings carried along (shared by both edits below).
 * @param {any} wand old wall record
 * @param {Pkt} a new start @param {Pkt} b new end
 * @param {any[]} oeffnungen openings of this wall
 * @param {(o: any) => number} neuesU wanted middle of an opening on the new wall
 * @returns {WandErgebnis}
 */
function mitOeffnungen(wand, a, b, oeffnungen, neuesU) {
  const len = laenge(a, b);
  if (!(len >= MIN_WAND_LAENGE_M)) return { ok: false, grund: "Wand zu kurz – eine Wand braucht mindestens 5 cm Länge." };
  const liste = (Array.isArray(oeffnungen) ? oeffnungen : []).filter((o) => o?.wallIdx === wand._idx);
  return {
    ok: true,
    wand: { ...wand, a, b },
    oeffnungen: liste.map((o) => ({ ...o, u: oeffnungInWandKlemmen(neuesU(o), oeffnungsMasse(o).w, len) })),
  };
}

/**
 * One end of a drawn wall moves to `punkt` (grip drag). Openings keep their place in space (end a) or their distance from a (end b),
 * then are clamped (file head). A wall shorter than MIN_WAND_LAENGE_M is refused.
 * @param {any} wand wall record {a, b, _idx, ...}
 * @param {"a"|"b"} ende which end moves
 * @param {Pkt} punkt new position of that end, plan metres
 * @param {any[]} oeffnungen customWindows (only those with `wallIdx === wand._idx` are used and returned)
 * @returns {WandErgebnis}
 */
export function wandEndeVerschieben(wand, ende, punkt, oeffnungen) {
  if (!wand || !punkt || !Number.isFinite(punkt.x) || !Number.isFinite(punkt.z)) return { ok: false, grund: "Kein gültiger Punkt." };
  const p = { x: mm(punkt.x), z: mm(punkt.z) };
  const a = ende === "a" ? p : wand.a;
  const b = ende === "a" ? wand.b : p;
  const altLen = laenge(wand.a, wand.b);
  if (ende !== "a") return mitOeffnungen(wand, a, b, oeffnungen, (o) => o.u ?? altLen / 2);
  // end a: the opening middle in space on the OLD axis, projected onto the NEW axis from the NEW start
  const neuLen = laenge(a, b);
  const ax = altLen > 0 ? (wand.b.x - wand.a.x) / altLen : 0, az = altLen > 0 ? (wand.b.z - wand.a.z) / altLen : 0;
  const nx = neuLen > 0 ? (b.x - a.x) / neuLen : 0, nz = neuLen > 0 ? (b.z - a.z) / neuLen : 0;
  return mitOeffnungen(wand, a, b, oeffnungen, (o) => {
    const u = o.u ?? altLen / 2;
    const mx = wand.a.x + ax * u, mz = wand.a.z + az * u;
    return (mx - a.x) * nx + (mz - a.z) * nz;
  });
}

/**
 * Typed wall length: the start a stays, the end b moves along the wall direction. Openings keep their `u`, then are clamped.
 * @param {any} wand wall record
 * @param {number} laenge_m new length in m (at least MIN_WAND_LAENGE_M)
 * @param {any[]} oeffnungen customWindows
 * @returns {WandErgebnis}
 */
export function wandLaengeSetzen(wand, laenge_m, oeffnungen) {
  const L = Number(laenge_m);
  if (!wand || !Number.isFinite(L)) return { ok: false, grund: "Keine gültige Länge." };
  const alt = laenge(wand.a, wand.b);
  if (!(alt > 0)) return { ok: false, grund: "Wand ohne Richtung – Länge nicht änderbar." };
  const b = { x: mm(wand.a.x + ((wand.b.x - wand.a.x) / alt) * L), z: mm(wand.a.z + ((wand.b.z - wand.a.z) / alt) * L) };
  if (!(L >= MIN_WAND_LAENGE_M)) return { ok: false, grund: "Wand zu kurz – eine Wand braucht mindestens 5 cm Länge." };
  return mitOeffnungen(wand, wand.a, b, oeffnungen, (o) => o.u ?? alt / 2);
}

// ---- Door swing to the clicked side --------------------------------------------------------------------------------------------
// Wall coordinates of the door symbol (@core/lib/plan/tuerSymbol.js): +q is the +normal side n = (−dz, dx) of the direction a→b.
// `aufschlag` "innen" swings to the side `innenSeite` names; a drawn wall has no inside and counts +1 (the plan draws it so), a hull
// wall's inside is the side of the footprint centroid (innenSeiteVon).

/**
 * Which side of a hull wall is inside — the sign of n · (footprint centroid − wall middle); drawn walls have no inside (+1).
 * (Moved here from BimPlan2D.jsx so the plan symbol and the door tool read ONE rule.)
 * @param {{a: Pkt, b: Pkt}} w wall, plan metres
 * @param {Array<Pkt>|null|undefined} fp footprint, plan metres; fewer than 3 points = no inside (+1)
 * @returns {1|-1}
 */
export function innenSeiteVon(w, fp) {
  if (!Array.isArray(fp) || fp.length < 3) return 1;
  const c = fp.reduce((s, p) => ({ x: s.x + p.x / fp.length, z: s.z + p.z / fp.length }), { x: 0, z: 0 });
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
  return -dz * (c.x - mx) + dx * (c.z - mz) >= 0 ? 1 : -1;
}

/**
 * Swing of a new door so the leaf opens to the side of the wall that was clicked. A click exactly on the axis keeps the default
 * ("innen", the picture before).
 * @param {{a: Pkt, b: Pkt}} w host wall, plan metres
 * @param {Pkt} klick clicked point (raw pointer, before any snap onto the wall), plan metres
 * @param {1|-1} [innenSeite] q sign of the inside (innenSeiteVon; +1 for a drawn wall)
 * @returns {"innen"|"aussen"} value of the opening field `aufschlag`
 */
export function aufschlagZurKlickseite(w, klick, innenSeite = 1) {
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
  const q = -dz * (klick.x - w.a.x) + dx * (klick.z - w.a.z); // n · (klick − a), sign only
  if (!Number.isFinite(q) || Math.abs(q) < 1e-9) return "innen";
  return Math.sign(q) === (innenSeite < 0 ? -1 : 1) ? "innen" : "aussen";
}

// ---- Grundriss-Bedienung part 2: drag the selection ------------------------------------------------------------------------------
// The arrow tool grabs the current selection at one of its elements and moves it by the pointer offset. Walls, columns and the
// polygons (zones, slabs, roofs, with the holes of a slab) move by the full offset; an opening on a wall that moves too goes with it
// for free (it hangs on its wall by `wallIdx` + `u`); an opening whose wall stays (e.g. a door selected alone) only slides along that
// wall: the offset is projected onto the wall direction and the middle clamped like a wall-end edit (oeffnungInWandKlemmen).
// The studio computes every move from the state at the press (no creeping) and records one undo step for the whole drag.

/**
 * @typedef {{type: string, index: number, scope?: string}} AuswahlEintrag one selection entry of the studio
 * @typedef {{customWalls?: any[], customColumns?: any[], customWindows?: any[], envOpenings?: any[], customZones?: any[],
 *   customSlabs?: any[], customRoofs?: any[]}} PlanStand the drawn arrays of the studio (plan metres)
 */

/** Key of the polygon array of a selection type. */
const POLY_LISTE = Object.freeze({ zone: "customZones", slab: "customSlabs", roof: "customRoofs" });

/**
 * Host wall of an opening: a drawn wall (`wallIdx`) or, for a hull opening (scope "env"), the hull wall of its storey and edge.
 * @param {any} o opening record
 * @param {boolean} huelle true = hull opening (envOpenings)
 * @param {PlanStand} stand
 * @param {any[]} huellWaende hull walls of the building model ({level, edge, a, b})
 * @returns {{a: Pkt, b: Pkt}|null}
 */
function wirtWand(o, huelle, stand, huellWaende) {
  if (huelle) return (huellWaende || []).find((w) => w.level === o.level && w.edge === o.edge) || null;
  return (stand.customWalls || []).find((w) => w._idx === o.wallIdx) || null;
}

/**
 * Middle of an opening in plan metres (on the wall axis).
 * @param {any} o @param {{a: Pkt, b: Pkt}} w
 * @returns {Pkt}
 */
function oeffnungsPunkt(o, w) {
  const len = laenge(w.a, w.b) || 1, u = o.u ?? len / 2;
  return { x: w.a.x + ((w.b.x - w.a.x) / len) * u, z: w.a.z + ((w.b.z - w.a.z) / len) * u };
}

/**
 * The selection moved by `delta` (see section head). Pure: the arrays of `stand` are not mutated; only the arrays that change are
 * returned (as new arrays), so the caller writes exactly those.
 * @param {PlanStand} stand drawn arrays at the press
 * @param {AuswahlEintrag[]} auswahl selection
 * @param {{dx: number, dz: number}} delta offset in plan metres
 * @param {any[]} [huellWaende] hull walls (for hull openings, which slide along them)
 * @returns {PlanStand} changed arrays only, coordinates millimetre-rounded
 */
export function auswahlVerschieben(stand, auswahl, delta, huellWaende = []) {
  const dx = Number(delta?.dx) || 0, dz = Number(delta?.dz) || 0;
  /** @type {PlanStand} */
  const aus = {};
  if (!Array.isArray(auswahl) || !auswahl.length || (dx === 0 && dz === 0)) return aus;
  const ids = (/** @type {string} */ t) => new Set(auswahl.filter((m) => m.type === t).map((m) => m.index));
  const sp = (/** @type {Pkt} */ p) => ({ x: mm(p.x + dx), z: mm(p.z + dz) });
  const W = ids("wall"), C = ids("column");
  if (W.size) aus.customWalls = (stand.customWalls || []).map((w) => (W.has(w._idx) ? { ...w, a: sp(w.a), b: sp(w.b) } : w));
  if (C.size) aus.customColumns = (stand.customColumns || []).map((c) => (C.has(c._idx) ? { ...c, x: mm(c.x + dx), z: mm(c.z + dz) } : c));
  for (const [typ, key] of /** @type {Array<[string, keyof PlanStand]>} */ (Object.entries(POLY_LISTE))) {
    const P = ids(typ); if (!P.size) continue;
    aus[key] = (stand[key] || []).map((el) => (!P.has(el._idx) || !Array.isArray(el.points) ? el : {
      ...el, points: el.points.map(sp),
      ...(Array.isArray(el.oeffnungen) ? { oeffnungen: el.oeffnungen.map((/** @type {any} */ l) => ({ ...l, points: (l.points || []).map(sp) })) } : {}),
    }));
  }
  // openings whose wall does not move slide along it (the projection of the offset onto the wall direction)
  const gleiten = (/** @type {any} */ o, /** @type {boolean} */ huelle) => {
    const w = wirtWand(o, huelle, stand, huellWaende); if (!w) return o;
    const len = laenge(w.a, w.b); if (!(len > 0)) return o;
    const du = (dx * (w.b.x - w.a.x) + dz * (w.b.z - w.a.z)) / len;
    const u = oeffnungInWandKlemmen((o.u ?? len / 2) + du, oeffnungsMasse(o).w, len);
    return u === o.u ? o : { ...o, u };
  };
  const O = new Set(auswahl.filter((m) => m.type === "opening" && (m.scope || "custom") === "custom").map((m) => m.index));
  const E = new Set(auswahl.filter((m) => m.type === "opening" && m.scope === "env").map((m) => m.index));
  if (O.size && [...O].some((i) => !W.has((stand.customWindows || []).find((o) => o._idx === i)?.wallIdx))) {
    aus.customWindows = (stand.customWindows || []).map((o) => (O.has(o._idx) && !W.has(o.wallIdx) ? gleiten(o, false) : o));
  }
  if (E.size) aus.envOpenings = (stand.envOpenings || []).map((o) => (E.has(o._idx) ? gleiten(o, true) : o));
  return aus;
}

/**
 * Points of the selection a drag may snap with: wall ends, column middles, polygon corners and opening middles, plan metres.
 * @param {PlanStand} stand @param {AuswahlEintrag[]} auswahl @param {any[]} [huellWaende]
 * @returns {Pkt[]}
 */
export function auswahlPunkte(stand, auswahl, huellWaende = []) {
  /** @type {Pkt[]} */
  const pts = [];
  for (const m of auswahl || []) {
    if (m.type === "wall") { const w = (stand.customWalls || []).find((x) => x._idx === m.index); if (w) pts.push(w.a, w.b); }
    else if (m.type === "column") { const c = (stand.customColumns || []).find((x) => x._idx === m.index); if (c) pts.push({ x: c.x, z: c.z }); }
    else if (m.type === "opening") {
      const huelle = m.scope === "env";
      const o = ((huelle ? stand.envOpenings : stand.customWindows) || []).find((x) => x._idx === m.index);
      const w = o && wirtWand(o, huelle, stand, huellWaende);
      if (o && w) pts.push(oeffnungsPunkt(o, w));
    } else if (m.type in POLY_LISTE) {
      const el = (stand[/** @type {keyof PlanStand} */ (POLY_LISTE[/** @type {keyof typeof POLY_LISTE} */ (m.type)])] || []).find((x) => x._idx === m.index);
      if (Array.isArray(el?.points)) pts.push(...el.points);
    }
  }
  return pts;
}

/**
 * The point a selection drag carries through the snap: the nearest point of the selection (auswahlPunkte) within `toleranz_m` of
 * the press — so a wall end grabbed near its end lands exactly on the target's end — else the pressed point itself.
 * @param {PlanStand} stand @param {AuswahlEintrag[]} auswahl
 * @param {Pkt} punkt pressed point, plan metres (raw pointer)
 * @param {number} toleranz_m capture distance in m (the studio converts its screen-px radius)
 * @param {any[]} [huellWaende]
 * @returns {Pkt}
 */
export function zugBezugspunkt(stand, auswahl, punkt, toleranz_m, huellWaende = []) {
  let best = null, bestD = Infinity;
  for (const p of auswahlPunkte(stand, auswahl, huellWaende)) {
    const d = laenge(p, punkt);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best && bestD <= toleranz_m ? { x: best.x, z: best.z } : { x: punkt.x, z: punkt.z };
}

/**
 * @param {Pkt} p @param {Pkt} a @param {Pkt} b
 * @returns {number} distance of p from the segment a–b, m
 */
function abstandZurStrecke(p, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}

/**
 * @param {Pkt} p @param {Pkt[]} poly
 * @returns {boolean} p inside the polygon (even-odd rule)
 */
function imPolygon(p, poly) {
  let drin = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) drin = !drin;
  }
  return drin;
}

/**
 * Does a press at `punkt` hit an element of the selection (so it starts a selection drag, not a frame)? Wall: within half its
 * thickness plus the tolerance of the axis; column: its square plus the tolerance; opening: its width along the axis plus the
 * tolerance; polygon: inside it or within the tolerance of an edge.
 * @param {PlanStand} stand @param {AuswahlEintrag[]} auswahl
 * @param {Pkt} punkt plan metres (raw pointer)
 * @param {number} toleranz_m pick tolerance in m (the plan's screen-px hit band converted)
 * @param {any[]} [huellWaende]
 * @returns {boolean}
 */
export function auswahlGetroffen(stand, auswahl, punkt, toleranz_m, huellWaende = []) {
  if (!punkt || !Number.isFinite(punkt.x) || !Number.isFinite(punkt.z)) return false;
  for (const m of auswahl || []) {
    if (m.type === "wall") {
      const w = (stand.customWalls || []).find((x) => x._idx === m.index);
      if (w && abstandZurStrecke(punkt, w.a, w.b) <= (Number(w.thickness) || 0.3) / 2 + toleranz_m) return true;
    } else if (m.type === "column") {
      const c = (stand.customColumns || []).find((x) => x._idx === m.index), h = (Number(c?.size) || 0.4) / 2 + toleranz_m;
      if (c && Math.abs(punkt.x - c.x) <= h && Math.abs(punkt.z - c.z) <= h) return true;
    } else if (m.type === "opening") {
      const huelle = m.scope === "env";
      const o = ((huelle ? stand.envOpenings : stand.customWindows) || []).find((x) => x._idx === m.index);
      const w = o && wirtWand(o, huelle, stand, huellWaende);
      if (o && w && laenge(oeffnungsPunkt(o, w), punkt) <= oeffnungsMasse(o).w / 2 + toleranz_m) return true;
    } else if (m.type in POLY_LISTE) {
      const el = (stand[/** @type {keyof PlanStand} */ (POLY_LISTE[/** @type {keyof typeof POLY_LISTE} */ (m.type)])] || []).find((x) => x._idx === m.index);
      const pts = Array.isArray(el?.points) ? el.points : [];
      if (pts.length >= 3 && (imPolygon(punkt, pts) || pts.some((/** @type {Pkt} */ p, /** @type {number} */ i) => abstandZurStrecke(punkt, p, pts[(i + 1) % pts.length]) <= toleranz_m))) return true;
    }
  }
  return false;
}

/**
 * Snap sources the dragged elements stand for (the studio's index: `w<_idx>` drawn wall, `c<_idx>` column, `p<_idx>` polygon) —
 * they are left out of the snap, so a dragged element never catches itself.
 * @param {AuswahlEintrag[]} auswahl
 * @returns {string[]}
 */
export function fangQuellenDerAuswahl(auswahl) {
  const vor = /** @type {Record<string, string>} */ ({ wall: "w", column: "c", zone: "p", slab: "p", roof: "p" });
  return (auswahl || []).filter((m) => vor[m.type]).map((m) => `${vor[m.type]}${m.index}`);
}

// ---- Grundriss-Bedienung part 3: typed length in the wall chain -----------------------------------------------------------------

/**
 * Reads the length typed into the measure field of the wall tool: digits with ONE decimal comma or point, metres. A leading "*" or
 * "/" is NOT a length (those belong to the typed row of a duplicate, 107-07) and is refused like any other text.
 * @param {string} text typed text, e.g. "2,5" or "3.75"
 * @returns {{ok: true, laenge_m: number} | {ok: false, grund: string}} laenge_m in m (millimetre-rounded); grund: German hint
 */
export function massEingabeLesen(text) {
  const t = String(text ?? "").trim();
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return { ok: false, grund: "Kein gültiges Maß – Ziffern mit Komma, in Metern." };
  const L = mm(Number(t.replace(",", ".")));
  if (!(L >= MIN_WAND_LAENGE_M)) return { ok: false, grund: "Wand zu kurz – eine Wand braucht mindestens 5 cm Länge." };
  return { ok: true, laenge_m: L };
}

/**
 * The next chain point `laenge_m` from `von` in the direction of `richtung` (the snapped pointer).
 * @param {Pkt} von last chain point, plan metres
 * @param {Pkt} richtung point that gives the direction (pointer), plan metres
 * @param {number} laenge_m length in m
 * @returns {Pkt|null} millimetre-rounded; null when the pointer stands on `von` (no direction)
 */
export function punktInRichtung(von, richtung, laenge_m) {
  if (!von || !richtung) return null;
  const d = laenge(von, richtung);
  if (!(d > 1e-9) || !Number.isFinite(laenge_m)) return null;
  return { x: mm(von.x + ((richtung.x - von.x) / d) * laenge_m), z: mm(von.z + ((richtung.z - von.z) / d) * laenge_m) };
}
