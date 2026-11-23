// Phase 22 evidence (designer viewport & 3D walk), the part a node test can show: the shared Exposé helper
// `exportExposePng` (VP-05) of MassingView3D.jsx, used by the massing iso, the terrain view and the BIM studio.
// The 2D/3D switch, the WASD walk and the real PNG download need WebGL and live in tests/e2e/viewport-begehung-22.spec.js.
//
// The helper lives in a .jsx file that node cannot import (no JSX loader in tests/alias-hook.mjs), so its source is read
// from the file and run here against recording stand-ins for renderer, document and Image (same approach as
// planDrehung-11504.test.js for the arrow-key table). The function itself is plain JS — no JSX inside.
// In: the component file. Out: assertions on call order, pixel ratio (device px per CSS px), file name and footer canvas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const QUELLE = readFileSync(new URL("../../packages/nova-designer/src/components/MassingView3D.jsx", import.meta.url), "utf8");

/** Source text of `export function exportExposePng(...) {...}` up to the first closing brace at column 0. */
function funktionsText() {
  const start = QUELLE.indexOf("export function exportExposePng(");
  assert.ok(start >= 0, "exportExposePng nicht mehr in MassingView3D.jsx");
  const ende = QUELLE.indexOf("\n}\n", start);
  assert.ok(ende > start, "Ende von exportExposePng nicht gefunden");
  return QUELLE.slice(start, ende + 2).replace(/^export /, "");
}

/**
 * Builds the helper against fake globals.
 * @param {{bildFehler?: boolean}} [o] bildFehler: the footer image fails to load
 */
function aufbauen({ bildFehler = false } = {}) {
  /** @type {any[]} */
  const log = [];
  /** @type {any[]} */
  const geklickt = [];
  /** @type {any[]} */
  const leinwaende = [];
  const document = {
    body: { appendChild: (/** @type {any} */ a) => log.push(["anhaengen", a.download]) },
    createElement: (/** @type {string} */ tag) => {
      if (tag === "a") {
        const a = { href: "", download: "", click() { geklickt.push({ href: a.href, download: a.download }); }, remove() { log.push(["entfernen"]); } };
        return a;
      }
      // canvas for the footer
      /** @type {any[]} */
      const zuege = [];
      const c = {
        width: 0, height: 0, zuege,
        getContext: () => ({
          set fillStyle(v) { zuege.push(["fillStyle", v]); },
          set font(v) { zuege.push(["font", v]); },
          set textBaseline(v) { zuege.push(["textBaseline", v]); },
          fillRect: (...a) => zuege.push(["fillRect", ...a]),
          drawImage: (_b, ...a) => zuege.push(["drawImage", ...a]),
          fillText: (...a) => zuege.push(["fillText", ...a]),
        }),
        toDataURL: () => "data:image/png;base64,MIT-FUSSZEILE",
      };
      leinwaende.push(c);
      return c;
    },
  };
  class Image {
    constructor() { this.width = 1600; this.height = 1000; /** @type {any} */ this.onload = null; /** @type {any} */ this.onerror = null; }
    set src(v) { this._src = v; Promise.resolve().then(() => (bildFehler ? this.onerror?.() : this.onload?.())); }
  }
  const konsole = { error: (/** @type {any[]} */ ...a) => log.push(["console.error", String(a[0])]) };
  const fn = new Function("document", "Image", "console", `${funktionsText()}\nreturn exportExposePng;`)(document, Image, konsole);
  let ratio = 1;
  const renderer = {
    getPixelRatio: () => ratio,
    setPixelRatio: (/** @type {number} */ r) => { ratio = r; log.push(["ratio", r]); },
    render: () => log.push(["render", ratio]),
    domElement: { toDataURL: (/** @type {string} */ typ) => { log.push(["toDataURL", typ, ratio]); return "data:image/png;base64,ROH"; } },
  };
  return { fn, log, geklickt, leinwaende, renderer, scene: {}, camera: {}, ratio: () => ratio };
}

/** Today as JJJJMMTT (local time, the helper's own rule). */
const heute = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

describe("22 Exposé-Bild (exportExposePng, VP-05)", () => {
  it("renders once at pixel ratio 2, reads the PNG right after that render, restores the ratio and renders again; file Expose_<JJJJMMTT>.png", () => {
    const t = aufbauen();
    const rahmen = { renderer: t.renderer, scene: t.scene, camera: t.camera };
    t.renderer.setPixelRatio(1.5); t.log.length = 0; // a HiDPI screen
    t.fn(rahmen);
    assert.deepEqual(t.log.slice(0, 5), [["ratio", 2], ["render", 2], ["toDataURL", "image/png", 2], ["ratio", 1.5], ["render", 1.5]]);
    assert.equal(t.ratio(), 1.5, "Pixel-Ratio nach dem Export zurückgesetzt");
    assert.deepEqual(t.geklickt, [{ href: "data:image/png;base64,ROH", download: `Expose_${heute()}.png` }]);
    assert.deepEqual(t.log.slice(-1), [["entfernen"]], "der Download-Link bleibt nicht im DOM");
  });

  it("missing renderer, scene or camera (view not built yet) → nothing happens, no throw", () => {
    const t = aufbauen();
    t.fn(null);
    t.fn({ renderer: t.renderer, scene: t.scene });
    t.fn({ scene: t.scene, camera: t.camera });
    assert.deepEqual(t.log, []);
    assert.deepEqual(t.geklickt, []);
  });

  it("a failing read (lost context) restores the ratio, logs, and downloads nothing", () => {
    const t = aufbauen();
    t.renderer.domElement.toDataURL = () => { throw new Error("context lost"); };
    t.fn({ renderer: t.renderer, scene: t.scene, camera: t.camera });
    assert.equal(t.ratio(), 1);
    assert.ok(t.log.some((e) => e[0] === "console.error"));
    assert.deepEqual(t.geklickt, []);
  });

  it("footer lines (terrain view, B-103-04) are burnt into a white strip below the image; empty lines are dropped", async () => {
    const t = aufbauen();
    t.fn({ renderer: t.renderer, scene: t.scene, camera: t.camera }, { fusszeile: ["Zeile A", "", "Zeile B"] });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(t.leinwaende.length, 1);
    const c = t.leinwaende[0];
    // line height = max(18, round(1600 / 70)) = 23 px; height = 1000 + 2 · 23 + round(23 · 0.8) = 1000 + 46 + 18 = 1064 px
    assert.equal(c.width, 1600);
    assert.equal(c.height, 1064);
    assert.deepEqual(c.zuege.slice(0, 3), [["fillStyle", "#ffffff"], ["fillRect", 0, 0, 1600, 1064], ["drawImage", 0, 0]]);
    assert.deepEqual(c.zuege.filter((z) => z[0] === "fillText").map((z) => z[1]), ["Zeile A", "Zeile B"]);
    assert.deepEqual(t.geklickt, [{ href: "data:image/png;base64,MIT-FUSSZEILE", download: `Expose_${heute()}.png` }]);
  });

  it("footer image that fails to load still downloads the plain render", async () => {
    const t = aufbauen({ bildFehler: true });
    t.fn({ renderer: t.renderer, scene: t.scene, camera: t.camera }, { fusszeile: ["Zeile A"] });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(t.geklickt.map((g) => g.href), ["data:image/png;base64,ROH"]);
  });
});
