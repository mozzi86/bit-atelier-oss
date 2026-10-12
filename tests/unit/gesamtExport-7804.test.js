// Unit tests for 78-04 (RC-30): the full export ZIP groups records by entity, carries every blob, and the
// manifest's SHA-256 and counts match the files.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { gesamtExportZip } from "@core/lib/gesamtExport";

describe("78-04 Gesamtexport", () => {
  it("records by entity, blobs, manifest with matching SHA-256", async () => {
    const { zip, manifest, dateiname } = await gesamtExportZip({
      datensaetze: [{ entity: "Project", id: "p1", name: "A" }, { entity: "Project", id: "p2" }, { entity: "LVPosition", id: "l1" }],
      blobs: [{ id: "elemente-p1", json: { elemente: [1, 2] } }],
    }, { org: "org-1", jetzt: new Date("2026-10-11T12:00:00Z") });
    assert.equal(dateiname, "BIT-Atelier-Gesamtexport_2026-10-11.zip");
    const dateien = unzipSync(zip);
    assert.deepEqual(Object.keys(dateien).sort(), ["LIESMICH.txt", "blobs/elemente-p1.json", "daten/LVPosition.json", "daten/Project.json", "manifest.json"]);
    assert.equal(JSON.parse(strFromU8(dateien["daten/Project.json"])).length, 2);
    assert.deepEqual(manifest.entitaeten, { LVPosition: 1, Project: 2 });
    assert.equal(manifest.blobs, 1);
    for (const f of manifest.dateien) {
      assert.equal(crypto.createHash("sha256").update(dateien[f.name]).digest("hex"), f.sha256, f.name);
      assert.equal(dateien[f.name].length, f.bytes);
    }
    assert.deepEqual(JSON.parse(strFromU8(dateien["manifest.json"])).entitaeten, manifest.entitaeten);
  });

  it("empty office still yields a valid ZIP with manifest", async () => {
    const { zip, manifest } = await gesamtExportZip({ datensaetze: [] });
    assert.ok(unzipSync(zip)["manifest.json"]);
    assert.deepEqual(manifest.entitaeten, {});
  });
});
