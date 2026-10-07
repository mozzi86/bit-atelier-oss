// Unit tests for packages/nova-designer/src/lib/rettungsweg.js (75-13 Task 1) and
// its integration in tesselierung.js: the escape route as a WALKED line from the
// deepest corner to the stair door (MBO §35 Abs. 2 [CITED], 35 m) instead of the
// 75-07 Manhattan sum to the core centre.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KNOTEN_VERSATZ_M, punktInPolygon, sichtbar, eckKnoten, lauflaenge, tiefsterPunkt, rettungsweg,
} from "@designer/lib/rettungsweg";
import { tesseliere, RETTUNGSWEG_MAX } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const FP30 = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rechteck = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** Longest rettungsweg_m of storey 0. */
const maxLauf = (r) => Math.max(...r.weListe.filter((w) => w.level === 0).map((w) => w.rettungsweg_m));

describe("rettungsweg.js — Geometrie", () => {
  it("Rechteckraum ohne Hindernis: Lauflinie = Luftlinie (3-4-5-Dreieck = 5 m), Pfad aus 2 Punkten", () => {
    const r = lauflaenge({ x: 0, z: 0 }, { x: 3, z: 4 }, []);
    assert.ok(Math.abs(r.laenge_m - 5) < 1e-9, `Länge ${r.laenge_m}`);
    assert.equal(r.pfad.length, 2);
  });

  it("Hindernis zwischen Start und Ziel erzwingt den Umweg um die Ecken (Handrechnung ≈ 12,06 m statt 10 m)", () => {
    // Wand 4…6 × −3…3 zwischen (0,0) und (10,0): Umweg über (4,3) und (6,3) = 5 + 2 + 5 → 12 m,
    // plus 5 cm Eckversatz nach außen → 12,06 m.
    const wand = [rechteck(4, -3, 6, 3)];
    const r = lauflaenge({ x: 0, z: 0 }, { x: 10, z: 0 }, wand);
    assert.ok(r.laenge_m > 10 + 1, `Länge ${r.laenge_m} nicht länger als Luftlinie`);
    assert.ok(Math.abs(r.laenge_m - 12) < 0.1, `Länge ${r.laenge_m}`);
    assert.equal(r.pfad.length, 4, "Start, zwei Ecken, Ziel");
    // Jede Teilstrecke des Pfades ist frei von Hindernissen.
    for (let i = 0; i + 1 < r.pfad.length; i++) assert.ok(sichtbar(r.pfad[i], r.pfad[i + 1], wand), `Teilstrecke ${i} schneidet das Hindernis`);
  });

  it("Lauflänge ist symmetrisch (Start ↔ Ziel)", () => {
    const wand = [rechteck(4, -3, 6, 3)];
    const ab = lauflaenge({ x: 0, z: 1 }, { x: 10, z: -1 }, wand).laenge_m;
    const ba = lauflaenge({ x: 10, z: -1 }, { x: 0, z: 1 }, wand).laenge_m;
    assert.ok(Math.abs(ab - ba) < 1e-9);
  });

  it("tiefster Punkt ist eine Ecke, nicht die Raummitte: 4 × 4 m, Tür Mitte Unterkante → Ecke 4,47 m statt Mitte 2 m", () => {
    const ecken = rechteck(0, 0, 4, 4);
    const t = tiefsterPunkt(ecken, { x: 2, z: 0 }, []);
    assert.ok(Math.abs(t.laenge_m - Math.hypot(2, 4)) < 1e-9, `Länge ${t.laenge_m}`);
    assert.equal(t.punkt.z, 4, "gegenüberliegende Ecke");
    const mitte = lauflaenge({ x: 2, z: 2 }, { x: 2, z: 0 }, []).laenge_m;
    assert.ok(t.laenge_m > mitte);
  });

  it("Berühren einer Hindernis-Kante ist kein Durchqueren; Strecke durch die Fläche ist blockiert", () => {
    const wand = [rechteck(0, 0, 4, 4)];
    assert.equal(sichtbar({ x: 0, z: -1 }, { x: 4, z: -1 }, wand), true, "parallel außen");
    assert.equal(sichtbar({ x: -1, z: 0 }, { x: 5, z: 0 }, wand), true, "entlang der Wandkante");
    assert.equal(sichtbar({ x: -1, z: 2 }, { x: 5, z: 2 }, wand), false, "mitten hindurch");
    assert.equal(sichtbar({ x: 0, z: 0 }, { x: 4, z: 4 }, wand), false, "Diagonale Ecke zu Ecke");
  });

  it("punktInPolygon: Rand zählt als außen, Eckknoten liegen um den Versatz außerhalb des Hindernisses", () => {
    const p = rechteck(0, 0, 4, 4);
    assert.equal(punktInPolygon({ x: 2, z: 2 }, p), true);
    assert.equal(punktInPolygon({ x: 4, z: 2 }, p), false, "auf der Kante");
    assert.equal(punktInPolygon({ x: 5, z: 2 }, p), false);
    const knoten = eckKnoten([p]);
    assert.equal(knoten.length, 4);
    for (const k of knoten) {
      assert.equal(punktInPolygon(k, p), false, "Knoten außerhalb");
      const d = Math.min(...p.map((q) => Math.hypot(q.x - k.x, q.z - k.z)));
      assert.ok(Math.abs(d - KNOTEN_VERSATZ_M) < 1e-9, `Versatz ${d}`);
    }
  });

  it("Ziel im Inneren eines Hindernisses ist unerreichbar → Infinity und leerer Pfad", () => {
    const r = lauflaenge({ x: 0, z: 0 }, { x: 5, z: 5 }, [rechteck(4, 4, 6, 6)]);
    assert.equal(r.laenge_m, Infinity);
    assert.deepEqual(r.pfad, []);
  });

  it("rettungsweg(): tiefste Ecke → Wohnungstür → nächste Treppenraum-Tür; Länge = innen + Flur, Pfad beginnt an der Ecke", () => {
    const o = rettungsweg({
      kandidaten: rechteck(0, 0, 4, 4), tuer: { x: 2, z: 0 }, hindernisse: [],
      ziele: [{ x: 22, z: 0 }, { x: 40, z: 0 }],
    });
    assert.ok(Math.abs(o.innen_m - Math.hypot(2, 4)) < 1e-9);
    assert.ok(Math.abs(o.flur_m - 20) < 1e-9, "nächstes Ziel bei x = 22 → 20 m");
    assert.ok(Math.abs(o.laenge_m - (o.innen_m + o.flur_m)) < 1e-9);
    assert.ok(o.pfad.length >= 2);
    assert.equal(o.pfad[0].z, 4, "Pfad beginnt an der tiefsten Ecke");
    assert.deepEqual(o.pfad[o.pfad.length - 1], { x: 22, z: 0 }, "endet an der Tür");
    assert.equal(o.erreichbar, true);
  });

  it("rettungsweg(): Tür öffnet direkt in den Treppenraum → Flurstrecke 0, nur der Weg innerhalb zählt", () => {
    const o = rettungsweg({ kandidaten: rechteck(0, 0, 4, 4), tuer: { x: 2, z: 0 }, ziele: [{ x: 22, z: 0 }], hindernisse: [], tuerImTreppenraum: true });
    assert.equal(o.flur_m, 0);
    assert.ok(Math.abs(o.laenge_m - o.innen_m) < 1e-9);
  });

  it("rettungsweg(): kein Ziel erreichbar → erreichbar false, Luftlinie als markierte Näherung (nie Infinity)", () => {
    const o = rettungsweg({ kandidaten: [{ x: 0, z: 1 }], tuer: { x: 0, z: 0 }, ziele: [{ x: 5, z: 5 }], hindernisse: [rechteck(4, 4, 6, 6)] });
    assert.equal(o.erreichbar, false);
    assert.ok(Number.isFinite(o.laenge_m));
    assert.ok(Math.abs(o.flur_m - Math.hypot(5, 5)) < 1e-9);
  });
});

describe("tesselierung.js — Rettungsweg als Lauflinie (75-13 Task 1)", () => {
  const basis = { footprintM: FP30, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true };

  it("regeln.rettungsweg an: je WE Länge, Teilstrecken und Pfad (≥ 2 Punkte); Länge = innen + Flur", () => {
    const r = tesseliere({ ...basis, regeln: { rettungsweg: true } });
    for (const w of r.weListe) {
      assert.ok(w.rettungsweg_m > 0, `${w.we} ohne Länge`);
      assert.ok(Array.isArray(w.rettungsweg_pfad) && w.rettungsweg_pfad.length >= 2, `${w.we} Pfad`);
      assert.ok(Math.abs(w.rettungsweg_m - (w.rettungsweg_innen_m + w.rettungsweg_flur_m)) < 0.11, `${w.we}: ${w.rettungsweg_m} ≠ ${w.rettungsweg_innen_m} + ${w.rettungsweg_flur_m}`);
    }
  });

  it("Regression: regeln.rettungsweg aus → kein rettungsweg_*-Feld und keine rettungswegWarnungen (wie vor 75-13)", () => {
    const r = tesseliere({ ...basis, regeln: { rettungsweg: false } });
    assert.equal(r.rettungswegWarnungen, undefined);
    for (const w of r.weListe) assert.ok(!("rettungsweg_m" in w) && !("rettungsweg_pfad" in w), w.we);
    const ohne = tesseliere(basis);
    assert.equal(JSON.stringify(r), JSON.stringify(ohne));
  });

  it("35,0 m ist ok, 35,1 m ist warn (Grenze: laenge > max; max wird auf die gemessene Länge bzw. 0,1 m darunter gestellt)", () => {
    assert.equal(RETTUNGSWEG_MAX, 35);
    const L = maxLauf(tesseliere({ ...basis, regeln: { rettungsweg: true } }));
    const gleich = tesseliere({ ...basis, regeln: { rettungsweg: true, rettungswegMax: L } });
    assert.equal(gleich.rettungswegWarnungen.length, 0, `${L} m darf bei Grenze ${L} m nicht warnen`);
    const knapp = tesseliere({ ...basis, regeln: { rettungsweg: true, rettungswegMax: Math.round((L - 0.1) * 10) / 10 } });
    assert.ok(knapp.rettungswegWarnungen.length >= 1, `${L} m muss bei Grenze ${L - 0.1} m warnen`);
    assert.ok(knapp.rettungswegWarnungen.every((w) => w.stufe === "warn"));
  });

  it("Überschreitung = warn (nicht Hinweis) mit Vorschlag „Treppenraum-Erweiterung um X m“ (aufgerundet auf 0,5 m)", () => {
    const fp = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
    const r = tesseliere({ footprintM: fp, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true, regeln: { rettungsweg: true } });
    assert.ok(r.rettungswegWarnungen.length > 0);
    for (const w of r.rettungswegWarnungen) {
      assert.equal(w.stufe, "warn");
      assert.ok(w.laenge_m > RETTUNGSWEG_MAX);
      assert.equal(w.vorschlag_m, Math.ceil((w.laenge_m - RETTUNGSWEG_MAX) * 2) / 2);
      assert.match(w.text, /Rettungsweg .* > 35 m/);
      assert.match(w.text, /Treppenraum-Erweiterung um/);
    }
    assert.ok(!r.hinweise.some((h) => /Rettungsweg .* > 35 m/.test(h)), "kein Hinweis mehr");
  });

  it("Lauflinie ≠ Manhattan: Länge mindestens Luftlinie (Pfad) und höchstens Luftlinie + Umweg; Pfadlänge stimmt mit rettungsweg_m überein (±0,15 m Rundung/Versatz)", () => {
    const r = tesseliere({ ...basis, regeln: { rettungsweg: true } });
    for (const w of r.weListe) {
      let s = 0;
      for (let i = 0; i + 1 < w.rettungsweg_pfad.length; i++) s += Math.hypot(w.rettungsweg_pfad[i + 1].x - w.rettungsweg_pfad[i].x, w.rettungsweg_pfad[i + 1].z - w.rettungsweg_pfad[i].z);
      assert.ok(Math.abs(s - w.rettungsweg_m) < 0.15, `${w.we}: Pfad ${s.toFixed(2)} vs ${w.rettungsweg_m}`);
    }
  });

  it("Mittelflur ohne Kern: Lauflinie zum Flurende, Hinweis nennt die Annahme", () => {
    const r = tesseliere({ ...basis, typ: "mittelflur", regeln: { rettungsweg: true } });
    assert.ok(r.weListe.every((w) => w.rettungsweg_m > 0));
    assert.ok(r.hinweise.some((h) => /kein Treppenraum im Skelett/.test(h)));
  });
});
