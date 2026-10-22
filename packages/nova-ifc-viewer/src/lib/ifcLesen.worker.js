// 69-21: Web Worker around the IFC reading of the check suite. web-ifc's OpenModel and
// StreamAllMeshes block for seconds on real models; in the worker the page stays responsive
// (progress text, cancel, scrolling). The worker imports the same ifcImport.js functions the
// main thread used — one code path, the worker only moves it.
//
// In:  { nonce, buffer: ArrayBuffer, parse: boolean, geometrie: null | { coordinateToOrigin } }
// Out: { nonce, fortschritt: string }                                       — any number of times
//      { nonce, teil: { art: "elements"|"elemente", liste: any[] } }        — any number of times
//      { nonce, parsed, parseFehler, geo }                                   — once, at the end
//      { nonce, fehler: string }                                             — instead, on failure
// parsed.elements and geo.elemente arrive in parts (TEIL_GROESSE each) before the final message,
// which carries them as empty arrays: deserialising one message is a single main-thread task, and
// for ~2 400 elements with psets/qty/layers that task alone took 86–101 ms (22.10.2026, synthetic
// 10 MB model), above the 100 ms gate. Parts keep each task short whatever the model size.
// The triangle arrays of geo.elemente are transferred, not copied.
// Loaded by @ifc/lib/ifcLesen.js via `new Worker(new URL(…, import.meta.url), { type: "module" })`.
/* global self */
import { parseIfcFile, extractGeometry } from "./ifcImport.js";

/** Elements per part message (count, not bytes) — ~10 ms to deserialise on a desktop CPU. */
const TEIL_GROESSE = 250;

/**
 * Posts a list in parts of TEIL_GROESSE; for geometry the triangle buffers of each part are transferred.
 * @param {any} nonce
 * @param {"elements"|"elemente"} art
 * @param {any[]} liste
 */
function inTeilenSenden(nonce, art, liste) {
  for (let i = 0; i < liste.length; i += TEIL_GROESSE) {
    const teil = liste.slice(i, i + TEIL_GROESSE);
    const transfer = art === "elemente" ? teil.map((el) => el.tris?.buffer).filter(Boolean) : [];
    self.postMessage({ nonce, teil: { art, liste: teil } }, { transfer });
  }
}

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
    if (parsed) inTeilenSenden(nonce, "elements", parsed.elements);
    if (geo) inTeilenSenden(nonce, "elemente", geo.elemente);
    self.postMessage({
      nonce,
      parsed: parsed ? { ...parsed, elements: [] } : null,
      parseFehler,
      geo: geo ? { ...geo, elemente: [] } : null,
    });
  } catch (e) {
    self.postMessage({ nonce, fehler: e instanceof Error ? e.message : String(e) });
  }
};
