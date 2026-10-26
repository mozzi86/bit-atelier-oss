// Unit tests for the element resolvers of phase 106-01: bauteilInfoAus() (BIM studio, in
// @designer/lib/bauteilInfo.js) and ifcAufloeser() (IFC viewer, in @ifc/lib/ifcGeometry.js).
// They must refuse unknown hits and give the GUID the IFC export writes (guard rail 3).
// Style: node:test, German titles.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { createBuildingModel } from "@core/lib/buildingModel";
import { exportIFC } from "@designer/lib/ifcExport";
import { bauteilInfoAus, bauteilSchluessel, huellwandGuid } from "@designer/lib/bauteilInfo.js";
import { ifcAufloeser } from "@ifc/lib/ifcGeometry.js";
import { strahlPick, identitaetAus } from "@core/lib/zeigen/strahlPick.js";

const DATEN = {
  customWalls: [{ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, height: 3, _idx: 1 }, { a: { x: 0, z: 2 }, b: { x: 4, z: 2 }, level: 0, _idx: 7 }],
  customColumns: [{ x: 2, z: 2, level: 0, size: 0.4, _idx: 2 }],
  customZones: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, name: "Wohnen", _idx: 3 }],
  customSlabs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 0, _idx: 4 }],
  customRoofs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], level: 1, pitch: 2.5, _idx: 5 }],
};
const PID = "p-test";
const IFC_GUID = /^[0-9A-Za-z_$]{22}$/;

describe("bauteilInfoAus: Auflöser des BIM-Studios", () => {
  it("löst jede Bauteilart mit Etikett und GUID auf; Räume tragen den Namen", () => {
    const t = (x) => `[${x}]`;
    const opt = { projektId: PID, uebersetze: t };
    const wand = bauteilInfoAus({ kind: "wall", id: 1 }, DATEN, opt);
    assert.equal(wand.label, "[Wand]");
    assert.match(wand.guid, IFC_GUID);
    assert.equal(wand.bauteilId, 1);
    assert.equal(bauteilInfoAus({ kind: "column", id: 2 }, DATEN, opt).label, "[Stütze]");
    const raum = bauteilInfoAus({ kind: "zone", id: 3 }, DATEN, opt);
    assert.equal(raum.label, "[Raum]");
    assert.equal(raum.name, "Wohnen");
    assert.equal(bauteilInfoAus({ kind: "cslab", id: 4 }, DATEN, opt).label, "[Decke]");
    assert.equal(bauteilInfoAus({ kind: "croof", id: 5 }, DATEN, opt).label, "[Dach]");
    // two different walls: two different GUIDs, the same wall twice: the same GUID
    assert.notEqual(wand.guid, bauteilInfoAus({ kind: "wall", id: 7 }, DATEN, opt).guid);
    assert.equal(wand.guid, bauteilInfoAus({ kind: "wall", id: 1 }, DATEN, opt).guid);
  });

  it("unbekannte Treffer werden verweigert: Umgebung, Attika, Eckfüller ohne Id, gelöschtes Bauteil, ohne kind", () => {
    const opt = { projektId: PID };
    assert.equal(bauteilInfoAus({ kind: "context" }, DATEN, opt), null);
    assert.equal(bauteilInfoAus({ kind: "parapet" }, DATEN, opt), null);
    assert.equal(bauteilInfoAus({ kind: "wall" }, DATEN, opt), null, "Wand ohne Id");
    assert.equal(bauteilInfoAus({ kind: "wall", id: 99 }, DATEN, opt), null, "Wand existiert nicht mehr");
    assert.equal(bauteilInfoAus({ layer: "context" }, DATEN, opt), null);
    assert.equal(bauteilInfoAus(null, DATEN, opt), null);
    assert.equal(bauteilInfoAus({ kind: "window", id: 3 }, DATEN, opt), null, "Fenster sind (noch) nicht pickbar");
  });

  it("die GUID einer gezeichneten Wand ist dieselbe wie im IFC-Export", () => {
    const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
    const ifc = exportIFC(model, { ...DATEN, steckbrief: { projektId: PID } });
    const guid = bauteilInfoAus({ kind: "wall", id: 1 }, DATEN, { projektId: PID }).guid;
    assert.ok(ifc.includes(`'${guid}'`), "Export enthält die GUID der gehoverten Wand");
  });

  it("Hüllwand: GUID abgeleitet wie im Export (quelle huelle, id Geschoss:Kante), nicht null", () => {
    const model = createBuildingModel({ footprintM: null, storeys: 2, storeyHeight: 3 });
    const ifc = exportIFC(model, { ...DATEN, steckbrief: { projektId: PID } });
    assert.ok(model.walls.length >= 4, "Standardhülle hat Wände");
    for (const w of model.walls) {
      const info = bauteilInfoAus({ kind: "wallShell", level: w.level, edge: w.edge }, DATEN, { projektId: PID });
      assert.match(info.guid, IFC_GUID);
      assert.equal(info.guid, huellwandGuid(PID, w.level, w.edge));
      assert.ok(ifc.includes(`'${info.guid}'`), `Hüllwand ${w.level}:${w.edge}: GUID steht im Export`);
    }
    // different edges give different GUIDs; the project is part of the GUID
    const g0 = huellwandGuid(PID, 0, 0);
    assert.notEqual(g0, huellwandGuid(PID, 0, 1));
    assert.notEqual(g0, huellwandGuid("anderes-projekt", 0, 0));
  });

  it("bauteilSchluessel ist billig und stabil: gleiche Tags gleicher Schlüssel, leer ohne kind", () => {
    assert.equal(bauteilSchluessel({ kind: "wall", id: 1 }), bauteilSchluessel({ kind: "wall", id: 1, layer: "walls" }));
    assert.notEqual(bauteilSchluessel({ kind: "wall", id: 1 }), bauteilSchluessel({ kind: "wall", id: 2 }));
    assert.notEqual(bauteilSchluessel({ kind: "wallShell", level: 0, edge: 1 }), bauteilSchluessel({ kind: "wallShell", level: 1, edge: 1 }));
    assert.equal(bauteilSchluessel({}), "");
    assert.equal(bauteilSchluessel(null), "");
  });
});

describe("ifcAufloeser: Auflöser des IFC-Viewers", () => {
  /** Merged mesh with two quads (elements 101 and 202): index ranges {0,6} and {6,6}, faces 0-1 and 2-3. */
  function gemergt() {
    const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const model = {
      merged: { ranges: [{ eid: 101, start: 0, count: 6 }, { eid: 202, start: 6, count: 6 }] },
      guidByExpressId: new Map([[101, "1AAAAAAAAAAAAAAAAAAAA1"], [202, "2BBBBBBBBBBBBBBBBBBBB2"]]),
    };
    return { mesh, model };
  }

  it("ein Strahl auf das zweite Element liefert dessen expressId und GlobalId", () => {
    const { mesh, model } = gemergt();
    const treffer = strahlPick(mesh, { ursprung: [2.5, 0.5, 5], richtung: [0, 0, -1] });
    const id = identitaetAus(treffer, ifcAufloeser(model, mesh), { guidPflicht: true });
    assert.equal(id.expressId, 202);
    assert.equal(id.guid, "2BBBBBBBBBBBBBBBBBBBB2");
    const erstes = identitaetAus(strahlPick(mesh, { ursprung: [0.5, 0.5, 5], richtung: [0, 0, -1] }), ifcAufloeser(model, mesh));
    assert.equal(erstes.expressId, 101);
  });

  it("verweigert: anderes Objekt, Element ohne GUID (mit guidPflicht), kein Modell, Face außerhalb der Ranges", () => {
    const { mesh, model } = gemergt();
    const treffer = strahlPick(mesh, { ursprung: [0.5, 0.5, 5], richtung: [0, 0, -1] });
    const fremd = new THREE.Mesh(mesh.geometry, mesh.material);
    fremd.updateMatrixWorld(true);
    assert.equal(ifcAufloeser(model, fremd)(treffer), null, "Treffer auf einem anderen Objekt als dem gemergten Mesh");
    const ohneGuid = { ...model, guidByExpressId: new Map() };
    assert.equal(ifcAufloeser(ohneGuid, mesh)(treffer).guid, null);
    assert.equal(identitaetAus(treffer, ifcAufloeser(ohneGuid, mesh), { guidPflicht: true }), null);
    assert.equal(ifcAufloeser(null, mesh)(treffer), null);
    assert.equal(ifcAufloeser(model, mesh)({ ...treffer, faceIndex: null }), null);
    assert.equal(ifcAufloeser(model, mesh)({ ...treffer, faceIndex: 99 }), null);
  });
});
