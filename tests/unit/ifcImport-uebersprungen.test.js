// 87-02: the semantic IFC import must COUNT what it skips. Before, every defective
// relation / property / quantity vanished in an empty catch — the takeoff showed a
// smaller sum and nobody saw a hint. Here web-ifc is wrapped so that one
// IfcQuantityArea line throws; the counters must show it, the rest must still import.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractFromModel } from "@ifc/lib/ifcImport.js";

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, "../..");
const IFC = path.join(REPO, "public/beispiel/musterprojekt.ifc");

let WebIFC, api, modelID;

before(async () => {
  WebIFC = require("web-ifc");
  api = new WebIFC.IfcAPI();
  await api.Init();
  modelID = api.OpenModel(new Uint8Array(fs.readFileSync(IFC)), { COORDINATE_TO_ORIGIN: true });
  assert.ok(modelID >= 0, "web-ifc konnte das Musterprojekt nicht öffnen");
});

/** The api with GetLine throwing for the given express ids (everything else passes through). */
function apiMitDefekt(defekt) {
  return new Proxy(api, {
    get(ziel, prop) {
      if (prop === "GetLine") {
        return (mid, id, ...rest) => {
          if (defekt.has(id)) throw new Error(`Testdefekt an #${id}`);
          return ziel.GetLine(mid, id, ...rest);
        };
      }
      const v = ziel[prop];
      return typeof v === "function" ? v.bind(ziel) : v;
    },
  });
}

describe("87-02 — IFC-Import zählt Übersprungenes", () => {
  it("intaktes Modell: Zähler sind 0 und stehen in den Kennzahlen", () => {
    const meta = extractFromModel(api, modelID);
    const u = meta.kennzahlen.uebersprungen;
    assert.ok(u, "kennzahlen.uebersprungen fehlt");
    assert.deepEqual({ ...u, beispiele: [] }, { relationen: 0, properties: 0, quantities: 0, definitionen: 0, elemente: 0, sonstige: 0, gesamt: 0, beispiele: [] });
    assert.equal(u.beispiele.length, 0);
    assert.equal(u.gesamt, 0);
  });

  it("eine defekte Quantity: wird gezählt, mit Beispiel, der Rest importiert weiter", () => {
    const flaechen = [];
    const v = api.GetLineIDsWithType(modelID, WebIFC.IFCQUANTITYAREA);
    for (let i = 0; i < v.size(); i += 1) flaechen.push(v.get(i));
    assert.ok(flaechen.length > 0, "Musterprojekt hat IfcQuantityArea");
    const kaputt = apiMitDefekt(new Set([flaechen[0]]));
    const heil = extractFromModel(api, modelID);
    const meta = extractFromModel(kaputt, modelID);
    const u = meta.kennzahlen.uebersprungen;
    assert.equal(u.quantities, 1, "genau eine Quantity übersprungen");
    assert.equal(u.gesamt, 1);
    assert.ok(u.beispiele.some((b) => b.id === flaechen[0] && /Quantity/.test(b.art)), JSON.stringify(u.beispiele));
    assert.equal(meta.elements.length, heil.elements.length, "alle Bauteile weiterhin da");
    // One element lost one quantity key — the sums WOULD be smaller; that is what the counter is for.
    const keysHeil = heil.elements.reduce((s, e) => s + Object.keys(e.qty).length, 0);
    const keysKaputt = meta.elements.reduce((s, e) => s + Object.keys(e.qty).length, 0);
    assert.equal(keysHeil - keysKaputt, 1, "eine Mengenangabe fehlt");
    assert.ok(meta.warnungen.some((w) => /übersprungen/.test(w)), "Warnung im Import");
  });

  it("eine defekte Relation: gezählt, Beispiele bleiben bei höchstens fünf", () => {
    const rels = [];
    const v = api.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < v.size(); i += 1) rels.push(v.get(i));
    assert.ok(rels.length > 0);
    const meta = extractFromModel(apiMitDefekt(new Set(rels)), modelID);
    const u = meta.kennzahlen.uebersprungen;
    assert.ok(u.relationen >= rels.length, `${u.relationen} Relationen`);
    assert.ok(u.beispiele.length <= 5);
  });
});
