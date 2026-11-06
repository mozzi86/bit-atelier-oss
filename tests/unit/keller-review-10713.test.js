// Review fixes 107-13 (basements as model storeys): the plan fingerprint knows the basement count (0 = absent), the write-back
// keeps a removal of a basement that arrived from another device, the hull wall record of the studio panel equals the IFC
// export for basement walls, the editors share one level fallback, the floor plan keeps a negative level without basements,
// the base slab is found by key (copies work), and the IFC lists the storeys by elevation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBuildingModel, UG_AUFBAU_STANDARD } from "@core/lib/buildingModel";
import { modellKennung, ungespeicherteFelder, kennungWert } from "@core/lib/zeigen/planStand.js";
import { optionaleFelderVon, optionaleFelderNachFremd, programmSchreibPatch } from "@core/lib/useBimModelSync";
import { ebenenLevels, levelKlemmen, planEbene, istBodenplatte, huellwandDaten, ebeneKlemmen } from "@core/lib/bauteil/ebenen.js";
import { exportIFC } from "@designer/lib/ifcExport";

const zeilen = (/** @type {string} */ ifc, /** @type {string} */ typ) => ifc.split("\n").filter((l) => l.includes(`=${typ}(`));

describe("107-13 review: Modellstand-Fingerabdruck kennt untergeschosse", () => {
  const basis = { storeys: 2, storeyHeight: 3, footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }] };
  it("fehlend und 0 geben denselben Fingerabdruck (Bestandsblätter bleiben aktuell), 1 einen anderen", () => {
    const k = modellKennung(basis);
    assert.equal(modellKennung({ ...basis, untergeschosse: 0 }), k);
    assert.equal(modellKennung({ ...basis, untergeschosse: null }), k);
    assert.notEqual(modellKennung({ ...basis, untergeschosse: 1 }), k);
    assert.notEqual(modellKennung({ ...basis, untergeschosse: 2 }), modellKennung({ ...basis, untergeschosse: 1 }));
    assert.equal(kennungWert("untergeschosse", 0), null);
    assert.equal(kennungWert("untergeschosse", "2"), 2);
  });
  it("ungespeicherte Felder: UG lokal 1, gespeichert ohne Feld → untergeschosse offen; 0 gegen fehlend → nichts offen", () => {
    assert.deepEqual(ungespeicherteFelder(basis, { storeys: 2, untergeschosse: 1 }), ["untergeschosse"]);
    assert.deepEqual(ungespeicherteFelder(basis, { storeys: 2, untergeschosse: 0 }), []);
    assert.deepEqual(ungespeicherteFelder({ ...basis, untergeschosse: 1 }, { untergeschosse: 1 }), []);
  });
});

describe("107-13 review: Rückschreiben nach Fremdstand", () => {
  it("Übernahme UG 1 von einem anderen Gerät → lokal 0 → der PUT enthält untergeschosse: 0", () => {
    // loaded without basement: nothing optional is stored
    let hatte = optionaleFelderVon({ achseM: null, geschosse: null, untergeschosse: 0 });
    assert.deepEqual(hatte, { achseM: false, geschosse: false, untergeschosse: false });
    assert.equal("untergeschosse" in programmSchreibPatch({ storeys: 2, storeyHeight: 3, untergeschosse: 0 }, hatte), false, "ohne UG nie geschrieben");
    // another device stored one basement (and an axis and a storey table)
    hatte = optionaleFelderNachFremd(hatte, { achseM: [{ x: 0, z: 0 }, { x: 5, z: 0 }], geschosse: [{ level: 0, hoehe_m: 3 }], untergeschosse: 1 });
    assert.deepEqual(hatte, { achseM: true, geschosse: true, untergeschosse: true });
    // removed here again: every cleared field is written
    const patch = programmSchreibPatch({ storeys: 2, storeyHeight: 3, achseM: null, geschosse: null, untergeschosse: 0 }, hatte);
    assert.equal(patch.untergeschosse, 0);
    assert.equal(patch.achseM, null);
    assert.equal(patch.geschosse, null);
  });
  it("ein Fremdstand ohne die Felder setzt keine Merker zurück und keine neuen", () => {
    assert.deepEqual(optionaleFelderNachFremd({ achseM: true, geschosse: false, untergeschosse: true }, { untergeschosse: 0 }),
      { achseM: true, geschosse: false, untergeschosse: true });
    assert.deepEqual(optionaleFelderNachFremd({ achseM: false, geschosse: false, untergeschosse: false }, { untergeschosse: 0 }),
      { achseM: false, geschosse: false, untergeschosse: false });
  });
});

describe("107-13 review: Hüllwand im Eigenschaftsfenster = Export", () => {
  const m = createBuildingModel({ storeys: 2, untergeschosse: 1, wallComposite: "cavity" });
  const live = { composite: "cavity", thickness: 0.39 };
  it("UG-Wand behält ihren eigenen Aufbau (single24, 0,24 m) auch mit dem Fassadenaufbau des Studios", () => {
    const ug = m.walls.find((w) => w.level === -1);
    const panel = huellwandDaten(ug, live);
    assert.deepEqual(panel, huellwandDaten(ug), "Fenster und Export beschreiben dieselbe Wand");
    assert.equal(panel.composite, UG_AUFBAU_STANDARD);
    assert.ok(Math.abs(panel.thickness - 0.24) < 1e-9);
    assert.equal(panel.id, "-1:0");
    assert.equal(panel.huelle, true);
  });
  it("oberirdische Wand: das Fenster zeigt den Live-Aufbau des Studios wie vorher", () => {
    const eg = m.walls.find((w) => w.level === 0);
    const panel = huellwandDaten(eg, { composite: null, thickness: 0.3 });
    assert.equal(panel.composite, undefined);
    assert.equal(panel.thickness, 0.3);
    assert.equal(huellwandDaten(eg).composite, "cavity");
  });
});

describe("107-13 review: eine Ebenenliste für die Editoren, Plan-Klemme, Bodenplatte über den Schlüssel", () => {
  it("ebenenLevels: Modell-Level aufsteigend, ohne Modell 0 … storeys − 1; levelKlemmen = ebeneKlemmen", () => {
    const m = createBuildingModel({ storeys: 3, untergeschosse: 2 });
    assert.deepEqual(ebenenLevels(m, 3), [-2, -1, 0, 1, 2]);
    assert.deepEqual(ebenenLevels(null, 3), [0, 1, 2]);
    assert.deepEqual(ebenenLevels(undefined), [0]);
    for (const l of [-5, -2, -1, 0, 2, 7]) assert.equal(levelKlemmen(ebenenLevels(m, 3), l), ebeneKlemmen(m, l));
    assert.equal(levelKlemmen(ebenenLevels(null, 3), -1), 0, "Rückfall klemmt wie vorher auf ≥ 0");
    assert.equal(levelKlemmen(ebenenLevels(null, 3), 9), 2);
  });
  it("planEbene: ohne UG bleibt Level −1 (Verhalten vor 107-13), oben wird geklemmt; mit UG zwischen −U und oben", () => {
    const ohne = createBuildingModel({ storeys: 2 });
    const mit = createBuildingModel({ storeys: 2, untergeschosse: 1 });
    // the old clamp of BimPlan2D: Math.min(level, storeys.length - 1)
    const alt = (/** @type {any} */ model, /** @type {number} */ level) => Math.min(level, (model?.storeys?.length || 1) - 1);
    for (const l of [-2, -1, 0, 1, 5]) assert.equal(planEbene(ohne, l), alt(ohne, l), `ohne UG Level ${l} wie vorher`);
    assert.equal(planEbene(mit, -3), -1);
    assert.equal(planEbene(mit, -1), -1);
    assert.equal(planEbene(mit, 5), 1);
  });
  it("istBodenplatte erkennt die Bodenplatte auch an einer Kopie der Platten", () => {
    const m = createBuildingModel({ storeys: 2, untergeschosse: 2 });
    const kopie = { ...m, slabs: m.slabs.map((s) => ({ ...s })) };
    const treffer = kopie.slabs.filter((s) => istBodenplatte(kopie, s));
    assert.equal(treffer.length, 1);
    assert.equal(treffer[0].id, "-1");
    assert.equal(m.slabs.filter((s) => istBodenplatte(m, { ...s })).length, 1, "Kopie gegen das Original");
  });
});

describe("107-13 review: IFC listet die Geschosse nach Höhe", () => {
  it("IFCRELAGGREGATES des Gebäudes: 2. UG, 1. UG, EG, 1. OG; ohne UG unverändert in Modellreihenfolge", () => {
    const m = createBuildingModel({ storeys: 2, untergeschosse: 2 });
    const ifc = exportIFC(m, {});
    const st = zeilen(ifc, "IFCBUILDINGSTOREY");
    const ref = (/** @type {string} */ name) => st.find((l) => l.includes(`'${name}'`)).split("=")[0];
    const agg = zeilen(ifc, "IFCRELAGGREGATES").find((l) => st.some((s) => l.includes(`(${s.split("=")[0]},`) || l.includes(`,${s.split("=")[0]})`)));
    assert.ok(agg.trimEnd().endsWith(`(${["2. UG", "1. UG", "EG", "1. OG"].map(ref).join(",")}));`));
    const ohne = exportIFC(createBuildingModel({ storeys: 3 }), {});
    const st0 = zeilen(ohne, "IFCBUILDINGSTOREY").map((l) => l.split("=")[0]);
    assert.ok(zeilen(ohne, "IFCRELAGGREGATES").some((l) => l.trimEnd().endsWith(`(${st0.join(",")}));`)));
  });
});
