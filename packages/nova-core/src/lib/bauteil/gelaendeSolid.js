// 107-10 task 6 (BK-50, D-BK-20, D-BK-08/08a/08b): the basement as a body with the terrain subtraction, on the Massing studio's
// sandbox terrain (massing_layer.gelaende, massing/gelaende.js) and the basement of the building model (107-13: programme field
// `untergeschosse`, negative levels, `fusshoehe_m`, the basement hull walls with `unterirdisch`). No basement wall is created here.
//
//  - Terrain block: the height grid as a CLOSED body — top surface = the grid triangles exactly as MassingView3D draws them, four
//    side walls along the grid edge, a bottom GELAENDE_BODEN_M below the lowest point (and below the basement). An open surface
//    would not do: the CSG core refuses open inputs (watertight check, 107-14).
//  - Basement body = footprint × [fusshoehe_m, 0] — the building, not the excavation.
//  - Excavation pit prism = footprint × [fusshoehe_m, highest terrain point in the footprint + BAUGRUBE_RESERVE_M]: the excavation
//    reaches up to the terrain surface, which may lie above ±0.00 (heights h are relative to ±0).
//  - Excavation = terrain block ∩ pit prism (`intersect`); terrain after the excavation = terrain block − pit prism (`subtract`,
//    the remaining ground with the pit, not the excavation); earth-contact part of a basement wall = wall solid ∩ terrain block
//    (`intersect`, before the excavation). This is the operation `abzug_nach_unten` of the core, but it writes NO relation into
//    solidrelationen_layer: terrain and basement have no persisted GUID, the relation follows from `untergeschosse > 0` and an
//    existing terrain; the derived ids `gelaende` and `ug` appear only in the cache key (gelaendeCacheSchluessel).
//  - Reference (D-BK-08b): stempeln() of massing/gelaende.js (node method, `abtrag` in m³). It is a node sum, not exact: on a slope
//    it lies a little below the exact prism volume (h = 0.1·x over 10 × 8 m: 276 against 280 m³), hence a threshold of its own
//    (GELAENDE_SCHWELLE_REL). Above it: warning, quantity from the grid. Without a terrain grid there is no block: only the basement
//    body, the quantity = footprint area × depth.
//
// Frames: the grid and the footprint are in SITE metres {x, y} (Massing studio, y = screen down); the solids are built in a local
// frame around the middle of the grid (x = site.x − mx, y = height, z = site.y − my), which is the 3D frame of MassingView3D shifted
// by (mx − siteW/2, my − siteD/2). Basement walls of the building model are in MODEL metres {x, z}: site = model + `bezug`
// (massing.bezug, ifcExport.js: model = site − bezug).
//
// In: grid, footprint (site m), fusshoehe_m (m, negative), optional basement walls + bezug, ctx {kern?}. Out: geometries (local) and
// volumes in m³, comparison, warning. Asynchronous (the CSG core is loaded lazily).

import * as THREE from "three";
import { csgLaden } from "../csg/laden.js";
import { profilKoerper } from "../csg/koerper.js";
import { istWasserdicht } from "../csg/wasserdicht.js";
import { volumen_m3 } from "../csg/volumen.js";
import { dreieckAnzahl, geometrieJeGruppe } from "../csg/dreiecke.js";
import { wandSolid } from "../csg/bauteil.js";
import { basisHash } from "../csg/basisHash.js";
import { cacheSchluessel } from "../csg/cache.js";
import { hoeheAn, stempeln } from "../massing/gelaende.js";
import { flaecheSigniert } from "../formGeometrie.js";

/** Reserve in m of the excavation pit above the highest terrain point in the footprint. [ASSUMED] 1.0 m: only a construction height so the prism top never touches the terrain surface; it removes nothing (nothing is above the terrain). */
export const BAUGRUBE_RESERVE_M = 1.0;

/** Depth in m of the terrain block's bottom below the lowest point of terrain and basement. [ASSUMED] 1.0 m: construction height, keeps the bottom away from the pit floor (no coplanar faces). */
export const GELAENDE_BODEN_M = 1.0;

/**
 * Relative threshold of the terrain comparison (solid against stempeln): 2 %. [ASSUMED] backed only by the hand calculation of the
 * plan (footprint 10 × 8 m on a 1 m grid, slope h = 0.1·x: node method 276 m³ against exactly 280 m³ = 1.4 % below). A coarser cell
 * or a steeper slope makes the node method deviate more — then make the cell smaller instead of raising the threshold.
 */
export const GELAENDE_SCHWELLE_REL = 0.02;

/** Absolute floor of the terrain comparison in m³. [ASSUMED] 0.5 m³, same source as GELAENDE_SCHWELLE_REL. */
export const GELAENDE_BODEN_M3 = 0.5;

/**
 * Relative tolerance of the volume balance block = excavation + remaining terrain (see untergeschossMitGelaende). [ASSUMED] 1e-6: the
 * measured balance error is 1e-9 relative (Float32 positions in the local frame); a missing face of one cell (1 m² × 1 m) in a block of
 * 1 600 m³ is 6e-4 — three orders of magnitude above the tolerance.
 */
export const BILANZ_TOLERANZ_REL = 1e-6;

/**
 * @typedef {import("../massing/gelaende.js").Gelaende} Gelaende
 * @typedef {{x: number, y: number}} PktSite
 */

/**
 * Is the grid usable (≥ 2 × 2 nodes, a height per node)?
 * @param {any} g
 * @returns {boolean}
 */
export function gelaendeGueltig(g) {
  return !!g && g.nx >= 2 && g.ny >= 2 && g.zelle > 0 && Array.isArray(g.h) && g.h.length === g.nx * g.ny;
}

/**
 * Middle of the grid in site metres (origin of the local frame of the solids).
 * @param {Gelaende} g
 * @returns {PktSite}
 */
export function gelaendeMitte(g) {
  return { x: g.x0 + ((g.nx - 1) * g.zelle) / 2, y: g.y0 + ((g.ny - 1) * g.zelle) / 2 };
}

/**
 * Closed terrain block (see file head) in the local frame around `mitte`.
 * @param {Gelaende} g
 * @param {number} unten_m height of the bottom in m (below every terrain point)
 * @param {PktSite} [mitte] default gelaendeMitte(g)
 * @returns {THREE.BufferGeometry} outward normals, one group (material 0)
 */
export function gelaendeBlock(g, unten_m, mitte = gelaendeMitte(g)) {
  const { nx, ny, zelle } = g;
  const X = (/** @type {number} */ i) => g.x0 + i * zelle - mitte.x, Z = (/** @type {number} */ j) => g.y0 + j * zelle - mitte.y;
  const H = (/** @type {number} */ i, /** @type {number} */ j) => Number(g.h[j * nx + i]) || 0;
  const oben = (/** @type {number} */ i, /** @type {number} */ j) => [X(i), H(i, j), Z(j)];
  const boden = (/** @type {number} */ i, /** @type {number} */ j) => [X(i), unten_m, Z(j)];
  /** @type {number[]} */
  const pos = [];
  const tri = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number[]} */ c) => pos.push(...a, ...b, ...c);
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      // top: the triangulation of MassingView3D (a, c, b), (b, c, d) — faces up
      tri(oben(i, j), oben(i, j + 1), oben(i + 1, j));
      tri(oben(i + 1, j), oben(i, j + 1), oben(i + 1, j + 1));
      // bottom: the same grid, faces down
      tri(boden(i, j), boden(i + 1, j), boden(i, j + 1));
      tri(boden(i + 1, j), boden(i + 1, j + 1), boden(i, j + 1));
    }
  }
  // sides along the grid edge, walked +x, +z, −x, −z (outward to the right): (p, q, q'), (p, q', p')
  /** @type {Array<[number, number]>} */
  const rand = [];
  for (let i = 0; i < nx - 1; i += 1) rand.push([i, 0]);
  for (let j = 0; j < ny - 1; j += 1) rand.push([nx - 1, j]);
  for (let i = nx - 1; i > 0; i -= 1) rand.push([i, ny - 1]);
  for (let j = ny - 1; j > 0; j -= 1) rand.push([0, j]);
  for (let k = 0; k < rand.length; k += 1) {
    const [pi, pj] = rand[k], [qi, qj] = rand[(k + 1) % rand.length];
    tri(oben(pi, pj), oben(qi, qj), boden(qi, qj));
    tri(oben(pi, pj), boden(qi, qj), boden(pi, pj));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.addGroup(0, pos.length / 3, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Highest terrain point over a footprint in m: every grid node inside the footprint's bounding box widened by one cell, and the
 * terrain under the footprint's corners (conservative — only the top of the pit prism depends on it).
 * @param {Gelaende} g
 * @param {PktSite[]} profil footprint in site m
 * @returns {number} m
 */
export function gelaendeMaxImUmriss(g, profil) {
  const xs = profil.map((p) => p.x), ys = profil.map((p) => p.y);
  const x0 = Math.min(...xs) - g.zelle, x1 = Math.max(...xs) + g.zelle, y0 = Math.min(...ys) - g.zelle, y1 = Math.max(...ys) + g.zelle;
  let m = -Infinity;
  for (let k = 0; k < g.h.length; k += 1) {
    const x = g.x0 + (k % g.nx) * g.zelle, y = g.y0 + Math.floor(k / g.nx) * g.zelle;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) m = Math.max(m, Number(g.h[k]) || 0);
  }
  for (const p of profil) m = Math.max(m, hoeheAn(g, p));
  return Number.isFinite(m) ? m : 0;
}

/**
 * Cache key and hash of the terrain derivation (D-BK-08a): the derived ids `gelaende|ug` — never a stored component GUID — plus a
 * hash over grid, footprint and fusshoehe_m.
 * @param {Gelaende|null} g
 * @param {PktSite[]} profil
 * @param {number} fusshoehe_m
 * @returns {{schluessel: string, hash: string}}
 */
export function gelaendeCacheSchluessel(g, profil, fusshoehe_m) {
  return { schluessel: cacheSchluessel("gelaende", "ug"), hash: basisHash({ gelaende: g, profil, fusshoehe_m, reserve_m: BAUGRUBE_RESERVE_M, boden_m: GELAENDE_BODEN_M }) };
}

/**
 * Comparison of the excavation solid against the grid reference (stempeln) with the terrain threshold.
 * @param {number|null} solid_m3
 * @param {number} raster_m3
 * @returns {{ok: boolean, abweichung_rel: number|null, menge_m3: number, quelle: "solid"|"raster", warnung: {code: "csg-abweichung", solid_m3: number|null, analytisch_m3: number, abweichung_rel: number|null}|null}}
 */
export function gelaendeAbgleich(solid_m3, raster_m3) {
  if (solid_m3 == null || !Number.isFinite(solid_m3)) return { ok: false, abweichung_rel: null, menge_m3: raster_m3, quelle: "raster", warnung: { code: "csg-abweichung", solid_m3: null, analytisch_m3: raster_m3, abweichung_rel: null } };
  const d = Math.abs(solid_m3 - raster_m3);
  const rel = Math.abs(raster_m3) > 0 ? d / Math.abs(raster_m3) : d > 0 ? Infinity : 0;
  if (d <= Math.max(GELAENDE_SCHWELLE_REL * Math.abs(raster_m3), GELAENDE_BODEN_M3)) return { ok: true, abweichung_rel: rel, menge_m3: solid_m3, quelle: "solid", warnung: null };
  return { ok: false, abweichung_rel: rel, menge_m3: raster_m3, quelle: "raster", warnung: { code: "csg-abweichung", solid_m3, analytisch_m3: raster_m3, abweichung_rel: rel } };
}

/**
 * Reference volume in m³ of the part of a (layered) basement wall that lies in the terrain: per layer thickness × ∫ (clamped terrain
 * height − wall bottom) along the wall's middle line, Simpson's rule with two steps per grid cell on the bilinear terrain of hoeheAn
 * (exact for a terrain plane, close for a grid — compared with the terrain threshold).
 * @param {{a: {x: number, z: number}, b: {x: number, z: number}}} wandSite wall line in site m ({x, z: site y})
 * @param {number} unten_m wall bottom in m
 * @param {number} oben_m wall top in m
 * @param {number} dicke_m total thickness in m
 * @param {Gelaende} g
 * @returns {number} m³
 */
export function erdberuehrtReferenz_m3(wandSite, unten_m, oben_m, dicke_m, g) {
  const L = Math.hypot(wandSite.b.x - wandSite.a.x, wandSite.b.z - wandSite.a.z);
  if (!(L > 0)) return 0;
  const n = 2 * Math.max(1, Math.ceil((2 * L) / g.zelle));
  const f = (/** @type {number} */ t) => {
    const h = hoeheAn(g, { x: wandSite.a.x + (wandSite.b.x - wandSite.a.x) * t, y: wandSite.a.z + (wandSite.b.z - wandSite.a.z) * t });
    return Math.max(0, Math.min(h, oben_m) - unten_m);
  };
  let s = f(0) + f(1);
  for (let i = 1; i < n; i += 1) s += (i % 2 ? 4 : 2) * f(i / n);
  return dicke_m * L * (s / (3 * n));
}

/**
 * @typedef {object} UgErgebnis
 * @property {boolean} mitGelaende        a terrain grid was there
 * @property {boolean} [dicht]            both terrain results passed the strict watertight check (false: accepted by volume balance, see above)
 * @property {PktSite} mitte              origin of the local frame in site m
 * @property {{geometrie: THREE.BufferGeometry, volumen_m3: number}} ug   basement body (local)
 * @property {{geometrie: THREE.BufferGeometry|null, solid_m3: number|null, raster_m3: number|null, menge_m3: number, quelle: "solid"|"raster"|"analytisch", abweichung_rel: number|null, warnung: any}} aushub
 * @property {{geometrie: THREE.BufferGeometry|null, volumen_m3: number|null}} gelaendeNach terrain after the excavation (local)
 * @property {number|null} block_m3       volume of the terrain block before the excavation
 * @property {Array<{schluessel: string, solid_m3: number|null, referenz_m3: number, menge_m3: number, quelle: "solid"|"raster", warnung: any}>} erdberuehrt
 * @property {{schluessel: string, hash: string}} cache
 * @property {any} [fehler]               warning of a refused boolean (then no solids, quantities from the grid)
 */

/**
 * Basement with terrain subtraction (see file head).
 * @param {{gelaende?: Gelaende|null, profil: PktSite[], fusshoehe_m: number, waende?: any[], bezug?: PktSite|null, geschosse?: any}} e
 *   profil: basement footprint in site m; fusshoehe_m: bottom of the basement (negative, m); waende: basement hull walls of the building
 *   model (model m, `unterirdisch`) for the earth contact; bezug: site point of the model origin
 * @param {{kern?: any}} [ctx]
 * @returns {Promise<UgErgebnis>}
 */
export async function untergeschossMitGelaende({ gelaende = null, profil, fusshoehe_m, waende = [], bezug = null, geschosse = null }, ctx = {}) {
  const g = gelaendeGueltig(gelaende) ? /** @type {Gelaende} */ (gelaende) : null;
  const mitte = g ? gelaendeMitte(g) : (() => {
    const xs = profil.map((p) => p.x), ys = profil.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  })();
  const ring = profil.map((p) => ({ x: p.x - mitte.x, z: p.y - mitte.y }));
  const tiefe = Math.max(0, -fusshoehe_m);
  const flaeche = Math.abs(flaecheSigniert(ring));
  const ug = { geometrie: profilKoerper({ ring, y0_m: fusshoehe_m, y1_m: 0 }), volumen_m3: flaeche * tiefe };
  const cache = gelaendeCacheSchluessel(g, profil, fusshoehe_m);
  if (!g) {
    // no grid: the basement body only, the excavation quantity = footprint area × depth
    return { mitGelaende: false, mitte, ug, aushub: { geometrie: null, solid_m3: null, raster_m3: null, menge_m3: flaeche * tiefe, quelle: "analytisch", abweichung_rel: null, warnung: null },
      gelaendeNach: { geometrie: null, volumen_m3: null }, block_m3: null, erdberuehrt: [], cache };
  }
  const raster_m3 = stempeln(g, profil, fusshoehe_m).abtrag;
  const ohneSolid = (/** @type {any} */ fehler) => ({ mitGelaende: true, mitte, ug,
    aushub: { geometrie: null, solid_m3: null, raster_m3, menge_m3: raster_m3, quelle: /** @type {"raster"} */ ("raster"), abweichung_rel: null, warnung: fehler },
    gelaendeNach: { geometrie: null, volumen_m3: null }, block_m3: null, erdberuehrt: [], cache, fehler });
  let kern;
  try { kern = ctx.kern || (await csgLaden()); } catch (e) { return ohneSolid({ code: "csg-fehler", text: String(/** @type {any} */ (e)?.message || e) }); }
  const hMin = Math.min(...g.h.map((x) => Number(x) || 0));
  const block = gelaendeBlock(g, Math.min(hMin, fusshoehe_m) - GELAENDE_BODEN_M, mitte);
  const block_m3 = volumen_m3(block);
  const grube = profilKoerper({ ring, y0_m: fusshoehe_m, y1_m: gelaendeMaxImUmriss(g, profil) + BAUGRUBE_RESERVE_M });
  const a = kern.boolesch(block, grube, "intersect");
  const r = kern.boolesch(block, grube, "subtract");
  grube.dispose();
  if (!a.ok || !r.ok) {
    if (a.ok) a.geometrie.dispose();
    if (r.ok) r.geometrie.dispose();
    block.dispose();
    const n = /** @type {any} */ (!a.ok ? a : r);
    return ohneSolid(n.grund === "fehler" ? { code: "csg-fehler", text: n.text || "" } : { code: "csg-offen", eingabe: n.eingabe || "a" });
  }
  const solid_m3 = volumen_m3(a.geometrie);
  const nach_m3 = volumen_m3(r.geometrie);
  // Result check. On a SLOPED grid the library leaves collinear edge pieces used twice from each side along the cut line (measured
  // 26.10.2026, h = 0.1·x: 4…36 such edges, volume exact to 2e-7 m³) — closed in space, not edge-conforming, so the strict check of
  // 107-14 refuses it. Neither result is the input of a further boolean, so such a result is accepted ONLY when the volume balance
  // block = excavation + remaining terrain holds (BILANZ_TOLERANZ_REL) and the comparison against the grid passes below; it is marked
  // `dicht: false`. Any other open result is refused as before.
  // 107-18: with the backend manifold-3d (D-BK-08c) the results are edge-conforming — the same slope (h = 0.1·x) now passes the
  // strict check (`dicht: true`, comparison test csg-backend-10718); the balance path stays as a guard for other backends.
  const dicht = [a.geometrie, r.geometrie].every((x) => dreieckAnzahl(x) === 0 || istWasserdicht(x).ok);
  const bilanz = Math.abs(solid_m3 + nach_m3 - block_m3) <= BILANZ_TOLERANZ_REL * Math.abs(block_m3);
  if (!dicht && !bilanz) {
    a.geometrie.dispose(); r.geometrie.dispose(); block.dispose();
    return ohneSolid({ code: "csg-offen", eingabe: "ergebnis" });
  }
  // a result that is not edge-conforming counts only with a passed comparison (see above): otherwise the grid quantity, no solid shown
  const abg = gelaendeAbgleich(solid_m3, raster_m3);
  if (!dicht && !abg.ok) {
    a.geometrie.dispose(); r.geometrie.dispose(); block.dispose();
    return ohneSolid(abg.warnung);
  }
  // earth contact of the basement walls (before the excavation): wall solid (per layer) ∩ terrain block, in the block frame
  const bz = bezug || { x: 0, y: 0 };
  /** @type {UgErgebnis["erdberuehrt"]} */
  const erdberuehrt = [];
  for (const w of waende || []) {
    const sol = await wandSolid(w, [], { geschosse, kern });
    if (!sol.geometrie) continue;
    const m = new THREE.Matrix4().makeTranslation(sol.platzierung.ursprung.x + bz.x - mitte.x, sol.platzierung.ursprung.y, sol.platzierung.ursprung.z + bz.y - mitte.y)
      .multiply(new THREE.Matrix4().makeRotationY(sol.platzierung.drehung_y));
    let v = 0, gut = true;
    for (const [, teil] of geometrieJeGruppe(sol.geometrie)) {
      teil.applyMatrix4(m);
      // the intersection is a quantity only (not chained), so its own edge conformity is not required; the comparison guards it
      const s = kern.boolesch(teil, block, "intersect");
      teil.dispose();
      if (!s.ok) { gut = false; break; }
      v += volumen_m3(s.geometrie);
      s.geometrie.dispose();
    }
    sol.geometrie.dispose();
    const dicke = sol.basis.schichten.reduce((x, y) => x + y.dicke_m, 0);
    const D = (/** @type {{x: number, z: number}} */ p) => ({ x: p.x + bz.x, z: p.z + bz.y });
    // reference along the reference line of the record (the body may sit beside it by the reference-line offset; on a grid that
    // shifts the sampled heights by at most half a thickness — inside the terrain threshold for normal slopes)
    const ref = erdberuehrtReferenz_m3({ a: D(w.a), b: D(w.b) }, sol.basis.unterkante_m, sol.basis.unterkante_m + sol.basis.hoehe_m, dicke, g);
    const ab = gelaendeAbgleich(gut ? v : null, ref);
    erdberuehrt.push({ schluessel: `ug:${w.level}:${w.edge ?? ""}`, solid_m3: gut ? v : null, referenz_m3: ref, menge_m3: ab.menge_m3, quelle: ab.quelle, warnung: ab.warnung });
  }
  block.dispose();
  return { mitGelaende: true, mitte, ug, dicht,
    aushub: { geometrie: a.geometrie, solid_m3, raster_m3, menge_m3: abg.menge_m3, quelle: abg.quelle, abweichung_rel: abg.abweichung_rel, warnung: abg.warnung },
    gelaendeNach: { geometrie: r.geometrie, volumen_m3: nach_m3 }, block_m3, erdberuehrt, cache };
}
