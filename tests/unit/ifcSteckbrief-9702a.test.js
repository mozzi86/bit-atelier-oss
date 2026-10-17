// 97-02a: IFC export with the element data sheet — every element (hull, drawn, columns, beams,
// network segments and nodes) gets a stable GUID, Pset_BIT_Bauteil, material/layer set and the
// DIN 276 classification; without the option the file stays byte-identical.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBuildingModel } from "@core/lib/buildingModel";
import { exportIFC } from "@designer/lib/ifcExport";

const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
const OPTS = {
  customWalls: [{ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, height: 3, composite: "cavity", _idx: 1 }, { a: { x: 0, z: 2 }, b: { x: 4, z: 2 }, level: 0, thickness: 0.115, _idx: 7, status: "abbruch" }],
  customColumns: [{ x: 2, z: 2, level: 0, size: 0.4, _idx: 2 }],
  customWindows: [{ wallIdx: 1, u: 3, typeId: null, kind: "window", _idx: 3 }],
  customSlabs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, _idx: 4 }],
  customRoofs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 1, pitch: 2.5, _idx: 5 }],
  netz: {
    version: 1,
    knoten: [{ id: "n_1", gewerk: "heizung", art: "erzeuger", level: 0, x: 0, z: 0 }, { id: "n_2", gewerk: "lueftung", art: "auslass", level: 0, x: 3, z: 0 }],
    kanten: [{ id: "k_1", gewerk: "abwasser", level: 0, dn: 100, von: null, nach: null, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }],
  },
  tragwerk: { traeger: [{ id: "tr_1", level: 0, a: { x: 0, z: 0 }, b: { x: 5, z: 0 } }] },
};
const zeilen = (ifc, typ) => ifc.split("\n").filter((l) => l.includes(`=${typ}(`));
const MIT = { ...OPTS, steckbrief: { projektId: "p-test" } };

describe("97-02a IFC-Export mit Steckbrief", () => {
  it("ohne Steckbrief byte-gleich (auch wenn tragwerk übergeben wird)", () => {
    const { tragwerk, ...ohne } = OPTS;
    assert.equal(exportIFC(model, OPTS), exportIFC(model, ohne));
  });

  it("jede Referenz zeigt auf eine vorhandene Zeile, jede Zeile ist STEP", () => {
    const ifc = exportIFC(model, MIT);
    const daten = ifc.split("DATA;\n")[1].split("\nENDSEC;")[0].split("\n");
    const ids = new Set(daten.map((l) => l.match(/^#(\d+)=/)?.[1]));
    for (const l of daten) {
      assert.match(l, /^#\d+=[A-Z0-9]+\(.*\);$/, l);
      for (const [, r] of l.matchAll(/#(\d+)/g)) assert.ok(ids.has(r), `#${r} fehlt (${l.slice(0, 60)})`);
    }
  });

  it("Klassen aus dem Typ-Register: Trennwand PARTITIONING, Flachdach, Abwasser RIGIDSEGMENT, Knoten, Träger", () => {
    const ifc = exportIFC(model, MIT);
    assert.ok(zeilen(ifc, "IFCWALL").some((l) => l.endsWith(".PARTITIONING.);")));
    assert.ok(zeilen(ifc, "IFCROOF")[0].endsWith(".FLAT_ROOF.);"));
    assert.ok(zeilen(ifc, "IFCPIPESEGMENT")[0].endsWith(".RIGIDSEGMENT.);"), "nicht GUTTER");
    assert.equal(zeilen(ifc, "IFCBOILER").length, 1);
    assert.equal(zeilen(ifc, "IFCAIRTERMINAL").length, 1);
    assert.equal(zeilen(ifc, "IFCBEAM").length, 1);
    assert.ok(zeilen(ifc, "IFCSLAB").some((l) => l.endsWith(".BASESLAB.);")), "Bodenplatte der Hülle");
  });

  it("Steckbrief-Psets, Material-Schichten und DIN-276-Klassifizierung", () => {
    const ifc = exportIFC(model, MIT);
    assert.ok(zeilen(ifc, "IFCPROPERTYSET").filter((l) => l.includes("'Pset_BIT_Bauteil'")).length >= 10);
    assert.ok(ifc.includes("IFCLABEL('abbruch')"), "gesetzter Status steht drin");
    assert.ok(ifc.includes("IFCLABEL('ohne Status')"), "kein Neubau-Default");
    assert.ok(zeilen(ifc, "IFCMATERIALLAYERSET").length >= 1);
    assert.equal(zeilen(ifc, "IFCMATERIALLAYER").filter((l) => l.includes(".T.")).length, 1, "Luftschicht hinterlüftet");
    assert.equal(zeilen(ifc, "IFCCLASSIFICATION").length, 1);
    const kgs = zeilen(ifc, "IFCCLASSIFICATIONREFERENCE").map((l) => l.match(/\$,'(\d{3})'/)[1]);
    for (const kg of ["331", "342", "343", "351", "361", "334", "411", "421", "431"]) assert.ok(kgs.includes(kg), `KG ${kg}`);
    assert.equal(zeilen(ifc, "IFCRELASSOCIATESCLASSIFICATION").length, kgs.length);
  });

  it("GUIDs stabil über zwei Exporte, eindeutig in der Datei, projektweise verschieden", () => {
    const guids = (ifc) => zeilen(ifc, "IFCWALL").concat(zeilen(ifc, "IFCBEAM"), zeilen(ifc, "IFCPIPESEGMENT")).map((l) => l.match(/\('([^']{22})'/)[1]);
    const a = guids(exportIFC(model, MIT)), b = guids(exportIFC(model, MIT));
    assert.deepEqual(a, b);
    assert.equal(new Set(a).size, a.length);
    const c = guids(exportIFC(model, { ...OPTS, steckbrief: { projektId: "anderes" } }));
    assert.notDeepEqual(a, c);
  });
});

// 97-08: IFC4 status in the standard Common psets, NOTKNOWN instead of a NEW default; the import
// reads it back through the one normalisation.
import { statusRohFromPsets } from "@ifc/lib/ifcImport";
import { normalizeStatus } from "@core/lib/bimClassification.js";

describe("97-08 IFC4 Status in Pset_*Common", () => {
  it("Wand DEMOLISH, ohne Status NOTKNOWN, Stütze/Decke/Dach mit eigenem Common-Pset, Träger mit Status", () => {
    const ifc = exportIFC(model, MIT);
    const psetNamen = zeilen(ifc, "IFCPROPERTYSET").map((l) => l.match(/,'(Pset_[A-Za-z]+)'/)?.[1]);
    for (const n of ["Pset_WallCommon", "Pset_ColumnCommon", "Pset_SlabCommon", "Pset_RoofCommon", "Pset_WindowCommon", "Pset_BeamCommon"]) assert.ok(psetNamen.includes(n), n);
    assert.ok(ifc.includes("IFCLABEL('DEMOLISH')"), "abgebrochene Trennwand");
    assert.ok(ifc.includes("IFCLABEL('NOTKNOWN')"), "kein NEW-Default");
    assert.ok(!ifc.includes("IFCLABEL('NEW')"), "nichts ist Neubau, solange es niemand sagt");
  });
  it("Import liest den Standardwert zurück", () => {
    assert.equal(normalizeStatus(statusRohFromPsets({ Pset_WallCommon: { Status: "DEMOLISH" } })), "abbruch");
    assert.equal(normalizeStatus(statusRohFromPsets({ Pset_WallCommon: { Status: "NOTKNOWN" } })), null);
  });
});
