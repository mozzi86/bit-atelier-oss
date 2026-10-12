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
