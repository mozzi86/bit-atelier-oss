// 108-10: earthworks (cut / fill between the existing ground kept in the Massing sandbox and the new ground) reach the quantity take-off
// as two derived elements of KG 310 — only when both rasters are in the record; otherwise the element list is unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifiedElements } from "@core/lib/bimClassification.js";

const MODELL = { footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 2, storeyHeight: 3 };
const bestand = { nx: 3, ny: 3, zelle: 2, x0: 0, y0: 0, h: new Array(9).fill(0) };
const neu = { ...bestand, h: [0, 0, 0, 0, 1, 0, -0.5, 0, 0] };

describe("108-10 Erdmassen in der Mengenermittlung (KG 310)", () => {
  it("Abtrag und Auftrag als abgeleitete Elemente mit KG 310, Gewerk Erdarbeiten, Menge in m³", () => {
    const els = classifiedElements({ ...MODELL, massing_layer: { koerper: [], gruppen: {}, naechsteId: 1, gelaendeBestand: bestand, gelaende: neu } });
    const erd = els.filter((e) => e.kind === "earthwork");
    assert.deepEqual(erd.map((e) => [e.id, e.kg, e.gewerk, e.status, e.mengen.volume]), [
      ["erdbau-abtrag", "310", "Erdarbeiten", "neubau", 2],
      ["erdbau-auftrag", "310", "Erdarbeiten", "neubau", 4],
    ]);
  });

  it("ohne festgehaltenen Bestand oder ohne neues Gelände: Liste unverändert", () => {
    const ohne = classifiedElements(MODELL);
    assert.deepEqual(classifiedElements({ ...MODELL, massing_layer: { koerper: [], gruppen: {}, naechsteId: 1, gelaende: neu } }), ohne);
    assert.deepEqual(classifiedElements({ ...MODELL, massing_layer: { koerper: [], gruppen: {}, naechsteId: 1, gelaendeBestand: bestand } }), ohne);
    assert.ok(!ohne.some((e) => e.kind === "earthwork"));
  });

  it("Attributtabelle kann die abgeleiteten Erdbau-Elemente übersteuern (z. B. Status)", () => {
    const els = classifiedElements({ ...MODELL, massing_layer: { koerper: [], gruppen: {}, naechsteId: 1, gelaendeBestand: bestand, gelaende: neu },
      bauteil_attribute_layer: { attribute: { "erdbau-abtrag": { status: "bestand" } } } });
    assert.equal(els.find((e) => e.id === "erdbau-abtrag").status, "bestand");
  });
});
