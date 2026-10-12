// Unit tests for 73-03: snapshot elements are read inline → blob → plain-text error. The bug: the project
// import stores elements ONLY in a blob (projectImport.js step 4), so programmAusBestand(snapshot) saw no
// rooms and the "Bestand → Raumprogramm" offer never fired. The first test shows the old path finds nothing
// and the new path finds the rooms (red before the fix: snapshotElemente did not exist).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { snapshotElemente } from "@core/lib/snapshotElemente";
import { programmAusBestand } from "@designer/lib/bestandsProgramm";

const raum = (guid, flaeche, din) => ({ guid, ifc_klasse: "IfcSpace", geschoss: "EG", mengen: { area: flaeche }, klassifikation: din });
const ELEMENTE = [raum("a", 40, "DIN 277: 1 Wohnen und Aufenthalt"), raum("b", 25, "DIN 277: 2 Büroarbeit"), { guid: "w", ifc_klasse: "IfcWall" }];
// Shape written by projectImport.js: no inline elements, blob id + count.
const IMPORTIERT = { id: "s1", project_id: "p1", elemente_blob: "elemente-p1", anzahl: 3 };

describe("73-03 snapshotElemente", () => {
  it("imported snapshot: the old inline-only read finds no rooms, the blob path finds them", async () => {
    assert.equal(programmAusBestand(IMPORTIERT).kennzahlen.raeume, 0, "documents the bug");
    const r = await snapshotElemente(IMPORTIERT, { blobGet: async (id) => (id === "elemente-p1" ? { snapshot_id: "s1", anzahl: 3, elemente: ELEMENTE } : null) });
    assert.equal(r.quelle, "blob");
    assert.equal(r.fehler, null);
    const p = programmAusBestand({ ...IMPORTIERT, elemente: r.elemente });
    assert.equal(p.kennzahlen.raeume, 2);
    assert.equal(Math.round(p.kennzahlen.flaeche), 65);
  });

  it("inline elements win and need no blob request", async () => {
    let gefragt = 0;
    const r = await snapshotElemente({ elemente: ELEMENTE, elemente_blob: "x" }, { blobGet: async () => { gefragt += 1; return null; } });
    assert.equal(r.quelle, "inline");
    assert.equal(r.elemente.length, 3);
    assert.equal(gefragt, 0);
  });

  it("no elements and no blob → empty without error; broken blob → plain-text error, never throws", async () => {
    assert.deepEqual(await snapshotElemente({}), { elemente: [], quelle: "leer", fehler: null });
    assert.deepEqual(await snapshotElemente(null), { elemente: [], quelle: "leer", fehler: null });
    const kaputt = await snapshotElemente(IMPORTIERT, { blobGet: async () => { throw new Error("404"); } });
    assert.match(kaputt.fehler, /konnten nicht geladen werden.*404/);
    const falsch = await snapshotElemente(IMPORTIERT, { blobGet: async () => ({ anzahl: 3 }) });
    assert.match(falsch.fehler, /keine Bauteilliste/);
  });
});
