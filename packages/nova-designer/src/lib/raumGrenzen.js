// 75-12: interior walls of a workshop unit as a persisted solver INPUT (werkstatt_layer.raumGrenzen).
//
// Why an input and not geometry: the ·WT zones are regenerated from the layer on every load
// (useWerkstattRehydrate) — a point edit in the store would be lost on reload. So the user's
// move is stored as an offset per wall and re-applied right after the room slicing; every later
// step (escape route, balconies, wall segments, quality checks) sees the moved wall.
//
// What is movable: the wall between TWO RECTANGULAR rooms of the SAME unit on the SAME storey
// that share a FULL edge (both end points equal). Exterior walls (owned by the massing), unit
// boundaries (owned by the band solver, 61-07 grenzenPositionen) and the L-shaped hall (75-14)
// are never moved. The move runs along the wall normal, so it is frame-invariant (rotated
// footprints 86-01, bars 86-03 compute in their local frame).
//
// Key: "<level>|<nameA>|<nameB>" with the two zone names sorted (one key per wall, independent
// of the zone order). Value: offset in metres, positive = room A (the first name) grows.
// Room names do not depend on the cut ("Wohnen (WE 0-1) ·WT"), so furniture keys (level:name)
// stay valid after a move.
//
// In:  zones (tesseliere / store shape: points [{x,z}] in m, level, we, name, raumart, tueren),
//      the raumGrenzen map (m). Out: new zones (moved rooms are new objects, all others are the
//      SAME objects) + hints. Without an entry the input array itself is returned — the
//      tessellation stays byte-identical. Import-free (node-testable), like formGeometrie.js.

/** Grid of a wall move (m): octametre 12.5 cm, DIN 4172 — same value as massordnung.OKTAMETER. */
export const RAUMGRENZE_RASTER_M = 0.125;
/**
 * Smallest room width a move may leave (m) [ASSUMED 1.20 m = apartment corridor minimum,
 * tesselierung MINDESTBREITEN.flur; DIN 18040-2 would ask more for R units — that is a hint,
 * not a clamp]. A room also never gets narrower than its widest door on a cross wall.
 */
export const RAUMGRENZE_MIN_BREITE_M = 1.2;

const EPS = 1e-6;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const gleich = (p, q) => Math.abs(num(p.x) - num(q.x)) < EPS && Math.abs(num(p.z) - num(q.z)) < EPS;

/**
 * Key of the wall between two rooms of one storey (names sorted → one key per wall).
 * @param {number} level storey index
 * @param {string} a zone name
 * @param {string} b zone name
 * @returns {string} "<level>|<A>|<B>"
 */
export function raumGrenzeSchluessel(level, a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return `${Math.round(num(level))}|${x}|${y}`;
}

/** @param {any} z @returns {boolean} 4-point zone with right angles (axis-free check) */
function istRechteckZone(z) {
  const p = Array.isArray(z?.points) ? z.points : null;
  if (!p || p.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const ux = num(b.x) - num(a.x), uz = num(b.z) - num(a.z), vx = num(c.x) - num(b.x), vz = num(c.z) - num(b.z);
    const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu < EPS || lv < EPS || Math.abs(ux * vx + uz * vz) / (lu * lv) > 1e-6) return false;
  }
  return true;
}

/** @param {any} z @returns {boolean} room of a unit that may take part in a wall move */
const beweglich = (z) => !!z && !!z.we && z.raumart !== "balkon" && z.raumart !== "flur" && istRechteckZone(z);

/**
 * Width of a zone along a direction (m): extent of its points projected on `n`.
 * @param {Array<{x:number,z:number}>} pts
 * @param {{x:number,z:number}} n unit vector
 */
function ausdehnung(pts, n) {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const s = num(p.x) * n.x + num(p.z) * n.z; lo = Math.min(lo, s); hi = Math.max(hi, s); }
  return hi - lo;
}

/**
 * Smallest width a room may keep (m): RAUMGRENZE_MIN_BREITE_M or its widest door on a wall
 * parallel to `n` (a cross wall — it shortens with the move), whichever is larger.
 * @param {any} z zone
 * @param {{x:number,z:number}} n wall normal
 */
function minBreite(z, n) {
  let m = RAUMGRENZE_MIN_BREITE_M;
  const p = z.points;
  for (const t of Array.isArray(z.tueren) ? z.tueren : []) {
    const i = Math.round(num(t?.wand, -1));
    if (i < 0 || i > 3) continue;
    const a = p[i], b = p[(i + 1) % 4];
    const l = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z)) || 1;
    const parallel = Math.abs(((num(b.x) - num(a.x)) * n.x + (num(b.z) - num(a.z)) * n.z) / l) > 0.5;
    if (parallel) m = Math.max(m, num(t.breite_m));
  }
  return m;
}

/**
 * @typedef {object} Innenwand
 * @property {string} key raumGrenzeSchluessel
 * @property {number} level storey
 * @property {string} we unit key
 * @property {string} a first zone name (grows with a positive offset)
 * @property {string} b second zone name
 * @property {{x:number,z:number}} p0 wall start (m)
 * @property {{x:number,z:number}} p1 wall end (m)
 * @property {{x:number,z:number}} n unit normal from A to B
 * @property {number} breiteA width of A along n (m)
 * @property {number} breiteB width of B along n (m)
 * @property {number} minA smallest width A may keep (m)
 * @property {number} minB smallest width B may keep (m)
 * @property {number} spielraumMinus how far the wall may move towards A (m, ≥ 0)
 * @property {number} spielraumPlus how far the wall may move towards B (m, ≥ 0)
 */

/**
 * Every movable interior wall in a zone list (see file head for the rules). Order: by key.
 * @param {Array<any>} zonen zones of any storeys/units
 * @returns {Array<Innenwand & {ia: number, ib: number, ea: number, eb: number}>} ia/ib = zone
 *   indices in `zonen`, ea/eb = edge indices of the shared wall in A/B
 */
export function innenwaende(zonen) {
  const liste = Array.isArray(zonen) ? zonen : [];
  const gruppen = new Map();
  liste.forEach((z, i) => {
    if (!beweglich(z)) return;
    const g = `${Math.round(num(z.level))}|${z.we}`;
    if (!gruppen.has(g)) gruppen.set(g, []);
    gruppen.get(g).push(i);
  });
  const out = [];
  for (const idx of gruppen.values()) {
    for (let s = 0; s < idx.length; s++) {
      for (let t = s + 1; t < idx.length; t++) {
        // Sorted by name so A is always the first name of the key.
        let [ia, ib] = [idx[s], idx[t]];
        if (String(liste[ia].name) > String(liste[ib].name)) [ia, ib] = [ib, ia];
        const A = liste[ia], B = liste[ib];
        let treffer = null;
        for (let ea = 0; ea < 4 && !treffer; ea++) {
          const a0 = A.points[ea], a1 = A.points[(ea + 1) % 4];
          for (let eb = 0; eb < 4; eb++) {
            const b0 = B.points[eb], b1 = B.points[(eb + 1) % 4];
            if ((gleich(a0, b1) && gleich(a1, b0)) || (gleich(a0, b0) && gleich(a1, b1))) { treffer = { ea, eb, a0, a1 }; break; }
          }
        }
        if (!treffer) continue;
        const { a0, a1 } = treffer;
        const dx = num(a1.x) - num(a0.x), dz = num(a1.z) - num(a0.z), l = Math.hypot(dx, dz);
        if (l < EPS) continue;
        let n = { x: -dz / l, z: dx / l };
        // Normal must point from A to B: A's centre lies behind the wall.
        const cA = A.points.reduce((m, p) => ({ x: m.x + num(p.x) / 4, z: m.z + num(p.z) / 4 }), { x: 0, z: 0 });
        if ((cA.x - num(a0.x)) * n.x + (cA.z - num(a0.z)) * n.z > 0) n = { x: -n.x, z: -n.z };
        const breiteA = ausdehnung(A.points, n), breiteB = ausdehnung(B.points, n);
        const minA = minBreite(A, n), minB = minBreite(B, n);
        out.push({
          key: raumGrenzeSchluessel(A.level, A.name, B.name), level: Math.round(num(A.level)), we: String(A.we),
          a: String(A.name), b: String(B.name), p0: { x: num(a0.x), z: num(a0.z) }, p1: { x: num(a1.x), z: num(a1.z) }, n,
          breiteA, breiteB, minA, minB,
          spielraumMinus: Math.max(0, breiteA - minA), spielraumPlus: Math.max(0, breiteB - minB),
          ia, ib, ea: treffer.ea, eb: treffer.eb,
        });
      }
    }
  }
  return out.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
}

/**
 * Snap an offset to the octametre grid and clamp it into [−minus, +plus]; clamping rounds
 * TOWARDS zero onto the grid, so a clamped wall still sits on the grid relative to its origin.
 * @param {number} delta wished offset (m)
 * @param {number} minus allowed move towards A (m, ≥ 0)
 * @param {number} plus allowed move towards B (m, ≥ 0)
 * @param {number} [raster] grid (m)
 * @returns {number} offset (m)
 */
export function rasterKlemmen(delta, minus, plus, raster = RAUMGRENZE_RASTER_M) {
  const r = num(raster, RAUMGRENZE_RASTER_M) > 0 ? num(raster, RAUMGRENZE_RASTER_M) : RAUMGRENZE_RASTER_M;
  const d = Math.round(num(delta) / r) * r;
  if (d > plus + EPS) return Math.floor((plus + EPS) / r) * r;
  if (d < -minus - EPS) return -Math.floor((minus + EPS) / r) * r;
  return Math.abs(d) < EPS ? 0 : d;
}

/**
 * Move a door so it keeps its world position on a wall whose start point moved; clamp it
 * into the new wall length (m).
 * @param {any} t door record { wand, u_m, breite_m, … }
 * @param {Array<{x:number,z:number}>} alt old points
 * @param {Array<{x:number,z:number}>} neu new points
 */
function tuerNachziehen(t, alt, neu) {
  const i = Math.round(num(t?.wand, -1));
  if (i < 0 || i > 3) return t;
  const a0 = alt[i], a1 = alt[(i + 1) % 4], n0 = neu[i], n1 = neu[(i + 1) % 4];
  if (gleich(a0, n0) && gleich(a1, n1)) return t;
  const la = Math.hypot(a1.x - a0.x, a1.z - a0.z) || 1;
  const s = { x: a0.x + ((a1.x - a0.x) / la) * num(t.u_m), z: a0.z + ((a1.z - a0.z) / la) * num(t.u_m) };
  const ln = Math.hypot(n1.x - n0.x, n1.z - n0.z) || 1;
  const u = ((s.x - n0.x) * (n1.x - n0.x) + (s.z - n0.z) * (n1.z - n0.z)) / ln;
  const uNeu = Math.min(Math.max(0, ln - num(t.breite_m)), Math.max(0, u));
  return { ...t, u_m: Math.round(uNeu * 1e6) / 1e6 };
}

/** @param {string} key @returns {string} hint for an entry whose wall no longer exists */
function fehlendHinweis(key) {
  const teile = String(key).split("|");
  return `Innenwand [75-12]: „${teile.slice(1).map((x) => x.replace(/ ·WT$/, "")).join(" | ")}" (Geschoss ${teile[0]}) gibt es im aktuellen Grundriss nicht mehr — Eintrag wirkt nicht (zurücksetzen im Fokus)`;
}

/**
 * Hints for stored entries whose wall does not exist in `zonen` (layout changed). Used by
 * the bar path after merging all bars (see wendeRaumGrenzenAn opts.fehlendMelden).
 * @param {Array<any>} zonen merged zones
 * @param {Record<string, number>|null|undefined} raumGrenzen werkstatt_layer.raumGrenzen (m)
 * @returns {string[]}
 */
export function raumGrenzenFehlend(zonen, raumGrenzen) {
  if (!raumGrenzen || typeof raumGrenzen !== "object") return [];
  const keys = Object.keys(raumGrenzen).filter((k) => Number.isFinite(Number(raumGrenzen[k])) && Math.abs(Number(raumGrenzen[k])) > EPS);
  if (!keys.length) return [];
  const da = new Set(innenwaende(zonen).map((w) => w.key));
  return keys.sort().filter((k) => !da.has(k)).map(fehlendHinweis);
}

/** Shoelace area (m²). @param {Array<{x:number,z:number}>} pts */
function flaeche(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.z - b.x * a.z; }
  return Math.abs(s) / 2;
}

/**
 * Apply the stored interior-wall offsets to a zone list.
 * - No (valid) entry → the SAME array is returned (byte-identical tessellation).
 * - Entries are applied in key order; each one is snapped to the octametre grid and clamped to
 *   the room minimums (hint when clamped). An entry whose wall no longer exists (layout
 *   changed) stays in the layer and is reported once — it never moves anything else.
 * - Moved rooms: new points, `flaeche_m2` recomputed (m²), doors kept at their world position.
 * - `mindestbreite(zone)` (m, optional) names the 75-07 minimum width per room: undercutting it
 *   is a HINT (the user moved the wall on purpose — warn, not fail: a design decision).
 * @param {Array<any>} zonen zones after the room slicing (local or world frame)
 * @param {Record<string, number>|null|undefined} raumGrenzen werkstatt_layer.raumGrenzen (m)
 * @param {{raster?: number, mindestbreite?: (zone: any) => number, fehlendMelden?: boolean}} [opts]
 *   fehlendMelden = false: stay silent about entries without a wall (the bar path 86-03 runs
 *   the solver per bar and reports the globally missing ones once via raumGrenzenFehlend)
 * @returns {{zonen: Array<any>, hinweise: string[], angewendet: Record<string, number>}}
 *   angewendet = key → offset actually applied (m)
 */
export function wendeRaumGrenzenAn(zonen, raumGrenzen, opts = {}) {
  const eintraege = raumGrenzen && typeof raumGrenzen === "object"
    ? Object.entries(raumGrenzen).filter(([, v]) => Number.isFinite(Number(v)) && Math.abs(Number(v)) > EPS).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))
    : [];
  if (!eintraege.length || !Array.isArray(zonen)) return { zonen, hinweise: [], angewendet: {} };
  const f2 = (v) => (Math.round(num(v) * 100) / 100).toFixed(2).replace(".", ",");
  const raumKurz = (s) => String(s).replace(/ ·WT$/, "");
  let liste = zonen.slice();
  const hinweise = [];
  /** @type {Record<string, number>} */
  const angewendet = {};
  let geaendert = false;
  for (const [key, wert] of eintraege) {
    const wand = innenwaende(liste).find((w) => w.key === key);
    if (!wand) {
      if (opts.fehlendMelden !== false) hinweise.push(fehlendHinweis(key));
      continue;
    }
    const delta = rasterKlemmen(Number(wert), wand.spielraumMinus, wand.spielraumPlus, opts.raster);
    if (Math.abs(delta - Number(wert)) > 1e-3) {
      hinweise.push(`Innenwand [75-12]: ${raumKurz(wand.a)} | ${raumKurz(wand.b)} — Versatz ${f2(wert)} m nicht möglich, gesetzt ${f2(delta)} m (Räume bleiben ≥ ${f2(Math.max(wand.minA, wand.minB))} m breit)`);
    }
    if (Math.abs(delta) < EPS) continue;
    angewendet[key] = delta;
    const v = { x: wand.n.x * delta, z: wand.n.z * delta };
    const schiebe = (z, e) => {
      const alt = z.points.map((p) => ({ x: num(p.x), z: num(p.z) }));
      const neu = alt.map((p, i) => (i === e || i === (e + 1) % 4 ? { x: p.x + v.x, z: p.z + v.z } : p));
      const zone = { ...z, points: neu, flaeche_m2: flaeche(neu) };
      if (Array.isArray(z.tueren)) zone.tueren = z.tueren.map((t) => tuerNachziehen(t, alt, neu));
      return zone;
    };
    liste[wand.ia] = schiebe(liste[wand.ia], wand.ea);
    liste[wand.ib] = schiebe(liste[wand.ib], wand.eb);
    geaendert = true;
    if (typeof opts.mindestbreite === "function") {
      for (const [z, breite] of [[liste[wand.ia], wand.breiteA + delta], [liste[wand.ib], wand.breiteB - delta]]) {
        const min = num(opts.mindestbreite(z));
        if (min > 0 && breite + 1e-6 < min) hinweise.push(`Innenwand [75-12]: „${raumKurz(z.name)}" ${f2(breite)} m breit < ${f2(min)} m Mindestbreite [ASSUMED] — bewusst verschoben`);
      }
    }
  }
  if (!geaendert) liste = zonen;
  return { zonen: liste, hinweise, angewendet };
}
