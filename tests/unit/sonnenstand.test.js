// Unit-Tests für packages/nova-designer/src/lib/sonnenstand.js (Phase 37, GARTEN-03).
// Kulisse: 10 × 10 m Würfel um (0,0), 10 m hoch, 49° N (Nürnberg). Mittags im Juni steht die Sonne
// exakt im Süden (Azimut 180°), Elevation ≈ 90° − 49° + 23,4° ≈ 64°; bei 45° Elevation ist der Schatten
// so lang wie das Gebäude hoch (10 m) und fällt nach Norden (−z).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  sunPosition, sonnenrichtung, schattenlaenge, imSchatten, sonnenstunden, lichtKlasse, schattenPolygone,
  SONNEN_PRESETS, planAzimut, lichtrichtung,
} from "@designer/lib/sonnenstand";

const WUERFEL = [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: -5, z: 5 }];
const SUED45 = { elevation: 45, azimuth: 180 };

describe("sonnenstand: sunPosition", () => {
  it("Juni 12:00 bei 49° N: Sonne im Süden, Elevation ≈ 64°", () => {
    const s = sunPosition(49, 6, 12);
    assert.ok(Math.abs(s.azimuth - 180) < 3, `azimuth ${s.azimuth}`);
    assert.ok(Math.abs(s.elevation - 64) < 3, `elevation ${s.elevation}`);
  });
  it("morgens östlich (< 180°), nachmittags westlich (> 180°), Dezember flacher als Juni", () => {
    assert.ok(sunPosition(49, 6, 8).azimuth < 180);
    assert.ok(sunPosition(49, 6, 16).azimuth > 180);
    assert.ok(sunPosition(49, 12, 12).elevation < sunPosition(49, 6, 12).elevation);
  });
});

describe("sonnenstand: Richtung und Schattenlänge", () => {
  it("sonnenrichtung: Süden = +z, Osten = +x", () => {
    const s = sonnenrichtung(180), o = sonnenrichtung(90);
    assert.ok(Math.abs(s.x) < 1e-9 && Math.abs(s.z - 1) < 1e-9);
    assert.ok(Math.abs(o.x - 1) < 1e-9 && Math.abs(o.z) < 1e-9);
  });
  it("schattenlaenge: 10 m bei 45° → 10 m; Sonne unter dem Horizont → 0", () => {
    assert.ok(Math.abs(schattenlaenge(10, 45) - 10) < 1e-6);
    assert.equal(schattenlaenge(10, 0), 0);
    assert.equal(schattenlaenge(10, -5), 0);
  });
});

describe("sonnenstand: imSchatten", () => {
  it("Punkt nördlich (im Schattenwurf) ja, südlich nein, zu weit nördlich nein, im Gebäude ja", () => {
    assert.equal(imSchatten({ x: 0, z: -8 }, WUERFEL, 10, SUED45), true);
    assert.equal(imSchatten({ x: 0, z: 8 }, WUERFEL, 10, SUED45), false);
    assert.equal(imSchatten({ x: 0, z: -16 }, WUERFEL, 10, SUED45), false);
    assert.equal(imSchatten({ x: 0, z: 0 }, WUERFEL, 10, SUED45), true);
  });
  it("Nacht (Elevation ≤ 0) gilt als Schatten; ohne Footprint nie", () => {
    assert.equal(imSchatten({ x: 0, z: 8 }, WUERFEL, 10, { elevation: -3, azimuth: 0 }), true);
    assert.equal(imSchatten({ x: 0, z: 8 }, [], 10, SUED45), false);
  });
});

describe("sonnenstand: sonnenstunden und lichtKlasse", () => {
  it("Südseite sonniger als Nordseite; Werte im Tagesbereich", () => {
    const sued = sonnenstunden({ x: 0, z: 12 }, WUERFEL, 10, 49);
    const nord = sonnenstunden({ x: 0, z: -7 }, WUERFEL, 10, 49);
    assert.ok(sued > nord, `sued ${sued} nord ${nord}`);
    assert.ok(sued <= 15 && nord >= 0);
    assert.equal(lichtKlasse(sued), "sonnig");
  });
  it("Klassen: ≥ 6 h sonnig, 3–6 halbschattig, < 3 schattig", () => {
    assert.equal(lichtKlasse(7), "sonnig");
    assert.equal(lichtKlasse(4), "halbschattig");
    assert.equal(lichtKlasse(1), "schattig");
  });
  it("schattenPolygone: je Kante ein Viereck + verschobener Footprint; Sonne unten → []", () => {
    const polys = schattenPolygone(WUERFEL, 10, SUED45);
    assert.equal(polys.length, 5);
    const verschoben = polys[4];
    assert.ok(Math.abs(verschoben[0].z - (-15)) < 1e-6, "Footprint um 10 m nach Norden verschoben");
    assert.deepEqual(schattenPolygone(WUERFEL, 10, { elevation: 0, azimuth: 180 }), []);
  });
});

// --- 75-08 Task 2: Stichtag-Option, Presets, planAzimut, lichtrichtung ------
// Die Monatspfad-Literale wurden VOR der Änderung gemessen
// (tmp-e2e/pin-monat.mjs, 23.09.) — Beweis für „byte-gleich".

describe("sonnenstand: 75-08 — Monatspfad byte-gleich (gepinnte Literale)", () => {
  it("sunPosition ohne opts liefert exakt die vor der Änderung gemessenen Werte", () => {
    assert.deepStrictEqual(sunPosition(49, 6, 12), { elevation: 64.34434126968988, azimuth: 180 });
    assert.deepStrictEqual(sunPosition(50.1, 3, 9), { elevation: 25.23413726535845, azimuth: 128.62770240725328 });
    assert.deepStrictEqual(sunPosition(49.45, 12, 15), { elevation: 6.933085544275961, azimuth: 220.83779114787168 });
    assert.deepStrictEqual(sunPosition(52.5, 9, 17.5), { elevation: 6.319671227336637, azimuth: 265.38692327507204 });
  });
  it("leeres opts / undefined = Monatspfad (deepEqual)", () => {
    assert.deepStrictEqual(sunPosition(49, 6, 12, {}), sunPosition(49, 6, 12));
    assert.deepStrictEqual(sunPosition(49, 6, 12, undefined), sunPosition(49, 6, 12));
  });
});

describe("sonnenstand: 75-08 — Stichtage über tagImJahr", () => {
  // Handrechnung: Sommersonnenwende Mittag bei 49° N → 90 − 49 + 23.44 ≈ 64.44°.
  it("21.06. (Tag 172) 12 h bei 49° N: Elevation ≈ 64.44°, Azimut ≈ 180°", () => {
    const s = sunPosition(49, 6, 12, { tagImJahr: 172 });
    assert.ok(Math.abs(s.elevation - 64.44) < 0.2, `elevation ${s.elevation}`);
    assert.ok(Math.abs(s.azimuth - 180) < 0.01, `azimuth ${s.azimuth}`);
  });
  it("21.12. (Tag 355) 12 h: Elevation ≈ 17.56°; 21.03. (Tag 80): ≈ 40.60° (Deklination −0.40°)", () => {
    const dez = sunPosition(49, 12, 12, { tagImJahr: 355 });
    assert.ok(Math.abs(dez.elevation - 17.56) < 0.2, `dez elevation ${dez.elevation}`);
    const mar = sunPosition(49, 3, 12, { tagImJahr: 80 });
    assert.ok(Math.abs(mar.elevation - 40.6) < 0.3, `mar elevation ${mar.elevation}`);
  });
  it("9 h und 15 h sind spiegelgleich: Az9 + Az15 = 360°, Elevationen gleich", () => {
    const m = sunPosition(49, 6, 9, { tagImJahr: 172 });
    const a = sunPosition(49, 6, 15, { tagImJahr: 172 });
    assert.ok(Math.abs(m.azimuth + a.azimuth - 360) < 1e-9, `${m.azimuth} + ${a.azimuth}`);
    assert.ok(Math.abs(m.elevation - a.elevation) < 1e-9, `${m.elevation} vs ${a.elevation}`);
  });
});

describe("sonnenstand: 75-08 — SONNEN_PRESETS", () => {
  it("drei eingefrorene Tage 21.03./21.06./21.12. mit Tag 80/172/355, Stunden 9/12/15", () => {
    assert.deepEqual(SONNEN_PRESETS.tage.map((p) => p.tagImJahr), [80, 172, 355]);
    assert.deepEqual(SONNEN_PRESETS.tage.map((p) => p.monat), [3, 6, 12]);
    assert.deepEqual([...SONNEN_PRESETS.stunden], [9, 12, 15]);
    assert.ok(Object.isFrozen(SONNEN_PRESETS) && SONNEN_PRESETS.tage.every(Object.isFrozen));
  });
});

describe("sonnenstand: 75-08 — planAzimut", () => {
  it("Nordwinkel 0 = strikte Identität (kein Modulo); geografisch − Nordwinkel sonst", () => {
    assert.strictEqual(planAzimut(123.456, 0), 123.456);
    assert.strictEqual(planAzimut(123.456), 123.456);
    assert.ok(Math.abs(planAzimut(10, 30) - 340) < 1e-12);
    assert.ok(Math.abs(planAzimut(350, -20) - 10) < 1e-12);
  });
});

describe("sonnenstand: 75-08 — lichtrichtung", () => {
  it("(180, 45, 0) = (0; 0.7071; 0.7071), Länge 1 — Süden bei 45° Elevation", () => {
    const L = lichtrichtung(180, 45, 0);
    assert.ok(Math.abs(L.x) < 1e-12 && Math.abs(L.y - 0.70710678) < 1e-8 && Math.abs(L.z - 0.70710678) < 1e-8);
    assert.ok(Math.abs(Math.hypot(L.x, L.y, L.z) - 1) < 1e-12);
  });
  it("Nordwinkel 90: geografisch Ost = Plan-oben (−z); geografisch Süd = Plan-rechts (+x)", () => {
    const ost = lichtrichtung(90, 30, 90);
    assert.ok(Math.abs(ost.x) < 1e-12 && Math.abs(ost.y - 0.5) < 1e-12 && Math.abs(ost.z + 0.8660254) < 1e-7, JSON.stringify(ost));
    const sued = lichtrichtung(180, 45, 90);
    assert.ok(Math.abs(sued.x - 0.70710678) < 1e-8 && Math.abs(sued.y - 0.70710678) < 1e-8 && Math.abs(sued.z) < 1e-12, JSON.stringify(sued));
  });
  it("ueberHorizont: −3° → false, +5° → true", () => {
    assert.equal(lichtrichtung(180, -3, 0).ueberHorizont, false);
    assert.equal(lichtrichtung(180, 5, 0).ueberHorizont, true);
  });
});
