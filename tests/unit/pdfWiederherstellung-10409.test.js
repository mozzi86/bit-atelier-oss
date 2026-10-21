// Unit tests for plan 104-09, studio side: save orchestration (packages/nova-pdf/src/lib/pdfSpeichern.js),
// saving state (studioStand.js) and the crash-recovery journal (wiederherstellung.js).
// The format layer (incremental writer) is covered by pdfAnhang-10409.test.js.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFArray, StandardFonts } from "pdf-lib";

import { imPdfSpeichern, dataUrlZuBytes, bytesZuDataUrl, anzeigeBytes } from "@pdf/lib/pdfSpeichern";
import { pdfStandVergleich, enthaeltStudioMarke, pinNummern, anmerkungFingerabdruck, istFestgeschrieben } from "@pdf/lib/studioStand";
import { beginntMit, anhangPruefen } from "@pdf/lib/inkrementell";
import {
  dokumentHash, journalBauen, journalLaden, journalSpeichern, journalLesen, journalAufraeumen, journalSchluessel,
  wiederherstellungsPlan, browserSpeicher, JOURNAL_VERSION,
} from "@pdf/lib/wiederherstellung";

async function testPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) doc.addPage([595, 842]).drawText(`Plan ${i + 1}`, { x: 60, y: 760, size: 24, font });
  return doc.save(); // pdf-lib default: object streams + cross-reference stream
}

const ANN = [
  { id: "r1", type: "pin", page: 1, x: 0.2, y: 0.1, text: "Maß prüfen", color: "#2563eb", author: "Planer A", created_date: "2026-10-21T10:00:00Z" },
  { id: "r2", type: "text", page: 2, x: 0.1, y: 0.5, text: "Detail folgt", color: "#16a34a", author: "Planer A", created_date: "2026-10-21T10:01:00Z" },
];

/** Test double of bitApi: Document.update merges, blobs live in a Map, every call is logged. */
function fakeApi() {
  const log = [];
  const blobs = new Map();
  return {
    log,
    blobs: {
      store: blobs,
      async put(id, json) { log.push(`put ${id}`); blobs.set(id, json); return { ok: true }; },
      async get(id) { return blobs.get(id) ?? null; },
      async delete(id) { log.push(`delete ${id}`); blobs.delete(id); },
    },
    entities: { Document: { async update(id, data) { log.push(`update ${id}`); return { id, ...data }; } } },
  };
}

/** Journal storage in memory (same contract as browserSpeicher). */
function mapSpeicher() {
  const m = new Map();
  return {
    m,
    async lesen(k) { return m.get(k) ?? null; },
    async schreiben(k, t) { m.set(k, t); },
    async loeschen(k) { m.delete(k); },
    async schluessel() { return [...m.keys()]; },
  };
}

describe("104-09 imPdfSpeichern (studio save)", () => {
  it("inline document: record gets the appended file, original stays the prefix, map + history stored", async () => {
    const original = await testPdf();
    const api = fakeApi();
    const dokument = { id: "d1", name: "Plan.pdf", mime: "application/pdf", data: bytesZuDataUrl(original), data_blob: null, size: original.length };
    const erg = await imPdfSpeichern({ dokument, anmerkungen: ANN, api, jetzt: new Date("2026-10-21T12:00:00Z") });
    assert.equal(erg.geschrieben, true);
    const neu = dataUrlZuBytes(erg.dokument.data);
    assert.ok(beginntMit(neu, original), "first N bytes = original");
    assert.deepEqual(anhangPruefen(neu).fehler, []);
    assert.equal(erg.dokument.original_bytes, original.length);
    assert.equal(erg.dokument.size, neu.length);
    assert.deepEqual(erg.dokument.pdf_speicherungen, [{ bytes: neu.length, datum: "2026-10-21T12:00:00.000Z", neu: 2, geaendert: 0, entfernt: 0 }]);
    assert.deepEqual(Object.keys(erg.dokument.pdf_anmerkungen).sort(), ["r1", "r2"]);
    assert.equal(pdfStandVergleich(ANN, erg.dokument.pdf_anmerkungen).offen, 0, "nothing open after the save");
    assert.ok(enthaeltStudioMarke(neu));
    assert.equal(enthaeltStudioMarke(original), false);

    // Reopened with the library: both annotations there.
    const doc = await PDFDocument.load(neu);
    const zahl = doc.getPages().map((p) => p.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() || 0);
    assert.deepEqual(zahl, [1, 1]);

    // Second save without changes: no bytes appended, only the map refreshed.
    const zweit = await imPdfSpeichern({ dokument: erg.dokument, anmerkungen: ANN, api });
    assert.equal(zweit.geschrieben, false);
    assert.equal(zweit.dokument.data, erg.dokument.data);

    // Changed pin text → second update; the first saved state is the prefix, original_bytes kept.
    const dritt = await imPdfSpeichern({ dokument: erg.dokument, anmerkungen: [{ ...ANN[0], text: "Maß 2,50 m" }, ANN[1]], api });
    const b3 = dataUrlZuBytes(dritt.dokument.data);
    assert.ok(beginntMit(b3, neu) && beginntMit(b3, original));
    assert.equal(dritt.dokument.original_bytes, original.length);
    assert.equal(dritt.dokument.pdf_speicherungen.length, 2);
    assert.equal(dritt.bericht.geaendert, 1);

    // Display copy for pdf.js has no studio annotations; the stored file keeps them.
    const anzeige = await anzeigeBytes(b3);
    const ad = await PDFDocument.load(anzeige);
    assert.deepEqual(ad.getPages().map((p) => p.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() || 0), [0, 0]);
    assert.equal(await anzeigeBytes(original), original);
  });

  it("blob document: new blob first, then the record, then the old blob is deleted", async () => {
    const original = await testPdf();
    const api = fakeApi();
    api.blobs.store.set("dok-alt", { inhalt: bytesZuDataUrl(original) });
    const dokument = { id: "d2", name: "Gross.pdf", data: null, data_blob: "dok-alt" };
    const erg = await imPdfSpeichern({ dokument, anmerkungen: [ANN[0]], api });
    // Small test file → it lands inline (storage rule), the old blob is dropped after the update.
    assert.ok(erg.dokument.data);
    assert.equal(erg.dokument.data_blob, null);
    const u = api.log.indexOf("update d2");
    const d = api.log.indexOf("delete dok-alt");
    assert.ok(u >= 0 && d > u, `order: ${api.log.join(", ")}`);
    assert.ok(beginntMit(dataUrlZuBytes(erg.dokument.data), original));
  });

  it("refuses local-only records and unreadable content in plain text", async () => {
    const api = fakeApi();
    const original = await testPdf();
    await assert.rejects(
      () => imPdfSpeichern({ dokument: { id: "d3", data: bytesZuDataUrl(original) }, anmerkungen: [{ ...ANN[0], _lokal: true }], api }),
      /Server noch nicht hat/,
    );
    await assert.rejects(() => imPdfSpeichern({ dokument: { id: "d4", data: null, data_blob: null }, anmerkungen: [], api }), /nicht gefunden/);
    await assert.rejects(
      () => imPdfSpeichern({ dokument: { id: "d5", data: bytesZuDataUrl(new TextEncoder().encode("kein pdf")) }, anmerkungen: ANN, api }),
      /PDF/,
    );
    assert.equal(api.log.length, 0, "nothing written on a refusal");
  });

  it("refuses a fixed document (sha256 set) before reading or writing anything", async () => {
    const original = await testPdf();
    const api = fakeApi();
    let gelesen = 0;
    const get = api.blobs.get.bind(api.blobs);
    api.blobs.get = async (id) => { gelesen += 1; return get(id); };
    api.blobs.store.set("dok-fest", { inhalt: bytesZuDataUrl(original) });
    const inline = { id: "d6", name: "Schreiben.pdf", data: bytesZuDataUrl(original), sha256: "ab".repeat(32) };
    const blob = { id: "d7", name: "Angebot.pdf", data: null, data_blob: "dok-fest", sha256: "cd".repeat(32) };
    for (const dokument of [inline, blob]) {
      await assert.rejects(() => imPdfSpeichern({ dokument, anmerkungen: ANN, api }), /festgeschrieben/);
    }
    assert.equal(api.log.length, 0, "no update, no put, no delete");
    assert.equal(gelesen, 0, "the fixed file is not even read");
    assert.equal(api.blobs.store.get("dok-fest").inhalt, bytesZuDataUrl(original), "stored bytes untouched");
  });
});

describe("104-09 studioStand", () => {
  it("istFestgeschrieben: only a non-empty sha256 string fixes a document", () => {
    assert.equal(istFestgeschrieben({ sha256: "ab".repeat(32) }), true);
    for (const d of [null, undefined, {}, { sha256: "" }, { sha256: "  " }, { sha256: null }, { sha256: 42 }]) {
      assert.equal(istFestgeschrieben(/** @type {any} */ (d)), false, JSON.stringify(d));
    }
  });

  it("pdfStandVergleich counts new, changed, removed and local records", () => {
    const nr = pinNummern(ANN);
    const map = { r1: anmerkungFingerabdruck(ANN[0], nr.get("r1")), r2: anmerkungFingerabdruck(ANN[1], 0) };
    assert.deepEqual(pdfStandVergleich(ANN, null), { neu: 2, geaendert: 0, entfernt: 0, offen: 2 });
    assert.deepEqual(pdfStandVergleich(ANN, map), { neu: 0, geaendert: 0, entfernt: 0, offen: 0 });
    assert.deepEqual(pdfStandVergleich([{ ...ANN[0], text: "neu" }], map), { neu: 0, geaendert: 1, entfernt: 1, offen: 2 });
    assert.equal(pdfStandVergleich([...ANN, { ...ANN[0], id: "lokal-1", _lokal: true }], map).neu, 1);
  });
});

describe("104-09 crash-recovery journal", () => {
  const dokument = { id: "d1", name: "Plan.pdf" };

  it("journalBauen keeps only what would be lost", () => {
    assert.equal(journalBauen({ hash: "h", dokument, seite: 1, anmerkungen: ANN }), null, "server records alone: nothing to keep");
    assert.equal(journalBauen({ hash: "h", dokument, seite: 1, anmerkungen: ANN, draftPin: { x: 0.1, y: 0.2 }, pinText: "  " }), null, "empty draft is not worth an offer");
    const j = journalBauen({ hash: "h", dokument, seite: 2, anmerkungen: [...ANN, { ...ANN[0], id: "lokal-x", _lokal: true }],
      loeschungen: ["r2"], draftPin: { x: 0.1, y: 0.2 }, pinText: "Riss Ecke", jetzt: new Date("2026-10-21T09:00:00Z") });
    assert.equal(j.v, JOURNAL_VERSION);
    assert.deepEqual(j.ausstehend.map((a) => a.id), ["lokal-x"]);
    assert.deepEqual(j.loeschungen, ["r2"]);
    assert.deepEqual(j.entwurf, { pin: { x: 0.1, y: 0.2, page: 2, text: "Riss Ecke" }, text: null });
    assert.equal(j.zeit, "2026-10-21T09:00:00.000Z");
    const t = journalBauen({ hash: "h", dokument, seite: 1, anmerkungen: [], draftText: { x: 0.3, y: 0.4, value: "Notiz" } });
    assert.deepEqual(t.entwurf.text, { x: 0.3, y: 0.4, page: 1, value: "Notiz" });
  });

  it("wiederherstellungsPlan skips what the server already has", () => {
    const lokal = { ...ANN[0], id: "lokal-x", _lokal: true, created_date: "2026-10-21T11:00:00Z" };
    const j = journalBauen({ hash: "h", dokument, seite: 1, anmerkungen: [lokal], loeschungen: ["r2", "weg"], draftText: { x: 0, y: 0, value: "a" } });
    const p = wiederherstellungsPlan(j, ANN);
    assert.deepEqual(p.anlegen.map((a) => a.id), ["lokal-x"]);
    assert.deepEqual(p.loeschen, ["r2"], "deletion of a record that is gone is dropped");
    assert.equal(p.anzahl, 3);
    // The write reached the server, only the answer was lost: same type/page/time → not created twice.
    const p2 = wiederherstellungsPlan({ ...j, loeschungen: [], entwurf: { pin: null, text: null } }, [...ANN, { ...lokal, id: "srv-9", _lokal: undefined }]);
    assert.equal(p2, null);
    assert.equal(wiederherstellungsPlan(null, ANN), null);
  });

  it("store, load, remove and clean up through the storage adapter", async () => {
    const s = mapSpeicher();
    const j = journalBauen({ hash: "abc", dokument, seite: 1, anmerkungen: [], draftText: { x: 0, y: 0, value: "x" }, jetzt: new Date("2026-10-20T00:00:00Z") });
    await journalSpeichern(s, "abc", j);
    assert.ok(s.m.has(journalSchluessel("abc")));
    assert.deepEqual(await journalLaden(s, "abc"), j);
    await journalSpeichern(s, "abc", null);
    assert.equal(s.m.size, 0, "null removes the entry");

    assert.equal(journalLesen("{kaputt"), null);
    assert.equal(journalLesen(JSON.stringify({ ...j, v: 99 })), null, "other version is ignored");

    await journalSpeichern(s, "alt", { ...j, hash: "alt", zeit: "2026-08-01T00:00:00Z" });
    await journalSpeichern(s, "neu", { ...j, hash: "neu", zeit: "2026-10-20T00:00:00Z" });
    s.m.set(journalSchluessel("muell"), "nicht json");
    const weg = await journalAufraeumen(s, { jetzt: new Date("2026-10-21T00:00:00Z") });
    assert.equal(weg, 2);
    assert.deepEqual([...s.m.keys()], [journalSchluessel("neu")]);
  });

  it("dokumentHash is SHA-256 of the bytes", async () => {
    const a = await dokumentHash(new TextEncoder().encode("abc"));
    assert.equal(a, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.notEqual(await dokumentHash(new TextEncoder().encode("abd")), a);
  });

  describe("browserSpeicher (localStorage part)", () => {
    const vorher = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    afterEach(() => {
      if (vorher) Object.defineProperty(globalThis, "localStorage", vorher);
      else delete globalThis.localStorage;
    });

    function fakeLs() {
      const m = new Map();
      return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
        key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
    }

    it("small journal goes to localStorage; a large one needs IndexedDB and says so in plain text", async () => {
      const ls = fakeLs();
      Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
      const s = browserSpeicher();
      await s.schreiben(journalSchluessel("k"), "{\"v\":1}");
      assert.equal(ls.m.get(journalSchluessel("k")), "{\"v\":1}");
      assert.deepEqual(await s.schluessel(), [journalSchluessel("k")]);
      assert.equal(await s.lesen(journalSchluessel("k")), "{\"v\":1}");
      // > 256 KB: storage rule says object store (IndexedDB) — not available in Node.
      await assert.rejects(() => s.schreiben(journalSchluessel("gross"), "x".repeat(300 * 1024)), /Kein Browserspeicher/);
      await s.loeschen(journalSchluessel("k"));
      assert.equal(ls.m.size, 0);
    });
  });
});
