// Unit tests for the storage rule (user 11.10.2026): < 256 KB database, > 1 MB object store, in between a
// deterministic classifier over fixed criteria (profile per kind of content); store/load round trip, and
// the plain-text fallback when no object store exists (browser build).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DB_MAX_BYTES, BLOB_MIN_BYTES, bytesVon, speicherOrt, speicherKlassifizieren, KRITERIEN, SPEICHER_PROFILE,
  inhaltAblegen, inhaltLaden, blobIdNeu,
} from "@core/lib/speicherOrt";

const KB = 1024;

describe("Speicherregel", () => {
  it("hard limits: below 256 KB database, above 1 MB object store — whatever the context", () => {
    assert.equal(speicherKlassifizieren(DB_MAX_BYTES - 1, { art: "prueflauf" }).ort, "db");
    assert.equal(speicherKlassifizieren(BLOB_MIN_BYTES + 1, { art: "vorschau" }).ort, "blob");
    assert.equal(bytesVon("ä"), 2, "UTF-8 bytes, not characters");
    assert.equal(speicherOrt("x".repeat(10)).ort, "db");
  });

  it("grey zone: the classifier asks the criteria in order and names its reason", () => {
    const mitte = 500 * KB;
    assert.deepEqual(speicherKlassifizieren(mitte, { art: "bauteile" }), { ort: "blob", grund: "wächst mit dem Projekt" });
    assert.deepEqual(speicherKlassifizieren(mitte, { art: "dokument" }), { ort: "blob", grund: "würde jede Liste mit dem Inhalt belasten" });
    assert.deepEqual(speicherKlassifizieren(mitte, { art: "foto" }), { ort: "blob", grund: "Medium, wird erst beim Öffnen geladen" });
    assert.deepEqual(speicherKlassifizieren(mitte, { art: "vorschau" }), { ort: "db", grund: "wird immer mit dem Datensatz gelesen" });
    assert.equal(speicherKlassifizieren(mitte, {}).ort, "db");
    assert.equal(speicherKlassifizieren(mitte, { art: "vorschau", waechst: true }).ort, "blob", "explicit criteria override the profile");
    assert.ok(KRITERIEN.every((k) => k.frage && k.grund));
    for (const p of Object.values(SPEICHER_PROFILE)) for (const k of Object.keys(p)) assert.ok(KRITERIEN.some((x) => x.key === k), k);
  });

  it("store and load: small inline, large to the blob store, round trip", async () => {
    const ablage = new Map();
    const api = { blobs: { put: async (id, j) => { ablage.set(id, j); }, get: async (id) => ablage.get(id) } };
    const klein = await inhaltAblegen("data:x", { blobId: "b1", art: "dokument", api });
    assert.deepEqual([klein.ort, klein.inline, klein.blob], ["db", "data:x", null]);
    const gross = "y".repeat(BLOB_MIN_BYTES + 10);
    const r = await inhaltAblegen(gross, { blobId: blobIdNeu("dok"), art: "dokument", api });
    assert.equal(r.ort, "blob"); assert.equal(r.inline, null);
    assert.equal(await inhaltLaden(r.inline, r.blob, { api }), gross);
    assert.equal(await inhaltLaden("inline", "egal", { api }), "inline");
    assert.equal(await inhaltLaden(null, null, { api }), null);
  });

  it("without an object store the payload stays in the database and says so", async () => {
    const api = { blobs: { put: async () => { throw new Error("kein Blob-Speicher"); } } };
    const r = await inhaltAblegen("z".repeat(BLOB_MIN_BYTES + 1), { blobId: "b", art: "beleg", api });
    assert.equal(r.ort, "db");
    assert.ok(r.inline);
    assert.match(r.hinweis, /liegen in der Datenbank, weil hier kein Objektspeicher verfügbar ist/);
  });
});

// 107-14 (D-BK-08a): the mesh cache of the CSG core follows the storage rule (profile meshCache) and is only a cache:
// hit with the same hash, discarded with another input or another CSG_VERSION, oldest inline entry evicted at the limit.
describe("107-14 — Mesh-Cache nach der Speicherregel", async () => {
  const THREE = await import("three");
  const {
    meshKodieren, meshDekodieren, cacheLesen, cacheSchreiben, cacheBereinigen, cacheAblegen, cacheEintragLaden, cacheSchluessel,
    CSG_CACHE_LEER, basisHash, CSG_VERSION, volumen_m3, dreieckAnzahl, wandBasis,
  } = await import("@core/lib/csg/index.js");
  /** @param {number} i @param {number} bytes @returns {any} */
  const eintrag = (i, bytes) => ({ pruefsumme: `h${i}`, ort: "datenbank", objekt_id: null, inhalt: { format: "csg-mesh-1", positionen_b64: "x".repeat(bytes), gruppen: [], dreiecke: 0 }, groesse_bytes: bytes, dreiecke: 0, volumen_m3: null, quelle: "solid", warnung: null, erzeugt: `2026-10-26T10:00:0${i}.000Z` });

  it("Profil meshCache: Graubereich → Objektspeicher, unter 256 KB → Datenbank", () => {
    assert.deepEqual(SPEICHER_PROFILE.meshCache, { waechst: true });
    assert.equal(speicherKlassifizieren(300 * KB, { art: "meshCache" }).ort, "blob");
    assert.equal(speicherKlassifizieren(100 * KB, { art: "meshCache" }).ort, "db");
  });
  it("Rundlauf kodieren → dekodieren: gleiche Dreieckszahl, gleiches Volumen, Gruppen erhalten", () => {
    const g = new THREE.BoxGeometry(4, 2.5, 0.3);
    const p = meshKodieren(g);
    assert.equal(p.dreiecke, 12);
    const d = meshDekodieren(JSON.parse(JSON.stringify(p)));
    assert.equal(dreieckAnzahl(d), 12);
    assert.ok(Math.abs(volumen_m3(d) - 3) < 1e-6); // 4 · 2.5 · 0.3
    assert.equal(d.groups.length, 6); // BoxGeometry: one group per face
    assert.ok(d.getAttribute("normal"), "flat normals recomputed");
  });
  it("Treffer bei gleichem Hash, verworfen bei geändertem Eingabewert und bei geänderter CSG_VERSION", () => {
    const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
    const h = basisHash(wandBasis(wand));
    const k = cacheSchluessel("2xGuid", "wand");
    const { layer } = cacheSchreiben(CSG_CACHE_LEER, k, { ...eintrag(1, 10), pruefsumme: h });
    assert.ok(cacheLesen(layer, k, h));
    assert.equal(cacheLesen(layer, k, basisHash(wandBasis({ ...wand, height: 2.6 }))), null);
    assert.equal(cacheLesen(layer, k, basisHash(wandBasis(wand), { version: `${CSG_VERSION}+1` })), null);
    // cacheBereinigen removes the stale entry and names it (its blob is to be deleted)
    const r = cacheBereinigen(layer, new Map([[k, "anders"]]));
    assert.deepEqual(Object.keys(r.layer.eintraege), []);
    assert.equal(r.entfernt[0].schluessel, k);
    assert.equal(CSG_CACHE_LEER.eintraege && Object.keys(CSG_CACHE_LEER.eintraege).length, 0, "input never mutated");
  });
  it("Verdrängung: Inline-Einträge zusammen unter 256 KB, der älteste geht; zu großer Einzeleintrag wird nicht geschrieben", () => {
    let l = CSG_CACHE_LEER;
    l = cacheSchreiben(l, "a", eintrag(1, 100 * KB)).layer;
    l = cacheSchreiben(l, "b", eintrag(2, 100 * KB)).layer;
    const r = cacheSchreiben(l, "c", eintrag(3, 100 * KB));
    assert.deepEqual(Object.keys(r.layer.eintraege).sort(), ["b", "c"]);
    assert.deepEqual(r.verdraengt.map((x) => x.schluessel), ["a"]);
    const gross = cacheSchreiben(l, "d", eintrag(4, 300 * KB));
    assert.equal(gross.geschrieben, false);
    assert.equal(gross.layer.eintraege.d, undefined);
  });
  it("cacheAblegen: klein → Datenbankfeld; Objektspeicher fehlt im Graubereich → wird NICHT in die Datenbank geschrieben", async () => {
    const klein = await cacheAblegen(new THREE.BoxGeometry(1, 1, 1), { pruefsumme: "h", jetzt: new Date("2026-10-26T10:00:00Z") });
    assert.equal(klein?.eintrag.ort, "datenbank");
    assert.equal(klein?.eintrag.objekt_id, null);
    assert.equal(klein?.eintrag.dreiecke, 12);
    const back = await cacheEintragLaden(/** @type {any} */ (klein).eintrag);
    assert.ok(back && Math.abs(volumen_m3(back) - 1) < 1e-6);
    // ~10 000 triangles · 9 floats · 4 bytes ≈ 360 KB raw, ≈ 480 KB base64 → grey zone → object store
    const fein = new THREE.BoxGeometry(4, 2.5, 0.3, 60, 40, 3);
    const ohneSpeicher = { blobs: { put: async () => { throw new Error("kein Objektspeicher"); } } };
    assert.equal(await cacheAblegen(fein, { pruefsumme: "h", api: ohneSpeicher }), null);
    /** @type {Map<string, any>} */
    const speicher = new Map();
    const api = { blobs: { put: async (/** @type {string} */ id, /** @type {any} */ j) => { speicher.set(id, j); }, get: async (/** @type {string} */ id) => speicher.get(id) } };
    const r = await cacheAblegen(fein, { pruefsumme: "h", api });
    assert.equal(r?.eintrag.ort, "objektspeicher");
    assert.match(String(r?.eintrag.objekt_id), /^csg-/);
    assert.equal(r?.eintrag.inhalt, null);
    const zurueck = await cacheEintragLaden(/** @type {any} */ (r).eintrag, { api });
    assert.equal(dreieckAnzahl(/** @type {any} */ (zurueck)), 10800);
  });
});
