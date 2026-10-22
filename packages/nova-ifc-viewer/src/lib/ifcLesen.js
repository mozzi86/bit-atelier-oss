// 69-21: read an IFC model off the main thread. One call = one worker run that parses the semantics
// (parseIfcFile, may fail on catalogue-less models) and/or streams the geometry (extractGeometry).
// Falls back to the same functions on the main thread when `Worker` is missing (node tests) or the
// worker cannot start (old browser, blocked module worker) — the result shape is identical.
//
// In:  ArrayBuffer (the caller keeps it — the worker gets a copy), what to read, progress callback.
// Out: { parsed, parseFehler, geo, imWorker } — geo as extractGeometry returns it, or null.
/* global Worker */
import { parseIfcFile, extractGeometry } from "./ifcImport.js";

let naechsteNonce = 0;

/**
 * Same work on the main thread (fallback path).
 * @param {ArrayBuffer} buffer
 * @param {{parse?: boolean, geometrie?: {coordinateToOrigin?: boolean}|null}} was
 * @param {(text: string) => void} fortschritt
 */
async function lesenHier(buffer, was, fortschritt) {
  let parsed = null;
  let parseFehler = null;
  if (was.parse) {
    try { parsed = await parseIfcFile(buffer, fortschritt); } catch (e) { parseFehler = e instanceof Error ? e.message : String(e); }
  }
  const geo = was.geometrie ? await extractGeometry(buffer, fortschritt, was.geometrie) : null;
  return { parsed, parseFehler, geo, imWorker: false };
}

/**
 * Read an IFC model in a Web Worker (fallback: main thread).
 * @param {ArrayBuffer} buffer IFC file content; not detached (a copy goes to the worker)
 * @param {{parse?: boolean, geometrie?: {coordinateToOrigin?: boolean}|null}} was parse = semantics for IDS;
 *   geometrie = options for extractGeometry, null/absent = no geometry
 * @param {(text: string) => void} [onProgress] German progress text
 * @returns {Promise<{parsed: any, parseFehler: string|null, geo: {elemente: any[], uebersprungen: number}|null, imWorker: boolean}>}
 *   rejects with the geometry error (the semantics error only lands in parseFehler)
 */
export function ifcLesen(buffer, was, onProgress) {
  const fortschritt = typeof onProgress === "function" ? onProgress : () => {};
  if (typeof Worker === "undefined") return lesenHier(buffer, was, fortschritt);
  let worker;
  try {
    worker = new Worker(new URL("./ifcLesen.worker.js", import.meta.url), { type: "module" });
  } catch {
    return lesenHier(buffer, was, fortschritt);
  }
  const nonce = ++naechsteNonce;
  return new Promise((resolve, reject) => {
    let gemeldet = false;
    // The worker sends parsed.elements and geo.elemente in parts before the final message (one
    // short deserialisation task each instead of one long one, see ifcLesen.worker.js).
    /** @type {{elements: any[], elemente: any[]}} */
    const teile = { elements: [], elemente: [] };
    const ende = () => worker.terminate();
    worker.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.nonce !== nonce) return;
      gemeldet = true;
      if (typeof d.fortschritt === "string") { fortschritt(d.fortschritt); return; }
      if (d.teil) {
        const ziel = teile[d.teil.art];
        if (ziel) for (const x of d.teil.liste) ziel.push(x);
        return;
      }
      ende();
      if (d.fehler) { reject(new Error(d.fehler)); return; }
      const parsed = d.parsed ? { ...d.parsed, elements: teile.elements } : null;
      const geo = d.geo ? { ...d.geo, elemente: teile.elemente } : null;
      resolve({ parsed, parseFehler: d.parseFehler ?? null, geo, imWorker: true });
    };
    // A worker that dies before its first message could not load (module worker or WASM blocked):
    // read on the main thread instead. A failure after it started is a real reading error.
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      ende();
      if (!gemeldet) lesenHier(buffer, was, fortschritt).then(resolve, reject);
      else reject(new Error(ev.message || "Das IFC-Modell konnte im Hintergrund nicht gelesen werden."));
    };
    const kopie = buffer.slice(0);
    worker.postMessage({ nonce, buffer: kopie, parse: !!was.parse, geometrie: was.geometrie || null }, [kopie]);
  });
}
