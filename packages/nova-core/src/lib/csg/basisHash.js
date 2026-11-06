// 107-14 (D-BK-08a): hash of the base inputs of a derived solid. The mesh cache keeps a solid only together with this
// hash; when any base input changes (reference line, position, thickness, height, layers with material, openings with sizes)
// or the library/algorithm version changes, the hash differs and the cache entry is stale and discarded. The base geometry
// stays parametric and leading; the mesh is never the source.
//
// Canonical form: keys sorted, numbers rounded to 1e-6 (m) like massingModell.js (rund6), -0 → 0, undefined dropped,
// non-finite → null. Hash: two FNV-1a passes with different seeds → 16 hex characters. The hash function is a copy of
// hashText (@designer/lib/bebauungsvorschlaege.js), because @core must not import from @designer (same pattern as
// WT_MARKER in werkstattBauteile.js). Not cryptographic — it only has to be stable and collision-poor.
//
// In: any JSON-like value. Out: canonical text, 16-hex hash.

/**
 * Version of the CSG derivation. Raise it with every change of a library version or of the algorithm (clean-up, layer
 * order, opening body …), so every cache entry expires at once. 107-18: csg2 = backend manifold-3d (D-BK-08c); every
 * mesh cached by the former backend (csg1, three-bvh-csg) is stale and recomputed.
 */
export const CSG_VERSION = "csg2|manifold-3d@3.5.4";

/**
 * Canonical JSON text of a value (see file head).
 * @param {unknown} wert
 * @returns {string}
 */
export function kanonisch(wert) {
  if (wert === null || wert === undefined) return "null";
  if (typeof wert === "number") {
    if (!Number.isFinite(wert)) return "null";
    const r = Math.round(wert * 1e6) / 1e6;
    return String(r === 0 ? 0 : r); // -0 → 0
  }
  if (typeof wert === "string" || typeof wert === "boolean") return JSON.stringify(wert);
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
  if (typeof wert === "object") {
    const o = /** @type {Record<string, unknown>} */ (wert);
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${kanonisch(o[k])}`).join(",")}}`;
  }
  return "null";
}

/**
 * FNV-1a 32 bit over a string, hex (8 characters).
 * @param {string} text
 * @param {number} seed
 * @returns {string}
 */
function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Hash of the base inputs of one derived solid (16 hex characters), including CSG_VERSION.
 * @param {unknown} eingabe every input of the derivation (m, ids, materials)
 * @param {{version?: string}} [opt] version: replaces CSG_VERSION (tests)
 * @returns {string}
 */
export function basisHash(eingabe, { version = CSG_VERSION } = {}) {
  const s = `${version}|${kanonisch(eingabe)}`;
  return fnv1a(s, 0x811c9dc5) + fnv1a(s, 0x9747b28c);
}
