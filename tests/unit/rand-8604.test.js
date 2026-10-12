// 86-04: perimeter block ("Randbebauung") — bars along every edge around a court, corner
// solution (longer bar runs through, shorter abuts), court spacing, own storey count per house,
// byte-identity of the default path, one path for workshop/rehydrate, proposal apply.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tesseliere, randZerlegung, randTiefe, riegelAbstand } from "@designer/lib/tesselierung";
import { inKonvex, flaeche, punktImPolygon } from "@designer/lib/formGeometrie";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { werkstattZonenAusLayer } from "@designer/lib/useWerkstattRehydrate";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { uebernehmeVorschlag, LAYOUT_FELDER } from "@designer/lib/bebauungsvorschlaege";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
const L = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
/** World corners of a bar from the decomposition. */
const ecken = (r) => [{ x: r.rechteck.x0, z: r.rechteck.z0 }, { x: r.rechteck.x1, z: r.rechteck.z0 }, { x: r.rechteck.x1, z: r.rechteck.z1 }, { x: r.rechteck.x0, z: r.rechteck.z1 }]
  .map((p) => ({ x: r.rahmen.ox + r.rahmen.cos * p.x - r.rahmen.sin * p.z, z: r.rahmen.oz + r.rahmen.sin * p.x + r.rahmen.cos * p.z }));
/** Half-planes of a convex polygon (inside n·p ≤ c). */
const hp = (pts) => {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], l = Math.hypot(b.x - a.x, b.z - a.z);
    let nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
    if (nx * (cx - a.x) + nz * (cz - a.z) > 0) { nx = -nx; nz = -nz; }
    return { nx, nz, c: nx * a.x + nz * a.z };
  });
};
const ueberlappung = (a, b) => inKonvex(a, hp(b)).reduce((s, t) => s + flaeche(t), 0);

describe("86-04 — randZerlegung", () => {
  it("Block 60 × 40, MFH: vier Riegel um den Hof, lange laufen durch, kurze stoßen an, keine Überlappung", () => {
    const z = randZerlegung(rect(60, 40), "mfh", { geschosse: 4, geschosshoehe_m: 3 });
    assert.equal(z.art, "rand");
    assert.equal(z.riegel.length, 4);
    const T = randTiefe("mfh");
    assert.equal(T, 12);
    const laengen = z.riegel.map((r) => Math.round(r.rechteck.x1 - r.rechteck.x0)).sort((a, b) => b - a);
    assert.deepEqual(laengen, [60, 60, 16, 16]);
    for (const r of z.riegel) {
      assert.ok(Math.abs(r.rechteck.z1 - r.rechteck.z0 - T) < 1e-9);
      for (const p of ecken(r)) assert.ok(punktImPolygon(rect(60, 40), p.x, p.z) || p.x >= -1e-6 && p.x <= 60 + 1e-6 && p.z >= -1e-6 && p.z <= 40 + 1e-6);
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(ueberlappung(ecken(z.riegel[a]), ecken(z.riegel[b])) < 0.01);
  });

  it("Hof zu schmal: Block 60 × 32 (Lücke 8 m < 9,6 m bei 4 Geschossen) → ein langer Riegel entfällt", () => {
    const z = randZerlegung(rect(60, 32), "mfh", { geschosse: 4, geschosshoehe_m: 3 });
    assert.ok(Math.abs(riegelAbstand(4, 3) - 9.6) < 1e-9);
    assert.ok(z.entfallen.some((e) => e.grund === "Hof zu schmal"));
    assert.equal(z.riegel.filter((r) => Math.round(r.rechteck.x1 - r.rechteck.x0) === 60).length, 1);
  });

  it("EFH und zu kleine Formen: null (normaler Pfad)", () => {
    assert.equal(randZerlegung(rect(60, 40), "efh"), null);
    assert.equal(randZerlegung(rect(10, 8), "mfh"), null);
  });
});

describe("86-04 — tesseliere mit zerlegung: \"rand\"", () => {
  const basis = (fp, extra = {}) => tesseliere({ footprintM: fp, storeys: 4, typ: "mfh", einheiten: STD, raumzonen: true, ...extra });

  it("ohne Option byte-gleich zu \"auto\"", () => {
    for (const fp of [rect(60, 40), L]) assert.deepEqual(basis(fp), basis(fp, { zerlegung: "auto" }));
  });

  it("Block: Hinweis [86-04], Hof als Rest, Rest + belegt = Footprint, kein Schrägen-Zuschlag, WE eindeutig", () => {
    const r = basis(rect(60, 40), { zerlegung: "rand" });
    assert.equal(r.form.art, "rand");
    assert.equal(r.form.riegel.length, 4);
    assert.ok(r.hinweise.some((h) => h.startsWith("Randbebauung [86-04]") && h.includes("Brandwand")));
    assert.equal(r.hinweise.some((h) => h.includes("[86-02]")), false);
    const rest = r.form.rest.reduce((s, p) => s + flaeche(p), 0);
    assert.ok(Math.abs(rest + r.form.belegt_m2 - r.form.gesamt_m2) < 0.05);
    assert.ok(Math.abs(rest - 16 * 16 - 0) < 400, "Hof ≈ 36 × 16 m");
    for (let l = 0; l < 4; l++) {
      const ids = r.weListe.filter((w) => w.level === l).map((w) => w.we);
      assert.equal(ids.length, new Set(ids).size);
    }
    for (const z of r.zonen) for (const p of z.points) assert.ok(p.x >= -1e-6 && p.x <= 60 + 1e-6 && p.z >= -1e-6 && p.z <= 40 + 1e-6, z.name);
  });

  it("eigene Geschosszahl: Riegel 2 mit 6 Geschossen, die anderen 4", () => {
    const r = basis(rect(60, 40), { zerlegung: "rand", geschosseJeRiegel: { 2: 6 } });
    assert.equal(r.form.riegel[1].geschosse, 6);
    assert.equal(r.form.riegel[0].geschosse, undefined);
    const lv5 = r.weListe.filter((w) => w.level === 5);
    assert.ok(lv5.length > 0);
    assert.ok(lv5.every((w) => w.riegel === 2));
    const ohne = basis(rect(60, 40), { zerlegung: "rand" });
    assert.ok(r.rest_m2 > ohne.rest_m2, "über dem niedrigeren Haus ist mehr frei");
    assert.ok(r.hinweise.some((h) => h.includes("eigene Geschosszahl: Riegel 2 6")));
    // Without an entry the bar path stays byte-identical (86-03 shapes too).
    assert.deepEqual(basis(L), basis(L, { geschosseJeRiegel: {} }));
  });

  it("ein Pfad: Rehydrate rechnet die Randbebauung wie die Werkstatt", () => {
    const layer = { ...WERKSTATT_DEFAULT, typ: "mfh", einheiten: STD, zerlegung: "rand", geschosseJeRiegel: { 3: 2 } };
    const s = { footprintM: rect(60, 40), storeys: 4, storeyHeight: 3 };
    const reh = werkstattZonenAusLayer(layer, s);
    const live = tesseliere({ footprintM: s.footprintM, storeys: 4, typ: "mfh", einheiten: layer.einheiten, gesperrteGrenzen: [], raumzonen: true, anordnung: {}, grenzenPositionen: {}, regeln: {}, nordwinkel: 0, tuerAufschlaege: {}, stufeJeWe: {}, raumGrenzen: {}, zerlegung: "rand", geschosseJeRiegel: { 3: 2 }, okf_m: 9, riegelMinFlaeche_m2: 120 }).zonen;
    assert.deepEqual(reh, live);
  });

  it("Layer: Defaults, Vorschlag übernehmen setzt automatisch und verwirft Geschosszahlen", () => {
    assert.equal(WERKSTATT_DEFAULT.zerlegung, "auto");
    assert.deepEqual(WERKSTATT_DEFAULT.geschosseJeRiegel, {});
    assert.ok(LAYOUT_FELDER.includes("geschosseJeRiegel"));
    const { cfg, verworfen } = uebernehmeVorschlag({ typ: "mfh", zerlegung: "rand", geschosseJeRiegel: { 2: 6 } }, { id: "x", typologie: { erschliessung: "mfh" }, parameter: {}, footprintHash: "h" });
    assert.equal(cfg.zerlegung, "auto");
    assert.deepEqual(cfg.geschosseJeRiegel, {});
    assert.equal(verworfen.geschosseJeRiegel, 1);
  });
});
