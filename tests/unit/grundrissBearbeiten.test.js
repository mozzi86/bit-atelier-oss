// Grundriss-Bedienung Teil 1, Punkt 2: dragging a wall end or typing its length keeps the openings in place
// (@core/lib/bauteil/grundrissBearbeiten.js). Expected positions are computed by hand in the comments; neutral test geometry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wandEndeVerschieben, wandLaengeSetzen, oeffnungInWandKlemmen, MIN_WAND_LAENGE_M, aufschlagZurKlickseite, innenSeiteVon } from "@core/lib/bauteil/grundrissBearbeiten.js";
import { OEFFNUNG_RAND_M } from "@core/lib/bauteil/oeffnungen.js";

// wall along +x, 6 m; one opening 1.00 m wide with its middle at u = 3 m (point (3, 0)); one opening of another wall
const WAND = { _idx: 1, a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.3 };
const OEF = [{ _idx: 10, wallIdx: 1, u: 3, kind: "door", width: 1 }, { _idx: 11, wallIdx: 2, u: 1, kind: "window", width: 1 }];
const u = (/** @type {any} */ r) => (r.ok ? r.oeffnungen[0].u : null);

describe("Wandende ziehen hält Öffnungen im Raum", () => {
  it("Anfang a nach rechts/links: u wird ab dem neuen Anfang gerechnet, die Mitte bleibt bei x = 3", () => {
    const r = wandEndeVerschieben(WAND, "a", { x: 1, z: 0 }, OEF);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.wand.a, { x: 1, z: 0 });
    assert.equal(u(r), 2); // 3 − 1
    assert.equal(r.ok && r.oeffnungen.length, 1, "nur die Öffnungen dieser Wand");
    assert.equal(u(wandEndeVerschieben(WAND, "a", { x: -2, z: 0 }, OEF)), 5); // 3 + 2
  });

  it("schräg gezogener Anfang: Projektion der alten Mitte auf die neue Achse", () => {
    // a' = (0, 3), b = (6, 0): direction (6, −3)/√45; (M − a') = (3, −3) → (18 + 9)/√45 = 4.0249 m
    assert.equal(u(wandEndeVerschieben(WAND, "a", { x: 0, z: 3 }, OEF)), 4.025);
  });

  it("geklemmt: Mitte mindestens halbe Breite + Randabstand von beiden Enden", () => {
    // a' = (2.8, 0): wanted u = 0.2, lower bound 0.5 + 0.05 = 0.55
    assert.equal(OEFFNUNG_RAND_M, 0.05);
    assert.equal(u(wandEndeVerschieben(WAND, "a", { x: 2.8, z: 0 }, OEF)), 0.55);
    // b' = (3, 0): u = 3 stays wanted, upper bound 3 − 0.55 = 2.45
    assert.equal(u(wandEndeVerschieben(WAND, "b", { x: 3, z: 0 }, OEF)), 2.45);
  });

  it("passt die Öffnung nicht mehr, sitzt sie mittig", () => {
    // a' = (5.5, 0): wall 0.5 m < 1.0 + 2 × 0.05 → middle 0.25
    assert.equal(u(wandEndeVerschieben(WAND, "a", { x: 5.5, z: 0 }, OEF)), 0.25);
    assert.equal(oeffnungInWandKlemmen(9, 2, 1), 0.5);
  });

  it("Ende b: u bleibt ab a, solange die Öffnung passt", () => {
    assert.equal(u(wandEndeVerschieben(WAND, "b", { x: 4, z: 0 }, OEF)), 3); // upper bound 3.45
    assert.equal(u(wandEndeVerschieben(WAND, "b", { x: 3, z: 4 }, OEF)), 3); // the wall turns, the opening turns with it
  });

  it("Wand mit Länge 0 (oder unter 5 cm) wird verweigert, das Eingabeobjekt bleibt unverändert", () => {
    const r = wandEndeVerschieben(WAND, "a", { x: 6, z: 0 }, OEF);
    assert.equal(r.ok, false);
    assert.equal(wandEndeVerschieben(WAND, "b", { x: 0.03, z: 0 }, OEF).ok, false);
    assert.equal(wandEndeVerschieben(WAND, "b", { x: NaN, z: 0 }, OEF).ok, false);
    assert.deepEqual(WAND.a, { x: 0, z: 0 });
    assert.equal(OEF[0].u, 3);
    assert.equal(MIN_WAND_LAENGE_M, 0.05);
  });

  it("Länge tippen: Anfang bleibt, Ende wandert in Wandrichtung, gleiche Öffnungsregel", () => {
    const r = wandLaengeSetzen(WAND, 10, OEF);
    assert.deepEqual(r.ok && r.wand.b, { x: 10, z: 0 });
    assert.deepEqual(r.ok && r.wand.a, { x: 0, z: 0 });
    assert.equal(u(r), 3);
    assert.equal(u(wandLaengeSetzen(WAND, 2.5, OEF)), 1.95); // 2.5 − 0.55
    const schraeg = wandLaengeSetzen({ ...WAND, b: { x: 3, z: 4 } }, 10, []); // 3-4-5 triangle doubled
    assert.deepEqual(schraeg.ok && schraeg.wand.b, { x: 6, z: 8 });
    assert.equal(wandLaengeSetzen(WAND, 0, OEF).ok, false);
    assert.equal(wandLaengeSetzen(WAND, Number("x"), OEF).ok, false);
  });
});

describe("Tür setzen: Aufschlag zur Klickseite", () => {
  // wall a = (0, 0) → b = (6, 0): +normal n = (−dz, dx) = (0, 1), i.e. +z (plan "south")
  const W = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 } };
  it("gezeichnete Wand (innen = +n): Klick auf +z → innen, auf −z → aussen, auf der Achse → innen", () => {
    assert.equal(aufschlagZurKlickseite(W, { x: 2, z: 0.4 }), "innen");
    assert.equal(aufschlagZurKlickseite(W, { x: 2, z: -0.4 }), "aussen");
    assert.equal(aufschlagZurKlickseite(W, { x: 2, z: 0 }), "innen");
    // reversed wall: n points to −z now
    assert.equal(aufschlagZurKlickseite({ a: W.b, b: W.a }, { x: 2, z: -0.4 }), "innen");
  });
  it("Hüllwand: innen ist die Seite der Grundrissmitte", () => {
    const fp = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: -4 }, { x: 0, z: -4 }]; // building on −z of the wall
    assert.equal(innenSeiteVon(W, fp), -1);
    assert.equal(innenSeiteVon(W, null), 1);
    assert.equal(aufschlagZurKlickseite(W, { x: 2, z: -0.4 }, innenSeiteVon(W, fp)), "innen", "Klick ins Gebäude");
    assert.equal(aufschlagZurKlickseite(W, { x: 2, z: 0.4 }, innenSeiteVon(W, fp)), "aussen", "Klick nach draußen");
  });
});
