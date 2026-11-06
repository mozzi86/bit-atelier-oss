// 107-14 (D-BK-08a): the mesh cache of the CSG core — Fachlayer `csg_cache_layer` (version 1). The mesh is ONLY an
// intermediate store: the base geometry leads and stays parametric; an entry is valid only while its `pruefsumme` (basisHash
// over every base input including CSG_VERSION) equals the hash of today's inputs; otherwise it is stale and discarded.
// No reader treats the mesh as truth; plans, views and the IFC never read it as a source.
//
// Layer form (German field names, guardrail 2; mapped from the return value of speicherOrt.inhaltAblegen — a later rename
// would be a migration):
//   { eintraege: { "<schluessel>": { pruefsumme, ort: "datenbank"|"objektspeicher", objekt_id, inhalt, groesse_bytes,
//                                    dreiecke, volumen_m3, quelle: "solid"|"analytisch", warnung: code|null, erzeugt: ISO } } }
//   inhaltAblegen → layer: ort "db" ↔ "datenbank", "blob" ↔ "objektspeicher", blob ↔ objekt_id, inline ↔ inhalt, bytes ↔ groesse_bytes.
// Key: element GUID (stored or derived, 107-08) plus kind ("<guid>|wand").
//
// Storage follows speicherOrt.js (profile `meshCache`, grows with the project): below 256 KB in the database, the grey zone
// and above 1 MB in the object store. One rule that does NOT hold for a cache: the fallback of inhaltAblegen (no object store
// → payload stays in the database with a `hinweis`) is unwanted here — a cache may be lost, the database must not be
// burdened; such a payload is not written. The inline entries of the layer together stay below DB_MAX_BYTES (the layer goes
// through useFachlayer as ONE JSON blob, stringified on every change); beyond it the oldest entries are evicted.
// Capacity [ASSUMED] sufficient until 107-09 measures real use: every mesh below 256 KB goes inline, so all inline entries
// share these 256 KB. Measured 26.10.2026 (payload incl. base64): wall 1 layer + 1 opening ≈ 3.4 KB, wall 6 m with 3 layers
// + 3 openings 24.9 KB — 10 of 40 such walls stay, every further write evicts the oldest one (test "Kapazität des
// Inline-Caches" in tests/unit/csg-review-10714.test.js, hit rate 25 %). 107-18 (backend manifold-3d, edge-conforming
// results without T-junctions): the same wall is 216 instead of 514 triangles, 10.3 KB — 24 of 40 walls stay (60 %).
// Decision for 107-09 (open): entries above a small threshold (for instance 8 KB) into the object store, or the cache
// limited to the visible components; until then the cache is correct but has a low hit rate on real projects.
//
// Payload: positions Float32 little-endian as base64, non-indexed triangle list, groups {start, count, materialIndex}.
// Normals are recomputed flat on loading: every component of this plan is made of plane faces [ASSUMED] — a curved roof
// (open, 107-10) would need stored or smoothed normals and a new payload format.
//
// In: geometries, layer objects, hashes. Out: payloads, NEW layer objects (never mutated), geometries.

import * as THREE from "three";
import { dreieckAnzahl, geometrieBereinigen } from "./dreiecke.js";
import { DB_MAX_BYTES, bytesVon, inhaltAblegen, inhaltLaden, blobIdNeu } from "../speicherOrt.js";

/** Empty cache layer (default value of useFachlayer). */
export const CSG_CACHE_LEER = Object.freeze({ eintraege: Object.freeze({}) });

/** Payload format; raise together with CSG_VERSION when the layout changes. */
export const MESH_FORMAT = "csg-mesh-1";

/**
 * @typedef {object} MeshPayload
 * @property {string} format          MESH_FORMAT
 * @property {string} positionen_b64  Float32 LE xyz per corner, 3 corners per triangle, m
 * @property {Array<{start: number, count: number, materialIndex: number}>} gruppen  in corner units
 * @property {number} dreiecke
 * @typedef {object} CacheEintrag
 * @property {string} pruefsumme
 * @property {"datenbank"|"objektspeicher"} ort
 * @property {string|null} objekt_id
 * @property {MeshPayload|null} inhalt
 * @property {number} groesse_bytes
 * @property {number} dreiecke
 * @property {number|null} volumen_m3
 * @property {"solid"|"analytisch"} quelle
 * @property {string|null} warnung
 * @property {string} erzeugt          ISO time
 * @typedef {{eintraege: Record<string, CacheEintrag>, v?: number, updatedAt?: string}} CacheLayer
 */

/**
 * Cache key of one derived solid.
 * @param {string} guid element GUID (stored or derived)
 * @param {string} art kind of derivation ("wand", "platte", …)
 * @returns {string}
 */
export function cacheSchluessel(guid, art) {
  return `${guid}|${art}`;
}

/** @param {Uint8Array} bytes @returns {string} */
function zuBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
/** @param {string} text @returns {Uint8Array} */
function ausBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Mesh → payload (see file head). The geometry is cleaned first (draw range only).
 * @param {THREE.BufferGeometry} geo
 * @returns {MeshPayload}
 */
export function meshKodieren(geo) {
  const sauber = geo.getIndex() || geo.drawRange.start !== 0 || Number.isFinite(geo.drawRange.count) ? geometrieBereinigen(geo) : geo;
  const pos = /** @type {Float32Array} */ (sauber.getAttribute("position").array);
  const roh = new ArrayBuffer(pos.length * 4);
  const dv = new DataView(roh);
  // little-endian on every machine
  for (let i = 0; i < pos.length; i += 1) dv.setFloat32(i * 4, pos[i], true);
  const gruppen = (sauber.groups.length ? sauber.groups : [{ start: 0, count: pos.length / 3, materialIndex: 0 }])
    .map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 }));
  const payload = { format: MESH_FORMAT, positionen_b64: zuBase64(new Uint8Array(roh)), gruppen, dreiecke: dreieckAnzahl(sauber) };
  if (sauber !== geo) sauber.dispose();
  return payload;
}

/**
 * Payload → mesh with flat normals.
 * @param {MeshPayload} payload
 * @returns {THREE.BufferGeometry}
 * @throws {Error} on an unknown format
 */
export function meshDekodieren(payload) {
  if (payload?.format !== MESH_FORMAT) throw new Error(`unknown cache format: ${payload?.format}`);
  const bytes = ausBase64(payload.positionen_b64);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pos = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < pos.length; i += 1) pos[i] = dv.getFloat32(i * 4, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  for (const g of payload.gruppen) geo.addGroup(g.start, g.count, g.materialIndex);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Valid entry for a key, or null. An entry with another checksum is stale (a base input or CSG_VERSION changed) and is
 * treated as missing; cacheBereinigen removes it.
 * @param {CacheLayer|null|undefined} layer
 * @param {string} schluessel
 * @param {string} hash basisHash of today's inputs
 * @returns {CacheEintrag|null}
 */
export function cacheLesen(layer, schluessel, hash) {
  const e = layer?.eintraege?.[schluessel];
  return e && e.pruefsumme === hash ? e : null;
}

/**
 * Bytes an entry occupies in the database field (its inline payload).
 * @param {CacheEintrag} e
 * @returns {number}
 */
function inlineBytes(e) {
  return e.inhalt ? bytesVon(e.inhalt) : 0;
}

/**
 * New layer with the entry written; the oldest inline entries are evicted until all inline payloads together stay below
 * DB_MAX_BYTES. An inline entry that alone exceeds the limit is not written.
 * @param {CacheLayer|null|undefined} layer
 * @param {string} schluessel
 * @param {CacheEintrag} eintrag
 * @returns {{layer: CacheLayer, verdraengt: Array<{schluessel: string, objekt_id: string|null}>, geschrieben: boolean}}
 *   verdraengt: evicted entries (their blobs are to be deleted by the caller)
 */
export function cacheSchreiben(layer, schluessel, eintrag) {
  const alt = { ...(layer?.eintraege || {}) };
  /** @type {Array<{schluessel: string, objekt_id: string|null}>} */
  const verdraengt = [];
  if (inlineBytes(eintrag) >= DB_MAX_BYTES) return { layer: { ...(layer || {}), eintraege: alt }, verdraengt, geschrieben: false };
  const vorher = alt[schluessel];
  if (vorher && vorher.objekt_id && vorher.objekt_id !== eintrag.objekt_id) verdraengt.push({ schluessel, objekt_id: vorher.objekt_id });
  alt[schluessel] = eintrag;
  const summe = () => Object.values(alt).reduce((s, e) => s + inlineBytes(e), 0);
  const aelteste = Object.entries(alt).filter(([k, e]) => k !== schluessel && e.inhalt).sort((x, y) => String(x[1].erzeugt).localeCompare(String(y[1].erzeugt)));
  while (summe() >= DB_MAX_BYTES && aelteste.length) {
    const [k, e] = /** @type {[string, CacheEintrag]} */ (aelteste.shift());
    delete alt[k];
    verdraengt.push({ schluessel: k, objekt_id: e.objekt_id });
  }
  return { layer: { ...(layer || {}), eintraege: alt }, verdraengt, geschrieben: true };
}

/**
 * New layer without entries of deleted elements or with old hashes.
 * Review 107-10: two derivations share the layer (the intersection of 107-09 and the solid relations of 107-10, keys
 * "<guid>|seo:<ids>"); each knows only its own valid keys. `bereich` limits the clean-up to the keys of the caller — entries outside
 * it are kept untouched, so one derivation never deletes (and the other rewrites) the entries of the other.
 * @param {CacheLayer|null|undefined} layer
 * @param {Map<string, string>} gueltig key → today's hash of every element that still exists
 * @param {(schluessel: string) => boolean} [bereich] keys this clean-up is responsible for (default: all)
 * @returns {{layer: CacheLayer, entfernt: Array<{schluessel: string, objekt_id: string|null}>}} entfernt: their blobs are to be deleted
 */
export function cacheBereinigen(layer, gueltig, bereich) {
  /** @type {Record<string, CacheEintrag>} */
  const neu = {};
  /** @type {Array<{schluessel: string, objekt_id: string|null}>} */
  const entfernt = [];
  for (const [k, e] of Object.entries(layer?.eintraege || {})) {
    if ((bereich && !bereich(k)) || gueltig.get(k) === e.pruefsumme) neu[k] = e;
    else entfernt.push({ schluessel: k, objekt_id: e.objekt_id });
  }
  return { layer: { ...(layer || {}), eintraege: neu }, entfernt };
}

/**
 * Stores a mesh by the storage rule and builds the layer entry. Returns null when it must not be written (fallback of the
 * object store into the database, see file head).
 * @param {THREE.BufferGeometry} geo
 * @param {{pruefsumme: string, volumen_m3?: number|null, quelle?: "solid"|"analytisch", warnung?: string|null, jetzt?: Date, api?: any}} meta
 * @returns {Promise<{eintrag: CacheEintrag, hinweis: null}|null>}
 */
export async function cacheAblegen(geo, meta) {
  const payload = meshKodieren(geo);
  const r = await inhaltAblegen(payload, { blobId: blobIdNeu("csg"), art: "meshCache", api: meta.api });
  if (r.hinweis) return null; // the object store was not reachable: a cache does not go into the database instead
  return {
    eintrag: {
      pruefsumme: meta.pruefsumme,
      ort: r.ort === "blob" ? "objektspeicher" : "datenbank",
      objekt_id: r.blob,
      inhalt: r.inline,
      groesse_bytes: r.bytes,
      dreiecke: payload.dreiecke,
      volumen_m3: meta.volumen_m3 ?? null,
      quelle: meta.quelle || "solid",
      warnung: meta.warnung ?? null,
      erzeugt: (meta.jetzt || new Date()).toISOString(),
    },
    hinweis: null,
  };
}

/**
 * Loads the mesh of an entry (inline or from the object store).
 * @param {CacheEintrag} eintrag
 * @param {{api?: any}} [opt]
 * @returns {Promise<THREE.BufferGeometry|null>}
 */
export async function cacheEintragLaden(eintrag, { api } = {}) {
  const payload = await inhaltLaden(eintrag.inhalt, eintrag.objekt_id, { api });
  return payload ? meshDekodieren(payload) : null;
}
