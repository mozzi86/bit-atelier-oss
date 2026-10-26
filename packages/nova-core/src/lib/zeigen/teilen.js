// 106-03: split a drawn element in two - a wall at a point, a slab (polygon) along a line. Pure functions on the
// element data of the BIM studio (customWalls / customWindows / customSlabs ...), no React, no three, no I/O.
// Nothing is mutated: the result holds NEW objects, the caller replaces the old element (and its openings) in its
// arrays. The parts get NEW stored GUIDs (22 characters, same generator as bauteilGuid: stabileGuid) because the old
// GUID names the old, undivided element - references to it (penetrations, BCF, journal) are reported in the
// result (`guidAlt`) so the caller can warn instead of silently dangling.
//
// In:  wall {a:{x,z}, b:{x,z}, _idx, ...} / polygon {points:[{x,z}], _idx, ...} in m (plan coordinates, x east,
//      z plan "down" as in the studio), the cut (point / line) in m, the openings of the wall, a free `_idx`
//      for the second part (the studio's idRef, a pure function cannot know it).
// Out: {teile:[A, B], ...} plus openings / warnings. Throws a German text for a cut that is not possible.
import { stabileGuid } from "../werkstattBauteile.js";
import { bauteilGuid } from "../bauteil/steckbrief.js";
import { openingTypeById } from "../buildingModel.js";

/** Smallest distance of a wall cut to a wall end in m (an end closer than this is no cut) [ASSUMED: 1 cm, below drawing accuracy]. */
export const TEILEN_END_ABSTAND_M = 0.01;

/** Smallest area of a slab part in m2 [ASSUMED: 1 dm2, anything smaller is a sliver, not a slab]. */
export const TEILEN_MIN_FLAECHE_M2 = 0.01;

/** A vertex counts as lying on the cutting line below this distance in m [ASSUMED: 0.1 mm]. */
const AUF_LINIE_M = 1e-4;

/** Rounds to 1e-6 m (like the massing functions) so floating point drift never reaches the stored plan. */
const runde = (v) => Math.round(v * 1e6) / 1e6 + 0; // + 0 turns -0 into 0
/** German number text with at most 3 decimals and a decimal comma, for the error texts. */
const zahl = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",");

/** @param {any} p @returns {boolean} true for a plan point {x, z} of finite numbers */
const istPunkt = (p) => p != null && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z));

/**
 * Splits a drawn wall at a point.
 * The point is projected onto the wall axis (a to b); part A runs from a to the cut, part B from the cut to b.
 * Part A keeps the wall's `_idx`, part B gets `opt.naechsteIdx`; BOTH get a new stored `guid`. Everything else
 * (thickness, height, composite, status, kg ...) is copied, so build-up and quantities carry over.
 * Openings are reassigned by the position of their CENTRE along the wall: centre before the cut -> A (same `u`),
 * after -> B (`u` reduced by the length of A, wallIdx = B's `_idx`, GUID kept by storing it on the opening).
 * An opening whose width reaches over the cut stays with the part holding its centre and is reported in
 * `warnungen` - its position is NOT moved (the user decides), the IFC export skips it with a warning if it no
 * longer fits.
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}, _idx?: number, [k: string]: any}} wand  Wall; axis in m.
 * @param {{x: number, z: number}} punkt_m  Cut point in m (plan coordinates); only its projection onto the axis counts.
 * @param {{naechsteIdx: number, projektId?: string|number|null, oeffnungen?: Array<{wallIdx?: number, u?: number, kind?: string, typeId?: string, _idx?: number, [k: string]: any}>}} opt
 *   naechsteIdx: free element number for part B (required); projektId: project of the derived GUIDs;
 *   oeffnungen: openings of drawn walls (customWindows); only those with wallIdx === wand._idx are considered.
 * @returns {{teile: [any, any], oeffnungen: any[], warnungen: string[], schnitt: {x: number, z: number}, t_m: number,
 *   laengen_m: [number, number], guidAlt: string}}
 *   teile: the two new walls A and B; oeffnungen: the reassigned openings as NEW objects (the caller replaces them by
 *   `_idx`); schnitt: the cut point on the axis in m; t_m: distance of the cut from `a` in m; laengen_m: axis lengths of
 *   A and B in m (their sum is the old length); guidAlt: GUID of the undivided wall.
 * @throws {Error} German text: point outside the wall, within 1 cm of an end, wall too short, no free `_idx`.
 */
export function wandTeilen(wand, punkt_m, opt) {
  if (!wand || !istPunkt(wand.a) || !istPunkt(wand.b)) throw new Error("Wand teilen: das Bauteil ist keine Wand mit Anfang und Ende");
  if (!istPunkt(punkt_m)) throw new Error("Wand teilen: Teilungspunkt fehlt (x, z in m)");
  if (!opt || !Number.isFinite(Number(opt.naechsteIdx))) throw new Error("Wand teilen: keine freie Element-Nummer für das zweite Teil");
  const { a, b } = wand;
  const dx = b.x - a.x, dz = b.z - a.z;
  const laenge = Math.hypot(dx, dz);
  if (laenge < 2 * TEILEN_END_ABSTAND_M) throw new Error(`Wand teilen: die Wand ist mit ${zahl(laenge)} m zu kurz zum Teilen`);
  // distance of the projected point from a along the axis, in m
  const t = ((punkt_m.x - a.x) * dx + (punkt_m.z - a.z) * dz) / laenge;
  if (t < 0 || t > laenge) throw new Error(`Wand teilen: der Teilungspunkt liegt außerhalb der Wand (${zahl(t)} m von ${zahl(laenge)} m)`);
  if (t < TEILEN_END_ABSTAND_M || t > laenge - TEILEN_END_ABSTAND_M) {
    throw new Error("Wand teilen: der Teilungspunkt liegt am Wandende (weniger als 1 cm Abstand) — dort gibt es nichts zu teilen");
  }
  const schnitt = { x: runde(a.x + (dx / laenge) * t), z: runde(a.z + (dz / laenge) * t) };
  const laengeA = Math.hypot(schnitt.x - a.x, schnitt.z - a.z);
  const laengeB = Math.hypot(b.x - schnitt.x, b.z - schnitt.z);

  const projektId = opt.projektId ?? null;
  const guidAlt = bauteilGuid(projektId, "customWalls", wand);
  const idA = wand._idx;
  const idB = Number(opt.naechsteIdx);
  const schl = `${projektId ?? "-"}|teilen|${guidAlt}|${schnitt.x}|${schnitt.z}`;
  const guidA = stabileGuid(`${schl}|A`);
  const guidB = stabileGuid(`${schl}|B`);
  const wandA = { ...wand, a: { ...a }, b: { ...schnitt }, guid: guidA };
  const wandB = { ...wand, a: { ...schnitt }, b: { ...b }, guid: guidB, _idx: idB };

  /** @type {any[]} */
  const oeffnungen = [];
  /** @type {string[]} */
  const warnungen = [];
  for (const o of Array.isArray(opt.oeffnungen) ? opt.oeffnungen : []) {
    if (!o || o.wallIdx !== wand._idx) continue;
    const u = Number(o.u) || 0; // centre of the opening in m from a
    const halb = (openingTypeById(o.kind === "door" ? "door" : "window", o.typeId)?.w || 1) / 2;
    const art = o.kind === "door" ? "Tür" : "Fenster";
    const nr = o._idx != null ? ` ${o._idx}` : "";
    if (u < t) {
      oeffnungen.push({ ...o, wallIdx: idA });
      if (u + halb > t) warnungen.push(`${art}${nr} ragt ${zahl((u + halb - t) * 100)} cm über die Teilungsstelle — bleibt an Teil A (Mitte davor)`);
    } else {
      // source name exactly as the IFC export and the studio build the opening GUID, so it survives the new wallIdx
      const guid = bauteilGuid(projektId, `oeffnung|cw:${wand._idx}|${o.kind}|${o._idx ?? o.u ?? 0}`, o);
      oeffnungen.push({ ...o, wallIdx: idB, u: runde(u - t), guid });
      if (u - halb < t) warnungen.push(`${art}${nr} ragt ${zahl((t - (u - halb)) * 100)} cm über die Teilungsstelle — bleibt an Teil B (Mitte dahinter)`);
    }
  }
  return { teile: [wandA, wandB], oeffnungen, warnungen, schnitt, t_m: runde(t), laengen_m: [runde(laengeA), runde(laengeB)], guidAlt };
}

/** Signed area of a polygon in m2 (positive for counter-clockwise in x/z), shoelace. @param {Array<{x: number, z: number}>} p */
const flaecheVorzeichen = (p) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i].x * q.z - q.x * p[i].z; }
  return s / 2;
};

/**
 * Splits a drawn slab (or any polygon element: zone, roof) along a straight line.
 * The line counts as infinite (an element is cut through, a line that ends inside makes no two parts). It has to
 * cross the outline in exactly two places; a simple polygon, convex or not, is then divided into two simple
 * polygons. Part A is the one on the left of the direction a to b (z plan "down"), part B the one on the right. A keeps
 * the element's `_idx`, B gets `opt.naechsteIdx`; both get new stored GUIDs, all other fields are copied.
 * The two areas add up to the old area (checked, a mismatch is thrown, not returned).
 * @param {{points: Array<{x: number, z: number}>, _idx?: number, [k: string]: any}} decke  Polygon element; outline in m.
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}}} linie  Two points of the cutting line in m.
 * @param {{naechsteIdx: number, projektId?: string|number|null, quelle?: string}} opt
 *   naechsteIdx: free element number for part B (required); projektId: project of the derived GUIDs;
 *   quelle: source name of the old GUID, default "customSlabs" (use "customZones" / "customRoofs" for those).
 * @returns {{teile: [any, any], warnungen: string[], schnittpunkte: [{x: number, z: number}, {x: number, z: number}],
 *   flaechen_m2: [number, number], guidAlt: string}}
 *   schnittpunkte: where the line crosses the outline, in m; flaechen_m2: areas of A and B in m2.
 * @throws {Error} German text: line misses the slab, crosses it more than twice, runs along an edge, a part is a sliver.
 */
export function deckeTeilen(decke, linie, opt) {
  const pts = Array.isArray(decke?.points) ? decke.points : [];
  if (pts.length < 3 || !pts.every(istPunkt)) throw new Error("Decke teilen: das Bauteil hat keine Fläche (mindestens 3 Eckpunkte)");
  if (!linie || !istPunkt(linie.a) || !istPunkt(linie.b)) throw new Error("Decke teilen: Teilungslinie fehlt (a und b mit x, z in m)");
  if (!opt || !Number.isFinite(Number(opt.naechsteIdx))) throw new Error("Decke teilen: keine freie Element-Nummer für das zweite Teil");
  const P = linie.a;
  const Dx = linie.b.x - P.x, Dz = linie.b.z - P.z;
  const DL = Math.hypot(Dx, Dz);
  if (DL < TEILEN_END_ABSTAND_M) throw new Error("Decke teilen: die Teilungslinie ist zu kurz (weniger als 1 cm)");
  const n = pts.length;
  // signed distance of each vertex from the line in m; positive = left of a to b
  const d = pts.map((p) => { const v = (Dx * (p.z - P.z) - Dz * (p.x - P.x)) / DL; return Math.abs(v) < AUF_LINIE_M ? 0 : v; });
  for (let i = 0; i < n; i++) if (d[i] === 0 && d[(i + 1) % n] === 0) throw new Error("Decke teilen: die Linie verläuft entlang einer Kante der Decke");

  /** @type {Array<{x: number, z: number, schnitt: boolean, seite: number}>} */
  const ring = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const vorher = d[(i + n - 1) % n], nachher = d[(i + 1) % n];
    // a vertex exactly on the line is a crossing only when the outline passes from one side to the other there
    ring.push({ x: Number(p.x), z: Number(p.z), schnitt: d[i] === 0 && vorher * nachher < 0, seite: d[i] });
    if (d[i] * d[(i + 1) % n] < 0) {
      const f = d[i] / (d[i] - d[(i + 1) % n]); // share of the edge from p to the crossing
      ring.push({ x: Number(p.x) + f * (Number(q.x) - Number(p.x)), z: Number(p.z) + f * (Number(q.z) - Number(p.z)), schnitt: true, seite: 0 });
    }
  }
  const schnittIdx = ring.map((r, i) => (r.schnitt ? i : -1)).filter((i) => i >= 0);
  if (schnittIdx.length === 0) throw new Error("Decke teilen: die Linie schneidet die Decke nicht");
  if (schnittIdx.length !== 2) throw new Error(`Decke teilen: die Linie schneidet die Decke an ${schnittIdx.length} Stellen — Teilen geht nur bei genau 2 Schnittpunkten`);
  const [i1, i2] = schnittIdx;
  const roh = [ring.slice(i1, i2 + 1), [...ring.slice(i2), ...ring.slice(0, i1 + 1)]];
  /** removes vertices that coincide with their predecessor (a vertex on the line is both a cut and an outline point) */
  const bereinigt = (/** @type {typeof ring} */ r) => r
    .map((q) => ({ x: runde(q.x), z: runde(q.z), seite: q.seite }))
    .filter((q, i, arr) => { const v = arr[(i + arr.length - 1) % arr.length]; return arr.length === 1 || q.x !== v.x || q.z !== v.z; });
  const stuecke = roh.map(bereinigt);
  for (const s of stuecke) if (s.length < 3) throw new Error("Decke teilen: ein Teil hätte weniger als 3 Eckpunkte");
  // A = left of the line (mean side of its non-cut vertices > 0)
  const links = (/** @type {Array<{seite: number}>} */ s) => s.reduce((m, q) => m + q.seite, 0);
  const [rohA, rohB] = links(stuecke[0]) >= links(stuecke[1]) ? stuecke : [stuecke[1], stuecke[0]];
  const punkteA = rohA.map(({ x, z }) => ({ x, z }));
  const punkteB = rohB.map(({ x, z }) => ({ x, z }));
  const flA = Math.abs(flaecheVorzeichen(punkteA)), flB = Math.abs(flaecheVorzeichen(punkteB));
  const alt = Math.abs(flaecheVorzeichen(pts.map((p) => ({ x: Number(p.x), z: Number(p.z) }))));
  if (flA < TEILEN_MIN_FLAECHE_M2 || flB < TEILEN_MIN_FLAECHE_M2) throw new Error(`Decke teilen: ein Teil wäre nur ${zahl(Math.min(flA, flB))} m² groß — Linie liegt zu nah am Rand`);
  if (Math.abs(flA + flB - alt) > 1e-4) throw new Error("Decke teilen: die Flächen der Teile ergeben nicht die alte Fläche — Umriss nicht eindeutig teilbar");

  const projektId = opt.projektId ?? null;
  const guidAlt = bauteilGuid(projektId, opt.quelle || "customSlabs", decke);
  const schl = `${projektId ?? "-"}|teilen|${guidAlt}|${runde(P.x)}|${runde(P.z)}|${runde(linie.b.x)}|${runde(linie.b.z)}`;
  const teilA = { ...decke, points: punkteA, guid: stabileGuid(`${schl}|A`) };
  const teilB = { ...decke, points: punkteB, guid: stabileGuid(`${schl}|B`), _idx: Number(opt.naechsteIdx) };
  const sp = [ring[i1], ring[i2]].map((r) => ({ x: runde(r.x), z: runde(r.z) }));
  return { teile: [teilA, teilB], warnungen: [], schnittpunkte: [sp[0], sp[1]], flaechen_m2: [runde(flA), runde(flB)], guidAlt };
}
