// Unit-Tests für den TGA-Netz-Anteil des IFC-Exports (Phase 41, NETZ-05):
// exportIFC(model, { netz }) schreibt je Kante ein IfcPipe-/Duct-/CableSegment mit
// Polylinien-Achse im Storey des Geschosses; ohne Netz ist die Datei byte-identisch zu vorher.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createBuildingModel } from "@core/lib/buildingModel";
import { exportIFC, NETZ_ACHSHOEHE_M } from "@designer/lib/ifcExport";

const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
const NETZ = {
  version: 1,
  knoten: [
    { id: "n_1", gewerk: "heizung", art: "erzeuger", level: 0, x: 0, z: 0 },
    { id: "n_2", gewerk: "heizung", art: "auslass", level: 0, x: 5, z: 0 },
  ],
  kanten: [
    { id: "k_1", gewerk: "heizung", level: 0, dn: 25, von: "n_1", nach: "n_2", points: [{ x: 0, z: 0 }, { x: 5, z: 0 }] },
    { id: "k_2", gewerk: "lueftung", level: 1, dn: 160, von: null, nach: null, points: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 3, z: 4 }] },
    { id: "k_3", gewerk: "elektro", level: 0, dn: 2.5, von: null, nach: null, points: [{ x: 1, z: 1 }, { x: 1, z: 2 }] },
    { id: "k_4", gewerk: "gas", level: 0, dn: 20, von: null, nach: null, points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },   // unbekanntes Gewerk → weg
    { id: "k_5", gewerk: "abwasser", level: 0, dn: 100, von: null, nach: null, points: [{ x: 0, z: 0 }] },            // < 2 Punkte → weg
  ],
};
const zeilen = (ifc, typ) => ifc.split("\n").filter((l) => l.includes(`=${typ}(`));

describe("ifcExport — TGA-Netz (NETZ-05)", () => {
  it("ohne Netz byte-identisch (netz fehlt, null, leer)", () => {
    const a = exportIFC(model, {});
    const b = exportIFC(model, { netz: null });
    const c = exportIFC(model, { netz: { version: 1, knoten: [], kanten: [] } });
    assert.equal(a, b);
    assert.equal(a, c);
    assert.equal(zeilen(a, "IFCPIPESEGMENT").length, 0);
  });

  it("je Kante ein Segment der passenden IFC4-Klasse, unbrauchbare Kanten fallen weg", () => {
    const ifc = exportIFC(model, { netz: NETZ });
    assert.equal(zeilen(ifc, "IFCPIPESEGMENT").length, 1, "Heizung");
    assert.equal(zeilen(ifc, "IFCDUCTSEGMENT").length, 1, "Lüftung");
    assert.equal(zeilen(ifc, "IFCCABLESEGMENT").length, 1, "Elektro");
    assert.ok(!ifc.includes("gas"), "unbekanntes Gewerk nicht exportiert");
    assert.equal(zeilen(ifc, "IFCFLOWSEGMENT").length, 0, "kein abstrakter Obertyp");
  });

  it("Name/Beschreibung/Tag/PredefinedType und Achse als Polylinie mit Achshöhe", () => {
    const ifc = exportIFC(model, { netz: NETZ });
    const pipe = zeilen(ifc, "IFCPIPESEGMENT")[0];
    assert.match(pipe, /'Heizung DN 25'/);
    assert.match(pipe, /'Heizwasser'/);
    assert.match(pipe, /'k_1'/);
    assert.match(pipe, /\.RIGIDSEGMENT\.\);$/);
    const kabel = zeilen(ifc, "IFCCABLESEGMENT")[0];
    assert.match(kabel, /'Elektro 2\.5 mm\\X2\\00B2\\X0\\'/, "mm² ISO-10303-21-kodiert");
    assert.match(kabel, /\.CABLESEGMENT\.\);$/);
    // Achsen: 'Axis'/'Curve3D' je Segment, Punkte auf NETZ_ACHSHOEHE_M
    assert.equal(ifc.split("'Axis','Curve3D'").length - 1, 3);
    const achsPunkte = ifc.split("\n").filter((l) => l.includes("IFCCARTESIANPOINT(") && l.includes(`,${NETZ_ACHSHOEHE_M.toFixed(4)})`));
    assert.equal(achsPunkte.length, 2 + 3 + 2, "2 + 3 + 2 Stützpunkte");
    assert.equal(NETZ_ACHSHOEHE_M, 0.5);
  });

  it("Segmente hängen im Storey ihres Geschosses (Containment)", () => {
    const ifc = exportIFC(model, { netz: NETZ });
    const idOf = (line) => line.split("=")[0];
    const pipeId = idOf(zeilen(ifc, "IFCPIPESEGMENT")[0]);
    const ductId = idOf(zeilen(ifc, "IFCDUCTSEGMENT")[0]);
    const storeys = zeilen(ifc, "IFCBUILDINGSTOREY");
    assert.equal(storeys.length, 2);
    const eg = idOf(storeys[0]), og = idOf(storeys[1]);
    const rels = zeilen(ifc, "IFCRELCONTAINEDINSPATIALSTRUCTURE");
    const relEG = rels.find((r) => r.trimEnd().endsWith(`),${eg});`));
    const relOG = rels.find((r) => r.trimEnd().endsWith(`),${og});`));
    assert.ok(relEG && relEG.includes(`${pipeId},`) || relEG.includes(`${pipeId})`), "Heizung im EG");
    assert.ok(relOG && (relOG.includes(`${ductId},`) || relOG.includes(`${ductId})`)), "Lüftung im 1. OG");
    assert.ok(!(relEG.includes(`${ductId},`) || relEG.includes(`${ductId})`)), "Lüftung nicht im EG");
  });

  it("Datei bleibt gültiger STEP-Rahmen", () => {
    const ifc = exportIFC(model, { netz: NETZ });
    assert.ok(ifc.startsWith("ISO-10303-21;"));
    assert.ok(ifc.trimEnd().endsWith("END-ISO-10303-21;"));
    assert.match(ifc, /FILE_SCHEMA\(\('IFC4'\)\);/);
  });
});
