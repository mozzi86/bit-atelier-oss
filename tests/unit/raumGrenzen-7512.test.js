// 75-12: interior walls moved in the focus (werkstatt_layer.raumGrenzen) — key, detection,
// grid + clamping, constant unit area, doors kept in place, byte-identity without entries,
// one path for workshop and rehydrate, bar (86-03) key translation, missing-wall hint.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import {
  raumGrenzeSchluessel, innenwaende, wendeRaumGrenzenAn, rasterKlemmen, raumGrenzenFehlend,
  RAUMGRENZE_RASTER_M, RAUMGRENZE_MIN_BREITE_M,
} from "@designer/lib/raumGrenzen";
import { werkstattZonenAusLayer } from "@designer/lib/useWerkstattRehydrate";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { LAYOUT_FELDER, uebernehmeVorschlag } from "@designer/lib/bebauungsvorschlaege";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const L = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const basis = (fp, extra = {}) => tesseliere({ footprintM: fp, storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true, ...extra });
const summe = (zonen, we, level) => zonen.filter((z) => z.we === we && z.level === level).reduce((s, z) => s + z.flaeche_m2, 0);
const zone = (zonen, name, level) => zonen.find((z) => z.name === name && z.level === level);

describe("75-12 — raumGrenzen (Lib)", () => {
  it("Schlüssel ist unabhängig von der Reihenfolge der Räume", () => {
    assert.equal(raumGrenzeSchluessel(0, "Schlafen (WE 0-1) ·WT", "Bad (WE 0-1) ·WT"), "0|Bad (WE 0-1) ·WT|Schlafen (WE 0-1) ·WT");
    assert.equal(raumGrenzeSchluessel(0, "Bad (WE 0-1) ·WT", "Schlafen (WE 0-1) ·WT"), raumGrenzeSchluessel(0, "Schlafen (WE 0-1) ·WT", "Bad (WE 0-1) ·WT"));
  });

  it("findet nur Wände zwischen Rechteck-Räumen derselben WE und desselben Geschosses", () => {
    const r = basis(rect(70, 16));
    const w = innenwaende(r.zonen);
    assert.ok(w.length > 10);
    for (const x of w) {
      const a = zone(r.zonen, x.a, x.level), b = zone(r.zonen, x.b, x.level);
      assert.equal(a.we, b.we);
      assert.notEqual(a.raumart, "flur");
      assert.notEqual(b.raumart, "flur");
      assert.ok(x.spielraumMinus >= 0 && x.spielraumPlus >= 0);
      assert.ok(Math.abs(Math.hypot(x.n.x, x.n.z) - 1) < 1e-9);
    }
  });

  it("Raster 12,5 cm und Klemmung zur Null hin", () => {
    assert.equal(RAUMGRENZE_RASTER_M, 0.125);
    assert.equal(rasterKlemmen(0.3, 1, 1), 0.25);
    assert.equal(rasterKlemmen(0.33, 1, 1), 0.375);
    assert.equal(rasterKlemmen(2, 1, 0.8), 0.75);
    assert.equal(rasterKlemmen(-2, 0.3, 1), -0.25);
    assert.equal(rasterKlemmen(0.04, 1, 1), 0);
  });

  it("ohne Eintrag: dieselbe Array-Referenz (byte-gleich)", () => {
    const z = basis(rect(70, 16)).zonen;
    assert.equal(wendeRaumGrenzenAn(z, null).zonen, z);
    assert.equal(wendeRaumGrenzenAn(z, {}).zonen, z);
    assert.equal(wendeRaumGrenzenAn(z, { "0|a|b": 0 }).zonen, z);
  });
});

describe("75-12 — tesseliere mit raumGrenzen", () => {
  for (const [name, fp] of [["Rechteck", rect(70, 16)], ["L (Riegel)", L], ["gedreht", rect(40, 16).map((p) => ({ x: 0.92 * p.x - 0.39 * p.z, z: 0.39 * p.x + 0.92 * p.z }))]]) {
    it(`${name}: Wand verschoben, WE-Fläche konstant, Raster, alle anderen Zonen gleich`, () => {
      const r0 = basis(fp);
      const w = innenwaende(r0.zonen).find((x) => x.spielraumPlus >= 0.5);
      assert.ok(w, "eine Wand mit Spielraum");
      const r1 = basis(fp, { raumGrenzen: { [w.key]: 0.5 } });
      assert.equal(r1.zonen.length, r0.zonen.length);
      assert.ok(Math.abs(summe(r1.zonen, w.we, w.level) - summe(r0.zonen, w.we, w.level)) < 1e-6);
      const a0 = zone(r0.zonen, w.a, w.level), a1 = zone(r1.zonen, w.a, w.level);
      const wandLaenge = Math.hypot(w.p1.x - w.p0.x, w.p1.z - w.p0.z);
      assert.ok(Math.abs(a1.flaeche_m2 - a0.flaeche_m2 - 0.5 * wandLaenge) < 1e-6);
      const w1 = innenwaende(r1.zonen).find((x) => x.key === w.key);
      assert.ok(Math.abs(w1.breiteA - w.breiteA - 0.5) < 1e-6);
      // Every zone other than the two rooms is unchanged (points + doors).
      for (const z of r0.zonen) {
        if ((z.name === w.a || z.name === w.b) && z.level === w.level) continue;
        const q = r1.zonen.find((x) => x.name === z.name && x.level === z.level);
        assert.deepEqual(q.points, z.points, z.name);
      }
      assert.equal(r1.hinweise.filter((h) => h.includes("[75-12]")).length, 0);
    });
  }

  it("Klemmung: Wunsch über den Spielraum → Hinweis, Raum bleibt ≥ Mindestbreite", () => {
    const r0 = basis(rect(70, 16));
    const w = innenwaende(r0.zonen)[0];
    const r1 = basis(rect(70, 16), { raumGrenzen: { [w.key]: 50 } });
    const w1 = innenwaende(r1.zonen).find((x) => x.key === w.key);
    assert.ok(w1.breiteB >= RAUMGRENZE_MIN_BREITE_M - 1e-9);
    assert.ok(r1.hinweise.some((h) => h.includes("[75-12]") && h.includes("nicht möglich")));
  });

  it("Türen halten ihre Weltposition und bleiben in der Wand", () => {
    const r0 = basis(L);
    for (const w of innenwaende(r0.zonen).slice(0, 12)) {
      const d = rasterKlemmen(0.5, w.spielraumMinus, w.spielraumPlus);
      const r1 = basis(L, { raumGrenzen: { [w.key]: d } });
      for (const name of [w.a, w.b]) {
        const z = zone(r1.zonen, name, w.level);
        for (const t of z.tueren || []) {
          const a = z.points[t.wand], b = z.points[(t.wand + 1) % 4];
          const l = Math.hypot(b.x - a.x, b.z - a.z);
          assert.ok(t.u_m >= -1e-9 && t.u_m + t.breite_m <= l + 1e-6, `${name}: Tür in der Wand`);
        }
      }
    }
  });

  it("verwaister Eintrag → genau ein Hinweis, nichts verschoben (auch im Riegel-Pfad)", () => {
    for (const fp of [rect(70, 16), L]) {
      const r0 = basis(fp);
      const r1 = basis(fp, { raumGrenzen: { "0|Nix (WE 0-99) ·WT|Zz (WE 0-99) ·WT": 1 } });
      assert.equal(r1.hinweise.filter((h) => h.includes("[75-12]")).length, 1);
      assert.deepEqual(r1.zonen.map((z) => z.points), r0.zonen.map((z) => z.points));
    }
    assert.deepEqual(raumGrenzenFehlend(basis(rect(70, 16)).zonen, { "0|x|y": 0.5 }).length, 1);
  });

  it("Riegel-Pfad: Wand im zweiten Riegel wird über die globale WE-Nummer getroffen", () => {
    const r0 = basis(L);
    assert.ok((r0.form?.riegel?.length ?? 1) > 1, "L zerfällt in Riegel");
    const zweiter = r0.weListe.find((x) => x.riegel === 2);
    const w = innenwaende(r0.zonen).find((x) => x.we === zweiter.we && Math.max(x.spielraumPlus, x.spielraumMinus) >= 0.125);
    assert.ok(w);
    const d = w.spielraumPlus >= 0.125 ? 0.125 : -0.125;
    const r1 = basis(L, { raumGrenzen: { [w.key]: d } });
    const w1 = innenwaende(r1.zonen).find((x) => x.key === w.key);
    assert.ok(Math.abs(w1.breiteA - w.breiteA - d) < 1e-6);
    assert.equal(r1.hinweise.filter((h) => h.includes("[75-12]")).length, 0);
  });

  it("ein Pfad: Rehydrate liefert dieselben Zonen wie die Werkstatt", () => {
    const r0 = basis(rect(70, 16));
    const w = innenwaende(r0.zonen)[3];
    const layer = { ...WERKSTATT_DEFAULT, typ: "mittelflur", einheiten: STD, raumGrenzen: { [w.key]: 0.375 } };
    const s = { footprintM: rect(70, 16), storeys: 2, storeyHeight: 3 };
    const reh = werkstattZonenAusLayer(layer, s);
    const live = tesseliere({ footprintM: s.footprintM, storeys: 2, typ: "mittelflur", einheiten: layer.einheiten, gesperrteGrenzen: [], raumzonen: true, anordnung: {}, grenzenPositionen: {}, regeln: {}, nordwinkel: 0, tuerAufschlaege: {}, stufeJeWe: {}, raumGrenzen: layer.raumGrenzen, okf_m: 3, riegelMinFlaeche_m2: 120 }).zonen;
    assert.deepEqual(reh, live);
    assert.notDeepEqual(reh, werkstattZonenAusLayer({ ...layer, raumGrenzen: {} }, s));
  });

  it("Layer: Default {} und Vorschlag übernehmen verwirft die Versätze", () => {
    assert.deepEqual(WERKSTATT_DEFAULT.raumGrenzen, {});
    assert.ok(LAYOUT_FELDER.includes("raumGrenzen"));
    const { cfg, verworfen } = uebernehmeVorschlag({ typ: "mittelflur", raumGrenzen: { "0|a|b": 0.25 } }, { id: "x", typologie: { erschliessung: "mfh" }, parameter: {}, footprintHash: "h" });
    assert.deepEqual(cfg.raumGrenzen, {});
    assert.equal(verworfen.raumGrenzen, 1);
  });
});
