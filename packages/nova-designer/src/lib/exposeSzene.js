// W-1118-28 (step 2): what the exposé picture adds to the studio scene — the parts a presentation needs and the studio does
// not draw. Two sources, both the building model of the app (one truth, no second house):
//
//   DERIVED from the model as it is: the roof as a body (tile layer with eave and verge overhang, soffit, ridge cap), gutters
//   and downpipes, the dormer roofs with overhang and the dormer window frames, the leaf of every hull door.
//
//   READ from the model field `expose_layer` (optional; absent = none of it): chimney, outside stairs with landing and
//   railing, and the surroundings — ground surfaces (street, pavement, paving, gravel, terrace), kerbs, hedges, walls, trees,
//   shrubs, a distant tree ring, neighbouring houses — plus named eye-level views. All lengths in m, model axes (x east,
//   y up, z south); ground objects follow the terrain of the model (`hoehe`).
//
// `expose_layer` (every key optional):
//   dach:          {traufueberstand_m, ortgangueberstand_m, rinne: boolean}
//   kamin:         {x, z, b_m, t_m, ueber_first_m}
//   aussentreppen: [{edge, u_von_m, u_bis_m, level, podest_tiefe_m, steigung_m, auftritt_m, gelaender}]   steps run outwards
//   umfeld:        {flaechen: [{art, x0, x1, z0, z1}], bordsteine: [{x0, x1, z0, z1}], hecken: [{x0, x1, z0, z1, hoehe_m}],
//                   (a surface with `oberkante_m` is a level slab, e.g. a terrace), kuebel: [{x, z, b_m, hoehe_m, y_m?}],
//                   sitzgruppen: [{x, z, y_m?, laengs: "x"|"z"}], mauern: [{x0, x1, z0, z1, hoehe_m}], baeume: [{x, z, hoehe_m, krone_m, seed}],
//                   straeucher: [{x, z, r_m, hoehe_m, seed}], baumring: {x, z, r_min_m, r_max_m, anzahl, frei: [{x0, x1, z0, z1}]},
//                   nachbarn: [{x0, x1, z0, z1, traufe_m, neigung_grad, first: "x"|"z", dach: "rot"|"grau"}]}
//   blicke:        [{name, pos: [x, y, z], ziel: [x, y, z], fov_grad, augenhoehe_m?}]
//   innen:         {pflanzen: [{x, z, level, hoehe_m, y_m?}], borde: [{x0, x1, z0, z1, level, hoehe_m}]}   pot plants (on the floor, or
//                  on a worktop with y_m above the floor) and wall shelves with a few jars
//
//   Furniture is NOT in this layer: it is the furnishing of the apartment planner (BuildingComplex.moeblierung), handed in as
//   `moebel` and given bodies by exposeMoebel.js; floors and ceilings inside the hull are derived from the storeys.
//
// The numbers are a picture, not a design: gutter sizes, railing bars, door leaf and tree crowns are drawing sizes [ASSUMED].
//
// In:  built model, global roof, storey table, dormers, hull openings, `expose_layer`, terrain height function, materials.
// Out: a THREE.Group to add for the frame, a predicate for studio meshes the group replaces, a dispose function.

import * as THREE from "three";
import { huellKante, gaubeBerechnen } from "@core/lib/bauteil/gauben.js";
import { elevationOf } from "@core/lib/bauteil/hoehen.js";
import { moebelKoerper, moebelPunkt } from "./exposeMoebel.js";

/** Roof body of the picture, m. [ASSUMED] 0.30 m build-up (rafters, insulation, battens, tiles), overhangs as usual on a rendered house. */
export const DACH_BILD = Object.freeze({ aufbau_m: 0.3, traufueberstand_m: 0.5, ortgangueberstand_m: 0.25, rinne_r_m: 0.075, fallrohr_r_m: 0.05, first_r_m: 0.115 });
/** Outside stair defaults, m. [ASSUMED] 15 / 30 cm steps (DIN 18065 allows 14–19 / 26–37 for a building entrance), landing 1.50 m deep. */
export const AUSSENTREPPE_STANDARD = Object.freeze({ podest_tiefe_m: 1.5, steigung_m: 0.15, auftritt_m: 0.3, gelaender_m: 1.0 });

/**
 * Texture coordinates in metres for one vertex, box-projected in world space: a level face reads (x, z); every other face
 * reads the distance along its level direction (the eave of a roof face, the length of a wall) and the distance up the
 * face (y for a wall, the slope length for a roof). So tile courses lie level on every roof face and boards stand upright.
 * @param {{x: number, y: number, z: number}} p world position, m
 * @param {{x: number, y: number, z: number}} n unit normal
 * @returns {[number, number]} (u, v) in m
 */
export function texturKoordinaten(p, n) {
  const hl = Math.hypot(n.x, n.z);
  if (hl < 0.2) return [p.x, p.z];
  const hx = n.x / hl, hz = n.z / hl;
  return [-p.x * hz + p.z * hx, p.y / hl];
}

/**
 * Risers of an outside stair from the height it has to climb: landing top minus ground at the foot, in whole risers of at
 * most `steigung_m` (at least one). Pure; the stair follows the terrain of the model instead of a stored count.
 * @param {number} hoehe_m landing top above the ground at the foot, m
 * @param {number} [steigung_m]
 * @returns {{stufen: number, steigung_m: number}} risers (the last one is the landing edge) and their exact height
 */
export function aussentreppeStufen(hoehe_m, steigung_m = AUSSENTREPPE_STANDARD.steigung_m) {
  const h = Math.max(0, Number(hoehe_m) || 0);
  const n = Math.max(1, Math.ceil(h / steigung_m - 1e-6));
  return { stufen: n, steigung_m: h > 0 ? h / n : steigung_m };
}

/** Deterministic random numbers (mulberry32). @param {number} seed */
function zufall(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const V3 = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => new THREE.Vector3(x, y, z);

/**
 * Builds the additions of the exposé picture (see file head).
 * @param {object} e
 * @param {any} e.model built model (footprint, storeys)
 * @param {any} e.dach globalesDach result (or null / not ok)
 * @param {any} e.gs storey table
 * @param {any[]} [e.gauben]
 * @param {any[]} [e.envOpenings] hull openings; `y_unten_m` (absolute lower edge of the hole) leads over level + sill
 * @param {Record<string, any>|null} [e.layer] the model's `expose_layer`
 * @param {Array<{x: number, z: number, rot: number, level: number, def: any}>} [e.moebel] furniture of the model with storey and type (exposeMoebel.moebelAufloesen)
 * @param {any[]} [e.customWalls] drawn walls {a, b, level, thickness, height} — a low wall (parapet, counter back) gets a cap
 * @param {(x: number, z: number) => number} e.hoehe terrain height at a plan point, m
 * @param {Record<string, THREE.Material>} e.mat materials of the look (exposeBild.materialien)
 * @returns {{gruppe: THREE.Group, ersetzt: (ud: Record<string, any>) => boolean, frei: () => void}}
 */
export function exposeSzeneBauen({ model, dach, gs, gauben = [], envOpenings = [], layer = null, moebel = [], customWalls = [], hoehe, mat }) {
  const L = layer || {};
  const gruppe = new THREE.Group();
  /** @type {THREE.BufferGeometry[]} */
  const geos = [];
  /** per material: positions, normals, uvs of the faces collected so far */
  const reg = /** @type {Record<string, {p: number[], n: number[], u: number[]}>} */ ({});
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const tri = (/** @type {string} */ mk, /** @type {THREE.Vector3[]} */ ecken, /** @type {THREE.Vector3} */ n) => {
    const r = reg[mk] || (reg[mk] = { p: [], n: [], u: [] });
    for (const p of ecken) { r.p.push(p.x, p.y, p.z); r.n.push(n.x, n.y, n.z); const [u, v] = texturKoordinaten(p, n); r.u.push(u, v); }
  };
  /** Quad a-b-c-d; `weg`: a point the face looks away from. */
  const quad = (/** @type {string} */ mk, /** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ b, /** @type {THREE.Vector3} */ c, /** @type {THREE.Vector3} */ d, /** @type {THREE.Vector3|null} */ weg) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(_a.subVectors(c, a));
    if (n.lengthSq() < 1e-14) n.subVectors(c, a).cross(_a.subVectors(d, a));
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    if (weg && n.dot(_b.copy(a).add(b).add(c).add(d).multiplyScalar(0.25).sub(weg)) < 0) { n.negate(); const t = b; b = d; d = t; }
    tri(mk, [a, b, c], n); tri(mk, [a, c, d], n);
  };
  /** Six-sided body from 8 corners (4 bottom, 4 top, same order). `m`: one key or {bottom, top, side}. */
  const hexa = (/** @type {THREE.Vector3[]} */ v, /** @type {string|{bottom?: string, top?: string, side?: string}} */ m) => {
    const mm = typeof m === "string" ? { bottom: m, top: m, side: m } : m;
    const s = mm.side || mm.top || mm.bottom || "beton", c = new THREE.Vector3();
    v.forEach((p) => c.add(p)); c.multiplyScalar(1 / 8);
    quad(mm.bottom || s, v[0], v[1], v[2], v[3], c); quad(mm.top || s, v[4], v[5], v[6], v[7], c);
    quad(s, v[0], v[1], v[5], v[4], c); quad(s, v[1], v[2], v[6], v[5], c); quad(s, v[2], v[3], v[7], v[6], c); quad(s, v[3], v[0], v[4], v[7], c);
  };
  /** Axis-parallel box. */
  const box = (/** @type {string|{bottom?: string, top?: string, side?: string}} */ m, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ y0, /** @type {number} */ y1, /** @type {number} */ z0, /** @type {number} */ z1) => {
    if (x1 < x0) [x0, x1] = [x1, x0]; if (y1 < y0) [y0, y1] = [y1, y0]; if (z1 < z0) [z0, z1] = [z1, z0];
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    hexa([V3(x0, y0, z0), V3(x1, y0, z0), V3(x1, y0, z1), V3(x0, y0, z1), V3(x0, y1, z0), V3(x1, y1, z0), V3(x1, y1, z1), V3(x0, y1, z1)], m);
  };
  /** Round bar between two points. */
  const stab = (/** @type {THREE.Vector3} */ p0, /** @type {THREE.Vector3} */ p1, /** @type {number} */ r, /** @type {string} */ mk, seg = 12) => {
    const dir = new THREE.Vector3().subVectors(p1, p0), len = dir.length();
    if (len < 1e-6) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg); geos.push(g);
    const m = new THREE.Mesh(g, mat[mk]); m.castShadow = true; m.receiveShadow = true;
    m.position.copy(p0).addScaledVector(dir, 0.5); m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
    gruppe.add(m);
  };
  /** A ground patch that follows the terrain, `dz` above it, split into cells of at most `zelle` m. */
  const boden = (/** @type {string} */ mk, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ dz, zelle = 1) => {
    const nx = Math.max(1, Math.ceil((x1 - x0) / zelle)), nz = Math.max(1, Math.ceil((z1 - z0) / zelle));
    const P = (/** @type {number} */ x, /** @type {number} */ z) => V3(x, hoehe(x, z) + dz, z);
    for (let i = 0; i < nx; i += 1) for (let j = 0; j < nz; j += 1) {
      const xa = x0 + ((x1 - x0) * i) / nx, xb = x0 + ((x1 - x0) * (i + 1)) / nx, za = z0 + ((z1 - z0) * j) / nz, zb = z0 + ((z1 - z0) * (j + 1)) / nz;
      quad(mk, P(xa, za), P(xb, za), P(xb, zb), P(xa, zb), V3((xa + xb) / 2, -1000, (za + zb) / 2));
    }
  };
  /** A box standing on the terrain (hedge, wall), following it along its longer side. */
  const aufGelaende = (/** @type {string|{bottom?: string, top?: string, side?: string}} */ m, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ hgt, unten = 0.4) => {
    const laengsX = x1 - x0 >= z1 - z0, n = Math.max(1, Math.ceil((laengsX ? x1 - x0 : z1 - z0) / 1));
    for (let i = 0; i < n; i += 1) {
      const a = i / n, b = (i + 1) / n;
      const xa = laengsX ? x0 + (x1 - x0) * a : x0, xb = laengsX ? x0 + (x1 - x0) * b : x1, za = laengsX ? z0 : z0 + (z1 - z0) * a, zb = laengsX ? z1 : z0 + (z1 - z0) * b;
      const ha = hoehe(laengsX ? xa : (x0 + x1) / 2, laengsX ? (z0 + z1) / 2 : za), hb = hoehe(laengsX ? xb : (x0 + x1) / 2, laengsX ? (z0 + z1) / 2 : zb);
      const y = laengsX ? [ha, hb, hb, ha] : [ha, ha, hb, hb];
      const g = [V3(xa, 0, za), V3(xb, 0, za), V3(xb, 0, zb), V3(xa, 0, zb)];
      hexa([...g.map((p, k) => V3(p.x, y[k] - unten, p.z)), ...g.map((p, k) => V3(p.x, y[k] + hgt, p.z))], m);
    }
  };

  // ------------------------------------------------------------------ roof body, gutters, ridge (derived)
  let dachGebaut = false;
  const fp = model?.footprint || [];
  /** dormers the library accepts, with their record */
  const gaubenErg = /** @type {Array<{g: any, erg: any}>} */ (gauben.map((g) => ({ g, erg: dach && dach.ok ? gaubeBerechnen(g, model, dach, gs) : null })).filter((x) => x.erg && x.erg.ok));
  if (dach && dach.ok && dach.form === "sattel" && dach.rahmen) {
    const R = dach.rahmen, tan = Math.tan((dach.neigung_grad * Math.PI) / 180), cos = Math.cos((dach.neigung_grad * Math.PI) / 180);
    const oh = Number(L.dach?.traufueberstand_m) >= 0 ? Number(L.dach.traufueberstand_m) : DACH_BILD.traufueberstand_m;
    const og = Number(L.dach?.ortgangueberstand_m) >= 0 ? Number(L.dach.ortgangueberstand_m) : DACH_BILD.ortgangueberstand_m;
    const tv = DACH_BILD.aufbau_m / cos; // vertical thickness of the roof body
    // frame point: a along the ridge, d across (0 = ridge line … halbB = eave), y absolute; the model's roof plane is the TILE TOP
    const P = (/** @type {number} */ a, /** @type {number} */ d, /** @type {number} */ y, /** @type {number} */ s) => V3(R.mitte.x + R.u.x * a + R.v.x * d * s, y, R.mitte.z + R.u.z * a + R.v.z * d * s);
    // 4 cm above the model plane: the gable walls of the studio end exactly ON that plane and would flicker through the tiles
    const yOben = (/** @type {number} */ d) => dach.traufhoehe_m + (R.halbB_m - d) * tan + 0.04;
    const a0 = -R.halbL_m - og, a1 = R.halbL_m + og, dT = R.halbB_m + oh;
    for (const s of [1, -1]) {
      // A dormer stands free down to the wall crown: in its zone the roof starts 0.20 m below the inner end of the dormer, and
      // the gutter pauses. Zones along the ridge axis from the dormers on this side.
      const zonen = gaubenErg.map(({ erg }) => {
        const q = erg.grundriss.map((/** @type {any} */ c) => ({ a: (c.x - R.mitte.x) * R.u.x + (c.z - R.mitte.z) * R.u.z, d: ((c.x - R.mitte.x) * R.v.x + (c.z - R.mitte.z) * R.v.z) * s }));
        return { von: Math.min(...q.map((/** @type {any} */ c) => c.a)), bis: Math.max(...q.map((/** @type {any} */ c) => c.a)), dInnen: Math.min(...q.map((/** @type {any} */ c) => c.d)), diese: q.every((/** @type {any} */ c) => c.d > 0) };
      }).filter((z) => z.diese).sort((x, y) => x.von - y.von);
      const stuecke = /** @type {Array<{von: number, bis: number, dBis: number, frei: boolean}>} */ ([]);
      let lauf = a0;
      for (const z of zonen) { if (z.von > lauf) stuecke.push({ von: lauf, bis: z.von, dBis: dT, frei: true }); stuecke.push({ von: z.von, bis: z.bis, dBis: Math.max(0.3, z.dInnen + 0.2), frei: false }); lauf = z.bis; }
      if (a1 > lauf) stuecke.push({ von: lauf, bis: a1, dBis: dT, frei: true });
      const dR = dT + 0.08, yR = yOben(dT) - 0.13;
      for (const st of stuecke) {
        hexa([P(st.von, st.dBis, yOben(st.dBis) - tv, s), P(st.von, 0, yOben(0) - tv, s), P(st.bis, 0, yOben(0) - tv, s), P(st.bis, st.dBis, yOben(st.dBis) - tv, s),
          P(st.von, st.dBis, yOben(st.dBis), s), P(st.von, 0, yOben(0), s), P(st.bis, 0, yOben(0), s), P(st.bis, st.dBis, yOben(st.dBis), s)], { bottom: "untersicht", top: "ziegel", side: "dachrand" });
        if (L.dach?.rinne !== false && st.frei) stab(P(st.von, dR, yR, s), P(st.bis, dR, yR, s), DACH_BILD.rinne_r_m, "rinne", 14);
      }
      if (L.dach?.rinne !== false) {
        for (const a of [-R.halbL_m + 0.3, R.halbL_m - 0.3]) {
          const dW = R.halbB_m + 0.1, fuss = P(a, dW, 0, s);
          stab(P(a, dR, yR - 0.05, s), P(a, dW, yR - 0.45, s), DACH_BILD.fallrohr_r_m, "rinne");
          stab(P(a, dW, yR - 0.45, s), V3(fuss.x, hoehe(fuss.x, fuss.z) - 0.05, fuss.z), DACH_BILD.fallrohr_r_m, "rinne");
        }
      }
    }
    stab(P(a0, 0, yOben(0) - 0.06, 1), P(a1, 0, yOben(0) - 0.06, 1), DACH_BILD.first_r_m, "dachrand", 16);
    dachGebaut = true;

    // chimney (layer): a rendered shaft from inside the roof to above the ridge, dark cover plate on four short posts
    const k = L.kamin;
    if (k && Number.isFinite(Number(k.x)) && Number.isFinite(Number(k.z))) {
      const b = Number(k.b_m) || 0.5, t = Number(k.t_m) || 0.5, x0 = Number(k.x) - b / 2, z0 = Number(k.z) - t / 2;
      const dQ = Math.abs((Number(k.x) - R.mitte.x) * R.v.x + (Number(k.z) - R.mitte.z) * R.v.z);
      const yFirst = yOben(0), top = yFirst + (Number(k.ueber_first_m) > 0 ? Number(k.ueber_first_m) : 0.8);
      box("putz", x0, x0 + b, yOben(Math.min(R.halbB_m, dQ + Math.max(b, t))) - 0.4, top, z0, z0 + t);
      for (const [px, pz] of [[x0 + 0.04, z0 + 0.04], [x0 + b - 0.1, z0 + 0.04], [x0 + 0.04, z0 + t - 0.1], [x0 + b - 0.1, z0 + t - 0.1]]) box("dachrand", px, px + 0.06, top, top + 0.16, pz, pz + 0.06);
      box("dachrand", x0 - 0.06, x0 + b + 0.06, top + 0.16, top + 0.2, z0 - 0.06, z0 + t + 0.06);
    }
  }

  // Every other pitched form (hip, shed): each roof face of the model as a body of the same build-up, flush with the eaves —
  // overhang and gutters need the eave lines of the form and are drawn for gable roofs only so far.
  if (!dachGebaut && dach && dach.ok && dach.form !== "flach" && Array.isArray(dach.flaechen)) {
    for (const fl of dach.flaechen) {
      if (fl.art !== "dachflaeche" && fl.art !== "walm") continue;
      const ny = Math.max(0.2, Number(fl.normale?.y) || 1), tvF = DACH_BILD.aufbau_m / ny;
      const oben = fl.punkte3d.map((/** @type {any} */ c) => V3(c.x, c.y + 0.04, c.z)), unten = oben.map((/** @type {THREE.Vector3} */ c) => V3(c.x, c.y - tvF, c.z));
      const mitteF = oben.reduce((/** @type {THREE.Vector3} */ a, /** @type {THREE.Vector3} */ c) => a.add(c), V3(0, 0, 0)).multiplyScalar(1 / oben.length);
      const innen = V3(mitteF.x, mitteF.y - tvF / 2, mitteF.z);
      for (let i = 1; i + 1 < oben.length; i += 1) { quad("ziegel", oben[0], oben[i], oben[i + 1], oben[i + 1], innen); quad("untersicht", unten[0], unten[i], unten[i + 1], unten[i + 1], innen); }
      for (let i = 0; i < oben.length; i += 1) { const j = (i + 1) % oben.length; quad("dachrand", unten[i], unten[j], oben[j], oben[i], innen); }
    }
    dachGebaut = true;
  }

  // ------------------------------------------------------------------ dormers: roof plate with overhang, window frame (derived)
  for (const { g, erg } of gaubenErg) {
    const dFl = erg.flaechen.find((/** @type {any} */ f) => f.id === "dach");
    if (dFl) {
      const [f0, f1, g1, g0] = dFl.punkte3d.map((/** @type {any} */ p) => V3(p.x, p.y, p.z));
      const a = new THREE.Vector3().subVectors(f1, f0).normalize(), s = new THREE.Vector3().subVectors(g0, f0).normalize();
      const th = V3(0, 0.2, 0), vor = 0.15, seit = 0.08;
      const u = [f0.clone().addScaledVector(a, -seit).addScaledVector(s, -vor), f1.clone().addScaledVector(a, seit).addScaledVector(s, -vor), g1.clone().addScaledVector(a, seit), g0.clone().addScaledVector(a, -seit)];
      hexa([...u, ...u.map((p) => p.clone().add(th))], { bottom: "untersicht", top: "zink", side: "zink" });
    }
    if (dachGebaut) {
      // where the roof is left out in front of the dormer, its front and cheeks continue below the roof plane down to the wall crown
      const [f0, f1, g1, g0] = erg.grundriss.map((/** @type {any} */ c) => V3(c.x, 0, c.z));
      const yK = dach.traufhoehe_m, quer = new THREE.Vector3().subVectors(f1, f0).normalize().multiplyScalar(0.12), tief = new THREE.Vector3().subVectors(g0, f0).normalize().multiplyScalar(0.12);
      const hoch = (/** @type {THREE.Vector3} */ q, /** @type {number} */ y) => V3(q.x, y, q.z);
      hexa([hoch(f0, yK), hoch(f1, yK), hoch(f1.clone().add(tief), yK), hoch(f0.clone().add(tief), yK), hoch(f0, erg.y_dach_m), hoch(f1, erg.y_dach_m), hoch(f1.clone().add(tief), erg.y_dach_m), hoch(f0.clone().add(tief), erg.y_dach_m)], "holz");
      for (const [vorn, hinten, nach] of /** @type {Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]>} */ ([[f0, g0, quer], [f1, g1, quer.clone().negate()]])) {
        // top edge = the main roof plane, rising from the front to the inner end of the dormer
        const yPlan = erg.y_dach_m + new THREE.Vector3().subVectors(hinten, vorn).length() * Math.tan((dach.neigung_grad * Math.PI) / 180);
        hexa([hoch(vorn, yK), hoch(hinten, yK), hoch(hinten.clone().add(nach), yK), hoch(vorn.clone().add(nach), yK), hoch(vorn, erg.y_dach_m), hoch(hinten, yPlan), hoch(hinten.clone().add(nach), yPlan), hoch(vorn.clone().add(nach), erg.y_dach_m)], "holz");
      }
    }
    if (erg.fenster) {
      const [w0, w1, w2] = erg.fenster.punkte3d.map((/** @type {any} */ p) => V3(p.x, p.y, p.z));
      const a = new THREE.Vector3().subVectors(w1, w0), b = a.length(); a.normalize();
      const aus = V3(erg.frontLinie[0].x - erg.grundriss[3].x, 0, erg.frontLinie[0].z - erg.grundriss[3].z).normalize();
      // A dormer flush with the facade (setback 0) carries its window in the facade plane: a floor-length casement is drawn
      // down to its sill, in front of the knee wall the model does not cut there. A dormer set back on the roof shows its
      // window from the wall crown (roof body) or from the roof plane upwards.
      const buendig = !(Number(g?.ruecksprung_m) > 0.05);
      const yu = buendig ? w0.y : Math.max(w0.y, (dachGebaut ? dach.traufhoehe_m : erg.y_dach_m) + 0.04), yo = w2.y, fw = 0.065;
      /** frame bar from s0…s1 along the front and y0…y1, 3 … 9 cm in front of the pane */
      const riegel = (/** @type {number} */ s0, /** @type {number} */ s1, /** @type {number} */ y0, /** @type {number} */ y1) => {
        const p = (/** @type {number} */ sv, /** @type {number} */ t, /** @type {number} */ y) => V3(w0.x + a.x * sv + aus.x * t, y, w0.z + a.z * sv + aus.z * t);
        hexa([p(s0, 0.03, y0), p(s1, 0.03, y0), p(s1, 0.09, y0), p(s0, 0.09, y0), p(s0, 0.03, y1), p(s1, 0.03, y1), p(s1, 0.09, y1), p(s0, 0.09, y1)], "rahmen");
      };
      riegel(0, fw, yu, yo); riegel(b - fw, b, yu, yo); riegel(fw, b - fw, yu, yu + fw); riegel(fw, b - fw, yo - fw, yo);
      // casement posts: one for a window from 1.20 m, three from 3.00 m (the picture so far)
      const teiler = b >= 3 ? [[b / 2, 0.11], [b / 4, 0.08], [(3 * b) / 4, 0.08]] : b >= 1.2 ? [[b / 2, 0.09]] : [];
      for (const [sv, w] of teiler) riegel(sv - w / 2, sv + w / 2, yu + fw, yo - fw);
      // floor-length casement: fixed lower light up to 0.90 m as fall protection (transom)
      if (Number(erg.fenster.bruestung_m) < 0.05 && yo - yu > 1.4) riegel(fw, b - fw, yu + 0.9 - 0.035, yu + 0.9 + 0.035);
      const gp = (/** @type {number} */ sv, /** @type {number} */ y) => V3(w0.x + a.x * sv + aus.x * 0.05, y, w0.z + a.z * sv + aus.z * 0.05);
      quad("glas", gp(fw, yu + fw), gp(b - fw, yu + fw), gp(b - fw, yo - fw), gp(fw, yo - fw), null);
    }
  }

  // ------------------------------------------------------------------ windows of the hull (derived): frame, one casement post from
  // 1.20 m width (basement from 2.00 m), pane, outer sill. The studio draws its own glazing by window type for working on the
  // model; the picture shows the calm casement of a presentation.
  for (const o of envOpenings) {
    if (o?.kind !== "window") continue;
    const kante = huellKante(fp, Number(o.edge) || 0);
    if (!kante) continue;
    const b = Number(o.width) || 1, h = Number(o.height) || 1.2, um = Number(o.u) || 0, lvl = Number(o.level) || 0, sill = Number(o.sill) || 0;
    // `y_unten_m`: lower edge of the hole as the studio cuts it (absolute); else storey elevation + stored sill
    const y0 = Number.isFinite(Number(o.y_unten_m)) ? Number(o.y_unten_m) : elevationOf(lvl, gs) + sill;
    const p = (/** @type {number} */ sv, /** @type {number} */ t, /** @type {number} */ y) => V3(kante.a.x + kante.e.x * (um - b / 2 + sv) - kante.aussen.x * t, y, kante.a.z + kante.e.z * (um - b / 2 + sv) - kante.aussen.z * t);
    const teil = (/** @type {string} */ mk, /** @type {number} */ s0, /** @type {number} */ s1, /** @type {number} */ ya, /** @type {number} */ yb, /** @type {number} */ t0, /** @type {number} */ t1) =>
      hexa([p(s0, t0, ya), p(s1, t0, ya), p(s1, t1, ya), p(s0, t1, ya), p(s0, t0, yb), p(s1, t0, yb), p(s1, t1, yb), p(s0, t1, yb)], mk);
    const fw = 0.065, y1 = y0 + h;
    teil("rahmen", 0, fw, y0, y1, 0.12, 0.2); teil("rahmen", b - fw, b, y0, y1, 0.12, 0.2); teil("rahmen", fw, b - fw, y0, y0 + fw, 0.12, 0.2); teil("rahmen", fw, b - fw, y1 - fw, y1, 0.12, 0.2);
    if (b >= (lvl < 0 ? 2 : 1.2)) teil("rahmen", b / 2 - 0.045, b / 2 + 0.045, y0 + fw, y1 - fw, 0.12, 0.2);
    quad("glas", p(fw - 0.01, 0.16, y0 + fw - 0.01), p(b - fw + 0.01, 0.16, y0 + fw - 0.01), p(b - fw + 0.01, 0.16, y1 - fw + 0.01), p(fw - 0.01, 0.16, y1 - fw + 0.01), null);
    if (sill > 0.05) teil("rahmen", 0, b, y0 - 0.015, y0 + 0.02, -0.05, 0.125); // outer sill, 5 cm proud of the wall
  }

  // ------------------------------------------------------------------ door leaves of the hull doors (derived)
  for (const o of envOpenings) {
    if (o?.kind !== "door") continue;
    const kante = huellKante(fp, Number(o.edge) || 0);
    if (!kante) continue;
    const b = Number(o.width) || 1.1, h = Number(o.height) || 2.1, um = Number(o.u) || 0;
    const y0 = Number.isFinite(Number(o.y_unten_m)) ? Number(o.y_unten_m) : elevationOf(Number(o.level) || 0, gs) + (Number(o.sill) || 0);
    // door frame point: s along the edge from the door's left reveal, t INTO the wall from its outer face, y
    const p = (/** @type {number} */ sv, /** @type {number} */ t, /** @type {number} */ y) => V3(kante.a.x + kante.e.x * (um - b / 2 + sv) - kante.aussen.x * t, y, kante.a.z + kante.e.z * (um - b / 2 + sv) - kante.aussen.z * t);
    const teil = (/** @type {string} */ mk, /** @type {number} */ s0, /** @type {number} */ s1, /** @type {number} */ ya, /** @type {number} */ yb, /** @type {number} */ t0, /** @type {number} */ t1) =>
      hexa([p(s0, t0, ya), p(s1, t0, ya), p(s1, t1, ya), p(s0, t1, ya), p(s0, t0, yb), p(s1, t0, yb), p(s1, t1, yb), p(s0, t1, yb)], mk);
    const fw = 0.065, la = fw + 0.004, lb = b - fw - 0.004, lz0 = y0 + 0.01, lz1 = y0 + h - fw - 0.004;
    teil("rahmen", 0, fw, y0, y0 + h, 0.12, 0.2); teil("rahmen", b - fw, b, y0, y0 + h, 0.12, 0.2); teil("rahmen", fw, b - fw, y0 + h - fw, y0 + h, 0.12, 0.2);
    const gA = la + 0.13, gB = la + 0.29, gz0 = lz0 + 0.22, gz1 = lz1 - 0.22; // narrow glass strip beside the lock side
    teil("tuer", la, gA, lz0, lz1, 0.13, 0.19); teil("tuer", gB, lb, lz0, lz1, 0.13, 0.19); teil("tuer", gA, gB, lz0, gz0, 0.13, 0.19); teil("tuer", gA, gB, gz1, lz1, 0.13, 0.19);
    teil("glas", gA, gB, gz0, gz1, 0.155, 0.165);
    const hs = lb - 0.1; // bar handle on stand-offs
    teil("edelstahl", hs - 0.012, hs + 0.012, y0 + 0.55, y0 + 1.65, 0.05, 0.075);
    teil("edelstahl", hs - 0.01, hs + 0.01, y0 + 0.72, y0 + 0.745, 0.075, 0.13); teil("edelstahl", hs - 0.01, hs + 0.01, y0 + 1.455, y0 + 1.48, 0.075, 0.13);
  }

  // ------------------------------------------------------------------ outside stairs with landing and railing (layer)
  for (const t of Array.isArray(L.aussentreppen) ? L.aussentreppen : []) {
    const kante = huellKante(fp, Number(t.edge) || 0);
    if (!kante) continue;
    const u0 = Math.min(Number(t.u_von_m), Number(t.u_bis_m)), u1 = Math.max(Number(t.u_von_m), Number(t.u_bis_m));
    if (!(u1 - u0 > 0.5)) continue;
    const pod = Number(t.podest_tiefe_m) > 0 ? Number(t.podest_tiefe_m) : AUSSENTREPPE_STANDARD.podest_tiefe_m;
    const auf = Number(t.auftritt_m) > 0 ? Number(t.auftritt_m) : AUSSENTREPPE_STANDARD.auftritt_m;
    const oben = elevationOf(Number(t.level) || 0, gs) - 0.005;
    // plan point: s along the edge, d outwards from the wall face
    const xz = (/** @type {number} */ sv, /** @type {number} */ d) => ({ x: kante.a.x + kante.e.x * sv + kante.aussen.x * d, z: kante.a.z + kante.e.z * sv + kante.aussen.z * d });
    const P = (/** @type {number} */ sv, /** @type {number} */ d, /** @type {number} */ y) => { const q = xz(sv, d); return V3(q.x, y, q.z); };
    // the foot is where the last tread meets the ground: iterate once from the ground at the landing edge
    const um = (u0 + u1) / 2;
    let { stufen, steigung_m: st } = aussentreppeStufen(oben - hoehe(xz(um, pod).x, xz(um, pod).z), Number(t.steigung_m) || AUSSENTREPPE_STANDARD.steigung_m);
    const fussD = pod + (stufen - 1) * auf, gFuss = hoehe(xz(um, fussD).x, xz(um, fussD).z);
    ({ stufen, steigung_m: st } = aussentreppeStufen(oben - gFuss, Number(t.steigung_m) || AUSSENTREPPE_STANDARD.steigung_m));
    const stein = { top: "stein", side: "steinrand", bottom: "steinrand" };
    const koerper = (/** @type {number} */ d0, /** @type {number} */ d1, /** @type {number} */ yb, /** @type {number} */ yt) =>
      hexa([P(u0, d0, yb), P(u1, d0, yb), P(u1, d1, yb), P(u0, d1, yb), P(u0, d0, yt), P(u1, d0, yt), P(u1, d1, yt), P(u0, d1, yt)], stein);
    koerper(0, pod, gFuss - 0.2, oben);
    for (let i = 1; i < stufen; i += 1) koerper(pod + (i - 1) * auf, pod + i * auf, gFuss - 0.2, oben - i * st); // tread i below the landing
    if (t.gelaender !== false) {
      const ende = pod + (stufen - 1) * auf;
      for (const sv of [u0 + 0.04, u1 - 0.04]) {
        /** @type {Array<[number, number]>} */
        const pts = [[0.05, oben], [pod, oben], [pod + auf, oben - st], [Math.max(pod + auf, ende - 0.05), oben - (stufen - 1) * st]];
        for (let i = 0; i < pts.length - 1; i += 1) {
          const [da, ya] = pts[i], [db, yb] = pts[i + 1], n = Math.max(1, Math.round(Math.abs(db - da) / 0.12));
          for (let j = 0; j <= n; j += 1) {
            const f = j / n, d = da + (db - da) * f, y = ya + (yb - ya) * f, pf = j === 0 || j === n ? 0.02 : 0.006;
            hexa([P(sv - pf, d - 0.02, y), P(sv + pf, d - 0.02, y), P(sv + pf, d + 0.02, y), P(sv - pf, d + 0.02, y),
              P(sv - pf, d - 0.02, y + 1), P(sv + pf, d - 0.02, y + 1), P(sv + pf, d + 0.02, y + 1), P(sv - pf, d + 0.02, y + 1)], "rahmen");
          }
          stab(P(sv, da, ya + AUSSENTREPPE_STANDARD.gelaender_m), P(sv, db, yb + AUSSENTREPPE_STANDARD.gelaender_m), 0.022, "rahmen", 10);
          stab(P(sv, da, ya + 0.1), P(sv, db, yb + 0.1), 0.012, "rahmen", 8);
        }
      }
    }
  }

  // ------------------------------------------------------------------ surroundings (layer)
  const U = L.umfeld || {};
  /** leaves of all crowns, drawn as one instanced mesh */
  const blaetter = /** @type {Array<{p: THREE.Vector3, n: THREE.Vector3, s: number, col: THREE.Color, rot: number}>} */ ([]);
  const krone = (/** @type {THREE.Vector3} */ c, /** @type {number} */ rx, /** @type {number} */ ry, /** @type {number} */ rz, /** @type {number} */ anzahl, /** @type {number} */ karte, /** @type {string[]} */ farben, /** @type {() => number} */ R) => {
    // finer and denser than the leaf cards of the renderings so far: 1.7 times the cards at 0.78 of their size
    anzahl = Math.round(anzahl * 1.7); karte *= 0.78;
    for (let i = 0; i < anzahl; i += 1) {
      const u = R(), th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
      const dir = V3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)), r = 0.45 + 0.55 * u ** 0.35;
      const col = new THREE.Color(farben[Math.floor(R() * farben.length)]);
      col.offsetHSL((R() - 0.5) * 0.03, (R() - 0.5) * 0.1, (R() - 0.5) * 0.16 + dir.y * 0.05); // leaf by leaf lighter and darker: a crown with depth
      blaetter.push({ p: V3(c.x + dir.x * rx * r, c.y + dir.y * ry * r, c.z + dir.z * rz * r), n: dir.clone().add(V3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(1.6)).normalize(), s: karte * (0.7 + 0.6 * R()), col, rot: R() * Math.PI * 2 });
    }
  };
  const GRUEN = ["#4F6E34", "#5D7E3C", "#6A8C45", "#7B9C50", "#587A3A"];
  const baum = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ hgt, /** @type {number} */ cr, /** @type {number} */ seed) => {
    const R = zufall(seed), g0 = hoehe(x, z);
    stab(V3(x, g0 - 0.1, z), V3(x, g0 + hgt * 0.55, z), 0.14 + hgt * 0.008, "rinde", 10);
    for (let i = 0; i < 4; i += 1) {
      const a = R() * Math.PI * 2, von = V3(x, g0 + hgt * (0.35 + R() * 0.2), z);
      stab(von, von.clone().add(V3(Math.cos(a) * cr * 0.55, hgt * 0.25, Math.sin(a) * cr * 0.55)), 0.06, "rinde", 7);
    }
    const cc = V3(x, g0 + hgt - cr * 0.95, z);
    krone(cc, cr, cr * 0.95, cr, Math.round((260 * cr * cr) / 4) + 250, 0.75, GRUEN, R);
    for (let i = 0; i < 4; i += 1) krone(cc.clone().add(V3((R() - 0.5) * cr, (R() - 0.3) * cr * 0.6, (R() - 0.5) * cr)), cr * 0.55, cr * 0.5, cr * 0.55, 140, 0.7, GRUEN, R);
  };
  const DECKE = /** @type {Record<string, [string, number]>} */ ({ asphalt: ["asphalt", 0.006], gehweg: ["gehweg", 0.012], pflaster: ["pflaster", 0.012], kies: ["kies", 0.008], terrasse: ["stein", 0.03] });
  for (const f of Array.isArray(U.flaechen) ? U.flaechen : []) {
    const d = DECKE[f.art], x0 = Math.min(f.x0, f.x1), x1 = Math.max(f.x0, f.x1), z0 = Math.min(f.z0, f.z1), z1 = Math.max(f.z0, f.z1);
    if (!d) continue;
    // a surface with its own level (terrace) is a slab with a visible edge; every other one follows the terrain
    // its edge reaches 0.15 m below the lowest terrain along its outline (sampled every ~1 m), so it never floats over a slope
    if (f.oberkante_m != null && Number.isFinite(Number(f.oberkante_m))) {
      let tief = Number(f.oberkante_m) - 0.45;
      const nx = Math.max(1, Math.ceil(x1 - x0)), nz = Math.max(1, Math.ceil(z1 - z0));
      for (let i = 0; i <= nx; i += 1) for (const z of [z0, z1]) tief = Math.min(tief, hoehe(x0 + ((x1 - x0) * i) / nx, z) - 0.15);
      for (let i = 0; i <= nz; i += 1) for (const x of [x0, x1]) tief = Math.min(tief, hoehe(x, z0 + ((z1 - z0) * i) / nz) - 0.15);
      box({ top: d[0], side: "steinrand", bottom: "steinrand" }, x0, x1, tief, Number(f.oberkante_m), z0, z1);
    }
    else boden(d[0], x0, x1, z0, z1, d[1]);
  }
  // planters with a shrub, seating groups (table with four chairs) — furniture of the picture, [ASSUMED] sizes
  (Array.isArray(U.kuebel) ? U.kuebel : []).forEach((/** @type {any} */ k, /** @type {number} */ i) => {
    const b = Number(k.b_m) || 0.55, h = Number(k.hoehe_m) || 0.55, y = k.y_m != null && Number.isFinite(Number(k.y_m)) ? Number(k.y_m) : hoehe(Number(k.x), Number(k.z));
    box("stahl", Number(k.x) - b / 2, Number(k.x) + b / 2, y, y + h, Number(k.z) - b / 2, Number(k.z) + b / 2);
    krone(V3(Number(k.x), y + h + 0.45, Number(k.z)), 0.38, 0.5, 0.38, 80, 0.38, ["#4C6B35", "#5E7F42", "#6E8E4C"], zufall(700 + i));
  });
  for (const g of Array.isArray(U.sitzgruppen) ? U.sitzgruppen : []) {
    const x = Number(g.x), z = Number(g.z), y = g.y_m != null && Number.isFinite(Number(g.y_m)) ? Number(g.y_m) : hoehe(x, z), laengsX = g.laengs === "x";
    const tb = laengsX ? [0.8, 0.45] : [0.45, 0.8]; // half sizes of the table top
    box("untersicht", x - tb[0], x + tb[0], y + 0.71, y + 0.74, z - tb[1], z + tb[1]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box("stahl", x + sx * (tb[0] - 0.06) - 0.02, x + sx * (tb[0] - 0.06) + 0.02, y, y + 0.71, z + sz * (tb[1] - 0.06) - 0.02, z + sz * (tb[1] - 0.06) + 0.02);
    for (const [sa, sq] of [[-0.4, -1], [0.4, -1], [-0.4, 1], [0.4, 1]]) {
      const cx = laengsX ? x + sa : x + sq * (tb[0] + 0.3), cz = laengsX ? z + sq * (tb[1] + 0.3) : z + sa;
      box("stahl", cx - 0.23, cx + 0.23, y + 0.4, y + 0.44, cz - 0.23, cz + 0.23);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box("stahl", cx + lx * 0.2 - 0.015, cx + lx * 0.2 + 0.015, y, y + 0.4, cz + lz * 0.2 - 0.015, cz + lz * 0.2 + 0.015);
      if (laengsX) box("stahl", cx - 0.23, cx + 0.23, y + 0.44, y + 0.82, cz + sq * 0.2, cz + sq * 0.23); else box("stahl", cx + sq * 0.2, cx + sq * 0.23, y + 0.44, y + 0.82, cz - 0.23, cz + 0.23);
    }
  }
  for (const b of Array.isArray(U.bordsteine) ? U.bordsteine : []) aufGelaende("bordstein", Math.min(b.x0, b.x1), Math.max(b.x0, b.x1), Math.min(b.z0, b.z1), Math.max(b.z0, b.z1), 0.1, 0.25);
  for (const h of Array.isArray(U.hecken) ? U.hecken : []) aufGelaende("hecke", Math.min(h.x0, h.x1), Math.max(h.x0, h.x1), Math.min(h.z0, h.z1), Math.max(h.z0, h.z1), Number(h.hoehe_m) || 1.6);
  for (const m of Array.isArray(U.mauern) ? U.mauern : []) aufGelaende({ side: "naturstein", top: "bordstein", bottom: "naturstein" }, Math.min(m.x0, m.x1), Math.max(m.x0, m.x1), Math.min(m.z0, m.z1), Math.max(m.z0, m.z1), Number(m.hoehe_m) || 0.7, 0.9);
  for (const b of Array.isArray(U.baeume) ? U.baeume : []) baum(Number(b.x), Number(b.z), Number(b.hoehe_m) || 9, Number(b.krone_m) || 3.2, Number(b.seed) || 101);
  (Array.isArray(U.straeucher) ? U.straeucher : []).forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    const r = Number(s.r_m) || 0.5, hg = Number(s.hoehe_m) || 0.9;
    krone(V3(Number(s.x), hoehe(Number(s.x), Number(s.z)) + hg * 0.5, Number(s.z)), r, hg * 0.55, r, Math.round(120 * r * r) + 60, 0.38, ["#4C6B35", "#5E7F42", "#6E8E4C"], zufall(Number(s.seed) || 300 + i));
  });
  if (U.baumring && Number(U.baumring.anzahl) > 0) {
    const B = U.baumring, R = zufall(777), frei = Array.isArray(B.frei) ? B.frei : [];
    for (let i = 0; i < Number(B.anzahl); i += 1) {
      const a = R() * Math.PI * 2, rr = Number(B.r_min_m) + R() * (Number(B.r_max_m) - Number(B.r_min_m)), x = Number(B.x) + Math.cos(a) * rr, z = Number(B.z) + Math.sin(a) * rr;
      const h = 8 + R() * 6, c = 2.8 + R() * 1.6;
      if (frei.some((/** @type {any} */ f) => x > Math.min(f.x0, f.x1) && x < Math.max(f.x0, f.x1) && z > Math.min(f.z0, f.z1) && z < Math.max(f.z0, f.z1))) continue;
      baum(x, z, h, c, 1000 + i);
    }
  }
  for (const n of Array.isArray(U.nachbarn) ? U.nachbarn : []) {
    const x0 = Math.min(n.x0, n.x1), x1 = Math.max(n.x0, n.x1), z0 = Math.min(n.z0, n.z1), z1 = Math.max(n.z0, n.z1);
    const g0 = hoehe((x0 + x1) / 2, (z0 + z1) / 2), eh = Number(n.traufe_m) || 4.1, tn = Math.tan(((Number(n.neigung_grad) || 40) * Math.PI) / 180), dm = n.dach === "grau" ? "nachbardachGrau" : "nachbardachRot";
    box("nachbar", x0, x1, g0 + 0.3, g0 + eh, z0, z1); box("sockel", x0, x1, g0 - 1.3, g0 + 0.3, z0, z1);
    const firstX = n.first === "x"; // ridge along x: the faces fall towards ±z
    const halb = (firstX ? z1 - z0 : x1 - x0) / 2, rh = halb * tn, ym = g0 + eh + rh, ya = g0 + eh - 0.5 * tn;
    for (const s of [1, -1]) {
      // eave line 0.5 m outside the wall, ridge line in the middle, gables 0.3 m over
      const E = (/** @type {number} */ l, /** @type {boolean} */ first, /** @type {number} */ y) => firstX
        ? V3(l, y, first ? (z0 + z1) / 2 : (s > 0 ? z1 + 0.5 : z0 - 0.5)) : V3(first ? (x0 + x1) / 2 : (s > 0 ? x1 + 0.5 : x0 - 0.5), y, l);
      const l0 = (firstX ? x0 : z0) - 0.3, l1 = (firstX ? x1 : z1) + 0.3;
      hexa([E(l0, false, ya), E(l0, true, ym), E(l1, true, ym), E(l1, false, ya), E(l0, false, ya + 0.3), E(l0, true, ym + 0.3), E(l1, true, ym + 0.3), E(l1, false, ya + 0.3)], dm);
    }
    // gable triangles and a few windows as dark panes in light frames
    for (const l of firstX ? [x0, x1] : [z0, z1]) {
      const G = (/** @type {number} */ q, /** @type {number} */ y) => (firstX ? V3(l, y, q) : V3(q, y, l));
      const q0 = firstX ? z0 : x0, q1 = firstX ? z1 : x1;
      quad("nachbar", G(q0, g0 + eh), G(q1, g0 + eh), G((q0 + q1) / 2, ym), G((q0 + q1) / 2, ym), firstX ? V3((x0 + x1) / 2, g0 + eh, (z0 + z1) / 2) : V3((x0 + x1) / 2, g0 + eh, (z0 + z1) / 2));
      const aus = l === (firstX ? x0 : z0) ? -1 : 1;
      for (const [qa, qb] of [[q0 + 1.5, q0 + 2.7], [q1 - 2.7, q1 - 1.5]]) for (const [yb, yt] of [[0.9, 2.2], [3.6, 4.6]]) {
        const lf = l + aus * 0.03, lg = l + aus * 0.04;
        if (firstX) { box("nachbarrahmen", Math.min(l, lf), Math.max(l, lf), g0 + yb - 0.06, g0 + yt + 0.06, qa - 0.06, qb + 0.06); box("nachbarfenster", Math.min(l, lg), Math.max(l, lg), g0 + yb, g0 + yt, qa, qb); }
        else { box("nachbarrahmen", qa - 0.06, qb + 0.06, g0 + yb - 0.06, g0 + yt + 0.06, Math.min(l, lf), Math.max(l, lf)); box("nachbarfenster", qa, qb, g0 + yb, g0 + yt, Math.min(l, lg), Math.max(l, lg)); }
      }
    }
  }

  // ------------------------------------------------------------------ interior (derived): floors and ceilings, furniture
  // The hull slabs are left out of the picture (see `ersetzt`), so each storey gets a floor and — below another storey — a
  // ceiling inside the hull walls. [ASSUMED] 0.36 m inset (hull wall), 0.30 m slab and floor build-up, oak floor above ground,
  // screed in a basement; the stair opening is not cut.
  if (fp.length >= 3 && Array.isArray(model?.storeys)) {
    const n = fp.length, kanten = fp.map((/** @type {any} */ _, /** @type {number} */ i) => huellKante(fp, i));
    if (kanten.every(Boolean)) {
      // inset corner i = intersection of the two inward-shifted edges meeting there
      const ring = fp.map((/** @type {any} */ c, /** @type {number} */ i) => {
        const k0 = /** @type {any} */ (kanten[(i + n - 1) % n]), k1 = /** @type {any} */ (kanten[i]), e = 0.36;
        const det = k0.aussen.x * k1.aussen.z - k0.aussen.z * k1.aussen.x;
        if (Math.abs(det) < 1e-6) return { x: c.x - k1.aussen.x * e, z: c.z - k1.aussen.z * e };
        const r0 = k0.aussen.x * c.x + k0.aussen.z * c.z - e, r1 = k1.aussen.x * c.x + k1.aussen.z * c.z - e;
        return { x: (r0 * k1.aussen.z - r1 * k0.aussen.z) / det, z: (k0.aussen.x * r1 - k1.aussen.x * r0) / det };
      });
      const ebenen = model.storeys.map((/** @type {any} */ s) => Number(s.level)).filter(Number.isFinite), ganzOben = Math.max(...ebenen);
      for (const lvl of ebenen) {
        const yB = elevationOf(lvl, gs) + 0.004, yD = elevationOf(lvl + 1, gs) - 0.3;
        for (let i = 1; i + 1 < n; i += 1) {
          quad(lvl < 0 ? "beton" : "eiche", V3(ring[0].x, yB, ring[0].z), V3(ring[i].x, yB, ring[i].z), V3(ring[i + 1].x, yB, ring[i + 1].z), V3(ring[i + 1].x, yB, ring[i + 1].z), V3(ring[0].x, yB - 1, ring[0].z));
          if (lvl < ganzOben) quad("untersicht", V3(ring[0].x, yD, ring[0].z), V3(ring[i].x, yD, ring[i].z), V3(ring[i + 1].x, yD, ring[i + 1].z), V3(ring[i + 1].x, yD, ring[i + 1].z), V3(ring[0].x, yD + 1, ring[0].z));
        }
        // recessed ceiling spots on a 2.40 m grid in the storeys above ground that carry furniture [ASSUMED lighting of a picture]
        if (lvl < ganzOben && lvl >= 0 && moebel.some((m) => m.level === lvl)) {
          const xs = ring.map((/** @type {any} */ c) => c.x), zs = ring.map((/** @type {any} */ c) => c.z);
          for (let x = Math.min(...xs) + 1.2; x < Math.max(...xs) - 0.6; x += 2.4) for (let z = Math.min(...zs) + 1.2; z < Math.max(...zs) - 0.6; z += 2.4) {
            stab(V3(x, yD - 0.012, z), V3(x, yD, z), 0.06, "kachelrand", 28);
            stab(V3(x, yD - 0.014, z), V3(x, yD - 0.012, z), 0.042, "spot", 28);
          }
        }
      }
    }
  }
  // a drawn wall that ends below 1.30 m (counter back, parapet) is closed with a timber cap, 2 cm proud on every side
  for (const w of customWalls) {
    const h = Number(w?.height);
    if (!(h > 0.3 && h <= 1.3) || w.oberkante_bezug === "geschoss" || !w.a || !w.b) continue;
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, len = Math.hypot(dx, dz);
    if (len < 0.2) continue;
    const ex = dx / len, ez = dz / len, d = (Number(w.thickness) || 0.12) / 2 + 0.02, yW = elevationOf(Number(w.level) || 0, gs) + h;
    const E = (/** @type {number} */ l, /** @type {number} */ q, /** @type {number} */ y) => V3(w.a.x + ex * l - ez * q, y, w.a.z + ez * l + ex * q);
    hexa([E(-0.02, -d, yW), E(len + 0.02, -d, yW), E(len + 0.02, d, yW), E(-0.02, d, yW), E(-0.02, -d, yW + 0.04), E(len + 0.02, -d, yW + 0.04), E(len + 0.02, d, yW + 0.04), E(-0.02, d, yW + 0.04)], "arbeitsplatte");
  }
  for (const it of moebel) {
    const y0 = elevationOf(it.level, gs) + 0.004, raumhoehe_m = elevationOf(it.level + 1, gs) - 0.3 - elevationOf(it.level, gs);
    moebelKoerper(it.def, (mk, a0, a1, h0, h1, d0, d1, form) => {
      const P = (/** @type {number} */ a, /** @type {number} */ d, /** @type {number} */ h) => { const q = moebelPunkt(it, a, d); return V3(q.x, y0 + h, q.z); };
      if (form) {
        // a shape that fills the box: unit geometry scaled to the box extents (plan axes swapped for a quarter turn)
        const quer = Math.round(it.rot / 90) % 2 !== 0, ba = Math.abs(a1 - a0), bd = Math.abs(d1 - d0), bh = Math.abs(h1 - h0);
        if (ba < 1e-6 || bd < 1e-6 || bh < 1e-6) return;
        let g;
        if (form === "zylinder") g = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
        else if (form === "schale") g = new THREE.CylinderGeometry(0.5, 0.3, 1, 28);
        else if (form === "kegel") g = new THREE.CylinderGeometry(0.12, 0.5, 1, 28);
        else {
          g = new THREE.SphereGeometry(0.5, 32, 20);
          if (form === "rund") {
            // superellipsoid: every coordinate of the unit sphere to the power 0.42 - a box with rounded edges and corners
            const pp = g.attributes.position;
            for (let k = 0; k < pp.count; k += 1) {
              const f = (/** @type {number} */ v) => Math.sign(v) * Math.pow(Math.abs(v) * 2, 0.42) * 0.5;
              pp.setXYZ(k, f(pp.getX(k)), f(pp.getY(k)), f(pp.getZ(k)));
            }
            g.computeVertexNormals();
          }
        }
        geos.push(g);
        const m = new THREE.Mesh(g, mat[mk]); m.castShadow = true; m.receiveShadow = true;
        m.scale.set(quer ? bd : ba, bh, quer ? ba : bd);
        m.position.copy(P((a0 + a1) / 2, (d0 + d1) / 2, (h0 + h1) / 2));
        gruppe.add(m);
        return;
      }
      hexa([P(a0, d0, h0), P(a1, d0, h0), P(a1, d1, h0), P(a0, d1, h0), P(a0, d0, h1), P(a1, d0, h1), P(a1, d1, h1), P(a0, d1, h1)], mk);
    }, { raumhoehe_m });
  }

  // pot plants and wall shelves inside (layer): the small things a furnished picture needs and no furniture type carries
  const I = L.innen || {};
  (Array.isArray(I.pflanzen) ? I.pflanzen : []).forEach((/** @type {any} */ pf, /** @type {number} */ i) => {
    const x = Number(pf.x), z = Number(pf.z), h = Number(pf.hoehe_m) || 1.5, y = elevationOf(Number(pf.level) || 0, gs) + 0.004 + (Number(pf.y_m) || 0);
    const topf = Math.min(0.2, h * 0.14), th = Math.min(0.36, h * 0.24), kr = h * 0.27;
    box("topf", x - topf, x + topf, y, y + th, z - topf, z + topf);
    if (h > 0.8) stab(V3(x, y + th, z), V3(x, y + h - kr, z), 0.018, "rinde", 8);
    krone(V3(x, y + h - kr, z), kr, kr * 1.05, kr, Math.round(260 * kr) + 40, Math.max(0.09, kr * 0.42), ["#3F6B2E", "#4F7E38", "#5E8E44"], zufall(900 + i));
  });
  for (const bd of Array.isArray(I.borde) ? I.borde : []) {
    const x0 = Math.min(bd.x0, bd.x1), x1 = Math.max(bd.x0, bd.x1), z0 = Math.min(bd.z0, bd.z1), z1 = Math.max(bd.z0, bd.z1), y = elevationOf(Number(bd.level) || 0, gs) + (Number(bd.hoehe_m) || 1.5);
    box("eiche", x0, x1, y, y + 0.035, z0, z1);
    // a few jars along the shelf, light and dark in turn
    const laengsX = x1 - x0 >= z1 - z0, len = laengsX ? x1 - x0 : z1 - z0, mq = laengsX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    [0.08, 0.3, 0.72, 0.84].forEach((f, k) => {
      const l = (laengsX ? x0 : z0) + len * f, r = 0.045, hh = k % 2 ? 0.2 : 0.14;
      if (laengsX) box(k < 2 ? "keramik" : "topf", l - r, l + r, y + 0.035, y + 0.035 + hh, mq - r, mq + r); else box(k < 2 ? "keramik" : "topf", mq - r, mq + r, y + 0.035, y + 0.035 + hh, l - r, l + r);
    });
  }

  // ------------------------------------------------------------------ meshes
  for (const mk of Object.keys(reg)) {
    const r = reg[mk];
    if (!r.p.length || !mat[mk]) continue;
    const g = new THREE.BufferGeometry(); geos.push(g);
    g.setAttribute("position", new THREE.Float32BufferAttribute(r.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(r.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(r.u, 2));
    const m = new THREE.Mesh(g, mat[mk]);
    const flach = ["asphalt", "gehweg", "pflaster", "kies"].includes(mk);
    const glasig = mk === "glas" || mk === "klarglas";
    m.castShadow = !flach && !glasig; m.receiveShadow = true;
    if (glasig) m.userData.ohneAO = true;
    gruppe.add(m);
  }
  if (blaetter.length && mat.blatt) {
    const geo = new THREE.PlaneGeometry(1, 1); geos.push(geo);
    const im = new THREE.InstancedMesh(geo, mat.blatt, blaetter.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qr = new THREE.Quaternion(), s = new THREE.Vector3(), hoch = V3(0, 0, 1);
    blaetter.forEach((l, i) => { q.setFromUnitVectors(hoch, l.n); qr.setFromAxisAngle(hoch, l.rot); q.multiply(qr); s.set(l.s, l.s, l.s); m4.compose(l.p, q, s); im.setMatrixAt(i, m4); im.setColorAt(i, l.col); });
    im.castShadow = true; im.receiveShadow = true; im.userData.ohneAO = true;
    // the shadow of a leaf is the leaf, not its card
    im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: /** @type {any} */ (mat.blatt).map, alphaTest: 0.45, side: THREE.DoubleSide });
    gruppe.add(im);
  }
  return {
    gruppe,
    // Studio meshes the picture leaves out. What the group draws itself: the roof plane (now a body), the dormer roof faces and
    // panes, the placed hull windows and doors. And the hull slabs: in the model they reach to the OUTER face of the facade
    // (without an envelope build-up, 108-03 follow-up), so their edge stands in front of every floor-length window as a light
    // band; from outside they are otherwise invisible.
    ersetzt: (ud) => ud?.kind === "slab" || (dachGebaut && (ud?.kind === "globalroof" || (ud?.kind === "gaube" && ud?.teil === "dach")))
      || (ud?.kind === "gaube" && ud?.teil === "fenster") || (ud?.layer === "openings" && ud?.scope === "env" && (ud?.kind === "window" || ud?.kind === "door")),
    frei: () => { geos.forEach((g) => g.dispose()); gruppe.traverse((/** @type {any} */ o) => { o.customDepthMaterial?.dispose?.(); }); },
  };
}
