// three.js material for one appearance-catalogue entry. Colour comes from the
// catalogue. A repeatable colour map is attached only for the two vendored
// maps (parquet grain, tile grid). Other entries stay a flat catalogue colour.
//
// In:  an Erscheinungsstoff from @core/lib/bauteil/erscheinung.js, repeat count.
// Out: a MeshStandardMaterial, or null when there is no record. The caller
//      disposes the material with the mesh (threeFreigeben). Cloned maps are
//      disposed with the material; the cached source image stays.

import * as THREE from "three";
import { baustoff, musterBild, musterSpanne_m } from "@core/lib/bauteil/erscheinung.js";

/**
 * Public URL of one vendored colour map. The root build serves `public/` at
 * `/`. `npm run build:lokal` sets Vite's base to `/app/`, so the same file is
 * `/app/erscheinung/…`. A root-absolute path 404s there and the floor stays white.
 * @param {string} datei file name under public/erscheinung
 * @param {string} [basis] `import.meta.env.BASE_URL` (`/` or `/app/`)
 * @returns {string}
 */
export function erscheinungUrl(datei, basis = "/") {
  const roh = typeof basis === "string" && basis.length ? basis : "/";
  const prefix = roh.endsWith("/") ? roh : `${roh}/`;
  return `${prefix}erscheinung/${datei}`;
}

/** Served from public/erscheinung (see HERKUNFT.md there). Not bundled as a module. */
const BILD_BASIS = import.meta.env?.BASE_URL || "/";
const BILD = Object.freeze({
  Wood051: erscheinungUrl("Wood051_Color.jpg", BILD_BASIS),
  Tiles074: erscheinungUrl("Tiles074_Color.jpg", BILD_BASIS),
});
/** @type {Map<string, THREE.Texture>} */
const cache = new Map();

/**
 * Shared colour map for a vendored pattern, or null.
 * @param {string|null} muster `Wood051` or `Tiles074`
 * @returns {THREE.Texture|null}
 */
function quelle(muster) {
  const url = muster ? BILD[muster] : null;
  if (!url) return null;
  let tex = cache.get(muster);
  if (!tex) {
    // Node unit tests have no document. The browser build loads the file;
    // both keep the same repeat and the URL that includes BASE_URL.
    tex = typeof document === "undefined" ? new THREE.Texture() : new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.userData.url = url;
    cache.set(/** @type {string} */ (muster), tex);
  }
  return tex;
}

/**
 * @param {import("@core/lib/bauteil/erscheinung.js").Erscheinungsstoff} stoff
 * @param {{ repeat?: number, glas?: boolean }} [opt]
 *   repeat: how many times the map tiles along the face (1 = one span).
 *   glas: draw as glazing even when the class is not glass.
 * @returns {THREE.MeshStandardMaterial}
 */
export function materialErzeugen(stoff, opt = {}) {
  const muster = musterBild(stoff.textur);
  const basis = quelle(muster);
  const map = basis ? basis.clone() : null;
  if (map) {
    const n = Math.max(1, Number(opt.repeat) || 1);
    map.repeat.set(n, n);
    map.needsUpdate = true;
  }
  const glas = opt.glas || stoff.werkstoffklasse === "glas";
  const metall = stoff.werkstoffklasse === "metall";
  return new THREE.MeshStandardMaterial({
    // A photo map already carries its colour. Multiplying by the catalogue hex would tint it twice.
    color: map ? 0xffffff : stoff.farbe,
    map,
    roughness: glas ? 0.12 : metall ? 0.45 : 0.85,
    metalness: metall ? 0.55 : glas ? 0.1 : 0,
    transparent: glas,
    opacity: glas ? 0.55 : 1,
  });
}

/**
 * How often a vendored map repeats.
 * `normiert`: the face UV runs 0–1, so a face of `laenge_m` needs laenge/spanne
 * repeats (at least one). Box walls use that.
 * `meter`: the UV is the shape coordinate in metres, as ExtrudeGeometry writes
 * the top face. One catalogue span is then `1/spanne` of a UV unit, which is
 * below 1 for the 2.1 m tile. Multiplying by the room width as well makes the
 * grain several times too dense.
 * @param {number} spanne_m real width of one repeat, metres
 * @param {number} laenge_m face length, metres (ignored for `meter`)
 * @param {"normiert"|"meter"} [uv]
 * @returns {number}
 */
export function musterWiederholung(spanne_m, laenge_m, uv = "normiert") {
  if (!(spanne_m > 0)) return 1;
  if (uv === "meter") return 1 / spanne_m;
  return Math.max(1, (Number(laenge_m) || spanne_m) / spanne_m);
}

/**
 * Material for a catalogue key, or null when the key is empty or unknown
 * (the caller keeps today's default colour). `laenge_m` sets how often a
 * vendored map repeats along a 0–1 face.
 * @param {string|null|undefined} schluessel
 * @param {number} [laenge_m] face length in metres
 * @param {boolean} [glas] draw as glazing
 * @param {"normiert"|"meter"} [uv] see musterWiederholung
 * @returns {THREE.MeshStandardMaterial|null}
 */
export function materialFuerSchluessel(schluessel, laenge_m = 1, glas = false, uv = "normiert") {
  const stoff = baustoff(schluessel);
  if (!stoff) return null;
  const muster = musterBild(stoff.textur);
  const spanne = musterSpanne_m(muster);
  const repeat = musterWiederholung(spanne, laenge_m, uv);
  return materialErzeugen(stoff, { repeat, glas });
}

export { musterSpanne_m };
