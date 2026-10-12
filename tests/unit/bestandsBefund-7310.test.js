// Unit tests for 73-10 (BEST-12): finding record, additive insert into befunde_layer (BCF part untouched),
// Erfassungsgrad from the method, raise only upwards, and writing the raise into inline or blob elements.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { befundAnlegen, befundEinfuegen, erfassungAusMethode, darfAnheben } from "@core/lib/bestandsBefund";
import { elementErfassungSetzen } from "@core/lib/snapshotElemente";

describe("73-10 Bestandsbefund", () => {
  it("record with method-based proposal; inputs are checked", () => {
    const b = befundAnlegen({ guid: "w-04", methode: "oeffnung", kategorie: "aufbau", text: "Mauerwerk 36,5 cm, kein Dämmstoff", jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(b.art, "bestand");
    assert.equal(b.erfassung_vorschlag, "gemessen");
    assert.equal(b.datum, "2026-10-11");
    assert.throws(() => befundAnlegen({ guid: "", methode: "sicht", kategorie: "schaden" }), /GlobalId/);
    assert.throws(() => befundAnlegen({ guid: "x", methode: "raten", kategorie: "schaden" }), /Methode/);
    assert.equal(erfassungAusMethode("sicht"), "abgeleitet");
  });

  it("additive insert keeps the BCF topics and answers", () => {
    const alt = { quelle: "catenda", topics: [{ guid: "t1" }], antworten: { t1: { status: "Open" } } };
    const neu = befundEinfuegen(alt, befundAnlegen({ guid: "w-01", methode: "sicht", kategorie: "feuchte" }));
    assert.deepEqual(neu.topics, alt.topics);
    assert.deepEqual(neu.antworten, alt.antworten);
    assert.equal(neu.bestand.length, 1);
    assert.equal(befundEinfuegen(null, neu.bestand[0]).bestand.length, 1);
  });

  it("raise only upwards; unknown is lowest", () => {
    assert.equal(darfAnheben("angenommen", "gemessen"), true);
    assert.equal(darfAnheben(null, "abgeleitet"), true);
    assert.equal(darfAnheben("gemessen", "abgeleitet"), false);
    assert.equal(darfAnheben("gemessen", "gemessen"), false);
    assert.equal(darfAnheben("altplan", "quatsch"), false);
  });

  it("writes the raise into inline elements or into the blob", async () => {
    const log = [];
    const api = {
      entities: { BimSnapshot: { update: async (id, d) => { log.push(["upd", id, d]); } } },
      blobs: { get: async () => ({ snapshot_id: "s", elemente: [{ guid: "a", erfassung: "angenommen" }] }), put: async (id, d) => { log.push(["put", id, d]); } },
    };
    assert.deepEqual(await elementErfassungSetzen({ id: "s1", elemente: [{ guid: "a" }, { guid: "b" }] }, "b", "gemessen", { api }), { ok: true });
    assert.equal(log[0][2].elemente[1].erfassung, "gemessen");
    assert.equal(log[0][2].elemente[0].erfassung, undefined);
    assert.deepEqual(await elementErfassungSetzen({ id: "s2", elemente_blob: "bl" }, "a", "gemessen", { api }), { ok: true });
    assert.equal(log[1][0], "put");
    assert.equal(log[1][2].elemente[0].erfassung, "gemessen");
    assert.equal(log[1][2].snapshot_id, "s");
    assert.match((await elementErfassungSetzen({ id: "s3", elemente: [{ guid: "a" }] }, "zz", "gemessen", { api })).grund, /nicht im Modellstand/);
  });
});
