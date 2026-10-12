// Unit tests for 73-05: provenance of the outline. A measured outline keeps its provenance through the
// shared store; any later edit of footprintM without its own provenance turns it into "gezeichnet"; an
// identical re-set does not; the display line names source, storey, raster deviation.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { footprintQuelleGemessen, footprintQuelleGezeichnet, footprintQuelleText } from "@core/lib/footprintQuelle";
import { buildingProgram } from "@core/lib/useBuildingProgram";

const POLY = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }];

describe("73-05 footprintQuelle", () => {
  it("measured provenance from a grundrissAusModell result", () => {
    const fq = footprintQuelleGemessen({ quelle: "IfcSlab", geschoss: "EG", flaeche: 115, rasterFlaeche: 100 }, new Date("2026-10-11T08:00:00Z"));
    assert.equal(fq.art, "gemessen");
    assert.equal(fq.abweichung, 0.15);
    assert.equal(footprintQuelleText(fq), "Umriss: gemessen (IfcSlab, Geschoss EG, Rasterabweichung 15 %, 11.10.2026)");
    assert.equal(footprintQuelleText(footprintQuelleGemessen({ quelle: "IFC" })).startsWith("Umriss: gemessen (IFC, alle Geschosse vereinigt"), true);
    assert.equal(footprintQuelleText(null), null, "legacy model: nothing claimed");
    assert.match(footprintQuelleText(footprintQuelleGezeichnet(new Date("2026-10-11T08:00:00Z"))), /^Umriss: gezeichnet \(11\.10\.2026\)$/);
  });

  it("store: measured stays measured until the outline is edited without provenance", () => {
    const fq = footprintQuelleGemessen({ quelle: "IFC", geschoss: "EG", flaeche: 80, rasterFlaeche: 80 });
    buildingProgram.set({ footprintM: POLY, footprintQuelle: fq });
    assert.equal(buildingProgram.get().footprintQuelle, fq);
    buildingProgram.set({ footprintM: POLY.map((p) => ({ ...p })) });
    assert.equal(buildingProgram.get().footprintQuelle, fq, "identical outline re-set keeps the provenance");
    buildingProgram.set({ storeys: 5 });
    assert.equal(buildingProgram.get().footprintQuelle, fq, "other fields do not touch it");
    buildingProgram.set({ footprintM: [...POLY.slice(0, 3), { x: 0, z: 9 }] });
    assert.equal(buildingProgram.get().footprintQuelle.art, "gezeichnet");
    buildingProgram.set({ footprintM: null });
    assert.equal(buildingProgram.get().footprintQuelle, null);
  });
});
