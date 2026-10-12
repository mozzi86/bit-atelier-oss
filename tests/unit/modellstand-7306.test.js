// Unit tests for 73-06: an IFC import becomes a model state in the projectImport shape (snapshot with
// project_id/elemente_blob/anzahl + blob {snapshot_id, project_id, anzahl, elemente}) incl. ohne_status;
// a failing blob write takes the record back; the seeded showcase snapshot feeds "Raumprogramm aus Bestand".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modellstandAusIfc, modellstandSpeichern } from "@ifc/lib/ifcSnapshot";
import { snapshotElemente } from "@core/lib/snapshotElemente";
import { programmAusBestand } from "@designer/lib/bestandsProgramm";
import { bimSnapshots, projects } from "../../packages/nova-core/server/seed-data.js";

const PARSED = {
  schema: "IFC4", storeys: ["EG", "OG"],
  elements: [
    { id: "a", guid: "a", ifcType: "IfcSpace", ifc_klasse: "IfcSpace", geschoss: "EG", status: "bestand", klassifikation: "DIN 277: 1 Wohnen und Aufenthalt", mengen: { area: 40 } },
    { id: "b", guid: "b", ifcType: "IfcWall", ifc_klasse: "IfcWall", geschoss: "EG", status: null, mengen: { area: 12 } },
  ],
  kennzahlen: { anzahl: 2, ohne_status: 1, ohne_geschoss: 0, status: { bestand: 1 } },
};

// > 256 KB of elements → blob (storage rule); 2 500 walls with a long name.
const GROSS = { ...PARSED, elements: [...PARSED.elements, ...Array.from({ length: 2500 }, (_, i) => ({ id: `w${i}`, guid: `w${i}`, ifcType: "IfcWall", ifc_klasse: "IfcWall", name: "Wand ".repeat(30), mengen: { area: 1 } }))] };

function fakeApi({ blobFehler = false } = {}) {
  const log = { create: [], put: [], del: [] };
  return {
    log,
    entities: { BimSnapshot: { create: async (d) => { log.create.push(d); return { id: "s1", ...d }; }, delete: async (id) => { log.del.push(id); } } },
    blobs: { put: async (id, j) => { if (blobFehler) throw new Error("Platte voll"); log.put.push([id, j]); } },
  };
}

describe("73-06 Modellstand aus IFC", () => {
  it("record in the projectImport shape with key figures", () => {
    const m = modellstandAusIfc(PARSED, { projectId: "p1", datei: "aufmass.ifc", jetzt: new Date("2026-10-11T10:00:00Z") });
    assert.equal(m.snapshot.project_id, "p1");
    assert.equal(m.snapshot.anzahl, 2);
    assert.equal(m.snapshot.ohne_status, 1);
    // Storage rule: two small elements stay inline (no blob).
    assert.equal(m.snapshot.elemente_blob, null);
    assert.equal(m.snapshot.elemente.length, 2);
    assert.match(m.blobId, /^elemente-p1-\d+$/);
    assert.deepEqual(m.snapshot.geschosse, ["EG", "OG"]);
    assert.equal(m.snapshot.name, "aufmass");
    assert.equal(m.elemente[0].ifc_klasse, "IfcSpace");
    assert.throws(() => modellstandAusIfc(PARSED, {}), /Kein Projekt/);
  });

  it("small state: record only, elements inline, no blob request", async () => {
    const api = fakeApi();
    const snap = await modellstandSpeichern(modellstandAusIfc(PARSED, { projectId: "p1" }), { api });
    assert.equal(api.log.put.length, 0);
    assert.equal((await snapshotElemente(snap)).quelle, "inline");
  });

  it("large state: record then blob; the blob carries snapshot_id; one reader finds the rooms again", async () => {
    const api = fakeApi();
    const m = modellstandAusIfc(GROSS, { projectId: "p1" });
    assert.equal(m.snapshot.elemente_blob, m.blobId);
    assert.equal(m.snapshot.elemente, undefined);
    const snap = await modellstandSpeichern(m, { api });
    assert.equal(api.log.put[0][0], m.blobId);
    assert.equal(api.log.put[0][1].snapshot_id, "s1");
    const r = await snapshotElemente(snap, { blobGet: async (id) => (api.log.put.find(([k]) => k === id) || [])[1] });
    assert.equal(r.quelle, "blob");
    assert.equal(programmAusBestand({ ...snap, elemente: r.elemente }).kennzahlen.raeume, 1);
  });

  it("a failing blob write takes the record back and says why", async () => {
    const api = fakeApi({ blobFehler: true });
    await assert.rejects(modellstandSpeichern(modellstandAusIfc(GROSS, { projectId: "p1" }), { api }), /Bauteile konnten nicht gespeichert werden: Platte voll/);
    assert.deepEqual(api.log.del, ["s1"]);
  });

  it("seed: the refurbishment showcase has a survey state that yields its rooms", async () => {
    const proj = projects.find((p) => p.build_kind === "sanierung");
    const snap = bimSnapshots.find((s) => s.project_id === proj.id);
    assert.ok(snap);
    const { elemente, quelle } = await snapshotElemente(snap);
    assert.equal(quelle, "inline");
    assert.equal(programmAusBestand({ ...snap, elemente }).kennzahlen.raeume, 6);
    assert.equal(snap.anzahl, elemente.length);
  });
});
