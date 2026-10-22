// IFC import reads the project units (gap found 21.10.2026): BaseQuantities and layer thicknesses
// are converted to m / m² / m³. The sample project is in metres (factor 1, values unchanged); a
// proxied web-ifc API that reports MILLI METRE / MILLI SQUARE_METRE / MILLI CUBIC_METRE must scale
// lengths by 1e-3, areas by 1e-6 and volumes by 1e-9.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractFromModel, einheitenAusModell } from "@ifc/lib/ifcImport.js";

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, "../..");
const IFC = path.join(REPO, "public/beispiel/musterprojekt.ifc");

let WebIFC, api, modelID;

before(async () => {
  WebIFC = require("web-ifc");
  api = new WebIFC.IfcAPI();
  await api.Init();
  modelID = api.OpenModel(new Uint8Array(fs.readFileSync(IFC)), { COORDINATE_TO_ORIGIN: true });
});

/** web-ifc API whose IfcSIUnit lines for length/area/volume carry the prefix MILLI. */
function apiInMillimeter() {
  return new Proxy(api, {
    get(ziel, prop) {
      if (prop === "GetLine") {
        return (mid, id, ...rest) => {
          const line = ziel.GetLine(mid, id, ...rest);
          const typ = line?.UnitType?.value ?? line?.UnitType;
          if (line && line.ConversionFactor == null && ["LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT"].includes(typ) && "Prefix" in line) {
            return { ...line, Prefix: { type: 3, value: "MILLI" } };
          }
          return line;
        };
      }
      const v = ziel[prop];
      return typeof v === "function" ? v.bind(ziel) : v;
    },
  });
}

const summe = (meta, key) => meta.elements.reduce((s, e) => s + (Number(e.qty[key]) || 0), 0);

describe("IFC-Import — Projekteinheiten", () => {
  it("Musterprojekt in Metern: Faktoren 1, keine Einheiten-Warnung", () => {
    const e = einheitenAusModell(api, modelID);
    assert.deepEqual([e.laenge, e.flaeche, e.volumen], [1, 1, 1]);
    const meta = extractFromModel(api, modelID);
    assert.deepEqual(meta.kennzahlen.einheiten.laenge, 1);
    assert.ok(!meta.warnungen.some((w) => /Projekteinheiten/.test(w)));
  });

  it("Millimeter-Datei: Länge × 1e-3, Fläche × 1e-6, Volumen × 1e-9, mit Warnung", () => {
    const mm = apiInMillimeter();
    const e = einheitenAusModell(mm, modelID);
    assert.equal(e.laenge, 1e-3);
    assert.ok(Math.abs(e.flaeche - 1e-6) < 1e-18);
    assert.ok(Math.abs(e.volumen - 1e-9) < 1e-21);
    const heil = extractFromModel(api, modelID);
    const meta = extractFromModel(mm, modelID);
    for (const [key, f] of [["Length", 1e-3], ["NetSideArea", 1e-6], ["NetVolume", 1e-9]]) {
      const a = summe(heil, key);
      if (a === 0) continue; // key not present in the sample project
      // values are rounded to 4 decimals per element, so compare with a tolerance per element
      assert.ok(Math.abs(summe(meta, key) - a * f) <= meta.elements.length * 5e-5, `${key}: ${summe(meta, key)} vs ${a * f}`);
    }
    assert.ok(meta.warnungen.some((w) => /Projekteinheiten der Datei: Länge MILLI METRE/.test(w)), meta.warnungen.join("\n"));
  });
});
