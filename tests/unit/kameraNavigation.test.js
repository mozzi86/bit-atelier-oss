// Unit tests for kameraNavigation.js (quick task 261110-mzj): the calculation of the pointer-anchored 3D navigation —
// grip, pivot, orbit, pan, wheel step and stop, walk step per speed level, look-around.
// Style: node:test, German titles, hand calculation in comments. Geometry is abstract (unit distances), no project data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  DREH_TEMPO, ZOOM_SCHRITT, ZOOM_STOPP_M, LAUF_STUFEN, LAUF_STUFE_VORGABE, LAUF_SCHNELL_FAKTOR,
  mausGriff, kameraAchsen, zeigerStrahl, strahlAufEbene, ankerPunkt, drehWinkel, umPunktDrehen, schiebeVersatz,
  radRasten, zoomSchritt, blickWinkel, blickRichtung, umsehen, laufEingabe, laufSchritt, laufStufeSchalten, eingabeFokus,
  parallelHoehe, zeigerStrahlParallel, zoomParallel,
} from "@core/lib/zeigen/kameraNavigation.js";

const nah = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nahV = (a, b, eps = 1e-9) => { for (let i = 0; i < 3; i++) nah(a[i], b[i], eps); };
const laenge = (v) => Math.hypot(v[0], v[1], v[2]);

/** Screen position (NDC, y up) of a world point for a camera at `position` looking at `ziel` — three as the reference. */
function imBild(position, ziel, punkt, fovGrad = 50, seiten = 2) {
  const k = new THREE.PerspectiveCamera(fovGrad, seiten, 0.1, 5000);
  k.position.set(...position);
  k.lookAt(...ziel);
  k.updateMatrixWorld(true);
  const p = new THREE.Vector3(...punkt).project(k);
  return [p.x, p.y];
}

describe("Stellwerte", () => {
  it("entsprechen der Vorgabe", () => {
    assert.equal(DREH_TEMPO, 0.5);
    assert.equal(ZOOM_SCHRITT, 0.023);
    assert.equal(ZOOM_STOPP_M, 0.5);
    assert.deepEqual([...LAUF_STUFEN], [0.5, 1.4, 3, 6, 12]);
    assert.equal(LAUF_STUFEN[LAUF_STUFE_VORGABE], 1.4);
    assert.equal(LAUF_SCHNELL_FAKTOR, 3);
  });
});

describe("mausGriff", () => {
  it("links dreht, mit Umschalt/Cmd/Strg schiebt", () => {
    assert.equal(mausGriff({ button: 0 }), "drehen");
    assert.equal(mausGriff({ button: 0, shiftKey: true }), "schieben");
    assert.equal(mausGriff({ button: 0, metaKey: true }), "schieben");
    assert.equal(mausGriff({ button: 0, ctrlKey: true }), "schieben");
  });
  it("Mitte schiebt, Umschalt + Mitte dreht, rechts schiebt", () => {
    assert.equal(mausGriff({ button: 1 }), "schieben");
    assert.equal(mausGriff({ button: 1, shiftKey: true }), "drehen");
    assert.equal(mausGriff({ button: 2 }), "schieben");
    assert.equal(mausGriff({ button: 3 }), null);
  });
});

describe("Zeigerstrahl und Drehpunkt", () => {
  it("Bildmitte = Blickrichtung; Bildrand oben = halber Öffnungswinkel", () => {
    const a = { position: /** @type {[number, number, number]} */ ([0, 0, 10]), ziel: /** @type {[number, number, number]} */ ([0, 0, 0]), fovGrad: 90, seiten: 1 };
    nahV(zeigerStrahl({ ...a, ndcX: 0, ndcY: 0 }), [0, 0, -1]);
    // fov 90°: the top edge is 45° above the axis → (0, sin 45°, −cos 45°)
    nahV(zeigerStrahl({ ...a, ndcX: 0, ndcY: 1 }), [0, Math.SQRT1_2, -Math.SQRT1_2]);
    // the ray through a point's own screen position passes through that point (three as reference)
    const punkt = [3, -2, 1];
    const [x, y] = imBild([4, 6, 10], [0, 1, 0], punkt, 50, 2);
    const r = zeigerStrahl({ position: [4, 6, 10], ziel: [0, 1, 0], fovGrad: 50, seiten: 2, ndcX: x, ndcY: y });
    const weg = [punkt[0] - 4, punkt[1] - 6, punkt[2] - 10];
    nahV(r, weg.map((v) => v / laenge(weg)), 1e-6);
  });
  it("Strahl trifft die waagerechte Ebene – oder nicht", () => {
    // from 10 m height straight down onto y = 2: 8 m below
    nahV(strahlAufEbene([1, 10, 1], [0, -1, 0], 2), [1, 2, 1]);
    assert.equal(strahlAufEbene([0, 10, 0], [0, 1, 0], 2), null, "weg von der Ebene");
    assert.equal(strahlAufEbene([0, 10, 0], [1, 0, 0], 2), null, "parallel");
    assert.equal(strahlAufEbene([0, 10, 0], [Math.cos(0.001), -Math.sin(0.001), 0], 2), null, "jenseits der Reichweite (8 m / sin 0,001 = 8000 m)");
  });
  it("Bauteil unter dem Zeiger ist der Drehpunkt und merkt seine Höhe", () => {
    const a = ankerPunkt({ treffer: [5, 3, -2], ursprung: [0, 10, 10], richtung: [0, -1, 0], hoehe: 0, ersatzAbstand: 20 });
    assert.deepEqual(a, { punkt: [5, 3, -2], hoehe: 3, art: "bauteil" });
  });
  it("im Leeren: Punkt auf der Ebene in der gemerkten Höhe", () => {
    const a = ankerPunkt({ treffer: null, ursprung: [0, 10, 0], richtung: [0, -1, 0], hoehe: 3, ersatzAbstand: 20 });
    assert.equal(a.art, "ebene");
    nahV(a.punkt, [0, 3, 0]);
    assert.equal(a.hoehe, 3, "die Höhe bleibt, bis wieder ein Bauteil gegriffen wird");
  });
  it("in den Himmel: Punkt auf dem Strahl im Abstand des Ziels", () => {
    const a = ankerPunkt({ treffer: null, ursprung: [0, 10, 0], richtung: [0, 1, 0], hoehe: 3, ersatzAbstand: 20 });
    assert.equal(a.art, "ersatz");
    nahV(a.punkt, [0, 30, 0]);
  });
});

describe("Drehen um den Punkt unter dem Zeiger", () => {
  it("halbe Bildhöhe ziehen = Vierteldrehung", () => {
    // 2π · 0,5 · (300 / 600) = π / 2
    nah(drehWinkel(300, 0, 600).gier, Math.PI / 2);
    nah(drehWinkel(0, 300, 600).nick, Math.PI / 2);
    assert.deepEqual(drehWinkel(10, 10, 0), { gier: 0, nick: 0 });
  });
  it("der Drehpunkt bleibt an seiner Stelle im Bild, Abstände bleiben", () => {
    /** @type {[number, number, number]} */ const position = [12, 9, 14];
    /** @type {[number, number, number]} */ const ziel = [1, 2, 0];
    /** @type {[number, number, number]} */ const punkt = [4, 1, 3];
    const vorher = imBild(position, ziel, punkt);
    const neu = umPunktDrehen({ position, ziel, punkt, gier: 0.4, nick: -0.2 });
    const nachher = imBild(neu.position, neu.ziel, punkt);
    nah(nachher[0], vorher[0], 1e-6);
    nah(nachher[1], vorher[1], 1e-6);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    nah(d(neu.position, punkt), d(position, punkt), 1e-9);
    nah(d(neu.position, neu.ziel), d(position, ziel), 1e-9);
  });
  it("nach rechts ziehen dreht die Kamera nach links um die Hochachse", () => {
    // camera on +Z looking at the origin, pivot = origin, quarter turn: the camera ends on −X
    const neu = umPunktDrehen({ position: [0, 0, 10], ziel: [0, 0, 0], punkt: [0, 0, 0], gier: Math.PI / 2, nick: 0 });
    nahV(neu.position, [-10, 0, 0]);
    nahV(neu.ziel, [0, 0, 0]);
  });
  it("nach unten ziehen hebt die Kamera; kurz vor senkrecht ist Schluss", () => {
    const neu = umPunktDrehen({ position: [0, 0, 10], ziel: [0, 0, 0], punkt: [0, 0, 0], gier: 0, nick: Math.PI / 4 });
    nahV(neu.position, [0, 10 * Math.SQRT1_2, 10 * Math.SQRT1_2]);
    const oben = umPunktDrehen({ position: [0, 0, 10], ziel: [0, 0, 0], punkt: [0, 0, 0], gier: 0, nick: 5 });
    assert.ok(oben.position[1] > 9.99 && oben.position[2] > 0, "bleibt knapp vor dem Pol, kippt nicht über");
  });
});

describe("Schieben", () => {
  it("das Gegriffene bleibt unter dem Zeiger", () => {
    /** @type {[number, number, number]} */ const position = [6, 8, 12];
    /** @type {[number, number, number]} */ const ziel = [0, 1, 0];
    const punkt = [2, 0.5, 1], fovGrad = 50, seiten = 2, hoehePx = 600;
    const { vor, rechts, oben } = kameraAchsen(position, ziel);
    const tiefe = (punkt[0] - position[0]) * vor[0] + (punkt[1] - position[1]) * vor[1] + (punkt[2] - position[2]) * vor[2];
    const v = schiebeVersatz({ dxPx: 120, dyPx: -45, tiefe, fovGrad, hoehePx, rechts, oben });
    const vorher = imBild(position, ziel, punkt, fovGrad, seiten);
    const nachher = imBild(position.map((c, i) => c + v[i]), ziel.map((c, i) => c + v[i]), punkt, fovGrad, seiten);
    // NDC spans 2 over the height (600 px) and over the width (1200 px): 120 px right = +0,2; 45 px up = +0,15
    nah(nachher[0] - vorher[0], (120 / 1200) * 2, 1e-6);
    nah(nachher[1] - vorher[1], (45 / 600) * 2, 1e-6);
  });
  it("nah gegriffen = feine, weit gegriffen = große Bewegung", () => {
    const a = { dxPx: 100, dyPx: 0, fovGrad: 90, hoehePx: 1000, rechts: /** @type {[number, number, number]} */ ([1, 0, 0]), oben: /** @type {[number, number, number]} */ ([0, 1, 0]) };
    // fov 90°: picture height at depth t is 2 t → 100 px of 1000 px = 0,2 t
    nahV(schiebeVersatz({ ...a, tiefe: 1 }), [-0.2, 0, 0]);
    nahV(schiebeVersatz({ ...a, tiefe: 50 }), [-10, 0, 0]);
    assert.deepEqual(schiebeVersatz({ ...a, tiefe: 0 }), [0, 0, 0]);
  });
});

describe("Zoomen zur Maus", () => {
  it("eine Raste = 100 px bzw. 3 Zeilen, nie mehr als eine je Ereignis", () => {
    assert.equal(radRasten(-100), 1);
    assert.equal(radRasten(100), -1);
    assert.equal(radRasten(-25), 0.25);
    assert.equal(radRasten(-3, 1), 1);
    assert.equal(radRasten(-480), 1);
  });
  it("Schritt = 2,3 % des Abstands, auf den Punkt unter dem Zeiger zu", () => {
    // 100 m away: one notch = 2,3 m; 10 m away: 0,23 m
    nahV(zoomSchritt({ position: [0, 0, 100], punkt: [0, 0, 0], rasten: 1 }), [0, 0, -2.3]);
    nahV(zoomSchritt({ position: [0, 0, 10], punkt: [0, 0, 0], rasten: 1 }), [0, 0, -0.23]);
    // the direction is the one to the point, not the view axis
    const v = zoomSchritt({ position: [0, 0, 0], punkt: [30, 0, 40], rasten: 1 });
    nahV(v, [30 * 0.023, 0, 40 * 0.023]);
  });
  it("heraus: der Abstand wächst um 1 / (1 − 0,023)", () => {
    const v = zoomSchritt({ position: [0, 0, 100], punkt: [0, 0, 0], rasten: -1 });
    nah(v[2], 100 / (1 - 0.023) - 100);
  });
  it("etwa einen halben Meter vor dem Bauteil ist Schluss", () => {
    // 0,505 m away: 2,3 % would lead to 0,4934 m → stops at 0,5 m
    nahV(zoomSchritt({ position: [0, 0, 0.505], punkt: [0, 0, 0], rasten: 1 }), [0, 0, -0.005]);
    assert.deepEqual(zoomSchritt({ position: [0, 0, 0.5], punkt: [0, 0, 0], rasten: 1 }), [0, 0, 0]);
    assert.deepEqual(zoomSchritt({ position: [0, 0, 0.2], punkt: [0, 0, 0], rasten: 1 }), [0, 0, 0]);
    // 400 notches from 50 m never pass the stop
    let z = 50;
    for (let i = 0; i < 400; i++) z += zoomSchritt({ position: [0, 0, z], punkt: [0, 0, 0], rasten: 1 })[2];
    nah(z, 0.5);
    // away from the element it still moves
    assert.ok(zoomSchritt({ position: [0, 0, 0.2], punkt: [0, 0, 0], rasten: -1 })[2] > 0);
  });
});

describe("Lauf-Modus", () => {
  it("Tasten: WASD, Pfeile, Leertaste/E, C/Q, Umschalt", () => {
    assert.deepEqual(laufEingabe(["KeyW"]), { vor: 1, seit: 0, hoch: 0, schnell: false });
    assert.deepEqual(laufEingabe(["ArrowDown", "ArrowLeft"]), { vor: -1, seit: -1, hoch: 0, schnell: false });
    assert.deepEqual(laufEingabe(["KeyD", "Space", "ShiftLeft"]), { vor: 0, seit: 1, hoch: 1, schnell: true });
    assert.deepEqual(laufEingabe(["KeyE"]).hoch, 1);
    assert.deepEqual(laufEingabe(["KeyC"]).hoch, -1);
    assert.deepEqual(laufEingabe(["KeyQ"]).hoch, -1);
    assert.deepEqual(laufEingabe(["KeyW", "KeyS", "KeyX"]), { vor: 0, seit: 0, hoch: 0, schnell: false });
  });
  it("Schritt je Stufe: Weg = Tempo × Zeit", () => {
    for (const tempo of LAUF_STUFEN) {
      // one second forward along −Z
      nahV(laufSchritt({ vor: 1, seit: 0, hoch: 0, blick: [0, 0, -1], tempo, dt: 1 }), [0, 0, -tempo]);
      // a frame of 1/60 s
      nah(laenge(laufSchritt({ vor: 1, seit: 0, hoch: 0, blick: [0, 0, -1], tempo, dt: 1 / 60 })), tempo / 60);
    }
  });
  it("Umschalt = dreifach", () => {
    nahV(laufSchritt({ vor: 1, seit: 0, hoch: 0, blick: [0, 0, -1], tempo: 1.4, schnell: true, dt: 1 }), [0, 0, -4.2]);
  });
  it("W folgt dem Blick (auch hinunter), A/D bleiben waagerecht, Leertaste/C senkrecht", () => {
    const blick = blickRichtung(0, -Math.PI / 6); // 30° down, along −Z
    const v = laufSchritt({ vor: 1, seit: 0, hoch: 0, blick, tempo: 2, dt: 1 });
    nahV(v, [0, -1, -Math.sqrt(3)]);
    const seit = laufSchritt({ vor: 0, seit: 1, hoch: 0, blick, tempo: 2, dt: 1 });
    nahV(seit, [2, 0, 0]); // looking along −Z, right is +X
    nahV(laufSchritt({ vor: 0, seit: 0, hoch: 1, blick, tempo: 2, dt: 1 }), [0, 2, 0]);
    nahV(laufSchritt({ vor: 0, seit: 0, hoch: -1, blick, tempo: 2, dt: 1 }), [0, -2, 0]);
    nahV(laufSchritt({ vor: 0, seit: 0, hoch: 0, blick, tempo: 2, dt: 1 }), [0, 0, 0]);
  });
  it("mehrere Tasten zusammen sind nicht schneller als das Tempo", () => {
    nah(laenge(laufSchritt({ vor: 1, seit: 1, hoch: 1, blick: [0, 0, -1], tempo: 3, dt: 1 })), 3);
  });
  it("Stufen schalten und bleiben in der Liste", () => {
    assert.equal(laufStufeSchalten(1, 1), 2);
    assert.equal(laufStufeSchalten(1, -5), 0);
    assert.equal(laufStufeSchalten(0, -1), 0);
    assert.equal(laufStufeSchalten(4, 1), 4);
  });
  it("Blickwinkel hin und zurück; Umsehen folgt der Maus und stoppt vor senkrecht", () => {
    const w = blickWinkel([-3, 2, -5]);
    const l = Math.hypot(3, 2, 5);
    nahV(blickRichtung(w.gier, w.nick), [-3 / l, 2 / l, -5 / l]);
    nahV(blickRichtung(0, 0), [0, 0, -1]);
    // mouse to the right: the view turns right (towards +X when looking along −Z)
    const r = umsehen(0, 0, 100, 0);
    assert.ok(blickRichtung(r.gier, r.nick)[0] > 0);
    // mouse down: the view goes down
    assert.ok(umsehen(0, 0, 0, 100).nick < 0);
    assert.ok(Math.abs(umsehen(0, 0, 0, 1e6).nick) < Math.PI / 2);
  });
  it("Eingabefeld im Fokus: Tasten tun nichts im Modell", () => {
    assert.equal(eingabeFokus({ tagName: "INPUT" }), true);
    assert.equal(eingabeFokus({ tagName: "textarea" }), true);
    assert.equal(eingabeFokus({ tagName: "SELECT" }), true);
    assert.equal(eingabeFokus({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(eingabeFokus({ tagName: "BODY" }), false);
    assert.equal(eingabeFokus({ tagName: "CANVAS" }), false);
    assert.equal(eingabeFokus(null), false);
  });
});

describe("Parallelprojektion (Axonometrie)", () => {
  // camera 10 m in front of the origin on +Z, looking along −Z; fov 90° → tan(45°) = 1
  const POS = [0, 0, 10], ZIEL = [0, 0, 0];
  it("Bildhöhe folgt dem Abstand zum Ziel: 2 · 10 m · tan(45°) = 20 m", () => {
    nah(parallelHoehe(10, 90), 20);
    nah(parallelHoehe(5, 90), 10);
    assert.equal(parallelHoehe(0, 90), 0);
    assert.equal(parallelHoehe(-3, 90), 0);
  });
  it("Zeigerstrahl: Richtung bleibt die Blickrichtung, der Ursprung wandert im Bild", () => {
    const mitte = zeigerStrahlParallel({ position: POS, ziel: ZIEL, fovGrad: 90, seiten: 2, ndcX: 0, ndcY: 0 });
    nahV(mitte.ursprung, POS);
    nahV(mitte.richtung, [0, 0, -1]);
    // right edge: half height 10 m · aspect 2 = 20 m to the right; upper edge: 10 m up
    const ecke = zeigerStrahlParallel({ position: POS, ziel: ZIEL, fovGrad: 90, seiten: 2, ndcX: 1, ndcY: 1 });
    nahV(ecke.ursprung, [20, 10, 10]);
    nahV(ecke.richtung, [0, 0, -1]);
  });
  it("stimmt mit der orthografischen Kamera von three überein", () => {
    const pos = [12, 9, 7], ziel = [1, 2, -3], fov = 50, seiten = 1.6;
    const h = parallelHoehe(Math.hypot(11, 7, 10), fov);
    const cam = new THREE.OrthographicCamera((-h * seiten) / 2, (h * seiten) / 2, h / 2, -h / 2, -100, 100);
    cam.position.set(...pos); cam.lookAt(...ziel); cam.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0.4, -0.7), cam);
    const s = zeigerStrahlParallel({ position: pos, ziel, fovGrad: fov, seiten, ndcX: 0.4, ndcY: -0.7 });
    nahV(s.richtung, ray.ray.direction.toArray(), 1e-9);
    // three starts the ray on the near plane (100 m behind the camera plane): same line, shifted along the direction
    const d = ray.ray.origin.toArray().map((v, i) => s.ursprung[i] - v);
    const entlang = d[0] * s.richtung[0] + d[1] * s.richtung[1] + d[2] * s.richtung[2];
    nahV(d, s.richtung.map((v) => v * entlang), 1e-9);
  });
  it("Rad: Punkt unter dem Zeiger bleibt an seiner Bildstelle, Blickrichtung bleibt", () => {
    // point 2 m right of the target; one notch closer → factor 0.977
    const neu = zoomParallel({ position: POS, ziel: ZIEL, punkt: [2, 0, 0], rasten: 1 });
    nahV(neu.ziel, [2 * ZOOM_SCHRITT, 0, 0]); // 0.046 m to the right
    nahV(neu.position, [2 * ZOOM_SCHRITT, 0, 10 * (1 - ZOOM_SCHRITT)]); // distance 9.77 m
    // share of the half picture before and after: 2 / 10 and (2 − 0.046) / 9.77
    nah(2 / 10, (2 - neu.ziel[0]) / (neu.position[2] - neu.ziel[2]));
    // a point in the picture centre only changes the distance, whatever its depth
    const mitte = zoomParallel({ position: POS, ziel: ZIEL, punkt: [0, 0, -40], rasten: -1 });
    nahV(mitte.ziel, ZIEL);
    nahV(mitte.position, [0, 0, 10 / (1 - ZOOM_SCHRITT)]);
  });
  it("Rad hält am Stopp und tut ohne Raste nichts", () => {
    const nahe = zoomParallel({ position: [0, 0, ZOOM_STOPP_M], ziel: ZIEL, punkt: [1, 0, 0], rasten: 1 });
    nahV(nahe.position, [0, 0, ZOOM_STOPP_M]);
    nahV(nahe.ziel, ZIEL);
    const knapp = zoomParallel({ position: [0, 0, ZOOM_STOPP_M * 1.01], ziel: ZIEL, punkt: [0, 0, 0], rasten: 1 });
    nah(knapp.position[2], ZOOM_STOPP_M);
    const ohne = zoomParallel({ position: POS, ziel: ZIEL, punkt: [3, 3, 3], rasten: 0 });
    nahV(ohne.position, POS);
  });
});
