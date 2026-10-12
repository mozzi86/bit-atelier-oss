// 69-21: Web Worker around the IFC reading of the check suite. web-ifc's OpenModel and
// StreamAllMeshes block for seconds on real models; in the worker the page stays responsive
// (progress text, cancel, scrolling). The worker imports the same ifcImport.js functions the
// main thread used — one code path, the worker only moves it.
//
// In:  { nonce, buffer: ArrayBuffer, parse: boolean, geometrie: null | { coordinateToOrigin } }
// Out: { nonce, fortschritt: string }                                       — any number of times
//      { nonce, parsed, parseFehler, geo }                                   — once, at the end
//      { nonce, fehler: string }                                             — instead, on failure
// The triangle arrays of geo.elemente are transferred, not copied.
// Loaded by @ifc/lib/ifcLesen.js via `new Worker(new URL(…, import.meta.url), { type: "module" })`.
/* global self */
import { parseIfcFile, extractGeometry } from "./ifcImport.js";

self.onmessage = async (ev) => {
  const d = ev && ev.data && typeof ev.data === "object" ? ev.data : {};
  const nonce = d.nonce;
  const fortschritt = (text) => self.postMessage({ nonce, fortschritt: String(text ?? "") });
  try {
    let parsed = null;
    let parseFehler = null;
    if (d.parse) {
      try {
        parsed = await parseIfcFile(d.buffer, fortschritt);
      } catch (e) {
        parseFehler = e instanceof Error ? e.message : String(e);
      }
    }
    let geo = null;
    if (d.geometrie) geo = await extractGeometry(d.buffer, fortschritt, d.geometrie);
    const transfer = geo ? geo.elemente.map((el) => el.tris?.buffer).filter(Boolean) : [];
    self.postMessage({ nonce, parsed, parseFehler, geo }, { transfer });
  } catch (e) {
    self.postMessage({ nonce, fehler: e instanceof Error ? e.message : String(e) });
  }
};
