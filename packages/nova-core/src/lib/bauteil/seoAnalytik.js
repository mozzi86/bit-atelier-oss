// 107-10: the analytic reference of the solid relations (D-BK-08b) and the wall profile of the IFC export — pure plane geometry, no
// three.js, no CSG core (the IFC export and the BIM studio use it on their start path; the 107-14 guard allows no /lib/csg/ request
// there). seo.js uses the same functions as the reference its solids are compared against, so solid, quantity and IFC profile come
// from one rule.
//
// Method: the roof surface over a plan point is the LOWEST of the roof planes (dachGeometrie.dachHoeheAn). A volume under the roof over
// a convex plan polygon is split with the convex half-plane primitives of formGeometrie.js (inKonvex) into the regions where one plane
// is the lowest; in each region the height is linear, so area × height at the centroid is exact. Outside the widened roof frame
// (DACH_RAND_M) nothing is cut.
//
// In: roof results (world m), wall base inputs (m), placements. Out: volumes in m³, profile polygons in m.

import { lochImWand } from "./oeffnungen.js";
import { dachEbenen, rahmenEcken } from "./dachGeometrie.js";
import { inKonvex, flaecheSigniert, schwerpunkt } from "../formGeometrie.js";

/**
 * Margin in m by which the cutting bodies of a roof reach beyond the roof frame in plan. [ASSUMED] 1.0 m: a wall whose layers lie
 * beside the roof outline (reference line on the inner face, a thick external wall) is still cut by the extended roof planes, and no
 * wall of a normal house is thicker. A wall part outside the frame plus this margin is not cut (another building part).
 */
export const DACH_RAND_M = 1.0;

const EPS = 1e-9;

/**
 * @typedef {{x: number, z: number}} PktXZ
 * @typedef {{x: number, y: number, z: number}} Pkt3
 */

/**
 * World point → local frame of a placed solid (translation by ursprung, rotation about +y by drehung_y) — the same formula as
 * csg/schnitt.js weltNachLokal, repeated here so this module stays free of the CSG core.
 * @param {Pkt3} p world point in m
 * @param {{ursprung: Pkt3, drehung_y: number}} pl
 * @returns {Pkt3}
 */
export function inRahmen(p, { ursprung, drehung_y }) {
  const x = p.x - ursprung.x, y = p.y - ursprung.y, z = p.z - ursprung.z;
  const c = Math.cos(drehung_y), s = Math.sin(drehung_y);
  return { x: x * c - z * s, y, z: x * s + z * c };
}

/**
 * Height of a plane as a linear function of the plan point: height = A·x + B·z + C (m).
 * @param {{punkt: Pkt3, normale: Pkt3}} e plane with a non-vertical normal
 * @returns {{A: number, B: number, C: number}}
 */
export function koeffizienten(e) {
  const n = e.normale, p = e.punkt;
  return { A: -n.x / n.y, B: -n.z / n.y, C: p.y + (n.x * p.x + n.z * p.z) / n.y };
}

/**
 * Convex polygon cut by half-planes n·p ≤ c (inKonvex of formGeometrie.js); a half-plane without direction (both coefficients 0) is
 * either everything or nothing.
 * @param {PktXZ[]} poly
 * @param {Array<{nx: number, nz: number, c: number}>} hs
 * @returns {PktXZ[][]}
 */
export function imKonvex(poly, hs) {
  let teile = [poly];
  for (const h of hs) {
    if (Math.abs(h.nx) < 1e-12 && Math.abs(h.nz) < 1e-12) {
      if (h.c < -1e-12) return [];
      continue;
    }
    teile = teile.flatMap((t) => inKonvex(t, [h]));
    if (!teile.length) return [];
  }
  return teile;
}

/** @param {PktXZ[]} poly @returns {number} m² */
export const flaeche_m2 = (poly) => Math.abs(flaecheSigniert(poly));

/**
 * Half-planes (n·p ≤ c) of a convex polygon (inside = the side of its centroid).
 * @param {PktXZ[]} poly
 * @returns {Array<{nx: number, nz: number, c: number}>}
 */
export function konvexHalbebenen(poly) {
  const m = schwerpunkt(poly);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    let nx = b.z - a.z, nz = -(b.x - a.x);
    if (nx * (m.x - a.x) + nz * (m.z - a.z) > 0) { nx = -nx; nz = -nz; }
    return { nx, nz, c: nx * a.x + nz * a.z };
  });
}

/**
 * Exact volume in m³ of ∫ (clamp(roof height, ylo, yhi) − ylo) dA over a convex plan polygon: outside the roof box the full height
 * (no cut), inside the box per region where one plane is the lowest (see file head).
 * @param {PktXZ[]} R convex polygon (m, frame of the planes)
 * @param {number} ylo lower bound in m
 * @param {number} yhi upper bound in m
 * @param {{ebenen: Array<{punkt: Pkt3, normale: Pkt3}>, box: PktXZ[]}|null} d roof planes and box in the same frame
 * @returns {number} m³
 */
export function volumenUnterDach_m3(R, ylo, yhi, d) {
  const hoehe = yhi - ylo;
  if (!(hoehe > 0)) return 0;
  const aR = flaeche_m2(R);
  if (!d || !d.ebenen.length) return aR * hoehe;
  const innen = imKonvex(R, konvexHalbebenen(d.box));
  const aIn = innen.reduce((s, t) => s + flaeche_m2(t), 0);
  let v = Math.max(0, aR - aIn) * hoehe;
  const k = d.ebenen.map(koeffizienten);
  for (const P of innen) {
    for (let i = 0; i < k.length; i += 1) {
      /** @type {Array<{nx: number, nz: number, c: number}>} */
      const hs = [];
      for (let j = 0; j < k.length; j += 1) {
        if (j === i) continue;
        // plane i is the lowest: h_i ≤ h_j; equal planes go to the lower index (so a region is never counted twice)
        const nx = k[i].A - k[j].A, nz = k[i].B - k[j].B, c = k[j].C - k[i].C;
        if (Math.abs(nx) < 1e-12 && Math.abs(nz) < 1e-12 && Math.abs(c) < 1e-12) { if (j < i) hs.push({ nx: 0, nz: 0, c: -1 }); continue; }
        hs.push({ nx, nz, c });
      }
      for (const Q of imKonvex(P, hs)) {
        const e = k[i];
        // between ylo and yhi: area × (height at the centroid − ylo), exact for a linear height
        for (const T of imKonvex(Q, [{ nx: -e.A, nz: -e.B, c: e.C - ylo }, { nx: e.A, nz: e.B, c: yhi - e.C }])) {
          const a = flaeche_m2(T);
          if (a < EPS) continue;
          const m = schwerpunkt(T);
          v += a * (e.A * m.x + e.B * m.z + e.C - ylo);
        }
        // above yhi: the full height
        for (const T of imKonvex(Q, [{ nx: -e.A, nz: -e.B, c: e.C - yhi }])) v += flaeche_m2(T) * hoehe;
      }
    }
  }
  return v;
}

/**
 * Roof planes and the widened roof frame of a roof result in the LOCAL frame of a placed solid (wall frame of wandSolid).
 * @param {import("./dachGeometrie.js").DachErgebnis} dach roof in world coordinates (m)
 * @param {{ursprung: Pkt3, drehung_y: number}} pl placement of the solid
 * @returns {{ebenen: Array<{id: string, punkt: Pkt3, normale: Pkt3}>, box: PktXZ[]}}
 */
export function dachImRahmen(dach, pl) {
  const u = pl.ursprung;
  const drehen = (/** @type {Pkt3} */ v) => inRahmen({ x: v.x + u.x, y: v.y + u.y, z: v.z + u.z }, pl);
  const ebenen = dachEbenen(dach).map((e) => ({ id: e.id, punkt: inRahmen(e.punkt, pl), normale: drehen(e.normale) }));
  const r = dach.rahmen;
  const box = rahmenEcken({ ...r, halbL_m: r.halbL_m + DACH_RAND_M, halbB_m: r.halbB_m + DACH_RAND_M }).map((p) => {
    const q = inRahmen({ x: p.x, y: 0, z: p.z }, pl);
    return { x: q.x, z: q.z };
  });
  return { ebenen, box };
}

/**
 * Analytic volume of a (layered) wall under one roof, m³ (see file head). The wall's local frame of wandSolid: x along the wall from
 * a (0…L), y up from the wall bottom (0…H), z across, layer 1 at +D/2. Openings are the clamped rectangles of lochImWand through all
 * layers. [ASSUMED] openings do not overlap each other (two overlapping holes are subtracted twice here; the solid cuts them once, so
 * the comparison would warn — the quantity then is this one, too small by the overlap; way to exact: the rectangle union of
 * volumen.js applied per roof region).
 * @param {{laenge_m: number, hoehe_m: number, schichten: Array<{dicke_m: number}>, oeffnungen: Array<{u: number|null, width: number, height: number, sill: number}>}} basis base inputs of the wall (csg/bauteil.js wandBasis, m)
 * @param {{ebenen: Array<{punkt: Pkt3, normale: Pkt3}>, box: PktXZ[]}|null} d roof in the wall frame (dachImRahmen); null = no roof
 * @returns {{gesamt_m3: number, jeSchicht_m3: number[]}}
 */
export function analytischWandUnterDach(basis, d) {
  const L = basis.laenge_m, H = basis.hoehe_m;
  const D = basis.schichten.reduce((s, x) => s + x.dicke_m, 0);
  const loecher = basis.oeffnungen.map((o) => lochImWand({ w: o.width, h: o.height, sill: o.sill }, o.u, L, H)).filter((r) => r && r.x1 > r.x0 && r.y1 > r.y0);
  const rechteck = (/** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ z0, /** @type {number} */ z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  /** @type {number[]} */
  const jeSchicht_m3 = [];
  let z = D / 2;
  for (const s of basis.schichten) {
    const z1 = z, z0 = z - s.dicke_m;
    z = z0;
    let v = volumenUnterDach_m3(rechteck(0, L, z0, z1), 0, H, d);
    for (const r of loecher) v -= volumenUnterDach_m3(rechteck(/** @type {any} */ (r).x0, /** @type {any} */ (r).x1, z0, z1), /** @type {any} */ (r).y0, /** @type {any} */ (r).y1, d);
    jeSchicht_m3.push(v);
  }
  return { gesamt_m3: jeSchicht_m3.reduce((s, x) => s + x, 0), jeSchicht_m3 };
}

/**
 * Profile of a wall under a roof in the WALL PLANE, for the IFC export (107-10 task 4: IfcArbitraryClosedProfileDef extruded over the
 * thickness, from the analytic outline — never from the solid, D-BK-08b). The top edge is the clamped roof height along the wall,
 * piecewise linear: every point where two planes cross, a plane reaches the wall bottom or top, or the line leaves the widened roof
 * frame is a corner. When a plane changes across the thickness (an eaves wall: the roof rises from the outer to the inner face) a
 * straight extrusion cannot show the bevel: the profile then takes the LOWER of both faces (`quer_geneigt: true`, the caller reports
 * that the inclined top exists only in 3D and in the quantities).
 * @param {{laenge_m: number, hoehe_m: number, dicke_m: number}} w wall length, height, total thickness in m
 * @param {{ebenen: Array<{punkt: Pkt3, normale: Pkt3}>, box: PktXZ[]}} d roof in the wall frame (dachImRahmen: x along the wall from a,
 *   y up from the wall bottom, z across)
 * @returns {{punkte: Array<{x: number, y: number}>, quer_geneigt: boolean, flaeche_m2: number}} polygon in m (x along the wall 0…L, y
 *   height above the wall bottom), bottom edge first
 */
export function wandProfilUnterDach({ laenge_m: L, hoehe_m: H, dicke_m: D }, d) {
  const k = d.ebenen.map(koeffizienten);
  const hs = konvexHalbebenen(d.box);
  const seiten = [-D / 2, D / 2];
  const imRahmen = (/** @type {number} */ x, /** @type {number} */ z) => hs.every((h) => h.nx * x + h.nz * z <= h.c + 1e-9);
  const dachAn = (/** @type {number} */ x, /** @type {number} */ z) => (imRahmen(x, z) ? Math.min(...k.map((e) => e.A * x + e.B * z + e.C)) : Infinity);
  const y = (/** @type {number} */ x) => Math.max(0, Math.min(H, ...seiten.map((z) => dachAn(x, z))));
  const quer_geneigt = k.some((e) => Math.abs(e.B) * D > 1e-6) && seiten.some((z) => [0, L].some((x) => dachAn(x, z) < H - 1e-9));
  /** @type {number[]} */
  const xs = [0, L];
  const linie = (/** @type {{A: number, B: number, C: number}} */ e, /** @type {number} */ z) => ({ a: e.A, b: e.B * z + e.C });
  const geraden = seiten.flatMap((z) => k.map((e) => linie(e, z)));
  for (let i = 0; i < geraden.length; i += 1) {
    const g = geraden[i];
    if (Math.abs(g.a) > EPS) xs.push(-g.b / g.a, (H - g.b) / g.a);
    for (let j = i + 1; j < geraden.length; j += 1) if (Math.abs(g.a - geraden[j].a) > EPS) xs.push((geraden[j].b - g.b) / (g.a - geraden[j].a));
  }
  // where the wall line leaves the widened roof frame (the height jumps to H there: both sides are kept)
  /** @type {number[]} */
  const spruenge = [];
  for (const z of seiten) {
    for (let i = 0; i < d.box.length; i += 1) {
      const p = d.box[i], q = d.box[(i + 1) % d.box.length];
      if (Math.abs(q.z - p.z) < EPS || (z - p.z) * (z - q.z) > 0) continue;
      spruenge.push(p.x + ((z - p.z) / (q.z - p.z)) * (q.x - p.x));
    }
  }
  const alle = [...new Set([...xs, ...spruenge].filter((x) => x >= -1e-9 && x <= L + 1e-9).map((x) => Math.round(Math.min(L, Math.max(0, x)) * 1e9) / 1e9))].sort((a, b) => a - b);
  /** @type {Array<{x: number, y: number}>} */
  const oben = [];
  for (const x of alle) {
    if (spruenge.some((s) => Math.abs(s - x) < 1e-9)) {
      oben.push({ x, y: y(Math.max(0, x - 1e-7)) }, { x, y: y(Math.min(L, x + 1e-7)) });
    } else oben.push({ x, y: y(x) });
  }
  /** @type {Array<{x: number, y: number}>} */
  const punkte = [{ x: 0, y: 0 }, { x: L, y: 0 }, ...oben.reverse()];
  const sauber = punkte.filter((p, i) => {
    const q = punkte[(i + punkte.length - 1) % punkte.length];
    return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9;
  });
  return { punkte: sauber, quer_geneigt, flaeche_m2: Math.abs(flaecheSigniert(sauber.map((p) => ({ x: p.x, z: p.y })))) };
}
