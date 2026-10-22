// IFC distribution classes get KG 400 and the trade "TGA" instead of falling through to
// KG 390 / "Rohbau" (fixed 22.10.2026). Shell kinds keep their mapping.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kgFromKind, gewerkFromKind, GEWERKE } from "@core/lib/bimClassification";
import { mapToClassifiedElements } from "@ifc/lib/ifcImport.js";

describe("TGA-Arten aus IFC", () => {
  it("Kanal 430, Kabel 440, Heizkörper 420, Sanitär 410, Rohr 400 — Gewerk TGA aus dem Katalog", () => {
    assert.deepEqual(["ductsegment", "cablesegment", "spaceheater", "sanitaryterminal", "pipesegment"].map(kgFromKind), ["430", "440", "420", "410", "400"]);
    for (const k of ["ductsegment", "cablesegment", "spaceheater", "sanitaryterminal", "pipesegment"]) {
      assert.equal(gewerkFromKind(k), "TGA");
    }
    assert.ok(GEWERKE.includes("TGA"));
  });

  it("Rohbau-Arten unverändert", () => {
    assert.equal(kgFromKind("wall-hull"), "330");
    assert.equal(gewerkFromKind("slab"), "Rohbau");
    assert.equal(kgFromKind("beam"), "390");
  });

  it("IFC-Import: IfcDuctSegment ohne Klassifikation → KG 430, Gewerk TGA", () => {
    const [el] = mapToClassifiedElements([{ id: "g1", guid: "g1", ifc_klasse: "IfcDuctSegment", qty: {}, mengen: {} }]);
    assert.equal(el.kind, "ductsegment");
    assert.equal(el.kg, "430");
    assert.equal(el.gewerk, "TGA");
  });
});
