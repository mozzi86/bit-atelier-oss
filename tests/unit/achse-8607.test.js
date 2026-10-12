// 86-07: bars along a drawn centre line — polyline guard, segment bars centred on the axis
// (deepest fitting typology depth), corner solution, spacing between parallel bars, solver path
// (zerlegung "achse"), one path for workshop/rehydrate, default byte-identical.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tesseliere, achsZerlegung, achseBereinigt, riegelAbstand } from "@designer/lib/tesselierung";
import { flaeche, punktImPolygon, inKonvex } from "@designer/lib/formGeometrie";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { werkstattZonenAusLayer } from "@designer/lib/useWerkstattRehydrate";
import { WERKSTATT_DEFAULT, zerlegungsArt } from "@designer/lib/werkstattDefaults";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
const L = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const ACHSE_L = [{ x: 48, z: 8 }, { x: 8, z: 8 }, { x: 8, z: 40 }];
const ecken = (r) => [{ x: r.rechteck.x0, z: r.rechteck.z0 }, { x: r.rechteck.x1, z: r.rechteck.z0 }, { x: r.rechteck.x1, z: r.rechteck.z1 }, { x: r.rechteck.x0, z: r.rechteck.z1 }]
  .map((p) => ({ x: r.rahmen.ox + r.rahmen.cos * p.x - r.rahmen.sin * p.z, z: r.rahmen.oz + r.rahmen.sin * p.x + r.rahmen.cos * p.z }));
const hp = (pts) => {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], l = Math.hypot(b.x - a.x, b.z - a.z);
    let nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
    if (nx * (cx - a.x) + nz * (cz - a.z) > 0) { nx = -nx; nz = -nz; }
    return { nx, nz, c: nx * a.x + nz * a.z };
  });
};
const drinnen = (p, poly) => punktImPolygon(poly, p.x, p.z) || poly.some((a, i) => {
  const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z) < 1e-4;
});

describe("86-07 — Achse (Lib)", () => {
  it("achseBereinigt: ≥ 2 Punkte, Punkte < 1 m Abstand fallen weg, Unsinn → null", () => {
    assert.equal(achseBereinigt(null), null);
    assert.equal(achseBereinigt([{ x: 0, z: 0 }]), null);
    assert.equal(achseBereinigt([{ x: 0, z: 0 }, { x: 0.5, z: 0 }]), null);
    assert.deepEqual(achseBereinigt([{ x: 0, z: 0 }, { x: 0.5, z: 0 }, { x: "x", z: 1 }, { x: 10, z: 0 }]), [{ x: 0, z: 0 }, { x: 10, z: 0 }]);
  });

  it("L-Achse im L: zwei Riegel mittig auf der Achse, der längere läuft durch die Ecke, keine Überlappung", () => {
    const z = achsZerlegung(L, "mittelflur", [ACHSE_L], { geschosse: 4 });
    assert.equal(z.art, "achse");
    assert.equal(z.riegel.length, 2);
    assert.deepEqual(z.abschnitte.map((a) => [a.laenge_m, a.tiefe_m]), [[48, 16], [24, 16]]);
    for (const r of z.riegel) for (const p of ecken(r)) assert.ok(drinnen(p, L), "Riegel in der Form");
    const ueber = inKonvex(ecken(z.riegel[0]), hp(ecken(z.riegel[1]))).reduce((s, t) => s + flaeche(t), 0);
    assert.ok(ueber < 0.01);
  });

  it("gerade Achse im Rechteck: ein Riegel über die ganze Länge", () => {
    const z = achsZerlegung(rect(70, 16), "mittelflur", [[{ x: 0, z: 8 }, { x: 70, z: 8 }]], { geschosse: 4 });
    assert.equal(z.riegel.length, 1);
    assert.equal(z.abschnitte[0].laenge_m, 70);
    assert.equal(z.abschnitte[0].tiefe_m, 16);
  });

  it("zwei parallele Achsen zu dicht: der zweite Riegel entfällt (Abstandsregel)", () => {
    const z = achsZerlegung(rect(70, 40), "mfh", [[{ x: 0, z: 10 }, { x: 70, z: 10 }], [{ x: 0, z: 30 }, { x: 70, z: 30 }]], { geschosse: 4, geschosshoehe_m: 3 });
    assert.ok(riegelAbstand(4, 3) > 20 - 16, "Lücke 20 − 16 = 4 m < Abstand");
    assert.equal(z.riegel.length, 1);
    assert.ok(z.entfallen.some((e) => e.grund === "Abstand zum Nachbarriegel"));
  });
});

describe("86-07 — tesseliere mit zerlegung \"achse\"", () => {
  const basis = (fp, extra = {}) => tesseliere({ footprintM: fp, storeys: 4, typ: "mittelflur", einheiten: STD, raumzonen: true, ...extra });

  it("ohne Achse oder ohne Option: wie automatisch (byte-gleich)", () => {
    assert.deepEqual(basis(L, { zerlegung: "achse" }), basis(L));
    assert.deepEqual(basis(L, { achse: ACHSE_L }), basis(L));
  });

  it("mit Achse: Hinweis [86-07], form.art, alles in der Form, Rest + belegt = Footprint", () => {
    const r = basis(L, { zerlegung: "achse", achse: ACHSE_L });
    assert.equal(r.form.art, "achse");
    assert.ok(r.hinweise.some((h) => h.startsWith("Achse [86-07]: 2 Riegel")));
    for (const z of r.zonen) for (const p of z.points) assert.ok(drinnen(p, L), z.name);
    const rest = r.form.rest.reduce((s, p) => s + flaeche(p), 0);
    assert.ok(Math.abs(rest + r.form.belegt_m2 - r.form.gesamt_m2) < 0.05);
  });

  it("ein Pfad: Rehydrate liest die Achse aus dem Bauprogramm", () => {
    const layer = { ...WERKSTATT_DEFAULT, typ: "mittelflur", einheiten: STD, zerlegung: "achse" };
    const s = { footprintM: L, storeys: 4, storeyHeight: 3, achseM: ACHSE_L };
    const live = tesseliere({ footprintM: L, storeys: 4, typ: "mittelflur", einheiten: STD, gesperrteGrenzen: [], raumzonen: true, anordnung: {}, grenzenPositionen: {}, regeln: {}, nordwinkel: 0, tuerAufschlaege: {}, stufeJeWe: {}, raumGrenzen: {}, zerlegung: "achse", geschosseJeRiegel: {}, achse: ACHSE_L, okf_m: 9, riegelMinFlaeche_m2: 120 }).zonen;
    assert.deepEqual(werkstattZonenAusLayer(layer, s), live);
    assert.equal(zerlegungsArt("achse"), "achse");
    assert.equal(zerlegungsArt("quatsch"), "auto");
  });
});
