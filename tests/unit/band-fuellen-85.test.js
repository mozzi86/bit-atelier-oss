// Unit tests for "Band füllen" (packages/nova-designer/src/lib/tesselierung.js): in
// room-zone mode the catalogue repeats round robin along each band until it is full;
// every apartment is at least WE_MIN_BREITE_M wide; band mode keeps Phase 61.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, fuelleBand, verteileBand, WE_MIN_BREITE_M } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const leer = (r) => r.rest_m2 - (r.restNachfrage_m2 || 0);

describe("85 — fuelleBand", () => {
  const A = { key: "a" }, B = { key: "b" }, C = { key: "c" };
  const K = [{ ziel: 5, min: 4, max: 6 }, { ziel: 8, min: 7, max: 9 }, { ziel: 12, min: 11, max: 13 }];

  it("Katalog passt einmal mit Luft → reihum wiederholt, solange die Mindestbreite in den Rest passt", () => {
    const out = fuelleBand([A, B, C], K, 40);
    assert.deepEqual(out.slice(0, 3), [A, B, C], "Katalog zuerst in Bandreihenfolge");
    assert.deepEqual(out.map((e) => e.key), ["a", "b", "c", "a", "b"]);
    const ks = out.map((e) => K[[A, B, C].indexOf(e)]);
    assert.ok(ks.reduce((s, k) => s + k.min, 0) <= 40);
    assert.ok(Math.abs(verteileBand(40, ks).rest) < 1e-6, "Band voll");
  });

  it("zu großer Typ wird übersprungen, kleinere füllen weiter (statt Überlauf + Leerfläche)", () => {
    const out = fuelleBand([A, B, C], K, 20);
    assert.ok(!out.includes(C) || out.length === 1);
    assert.deepEqual(out.map((e) => e.key), ["a", "b", "a"]);
  });

  it("zweite Stufe: Rest trotz Maximalbreiten → noch eine Einheit, wenn alle Mindestbreiten passen", () => {
    const enge = [{ ziel: 10, min: 9.5, max: 10.5 }];
    // 30 m: three at target (30) — no stage 2. 31 m: max 31,5 ≥ 31 → still three.
    assert.equal(fuelleBand([A], enge, 31).length, 3);
    // 38 m: 3 × max 31,5 < 38, four minimums 38 ≤ 38 → four.
    assert.equal(fuelleBand([A], enge, 38).length, 4);
  });

  it("leere/ungültige Eingaben brechen nicht", () => {
    assert.deepEqual(fuelleBand([], [], 10), []);
    assert.deepEqual(fuelleBand([A], [{ ziel: 20, min: 18, max: 22 }], 10), [], "nichts passt → leer");
  });
});

describe("85 — tesseliere füllt die Bänder (Raumzonen-Modus)", () => {
  it("Standard-Mix: Mittelflur 70 × 16 und Laubengang 40 × 12 ohne Leerfläche, deutlich mehr WE als ein Katalog je Band", () => {
    const m = tesseliere({ footprintM: rect(70, 16), storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true });
    assert.ok(leer(m) < 5, `leer ${leer(m)}`);
    assert.ok(m.weListe.filter((w) => w.level === 0).length >= 14);
    const l = tesseliere({ footprintM: rect(40, 12), storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true });
    assert.ok(leer(l) < 10, `leer ${leer(l)}`);
    assert.ok(l.weListe.length >= 6);
  });

  it("MFH 70 × 16: EG und OG gleich voll (Befund 84-07: EG hatte 3–4 WE mehr)", () => {
    for (const E of [STD, REF]) {
      const r = tesseliere({ footprintM: rect(70, 16), storeys: 3, typ: "mfh", einheiten: E, raumzonen: true });
      const je = [0, 1, 2].map((l) => r.weListe.filter((w) => w.level === l).length);
      assert.ok(Math.abs(je[0] - je[1]) <= 1, je.join("/"));
      assert.equal(je[1], je[2], je.join("/"));
    }
  });

  it("Zimmer-Mindestbreiten begrenzen das Stauchen: Testhaus-Typen im Mittelflur ohne zusammengelegte Fensterräume", () => {
    const r = tesseliere({ footprintM: rect(70, 16), storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true });
    assert.ok(!r.hinweise.concat(r.raumWarns || []).some((h) => /zusammengelegt/.test(h)), r.hinweise.filter((h) => /zusammengelegt/.test(h)).slice(0, 2).join(" | "));
  });

  it("jede Wohnung ist mindestens WE_MIN_BREITE_M breit (tiefer Laubengang 40 × 16)", () => {
    const r = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true });
    assert.ok(r.weListe.every((w) => w.fassadeLaenge_m >= WE_MIN_BREITE_M - 1e-9), r.weListe.map((w) => w.fassadeLaenge_m.toFixed(2)).join(" "));
  });

  it("Band-Modus bleibt Phase 61: Katalog einmal je Band", () => {
    const r = tesseliere({ footprintM: rect(70, 16), storeys: 1, typ: "mittelflur", einheiten: STD });
    assert.equal(r.weListe.length, 2 * STD.length);
  });
});
