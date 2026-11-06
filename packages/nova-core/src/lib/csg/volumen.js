// 107-14 (D-BK-08b): volume of a solid, volume per material group, the analytic reference (area times thickness, openings
// subtracted) and the comparison of both.
//
// Why the quantity is analytic when in doubt: quantities go into tendering and billing, a silent wrong quantity costs money.
// The 3D view may show the solid; the quantity comes from the solid only when it agrees with the hand rule. Above the
// threshold the component gets a warning and the quantity is the analytic one.
//
// Volume method: signed tetrahedron sum Σ v0·(v1×v2)/6 over the triangles inside the draw range (divergence theorem),
// summed in double precision against the origin of the geometry's frame. The accuracy comes from the LOCAL coordinates
// the core computes in (bauteil.js: wall start / middle of the slab profile), not from a shifted reference point.
//
// In: three.js BufferGeometry (m), base sizes of a wall or slab (m). Out: volumes in m³, comparison report.

import { dreieckIndizes, dreieckGruppen } from "./dreiecke.js";
import { lochImWand } from "../bauteil/oeffnungen.js";

/**
 * Relative threshold of the volume comparison: 0.2 %. [ASSUMED] Measured 26.10.2026 (tests/unit/csg-10714.test.js, local
 * coordinates, Float32 positions): wall 4 × 2.5 × 0.3 m minus one opening 4.9e-8 relative, corner union 2.9e-7, corner
 * intersection (0.1125 m³) 6.8e-7 — the noise stays below 1e-6 relative; a missing hole of 0.2 × 0.2 m in a 4 × 2.5 m wall of
 * 0.3 m is 0.4 %, so the threshold lies between both with a factor > 1 000 to the noise. The same wall built in WORLD
 * coordinates at x = 1 000 m deviated by 2.76e-3 m³ = 0.1 % — half the threshold; that is why the core computes locally.
 * Way to a proven value: the spread of the comparisons on real projects once 107-09 runs the core on every wall.
 */
export const ABWEICHUNG_SCHWELLE_REL = 0.002;

/** Absolute floor of the comparison in m³ (0.1 l), so tiny parts do not warn on noise. [ASSUMED] same source as above. */
export const ABWEICHUNG_BODEN_M3 = 1e-4;

/**
 * Signed volume of a closed mesh in m³ (positive = outward normals).
 * @param {import("three").BufferGeometry} geo
 * @returns {number} m³
 */
export function volumen_m3(geo) {
  const idx = dreieckIndizes(geo);
  return summe(geo, idx, null, 0);
}

/**
 * Volume per material index in m³ — one entry per `materialIndex` of `geo.groups`. Correct when every group is a closed
 * solid of its own (layers side by side, geometrienZusammenfuegen), which the CSG core guarantees for its layer solids.
 * @param {import("three").BufferGeometry} geo
 * @returns {Record<number, number>} materialIndex → m³
 */
export function volumenJeGruppe(geo) {
  const idx = dreieckIndizes(geo);
  const grp = dreieckGruppen(geo);
  /** @type {Record<number, number>} */
  const out = {};
  for (const m of new Set(grp)) out[m] = summe(geo, idx, grp, m);
  return out;
}

/**
 * @param {import("three").BufferGeometry} geo
 * @param {Uint32Array} idx
 * @param {Int32Array|null} grp
 * @param {number} nur material index to sum (with grp)
 * @returns {number}
 */
function summe(geo, idx, grp, nur) {
  const pos = geo.getAttribute("position");
  if (!pos || !idx.length) return 0;
  // fixed reference for every group (the origin of the local frame), so per-group sums add up to the total
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    if (grp && grp[t / 3] !== nur) continue;
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/**
 * Analytic volume of a (layered) straight wall in m³: Σ per layer (length × height − hole area) × layer thickness. The
 * holes use the SAME clamping as the 3D wall profile and the CSG opening body (lochImWand: 5 cm to the wall ends, 2 cm to the
 * bottom and top). The hole area is the area of the UNION of the clamped rectangles (review 107-14): two overlapping
 * openings are cut once by the solid, so the hand rule subtracts their overlap once as well — otherwise the fallback
 * quantity would be too small by the overlap.
 * @param {{laenge_m: number, hoehe_m: number, schichten_m: number[], oeffnungen?: Array<{u?: number|null, sill: number, width: number, height: number}>}} w
 *   lengths in m; schichten_m = layer thicknesses outside → inside; opening u = stored middle along the wall from a
 * @returns {{gesamt_m3: number, jeSchicht_m3: number[], lochflaeche_m2: number}}
 */
export function analytischWand({ laenge_m, hoehe_m, schichten_m, oeffnungen = [] }) {
  /** @type {Array<{x0: number, x1: number, y0: number, y1: number}>} */
  const rechtecke = [];
  for (const o of oeffnungen) {
    const r = lochImWand({ w: o.width, h: o.height, sill: o.sill }, o.u, laenge_m, hoehe_m);
    if (r && r.x1 > r.x0 && r.y1 > r.y0) rechtecke.push(r);
  }
  const loch = rechteckVereinigung_m2(rechtecke);
  const netto = laenge_m * hoehe_m - loch;
  const jeSchicht_m3 = schichten_m.map((d) => netto * d);
  return { gesamt_m3: jeSchicht_m3.reduce((s, x) => s + x, 0), jeSchicht_m3, lochflaeche_m2: loch };
}

/**
 * Area of the union of axis-aligned rectangles in m² (strips between the sorted x edges; per strip the covered y length of
 * the merged intervals). Exact for any overlap; O(n² log n), n = openings of one wall.
 * @param {Array<{x0: number, x1: number, y0: number, y1: number}>} rechtecke corners in m (x0 < x1, y0 < y1)
 * @returns {number} m²
 */
export function rechteckVereinigung_m2(rechtecke) {
  if (!rechtecke.length) return 0;
  const xs = [...new Set(rechtecke.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let flaeche = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const xa = xs[i], xb = xs[i + 1];
    const iv = rechtecke.filter((r) => r.x0 <= xa && r.x1 >= xb).map((r) => [r.y0, r.y1]).sort((a, b) => a[0] - b[0]);
    let laenge = 0, bis = -Infinity;
    for (const [a, b] of iv) {
      if (b <= bis) continue;
      laenge += b - Math.max(a, bis);
      bis = b;
    }
    flaeche += laenge * (xb - xa);
  }
  return flaeche;
}

/**
 * Analytic volume of a flat slab in m³: (area − Σ hole areas) × thickness.
 * @param {{flaeche_m2: number, dicke_m: number, loecher_m2?: number[]}} p area and holes in m², thickness in m
 * @returns {number} m³
 */
export function analytischPlatte({ flaeche_m2, dicke_m, loecher_m2 = [] }) {
  return (flaeche_m2 - loecher_m2.reduce((s, x) => s + x, 0)) * dicke_m;
}

/**
 * @typedef {object} VolumenWarnung
 * @property {"csg-abweichung"|"csg-offen"|"csg-fehler"|"csg-ungueltig"} code
 *   csg-ungueltig = degenerate input (no length, height, area or thickness); csg-fehler = the library could not be loaded or threw
 * @property {number|null} [solid_m3]
 * @property {number} [analytisch_m3]
 * @property {number|null} [abweichung_rel]
 * @property {string} [eingabe]   for csg-offen: "a" | "b" | "ergebnis"
 * @property {"wand"|"platte"} [art] for csg-ungueltig: the kind of component
 * @property {string} [text]      for csg-fehler: the technical message of the library or the loader (not translated)
 */

/**
 * Comparison of the solid volume against the analytic one. Within max(threshold × analytic, floor) the solid volume is the
 * quantity; above it the analytic volume is, with a warning (see file head). A missing solid (null/NaN) also falls back.
 * @param {{solid_m3: number|null, analytisch_m3: number}} v m³
 * @returns {{ok: boolean, abweichung_rel: number|null, abweichung_m3: number|null, menge_m3: number, quelle: "solid"|"analytisch", warnung: VolumenWarnung|null}}
 */
export function volumenAbgleich({ solid_m3, analytisch_m3 }) {
  if (solid_m3 == null || !Number.isFinite(solid_m3)) {
    return { ok: false, abweichung_rel: null, abweichung_m3: null, menge_m3: analytisch_m3, quelle: "analytisch", warnung: { code: "csg-abweichung", solid_m3: null, analytisch_m3, abweichung_rel: null } };
  }
  const abweichung_m3 = Math.abs(solid_m3 - analytisch_m3);
  const abweichung_rel = Math.abs(analytisch_m3) > 0 ? abweichung_m3 / Math.abs(analytisch_m3) : abweichung_m3 > 0 ? Infinity : 0;
  const grenze = Math.max(ABWEICHUNG_SCHWELLE_REL * Math.abs(analytisch_m3), ABWEICHUNG_BODEN_M3);
  if (abweichung_m3 <= grenze) return { ok: true, abweichung_rel, abweichung_m3, menge_m3: solid_m3, quelle: "solid", warnung: null };
  return { ok: false, abweichung_rel, abweichung_m3, menge_m3: analytisch_m3, quelle: "analytisch", warnung: { code: "csg-abweichung", solid_m3, analytisch_m3, abweichung_rel } };
}
