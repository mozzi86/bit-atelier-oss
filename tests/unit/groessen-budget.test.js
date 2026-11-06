// Unit tests for plan 93-09: the size budget of the client build (scripts/groessen-budget.mjs) — chunk name
// normalisation, the static closure of a manifest entry, the "sum before a route", the comparison against
// the limits (over / ok / missing chunk / chunk_max for unnamed chunks), the buffer rounding, and that the
// committed budget.json has every limit the gate expects. Synthetic manifest — no build needed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BENANNTE_ASSETS, BENANNTE_CHUNKS, chunkName, gesamtOhneEigeneAssets, grenzeAus, grenzenAus, messwerteAus, pruefeBudget, statischeHuelle,
} from "../../scripts/groessen-budget.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/** A small build: entry → vendor, two lazy pages (one pulls three), a named chunk, a worker. */
const MANIFEST = {
  "index.html": { file: "assets/index-AAAAAAAA.js", src: "index.html", isEntry: true, imports: ["_vendor-BBBBBBBB.js"], css: ["assets/index-CCCCCCCC.css"], dynamicImports: ["src/pages/A.jsx", "src/pages/B.jsx"] },
  "_vendor-BBBBBBBB.js": { file: "assets/vendor-BBBBBBBB.js", name: "vendor" },
  "_three-DDDDDDDD.js": { file: "assets/three-DDDDDDDD.js", name: "three" },
  "src/pages/A.jsx": { file: "assets/A-EEEEEEEE.js", src: "src/pages/A.jsx", isDynamicEntry: true, imports: ["_vendor-BBBBBBBB.js"] },
  "src/pages/B.jsx": { file: "assets/B-FFFFFFFF.js", src: "src/pages/B.jsx", isDynamicEntry: true, imports: ["_vendor-BBBBBBBB.js", "_three-DDDDDDDD.js"], css: ["assets/B-GGGGGGGG.css"] },
  "src/lib/werkzeug.js": { file: "assets/werkzeug-HHHHHHHH.js", src: "src/lib/werkzeug.js", isDynamicEntry: true },
};
const MESSUNG = {
  zeilen: [
    { rel: "assets/index-AAAAAAAA.js", roh: 0, gz: 100 },
    { rel: "assets/vendor-BBBBBBBB.js", roh: 0, gz: 50 },
    { rel: "assets/index-CCCCCCCC.css", roh: 0, gz: 10 },
    { rel: "assets/three-DDDDDDDD.js", roh: 0, gz: 300 },
    { rel: "assets/A-EEEEEEEE.js", roh: 0, gz: 20 },
    { rel: "assets/B-FFFFFFFF.js", roh: 0, gz: 40 },
    { rel: "assets/B-GGGGGGGG.css", roh: 0, gz: 5 },
    { rel: "assets/werkzeug-HHHHHHHH.js", roh: 0, gz: 70 },
    { rel: "assets/logo.png", roh: 900, gz: null },
  ],
  gesamtGz: 1495,
  erstePaintGz: 160,
};

describe("groessen-budget — Messwerte", () => {
  it("chunkName entfernt Ordner, Endung und Vite-Hash", () => {
    assert.equal(chunkName("assets/vendor-BkUj3_4a.js"), "vendor");
    assert.equal(chunkName("assets/foo-bar-12345678.css"), "foo-bar");
    assert.equal(chunkName("assets/pdf.worker.min-Ab-d_123.mjs"), "pdf.worker.min");
    assert.equal(chunkName("index.html"), "index");
  });

  it("statischeHuelle folgt statischen Importen samt CSS, nicht dynamischen", () => {
    assert.deepEqual([...statischeHuelle(MANIFEST, "index.html")].sort(), ["assets/index-AAAAAAAA.js", "assets/index-CCCCCCCC.css", "assets/vendor-BBBBBBBB.js"]);
    assert.deepEqual([...statischeHuelle(MANIFEST, "src/pages/B.jsx")].sort(), ["assets/B-FFFFFFFF.js", "assets/B-GGGGGGGG.css", "assets/three-DDDDDDDD.js", "assets/vendor-BBBBBBBB.js"]);
  });

  it("Summe vor der Route = Einstieg ∪ Route (geteilte Dateien einmal), nur Seiten unter pages/", () => {
    const w = messwerteAus(MESSUNG, MANIFEST);
    assert.equal(w.entry, 100);
    assert.equal(w.css, 10);
    assert.equal(w.vendor, 50);
    assert.equal(w.erste_runde, 160);
    // A: index 100 + css 10 + vendor 50 + A 20 = 180; B: 160 + B 40 + css 5 + three 300 = 505.
    assert.deepEqual(w.routen, { "src/pages/A.jsx": 180, "src/pages/B.jsx": 505 });
    assert.equal(w.route_max, 505);
    assert.equal(w.route_max_name, "src/pages/B.jsx");
    assert.deepEqual(w.chunks, { index: 100, vendor: 50, three: 300, A: 20, B: 40, werkzeug: 70 });
    assert.equal(w.gesamt, 1495);
  });

  it("ohne Einstiegspunkt ein klarer Fehler", () => {
    assert.throws(() => messwerteAus(MESSUNG, { "x.js": { file: "x.js" } }), /Kein Einstiegspunkt/);
  });
});

describe("groessen-budget — Vergleich", () => {
  const werte = messwerteAus(MESSUNG, MANIFEST);

  it("alles im Budget: keine Überschreitung, Grenze = Wert ist noch ok", () => {
    const { ueber, vergleiche } = pruefeBudget(werte, { entry: 100, css: 10, vendor: 50, erste_runde: 200, route_max: 600, gesamt: 2000, chunks: { three: 300 }, chunk_max: 100 });
    assert.deepEqual(ueber, []);
    assert.ok(vergleiche.every((v) => v.status === "ok"));
  });

  it("über dem Budget: Einstieg, benannter Chunk, Route und unbenannter Chunk über chunk_max", () => {
    const { ueber } = pruefeBudget(werte, { entry: 99, route_max: 504, chunks: { three: 299 }, chunk_max: 60 });
    assert.deepEqual(ueber.map((v) => v.schluessel).sort(), ["chunk:index", "chunk:werkzeug", "chunk_max", "chunks.three", "entry", "route_max"].sort());
    const entry = ueber.find((v) => v.schluessel === "entry");
    assert.deepEqual(entry, { schluessel: "entry", wert: 100, grenze: 99, status: "ueber" });
  });

  it("entfallener benannter Chunk: gemeldet als fehlt, aber kein Fehlschlag", () => {
    const { ueber, vergleiche } = pruefeBudget(werte, { chunks: { charts: 1000 } });
    assert.deepEqual(ueber, []);
    assert.deepEqual(vergleiche, [{ schluessel: "chunks.charts", wert: null, grenze: 1000, status: "fehlt" }]);
  });

  it("vendor zählt nicht gegen chunk_max (hat eine eigene Grenze)", () => {
    const { ueber } = pruefeBudget({ ...werte, chunks: { vendor: 999 } }, { chunk_max: 10 });
    assert.deepEqual(ueber, []);
  });
});

describe("groessen-budget — Grenzen schreiben", () => {
  it("Puffer in Prozent, auf volle KB aufgerundet", () => {
    assert.equal(grenzeAus(1000, 10), 2048, "1100 B → 2 KB");
    assert.equal(grenzeAus(10240, 0), 10240);
    assert.equal(grenzeAus(10240, 10), 11264, "11264 B = genau 11 KB");
    assert.equal(grenzeAus(10241, 10), 12288, "11265 B → 12 KB");
    assert.equal(grenzeAus(0, 10), 0);
  });

  it("grenzenAus: benannte Chunks eigene Grenze, übrige über chunk_max", () => {
    const g = grenzenAus(messwerteAus(MESSUNG, MANIFEST), 10, BENANNTE_CHUNKS);
    assert.deepEqual(g.chunks, { three: 1024 });
    assert.equal(g.chunk_max, 1024, "größter übriger Chunk index 100 B → 1 KB");
    assert.deepEqual(pruefeBudget(messwerteAus(MESSUNG, MANIFEST), g).ueber, []);
  });

  it("budget.json im Repo hat alle Grenzen, die die Prüfung erwartet", () => {
    const b = JSON.parse(fs.readFileSync(path.join(WURZEL, "budget.json"), "utf8"));
    assert.equal(b.einheit, "Byte (gzip)");
    for (const k of ["entry", "css", "vendor", "erste_runde", "route_max", "chunk_max", "gesamt"]) {
      assert.ok(Number.isInteger(b.grenzen[k]) && b.grenzen[k] > 0, `Grenze ${k} fehlt`);
      assert.equal(b.grenzen[k] % 1024, 0, `Grenze ${k} nicht auf volle KB`);
    }
    for (const n of ["three", "charts", "map", "ifc"]) assert.ok(b.grenzen.chunks[n] > 0, `Chunk-Grenze ${n} fehlt`);
  });
});

describe("groessen-budget — WebAssembly-Assets (107-18)", () => {
  // the same small build plus the binary of the CSG library: raw bytes (binaries are not gzipped by groessen.mjs)
  const MIT_WASM = { ...MESSUNG, zeilen: [...MESSUNG.zeilen, { rel: "assets/manifold-BE4c7gO-.wasm", roh: 541470, gz: null }], gesamtGz: MESSUNG.gesamtGz + 541470 };

  it("eine WASM-Datei wird unter assets.<Name> gemessen, nicht als Chunk", () => {
    const w = messwerteAus(MIT_WASM, MANIFEST);
    assert.deepEqual(w.assets, { manifold: 541470 });
    assert.equal(w.chunks.manifold, undefined);
  });

  it("eigene Grenze: geprüft auf eigener Zeile, nicht zusätzlich in gesamt; ohne eigene Grenze zählt sie in gesamt", () => {
    const w = messwerteAus(MIT_WASM, MANIFEST);
    const ohne = pruefeBudget(w, { gesamt: 1495 });
    assert.equal(ohne.ueber.map((v) => v.schluessel).join(), "gesamt", "the binary counts in the total without a limit of its own");
    const mit = pruefeBudget(w, { gesamt: 1495, assets: { manifold: 595968 } });
    assert.deepEqual(mit.ueber, []);
    assert.equal(mit.vergleiche.find((v) => v.schluessel === "gesamt")?.wert, 1495, "541 470 B moved to their own line");
    assert.equal(mit.vergleiche.find((v) => v.schluessel === "assets.manifold")?.status, "ok");
    assert.equal(pruefeBudget(w, { assets: { manifold: 500000 } }).ueber[0].schluessel, "assets.manifold");
    assert.equal(gesamtOhneEigeneAssets(w, {}), w.gesamt);
  });

  it("fehlende WASM-Datei mit Grenze: gemeldet als fehlt, kein Fehlschlag (wie ein benannter Chunk)", () => {
    const r = pruefeBudget(messwerteAus(MESSUNG, MANIFEST), { assets: { manifold: 595968 } });
    assert.equal(r.vergleiche[0].status, "fehlt");
    assert.deepEqual(r.ueber, []);
  });

  it("grenzenAus: benannte Assets eigene Grenze (+ Puffer), gesamt ohne sie", () => {
    const g = grenzenAus(messwerteAus(MIT_WASM, MANIFEST), 10, BENANNTE_CHUNKS, BENANNTE_ASSETS);
    assert.deepEqual(g.assets, { manifold: 595968 }); // 541 470 · 1.1 = 595 617 → 582 KB
    assert.equal(g.gesamt, 2048, "1 495 B · 1.1 → 2 KB, without the binary");
  });

  it("budget.json im Repo hat die Grenze der WASM-Datei des CSG-Kerns", () => {
    const b = JSON.parse(fs.readFileSync(path.join(WURZEL, "budget.json"), "utf8"));
    for (const n of BENANNTE_ASSETS) assert.ok(Number.isInteger(b.grenzen.assets?.[n]) && b.grenzen.assets[n] % 1024 === 0, `Asset-Grenze ${n} fehlt`);
  });
});
