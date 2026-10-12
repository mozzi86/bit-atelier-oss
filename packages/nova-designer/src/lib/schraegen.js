// 86-02: use the slanted remainders of a non-rectangular footprint — the rectangle solver
// (86-01 fit, 86-03 bars) leaves wedges between the bars and slanted facades empty. This
// module adds the wedge in front of a window room to that room: the room keeps its
// rectangle and gets a SLANTED outer wall (polygon = rectangle with the facade edge bulged out
// to the footprint outline). Gable rooms at a slanted end ("Kopfwohnung mit Schrägwand") are
// covered by the same rule — their facade edge faces the wedge.
//
// Rules (all [ASSUMED], 86-02-PLAN):
//   - only window rooms (fensterpflicht) that are still rectangles; corridors, cores, baths and
//     balconies never grow (a deeper bath or corridor buys nothing);
//   - per room edge the strip "edge × SCHRAEGE.tiefeMax_m" outward; the part of the remainder
//     inside that strip which LIES ON the edge (one contiguous contact) is added; depth limit
//     2,5 m keeps the room usable for daylight (rule of thumb: room depth ≤ 2,5 × lintel height
//     ≈ 6–7,5 m, the bands are 5–6 m deep);
//   - the added depth never pushes the room beyond the office-standard proportion
//     (depth ≤ seitenMax × facade width, WOHNUNGS_REGELN.seitenverhaeltnisMax 1 : 1,8 — passed
//     in by the solver): a 2,80 m gallery room plus 2,5 m wedge became a 1 : 3,3 "Schlauch";
//   - parts under SCHRAEGE.minFlaeche_m2 stay remainder (slivers);
//   - an edge carrying a door is never bulged (the door record would lose its wall); a room
//     with a known window wall (`fensterwand`, 75-14 layout) is bulged ONLY there — its blind
//     walls stay straight for the wardrobe (75-14 schrankwand check);
//   - balconies (75-13) are cut out of the remainder first.
// Deterministic: storeys ascending, rooms by name, edges by index.
//
// In:  zones (world frame, m), remainder pieces (world frame, m — tesseliere `form.rest`).
// Out: new zones (changed rooms are new objects), remainder per storey, added areas, the
//      replaced facade edges (for the wall segments of rule wandstaerken). Without remainder
//      the input zones are returned as they are (byte-identical).
import { flaeche, istRechteck, inKonvex, ohneKonvex, flaecheSigniert } from "./formGeometrie.js";

/** Limits of the wedge use (m, m²) [ASSUMED, see file head]. */
export const SCHRAEGE = { tiefeMax_m: 2.5, minFlaeche_m2: 0.5, minAuflage_m: 0.3 };

const EPS = 1e-6;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Half-planes (n·p ≤ c) of a convex polygon (inside = polygon), any orientation.
 * @param {Array<{x:number,z:number}>} pts convex polygon, m
 * @returns {Array<{nx:number,nz:number,c:number}>}
 */
export function halbebenenVon(pts) {
  const ccw = flaecheSigniert(pts) > 0;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < EPS) continue;
    // Outward normal: for a positively oriented ring (x→z) the outside is to the right... test by sign.
    let nx = dz / l, nz = -dx / l;
    if (!ccw) { nx = -nx; nz = -nz; }
    out.push({ nx, nz, c: nx * a.x + nz * a.z });
  }
  // Orientation check against the centroid (robust for either convention).
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return out.map((h) => (h.nx * cx + h.nz * cz <= h.c + EPS ? h : { nx: -h.nx, nz: -h.nz, c: -h.c }));
}

/**
 * The strip in front of a room edge as half-planes: beyond the edge, at most `tiefe` deep,
 * between the perpendiculars through the edge end points.
 * @param {{x:number,z:number}} a edge start, m
 * @param {{x:number,z:number}} b edge end, m
 * @param {{x:number,z:number}} n outward unit normal
 * @param {number} tiefe m
 */
function streifen(a, b, n, tiefe) {
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  const t = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  // Order matters for ohneKonvex (piece i = inside 0…i−1, outside i): the two side cuts come
  // FIRST, so the remainder beside the strip keeps its full depth for the neighbouring rooms;
  // a depth cut first would slice the whole wedge at this room's (maybe small) depth.
  return [
    { nx: -t.x, nz: -t.z, c: -(t.x * a.x + t.z * a.z) },
    { nx: t.x, nz: t.z, c: t.x * a.x + t.z * a.z + l },
    { nx: -n.x, nz: -n.z, c: -(n.x * a.x + n.z * a.z) },
    { nx: n.x, nz: n.z, c: n.x * a.x + n.z * a.z + tiefe },
  ];
}

/**
 * The outer chain of a piece lying on the edge line, ordered from the edge start side to the
 * edge end side — or null when the piece touches the line in more than one run or too short.
 * @param {Array<{x:number,z:number}>} teil piece, m
 * @param {{x:number,z:number}} a edge start
 * @param {{x:number,z:number}} b edge end
 * @param {{x:number,z:number}} n outward normal
 */
function aussenKette(teil, a, b, n) {
  const k = teil.length;
  const auf = teil.map((p) => Math.abs(n.x * (p.x - a.x) + n.z * (p.z - a.z)) <= 1e-6);
  // Runs of consecutive on-line points (cyclic); exactly one run with ≥ 2 points.
  const enden = [];
  for (let i = 0; i < k; i++) if (auf[i] && !auf[(i + 1) % k]) enden.push(i);
  if (enden.length !== 1) return null;
  const ende = enden[0];
  let anfang = ende;
  while (auf[(anfang - 1 + k) % k] && (anfang - 1 + k) % k !== ende) anfang = (anfang - 1 + k) % k;
  if (anfang === ende) return null; // a single point touches
  const kette = [];
  for (let i = ende; ; i = (i + 1) % k) { kette.push(teil[i]); if (i === anfang) break; }
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  const s = (p) => ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l;
  if (Math.abs(s(kette[0]) - s(kette[kette.length - 1])) < SCHRAEGE.minAuflage_m) return null;
  return s(kette[0]) <= s(kette[kette.length - 1]) ? kette : kette.reverse();
}

/**
 * Add the remainder wedges in front of window rooms to those rooms (see file head).
 * @param {Array<any>} zonen zones in the world frame (tesseliere output)
 * @param {Array<Array<{x:number,z:number}>>} rest remainder pieces of ONE storey (form.rest), m
 * @param {{seitenMax?: number}} [opts] seitenMax = largest depth/width ratio a grown room may
 *   reach (default 1,8 = WOHNUNGS_REGELN.seitenverhaeltnisMax)
 * @returns {{zonen: Array<any>, restJeGeschoss: Map<number, Array<Array<{x:number,z:number}>>>,
 *   zuschlagJeGeschoss: Map<number, number>, raeumeJeGeschoss: Map<number, number>, zuschlagJeWe: Map<string, number>, raeume: number,
 *   kanten: Array<{level:number, a:{x:number,z:number}, b:{x:number,z:number}, neu: Array<{x:number,z:number}>}>}}
 *   zuschlag in m²; kanten = replaced facade edges (old a→b, new point run a…b)
 */
export function schraegenZuschlagen(zonen, rest, opts = {}) {
  const seitenMax = num(opts.seitenMax, 1.8) > 1 ? num(opts.seitenMax, 1.8) : 1.8;
  // Every piece stays in the remainder bookkeeping (small ones too: rest + occupied = footprint).
  const restTeile = (Array.isArray(rest) ? rest : []).filter((t) => Array.isArray(t) && t.length >= 3);
  const leer = { zonen, restJeGeschoss: new Map(), zuschlagJeGeschoss: new Map(), raeumeJeGeschoss: new Map(), zuschlagJeWe: new Map(), raeume: 0, kanten: [] };
  if (!restTeile.some((t) => flaeche(t) >= SCHRAEGE.minFlaeche_m2) || !Array.isArray(zonen)) return leer;
  const liste = zonen.slice();
  const ebenen = [...new Set(liste.map((z) => Math.round(num(z?.level))))].sort((p, q) => p - q);
  const out = { ...leer, zonen: liste, restJeGeschoss: new Map(), zuschlagJeGeschoss: new Map(), raeumeJeGeschoss: new Map(), zuschlagJeWe: new Map(), kanten: [] };
  let geaendert = false;
  for (const level of ebenen) {
    let teile = restTeile.map((t) => t.map((p) => ({ x: num(p.x), z: num(p.z) })));
    for (const bk of liste.filter((z) => z && z.raumart === "balkon" && Math.round(num(z.level)) === level && Array.isArray(z.points) && z.points.length >= 3)) {
      const h = halbebenenVon(bk.points.map((p) => ({ x: num(p.x), z: num(p.z) })));
      teile = teile.flatMap((t) => ohneKonvex(t, h, 1e-9));
    }
    const kandidaten = liste
      .map((z, i) => ({ z, i }))
      .filter(({ z }) => z && z.we && z.fensterpflicht === true && z.raumart !== "flur" && z.raumart !== "balkon"
        && Math.round(num(z.level)) === level && Array.isArray(z.points) && z.points.length === 4 && istRechteck(z.points))
      .sort((p, q) => (String(p.z.name) < String(q.z.name) ? -1 : String(p.z.name) > String(q.z.name) ? 1 : 0));
    let summe = 0;
    for (const { z, i } of kandidaten) {
      const P = z.points.map((p) => ({ x: num(p.x), z: num(p.z) }));
      const cx = P.reduce((s, p) => s + p.x, 0) / 4, cz = P.reduce((s, p) => s + p.z, 0) / 4;
      const tuerKanten = new Set((Array.isArray(z.tueren) ? z.tueren : []).map((t) => Math.round(num(t?.wand, -1))));
      /** @type {Map<number, Array<{x:number,z:number}>>} edge → outer chain (start side → end side) */
      const ketten = new Map();
      let zuschlag = 0;
      for (let e = 0; e < 4; e++) {
        if (tuerKanten.has(e)) continue;
        if (Number.isInteger(z.fensterwand) && z.fensterwand !== e) continue;
        const a = P[e], b = P[(e + 1) % 4];
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        if (l < SCHRAEGE.minAuflage_m) continue;
        let n = { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
        if ((cx - a.x) * n.x + (cz - a.z) * n.z > 0) n = { x: -n.x, z: -n.z };
        // Room depth perpendicular to this edge (m) and the depth the proportion still allows.
        const tiefeRaum = Math.max(...P.map((p) => -((p.x - a.x) * n.x + (p.z - a.z) * n.z)));
        const tiefe = Math.min(SCHRAEGE.tiefeMax_m, seitenMax * l - tiefeRaum);
        if (tiefe < 0.25) continue; // [ASSUMED] less than 25 cm is not worth a slanted wall
        const R = streifen(a, b, n, tiefe);
        const neueTeile = [];
        let kette = null;
        for (const t of teile) {
          const drin = kette ? [] : inKonvex(t, R).filter((q) => flaeche(q) > 1e-9);
          const passend = drin.map((q) => ({ q, k: flaeche(q) >= SCHRAEGE.minFlaeche_m2 ? aussenKette(q, a, b, n) : null })).find((x) => x.k);
          if (!passend) { neueTeile.push(t); continue; }
          kette = passend.k;
          zuschlag += flaeche(passend.q);
          // Remainder of this piece: outside the strip, plus the strip parts that were not taken.
          neueTeile.push(...ohneKonvex(t, R, 1e-9), ...drin.filter((q) => q !== passend.q));
        }
        teile = neueTeile;
        if (kette) ketten.set(e, kette);
      }
      if (!ketten.size) continue;
      // New ring: rectangle corners with the bulged chains between them; door / window-wall
      // edge indices follow the new numbering.
      const neu = [];
      const startIndex = [];
      const nah = (p, q) => Math.abs(p.x - q.x) <= 1e-9 && Math.abs(p.z - q.z) <= 1e-9;
      const anhaengen = (p) => { if (!neu.length || !nah(neu[neu.length - 1], p)) neu.push({ x: p.x, z: p.z }); };
      for (let e = 0; e < 4; e++) {
        startIndex[e] = neu.length;
        anhaengen(P[e]);
        startIndex[e] = neu.length - 1;
        const k = ketten.get(e);
        if (k) {
          for (const p of k) anhaengen(p);
          out.kanten.push({ level, a: P[e], b: P[(e + 1) % 4], neu: [P[e], ...k, P[(e + 1) % 4]] });
        }
      }
      if (nah(neu[0], neu[neu.length - 1])) neu.pop();
      const zone = { ...z, points: neu, flaeche_m2: flaeche(neu) };
      if (Array.isArray(z.tueren)) zone.tueren = z.tueren.map((t) => ({ ...t, wand: startIndex[Math.round(num(t.wand))] ?? t.wand }));
      if (Number.isInteger(z.fensterwand)) {
        const w = z.fensterwand;
        if (ketten.has(w)) {
          // The window wall is now a run of segments: keep the longest one (the slanted facade).
          const bis = w === 3 ? neu.length : startIndex[w + 1];
          let best = startIndex[w], bestL = -1;
          for (let s = startIndex[w]; s < bis; s++) {
            const p = neu[s], q = neu[(s + 1) % neu.length];
            const len = Math.hypot(q.x - p.x, q.z - p.z);
            if (len > bestL + 1e-9) { bestL = len; best = s; }
          }
          zone.fensterwand = best;
        } else zone.fensterwand = startIndex[w];
      }
      liste[i] = zone;
      geaendert = true;
      out.raeume += 1;
      out.raeumeJeGeschoss.set(level, (out.raeumeJeGeschoss.get(level) || 0) + 1);
      summe += zuschlag;
      out.zuschlagJeWe.set(String(z.we), (out.zuschlagJeWe.get(String(z.we)) || 0) + zuschlag);
    }
    out.restJeGeschoss.set(level, teile);
    out.zuschlagJeGeschoss.set(level, summe);
  }
  if (!geaendert) return { ...out, zonen };
  return out;
}
