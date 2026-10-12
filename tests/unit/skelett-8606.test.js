// 86-06: veins from the skeleton — raster medial axis with depth filter, main vein along a bar,
// corner of an L closed, stability under a small nudge, Strahler order + Murray widths, solver
// path (zerlegung "skelett"), drawn axis as main vein, honest comparison with the automatic mode.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { skelettAdern, SKELETT } from "@designer/lib/skelett";
import { tesseliere, skelettZerlegung } from "@designer/lib/tesselierung";
import { punktImPolygon } from "@designer/lib/formGeometrie";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
const L = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
// T-shape: a 80 × 16 bar with a 16 × 40 stem in the middle (side vein expected).
const TFORM = [{ x: 0, z: 0 }, { x: 80, z: 0 }, { x: 80, z: 16 }, { x: 48, z: 16 }, { x: 48, z: 56 }, { x: 32, z: 56 }, { x: 32, z: 16 }, { x: 0, z: 16 }];
const drinnen = (p, poly) => punktImPolygon(poly, p.x, p.z) || poly.some((a, i) => {
  const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z) < 1e-4;
});

describe("86-06 — skelettAdern", () => {
  it("Rechteck 70 × 16: eine Ader auf der Mittellinie", () => {
    const { adern } = skelettAdern(rect(70, 16), { tiefe_m: 11, minLaenge_m: 11.4 });
    assert.equal(adern.length, 1);
    assert.ok(adern[0].laenge_m >= 50);
    for (const p of adern[0].punkte) assert.ok(Math.abs(p.z - 8) <= 1, `z ${p.z}`);
  });

  it("L: die Diagonale der Innenecke wird zur echten Ecke geschlossen", () => {
    const { adern } = skelettAdern(L, { tiefe_m: 11, minLaenge_m: 11.4 });
    assert.equal(adern.length, 1);
    assert.equal(adern[0].punkte.length, 3);
    const ecke = adern[0].punkte[1];
    assert.ok(Math.hypot(ecke.x - 8, ecke.z - 8) <= 1.5, JSON.stringify(ecke));
  });

  it("deterministisch und stabil: 0,3 m Eckverschiebung ändert die Aderlänge um < 1 m", () => {
    const a = skelettAdern(L, { tiefe_m: 11, minLaenge_m: 11.4 });
    assert.deepEqual(a, skelettAdern(L, { tiefe_m: 11, minLaenge_m: 11.4 }));
    const b = skelettAdern(L.map((p, i) => (i === 1 ? { x: p.x + 0.3, z: p.z } : p)), { tiefe_m: 11, minLaenge_m: 11.4 });
    assert.equal(a.adern.length, b.adern.length);
    assert.ok(Math.abs(a.adern[0].laenge_m - b.adern[0].laenge_m) < 1);
  });

  it("T-Form: Haupt- und Nebenader, Strahler-Ordnung und Murray-Breite", () => {
    const { adern } = skelettAdern(TFORM, { tiefe_m: 11, minLaenge_m: 11.4 });
    assert.ok(adern.length >= 2, `${adern.length} Adern`);
    const kinder = adern.filter((a) => a.eltern !== null);
    assert.ok(kinder.length >= 1);
    for (const k of kinder) {
      const e = adern[k.eltern];
      assert.ok(e.breite_m >= k.breite_m);
      assert.ok(e.ordnung >= k.ordnung);
    }
    const haupt = adern[0];
    const r3 = SKELETT.breiteBlatt_m ** 3 + kinder.filter((k) => k.eltern === 0).reduce((s, k) => s + k.breite_m ** 3, 0);
    assert.ok(Math.abs(haupt.breite_m - Math.min(SKELETT.breiteMax_m, Math.cbrt(r3))) < 0.011, "r³ = r_eigen³ + Σ r_Kind³");
    for (const a of adern) for (const p of a.punkte) assert.ok(drinnen(p, TFORM));
  });

  it("gezeichnete Achse wird Hauptader (Zwangskante), Skelett ergänzt nur Abseitiges", () => {
    const zwang = [{ x: 0, z: 8 }, { x: 80, z: 8 }];
    const { adern } = skelettAdern(TFORM, { tiefe_m: 11, minLaenge_m: 11.4, zwang });
    assert.equal(adern[0].zwang, true);
    assert.deepEqual(adern[0].punkte, zwang);
    assert.ok(adern.slice(1).every((a) => a.punkte.every((p) => p.z > 8 + 5)), "keine zweite Ader auf der Achse");
  });
});

describe("86-06 — tesseliere mit zerlegung \"skelett\"", () => {
  const basis = (fp, extra = {}) => tesseliere({ footprintM: fp, storeys: 4, typ: "mittelflur", einheiten: STD, raumzonen: true, ...extra });

  it("L: Hinweis [86-06], Adern im Ergebnis, ≥ 95 % belegt, alles in der Form, Vergleich mit automatisch", () => {
    const r = basis(L, { zerlegung: "skelett" });
    assert.equal(r.form.art, "skelett");
    assert.ok(Array.isArray(r.form.adern) && r.form.adern.length >= 1);
    assert.ok(r.form.fuellgrad >= 0.95, `${r.form.fuellgrad}`);
    const h = r.hinweise.find((x) => x.startsWith("Adern [86-06]"));
    assert.ok(h && /automatische Zerlegung belegt \d+ %/.test(h) && h.includes("Murray"));
    for (const z of r.zonen) for (const p of z.points) assert.ok(drinnen(p, L), z.name);
  });

  it("Zwangskante über die gezeichnete Achse; ohne Ader → normaler Pfad", () => {
    const z = skelettZerlegung({ footprintM: L, typ: "mittelflur", storeys: 4, achse: [{ x: 48, z: 8 }, { x: 8, z: 8 }, { x: 8, z: 40 }] });
    assert.equal(z.mitNutzerAchse, true);
    assert.equal(z.adern[0].zwang, true);
    // A footprint too small for any vein falls back to the plain kernel result.
    const klein = rect(14, 9);
    assert.deepEqual(basis(klein, { zerlegung: "skelett" }), basis(klein));
  });
});
