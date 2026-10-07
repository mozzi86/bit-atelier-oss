// Unit-Tests für packages/nova-designer/src/lib/autoOpenings.js (75-11 Task 2,
// MSB-13): fensterJeRaum — je fensterpflichtigem Raum mindestens ein Fenster
// im EIGENEN Fassadenabschnitt, nie über einer Trennwand; plus Regression,
// dass autoEnvOpenings unverändert rechnet (fünf Bestandsaufrufer).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_WINDOW, autoEnvOpenings, autoWindowUVs, FENSTER_JE_RAUM,
  fensterJeRaum, raeumeOhneRegelfenster,
} from "@designer/lib/autoOpenings";

// 12-m-Nordwand (z = 0), edge 0 — die Beispielwand aus dem Plan.
const W12 = { a: { x: 0, z: 0 }, b: { x: 12, z: 0 }, level: 0, edge: 0 };
const WALLS = [W12];

/** Fensterpflichtige Zone an der Nordwand von x0 bis x1 (4 m tief). */
const zone = (name, x0, x1, fensterpflicht = true) => ({
  name,
  level: 0,
  fensterpflicht,
  points: [{ x: x0, z: 0 }, { x: x1, z: 0 }, { x: x1, z: 4 }, { x: x0, z: 4 }],
});

describe("fensterJeRaum (MSB-13)", () => {
  it("drei fensterpflichtige Räume an der 12-m-Wand → mindestens 3 Fenster, je eines im eigenen Abschnitt", () => {
    const zonen = [zone("Wohnen ·WT", 0, 4), zone("Schlafen ·WT", 4, 8), zone("Kind ·WT", 8, 12)];
    // Eingangstür aus: sie säße bei u=6 und kollidierte mit dem mittleren Raum
    // (ueberlappt) — hier geht es um die Raum-Zuordnung, nicht um die Tür.
    const f = fensterJeRaum(zonen, WALLS, { entrance: { enabled: false } }).filter((o) => o.kind === "window");
    assert.ok(f.length >= 3, `nur ${f.length} Fenster`);
    const raeume = new Set(f.map((x) => x.raum));
    assert.equal(raeume.size, 3);
  });

  it("kein Fenster überlappt eine Raumgrenze: [u−w/2, u+w/2] ⊂ [u0, u1] des Raums", () => {
    const zonen = [zone("Wohnen ·WT", 0, 4), zone("Schlafen ·WT", 4, 8), zone("Kind ·WT", 8, 12)];
    for (const f of fensterJeRaum(zonen, WALLS).filter((o) => o.kind === "window")) {
      const z = zonen.find((x) => x.name === f.raum);
      const u0 = Math.min(...z.points.map((p) => p.x));
      const u1 = Math.max(...z.points.map((p) => p.x));
      assert.ok(f.u - f.width / 2 >= u0 - 1e-9, `${f.raum}: links über der Trennwand`);
      assert.ok(f.u + f.width / 2 <= u1 + 1e-9, `${f.raum}: rechts über der Trennwand`);
    }
  });

  it("Mindestabstand 0,50 m zur Raumgrenze im Regelfall (4-m-Abschnitt → EIN Fenster mittig, Belichtung 1/8 bestimmt die Breite)", () => {
    const f = fensterJeRaum([zone("Wohnen ·WT", 0, 4)], WALLS).filter((o) => o.kind === "window");
    assert.equal(f.length, 1);
    assert.ok(Math.abs(f[0].u - 2) < 1e-9, `Mitte bei ${f[0].u}`); // Handrechnung: 0 + 0.5 + (3/1)·0.5
    // 75-13: 16 m² / 8 = 2,00 m² Glas; 1,4 × 1,4 = 1,96 reicht nicht → Breite 2,00 / 1,4 = 1,43 m
    // (vor 75-13 war die Breite fest 1,4 — Belichtung wurde erst nachgelagert geprüft).
    assert.ok(Math.abs(f[0].width - 2 / FENSTER_JE_RAUM.hoehe) < 1e-9, `Breite ${f[0].width}`);
    assert.ok(f[0].u - f[0].width / 2 >= 0 + FENSTER_JE_RAUM.randAbstand - 1e-9);
    assert.ok(f[0].u + f[0].width / 2 <= 4 - FENSTER_JE_RAUM.randAbstand + 1e-9);
  });

  it("Abschnitt 2,0 m → Fenster 1,0 m (2,0 − 2·0,5), nicht das Regelmaß 1,4 + Raum in der Meldung", () => {
    const f = fensterJeRaum([zone("Bad ·WT", 0, 2)], WALLS).filter((o) => o.kind === "window");
    assert.equal(f.length, 1);
    assert.ok(Math.abs(f[0].width - 1.0) < 1e-9, `Breite ${f[0].width}`); // Handrechnung: 2 − 1 = 1
  });

  it("Abschnitt 1,4 m → Fenster 0,6 m (minBreite) und der Raum steht in raeumeOhneRegelfenster", () => {
    const zonen = [zone("Schlafen ·WT", 0, 1.4)];
    const f = fensterJeRaum(zonen, WALLS).filter((o) => o.kind === "window");
    assert.equal(f.length, 1);
    assert.ok(Math.abs(f[0].width - FENSTER_JE_RAUM.minBreite) < 1e-9, `Breite ${f[0].width}`);
    const offen = raeumeOhneRegelfenster(zonen, WALLS, f);
    assert.equal(offen.length, 1);
    assert.equal(offen[0].name, "Schlafen ·WT");
    assert.match(offen[0].grund, /verschmälert/);
  });

  it("Räume mit fensterpflicht false (Küche, Bad, Abstell, Flur) bekommen kein Auto-Fenster", () => {
    const zonen = [zone("Küche ·WT", 0, 4, false), zone("Flur ·WT", 4, 8, false)];
    const f = fensterJeRaum(zonen, WALLS);
    assert.equal(f.filter((o) => o.kind === "window").length, 0);
  });

  it("benutzerplatziertes Fenster an derselben Stelle unterdrückt das Auto-Fenster (ueberlappt)", () => {
    const zonen = [zone("Wohnen ·WT", 0, 4)];
    // User window at u = 2 (segment centre) with 1.4 m width covers the auto spot.
    const placed = [{ level: 0, edge: 0, u: 2, width: 1.4 }];
    const f = fensterJeRaum(zonen, WALLS, {}, placed).filter((o) => o.kind === "window");
    assert.equal(f.length, 0);
  });

  it("innenliegender Raum ohne Fassadenabschnitt → kein Fenster erfunden, Meldung mit Grund", () => {
    // Room at x 4..8, z 6..10 — touches no envelope wall.
    const innen = {
      name: "Abstell ·WT", level: 0, fensterpflicht: true,
      points: [{ x: 4, z: 6 }, { x: 8, z: 6 }, { x: 8, z: 10 }, { x: 4, z: 10 }],
    };
    const f = fensterJeRaum([innen], WALLS).filter((o) => o.kind === "window");
    assert.equal(f.length, 0);
    const offen = raeumeOhneRegelfenster([innen], WALLS, f);
    assert.equal(offen.length, 1);
    assert.match(offen[0].grund, /innenliegend/);
  });

  it("Eingangstür hängt wie bei autoEnvOpenings am Ergebnis (Drop-in)", () => {
    const f = fensterJeRaum([zone("Wohnen ·WT", 0, 4)], WALLS);
    const doors = f.filter((o) => o.kind === "door");
    assert.equal(doors.length, 1);
    assert.equal(doors[0].u, 6); // ENTRANCE_DEFAULT uRel 0.5 · 12 m
  });
});

describe("autoEnvOpenings-Regression (Bestandsweg byte-gleich)", () => {
  it("12-m-Wand → autoWindowUVs exakt 3 Fenster u = 2/6/10; autoEnvOpenings unverändert", () => {
    // Handrechnung autoWindowUVs: count = floor(12/3.5) = 3;
    // u_k = ((k+0.5)/3)·12 = 2, 6, 10.
    const uv = autoWindowUVs(W12);
    assert.equal(uv.length, 3);
    assert.deepEqual(uv.map((o) => o.u), [2, 6, 10]);
    assert.ok(uv.every((o) => o.width === AUTO_WINDOW.width && o.height === AUTO_WINDOW.height && o.sill === AUTO_WINDOW.sill));
    // autoEnvOpenings OHNE Tür → dieselben 3 Fenster (drop-in-Beweis, dass der
    // Bestandsweg unangetastet ist). MIT Default-Tür bei u=6 unterdrückt
    // ueberlappt das mittlere Fenster — das ist VORBESTEHENDES Verhalten, hier
    // explizit festgehalten, damit es nicht still kippt.
    const ohneTuer = autoEnvOpenings(WALLS, { entrance: { enabled: false } }).filter((o) => o.kind === "window");
    assert.deepEqual(ohneTuer.map((o) => o.u), [2, 6, 10]);
    const mitTuer = autoEnvOpenings(WALLS);
    assert.deepEqual(mitTuer.filter((o) => o.kind === "window").map((o) => o.u), [2, 10]);
    assert.equal(mitTuer.filter((o) => o.kind === "door").length, 1);
  });
});
