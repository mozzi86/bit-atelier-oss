// 107-14 review fixes — slab in a local frame, German warning codes, layered wall as input of a further boolean, union of
// overlapping openings, world cut helpers, CSG_VERSION guard, cache capacity, cache write flow, size gate of chunk csg,
// conflict label of csg_cache_layer. Every expected value is calculated by hand (comment next to it).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import {
  istWasserdicht, volumenJeGruppe, volumen_m3, analytischWand, rechteckVereinigung_m2, csgLaden, csgWarnungText, wandSolid,
  platteSolid, basisHash, CSG_VERSION, geometrieJeGruppe, geometrienZusammenfuegen, quaderKoerper, horizontalschnittWelt,
  vertikalschnittWelt, weltNachLokal, meshKodieren, cacheSchreiben, CSG_CACHE_LEER, cacheBlobsLoeschen, cacheEintragNeu,
  cacheLayerBereinigen,
} from "@core/lib/csg/index.js";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";
import { DB_MAX_BYTES, bytesVon } from "@core/lib/speicherOrt.js";
import { LAYER_VERSION } from "@core/lib/fachlayerSchema.js";
import { FELD_NAMEN } from "@core/lib/abgleich/modellAbgleich.js";
import { csgChunkPruefen } from "../../scripts/csg-chunk-budget.mjs";

const nah = (/** @type {number} */ ist, /** @type {number} */ soll, eps = 1e-6, text = "") =>
  assert.ok(Math.abs(ist - soll) <= eps, `${text} ist ${ist}, soll ${soll} (±${eps})`);
const kern = await csgLaden();
const DREI = { aufbauten: { "p-r3": { name: "Test drei Schichten", skins: [
  { name: "A", material: "beton", thickness: 115 }, { name: "B", material: "mw035", thickness: 160 }, { name: "C", material: "gipsputz", thickness: 25 },
] } } };

describe("107-14 Review — Decke in lokalen Koordinaten", () => {
  for (const X of [0, 1000, 3000]) {
    it(`Platte 6 × 5 × 0,25 m mit Loch 0,4 × 0,4 m bei x = ${X} m: 7,46 m³, wasserdicht, Platzierung = Mitte der Hüllbox`, async () => {
      const ring = [{ x: X, z: 0 }, { x: X + 6, z: 0 }, { x: X + 6, z: 5 }, { x: X, z: 5 }];
      const loch = [{ x: X + 2.8, z: 2.3 }, { x: X + 3.2, z: 2.3 }, { x: X + 3.2, z: 2.7 }, { x: X + 2.8, z: 2.7 }];
      const r = await platteSolid(ring, 0.25, [loch], { kern, y0_m: 3 });
      assert.equal(r.ok, true, JSON.stringify(r.warnung));
      // 6 · 5 · 0.25 − 0.4 · 0.4 · 0.25 = 7.5 − 0.04; local Float32 noise stays far below 1e-6 m³ (world frame at 1 000 m: 2e-6)
      nah(r.volumen.solid_m3 ?? NaN, 7.46, 1e-6);
      assert.deepEqual(r.platzierung, { ursprung: { x: X + 3, y: 3, z: 2.5 }, drehung_y: 0 });
      assert.ok(istWasserdicht(/** @type {any} */ (r.geometrie)).ok);
      const box = new THREE.Box3().setFromBufferAttribute(/** @type {any} */ (r.geometrie).getAttribute("position"));
      nah(box.min.x, -3, 1e-6); nah(box.max.x, 3, 1e-6); nah(box.min.y, 0, 1e-6); nah(box.max.y, 0.25, 1e-6);
    });
  }
  it("Material-Index gehört zur Hash-Basis", async () => {
    const ring = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
    const a = await platteSolid(ring, 0.2, [], { kern, materialIndex: 0 });
    const b = await platteSolid(ring, 0.2, [], { kern, materialIndex: 1 });
    assert.notEqual(basisHash(a.basis), basisHash(b.basis));
  });
});

describe("107-14 Review — Warnung ohne englischen Text", () => {
  it("Wand ohne Länge / Decke ohne Dicke → csg-ungueltig mit deutschem i18n-Text", async () => {
    const w = await wandSolid({ a: { x: 1, z: 1 }, b: { x: 1, z: 1 }, thickness: 0.3, height: 2.5, level: 0 }, [], { kern });
    assert.deepEqual([w.warnung?.code, w.warnung?.art], ["csg-ungueltig", "wand"]);
    assert.equal(csgWarnungText(w.warnung), "3D-Körper nicht berechnet: Wand ohne Länge, Höhe oder Dicke — Menge aus der Handrechnung (Fläche × Dicke)");
    const p = await platteSolid([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }], 0, [], { kern });
    assert.deepEqual([p.warnung?.code, p.warnung?.art], ["csg-ungueltig", "platte"]);
    assert.match(csgWarnungText(p.warnung), /Decke ohne Fläche oder Dicke/);
    for (const t of [csgWarnungText(w.warnung), csgWarnungText(p.warnung)]) assert.doesNotMatch(t, /without|slab|wall/);
    // the EN translation exists (i18n part of this plan)
    const quelle = fs.readFileSync("packages/nova-core/src/lib/i18nTeile/bauteilkern-107.js", "utf8");
    assert.ok(quelle.includes("3D solid not computed: wall without length, height or thickness"));
    assert.ok(quelle.includes("3D solid not computed: slab without area or thickness"));
  });
  it("Prozentzahl im Zahlenformat der Oberfläche", () => {
    const w = { code: /** @type {const} */ ("csg-abweichung"), abweichung_rel: 0.005 };
    assert.match(csgWarnungText(w), /um 0,5 %/);
    assert.match(csgWarnungText(w, (t) => t, "en"), /um 0\.5 %/);
  });
});

describe("107-14 Review — mehrschichtige Wand als Eingabe einer weiteren Booleschen", () => {
  after(() => setzeProjektAufbauten(null));
  it("Gesamtkörper ist nicht geschlossen; je Schicht getrennt geschlossen und weiter schneidbar", async () => {
    setzeProjektAufbauten(DREI);
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-r3", height: 2.5, level: 0 };
    const r = await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern });
    assert.equal(r.ok, true);
    // documented: the glued body has the inner faces twice → not one closed body, a boolean on it is refused
    assert.equal(istWasserdicht(/** @type {any} */ (r.geometrie)).ok, false);
    assert.equal(kern.boolesch(/** @type {any} */ (r.geometrie), quaderKoerper({ x0_m: 0.5, x1_m: 1, y0_m: 0.5, y1_m: 1, z0_m: -1, z1_m: 1 }), "subtract").ok, false);
    const teile = geometrieJeGruppe(/** @type {any} */ (r.geometrie));
    assert.deepEqual([...teile.keys()], [0, 1, 2]);
    // 8.8 m² net · 0.115 / 0.16 / 0.025
    const soll = { 0: 1.012, 1: 1.408, 2: 0.22 };
    /** @type {THREE.BufferGeometry[]} */
    const geschnitten = [];
    for (const [mi, g] of teile) {
      assert.ok(istWasserdicht(g).ok, `Schicht ${mi} geschlossen`);
      nah(volumen_m3(g), soll[/** @type {0|1|2} */ (mi)], 1e-5);
      // a slot 0.5 × 0.5 m through the whole wall (z −1…1) at x 0.5…1.0, y 0.5…1.0: per layer 0.25 m² · thickness
      const s = kern.boolesch(g, quaderKoerper({ x0_m: 0.5, x1_m: 1, y0_m: 0.5, y1_m: 1, z0_m: -1, z1_m: 1, materialIndex: mi }), "subtract");
      assert.ok(s.ok, `Schicht ${mi} schneidbar`);
      geschnitten.push(/** @type {any} */ (s).geometrie);
    }
    const neu = volumenJeGruppe(geometrienZusammenfuegen(geschnitten));
    // (8.8 − 0.25) m² = 8.55 m² · 0.115 / 0.16 / 0.025
    nah(neu[0], 0.98325, 1e-5); nah(neu[1], 1.368, 1e-5); nah(neu[2], 0.21375, 1e-5);
  });
});

describe("107-14 Review — überlappende Öffnungen", () => {
  it("Vereinigung der Lochrechtecke: Überlappung nur einmal abgezogen; Solid und Handrechnung stimmen überein", async () => {
    nah(rechteckVereinigung_m2([{ x0: 1, x1: 2, y0: 0.9, y1: 2.1 }, { x0: 1.5, x1: 2.5, y0: 0.9, y1: 2.1 }]), 1.8, 1e-12); // 1.5 · 1.2
    nah(rechteckVereinigung_m2([{ x0: 0, x1: 2, y0: 0, y1: 2 }, { x0: 1, x1: 3, y0: 1, y1: 3 }]), 7, 1e-12); // 4 + 4 − 1
    nah(rechteckVereinigung_m2([{ x0: 0, x1: 1, y0: 0, y1: 1 }, { x0: 2, x1: 3, y0: 0, y1: 1 }]), 2, 1e-12); // apart
    const oeffnungen = [{ u: 1.5, width: 1.0, height: 1.2, sill: 0.9 }, { u: 2.0, width: 1.0, height: 1.2, sill: 0.9 }];
    // wall 4 × 2.5 × 0.3: (10 − 1.8) · 0.3 = 2.46 m³ (twice subtracted it would be 2.28)
    nah(analytischWand({ laenge_m: 4, hoehe_m: 2.5, schichten_m: [0.3], oeffnungen }).gesamt_m3, 2.46, 1e-12);
    const r = await wandSolid({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 }, oeffnungen, { kern });
    assert.equal(r.ok, true, JSON.stringify(r.warnung));
    nah(r.menge_m3, 2.46, 1e-5);
  });
});

describe("107-14 Review — Schnitte in Weltkoordinaten", () => {
  it("Wand entlang z: Grundriss in Welthöhe, Schnittlinie in Weltkoordinaten", async () => {
    const wand = { a: { x: 10, z: 0 }, b: { x: 10, z: 4 }, thickness: 0.3, height: 2.5, level: 0 };
    const r = await wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }], { kern });
    assert.equal(r.ok, true);
    const geo = /** @type {any} */ (r.geometrie);
    // floor plan at 1.0 m above the wall bottom: (4 − 1.0) · 0.3 = 0.9 m² in two loops
    const h = horizontalschnittWelt(geo, r.platzierung, r.platzierung.ursprung.y + 1.0);
    assert.equal(h.schleifen.length, 2);
    nah(h.flaeche_m2, 0.9, 1e-5);
    // section across the wall at world z = 2 (opening middle): sill 0.9 · 0.3 = 0.27, lintel (2.5 − 2.1) · 0.3 = 0.12
    const v = vertikalschnittWelt(geo, r.platzierung, { a: { x: 9, z: 2 }, b: { x: 11, z: 2 } });
    assert.deepEqual(v.schleifen.map((s) => Math.round(s.flaeche_m2 * 1e4) / 1e4).sort(), [0.12, 0.27]);
    // the world start point a lies at local x = 0 (wall start), local z = layer centre ± versatz
    const a = weltNachLokal({ x: 10, y: r.platzierung.ursprung.y, z: 0 }, r.platzierung);
    nah(a.x, 0, 1e-9); nah(a.y, 0, 1e-9);
  });
});

describe("107-14 Review — CSG_VERSION gegen package.json und Lockfile (Wächter)", () => {
  it("die Bibliotheksversionen in CSG_VERSION sind die installierten", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    for (const name of ["manifold-3d"]) { // 107-18 (D-BK-08c): the backend library
      const angabe = pkg.devDependencies?.[name] ?? pkg.dependencies?.[name];
      const installiert = lock.packages?.[`node_modules/${name}`]?.version;
      assert.equal(angabe, installiert, `${name}: package.json exakt gepinnt = Lockfile`);
      assert.ok(CSG_VERSION.includes(`${name}@${installiert}`), `CSG_VERSION nennt ${name}@${installiert} nicht — CSG_VERSION anheben (alle Cache-Einträge verfallen)`);
    }
  });
});

describe("107-14 Review — Kapazität des Inline-Caches (Messung für 107-09)", () => {
  after(() => setzeProjektAufbauten(null));
  it("40 dreischichtige Wände mit drei Öffnungen: nur die jüngsten passen in die 256 KB des Layers", async () => {
    setzeProjektAufbauten(DREI);
    const wand = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, composite: "p-r3", height: 2.5, level: 0 };
    const r = await wandSolid(wand, [1, 3, 5].map((u) => ({ u, width: 1.0, height: 1.2, sill: 0.9 })), { kern });
    assert.equal(r.ok, true);
    const inhalt = meshKodieren(/** @type {any} */ (r.geometrie));
    const b = bytesVon(inhalt);
    let layer = CSG_CACHE_LEER;
    for (let i = 0; i < 40; i += 1) {
      const erzeugt = new Date(Date.UTC(2026, 9, 26, 10, 0, i)).toISOString();
      layer = cacheSchreiben(layer, `w${i}|wand`, { pruefsumme: `h${i}`, ort: "datenbank", objekt_id: null, inhalt, groesse_bytes: b, dreiecke: inhalt.dreiecke, volumen_m3: null, quelle: "solid", warnung: null, erzeugt }).layer;
    }
    const bleiben = Object.keys(layer.eintraege);
    const erwartet = Math.floor((DB_MAX_BYTES - 1) / b); // eviction until the inline sum is below the limit
    assert.equal(bleiben.length, erwartet);
    assert.ok(bleiben.includes("w39|wand") && !bleiben.includes("w0|wand"), "the oldest are evicted");
    // 107-18: manifold-3d results have no T-junctions — 216 instead of 514 triangles, ~10.3 KB, 24 of 40 walls (was 10)
    // pinned to the measurement with a small margin, so a change of the triangle count of a layered wall shows here
    assert.equal(inhalt.dreiecke, 216, "triangles of the measured wall");
    assert.ok(erwartet >= 22 && erwartet <= 26, `known limit (cache.js head, [ASSUMED]): about 10 KB per layered wall, ${erwartet} of 40 walls fit (measured 24)`);
    console.log(`[107-18 Messung] Wand 6 m, 3 Schichten, 3 Öffnungen: ${inhalt.dreiecke} Dreiecke, ${b} B je Eintrag; ${erwartet} von 40 Wänden im Cache (Trefferquote ${Math.round((erwartet / 40) * 100)} %)`);
  });
});

describe("107-14 Review — Schreibablauf des Caches (useCsgCache ohne React)", () => {
  /** a fake object store that logs deletes */
  function fakeApi({ loeschenScheitert = false } = {}) {
    /** @type {Map<string, any>} */
    const speicher = new Map();
    /** @type {string[]} */
    const geloescht = [];
    return {
      speicher, geloescht,
      blobs: {
        put: async (/** @type {string} */ id, /** @type {any} */ j) => { speicher.set(id, j); },
        get: async (/** @type {string} */ id) => speicher.get(id),
        delete: async (/** @type {string} */ id) => { if (loeschenScheitert) throw new Error("offline"); geloescht.push(id); speicher.delete(id); },
      },
    };
  }
  /** a layer holder like useFachlayer */
  function halter(api, aktiv = () => true) {
    const z = { layer: /** @type {any} */ (CSG_CACHE_LEER), gesetzt: 0, api, aktiv, holen: () => z.layer, setzen: (/** @type {any} */ l) => { z.layer = l; z.gesetzt += 1; } };
    return z;
  }
  // ~10 800 triangles → ≈ 480 KB base64 → object store
  const fein = () => new THREE.BoxGeometry(4, 2.5, 0.3, 60, 40, 3);

  it("Blob wird vor dem Layer abgelegt; neuer Blob für denselben Schlüssel löscht den alten", async () => {
    const api = fakeApi();
    const z = halter(api);
    assert.equal(await cacheEintragNeu(z, "w1|wand", "h1", fein()), true);
    const alt = z.layer.eintraege["w1|wand"].objekt_id;
    assert.ok(api.speicher.has(alt));
    assert.equal(await cacheEintragNeu(z, "w1|wand", "h2", fein()), true);
    assert.deepEqual(api.geloescht, [alt]);
    assert.equal(z.layer.eintraege["w1|wand"].pruefsumme, "h2");
    assert.equal(api.speicher.size, 1);
  });
  it("Ergebnis nach Projektwechsel, Unmount oder während des Ladens: nicht geschrieben, eigener Blob gelöscht", async () => {
    const api = fakeApi();
    const z = halter(api, () => false);
    assert.equal(await cacheEintragNeu(z, "w1|wand", "h1", fein()), false);
    assert.equal(z.gesetzt, 0);
    assert.equal(api.speicher.size, 0, "kein verwaister Blob");
    assert.equal(api.geloescht.length, 1);
    // inline (small) result: nothing to delete, nothing written
    assert.equal(await cacheEintragNeu(z, "w2|wand", "h1", new THREE.BoxGeometry(1, 1, 1)), false);
    assert.equal(api.geloescht.length, 1);
  });
  it("Bereinigen entfernt veraltete Einträge und löscht ihre Blobs; inaktiv nichts", async () => {
    const api = fakeApi();
    const z = halter(api);
    await cacheEintragNeu(z, "w1|wand", "h1", fein());
    await cacheEintragNeu(z, "w2|wand", "h1", new THREE.BoxGeometry(1, 1, 1));
    const blob = z.layer.eintraege["w1|wand"].objekt_id;
    let aktiv = false;
    z.aktiv = () => aktiv;
    assert.equal(await cacheLayerBereinigen(z, new Map([["w2|wand", "h1"]])), 0);
    aktiv = true;
    // w1 has a new hash today, w2 is unchanged
    assert.equal(await cacheLayerBereinigen(z, new Map([["w1|wand", "h9"], ["w2|wand", "h1"]])), 1);
    assert.deepEqual(Object.keys(z.layer.eintraege), ["w2|wand"]);
    assert.deepEqual(api.geloescht, [blob]);
  });
  it("cacheBlobsLoeschen: Fehler nur gemeldet (englisch), Einträge ohne Blob übersprungen", async () => {
    const api = fakeApi({ loeschenScheitert: true });
    const warn = console.warn;
    /** @type {string[]} */
    const meldungen = [];
    console.warn = (/** @type {any} */ m) => { meldungen.push(String(m)); };
    try {
      assert.equal(await cacheBlobsLoeschen([{ schluessel: "a", objekt_id: "csg-1" }, { schluessel: "b", objekt_id: null }], api), 0);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(meldungen, ["[csg-cache] blob csg-1 could not be deleted (offline)"]);
    assert.equal(await cacheBlobsLoeschen([{ schluessel: "b", objekt_id: null }], api), 0);
  });
});

describe("107-14 Review — Größenprüfung csg-Chunk und Konfliktname des Layers", () => {
  it("csgChunkPruefen: ok, über, fehlt, ohne Grenze", () => {
    const d = [{ rel: "assets/csg-B-Cy6V4z.js", roh: 105385, gz: 32468 }, { rel: "assets/kern-_HIXM1gQ.js", roh: 9000, gz: 3992 }];
    assert.equal(csgChunkPruefen(d, 35840).status, "ok");
    assert.equal(csgChunkPruefen(d, 30000).status, "ueber");
    assert.equal(csgChunkPruefen(d.slice(1), 35840).status, "fehlt");
    assert.equal(csgChunkPruefen(d, undefined).status, "ohne_grenze");
    const budget = JSON.parse(fs.readFileSync("budget.json", "utf8"));
    assert.equal(typeof budget.grenzen.chunks.csg, "number");
  });
  it("jeder Fachlayer hat einen deutschen Namen für die Konfliktkarte", () => {
    for (const feld of Object.keys(LAYER_VERSION)) assert.ok(/** @type {any} */ (FELD_NAMEN)[feld], `${feld} fehlt in FELD_NAMEN (modellAbgleich.js)`);
    assert.equal(FELD_NAMEN.csg_cache_layer, "3D-Zwischenspeicher (CSG)");
  });
});
