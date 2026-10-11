// 86-05b: Web Worker around the proposal library — the full enumeration takes up to ~2 s
// cold on an irregular footprint (86-05a measurement: pentagon 2 072 ms), too long for the
// main thread. The worker imports the pure lib (no React, no DOM) and answers one message
// with the CARD data of every proposal (kartenDaten — small enough to clone).
//
// In:  { nonce, footprintM (m), basis (workshop base inputs), max }                 — enumeration
//      { nonce, art: "nachbarn", footprintM, basis, vorschlag, vorhanden, max }      — 86-05c "ähnliche erzeugen"
// Out: { nonce, liste: kartenDaten[], dauer_ms } or { nonce, fehler: string }
// The nonce lets the caller drop answers of superseded requests. Loaded by
// @designer/lib/useVorschlaege.js via `new Worker(new URL(…, import.meta.url), { type: "module" })`.
/* global self */
import { erzeugeVorschlaege, nachbarn, kartenDaten } from "./bebauungsvorschlaege.js";

self.onmessage = (ev) => {
  const d = ev && ev.data && typeof ev.data === "object" ? ev.data : {};
  const nonce = d.nonce;
  try {
    const t0 = performance.now();
    const roh = d.art === "nachbarn"
      ? nachbarn(d.vorschlag, d.footprintM, d.basis, { vorhanden: d.vorhanden, max: d.max })
      : erzeugeVorschlaege(d.footprintM, d.basis, { max: d.max });
    self.postMessage({ nonce, liste: roh.map(kartenDaten), dauer_ms: Math.round(performance.now() - t0) });
  } catch (e) {
    self.postMessage({ nonce, fehler: e instanceof Error ? e.message : String(e) });
  }
};
