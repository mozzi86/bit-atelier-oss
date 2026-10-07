// planegcs-WASM-Loader — BROWSER-ONLY (Vite ?url-Import, Muster wie
// @ifc/lib/ifcImport.js für web-ifc). Nie statisch aus getesteten Modulen
// importieren; die UI lädt dieses Modul lazy per await import().
//
// LGPL-Hinweis: @salusoft89/planegcs ist LGPL-2.1-or-later. Die .wasm-Datei
// bleibt ein separates Asset, der JS-Wrapper ein eigener Chunk (manualChunks
// in vite.config.js) — Details in THIRD-PARTY-LICENSES.md.

import { init_planegcs_module, GcsWrapper } from "@salusoft89/planegcs";
import wasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";

/** @type {Promise<GcsWrapper>|null} */
let wrapperPromise = null;

/**
 * Langlebige Solver-Instanz (Singleton). Emscripten-Speicher wird manuell
 * verwaltet — pro App-Lebenszeit EIN Wrapper, pro Solve clear_data() (macht
 * solveCore.runSolve selbst).
 */
export function getSolver() {
  if (!wrapperPromise) {
    wrapperPromise = init_planegcs_module({ locateFile: () => wasmUrl })
      .then((mod) => new GcsWrapper(new mod.GcsSystem()))
      .catch((err) => {
        wrapperPromise = null; // fehlgeschlagenes Init nicht cachen
        throw err;
      });
  }
  return wrapperPromise;
}
