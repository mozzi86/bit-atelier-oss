// dokumentAblegen honours the storage rule for the Phase-81 document bytes (`daten`): small data URLs
// stay in Document.data, more than 1 MB goes to the object store (data_blob, data null); without an
// object store the bytes stay in the database and `hinweis` says so.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dokumentAblegen } from "../../packages/nova-core/src/lib/ablage.js";

function fakeApi({ mitBlobs }) {
  const docs = [], ordner = [], blobs = new Map();
  const api = {
    entities: {
      ProjectFolder: { filter: async () => ordner, create: async (o) => { const r = { id: `f${ordner.length + 1}`, ...o }; ordner.push(r); return r; } },
      Document: { create: async (o) => { const r = { id: `d${docs.length + 1}`, ...o }; docs.push(r); return r; } },
    },
  };
  if (mitBlobs) api.blobs = { put: async (id, json) => { blobs.set(id, json); return { ok: true }; } };
  return { api, docs, blobs };
}
const dataUrl = (bytes) => `data:application/pdf;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

describe("dokumentAblegen + Speicherregel", () => {
  it("small bytes stay inline", async () => {
    const { api, docs, blobs } = fakeApi({ mitBlobs: true });
    const r = await dokumentAblegen({ projectId: "p1", name: "angebot.pdf", typ: "Schriftverkehr", daten: dataUrl(10_000) }, api);
    assert.equal(r.ok, true);
    assert.ok(docs[0].data.startsWith("data:application/pdf"));
    assert.equal(docs[0].data_blob, undefined);
    assert.equal(blobs.size, 0);
  });

  it("over 1 MB goes to the object store", async () => {
    const { api, docs, blobs } = fakeApi({ mitBlobs: true });
    const r = await dokumentAblegen({ projectId: "p1", name: "plan.pdf", typ: "Schriftverkehr", daten: dataUrl(1_500_000) }, api);
    assert.equal(r.ok, true);
    assert.equal(docs[0].data, null);
    assert.ok(docs[0].data_blob && blobs.has(docs[0].data_blob));
    assert.equal(r.hinweis, undefined);
  });

  it("without an object store: stays in the database with a plain-text note", async () => {
    const { api, docs } = fakeApi({ mitBlobs: false });
    api.blobs = { put: async () => { throw new Error("kein Objektspeicher"); } };
    const r = await dokumentAblegen({ projectId: "p1", name: "plan.pdf", typ: "Schriftverkehr", daten: dataUrl(1_500_000) }, api);
    assert.ok(docs[0].data.startsWith("data:"));
    assert.match(r.hinweis, /Datenbank/);
  });
});
