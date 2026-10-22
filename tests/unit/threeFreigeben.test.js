// LO-02: multi-material meshes and material textures are released (dispose counted on fakes).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { materialFreigeben, objektFreigeben } from "@core/lib/threeFreigeben";

const zaehler = () => { const z = { n: 0 }; return { z, d: { dispose: () => { z.n += 1; } } }; };

describe("threeFreigeben", () => {
  it("Material-Array: jedes Material und seine Texturen werden freigegeben", () => {
    const a = zaehler(), b = zaehler(), tex = zaehler();
    materialFreigeben([{ ...a.d, map: tex.d }, b.d]);
    assert.equal(a.z.n, 1);
    assert.equal(b.z.n, 1);
    assert.equal(tex.z.n, 1);
  });

  it("Objekt: Geometrie + Material; null und fehlende Felder werfen nicht", () => {
    const g = zaehler(), m = zaehler();
    objektFreigeben({ geometry: g.d, material: m.d });
    assert.equal(g.z.n + m.z.n, 2);
    assert.doesNotThrow(() => { objektFreigeben(null); objektFreigeben({}); materialFreigeben(null); materialFreigeben([null]); });
  });
});
