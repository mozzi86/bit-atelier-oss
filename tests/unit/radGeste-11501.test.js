// Unit tests for radGeste.js (plan 115-01): what a wheel event means on a drawing surface — mouse wheel (zoom, one step
// per event as before), trackpad pinch (zoom in proportion to the fingers), two-finger swipe (pan, orbit with Shift in 3D).
// Style: node:test, German titles, hand calculation in comments. The event values are the ones browsers were seen to send
// ([ASSUMED], see the header of radGeste.js); no project data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RAD_FAKTOR, PINCH_JE_PX, PINCH_MAX_FAKTOR, RAD_GANZ_MIN_PX, GESTE_FOLGE_MS, radGeste, radGestenLeser,
} from "@core/lib/radGeste.js";
import { ZOOM_SCHRITT, radRasten, rastenAusFaktor, zoomSchritt } from "@core/lib/zeigen/kameraNavigation.js";
import { panned, zoomedAt } from "@core/lib/usePlanViewport";

const nah = (ist, soll, eps = 1e-9) => assert.ok(Math.abs(ist - soll) <= eps, `${ist} ≉ ${soll}`);

describe("Stellwerte", () => {
  it("Rad 1,15 je Ereignis, Pinch 0,01 je px, höchstens ein Radschritt je Pinch-Ereignis", () => {
    assert.equal(RAD_FAKTOR, 1.15);
    assert.equal(PINCH_JE_PX, 0.01);
    assert.equal(PINCH_MAX_FAKTOR, 1.15);
    assert.equal(RAD_GANZ_MIN_PX, 100);
    assert.equal(GESTE_FOLGE_MS, 120);
  });
});

describe("Mausrad — zoomt wie bisher, ein Schritt je Ereignis", () => {
  it("Raste in Pixeln (Chrome/Windows: 100 px, wheelDelta 120): Faktor 1,15 bzw. 1/1,15, eine Raste", () => {
    const rein = radGeste({ deltaX: 0, deltaY: -100, deltaMode: 0, wheelDeltaY: 120 });
    assert.deepEqual(rein, { art: "zoom", quelle: "rad", faktor: 1.15, rasten: 1, dx: 0, dy: 0 });
    const raus = radGeste({ deltaX: 0, deltaY: 100, deltaMode: 0, wheelDeltaY: -120 });
    assert.equal(raus.art, "zoom");
    nah(raus.faktor, 1 / 1.15);
    assert.equal(raus.rasten, -1);
  });
  it("Raste in Zeilen (Firefox: deltaMode 1, 3 Zeilen) ist immer ein Mausrad", () => {
    const g = radGeste({ deltaY: -3, deltaMode: 1 });
    assert.deepEqual([g.art, g.quelle, g.faktor, g.rasten], ["zoom", "rad", 1.15, 1]);
    assert.equal(radGeste({ deltaY: 1, deltaMode: 2 }).quelle, "rad"); // pages
  });
  it("macOS-Maus (kleines deltaY, wheelDelta 120) und skalierter Bildschirm (80 px) bleiben Mausrad", () => {
    const mac = radGeste({ deltaY: 4.000244140625, wheelDeltaY: -120 });
    assert.deepEqual([mac.art, mac.quelle], ["zoom", "rad"]);
    nah(mac.faktor, 1 / 1.15); // 2D: one step per event, whatever the size
    nah(mac.rasten, radRasten(4.000244140625)); // 3D: −0.04 notches, the value the camera used before
    assert.equal(radGeste({ deltaY: -80, wheelDeltaY: 120 }).quelle, "rad");
    assert.equal(radGeste({ deltaY: -111.11, wheelDeltaY: 120 }).quelle, "rad");
  });
  it("Ereignisse ohne brauchbares wheelDelta: ganze Schritte ab 100 px sind ein Mausrad (Tests, Automatisierung)", () => {
    assert.equal(radGeste({ deltaY: -100 }).art, "zoom");
    assert.equal(radGeste({ deltaY: 120 }).quelle, "rad");
    assert.equal(radGeste({ deltaY: 400, wheelDeltaY: -400 }).quelle, "rad"); // page.mouse.wheel(0, 400)
  });
  it("fünf Rasten ergeben denselben Gesamtzoom wie vorher: 1,15^5 = 2,0114", () => {
    let v = { zoom: 1, x: 0, y: 0 };
    for (let i = 0; i < 5; i++) v = zoomedAt(v, { x: 50, y: 50 }, radGeste({ deltaY: -100, wheelDeltaY: 120 }).faktor, 0.3, 12);
    nah(v.zoom, 1.15 ** 5);
    nah(v.zoom, 2.0113571875);
  });
  it("radFaktor der Fläche wird übernommen", () => {
    nah(radGeste({ deltaY: -100 }, { radFaktor: 1.2 }).faktor, 1.2);
    nah(radGeste({ deltaY: 100 }, { radFaktor: 1.2 }).faktor, 1 / 1.2);
  });
  it("Umschalt + Mausrad (Browser liefern reines deltaX) zoomt nach Richtung, schiebt nie", () => {
    const g = radGeste({ deltaX: -100, deltaY: 0, shiftKey: true, wheelDeltaX: 120, wheelDeltaY: 0 }, { umschaltDreht: true });
    assert.deepEqual([g.art, g.quelle, g.faktor, g.rasten], ["zoom", "rad", 1.15, 1]);
  });
  it("Ereignis ohne Bewegung: nichts", () => {
    assert.equal(radGeste({ deltaX: 0, deltaY: 0 }).art, "nichts");
    assert.equal(radGeste({ deltaY: 0, deltaMode: 1 }).art, "nichts");
    assert.equal(radGeste({}).art, "nichts");
  });
});

describe("Zwei-Finger-Wischen — schiebt, zoomt nicht", () => {
  it("eine Wischfolge (kleine, teils gebrochene Werte, mit deltaX) ist durchgehend Schieben; die Wege summieren sich", () => {
    // 30 events as a trackpad sends them: rising and falling, a little sideways drift
    const folge = Array.from({ length: 30 }, (_, i) => {
      const dy = Math.round((2 + 14 * Math.sin((Math.PI * (i + 1)) / 31)) * 4) / 4; // 2 … 16 px in quarter steps
      return { deltaX: i % 3 === 0 ? -0.5 : 0.25, deltaY: dy, deltaMode: 0, wheelDeltaX: 0, wheelDeltaY: -Math.round(dy * 1.2) };
    });
    const lesen = radGestenLeser();
    let dx = 0, dy = 0, zoom = 1;
    folge.forEach((e, i) => {
      const g = lesen({ ...e, timeStamp: 1000 + i * 16 });
      assert.equal(g.art, "schieben", `Ereignis ${i}`);
      assert.equal(g.quelle, "trackpad");
      dx += g.dx; dy += g.dy; zoom *= g.faktor;
    });
    assert.equal(zoom, 1); // before 115-01: 1/1.15^30 = 0.0151, the plan shrank to 1.5 %
    nah(dx, folge.reduce((s, e) => s + e.deltaX, 0));
    nah(dy, folge.reduce((s, e) => s + e.deltaY, 0));
    assert.ok(dy > 250 && dy < 350, `Weg ${dy} px`); // ≈ 327 px
  });
  it("macOS-Trackpad (wheelDelta = 3 · delta) ist Schieben, auch bei 40 px (wheelDelta 120) und im Schwung (120 px)", () => {
    assert.equal(radGeste({ deltaX: 0, deltaY: 12, wheelDeltaY: -36 }).art, "schieben");
    assert.equal(radGeste({ deltaX: 0, deltaY: 40, wheelDeltaY: -120 }).art, "schieben");
    assert.equal(radGeste({ deltaX: 0, deltaY: 120, wheelDeltaY: -360 }).art, "schieben");
    assert.equal(radGeste({ deltaX: 0, deltaY: -7, wheelDeltaY: 21 }).dy, -7);
  });
  it("rein seitliches Wischen und Kipprad schieben waagerecht", () => {
    assert.deepEqual(radGeste({ deltaX: 8.5, deltaY: 0, wheelDeltaX: -25 }), { art: "schieben", quelle: "trackpad", faktor: 1, rasten: 0, dx: 8.5, dy: 0 });
    assert.equal(radGeste({ deltaX: 100, deltaY: 0, wheelDeltaX: -120 }).art, "schieben");
  });
  it("ein einzelner 100-px-Wert mitten im Wischen bleibt Schieben (Leser merkt sich die laufende Geste)", () => {
    const lesen = radGestenLeser();
    assert.equal(lesen({ deltaY: 62.5, wheelDeltaY: -75, timeStamp: 0 }).art, "schieben");
    assert.equal(lesen({ deltaY: 100, wheelDeltaY: -120, timeStamp: 16 }).art, "schieben");
    assert.equal(lesen({ deltaY: 100, wheelDeltaY: -120, timeStamp: 32 }).art, "schieben");
    // without the memory the same values are a wheel notch — and after a pause they are one again
    assert.equal(radGeste({ deltaY: 100, wheelDeltaY: -120 }).art, "zoom");
    assert.equal(lesen({ deltaY: 100, wheelDeltaY: -120, timeStamp: 32 + GESTE_FOLGE_MS }).art, "zoom");
  });
  it("ein 40-px-Wert mitten in schnellem Raddrehen (macOS-Maus) bleibt Zoom", () => {
    const lesen = radGestenLeser();
    assert.equal(lesen({ deltaY: 12.000732421875, wheelDeltaY: -120, timeStamp: 0 }).quelle, "rad");
    const g = lesen({ deltaY: 40, wheelDeltaY: -120, timeStamp: 40 });
    assert.deepEqual([g.art, g.quelle], ["zoom", "rad"]);
    // a clear trackpad value right after it starts a swipe all the same
    assert.equal(lesen({ deltaY: 3, wheelDeltaY: -9, timeStamp: 60 }).art, "schieben");
  });
  it("Zeilenmodus bleibt Mausrad, auch direkt nach einem Wischen", () => {
    const lesen = radGestenLeser();
    lesen({ deltaY: 5, wheelDeltaY: -15, timeStamp: 0 });
    assert.equal(lesen({ deltaY: -3, deltaMode: 1, timeStamp: 10 }).quelle, "rad");
  });
  it("Umschalt + Wischen: 3D-Kamera dreht (Annahme), 2D-Flächen schieben", () => {
    const e = { deltaX: 6, deltaY: -4.5, shiftKey: true, wheelDeltaX: -18, wheelDeltaY: 13 };
    assert.deepEqual(radGeste(e, { umschaltDreht: true }), { art: "drehen", quelle: "trackpad", faktor: 1, rasten: 0, dx: 6, dy: -4.5 });
    assert.equal(radGeste(e).art, "schieben");
    assert.equal(radGeste({ ...e, shiftKey: false }, { umschaltDreht: true }).art, "schieben");
  });
  it("panned(): die Sicht wandert um den Weg, der Zoom bleibt", () => {
    assert.deepEqual(panned({ zoom: 2, x: 10, y: -5 }, 3, 4), { zoom: 2, x: 13, y: -1 });
  });
});

describe("Pinch — zoomt im Maß der Fingerbewegung", () => {
  const pinch = (deltaY) => ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: true, wheelDeltaY: -Math.round(deltaY * 3) || 0 });
  it("20 kleine Ereignisse (je −2,5 px): je e^0,025 = 1,0253, zusammen e^0,5 = 1,6487 — vorher 1,15^20 = 16,37", () => {
    const lesen = radGestenLeser();
    let zoom = 1;
    for (let i = 0; i < 20; i++) {
      const g = lesen({ ...pinch(-2.5), timeStamp: i * 16 });
      assert.deepEqual([g.art, g.quelle, g.rasten], ["zoom", "pinch", 0]);
      nah(g.faktor, Math.exp(0.025));
      zoom *= g.faktor;
    }
    nah(zoom, Math.exp(0.5), 1e-9);
    assert.ok(zoom > 1.5 && zoom < 1.8, `Gesamtzoom ${zoom}`); // 1.6487
    nah(1.15 ** 20, 16.3665, 1e-4); // what the same gesture did before
  });
  it("Finger zusammen (je +2,5 px): zusammen e^−0,5 = 0,6065", () => {
    let zoom = 1;
    for (let i = 0; i < 20; i++) zoom *= radGeste(pinch(2.5)).faktor;
    nah(zoom, Math.exp(-0.5));
  });
  it("ein Ereignis zoomt höchstens um einen Radschritt (1,15)", () => {
    nah(radGeste(pinch(-60)).faktor, 1.15); // e^0.6 = 1.82 without the limit
    nah(radGeste(pinch(60)).faktor, 1 / 1.15);
    nah(radGeste(pinch(-13)).faktor, Math.exp(0.13)); // below the limit ln 1.15 = 0.1398
  });
  it("Pinch ohne Bewegung: nichts", () => {
    assert.deepEqual(radGeste({ deltaY: 0, ctrlKey: true }), { art: "nichts", quelle: "pinch", faktor: 1, rasten: 0, dx: 0, dy: 0 });
  });
});

describe("Strg + Mausrad — zoomt im Radtempo, nicht als Pinch", () => {
  it("gerastete Werte mit Strg sind ein Mausrad", () => {
    const g = radGeste({ deltaY: -100, wheelDeltaY: 120, ctrlKey: true });
    assert.deepEqual([g.art, g.quelle, g.faktor, g.rasten], ["zoom", "rad", 1.15, 1]);
    assert.equal(radGeste({ deltaY: 3, deltaMode: 1, ctrlKey: true }).quelle, "rad");
  });
  it("kleine Werte mit Strg sind ein Pinch", () => {
    assert.equal(radGeste({ deltaY: -1.75, wheelDeltaY: 5, ctrlKey: true }).quelle, "pinch");
  });
});

describe("3D-Kamera — Pinch in Rasten", () => {
  it("rastenAusFaktor: 1,15 → 6,006 Rasten; (1 − 0,023)^Rasten = 1/Faktor", () => {
    // ln 1.15 / −ln 0.977 = 0.139762 / 0.023269 = 6.0064
    nah(rastenAusFaktor(1.15), 6.0064, 1e-3);
    nah((1 - ZOOM_SCHRITT) ** rastenAusFaktor(1.15), 1 / 1.15);
    assert.equal(rastenAusFaktor(1), 0);
    assert.ok(rastenAusFaktor(0.8) < 0);
    assert.equal(rastenAusFaktor(0), 0);
    assert.equal(rastenAusFaktor(NaN), 0);
  });
  it("20 Pinch-Ereignisse (zusammen Faktor 1,6487) holen einen Punkt in 100 m auf 100 / 1,6487 = 60,65 m heran", () => {
    let z = 100;
    for (let i = 0; i < 20; i++) {
      const g = radGeste({ deltaY: -2.5, ctrlKey: true });
      z += zoomSchritt({ position: [0, 0, z], punkt: [0, 0, 0], rasten: rastenAusFaktor(g.faktor) })[2];
    }
    nah(z, 100 / Math.exp(0.5), 1e-9);
    nah(z, 60.6531, 1e-4);
  });
});
