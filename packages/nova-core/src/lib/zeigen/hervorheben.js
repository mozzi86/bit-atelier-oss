// 106-01: highlighting for the pointing states (zustaende.js) — one building block for single
// meshes (BIM studio: emissive tint + edge outline) and for ranges of a merged mesh (IFC viewer:
// the vertex-colour range of one element is recoloured and its edges outlined). Independent of
// React and of any viewer; three.js only. Originals are remembered and restored, everything this
// module creates is disposed.
//
// Form, not only colour (guard rail 5): the outline is solid, dashed (warnung) or dotted (fokus)
// per the state table; a state with a symbol gets a small marker sprite above the element
// (only where a `document` exists to draw it — never in node tests).
//
// Several states on one target are kept as a stack: the highest `rang` decides the fill colour,
// every outline is drawn; clearing one state re-applies the next one, clearing the last restores
// the original look.
//
// Pitfall: for a merged mesh the original vertex colours are remembered when a state is set. If
// the viewer recolours the buffer itself while a state is active (recolorElements, status
// colouring), call alleLoeschen() first, otherwise loeschen() writes the old colours back.
//
// Cost on big models: a state on a range uploads only the touched span of the colour buffer
// (addUpdateRange), the outline edges of an element are cached (small LRU, verwerfen() frees it),
// the outline takes the section planes of the mesh material, and the merged mesh material gets a
// polygon offset while an outline is on it so the lines win the depth test against the faces.
//
// In:  targets {mesh} | {mesh, bereich:{start,count}, farbAttribut?}, a state name.
// Out: hervorhebung(opt) → {setzen, loeschen, alleLoeschen, aktive, verwerfen}; umrissLinie() builds
//      one outline for a caller's own geometry. Side effects: mutates the target's material /
//      colour attribute and adds helper children to the mesh until cleared.
import * as THREE from "three";
import { ZEIGE_ZUSTAENDE, istZeigeZustand } from "./zustaende.js";

/**
 * A highlight target.
 * @typedef {Object} HervorhebZiel
 * @property {THREE.Mesh} mesh  The mesh (single element, or the merged IFC mesh).
 * @property {{start: number, count: number}} [bereich]  Merged mesh only: range in INDEX units
 *   (like model.merged.ranges: first index and number of indices of one element).
 * @property {THREE.BufferAttribute} [farbAttribut]  Merged mesh only: the vertex-colour attribute
 *   (default mesh.geometry.attributes.color).
 */

/**
 * One active highlight, as reported by aktive().
 * @typedef {Object} AktiveHervorhebung
 * @property {THREE.Mesh} mesh
 * @property {{start: number, count: number}|null} bereich  null for a whole single mesh.
 * @property {'fokus'|'auswahl'|'warnung'|'fehler'} zustand
 * @property {string|null} umriss  Material type of the outline ("LineDashedMaterial" = dashed/dotted, "LineBasicMaterial" = solid), null without one.
 * @property {boolean} symbol      True when a marker sprite is attached.
 */

/** Emissive strength of the single-mesh tint [ASSUMED]: strong enough to read, weak enough to keep shading. */
const EMISSIV_INTENSITAET = 0.55;
/** Default length of one outline dash unit, m [ASSUMED]: "6 3" gives 0.3 m dashes, 0.15 m gaps (wall scale). */
const STRICH_EINHEIT_M = 0.05;
/** Edges between faces closer than this angle (degrees) are not outlined (flat faces, tessellation). */
const KANTEN_WINKEL_GRAD = 30;
/** Marker size, m [ASSUMED]: readable next to a wall or a column in an overview. */
const SYMBOL_GROESSE_M = 0.4;
/** Outline edge geometries kept for re-hover [ASSUMED]: 64 elements, oldest dropped first. */
const KANTEN_CACHE_MAX = 64;

/**
 * One outline (solid, dashed or dotted per the state table) for edges the caller built, for
 * example `new THREE.EdgesGeometry(geometry, 30)`. Used by hervorhebung() and by viewers that draw
 * their own selection mesh. The line is never picked and carries userData.zeigeHilfe.
 * @param {THREE.BufferGeometry} kanten  Edge segments, mesh-local, m. Not disposed here.
 * @param {'fokus'|'auswahl'|'warnung'|'fehler'} zustand
 * @param {Object} [opt]
 * @param {number} [opt.strichEinheit]  Length of one dash unit, m (default 0.05).
 * @param {THREE.Plane[]|null} [opt.schnittebenen]  Section planes: the outline is cut away with the element.
 * @returns {THREE.LineSegments}  The line; add it as child of the mesh it belongs to.
 */
export function umrissLinie(kanten, zustand, opt = {}) {
  const look = ZEIGE_ZUSTAENDE[zustand];
  const einheit = opt.strichEinheit ?? STRICH_EINHEIT_M;
  const farbe = new THREE.Color(look.hex);
  /** @type {THREE.LineSegments} */
  let linie;
  if (look.strich) {
    const [dash, gap] = look.strich.split(/\s+/).map(Number);
    const material = new THREE.LineDashedMaterial({ color: farbe, dashSize: dash * einheit, gapSize: gap * einheit });
    linie = new THREE.LineSegments(kanten, material);
    if (!kanten.attributes.lineDistance) linie.computeLineDistances();
  } else {
    linie = new THREE.LineSegments(kanten, new THREE.LineBasicMaterial({ color: farbe }));
  }
  if (opt.schnittebenen && opt.schnittebenen.length) /** @type {any} */ (linie.material).clippingPlanes = opt.schnittebenen;
  linie.renderOrder = 998;
  linie.raycast = () => {}; // helper geometry is never picked
  linie.userData.zeigeHilfe = true;
  linie.userData.zeigeZustand = zustand;
  return linie;
}

/**
 * Create a highlighter. One instance per viewer; call alleLoeschen() when the model is replaced.
 * @param {Object} [opt]
 * @param {number} [opt.strichEinheit]  Length of one dash unit of the outline, m (default 0.05).
 * @param {number} [opt.symbolGroesse]  Edge length of the marker sprite, m (default 0.4).
 * @returns {{
 *   setzen: (ziel: HervorhebZiel, zustand: 'fokus'|'auswahl'|'warnung'|'fehler') => void,
 *   loeschen: (ziel: HervorhebZiel, zustand?: 'fokus'|'auswahl'|'warnung'|'fehler') => void,
 *   alleLoeschen: () => void,
 *   aktive: () => AktiveHervorhebung[],
 *   verwerfen: () => void,
 * }}
 */
export function hervorhebung(opt = {}) {
  const strichEinheit = opt.strichEinheit ?? STRICH_EINHEIT_M;
  const symbolGroesse = opt.symbolGroesse ?? SYMBOL_GROESSE_M;

  /** @type {Map<string, Eintrag>} key = target key + state */
  const eintraege = new Map();
  /** @type {Map<string, MaterialStand>} per single mesh: original material + our clone */
  const materialien = new Map();
  /** @type {WeakMap<THREE.BufferAttribute, Map<number, FarbStand>>} per colour attribute and vertex */
  const farben = new WeakMap();
  /** @type {Map<string, THREE.BufferGeometry>} outline edges per target, insertion order = age */
  const kantenCache = new Map();
  /** @type {Map<string, {anzahl: number, original: [boolean, number, number]}>} polygon offset per merged mesh */
  const versatz = new Map();
  let zaehler = 0;

  /**
   * @typedef {Object} Eintrag
   * @property {number} id
   * @property {HervorhebZiel} ziel
   * @property {string} zielKey
   * @property {'fokus'|'auswahl'|'warnung'|'fehler'} zustand
   * @property {THREE.LineSegments|null} umriss
   * @property {THREE.Sprite|null} symbol
   * @property {number[]|null} ecken  Merged mesh: the vertex numbers the range touches.
   *
   * @typedef {Object} MaterialStand
   * @property {THREE.Material|THREE.Material[]} original
   * @property {THREE.Material|THREE.Material[]} kopie
   * @property {Map<number, any>} gemerkt  per material index: original emissive/colour values
   *
   * @typedef {Object} FarbStand
   * @property {number[]} original  Colour before any highlight, [r, g, b] 0..1.
   * @property {{id: number, rgb: readonly number[], rang: number}[]} lagen  Active layers on this vertex.
   */

  /** @param {HervorhebZiel} z */
  const zielKey = (z) => `${z.mesh.uuid}|${z.bereich ? `${z.bereich.start}:${z.bereich.count}` : "ganz"}`;

  /** @param {HervorhebZiel} ziel */
  function pruefen(ziel) {
    if (!ziel || !ziel.mesh || !ziel.mesh.geometry) throw new Error("Hervorheben: Ziel ohne Mesh.");
    const b = ziel.bereich;
    if (b && !(Number.isInteger(b.start) && Number.isInteger(b.count) && b.start >= 0 && b.count > 0)) {
      throw new Error("Hervorheben: Bereich braucht ganzzahlige start >= 0 und count > 0 (Index-Einheiten).");
    }
    if (b) {
      const g = ziel.mesh.geometry;
      const grenze = g.index ? g.index.count : g.attributes.position.count;
      if (b.start + b.count > grenze) {
        throw new Error(`Hervorheben: Bereich ${b.start}+${b.count} liegt hinter dem Ende des Puffers (${grenze} Einträge).`);
      }
    }
  }

  // ---- merged mesh: vertex colours -------------------------------------------------------

  /** @param {HervorhebZiel} ziel @returns {THREE.BufferAttribute} */
  function farbAttributVon(ziel) {
    const a = ziel.farbAttribut ?? ziel.mesh.geometry.attributes.color;
    if (!a) throw new Error("Hervorheben: Das Mesh hat kein Vertex-Farb-Attribut (color).");
    return /** @type {THREE.BufferAttribute} */ (a);
  }

  /** Distinct vertex numbers touched by a range of the index buffer (or the plain vertex range when not indexed). */
  function eckenVon(ziel) {
    const { start, count } = /** @type {{start: number, count: number}} */ (ziel.bereich);
    const index = ziel.mesh.geometry.index;
    const menge = new Set();
    for (let i = start; i < start + count; i++) menge.add(index ? index.getX(i) : i);
    return [...menge];
  }

  /** Writes the winning layer (highest rang, newest on ties) of a vertex, or its original colour. */
  function eckeSchreiben(attr, v, stand) {
    const lage = stand.lagen.reduce((best, l) => (!best || l.rang >= best.rang ? l : best), null);
    const rgb = lage ? lage.rgb : stand.original;
    attr.setXYZ(v, rgb[0], rgb[1], rgb[2]);
  }

  function farbenSetzen(e, rgb, rang) {
    const attr = farbAttributVon(e.ziel);
    let karte = farben.get(attr);
    if (!karte) farben.set(attr, (karte = new Map()));
    e.ecken = eckenVon(e.ziel);
    for (const v of e.ecken) {
      let st = karte.get(v);
      if (!st) karte.set(v, (st = { original: [attr.getX(v), attr.getY(v), attr.getZ(v)], lagen: [] }));
      st.lagen.push({ id: e.id, rgb, rang });
      eckeSchreiben(attr, v, st);
    }
    hochladen(attr, e.ecken);
  }

  /** Mark only the touched span of the colour buffer for the GPU upload (vertex numbers to floats). */
  function hochladen(attr, ecken) {
    if (!ecken.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of ecken) { if (v < lo) lo = v; if (v > hi) hi = v; }
    attr.addUpdateRange(lo * attr.itemSize, (hi - lo + 1) * attr.itemSize);
    attr.needsUpdate = true;
  }

  function farbenLoeschen(e) {
    const attr = farbAttributVon(e.ziel);
    const karte = farben.get(attr);
    if (!karte || !e.ecken) return;
    for (const v of e.ecken) {
      const st = karte.get(v);
      if (!st) continue;
      st.lagen = st.lagen.filter((l) => l.id !== e.id);
      eckeSchreiben(attr, v, st);
      if (!st.lagen.length) karte.delete(v);
    }
    hochladen(attr, e.ecken);
  }

  // ---- single mesh: emissive tint on a private material copy -----------------------------

  /** Tint the material of a single mesh with the winning state colour (works on our clone only). */
  function materialSetzen(mesh, hex) {
    let st = materialien.get(mesh.uuid);
    if (!st) {
      const original = mesh.material;
      const kopie = Array.isArray(original) ? original.map((m) => m.clone()) : original.clone();
      st = { original, kopie, gemerkt: new Map() };
      for (const m of Array.isArray(kopie) ? kopie : [kopie]) {
        // The outline sits on the surface edge: push the faces back a little so it wins the depth test.
        m.polygonOffset = true;
        m.polygonOffsetFactor = 1;
        m.polygonOffsetUnits = 1;
      }
      materialien.set(mesh.uuid, st);
      mesh.material = kopie;
    }
    const farbe = new THREE.Color(hex);
    for (const m of Array.isArray(st.kopie) ? st.kopie : [st.kopie]) {
      const mm = /** @type {any} */ (m);
      if (mm.emissive) {
        mm.emissive.copy(farbe);
        mm.emissiveIntensity = EMISSIV_INTENSITAET;
      } else if (mm.color) {
        // Basic materials have no emissive channel: mix the state colour into the colour itself.
        mm.color.copy(farbe);
      }
    }
  }

  /** Give the original material back and dispose our clone. */
  function materialZurueck(mesh) {
    const st = materialien.get(mesh.uuid);
    if (!st) return;
    mesh.material = st.original;
    for (const m of Array.isArray(st.kopie) ? st.kopie : [st.kopie]) m.dispose();
    materialien.delete(mesh.uuid);
  }

  // ---- outline and symbol ----------------------------------------------------------------

  /** Geometry holding only the triangles of the range (shares the position buffer, own index). */
  function bereichsGeometrie(ziel) {
    const g = ziel.mesh.geometry;
    const { start, count } = /** @type {{start: number, count: number}} */ (ziel.bereich);
    const teil = new THREE.BufferGeometry();
    teil.setAttribute("position", g.attributes.position);
    if (g.index) {
      teil.setIndex(Array.from({ length: count }, (_, i) => g.index.getX(start + i)));
    } else {
      teil.setDrawRange(start, count);
    }
    return teil;
  }

  /** Edge geometry of the target, from the cache when the element was shown before. */
  function kantenVon(ziel) {
    const key = zielKey(ziel);
    let kanten = kantenCache.get(key);
    if (kanten) { kantenCache.delete(key); kantenCache.set(key, kanten); return kanten; } // refresh its age
    const quelle = ziel.bereich ? bereichsGeometrie(ziel) : ziel.mesh.geometry;
    kanten = new THREE.EdgesGeometry(quelle, KANTEN_WINKEL_GRAD);
    if (ziel.bereich) quelle.dispose(); // only the temporary index geometry; positions stay with the mesh
    kantenCache.set(key, kanten);
    if (kantenCache.size > KANTEN_CACHE_MAX) {
      const aeltester = kantenCache.keys().next().value;
      kantenCache.get(aeltester)?.dispose();
      kantenCache.delete(aeltester);
    }
    return kanten;
  }

  /** The mesh's own (original) material: a clone would hold COPIES of the section planes. */
  function originalMaterial(mesh) {
    const m = materialien.get(mesh.uuid)?.original ?? mesh.material;
    return Array.isArray(m) ? m[0] : m;
  }

  /** Merged mesh: push the faces back while an outline sits on them (lines ignore polygonOffset). */
  function versatzNehmen(mesh) {
    let st = versatz.get(mesh.uuid);
    if (!st) {
      const m = originalMaterial(mesh);
      st = { anzahl: 0, original: [m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits] };
      m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
      versatz.set(mesh.uuid, st);
    }
    st.anzahl += 1;
  }
  function versatzGeben(mesh) {
    const st = versatz.get(mesh.uuid);
    if (!st) return;
    st.anzahl -= 1;
    if (st.anzahl > 0) return;
    const m = originalMaterial(mesh);
    [m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits] = st.original;
    versatz.delete(mesh.uuid);
  }

  function umrissBauen(ziel, zustand) {
    // The outline is cut away with the element: share the section planes of the original material.
    const linie = umrissLinie(kantenVon(ziel), zustand, { strichEinheit, schnittebenen: originalMaterial(ziel.mesh).clippingPlanes });
    ziel.mesh.add(linie);
    if (ziel.bereich) versatzNehmen(ziel.mesh);
    return linie;
  }

  /** Mesh-local point above the element (bounding box centre, top), for the symbol marker. */
  function symbolPunkt(ziel) {
    const box = new THREE.Box3();
    const g = ziel.mesh.geometry;
    if (ziel.bereich) {
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      for (const i of eckenVon(ziel)) box.expandByPoint(v.fromBufferAttribute(pos, i));
    } else {
      g.computeBoundingBox();
      box.copy(/** @type {THREE.Box3} */ (g.boundingBox));
    }
    const c = box.getCenter(new THREE.Vector3());
    return new THREE.Vector3(c.x, box.max.y + symbolGroesse * 0.6, c.z);
  }

  /** Round marker with the glyph; null where no canvas can be made (node, tests). */
  function symbolBauen(ziel, look) {
    if (!look.symbol || typeof document === "undefined") return null;
    const leinwand = document.createElement("canvas");
    leinwand.width = leinwand.height = 64;
    const ctx = leinwand.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = look.hex;
    ctx.stroke();
    ctx.fillStyle = look.hex;
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(look.symbol, 32, 34);
    const textur = new THREE.CanvasTexture(leinwand);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textur, depthTest: false, transparent: true }));
    sprite.scale.set(symbolGroesse, symbolGroesse, 1);
    sprite.position.copy(symbolPunkt(ziel));
    sprite.renderOrder = 999;
    sprite.raycast = () => {};
    sprite.userData.zeigeHilfe = true;
    ziel.mesh.add(sprite);
    return sprite;
  }

  /** Remove a helper object from the mesh and free its GPU resources. */
  function abbauen(obj) {
    if (!obj) return;
    obj.removeFromParent();
    // Outline edges belong to the cache (freed by eviction / verwerfen()), a Sprite's quad is shared.
    if (!obj.isSprite && !obj.isLineSegments) obj.geometry?.dispose();
    const m = /** @type {any} */ (obj.material);
    m?.map?.dispose();
    m?.dispose();
  }

  /** Re-apply the winning single-mesh state after a layer was removed (or restore the original). */
  function einzelNeuZeichnen(mesh) {
    const rest = [...eintraege.values()].filter((e) => e.ziel.mesh === mesh && !e.ziel.bereich);
    if (!rest.length) return materialZurueck(mesh);
    const top = rest.reduce((b, e) => (ZEIGE_ZUSTAENDE[e.zustand].rang >= ZEIGE_ZUSTAENDE[b.zustand].rang ? e : b));
    materialSetzen(mesh, ZEIGE_ZUSTAENDE[top.zustand].hex);
  }

  // ---- public API ------------------------------------------------------------------------

  /**
   * Show a state on a target. Setting the same state on the same target again is a no-op
   * (one highlight per target and state).
   * @param {HervorhebZiel} ziel
   * @param {'fokus'|'auswahl'|'warnung'|'fehler'} zustand
   */
  function setzen(ziel, zustand) {
    pruefen(ziel);
    if (!istZeigeZustand(zustand)) {
      throw new Error(`Hervorheben: Unbekannter Zustand "${zustand}" (erlaubt: fokus, auswahl, warnung, fehler).`);
    }
    const key = `${zielKey(ziel)}|${zustand}`;
    if (eintraege.has(key)) return;
    const look = ZEIGE_ZUSTAENDE[zustand];
    /** @type {Eintrag} */
    const e = { id: ++zaehler, ziel, zielKey: zielKey(ziel), zustand, umriss: null, symbol: null, ecken: null };
    if (ziel.bereich) farbenSetzen(e, look.rgb, look.rang);
    eintraege.set(key, e);
    if (!ziel.bereich) einzelNeuZeichnen(ziel.mesh);
    e.umriss = umrissBauen(ziel, zustand);
    e.symbol = symbolBauen(ziel, look);
  }

  /** @param {Eintrag} e */
  function entfernen(e) {
    if (e.umriss && e.ziel.bereich) versatzGeben(e.ziel.mesh);
    abbauen(e.umriss);
    abbauen(e.symbol);
    if (e.ziel.bereich) farbenLoeschen(e);
    eintraege.delete(`${e.zielKey}|${e.zustand}`);
    if (!e.ziel.bereich) einzelNeuZeichnen(e.ziel.mesh);
  }

  /**
   * Remove the highlight(s) of a target and restore its original look.
   * @param {HervorhebZiel} ziel
   * @param {'fokus'|'auswahl'|'warnung'|'fehler'} [zustand]  Only this state; all states of the target when omitted.
   */
  function loeschen(ziel, zustand) {
    if (!ziel || !ziel.mesh) return;
    const key = zielKey(ziel);
    for (const e of [...eintraege.values()]) {
      if (e.zielKey === key && (!zustand || e.zustand === zustand)) entfernen(e);
    }
  }

  /** Remove every highlight of this highlighter and restore all originals. */
  function alleLoeschen() {
    for (const e of [...eintraege.values()]) entfernen(e);
  }

  /** @returns {AktiveHervorhebung[]}  Snapshot of the active highlights (oldest first). */
  function aktive() {
    return [...eintraege.values()].map((e) => ({
      mesh: e.ziel.mesh, bereich: e.ziel.bereich ? { ...e.ziel.bereich } : null, zustand: e.zustand,
      umriss: e.umriss ? /** @type {any} */ (e.umriss.material).type : null, symbol: !!e.symbol,
    }));
  }

  /**
   * Remove every highlight and free the cached outline geometries. Call when the model or its
   * meshes are replaced and when the viewer unmounts (alleLoeschen() alone keeps the cache for the
   * next hover).
   */
  function verwerfen() {
    alleLoeschen();
    for (const g of kantenCache.values()) g.dispose();
    kantenCache.clear();
  }

  return { setzen, loeschen, alleLoeschen, aktive, verwerfen };
}
