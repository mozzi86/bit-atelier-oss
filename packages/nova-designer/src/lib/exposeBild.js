// W-1118-28: the exposé picture of the BIM studio — the SAME scene the studio shows (one truth: no second model of the
// house), rendered once more with a presentation look: sky with clouds, sun with soft shadows, light from the sky, ambient
// occlusion, plaster / roof tile / timber / lawn textures and real glass. The look follows the exposé renderings that were
// made outside the app until 22.11.2026 (sun from the south-west at 36°, ACES tone mapping, the same base colours).
//
// How: the scene is NOT copied. For the one frame every studio mesh gets a presentation material by its `userData` (kind,
// layer, level, teil) and box-projected texture coordinates in metres; helpers (grid, axes, lines, sprites, room volumes,
// ghosts) and the studio lights are hidden. Added for the frame: sky and sun, the terrain of the model continued to the
// horizon, and the parts of exposeSzene.js (roof body with overhang, gutters, dormer details, door leaves — derived from the
// model; chimney, outside stairs, surroundings — read from the model field `expose_layer`). A second, off-screen WebGL
// renderer draws the frame at the asked size through a composer (render, ambient occlusion, output). Afterwards everything
// is put back exactly (materials, texture coordinates, visibility, background, fog, environment) and the temporary objects
// are disposed.
//
// The view is the studio's camera, or a named eye-level view of `expose_layer.blicke`: the camera looks level and the lens is
// shifted, so vertical edges stay vertical (the way an architect photographs a house).
//
// In:  the studio's three bundle {scene, camera | kameraPersp, terrainGroup, buildingGroup}, the model data of the studio
//      (built model, global roof, storeys, dormers, hull openings, expose_layer), picture size in pixels, optional view.
// Out: a PNG blob. Side effects: none that outlast the call (see above).

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { exposeSzeneBauen, texturKoordinaten } from "./exposeSzene.js";

export { texturKoordinaten };

/** Picture size of the exposé in pixels (16:10; the renderings made outside the app were 2400 × 1500). */
export const EXPOSE_BILD = Object.freeze({ breite: 3200, hoehe: 2000 });

/**
 * Sun of the exposé look. [ASSUMED] azimuth 225° (south-west, clockwise from north) and elevation 36°: an afternoon sun in
 * spring/autumn at 49.5° N that lights a west and a south facade at once; a presentation choice, not a sun study (the studio
 * has its own sun slider for that). Model axes: x east, y up, z south.
 */
export const EXPOSE_SONNE = Object.freeze({ azimut_grad: 225, hoehe_grad: 36, farbe: "#FFF1DC", staerke: 3.7 });

/**
 * Depth below the lowest point of the building from which a terrain mesh is taken as not belonging to the plot, m.
 * [ASSUMED] 20 m: far more than any basement or slope on one plot, far less than an elevation offset in metres above sea level.
 */
export const GELAENDE_FERN_M = 20;

/** Half edge of the ground surface around the building, m. [ASSUMED] 110 m: beyond the haze (fog ends at 260 m, the tree ring at 70 m). */
export const BODEN_HALB_M = 110;

/**
 * Quality of the picture, above the renderings made outside the app (those: textures 512 px, anisotropy 8, shadow map 4096,
 * 4 samples per pixel, 16 occlusion samples). Each value is capped by what the graphics card offers.
 * `schaerfen`: strength of the final unsharp mask (0 = off; share of the 4-neighbour Laplacian added back, no unit),
 * `schaerfen_grenze`: largest change it may make to a colour channel (0…1 of full brightness), which keeps halos away
 * from hard edges such as roof against sky. [ASSUMED] both values set by eye on a real project at 3200 × 2000.
 */
export const EXPOSE_QUALITAET = Object.freeze({ textur_px: 1024, anisotropie: 16, schatten_px: 8192, kantenglaettung: 8, verschattung_proben: 24, schaerfen: 0.22, schaerfen_grenze: 0.06 });

/** Base colours of the look (sRGB hex), taken from the renderings so far. */
export const EXPOSE_FARBEN = Object.freeze({
  putz: "#F2EFE8", sockel: "#4A4A48", beton: "#A9A7A1", ziegel: "#33373C", holz: "#C8A26E", rasen: "#6FA65A",
  rahmen: "#383E42", innenwand: "#F4F3F0", stahl: "#2A2C2F", nachbar: "#ECE8E0", glas: "#76838C",
});

/** Deterministic random numbers (mulberry32), so a texture looks the same on every export. @param {number} seed */
function zufall(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * A tiling canvas texture. `groesse_m` is the edge length in metres the tile covers (texture coordinates are metres).
 * @param {number} groesse_m
 * @param {(g: CanvasRenderingContext2D, w: number, h: number) => void} zeichnen
 * @param {boolean} [farbe] false for a bump map (linear)
 * @returns {THREE.CanvasTexture}
 */
function kachel(groesse_m, zeichnen, farbe = true) {
  // drawn at 512 units and scaled, so every drawing routine keeps its numbers while the texture carries EXPOSE_QUALITAET.textur_px
  const px = EXPOSE_QUALITAET.textur_px, c = document.createElement("canvas"); c.width = px; c.height = px;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.scale(px / 512, px / 512);
  zeichnen(g, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / groesse_m, 1 / groesse_m);
  t.anisotropy = EXPOSE_QUALITAET.anisotropie;
  if (farbe) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft light and dark blots plus fine grain on a filled tile — the mineral look of plaster and concrete. */
function koernung(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ w, /** @type {number} */ h, /** @type {() => number} */ R, /** @type {number} */ korn, /** @type {number} */ fleck) {
  for (let i = 0; i < 50; i += 1) {
    const x = R() * w, y = R() * h, r = 25 + R() * 65, k = (R() - 0.5) * 2 * fleck, col = k > 0 ? "255,255,255" : "0,0,0";
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(${col},${Math.abs(k)})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  const f = g.getTransform().a, id = g.getImageData(0, 0, Math.round(w * f), Math.round(h * f)), d = id.data; // device pixels of the scaled canvas
  for (let i = 0; i < d.length; i += 4) { const k = (R() - 0.5) * korn; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
  g.putImageData(id, 0, 0);
}

/** @param {string} hex @param {number} seed @param {number} korn @param {number} fleck @param {number} [groesse_m] @returns {THREE.CanvasTexture} */
const mineral = (hex, seed, korn, fleck, groesse_m = 1.6) => kachel(groesse_m, (g, w, h) => { g.fillStyle = hex; g.fillRect(0, 0, w, h); koernung(g, w, h, zufall(seed), korn, fleck); });

/**
 * Slabs or pavers in a running bond with dark joints.
 * @param {number} groesse_m tile edge in m @param {number} reihen courses per tile @param {number} spalten stones per course
 * @param {[number, number, number]} rgb base colour @param {number} streu colour spread @param {number} seed
 * @returns {THREE.CanvasTexture}
 */
const verband = (groesse_m, reihen, spalten, rgb, streu, seed) => kachel(groesse_m, (g, w, h) => {
  const R = zufall(seed), rh = h / reihen, sw = w / spalten;
  g.fillStyle = "#5c5a56"; g.fillRect(0, 0, w, h);
  for (let r = 0; r < reihen; r += 1) for (let s = -1; s < spalten + 1; s += 1) {
    const k = Math.round((R() - 0.5) * streu);
    g.fillStyle = `rgb(${rgb[0] + k},${rgb[1] + k},${rgb[2] + k})`;
    g.fillRect((s + (r % 2) * 0.5) * sw + 1.5, r * rh + 1.5, sw - 3, rh - 3);
  }
  koernung(g, w, h, R, 8, 0.03);
});

/**
 * The materials of the look, by name. Created per export and disposed afterwards.
 * @returns {{mat: Record<string, THREE.Material>, frei: () => void}}
 */
function materialien() {
  const F = EXPOSE_FARBEN;
  /** @type {THREE.Texture[]} */
  const tex = [];
  const T = (/** @type {THREE.CanvasTexture} */ t) => { tex.push(t); return t; };
  // roof tiles: courses 0.34 m, tiles 0.25 m, half offset per course; v runs up the slope (texturKoordinaten)
  const ziegel = (/** @type {boolean} */ relief) => kachel(1.36, (g, w, h) => {
    const R = zufall(21), reihen = 4, spalten = 5.44, rh = h / reihen, sw = w / spalten;
    g.fillStyle = relief ? "#808080" : F.ziegel; g.fillRect(0, 0, w, h);
    for (let r = 0; r < reihen; r += 1) {
      for (let s = -1; s < spalten + 1; s += 1) {
        const x = (s + (r % 2) * 0.5) * sw, y = r * rh;
        if (relief) {
          const gr = g.createLinearGradient(0, y, 0, y + rh); gr.addColorStop(0, "#5a5a5a"); gr.addColorStop(0.85, "#b0b0b0"); gr.addColorStop(1, "#303030");
          g.fillStyle = gr; g.fillRect(x + 1, y, sw - 2, rh);
        } else {
          const k = Math.round((R() - 0.5) * 7);
          g.fillStyle = `rgb(${51 + k},${55 + k},${60 + k})`; g.fillRect(x + 1, y + 1, sw - 2, rh - 2);
          g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x, y + rh - 3, sw, 3);
        }
      }
    }
  }, !relief);
  const holz = kachel(1.2, (g, w, h) => {
    const R = zufall(31), n = 10, bw = w / n; // vertical boards 0.12 m
    for (let i = 0; i < n; i += 1) {
      const k = Math.round((R() - 0.5) * 22);
      g.fillStyle = `rgb(${200 + k},${162 + k},${110 + k})`; g.fillRect(i * bw, 0, bw, h);
      for (let j = 0; j < 14; j += 1) { g.strokeStyle = `rgba(110,75,40,${0.05 + R() * 0.1})`; g.lineWidth = 0.6 + R(); const x = i * bw + 2 + R() * (bw - 4); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (R() - 0.5) * 3, h); g.stroke(); }
      g.fillStyle = "rgba(70,45,25,0.6)"; g.fillRect(i * bw, 0, 1.5, h);
    }
  });
  const halme = (/** @type {string} */ hex, /** @type {[number, number, number]} */ rgb, /** @type {number} */ groesse_m, /** @type {number} */ seed, /** @type {number} */ laenge) => kachel(groesse_m, (g, w, h) => {
    const R = zufall(seed); g.fillStyle = hex; g.fillRect(0, 0, w, h);
    // dense, contrasty blades: the lawn keeps its grain at 3200 px
    for (let i = 0; i < 32000; i += 1) { const k = Math.round((R() - 0.5) * 84); g.fillStyle = `rgba(${rgb[0] + k},${rgb[1] + k},${rgb[2] + Math.round(k * 0.7)},0.85)`; g.fillRect(R() * w, R() * h, 1.5, laenge); }
    koernung(g, w, h, R, 6, 0.05);
  });
  // one leaf card: a few overlapping leaf shapes on a transparent ground (alpha-tested)
  const blattKarte = (() => {
    const c = document.createElement("canvas"); c.width = 128; c.height = 128;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d")), R = zufall(51);
    for (let i = 0; i < 26; i += 1) {
      const x = 20 + R() * 88, y = 20 + R() * 88, k = 200 + Math.round(R() * 55);
      g.save(); g.translate(x, y); g.rotate(R() * Math.PI); g.fillStyle = `rgb(${k},${k},${k})`;
      g.beginPath(); g.ellipse(0, 0, 9 + R() * 7, 4 + R() * 3, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const std = (/** @type {THREE.MeshStandardMaterialParameters} */ o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o });
  /** @type {Record<string, THREE.Material>} */
  const mat = {
    putz: std({ map: T(mineral(F.putz, 1, 7, 0.02)), roughness: 0.92 }),
    sockel: std({ map: T(mineral(F.sockel, 2, 9, 0.03)), roughness: 0.88 }),
    beton: std({ map: T(mineral(F.beton, 3, 12, 0.04)), roughness: 0.95 }),
    ziegel: std({ map: T(ziegel(false)), bumpMap: T(ziegel(true)), bumpScale: 2, roughness: 0.62 }),
    holz: std({ map: T(holz), roughness: 0.78 }),
    rasen: std({ map: T(halme("#79B05F", [112, 168, 88], 4, 41, 3)), roughness: 1 }),
    hecke: std({ map: T(kachel(1.2, (g, w, hh) => {
      const R = zufall(42); g.fillStyle = "#3C6A2B"; g.fillRect(0, 0, w, hh);
      for (let i = 0; i < 9500; i += 1) { const k = Math.round((R() - 0.5) * 110); g.fillStyle = `rgba(${74 + k},${124 + k},${Math.round(52 + k * 0.6)},0.8)`; g.beginPath(); g.ellipse(R() * w, R() * hh, 2 + R() * 3, 1.2 + R() * 2, R() * Math.PI, 0, Math.PI * 2); g.fill(); }
    })), roughness: 1 }),
    asphalt: std({ map: T(mineral("#5B5D5F", 4, 26, 0.04, 3)), roughness: 0.95 }),
    gehweg: std({ map: T(verband(1.5, 5, 3, [176, 174, 168], 12, 5)), roughness: 0.9 }),
    pflaster: std({ map: T(verband(1.2, 8, 6, [156, 157, 160], 22, 6)), roughness: 0.9 }),
    kies: std({ map: T(mineral("#A39E94", 7, 60, 0.03, 0.8)), roughness: 1 }),
    stein: std({ map: T(verband(1.8, 3, 3, [198, 194, 186], 8, 8)), roughness: 0.82 }),
    naturstein: std({ map: T(verband(1.6, 6, 4, [160, 152, 138], 30, 9)), roughness: 0.9 }),
    steinrand: std({ color: "#BDB8AE", roughness: 0.9 }),
    bordstein: std({ color: "#B4B2AC", roughness: 0.9 }),
    untersicht: std({ color: "#EFEDE8", roughness: 0.9 }),
    dachrand: std({ color: "#2E3033", roughness: 0.5, metalness: 0.35 }),
    zink: std({ color: "#A5A8AA", roughness: 0.42, metalness: 0.45 }),
    rinne: std({ color: "#4A4D51", roughness: 0.4, metalness: 0.5 }),
    rahmen: std({ color: F.rahmen, roughness: 0.45, metalness: 0.15 }),
    tuer: std({ color: F.rahmen, roughness: 0.5, metalness: 0.1 }),
    edelstahl: std({ color: "#C3C7C9", roughness: 0.28, metalness: 0.9 }),
    innenwand: std({ color: F.innenwand, roughness: 0.94 }),
    stahl: std({ color: F.stahl, roughness: 0.45, metalness: 0.6 }),
    rinde: std({ color: "#5E5148", roughness: 1 }),
    nachbar: std({ color: F.nachbar, roughness: 0.95 }),
    nachbardachRot: std({ color: "#5A4A45", roughness: 0.8 }),
    nachbardachGrau: std({ color: "#3F4245", roughness: 0.8 }),
    nachbarfenster: std({ color: "#3A464E", roughness: 0.12, metalness: 0.5 }),
    nachbarrahmen: std({ color: "#E9E9E6", roughness: 0.5 }),
    blatt: std({ map: T(blattKarte), alphaTest: 0.45, roughness: 0.85 }),
    // interior and furniture
    eiche: std({ map: T(kachel(2.4, (g, w, h) => {
      const R = zufall(11), reihen = 12, ph = h / reihen; // planks 0.20 m wide along u
      for (let r = 0; r < reihen; r += 1) {
        let x = -R() * w * 0.7;
        while (x < w) {
          const len = (0.42 + R() * 0.58) * w, k = Math.round((R() - 0.5) * 18);
          for (const ox of [0, -w, w]) {
            g.fillStyle = `rgb(${201 + k},${167 + k},${124 + k})`; g.fillRect(x + ox, r * ph, len, ph);
            g.fillStyle = "rgba(95,65,35,0.5)"; g.fillRect(x + ox, r * ph, 1.5, ph); g.fillRect(x + ox, r * ph, len, 1.2);
          }
          for (let j = 0; j < 16; j += 1) { g.strokeStyle = `rgba(110,75,40,${0.04 + R() * 0.09})`; g.lineWidth = 0.6 + R() * 1.4; const yy = r * ph + 2 + R() * (ph - 4); g.beginPath(); g.moveTo(Math.max(0, x), yy); g.lineTo(Math.min(w, x + len), yy + (R() - 0.5) * 3); g.stroke(); }
          x += len;
        }
      }
    })), roughness: 0.52 }),
    kachel: std({ map: T(kachel(0.44, (g, w, h) => {
      g.fillStyle = "#CFC8B8"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) { const gr = g.createLinearGradient(i * w / 2, j * h / 2, (i + 1) * w / 2, (j + 1) * h / 2); gr.addColorStop(0, "#F1ECE0"); gr.addColorStop(1, "#E2DBCB"); g.fillStyle = gr; g.fillRect(i * w / 2 + 5, j * h / 2 + 5, w / 2 - 10, h / 2 - 10); }
    })), roughness: 0.3 }),
    kachelrand: std({ color: "#E1DACC", roughness: 0.35 }),
    stoff: std({ color: "#C9CBCB", roughness: 1 }),
    stoffHell: std({ color: "#D9DADA", roughness: 1 }),
    polster: std({ color: "#D8D2C5", roughness: 0.95 }),
    front: std({ color: "#F4F4F1", roughness: 0.62 }),
    sockelleiste: std({ color: "#2B2B2B", roughness: 0.7 }),
    arbeitsplatte: std({ map: T(kachel(1.2, (g, w, h) => {
      const R = zufall(13), n = 30, lb = h / n; // glued lamellas 4 cm
      for (let i = 0; i < n; i += 1) { let x = -R() * w; while (x < w) { const len = (0.2 + R() * 0.4) * w, k = Math.round((R() - 0.5) * 20); g.fillStyle = `rgb(${205 + k},${170 + k},${126 + k})`; g.fillRect(x, i * lb, len, lb); g.fillStyle = "rgba(95,65,35,0.35)"; g.fillRect(x, i * lb, 1, lb); x += len; } g.fillStyle = "rgba(95,65,35,0.3)"; g.fillRect(0, i * lb, w, 1); }
    })), roughness: 0.42 }),
    keramik: std({ color: "#F7F7F6", roughness: 0.18 }),
    schwarz: std({ color: "#1D1E20", roughness: 0.45, metalness: 0.6 }),
    feuerglas: std({ color: "#0b0b0c", roughness: 0.08, metalness: 0.2 }),
    bildschirm: std({ color: "#0B0C0D", roughness: 0.18, metalness: 0.3 }),
    tuerInnen: std({ color: "#F5F5F3", roughness: 0.45 }),
    apfel: std({ color: "#8FB04A", roughness: 0.55 }),
    topf: std({ color: "#7A7873", roughness: 0.9 }),
    spot: new THREE.MeshStandardMaterial({ color: "#FFF6E0", emissive: "#FFF2D0", emissiveIntensity: 1.6, roughness: 0.4 }),
    // window glass as the renderings showed it from outside: a dark, mirror-like pane (a clear pane would show unfurnished rooms)
    glas: new THREE.MeshPhysicalMaterial({ color: F.glas, metalness: 0.55, roughness: 0.06, transparent: true, opacity: 0.86, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    // canopy glass: clear, only a tint and the reflection of the sky
    klarglas: new THREE.MeshPhysicalMaterial({ color: "#DCEBEF", metalness: 0, roughness: 0.03, transparent: true, opacity: 0.28, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
  };
  return { mat, frei: () => { tex.forEach((t) => t.dispose()); Object.values(mat).forEach((m) => m.dispose()); } };
}

/**
 * Which material of the look a studio mesh gets, from what the studio wrote into `userData` (and, for the parts of an
 * opening, from its own material: a transparent part is the pane, the rest the frame). null = keep the mesh as it is.
 * Pure; exported for the unit test.
 * @param {{kind?: string, layer?: string, level?: number, teil?: string}} ud userData of the mesh
 * @param {{transparent?: boolean, opacity?: number}|null} [eigen] the mesh's own material
 * @returns {string|null} key of materialien().mat
 */
export function exposeMaterialFuer(ud, eigen = null) {
  const u = ud || {};
  if (u.kind === "vordach") return u.teil === "platte" ? "klarglas" : "stahl";
  if (u.kind === "gaube") return u.teil === "fenster" ? "glas" : u.teil === "dach" ? "ziegel" : "holz";
  if (u.kind === "globalroof" || u.kind === "croof") return "ziegel";
  if (u.kind === "wallShell" || u.kind === "parapet") return Number(u.level) < 0 ? "sockel" : "putz";
  // a door without a scope is a door in a drawn (inner) wall: white leaf and frame
  if (u.layer === "openings" && u.kind === "door" && !/** @type {any} */ (u).scope) return "tuerInnen";
  if (u.layer === "openings") return eigen && (eigen.transparent || Number(eigen.opacity) < 1) ? "glas" : "rahmen";
  if (u.kind === "wall") return "innenwand";
  if (u.kind === "slab" || u.kind === "cslab" || u.kind === "stair" || u.kind === "column") return "beton";
  if (u.layer === "context") return "nachbar";
  return null;
}

/** Sun direction (unit vector towards the sun) in model axes from EXPOSE_SONNE. @returns {THREE.Vector3} */
export function sonnenRichtung() {
  const az = (EXPOSE_SONNE.azimut_grad * Math.PI) / 180, el = (EXPOSE_SONNE.hoehe_grad * Math.PI) / 180;
  return new THREE.Vector3(-Math.cos(el) * Math.sin(az - Math.PI), Math.sin(el), Math.cos(el) * Math.cos(az - Math.PI)).normalize();
}

/**
 * The lens of an eye-level view: the camera looks level, the picture is cut from the upper (shift > 0) or lower part of a
 * taller frame, so vertical edges stay vertical. Returns the vertical opening of the taller frame and its height in pixels.
 * Pure; exported for the unit test.
 * @param {number} fov_grad vertical opening of the picture itself, degrees
 * @param {number} shift lens shift as a fraction of the picture height (0.24 = the horizon sits 24 % below the centre)
 * @param {number} hoehe_px picture height
 * @returns {{fov_grad: number, vollHoehe_px: number, versatz_px: number}}
 */
export function linsenVersatz(fov_grad, shift, hoehe_px) {
  const T = Math.tan(((Number(fov_grad) || 45) * Math.PI) / 360), s = Number(shift) || 0;
  const voll = T + Math.abs(2 * s * T), vollHoehe = (hoehe_px * voll) / T;
  return { fov_grad: (2 * Math.atan(voll) * 180) / Math.PI, vollHoehe_px: vollHoehe, versatz_px: s > 0 ? 0 : vollHoehe - hoehe_px };
}

/** Sky dome: zenith-to-horizon gradient, soft clouds, sun glow. @param {THREE.Vector3} sonne @param {boolean} wolken */
function himmelMaterial(sonne, wolken) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenit: { value: new THREE.Color("#4F86CC") }, horizont: { value: new THREE.Color("#D3E2EF") }, boden: { value: new THREE.Color("#7B786F") }, sonne: { value: sonne.clone() }, wolken: { value: wolken ? 1 : 0 } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform vec3 zenit; uniform vec3 horizont; uniform vec3 boden; uniform vec3 sonne; uniform float wolken; varying vec3 vDir;
      vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
      float gnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
        return mix(mix(dot(hash2(i), f), dot(hash2(i+vec2(1,0)), f-vec2(1,0)), u.x), mix(dot(hash2(i+vec2(0,1)), f-vec2(0,1)), dot(hash2(i+vec2(1,1)), f-vec2(1,1)), u.x), u.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 r = mat2(0.80, 0.60, -0.60, 0.80); for (int i = 0; i < 6; i++){ v += a*gnoise(p); p = r*p*2.03 + 1.3; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y; vec3 col;
        if (h >= 0.0) {
          col = mix(horizont, zenit, pow(clamp(h, 0.0, 1.0), 0.5));
          if (wolken > 0.0) {
            float c = 0.5 + fbm(d.xz / (h + 0.25) * 1.1 + vec2(4.3, 1.1));
            float cov = smoothstep(0.50, 0.80, c) * smoothstep(0.04, 0.35, h);
            col = mix(col, mix(vec3(1.0, 1.0, 0.99), vec3(0.88, 0.90, 0.94), smoothstep(0.62, 0.95, c)), cov * 0.62);
          }
        } else { col = mix(horizont * 0.92, boden, smoothstep(0.0, 0.10, -h)); }
        float s = max(dot(d, normalize(sonne)), 0.0);
        col += vec3(1.0, 0.94, 0.82) * (pow(s, 10.0) * 0.18 + pow(s, 900.0) * 6.0) * wolken;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * @typedef {object} ExposeDaten what the studio knows about the building (all optional: without it only the look is applied)
 * @property {any} [model] built model (footprint, storeys)
 * @property {any} [dach] globalesDach result
 * @property {any} [gs] storey table
 * @property {any[]} [gauben]
 * @property {any[]} [envOpenings]
 * @property {Record<string, any>|null} [layer] the model's `expose_layer`
 * @property {any[]} [moebel] furniture with storey and type (exposeMoebel.moebelAufloesen)
 * @property {any[]} [customWalls] drawn walls (a low one gets a timber cap in the picture)
 * @typedef {{name?: string, pos: number[], ziel: number[], fov_grad?: number, shift?: number, augenhoehe_m?: number, innen?: boolean}} ExposeBlick eye-level view, m;
 *   `innen`: a view from inside (clear glass, neutral light from the room, finer occlusion)
 */

/**
 * Renders the exposé picture of the studio scene (see file head).
 * @param {Record<string, any>} t3 the studio's three bundle: scene, camera or kameraPersp, terrainGroup, buildingGroup
 * @param {{breite?: number, hoehe?: number, daten?: ExposeDaten|null, blick?: ExposeBlick|null}} [opt] picture size in pixels
 *   (default EXPOSE_BILD), model data for the derived parts, a named view instead of the studio camera
 * @returns {Promise<Blob>} PNG
 */
export async function exposeBildRendern(t3, { breite = EXPOSE_BILD.breite, hoehe = EXPOSE_BILD.hoehe, daten = null, blick = null } = {}) {
  const szene = t3?.scene, quelle = t3?.kameraPersp ?? t3?.camera;
  if (!szene || !quelle) throw new Error("Exposé-Bild: keine 3D-Szene");
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  /** undo steps, run in reverse order in `finally` */
  const zurueck = /** @type {Array<() => void>} */ ([]);
  const { mat, frei } = materialien();
  try {
    renderer.setPixelRatio(1); renderer.setSize(breite, hoehe, false);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
    szene.updateMatrixWorld(true);
    const nm = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
    const box = new THREE.Box3();
    if (t3.buildingGroup) box.setFromObject(t3.buildingGroup);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 8, 10));
    const mitte = box.getCenter(new THREE.Vector3()), radius = Math.max(12, box.getSize(new THREE.Vector3()).length() * 0.75);

    // 1. terrain of the model as a height function. A terrain mesh that lies wholly more than GELAENDE_FERN_M below the
    //    building is not this plot's ground (seen 22.11.2026: offline demo heights of "Gelände Bestand" 250 m below the house).
    /** @type {any[]} */
    const gelaende = [];
    const gBox = new THREE.Box3(), fern = new THREE.Box3();
    for (const kind of t3.terrainGroup?.visible !== false ? (t3.terrainGroup?.children || []) : []) {
      if (kind.visible === false || fern.setFromObject(kind).isEmpty() || fern.max.y < box.min.y - GELAENDE_FERN_M) continue;
      kind.traverse((/** @type {any} */ o) => { if (o.isMesh && o.visible !== false) gelaende.push(o); });
      gBox.union(fern);
    }
    const strahl = new THREE.Raycaster(), runter = new THREE.Vector3(0, -1, 0), merk = new Map();
    // without terrain the ground is level just below the ground floor. [ASSUMED] 0.15 m: a usual plinth step
    const ohne = Math.min(0, box.max.y) - 0.15;
    /** Terrain height at a plan point; outside the terrain mesh the height of its nearest edge (the plot continues level). */
    const hoeheAn = (/** @type {number} */ x, /** @type {number} */ z) => {
      if (!gelaende.length) return ohne;
      const xc = Math.min(gBox.max.x - 0.02, Math.max(gBox.min.x + 0.02, x)), zc = Math.min(gBox.max.z - 0.02, Math.max(gBox.min.z + 0.02, z));
      const key = `${Math.round(xc * 20)}|${Math.round(zc * 20)}`;
      if (merk.has(key)) return merk.get(key);
      strahl.set(p.set(xc, gBox.max.y + 10, zc), runter);
      const treffer = strahl.intersectObjects(gelaende, false)[0];
      const y = treffer ? treffer.point.y : ohne;
      merk.set(key, y);
      return y;
    };

    // 2. every studio object: hide helpers, lights, terrain meshes and what exposeSzene draws itself; give meshes the look
    const bau = daten?.model ? exposeSzeneBauen({ model: daten.model, dach: daten.dach, gs: daten.gs, gauben: daten.gauben || [], envOpenings: daten.envOpenings || [], layer: daten.layer || null, moebel: daten.moebel || [], customWalls: daten.customWalls || [], hoehe: hoeheAn, mat }) : null;
    if (bau) zurueck.push(() => bau.frei());
    const geoFertig = new Set();
    const aus = (/** @type {any} */ o) => { if (o.visible) { o.visible = false; zurueck.push(() => { o.visible = true; }); } };
    for (const kind of t3.terrainGroup?.children || []) aus(kind);
    /** @type {any[]} */
    const innentueren = [];
    szene.traverse((/** @type {any} */ o) => {
      const ud = o.userData || {};
      const hilfe = o.isLine || o.isLineSegments || o.isPoints || o.isSprite || o.isLight || o.type === "GridHelper" || o.type === "AxesHelper"
        || ud.zeigeHilfe || ud.kind === "zone" || ud.kind === "durchbruch" || (bau && bau.ersetzt(ud));
      if (hilfe) { aus(o); return; }
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      let sichtbar = true;
      for (let v = o; v; v = v.parent) if (v.visible === false) { sichtbar = false; break; }
      if (!sichtbar) return;
      const eigen = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = exposeMaterialFuer(ud, eigen);
      const alt = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, ohneAO: ud.ohneAO };
      zurueck.push(() => { o.material = alt.material; o.castShadow = alt.cast; o.receiveShadow = alt.receive; if (alt.ohneAO === undefined) delete o.userData.ohneAO; else o.userData.ohneAO = alt.ohneAO; });
      if (key) o.material = mat[key];
      if (key === "tuerInnen") innentueren.push(o);
      const glas = key === "glas" || key === "klarglas";
      o.castShadow = !glas; o.receiveShadow = true;
      if (glas) o.userData.ohneAO = true;
      // texture coordinates in metres (world space), once per geometry; the old attribute comes back afterwards
      const geo = o.geometry;
      if (!key || geoFertig.has(geo) || !(/** @type {any} */ (mat[key]).map)) return;
      geoFertig.add(geo);
      if (!geo.attributes.normal) { geo.computeVertexNormals(); zurueck.push(() => geo.deleteAttribute("normal")); }
      const pos = geo.attributes.position, nor = geo.attributes.normal, uvAlt = geo.attributes.uv;
      const uv = new Float32Array(pos.count * 2);
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < pos.count; i += 1) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        const [u, v] = texturKoordinaten(p, n);
        uv[2 * i] = u; uv[2 * i + 1] = v;
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      zurueck.push(() => { if (uvAlt) geo.setAttribute("uv", uvAlt); else geo.deleteAttribute("uv"); });
    });

    // 3. sky, sun, the ground to the horizon, the additions of exposeSzene
    const sonne = sonnenRichtung();
    const zusatz = new THREE.Group();
    const himmel = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), himmelMaterial(sonne, true));
    himmel.frustumCulled = false; himmel.renderOrder = -1; himmel.userData.ohneAO = true;
    const licht = new THREE.DirectionalLight(EXPOSE_SONNE.farbe, EXPOSE_SONNE.staerke);
    const schatten = Math.max(22, radius * 1.6);
    licht.target.position.copy(mitte); licht.position.copy(mitte).addScaledVector(sonne, 80);
    const schattenPx = Math.min(EXPOSE_QUALITAET.schatten_px, renderer.capabilities.maxTextureSize);
    licht.castShadow = true; licht.shadow.mapSize.set(schattenPx, schattenPx);
    const sc = licht.shadow.camera; sc.left = -schatten; sc.right = schatten; sc.top = schatten; sc.bottom = -schatten; sc.near = 20; sc.far = 160;
    licht.shadow.bias = -0.0002; licht.shadow.normalBias = 0.025; licht.shadow.radius = 3;
    zusatz.add(himmel, licht, licht.target);
    // ground: the terrain function on a grid — 0.5 m cells around the terrain mesh, 5 m cells to BODEN_HALB_M
    {
      const linien = (/** @type {number} */ c, /** @type {number} */ a, /** @type {number} */ b) => {
        const s = new Set();
        for (let v = -BODEN_HALB_M; v <= BODEN_HALB_M; v += 5) s.add(c + v);
        if (gelaende.length) for (let v = Math.floor(a - 6); v <= Math.ceil(b + 6); v += 0.5) s.add(v);
        return [...s].sort((q, r) => q - r);
      };
      const xs = linien(mitte.x, gBox.min.x, gBox.max.x), zs = linien(mitte.z, gBox.min.z, gBox.max.z);
      const pos = new Float32Array(xs.length * zs.length * 3), uv = new Float32Array(xs.length * zs.length * 2);
      xs.forEach((x, i) => zs.forEach((z, j) => { const k = i * zs.length + j; pos[3 * k] = x; pos[3 * k + 1] = hoeheAn(x, z); pos[3 * k + 2] = z; uv[2 * k] = x; uv[2 * k + 1] = z; }));
      const idx = [];
      for (let i = 0; i + 1 < xs.length; i += 1) for (let j = 0; j + 1 < zs.length; j += 1) { const a = i * zs.length + j, b = a + zs.length; idx.push(a, a + 1, b + 1, a, b + 1, b); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      const wiese = new THREE.Mesh(geo, mat.rasen); wiese.receiveShadow = true;
      zusatz.add(wiese);
      zurueck.push(() => geo.dispose());
    }
    // lever handles on the leaves of the inner doors, both faces, so a white door in a white wall reads as a door.
    // A leaf is a door mesh at least 1.6 m high and 0.5 m wide; handle height 1.05 m above its lower edge (DIN 18101),
    // lever 0.13 m long, 0.09 m from the edge — [ASSUMED] the lock side is the mesh's far end, the model carries no hinge side.
    for (const t of innentueren) {
      const b = new THREE.Box3().setFromObject(t), g = b.getSize(new THREE.Vector3());
      const laengsX = g.x >= g.z, breit = laengsX ? g.x : g.z, dick = laengsX ? g.z : g.x;
      if (g.y < 1.6 || breit < 0.5 || dick > 0.3) continue;
      const y = b.min.y + 1.05, m = b.getCenter(new THREE.Vector3()), u = (laengsX ? b.max.x : b.max.z) - 0.09;
      for (const seite of [-1, 1]) {
        const ab = (laengsX ? m.z : m.x) + seite * (dick / 2 + 0.035);
        const hebel = new THREE.Mesh(new THREE.BoxGeometry(laengsX ? 0.13 : 0.02, 0.02, laengsX ? 0.02 : 0.13), mat.edelstahl);
        hebel.position.set(laengsX ? u - 0.055 : ab, y, laengsX ? ab : u - 0.055);
        const dorn = new THREE.Mesh(new THREE.BoxGeometry(laengsX ? 0.045 : 0.05, 0.045, laengsX ? 0.05 : 0.045), mat.edelstahl);
        dorn.position.set(laengsX ? u : ab - seite * 0.015, y, laengsX ? ab - seite * 0.015 : u);
        for (const k of [hebel, dorn]) { k.castShadow = true; k.receiveShadow = true; zusatz.add(k); zurueck.push(() => k.geometry.dispose()); }
      }
    }
    if (bau) zusatz.add(bau.gruppe);
    szene.add(zusatz);
    zurueck.push(() => { szene.remove(zusatz); himmel.geometry.dispose(); /** @type {THREE.Material} */ (himmel.material).dispose(); licht.shadow.map?.dispose(); });

    const pmrem = new THREE.PMREMGenerator(renderer);
    const umwelt = new THREE.Scene();
    const umweltHimmel = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), himmelMaterial(sonne, false));
    umwelt.add(umweltHimmel);
    const env = pmrem.fromScene(umwelt, 0, 0.1, 500);
    const alt = { background: szene.background, fog: szene.fog, environment: szene.environment, intensity: szene.environmentIntensity };
    szene.background = null; szene.environment = env.texture; szene.environmentIntensity = 0.85; szene.fog = new THREE.Fog("#d6e0e8", 30, 260);
    // A view from inside: the panes are clear, the light of the room is neutral (bright ceiling, warm floor bounce instead of
    // the blue of the sky), the sun a little stronger, the haze far away.
    const innen = !!blick?.innen;
    /** @type {THREE.WebGLRenderTarget|null} */
    let envInnen = null;
    if (innen) {
      const raum = new THREE.Scene();
      const kugel = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { oben: { value: new THREE.Color("#FFFFFF") }, mitteF: { value: new THREE.Color("#F3F1EC") }, unten: { value: new THREE.Color("#DCD5CA") } },
        vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform vec3 oben; uniform vec3 mitteF; uniform vec3 unten; varying vec3 vDir; void main(){ float h = normalize(vDir).y; vec3 c = h >= 0.0 ? mix(mitteF, oben, smoothstep(0.0, 0.8, h)) : mix(mitteF, unten, smoothstep(0.0, 0.35, -h)); gl_FragColor = vec4(c, 1.0); }",
      }));
      raum.add(kugel);
      envInnen = pmrem.fromScene(raum, 0, 0.1, 500);
      kugel.geometry.dispose(); /** @type {THREE.Material} */ (kugel.material).dispose();
      szene.environment = envInnen.texture; szene.environmentIntensity = 0.78; szene.fog = new THREE.Fog("#d6e0e8", 200, 900);
      licht.intensity = 4.2;
      const glas = /** @type {THREE.MeshPhysicalMaterial} */ (mat.glas);
      glas.color.set("#F2F6F6"); glas.opacity = 0.12; glas.metalness = 0; glas.roughness = 0.02;
    }
    zurueck.push(() => {
      szene.background = alt.background; szene.fog = alt.fog; szene.environment = alt.environment; szene.environmentIntensity = alt.intensity;
      envInnen?.dispose(); env.dispose(); pmrem.dispose(); umweltHimmel.geometry.dispose(); /** @type {THREE.Material} */ (umweltHimmel.material).dispose();
    });

    // 4. the view: a named eye-level view (level camera, shifted lens) or the studio's camera in the picture's proportions
    const kamera = new THREE.PerspectiveCamera(quelle.fov || 45, breite / hoehe, 0.05, 2500);
    if (blick && Array.isArray(blick.pos) && Array.isArray(blick.ziel)) {
      const lv = linsenVersatz(Number(blick.fov_grad) || 45, Number(blick.shift) || 0, hoehe);
      // `augenhoehe_m`: the eye stands that high above the terrain of the model at its plan point (the stored y is ignored)
      const yAuge = Number(blick.augenhoehe_m) > 0 ? hoeheAn(blick.pos[0], blick.pos[2]) + Number(blick.augenhoehe_m) : blick.pos[1];
      blick = { ...blick, pos: [blick.pos[0], yAuge, blick.pos[2]] };
      kamera.position.set(blick.pos[0], blick.pos[1], blick.pos[2]);
      kamera.lookAt(blick.ziel[0], Number(blick.shift) ? blick.pos[1] : blick.ziel[1], blick.ziel[2]);
      kamera.fov = lv.fov_grad; kamera.aspect = breite / lv.vollHoehe_px;
      kamera.setViewOffset(breite, lv.vollHoehe_px, 0, lv.versatz_px, breite, hoehe);
      kamera.updateProjectionMatrix();
    } else {
      kamera.position.copy(quelle.getWorldPosition(new THREE.Vector3()));
      kamera.quaternion.copy(quelle.getWorldQuaternion(new THREE.Quaternion()));
    }
    kamera.updateMatrixWorld(true);
    himmel.position.copy(kamera.position);

    // 5. render → ambient occlusion → tone mapping; glass, leaves and the sky take no part in the occlusion
    const ziel = new THREE.WebGLRenderTarget(breite, hoehe, { type: THREE.HalfFloatType, samples: Math.min(EXPOSE_QUALITAET.kantenglaettung, renderer.capabilities.maxSamples || 4) });
    const composer = new EffectComposer(renderer, ziel);
    composer.setPixelRatio(1); composer.setSize(breite, hoehe);
    composer.addPass(new RenderPass(szene, kamera));
    const gtao = new GTAOPass(szene, kamera, breite, hoehe);
    // The pass hides lines and points while it renders the normals and shows them again from its own list (three 0.186:
    // _overrideVisibility / _visibilityCache). Glass, leaves and the sky join that list; without the hook they would darken
    // what lies behind them. If a later three renames the hook, the occlusion simply includes them.
    const g = /** @type {any} */ (gtao);
    if (typeof g._overrideVisibility === "function" && Array.isArray(g._visibilityCache)) {
      const sichtAlt = g._overrideVisibility.bind(gtao);
      g._overrideVisibility = function ohneGlas() { sichtAlt(); szene.traverse((/** @type {any} */ o) => { if (o.userData?.ohneAO && o.visible) { o.visible = false; g._visibilityCache.push(o); } }); };
    }
    gtao.updateGtaoMaterial({ radius: innen ? 0.2 : 1, distanceExponent: innen ? 2 : 1, thickness: innen ? 0.25 : 1, scale: innen ? 1.1 : 1, samples: EXPOSE_QUALITAET.verschattung_proben, distanceFallOff: 1, screenSpaceRadius: false });
    // inside, the denoise stops harder at depth and normal steps and reaches less far: with the outdoor values the occlusion
    // of a shelf or a cupboard smeared over the white wall beside it
    gtao.updatePdMaterial(innen ? { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 2, radiusExponent: 1, rings: 2, samples: 16 }
      : { lumaPhi: 10, depthPhi: 6, normalPhi: 6, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
    // 6. unsharp mask on the finished (display-referred) picture: fine texture gains contrast, the change per channel is limited
    const schaerfe = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, schritt: { value: new THREE.Vector2(1 / breite, 1 / hoehe) }, staerke: { value: EXPOSE_QUALITAET.schaerfen }, grenze: { value: EXPOSE_QUALITAET.schaerfen_grenze } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tDiffuse; uniform vec2 schritt; uniform float staerke; uniform float grenze; varying vec2 vUv;",
        "void main() {",
        "  vec4 c = texture2D(tDiffuse, vUv);",
        "  vec3 n = texture2D(tDiffuse, vUv + vec2(schritt.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(schritt.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, schritt.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, schritt.y)).rgb;",
        "  vec3 d = clamp(staerke * (4.0 * c.rgb - n), -grenze, grenze);",
        "  gl_FragColor = vec4(clamp(c.rgb + d, 0.0, 1.0), c.a);",
        "}",
      ].join(" "),
    });
    composer.addPass(schaerfe);
    zurueck.push(() => { schaerfe.material.dispose(); });
    zurueck.push(() => { gtao.dispose(); composer.dispose(); ziel.dispose(); });
    composer.render();
    const blob = await new Promise((/** @type {(b: Blob|null) => void} */ r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("Exposé-Bild: PNG konnte nicht erzeugt werden");
    return blob;
  } finally {
    for (let i = zurueck.length - 1; i >= 0; i -= 1) { try { zurueck[i](); } catch (e) { console.error("Exposé-Bild: Rückbau", e); } }
    frei();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
