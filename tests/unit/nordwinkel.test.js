// Unit-Tests für packages/nova-designer/src/lib/nordwinkel.js (75-06 Task 6,
// D-P75-05): Vorrang Layer > Projekt > 0; 0 gilt als GESETZT; kein NaN nach
// außen. Die Bestandsfelder (raumklima/schallschutz/werkstatt) werden nur
// gelesen — dieser Test prüft die Auflösung, nicht die Persistenz.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { nordwinkelFuer } from "@designer/lib/nordwinkel";

describe("nordwinkelFuer (D-P75-05)", () => {
  it("Layer-Wert gewinnt über den Projektwert", () => {
    assert.deepEqual(nordwinkelFuer({ projekt: 12, layer: 30 }), { winkel: 30, quelle: "layer" });
  });

  it("ohne Layer gilt der Projektwert", () => {
    assert.deepEqual(nordwinkelFuer({ projekt: 12, layer: null }), { winkel: 12, quelle: "projekt" });
    assert.deepEqual(nordwinkelFuer({ projekt: 12 }), { winkel: 12, quelle: "projekt" });
  });

  it("Layer 0 ist GESETZT, nicht leer", () => {
    assert.deepEqual(nordwinkelFuer({ projekt: 12, layer: 0 }), { winkel: 0, quelle: "layer" });
  });

  it("ohne alles → 0/default", () => {
    assert.deepEqual(nordwinkelFuer({}), { winkel: 0, quelle: "default" });
    assert.deepEqual(nordwinkelFuer(), { winkel: 0, quelle: "default" });
  });

  it("Müll-Eingaben ergeben nie NaN", () => {
    assert.deepEqual(nordwinkelFuer({ projekt: "abc" }), { winkel: 0, quelle: "default" });
    assert.deepEqual(nordwinkelFuer({ projekt: 12, layer: "quatsch" }), { winkel: 12, quelle: "projekt" });
    assert.deepEqual(nordwinkelFuer({ projekt: NaN, layer: undefined }), { winkel: 0, quelle: "default" });
  });
});
