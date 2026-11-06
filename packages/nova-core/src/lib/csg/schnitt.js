// 107-14 (D-BK-08a): cut of a solid with a plane — the DERIVATION the plan, the section and the poché come from. The solid
// is the source of derived geometry; this module turns it into closed outlines per material group.
//
// Professional origin: a floor plan is a horizontal cut at the cut height (`cutHeight`, default 1.1 m in the BIM studio, as
// usual in a floor plan); a section is a vertical cut along a section line. The cut faces are what the plan fills (poché).
//
// Method: every triangle inside the draw range is cut against the plane (signed distances; a corner exactly on the plane
// counts as "above", the usual symbolic perturbation, so a plane through a corner or along a face gives no zero-length or
// doubled segments). Each segment is oriented along n × n_triangle; for a closed solid with outward normals this runs the outer
// outline counter-clockwise and the holes clockwise in the plane basis (u, v = n × u). The segments are chained per material
// group at welded end points (tolerance search, so T-junctions of boolean results chain too). Outlines that do not close
// (the plane grazes an edge of an open mesh) are reported in `offen` and never guessed.
//
// In: three.js BufferGeometry (m, groups per material), plane point and normal. Out: loops with points in m and areas in m².

import { dreieckIndizes, dreieckGruppen } from "./dreiecke.js";

/**
 * Weld tolerance of segment end points in m (0.01 mm). [ASSUMED] the same value as WASSERDICHT_TOLERANZ_M: far below any
 * building tolerance, far above the Float32 noise of local coordinates (≈ 1e-7 m at 10 m); the tests close every loop
 * with it, including T-junctions of boolean results. Way to a proven value: open chains (`offen`) on real projects (107-09).
 */
export const SCHNITT_TOLERANZ_M = 1e-5;

/**
 * @typedef {{x: number, y: number, z: number}} P3
 * @typedef {object} SchnittSchleife
 * @property {P3[]} punkte          closed outline (first point not repeated), m
 * @property {number} gruppe        material index of the group
 * @property {number} flaeche_m2    area, m², always ≥ 0
 * @property {boolean} loch         true for an inner loop (hole), detected by its orientation
 * @property {number} flaecheSigniert_m2 positive outer, negative hole
 * @typedef {object} SchnittErgebnis
 * @property {SchnittSchleife[]} schleifen
 * @property {Array<{punkte: P3[], gruppe: number}>} offen  chains that did not close (reported, not guessed)
 * @property {number} flaeche_m2                      net cut area (outer minus holes), m²
 * @property {Record<number, number>} jeGruppe_m2     net cut area per material index, m²
 */

/**
 * Cut of a mesh with a plane.
 * @param {import("three").BufferGeometry} geo closed mesh, outward normals (m)
 * @param {{punkt: P3, normale: P3}} ebene a point on the plane (m) and its normal (any length)
 * @param {{toleranz_m?: number}} [opt]
 * @returns {SchnittErgebnis}
 */
export function schnittMitEbene(geo, { punkt, normale }, { toleranz_m = SCHNITT_TOLERANZ_M } = {}) {
  const nl = Math.hypot(normale.x, normale.y, normale.z) || 1;
  const n = { x: normale.x / nl, y: normale.y / nl, z: normale.z / nl };
  // plane basis: u perpendicular to n, v = n × u
  const hilf = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normiert(kreuz(hilf, n));
  const v = kreuz(n, u);
  const pos = geo.getAttribute("position");
  const idx = dreieckIndizes(geo);
  const grp = dreieckGruppen(geo);
  const dist = (/** @type {number} */ i) => (pos.getX(i) - punkt.x) * n.x + (pos.getY(i) - punkt.y) * n.y + (pos.getZ(i) - punkt.z) * n.z;
  const lage = (/** @type {number} */ i) => ({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });

  // welded end points with a neighbour-cell search
  /** @type {P3[]} */
  const punkte = [];
  /** @type {Map<string, number[]>} */
  const zellen = new Map();
  const zelle = (/** @type {number} */ c) => Math.floor(c / (toleranz_m * 4));
  const punktId = (/** @type {P3} */ p) => {
    const cx = zelle(p.x), cy = zelle(p.y), cz = zelle(p.z);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const id of zellen.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
        const q = punkte[id];
        if (Math.abs(q.x - p.x) <= toleranz_m && Math.abs(q.y - p.y) <= toleranz_m && Math.abs(q.z - p.z) <= toleranz_m) return id;
      }
    }
    const id = punkte.length;
    punkte.push(p);
    const k = `${cx},${cy},${cz}`;
    if (!zellen.has(k)) zellen.set(k, []);
    /** @type {number[]} */ (zellen.get(k)).push(id);
    return id;
  };

  /** @type {Array<{von: number, nach: number, gruppe: number}>} */
  const segmente = [];
  for (let t = 0; t < idx.length; t += 3) {
    const ecken = [idx[t], idx[t + 1], idx[t + 2]];
    const d = ecken.map(dist);
    const oben = d.map((x) => x >= 0);
    if (oben[0] === oben[1] && oben[1] === oben[2]) continue;
    /** @type {P3[]} */
    const schnitt = [];
    for (let e = 0; e < 3; e += 1) {
      const i = e, j = (e + 1) % 3;
      if (oben[i] === oben[j]) continue;
      // canonical order of the edge, so both triangles at an edge compute the same point bit for bit
      const [a, b, da, db] = ecken[i] < ecken[j] ? [ecken[i], ecken[j], d[i], d[j]] : [ecken[j], ecken[i], d[j], d[i]];
      const s = da / (da - db);
      const pa = lage(a), pb = lage(b);
      schnitt.push({ x: pa.x + (pb.x - pa.x) * s, y: pa.y + (pb.y - pa.y) * s, z: pa.z + (pb.z - pa.z) * s });
    }
    if (schnitt.length !== 2) continue;
    const [p0, p1, p2] = ecken.map(lage);
    const nt = kreuz(differenz(p1, p0), differenz(p2, p0));
    const richtung = kreuz(n, nt);
    let [a, b] = schnitt;
    if (punktProdukt(differenz(b, a), richtung) < 0) [a, b] = [b, a];
    const von = punktId(a), nach = punktId(b);
    if (von === nach) continue;
    segmente.push({ von, nach, gruppe: grp[t / 3] });
  }

  // chain per group
  /** @type {Map<string, number[]>} "gruppe|von" → segment numbers */
  const abgang = new Map();
  segmente.forEach((s, i) => {
    const k = `${s.gruppe}|${s.von}`;
    if (!abgang.has(k)) abgang.set(k, []);
    /** @type {number[]} */ (abgang.get(k)).push(i);
  });
  const benutzt = new Uint8Array(segmente.length);
  /** @type {SchnittSchleife[]} */
  const schleifen = [];
  /** @type {Array<{punkte: P3[], gruppe: number}>} */
  const offen = [];
  for (let i = 0; i < segmente.length; i += 1) {
    if (benutzt[i]) continue;
    const g = segmente[i].gruppe;
    const start = segmente[i].von;
    const kette = [start];
    let aktuell = i;
    let geschlossen = false;
    while (true) {
      benutzt[aktuell] = 1;
      const ende = segmente[aktuell].nach;
      if (ende === start) { geschlossen = true; break; }
      kette.push(ende);
      const naechste = (abgang.get(`${g}|${ende}`) || []).find((k) => !benutzt[k]);
      if (naechste === undefined) break;
      aktuell = naechste;
    }
    const pk = kette.map((id) => punkte[id]);
    if (!geschlossen) { offen.push({ punkte: pk, gruppe: g }); continue; }
    let a2 = 0;
    for (let k = 0; k < pk.length; k += 1) {
      const p = pk[k], q = pk[(k + 1) % pk.length];
      a2 += punktProdukt(p, u) * punktProdukt(q, v) - punktProdukt(q, u) * punktProdukt(p, v);
    }
    const fl = a2 / 2;
    schleifen.push({ punkte: pk, gruppe: g, flaeche_m2: Math.abs(fl), loch: fl < 0, flaecheSigniert_m2: fl });
  }
  /** @type {Record<number, number>} */
  const jeGruppe_m2 = {};
  for (const s of schleifen) jeGruppe_m2[s.gruppe] = (jeGruppe_m2[s.gruppe] || 0) + s.flaecheSigniert_m2;
  return { schleifen, offen, flaeche_m2: schleifen.reduce((s, x) => s + x.flaecheSigniert_m2, 0), jeGruppe_m2 };
}

/**
 * Floor plan cut: horizontal plane at height y (y up, as in the 3D scene), in the LOCAL frame of the geometry. The solids of
 * bauteil.js are local: y = 0 is the bottom of the wall (storey elevation + unterkante_versatz_m, i.e. platzierung.ursprung.y),
 * so the studio's `cutHeight` (1.1 m above the storey) is y_m = storey elevation + cutHeight − platzierung.ursprung.y. A
 * caller with a world height uses horizontalschnittWelt().
 * @param {import("three").BufferGeometry} geo
 * @param {number} y_m cut height in m in the frame of the geometry
 * @returns {SchnittErgebnis}
 */
export function horizontalschnitt(geo, y_m) {
  return schnittMitEbene(geo, { punkt: { x: 0, y: y_m, z: 0 }, normale: { x: 0, y: 1, z: 0 } });
}

/**
 * Section cut: vertical plane through a section line in the x/z ground plane of the geometry's frame. The normal points to
 * the left of a → b. For a local solid with a world section line use vertikalschnittWelt().
 * @param {import("three").BufferGeometry} geo
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}}} linie section line in m (frame of the geometry)
 * @returns {SchnittErgebnis}
 */
export function vertikalschnitt(geo, linie) {
  const dx = linie.b.x - linie.a.x, dz = linie.b.z - linie.a.z;
  return schnittMitEbene(geo, { punkt: { x: linie.a.x, y: 0, z: linie.a.z }, normale: { x: -dz, y: 0, z: dx } });
}

/**
 * World point → local frame of a solid (inverse of `platzierung`: translation by ursprung, rotation about +y by drehung_y,
 * the same as mesh.position / mesh.rotation.y).
 * @param {P3} p world point in m
 * @param {{ursprung: P3, drehung_y: number}} platzierung of a SolidErgebnis (bauteil.js)
 * @returns {P3} local point in m
 */
export function weltNachLokal(p, { ursprung, drehung_y }) {
  const x = p.x - ursprung.x, y = p.y - ursprung.y, z = p.z - ursprung.z;
  const c = Math.cos(drehung_y), s = Math.sin(drehung_y);
  // R_y(θ)⁻¹ = R_y(−θ): x = x'·cos θ − z'·sin θ, z = x'·sin θ + z'·cos θ
  return { x: x * c - z * s, y, z: x * s + z * c };
}

/**
 * Floor plan cut of a placed (local) solid at a WORLD height.
 * @param {import("three").BufferGeometry} geo local geometry of a SolidErgebnis
 * @param {{ursprung: P3, drehung_y: number}} platzierung
 * @param {number} y_welt_m cut height in world coordinates in m (storey elevation + cutHeight)
 * @returns {SchnittErgebnis} loops in the LOCAL frame (place them with platzierung for drawing)
 */
export function horizontalschnittWelt(geo, platzierung, y_welt_m) {
  return horizontalschnitt(geo, y_welt_m - platzierung.ursprung.y);
}

/**
 * Section cut of a placed (local) solid along a WORLD section line.
 * @param {import("three").BufferGeometry} geo local geometry of a SolidErgebnis
 * @param {{ursprung: P3, drehung_y: number}} platzierung
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}}} linie section line in world coordinates in m
 * @returns {SchnittErgebnis} loops in the LOCAL frame; the normal points to the left of a → b (as in vertikalschnitt)
 */
export function vertikalschnittWelt(geo, platzierung, linie) {
  const a = weltNachLokal({ x: linie.a.x, y: 0, z: linie.a.z }, platzierung);
  const b = weltNachLokal({ x: linie.b.x, y: 0, z: linie.b.z }, platzierung);
  return vertikalschnitt(geo, { a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } });
}

/** @param {P3} a @param {P3} b @returns {P3} */
function kreuz(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
/** @param {P3} a @param {P3} b @returns {P3} */
function differenz(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
/** @param {P3} a @param {P3} b @returns {number} */
function punktProdukt(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
/** @param {P3} a @returns {P3} */
function normiert(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
