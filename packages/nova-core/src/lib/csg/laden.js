// 107-14: lazy loading of the CSG backend. The dynamic import keeps kern.js and the boolean library in their own chunk
// (`csg`); nothing on the start path pulls them. Loaded once and remembered; a failed load is forgotten, so the next call
// tries again. Every caller computes asynchronously and keeps today's construction visible until the result is there
// (fallback on a load error, an open input or a volume deviation).
// 107-18 (D-BK-08c): the backend is manifold-3d, a WebAssembly library — the promise resolves only after its binary is
// instantiated (kern.kernLaden()), so the operations of the returned module are synchronous and ready to use.
//
// In: nothing. Out: Promise of the module kern.js. Callers use its boolesch() (with the watertight check); csgBackend and
// manifoldVorbereiten are exported for booleschMit and the tests only.

/** @type {Promise<typeof import("./kern.js")>|null} */
let versprechen = null;

/**
 * Loads the CSG backend once (module and WebAssembly binary).
 * @returns {Promise<typeof import("./kern.js")>}
 */
export function csgLaden() {
  if (!versprechen) {
    versprechen = import("./kern.js")
      .then(async (kern) => {
        await kern.kernLaden();
        return kern;
      })
      .catch((e) => {
        versprechen = null;
        throw e;
      });
  }
  return versprechen;
}
