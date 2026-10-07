// Unit-Tests für packages/nova-core/src/lib/geo.js (zentralisierter Maßstab, KD-01-Fix).
//
// Belegter Sample-Wert: HANDOFF KD-01 „Smoke: pxAreaToM2(800*800) = 1.000.000 m²"
// (Commit b6082f2 — 800 px ≙ 1.000 m ⇒ 1,25 m/px, Flächenfaktor 1,25² = 1,5625).
//
// Kernaussage dieser Suite: der FLÄCHEN-Faktor ist das QUADRAT des Längenfaktors.
// Der alte Bug war ein Faktor 0,0625 = (0,25 m/px)² — also 25-mal zu niedrig.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SITE_EDGE_METERS,
  SITE_EDGE_PX,
  DEFAULT_METERS_PER_PIXEL,
  polygonAreaPx,
  metersPerPixel,
  pxToM,
  mToPx,
  pxAreaToM2,
  pxToMeters,
  polygonAreaM2,
  centroid,
  pointInPolygon,
} from "@core/lib/geo";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""}: ${actual} ≠ ${expected} (±${tol})`);

// Die generierte Standard-Parzelle: 800 × 800 px ≙ 1.000 × 1.000 m.
const PARZELLE = [
  { x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 800 }, { x: 0, y: 800 },
];

describe("geo.js — Maßstabskonvention", () => {
  it("800 px ≙ 1.000 m ⇒ 1,25 m/px", () => {
    assert.equal(SITE_EDGE_METERS, 1000);
    assert.equal(SITE_EDGE_PX, 800);
    assert.equal(DEFAULT_METERS_PER_PIXEL, 1.25);
    assert.equal(DEFAULT_METERS_PER_PIXEL, SITE_EDGE_METERS / SITE_EDGE_PX);
  });

  it("KD-01: pxAreaToM2(800 · 800) = 1.000.000 m² (belegter Smoke-Wert)", () => {
    assert.equal(pxAreaToM2(800 * 800), 1000000);
  });

  it("EINHEITENFALLE: der Flächenfaktor ist das QUADRAT des Längenfaktors (1,5625)", () => {
    const laengenFaktor = pxToM(1);
    const flaechenFaktor = pxAreaToM2(1);
    assert.equal(laengenFaktor, 1.25);
    assert.equal(flaechenFaktor, 1.5625);
    assert.equal(flaechenFaktor, laengenFaktor ** 2);
  });

  it("der alte Bugfaktor 0,0625 = (0,25 m/px)² darf nirgends mehr herauskommen", () => {
    assert.notEqual(pxAreaToM2(1), 0.0625);
    // 0,0625 ist genau 1/25 des korrekten Werts — Faktor 25 zu niedrig
    near(pxAreaToM2(1) / 0.0625, 25, 1e-9, "Faktor zwischen Bug und Fix");
  });
});

describe("geo.js — metersPerPixel()", () => {
  it("ohne Parzelle gilt die Default-Konvention 1,25 m/px — NICHT 1", () => {
    assert.equal(metersPerPixel(undefined), 1.25);
    assert.equal(metersPerPixel(null), 1.25);
    assert.equal(metersPerPixel({}), 1.25);
    assert.notEqual(metersPerPixel(undefined), 1);
  });

  it("Standard-Parzelle 800 px breit ⇒ 1,25 m/px", () => {
    assert.equal(metersPerPixel({ points: PARZELLE }), 1.25);
  });

  it("halbe Parzelle (400 px) auf 1.000 m ⇒ 2,5 m/px", () => {
    const halb = PARZELLE.map((p) => ({ x: p.x / 2, y: p.y / 2 }));
    assert.equal(metersPerPixel({ points: halb }), 2.5);
  });

  it("abweichende Kantenlänge in Metern wird berücksichtigt", () => {
    assert.equal(metersPerPixel({ points: PARZELLE }, 400), 0.5);
  });

  it("Härtung: < 2 Punkte oder Breite 0 ⇒ Default 1,25 m/px", () => {
    assert.equal(metersPerPixel({ points: [] }), 1.25);
    assert.equal(metersPerPixel({ points: [{ x: 10, y: 10 }] }), 1.25);
    const senkrecht = [{ x: 100, y: 0 }, { x: 100, y: 800 }];
    assert.equal(metersPerPixel({ points: senkrecht }), 1.25);
  });
});

describe("geo.js — pxToM / mToPx / pxToMeters", () => {
  it("Hin- und Rückrechnung sind konsistent", () => {
    assert.equal(pxToM(800), 1000);
    assert.equal(mToPx(1000), 800);
    near(mToPx(pxToM(123)), 123, 1e-9, "Roundtrip");
  });

  it("pxToMeters ist ein Alias von pxToM (Bestandscode)", () => {
    assert.equal(pxToMeters(800), pxToM(800));
    assert.equal(pxToMeters(123, { points: PARZELLE }), pxToM(123, { points: PARZELLE }));
  });

  it("Härtung: undefined/null/leerer String/NaN ⇒ 0, nie NaN", () => {
    for (const v of [undefined, null, "", NaN, {}, "abc"]) {
      assert.equal(pxToM(v), 0, `pxToM(${String(v)})`);
      assert.equal(mToPx(v), 0, `mToPx(${String(v)})`);
    }
  });

  it("negative Längen bleiben negativ (Vektorlogik, keine Klemmung)", () => {
    assert.equal(pxToM(-800), -1000);
    assert.equal(mToPx(-1000), -800);
  });
});

describe("geo.js — polygonAreaPx() (Shoelace)", () => {
  it("800 × 800 px Quadrat ⇒ 640.000 px²", () => {
    assert.equal(polygonAreaPx(PARZELLE), 640000);
  });

  it("Umlaufrichtung ist egal (Math.abs)", () => {
    assert.equal(polygonAreaPx([...PARZELLE].reverse()), 640000);
  });

  it("Dreieck 100 × 100 px ⇒ 5.000 px²", () => {
    assert.equal(polygonAreaPx([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]), 5000);
  });

  it("Härtung: null/undefined/< 3 Punkte ⇒ 0", () => {
    assert.equal(polygonAreaPx(null), 0);
    assert.equal(polygonAreaPx(undefined), 0);
    assert.equal(polygonAreaPx([]), 0);
    assert.equal(polygonAreaPx([{ x: 0, y: 0 }, { x: 10, y: 10 }]), 0);
  });

  it("Härtung: entartetes Polygon (alle Punkte gleich) ⇒ 0, nie NaN", () => {
    const punkt = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    assert.equal(polygonAreaPx(punkt), 0);
  });
});

describe("geo.js — pxAreaToM2() / polygonAreaM2()", () => {
  it("Standard-Parzelle: 640.000 px² ⇒ 1.000.000 m²", () => {
    assert.equal(pxAreaToM2(polygonAreaPx(PARZELLE), { points: PARZELLE }), 1000000);
    assert.equal(polygonAreaM2(PARZELLE, { points: PARZELLE }), 1000000);
  });

  it("polygonAreaM2 rundet auf ganze m²", () => {
    const schief = [{ x: 0, y: 0 }, { x: 33, y: 0 }, { x: 33, y: 17 }, { x: 0, y: 17 }];
    const a = polygonAreaM2(schief);
    assert.ok(Number.isInteger(a), `nicht ganzzahlig: ${a}`);
    near(a, 33 * 17 * 1.5625, 1, "gerundete Fläche");
  });

  it("halbierte Pixelbreite bei gleicher Meter-Kante vervierfacht die m²-Fläche (Quadrat!)", () => {
    const halb = { points: PARZELLE.map((p) => ({ x: p.x / 2, y: p.y / 2 })) };
    // mpp verdoppelt sich (2,5) ⇒ Flächenfaktor vervierfacht (6,25)
    assert.equal(pxAreaToM2(1, halb), 6.25);
    assert.equal(pxAreaToM2(1, halb) / pxAreaToM2(1, { points: PARZELLE }), 4);
  });

  it("Härtung: 0/negativ/undefined ⇒ endliche Werte, nie NaN", () => {
    assert.equal(pxAreaToM2(0), 0);
    assert.equal(pxAreaToM2(undefined), 0);
    assert.equal(pxAreaToM2(NaN), 0);
    assert.equal(pxAreaToM2(-640000), -1000000);
    assert.equal(polygonAreaM2(null), 0);
    assert.equal(polygonAreaM2(undefined, undefined), 0);
  });

  it("Härtung: Parzelle mit Breite 0 fällt auf die Default-Konvention zurück (kein Infinity)", () => {
    const entartet = { points: [{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 200 }] };
    assert.ok(Number.isFinite(pxAreaToM2(640000, entartet)));
    assert.equal(pxAreaToM2(640000, entartet), 1000000);
  });
});

describe("geo.js — metersPerPixel mit explizitem m_per_px (Phase 36, KARTE-04a)", () => {
  it("m_per_px am Parcel hat Vorrang vor der Bbox-Ableitung", () => {
    // Echte gezeichnete Parzelle: nur 48 px (= 60 m) breit. Ohne m_per_px
    // unterstellte die Bbox-Ableitung 1000 m Kante ⇒ ~20,83 m/px (falsch).
    const echt = {
      m_per_px: 1.25,
      points: [{ x: 576, y: 376 }, { x: 624, y: 376 }, { x: 624, y: 424 }, { x: 576, y: 424 }],
    };
    assert.equal(metersPerPixel(echt), 1.25);
    // 48 × 48 px ≙ 60 × 60 m = 3.600 m² — nicht 1.000.000 m².
    assert.equal(polygonAreaM2(echt.points, echt), 3600);
  });

  it("ohne m_per_px bleibt die Bbox-Ableitung unverändert (Bestand)", () => {
    assert.equal(metersPerPixel({ points: PARZELLE }), 1.25);
    const halb = { points: PARZELLE.map((p) => ({ x: p.x / 2, y: p.y / 2 })) };
    assert.equal(metersPerPixel(halb), 2.5);
  });

  it("Härtung: unbrauchbares m_per_px (0, negativ, NaN, String) fällt auf Bbox zurück", () => {
    assert.equal(metersPerPixel({ m_per_px: 0, points: PARZELLE }), 1.25);
    assert.equal(metersPerPixel({ m_per_px: -2, points: PARZELLE }), 1.25);
    assert.equal(metersPerPixel({ m_per_px: NaN, points: PARZELLE }), 1.25);
    assert.equal(metersPerPixel({ m_per_px: "abc", points: PARZELLE }), 1.25);
    // "2.5" als String ist eine gültige Zahl — wird akzeptiert.
    assert.equal(metersPerPixel({ m_per_px: "2.5", points: PARZELLE }), 2.5);
  });
});

describe("geo.js — pointInPolygon() (Review-Fix 36-02: statt Bbox-Test)", () => {
  // L-förmige Parzelle: Bbox 0..100/0..100, aber der Quadrant x>50,y>50 fehlt.
  const L = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 },
    { x: 50, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 100 },
  ];

  it("innen ⇒ true, außen ⇒ false", () => {
    assert.equal(pointInPolygon(L, 25, 25), true);
    assert.equal(pointInPolygon(L, 75, 25), true);
    assert.equal(pointInPolygon(L, 25, 75), true);
    assert.equal(pointInPolygon(L, 200, 25), false);
    assert.equal(pointInPolygon(L, -1, 25), false);
  });

  it("der Bbox-Blindfleck ist dicht: in der Bbox, aber außerhalb des L", () => {
    // Genau der Fall, den der alte Bbox-Check fälschlich zuließ.
    assert.equal(pointInPolygon(L, 75, 75), false);
  });

  it("konvexes Quadrat verhält sich wie der alte Bbox-Check", () => {
    assert.equal(pointInPolygon(PARZELLE, 400, 400), true);
    assert.equal(pointInPolygon(PARZELLE, 801, 400), false);
  });

  it("Härtung: <3 Punkte / null ⇒ false, nie Exception", () => {
    assert.equal(pointInPolygon(null, 1, 1), false);
    assert.equal(pointInPolygon([], 1, 1), false);
    assert.equal(pointInPolygon([{ x: 0, y: 0 }, { x: 9, y: 9 }], 1, 1), false);
  });
});

describe("geo.js — centroid()", () => {
  it("Schwerpunkt des Standard-Quadrats ist (400, 400)", () => {
    assert.deepEqual(centroid(PARZELLE), { x: 400, y: 400 });
  });

  it("Härtung: leer/null/undefined ⇒ {x:0, y:0}, nie NaN", () => {
    assert.deepEqual(centroid([]), { x: 0, y: 0 });
    assert.deepEqual(centroid(null), { x: 0, y: 0 });
    assert.deepEqual(centroid(undefined), { x: 0, y: 0 });
  });

  it("Einzelpunkt ist sein eigener Schwerpunkt", () => {
    assert.deepEqual(centroid([{ x: 7, y: 9 }]), { x: 7, y: 9 });
  });
});
