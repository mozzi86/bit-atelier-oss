// 107-18 (D-BK-08c): URL of the manifold-3d WebAssembly binary in the BROWSER. A file of its own because the `?url` import is
// a Vite feature that Node cannot resolve: kern.js imports this module dynamically and only outside Node (same pattern as
// @ifc/lib/ifcWasm.js for web-ifc and @sketch/lib/solver.js for planegcs). Vite emits the binary as a separate asset with a
// content hash (budget.json `assets.manifold`) and returns its final URL here.
//
// In: — . Out: the asset URL of manifold.wasm.

import wasmUrl from "manifold-3d/manifold.wasm?url";

/** Asset URL of manifold.wasm (hashed in the build, served from node_modules in the dev server). */
export const MANIFOLD_WASM_URL = wasmUrl;
