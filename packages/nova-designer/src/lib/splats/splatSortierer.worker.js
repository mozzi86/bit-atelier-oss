// Web worker of the splat renderer (phase 104-16): keeps the splat centres and answers each view matrix with the
// back-to-front order, so the sort of millions of splats never blocks drawing.
//
// In:  {art: "daten", position: Float32Array, anzahl}  once; {art: "sortiere", mv: number[16], nr} per view.
// Out: {art: "ordnung", ordnung: Uint32Array, nr} (buffer transferred).
/* global self */
import { tiefenOrdnung } from "./splatMathe.js";

let position = new Float32Array(0);
let anzahl = 0;

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const d = e.data;
  if (d.art === "daten") { position = d.position; anzahl = d.anzahl; return; }
  if (d.art === "sortiere") {
    const ordnung = tiefenOrdnung(position, anzahl, d.mv);
    /** @type {any} */ (self).postMessage({ art: "ordnung", ordnung, nr: d.nr }, [ordnung.buffer]);
  }
};
