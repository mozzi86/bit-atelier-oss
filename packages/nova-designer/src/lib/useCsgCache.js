// 107-14 (D-BK-08a): the ONE writer of the Fachlayer `csg_cache_layer` — a thin hook over useFachlayer around the pure cache
// functions of @core/lib/csg/cache.js and the write flow of @core/lib/csg/cacheAblauf.js (tested there without React). It
// lives in @designer because useFachlayer does; @core functions that derive solids never import it, the BIM studio passes the
// cache functions in as a parameter (ctx).
//
// Rules: the mesh is a discardable cache, never a source; an entry is used only with the same checksum (hash of every base
// input); writes go through useFachlayer's own debounce and never run inside the input effects of the element fields (those
// write the BimModel element fields — a separate field, a separate save). Mounted in the BIM studio by its first caller, 107-09
// (switch "Wände verschneiden"). Blobs of evicted or stale entries are deleted; a failed delete is reported on the
// console and otherwise ignored (an orphaned blob costs space, not data). A result that arrives after a project switch, an
// unmount or while the layer loads is dropped and its blob deleted (review 107-14).
// 107-09: the cache modules (cache.js, cacheAblauf.js: three, the mesh coding, the storage rule) are loaded on the FIRST read or
// write, not with the studio — the studio chunk stays within its size budget, and a project with the switch off never loads them.
// The empty layer is a local copy of CSG_CACHE_LEER (same shape, guarded by a unit test), so the hook needs no static import of cache.js.
// 107-09 (107-14 review, capacity): [ASSUMED] the inline cache with eviction of the oldest entries stays (no object store for meshes
// below 256 KB, not limited to visible components). Measured 26.10.2026 (node, development machine): wall 4 m, 2 layers, 1 window
// 7.4 KB; cavity hull wall 10 m, 5 layers 31–37 KB → about 7 hull walls or 35 two-layer walls fit, the rest is evicted. Reason: an
// object-store write per wall and change costs network and leaves blobs to delete, while computing again is cheap (4 cavity hull walls
// 88 ms, 12 walls of the golden scenario 187 ms). Way to a decided value: hit rate and computing time on real projects; then either a
// threshold to the object store or only the visible storey.
// 107-09 (107-14 review): a field conflict between two devices on this layer is discarded, not shown as a card — saveBimModel keeps
// the stored version (useBimModelSync VERWERFBARE_FELDER); the label "3D-Zwischenspeicher (CSG)" in FELD_NAMEN stays for other readers.
//
// In: project id. Out: {layer, lesen, schreiben, bereinigen}.

import { useCallback, useEffect, useRef } from "react";
import { useFachlayer } from "@designer/lib/useFachlayer";

/** Empty cache layer — the same value as CSG_CACHE_LEER of @core/lib/csg/cache.js (a copy, see file head). */
export const CSG_CACHE_LEER_HOOK = Object.freeze({ eintraege: Object.freeze({}) });

/** @type {Promise<[typeof import("@core/lib/csg/cache.js"), typeof import("@core/lib/csg/cacheAblauf.js")]>|null} */
let module = null;
/** The two cache modules, loaded once (a failed load is forgotten so the next call tries again). */
function cacheModule() {
  if (!module) {
    module = Promise.all([import("@core/lib/csg/cache.js"), import("@core/lib/csg/cacheAblauf.js")]).catch((e) => {
      module = null;
      throw e;
    });
  }
  return module;
}

/**
 * Mesh cache of the CSG core for one project.
 * @param {string|null} projectId
 * @param {{api?: any}} [opt] api: bitApi replacement (tests)
 * @returns {{layer: import("@core/lib/csg/cache.js").CacheLayer, lesen: (schluessel: string, hash: string) => Promise<import("three").BufferGeometry|null>, schreiben: (schluessel: string, hash: string, geo: import("three").BufferGeometry, meta?: {volumen_m3?: number|null, quelle?: "solid"|"analytisch", warnung?: string|null}) => Promise<boolean>, bereinigen: (gueltig: Map<string, string>, bereich?: (schluessel: string) => boolean) => void}}
 */
export function useCsgCache(projectId, opt = {}) {
  const [layer, setLayer, istLadend] = useFachlayer(projectId, "csg_cache_layer", CSG_CACHE_LEER_HOOK);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const projektRef = useRef(projectId);
  projektRef.current = projectId;
  const montiertRef = useRef(true);
  useEffect(() => {
    montiertRef.current = true;
    return () => {
      montiertRef.current = false;
    };
  }, []);
  const api = opt.api;

  /** access to the layer, bound to the project at the start of an operation */
  const zugriff = useCallback((/** @type {string|null} */ pid) => ({
    api,
    holen: () => layerRef.current,
    setzen: (/** @type {any} */ l) => {
      layerRef.current = l;
      setLayer(l);
    },
    aktiv: () => montiertRef.current && projektRef.current === pid && !istLadend(),
  }), [api, setLayer, istLadend]);

  const lesen = useCallback(async (/** @type {string} */ schluessel, /** @type {string} */ hash) => {
    // nothing stored under this key and hash: no module load needed (the common case of a first run)
    const roh = layerRef.current?.eintraege?.[schluessel];
    if (!roh || roh.pruefsumme !== hash) return null;
    try {
      const [cache] = await cacheModule();
      const e = cache.cacheLesen(layerRef.current, schluessel, hash);
      return e ? await cache.cacheEintragLaden(e, { api }) : null;
    } catch (err) {
      console.warn(`[csg-cache] entry ${schluessel} not readable, computed again (${/** @type {any} */ (err)?.message || err})`);
      return null;
    }
  }, [api]);

  const schreiben = useCallback(async (/** @type {string} */ schluessel, /** @type {string} */ hash, /** @type {any} */ geo, /** @type {any} */ meta = {}) => {
    const pid = projektRef.current;
    const [, ablauf] = await cacheModule();
    return ablauf.cacheEintragNeu(zugriff(pid), schluessel, hash, geo, meta);
  }, [zugriff]);

  // review 107-10: `bereich` = the keys of the calling derivation (107-09 intersection or 107-10 solid relations), see cacheBereinigen
  const bereinigen = useCallback((/** @type {Map<string, string>} */ gueltig, /** @type {((schluessel: string) => boolean)|undefined} */ bereich = undefined) => {
    const pid = projektRef.current;
    if (!Object.keys(layerRef.current?.eintraege || {}).length) return;
    void cacheModule().then(([, ablauf]) => ablauf.cacheLayerBereinigen(zugriff(pid), gueltig, bereich))
      .catch((e) => console.warn(`[csg-cache] clean-up failed (${e?.message || e})`));
  }, [zugriff]);

  return { layer, lesen, schreiben, bereinigen };
}
