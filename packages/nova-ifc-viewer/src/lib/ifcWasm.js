// WASM-Bootstrap für web-ifc im BROWSER — bewusst als eigenes Modul (Phase 33 / W2).
//
// Warum getrennt von ifcImport.js: der `?url`-Import unten ist eine Vite-Spezialität und
// in Node NICHT auflösbar. Solange er im Kopf von ifcImport.js stand, war die gesamte
// Elementwahrheit nur im Browser ladbar — und damit nur per Playwright prüfbar.
// Jetzt lädt ifcImport.js dieses Modul DYNAMISCH (erst beim echten Datei-Import), sodass
// dieselbe Extraktionslogik in `node --test` gegen das echte 233-MB-IFC läuft (Gate G5).
//
// WASM-Laden im Vite-Kontext: `?url`-Import der lokalen web-ifc.wasm aus node_modules;
// Init() bekommt einen customLocateFileHandler, der die (im Prod-Build gehashte)
// Asset-URL direkt zurückgibt — SetWasmPath allein würde im dist auf den falschen
// (ungehashten) Dateinamen zeigen.
// forceSingleThread=true: nur web-ifc.wasm wird gebundelt (kein -mt/COOP/COEP).

import * as WebIFC from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";

let apiPromise = null;

/** Initialisierte IfcAPI (Singleton — Init läuft genau einmal je Seitenaufruf). */
export function loadIfcApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new WebIFC.IfcAPI();
      // Fallback-Pfad (Verzeichnis der URL, absolute=true) — der Handler unten gewinnt.
      api.SetWasmPath(wasmUrl.slice(0, wasmUrl.lastIndexOf("/") + 1), true);
      await api.Init(
        (path, prefix) => (path.endsWith("web-ifc.wasm") ? wasmUrl : prefix + path),
        true, // forceSingleThread — web-ifc-mt.wasm wird nicht gebundelt
      );
      return api;
    })().catch((e) => {
      apiPromise = null; // fehlgeschlagenes Init nicht cachen
      throw e;
    });
  }
  return apiPromise;
}
