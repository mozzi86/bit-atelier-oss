// 97-02: decisions on DERIVED elements (workshop walls/doors, synthetic hull) live in ONE table
// keyed by the stable id; classification, AVA quantities and IFC read it. Without the table
// everything stays byte-identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attributPatch, attributeVon, mitAttributen, istAbgeleitet, werkstattMitAttributen } from "@core/lib/bauteil/attribute.js";
import { classifiedElements } from "@core/lib/bimClassification.js";
import { LAYER_VERSION, stempelFuerSave } from "@core/lib/fachlayerSchema.js";
import { createBuildingModel } from "@core/lib/buildingModel";
import { exportIFC } from "@designer/lib/ifcExport";

test("Tabelle: setzen, löschen, leere Einträge verschwinden, fremde Felder ignoriert", () => {
  let l = attributPatch(null, "hull-wall", { status: "bestand", kg: "331", quatsch: 1 });
  assert.deepEqual(l, { attribute: { "hull-wall": { status: "bestand", kg: "331" } } });
  l = attributPatch(l, "hull-wall", { status: null });
  assert.deepEqual(attributeVon(l, "hull-wall"), { kg: "331" });
  l = attributPatch(l, "hull-wall", { kg: "" });
  assert.deepEqual(l.attribute, {});
  assert.ok(istAbgeleitet("wt-wall-ABC") && istAbgeleitet("hull-roof") && !istAbgeleitet("wall-3"));
  const el = { a: 1 };
  assert.equal(mitAttributen(el, null), el);
  assert.equal(mitAttributen(el, {}), el, "kein Eintrag = dasselbe Objekt");
});

test("Layer registriert, Stempel mit Version", () => {
  assert.equal(LAYER_VERSION.bauteil_attribute_layer, 1);
  assert.equal(stempelFuerSave("bauteil_attribute_layer", { attribute: {} }).v, 1);
});

test("classifiedElements: ohne Tabelle byte-gleich, mit Tabelle tragen Hülle und Werkstatt die Entscheidung", () => {
  const m = { footprintM: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }], storeys: 2, storeyHeight: 3 };
  const ohne = classifiedElements(m);
  assert.deepEqual(classifiedElements({ ...m, bauteil_attribute_layer: { attribute: {} } }), ohne);
  const mit = classifiedElements({ ...m, bauteil_attribute_layer: { attribute: { "hull-wall": { status: "Bestand", kg: "331", schicht: ["Klinker"] } } } });
  const hw = mit.find((e) => e.id === "hull-wall");
  assert.equal(hw.status, "bestand", "durch die eine Normalisierung");
  assert.equal(hw.kg, "331"); assert.deepEqual(hw.schicht, ["Klinker"]);
  assert.equal(mit.find((e) => e.id === "hull-roof").status, null, "andere Hüllteile unverändert");
  assert.deepEqual(hw.mengen, ohne.find((e) => e.id === "hull-wall").mengen);
});

test("Werkstatt-Bauteile bekommen ihre Tabellenwerte", () => {
  const wt = { waende: [{ guid: "G1", status: null }], tueren: [{ guid: "T1", status: null }], raeume: [] };
  const l = attributPatch(null, "wt-wall-G1", { status: "abbruch", bauabschnitt: "BA 2" });
  const r = werkstattMitAttributen(wt, l);
  assert.equal(r.waende[0].status, "abbruch"); assert.equal(r.waende[0].bauabschnitt, "BA 2");
  assert.equal(r.tueren[0].status, null);
  assert.equal(werkstattMitAttributen(wt, null), wt);
});

test("IFC: Hüllwand trägt den Tabellen-Status; ohne Tabelle byte-gleich", () => {
  const model = createBuildingModel({ footprintM: null, storeys: 1, storeyHeight: 3 });
  const basis = { steckbrief: { projektId: "p" } };
  assert.equal(exportIFC(model, basis), exportIFC(model, { ...basis, bauteilAttribute: null }));
  const ifc = exportIFC(model, { ...basis, bauteilAttribute: { attribute: { "hull-wall": { status: "bestand" }, "hull-floor": { status: "neubau" } } } });
  assert.ok(ifc.includes("IFCLABEL('bestand')"));
  assert.ok(ifc.includes("IFCLABEL('neubau')"));
});
