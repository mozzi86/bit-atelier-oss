// @ts-nocheck — Node-only WASM bootstrap (jsconfig types = react only).
// ifcApiNode.js — web-ifc WASM bootstrap for Node (Phase 77 bit-check).
//
// Browser path stays in ifcWasm.js (Vite `?url`). This module resolves the
// local web-ifc.wasm / web-ifc-node.wasm next to the package and calls
// SetWasmPath before Init — no CDN, no new dependency.
//
// In:  nothing (optional absolute wasm directory). Out: initialised IfcAPI.
// Side effect: loads the WASM binary from node_modules once (singleton).

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** @type {Promise<any>|null} */
let apiPromise = null;

/**
 * Absolute directory that contains web-ifc.wasm (trailing separator).
 * @returns {string} path ending with path.sep, metres N/A
 */
export function wasmVerzeichnis() {
  const wasmDatei = require.resolve("web-ifc/web-ifc.wasm");
  return path.dirname(wasmDatei) + path.sep;
}

/**
 * Initialise web-ifc under Node (single-thread). Reuses one IfcAPI.
 * @param {{wasmPfad?: string}} [opt] optional override directory (trailing sep optional)
 * @returns {Promise<any>} initialised IfcAPI
 */
export async function loadIfcApiNode(opt = {}) {
  if (apiPromise) return apiPromise;
  apiPromise = (async () => {
    const WebIFC = require("web-ifc");
    const api = new WebIFC.IfcAPI();
    const dir = opt.wasmPfad
      ? (String(opt.wasmPfad).endsWith(path.sep) ? String(opt.wasmPfad) : String(opt.wasmPfad) + path.sep)
      : wasmVerzeichnis();
    // Second argument true = Node filesystem loader (web-ifc 0.0.78).
    if (typeof api.SetWasmPath === "function") api.SetWasmPath(dir, true);
    await api.Init();
    return api;
  })();
  try {
    return await apiPromise;
  } catch (e) {
    apiPromise = null;
    throw e;
  }
}
