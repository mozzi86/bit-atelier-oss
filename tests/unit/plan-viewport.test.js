// Unit-Tests für die pure Viewport-Mathe von usePlanViewport (Phase 34, PW-02a).
// Referenzverhalten = BimPlan2D vor der Extraktion (Zoom 0,3–12, Faktor 1,15).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zoomedAt, zoomedAroundCenter, zoomedToBBox, screenUnits, bildPxJeEinheit, zoomFuerPxJeEinheit, zoomedCentered, fuellSicht } from "@core/lib/usePlanViewport";

const nah = (ist, soll, eps = 1e-9, msg) =>
  assert.ok(Math.abs(ist - soll) < eps, `${msg || ""}: ${ist} ≠ ${soll}`);

const START = { zoom: 1, x: 0, y: 0 };

describe("usePlanViewport — screenUnits (75-01: Griffe in Bildschirm-Pixeln)", () => {
  it("bei renderedW = W ist 1 Bildschirm-px = 1/zoom viewBox-Einheiten", () => {
    nah(screenUnits(5, 1, 560, 560), 5);
    nah(screenUnits(5, 4, 560, 560), 1.25);
    nah(screenUnits(5, 8, 560, 560), 0.625);
  });
  it("Handrechnung: screenUnits(10, 2, 560, 700) = 4", () => {
    nah(screenUnits(10, 2, 560, 700), 4);
  });
  it("renderedW 0 fällt auf W zurück, zoom 0 auf 1", () => {
    nah(screenUnits(10, 1, 560, 0), 10);
    nah(screenUnits(10, 0, 560, 560), 10);
  });
});

describe("usePlanViewport — zoomedAt (Wheel-Zoom auf den Cursor)", () => {
  it("Anker-Invariante: der Punkt unterm Cursor bleibt unterm Cursor", () => {
    // Bildschirmposition eines Punkts loc: (loc − viewT.x) · zoom = const.
    const loc = { x: 123.4, y: 56.7 };
    let v = { zoom: 2, x: 40, y: 10 };
    const vorher = { sx: (loc.x - v.x) * v.zoom, sy: (loc.y - v.y) * v.zoom };
    v = zoomedAt(v, loc, 1.15, 0.3, 12);
    nah((loc.x - v.x) * v.zoom, vorher.sx, 1e-9, "x-Invariante");
    nah((loc.y - v.y) * v.zoom, vorher.sy, 1e-9, "y-Invariante");
  });

  it("rein → raus mit gleichem Faktor ist die Identität", () => {
    const loc = { x: 300, y: 200 };
    const hin = zoomedAt(START, loc, 1.15, 0.3, 12);
    const zurueck = zoomedAt(hin, loc, 1 / 1.15, 0.3, 12);
    nah(zurueck.zoom, 1);
    nah(zurueck.x, 0, 1e-9);
    nah(zurueck.y, 0, 1e-9);
  });

  it("Zoom klemmt an den Grenzen 0,3 und 12 (BimPlan2D-Bestand)", () => {
    let v = START;
    for (let i = 0; i < 40; i++) v = zoomedAt(v, { x: 0, y: 0 }, 1.15, 0.3, 12);
    assert.equal(v.zoom, 12);
    for (let i = 0; i < 80; i++) v = zoomedAt(v, { x: 0, y: 0 }, 1 / 1.15, 0.3, 12);
    assert.equal(v.zoom, 0.3);
  });

  it("am Clamp-Anschlag verschiebt sich nichts mehr (r = 1)", () => {
    const v = { zoom: 12, x: 5, y: 7 };
    const n = zoomedAt(v, { x: 100, y: 100 }, 1.15, 0.3, 12);
    assert.deepEqual(n, v);
  });
});

describe("usePlanViewport — zoomedAroundCenter (+/−-Buttons)", () => {
  it("die Sichtfeld-Mitte bleibt die Mitte", () => {
    const W = 620, H = 360;
    const v = { zoom: 2, x: 100, y: 50 };
    const mitte = { x: v.x + W / v.zoom / 2, y: v.y + H / v.zoom / 2 };
    const n = zoomedAroundCenter(v, W, H, 1.2, 0.3, 12);
    nah(n.x + W / n.zoom / 2, mitte.x, 1e-9, "Mitte x");
    nah(n.y + H / n.zoom / 2, mitte.y, 1e-9, "Mitte y");
  });
});

describe("usePlanViewport — zoomedToBBox (Zoom-auf-Auswahl)", () => {
  const W = 620, H = 360;

  it("BBox liegt zentriert und komplett im Sichtfeld", () => {
    const box = { x0: 100, y0: 80, x1: 220, y1: 160 };
    const v = zoomedToBBox(box, W, H, 30, 0.3, 12);
    const sichtW = W / v.zoom, sichtH = H / v.zoom;
    // zentriert
    nah(v.x + sichtW / 2, (box.x0 + box.x1) / 2, 1e-9, "Zentrum x");
    nah(v.y + sichtH / 2, (box.y0 + box.y1) / 2, 1e-9, "Zentrum y");
    // komplett sichtbar (inkl. Rand)
    assert.ok(v.x <= box.x0 && v.x + sichtW >= box.x1, "x-Ausdehnung sichtbar");
    assert.ok(v.y <= box.y0 && v.y + sichtH >= box.y1, "y-Ausdehnung sichtbar");
  });

  it("winzige BBox: Zoom klemmt bei maxZoom statt zu explodieren", () => {
    const v = zoomedToBBox({ x0: 10, y0: 10, x1: 10.01, y1: 10.01 }, W, H, 0, 0.3, 12);
    assert.equal(v.zoom, 12);
  });

  it("riesige BBox: Zoom klemmt bei minZoom", () => {
    const v = zoomedToBBox({ x0: -5000, y0: -5000, x1: 5000, y1: 5000 }, W, H, 30, 0.3, 12);
    assert.equal(v.zoom, 0.3);
  });

  it("degenerierte BBox (Punkt) nutzt die 10-Einheiten-Mindestgröße", () => {
    const v = zoomedToBBox({ x0: 50, y0: 50, x1: 50, y1: 50 }, W, H, 0, 0.3, 100);
    // Mindestgröße 10 Einheiten → Zoom = min(620, 360)/10 = 36
    nah(v.zoom, 36);
  });
});

// ---- 75-09 (MSB-16): Letterbox-korrekte Bildschirm-Skala -------------------------------
describe("usePlanViewport — bildPxJeEinheit (75-09, Letterbox)", () => {
  it("höhenbegrenzt: min(rw/W, rh/H) gewinnt — Handrechnung 1,3889", () => {
    // 790/488,6 = 1,6169 (Breite); 500/360 = 1,3889 (Höhe) ⇒ Höhe begrenzt.
    nah(bildPxJeEinheit(1, 488.6, 360, 790, 500), 500 / 360, 1e-9);
  });
  it("exakt eingepasst: rw/W = rh/H ⇒ Faktor 1 bei Zoom 1", () => {
    nah(bildPxJeEinheit(1, 500, 360, 500, 360), 1);
  });
  it("Zoom skaliert linear; renderedH 0 ⇒ reine Breitenformel (identisch zu 1/screenUnits)", () => {
    nah(bildPxJeEinheit(2, 500, 360, 1000, 0), 4);
    nah(bildPxJeEinheit(2, 500, 360, 1000, 0), 1 / screenUnits(1, 2, 500, 1000));
  });
  it("renderedW 0 ⇒ zoom (1 px je Einheit, Konvention wie screenUnits rw→W)", () => {
    nah(bildPxJeEinheit(3, 500, 360, 0, 360), 3);
  });
  it("breitenbegrenzt: rw/W < rh/H ⇒ Breite gewinnt", () => {
    nah(bildPxJeEinheit(1, 488.6, 360, 500, 900), 500 / 488.6, 1e-9);
  });
});

describe("usePlanViewport — zoomFuerPxJeEinheit (75-09, Umkehrung)", () => {
  it("Handrechnung: Ziel 2,7778 px/Einheit ⇒ Zoom 2", () => {
    nah(zoomFuerPxJeEinheit(2 * (500 / 360), 488.6, 360, 790, 500), 2, 1e-9);
  });
  it("Rundreise mit bildPxJeEinheit in jedem Zweig (|Δ| < 1e-9)", () => {
    const faelle = [
      [1, 488.6, 360, 790, 500],  // höhenbegrenzt
      [4, 500, 360, 1000, 0],     // renderedH 0
      [2, 500, 360, 0, 360],      // renderedW 0
      [1, 488.6, 360, 500, 900],  // breitenbegrenzt
    ];
    for (const [z, W, H, rw, rh] of faelle) {
      const px = bildPxJeEinheit(z, W, H, rw, rh);
      nah(zoomFuerPxJeEinheit(px, W, H, rw, rh), z, 1e-9, `Rundreise zoom=${z}`);
    }
  });
  it("ungültiges Ziel ⇒ 1 (kein Maßstabsmodus)", () => {
    assert.equal(zoomFuerPxJeEinheit(0, 500, 360, 500, 360), 1);
    assert.equal(zoomFuerPxJeEinheit(NaN, 500, 360, 500, 360), 1);
  });
});

describe("usePlanViewport — zoomedCentered (75-09)", () => {
  it("Zentrum liegt in der Sichtmitte: x + W/zoom/2 = zentrum.x", () => {
    const v = zoomedCentered(4, { x: 100, y: 80 }, 488.6, 360, 0.3, 48);
    assert.equal(v.zoom, 4);
    nah(v.x + 488.6 / v.zoom / 2, 100, 1e-9, "Mitte x");
    nah(v.y + 360 / v.zoom / 2, 80, 1e-9, "Mitte y");
  });
  it("Zoom klemmt auf maxZoom (und minZoom)", () => {
    assert.equal(zoomedCentered(999, { x: 0, y: 0 }, 500, 360, 0.3, 48).zoom, 48);
    assert.equal(zoomedCentered(0.01, { x: 0, y: 0 }, 500, 360, 0.3, 48).zoom, 0.3);
  });
});

describe("usePlanViewport — fuellSicht (75-16: Plan füllt die Fläche)", () => {
  it("Handrechnung: W 500 × H 100 in 1000 × 400 px → 500 × 200, y′ = −50", () => {
    const s = fuellSicht({ zoom: 1, x: 0, y: 0 }, 500, 100, 1000, 400);
    nah(s.x, 0); nah(s.y, -50); nah(s.w, 500); nah(s.h, 200);
  });
  it("Maßstab bleibt: px je Einheit = bildPxJeEinheit (1:50 exakt)", () => {
    const v = { zoom: 2.5, x: 40, y: 10 };
    const s = fuellSicht(v, 488.6, 360, 1300, 700);
    nah(1300 / s.w, bildPxJeEinheit(v.zoom, 488.6, 360, 1300, 700), 1e-9, "x");
    nah(700 / s.h, bildPxJeEinheit(v.zoom, 488.6, 360, 1300, 700), 1e-9, "y");
  });
  it("Mitte bleibt die Mitte ohne Füllen (Zoom/Pan unverändert gültig)", () => {
    const v = { zoom: 3, x: 120, y: 80 };
    const s = fuellSicht(v, 560, 430, 1350, 860);
    nah(s.x + s.w / 2, v.x + 560 / 3 / 2);
    nah(s.y + s.h / 2, v.y + 430 / 3 / 2);
  });
  it("ungemessen (0 px) → alte viewBox", () => {
    assert.deepEqual(fuellSicht({ zoom: 2, x: 5, y: 6 }, 560, 430, 0, 0), { x: 5, y: 6, w: 280, h: 215 });
  });
});
