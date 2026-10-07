// Unit tests for the window cap of packages/nova-designer/src/lib/autoOpenings.js
// (75-13 Task 2, MSB-22). User brief 04.10.2026: "immer nur ein fenster pro raum
// maximal 2". Default ONE window per room (centred on the longest facade
// segment), corner room TWO (one per facade), the user may cap at 1 or 2
// globally (cfg.fensterMax) or per room (cfg.fensterMaxJeRaum); daylight 1/8
// (CITED MBO §47 Abs. 2) widens the single window up to 2,4 m before a second
// one is added.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FENSTER_JE_RAUM, fensterJeRaum, raeumeOhneRegelfenster } from "@designer/lib/autoOpenings";

// 30 × 8 m building: edge 0 north (z = 0), 1 east, 2 south, 3 west (a → b clockwise from the NW corner).
// Rooms that start at x = 10 are plain facade rooms; rooms at x = 0 are corner rooms.
const WALLS = [
  { a: { x: 0, z: 0 }, b: { x: 30, z: 0 }, level: 0, edge: 0 },
  { a: { x: 30, z: 0 }, b: { x: 30, z: 8 }, level: 0, edge: 1 },
  { a: { x: 30, z: 8 }, b: { x: 0, z: 8 }, level: 0, edge: 2 },
  { a: { x: 0, z: 8 }, b: { x: 0, z: 0 }, level: 0, edge: 3 },
];
const OHNE_TUER = { entrance: { enabled: false } };
const rect = (name, x0, z0, x1, z1) => ({
  name, level: 0, fensterpflicht: true,
  points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
});
const fenster = (zonen, cfg = {}) => fensterJeRaum(zonen, WALLS, { ...OHNE_TUER, ...cfg }).filter((o) => o.kind === "window");
const glas = (liste) => liste.reduce((s, f) => s + f.width * f.height, 0);

describe("fensterJeRaum — Deckel 1 / 2 (75-13 Task 2)", () => {
  it("Default des Deckels ist 1 (FENSTER_JE_RAUM.fensterMax)", () => {
    assert.equal(FENSTER_JE_RAUM.fensterMax, 1);
  });

  it("Raum mit 4 m Fassade → genau 1 Fenster, mittig (u = 12 m), Breite aus der Belichtung 1/8 (16 m² → 2,00 m² Glas)", () => {
    const f = fenster([rect("Wohnen ·WT", 10, 0, 14, 4)]);
    assert.equal(f.length, 1);
    assert.ok(Math.abs(f[0].u - 12) < 1e-9);
    assert.ok(Math.abs(glas(f) - 16 / 8) < 1e-9, `Glas ${glas(f)}`);
  });

  it("9 m Fassade → weiterhin 1 Fenster (vorher je 3,5 m eines = 2), Mitte u = 14,5 m", () => {
    const f = fenster([rect("Wohnen ·WT", 10, 0, 19, 2.5)]);
    assert.equal(f.length, 1);
    assert.ok(Math.abs(f[0].u - 14.5) < 1e-9);
    assert.ok(glas(f) >= (9 * 2.5) / 8 - 1e-9, "Belichtung 1/8 erfüllt");
  });

  it("fensterMax 2 + 9 m Fassade → 2 Fenster, je im eigenen Halbabschnitt, Breite 1,4 m", () => {
    const f = fenster([rect("Wohnen ·WT", 10, 0, 19, 2.5)], { fensterMax: 2 });
    assert.equal(f.length, 2);
    assert.ok(f.every((x) => Math.abs(x.width - FENSTER_JE_RAUM.breite) < 1e-9));
    assert.ok(f[0].u < 14.5 && f[1].u > 14.5);
  });

  it("fensterMax 2 bei kurzer Fassade (4 m < 2 × 3,5 m) bleibt 1 Fenster — zwei Achsen passen nicht", () => {
    assert.equal(fenster([rect("Wohnen ·WT", 10, 0, 14, 4)], { fensterMax: 2 }).length, 1);
  });

  it("Eckraum (zwei Fassadenabschnitte je ≥ 2 m) → 2 Fenster, eins je Fassade, auch beim Default-Deckel 1", () => {
    const f = fenster([rect("Eck ·WT", 0, 0, 4, 4)]);
    assert.equal(f.length, 2);
    assert.deepEqual(f.map((x) => x.edge).sort(), [0, 3], "Nordwand und Westwand");
  });

  it("Eckraum mit Raum-Deckel 1 → nur 1 Fenster; Raum-Deckel 2 lässt den Eckraum bei 2", () => {
    const eins = fenster([rect("Eck ·WT", 0, 0, 4, 4)], { fensterMaxJeRaum: { "Eck ·WT": 1 } });
    assert.equal(eins.length, 1);
    const zwei = fenster([rect("Eck ·WT", 0, 0, 4, 4)], { fensterMaxJeRaum: { "Eck ·WT": 2 } });
    assert.equal(zwei.length, 2);
  });

  it("Raum mit einem Fassadenabschnitt unter 2 m gilt nicht als Eckraum → 1 Fenster auf dem längeren Abschnitt", () => {
    // Zone 0…4 × 0…1,5: Nordwand 4 m, Westwand nur 1,5 m.
    const f = fenster([rect("Schmal ·WT", 0, 0, 4, 1.5)]);
    assert.equal(f.length, 1);
    assert.equal(f[0].edge, 0, "der längere Abschnitt");
  });

  it("Raum-Deckel 2 gilt nur für diesen Raum; der globale Deckel 1 bleibt für die anderen", () => {
    const zonen = [rect("A ·WT", 10, 0, 19, 2.5), rect("B ·WT", 10, 5.5, 19, 8)];
    const f = fenster(zonen, { fensterMaxJeRaum: { "A ·WT": 2 } });
    assert.equal(f.filter((x) => x.raum === "A ·WT").length, 2);
    assert.equal(f.filter((x) => x.raum === "B ·WT").length, 1);
  });

  it("Belichtung unter 1/8 → das Fenster wird breiter (20 m² → 2,50 m² Glas = 1,79 m), nicht zahlreicher", () => {
    const f = fenster([rect("Wohnen ·WT", 10, 0, 15, 4)]);
    assert.equal(f.length, 1);
    assert.ok(Math.abs(f[0].width - 2.5 / FENSTER_JE_RAUM.hoehe) < 1e-9, `Breite ${f[0].width}`);
    assert.ok(f[0].width > FENSTER_JE_RAUM.breite && f[0].width <= FENSTER_JE_RAUM.maxBreite);
  });

  it("Raum, den auch 2,4 m Breite nicht belichtet (36 m²), bekommt ein zweites Fenster samt Hinweis — und steht in raeumeOhneRegelfenster", () => {
    const zonen = [rect("Saal ·WT", 10, 0, 19, 4)];
    const f = fenster(zonen);
    assert.equal(f.length, 2);
    assert.ok(glas(f) >= 36 / 8 - 1e-9, `Glas ${glas(f)} < 4,5 m²`);
    assert.ok(f.every((x) => typeof x.hinweis === "string" && /Belichtung 1\/8 \(MBO §47\)/.test(x.hinweis)));
    const offen = raeumeOhneRegelfenster(zonen, WALLS, f);
    assert.equal(offen.length, 1);
    assert.match(offen[0].grund, /zweites Fenster gesetzt/);
  });

  it("jedes Fenster liegt im eigenen Abschnitt mit ≥ 0,50 m Abstand zur Raumgrenze (nie über einer Trennwand), auch verbreitert", () => {
    const zonen = [rect("A ·WT", 10, 0, 14, 4), rect("B ·WT", 14, 0, 19, 4), rect("C ·WT", 19, 0, 22, 4)];
    const f = fenster(zonen);
    assert.ok(f.length >= 3);
    for (const w of f) {
      const z = zonen.find((q) => q.name === w.raum);
      const u0 = Math.min(...z.points.map((p) => p.x)), u1 = Math.max(...z.points.map((p) => p.x));
      assert.ok(w.u - w.width / 2 >= u0 + FENSTER_JE_RAUM.randAbstand - 1e-9, `${w.raum} links`);
      assert.ok(w.u + w.width / 2 <= u1 - FENSTER_JE_RAUM.randAbstand + 1e-9, `${w.raum} rechts`);
    }
  });
});
