// 107-14 (D-BK-08a, review): the write and clean-up flow of the mesh cache as plain async functions, so the order of the
// steps is testable without React (tests/unit/csg-10714.test.js). The hook @designer/lib/useCsgCache.js only binds them to
// useFachlayer (`holen` = current layer, `setzen` = the layer setter, `aktiv` = same project, mounted, loaded).
//
// Order of a write: (1) store the payload by the storage rule (a blob is created only above the database limit), (2) check
// that the caller is still active — a result that arrives after a project switch, an unmount or while the layer loads must
// not land in another project's layer and must not leave its blob behind, (3) write the entry into a NEW layer (eviction of
// the oldest inline entries), (4) set the layer, (5) delete the blobs of evicted entries. A refused write deletes its own
// blob. Every blob delete only reports its error (an orphaned blob costs space, not data).
// Known gap (for 107-09): when the component unmounts after (4) but before useFachlayer's debounced save started, the new
// layer is lost and its blob orphaned; useFachlayer flushes only a save that is already pending.
//
// In: a cache access {holen, setzen, aktiv?, api?}, key, hash, geometry. Out: whether the entry was written; blobs deleted.

import { cacheSchreiben, cacheBereinigen, cacheAblegen } from "./cache.js";

/**
 * @typedef {object} CacheZugriff
 * @property {() => import("./cache.js").CacheLayer} holen       the current layer
 * @property {(layer: import("./cache.js").CacheLayer) => void} setzen  writes the new layer (useFachlayer's setter)
 * @property {() => boolean} [aktiv]  false after a project switch, an unmount or while the layer loads
 * @property {any} [api]              bitApi replacement (tests)
 */

/**
 * Deletes the blobs of removed cache entries; errors are only reported on the console.
 * @param {Array<{schluessel: string, objekt_id: string|null}>} weg
 * @param {any} [api] bitApi (tests)
 * @returns {Promise<number>} number of blobs deleted
 */
export async function cacheBlobsLoeschen(weg, api) {
  const ids = weg.map((w) => w.objekt_id).filter(Boolean);
  if (!ids.length) return 0;
  const bit = api || (await import("@core/api/bitApi")).bitApi;
  let n = 0;
  for (const id of ids) {
    try {
      await bit.blobs.delete(id);
      n += 1;
    } catch (e) {
      console.warn(`[csg-cache] blob ${id} could not be deleted (${/** @type {any} */ (e)?.message || e})`);
    }
  }
  return n;
}

/**
 * Stores one computed solid in the cache (order: see file head).
 * @param {CacheZugriff} z
 * @param {string} schluessel cacheSchluessel(guid, art)
 * @param {string} hash basisHash of today's inputs
 * @param {import("three").BufferGeometry} geo local geometry
 * @param {{volumen_m3?: number|null, quelle?: "solid"|"analytisch", warnung?: string|null, jetzt?: Date}} [meta]
 * @returns {Promise<boolean>} true when the entry is in the layer
 */
export async function cacheEintragNeu(z, schluessel, hash, geo, meta = {}) {
  const r = await cacheAblegen(geo, { ...meta, pruefsumme: hash, api: z.api });
  if (!r) return false;
  const eigener = r.eintrag.objekt_id ? [{ schluessel, objekt_id: r.eintrag.objekt_id }] : [];
  if (z.aktiv && !z.aktiv()) {
    await cacheBlobsLoeschen(eigener, z.api);
    return false;
  }
  const s = cacheSchreiben(z.holen(), schluessel, r.eintrag);
  if (!s.geschrieben) {
    await cacheBlobsLoeschen(eigener, z.api);
    return false;
  }
  z.setzen(s.layer);
  await cacheBlobsLoeschen(s.verdraengt, z.api);
  return true;
}

/**
 * Removes the entries of deleted elements and stale hashes and deletes their blobs.
 * @param {CacheZugriff} z
 * @param {Map<string, string>} gueltig key → today's hash of every element that still exists
 * @param {(schluessel: string) => boolean} [bereich] keys this clean-up is responsible for (review 107-10, cacheBereinigen)
 * @returns {Promise<number>} number of removed entries
 */
export async function cacheLayerBereinigen(z, gueltig, bereich) {
  if (z.aktiv && !z.aktiv()) return 0;
  const r = cacheBereinigen(z.holen(), gueltig, bereich);
  if (!r.entfernt.length) return 0;
  z.setzen(r.layer);
  await cacheBlobsLoeschen(r.entfernt, z.api);
  return r.entfernt.length;
}
