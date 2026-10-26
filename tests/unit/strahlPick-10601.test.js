// Unit tests for packages/nova-core/src/lib/zeigen/strahlPick.js (phase 106-01).
// Style: node:test, German titles, hand calculation in comments. three runs in node (pure math, no WebGL).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { strahlPick, strahlAusZeiger, ndcAusEreignis, identitaetAus } from "@core/lib/zeigen/strahlPick.js";

/** Box 2 x 2 x 2 m centred at (cx, 0, 0): faces at x = cx - 1 and cx + 1. */
function box(cx, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  m.position.set(cx, 0, 0);
  m.name = name;
  m.updateMatrixWorld(true);
  return m;
}

const ENTLANG_X = { ursprung: [-10, 0, 0], richtung: [1, 0, 0] };

describe("strahlPick: Treffer", () => {
  it("trifft die Box: Punkt auf der Vorderfläche, Abstand in m, faceIndex gesetzt", () => {
    // Ray from x = -10 along +x, front face of the box at x = -1: distance 9 m.
    const m = box(0, "a");
    const t = strahlPick(m, ENTLANG_X);
    assert.ok(t);
    assert.equal(t.objekt, m);
    assert.ok(Math.abs(t.punkt[0] - -1) < 1e-9 && Math.abs(t.punkt[1]) < 1e-9);
    assert.ok(Math.abs(t.abstand - 9) < 1e-9);
    assert.ok(Number.isInteger(t.faceIndex));
    assert.equal(t.instanceId, null);
    assert.ok(t.roh && t.roh.object === m);
  });

  it("nimmt auch ein THREE.Ray und eine nicht normierte Richtung", () => {
    const m = box(0, "a");
    const a = strahlPick([m], new THREE.Ray(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(1, 0, 0)));
    const b = strahlPick([m], { ursprung: [-10, 0, 0], richtung: [5, 0, 0] });
    assert.ok(Math.abs(a.abstand - 9) < 1e-9);
    assert.ok(Math.abs(b.abstand - 9) < 1e-9);
  });

  it("Fehltreffer, Ziel hinter dem Ursprung und ungültiger Strahl liefern null", () => {
    const m = box(0, "a");
    assert.equal(strahlPick(m, { ursprung: [-10, 5, 0], richtung: [1, 0, 0] }), null);
    assert.equal(strahlPick(m, { ursprung: [-10, 0, 0], richtung: [-1, 0, 0] }), null);
    assert.equal(strahlPick(m, { ursprung: [-10, 0, 0], richtung: [0, 0, 0] }), null);
    assert.equal(strahlPick(m, { ursprung: [NaN, 0, 0], richtung: [1, 0, 0] }), null);
    assert.equal(strahlPick([], ENTLANG_X), null);
  });

  it("wählt von zwei Boxen die nähere", () => {
    const vorn = box(0, "vorn");
    const hinten = box(5, "hinten");
    assert.equal(strahlPick([hinten, vorn], ENTLANG_X).objekt, vorn);
  });

  it("reichweite begrenzt den Treffer in m", () => {
    assert.equal(strahlPick(box(0, "a"), ENTLANG_X, { reichweite: 5 }), null);
  });

  it("matrizenAktualisieren: ein verschobenes, nie gerendertes Objekt wird mit neuer Matrix getroffen", () => {
    // Box moved to x = 3 (faces 2..4) without updateMatrixWorld: the stale matrix still puts it at x = 0
    // (hit at -1, 9 m); with the flag the real position counts (hit at 2, 12 m).
    const m = box(0, "a");
    m.position.set(3, 0, 0);
    assert.ok(Math.abs(strahlPick(m, ENTLANG_X).abstand - 9) < 1e-9);
    assert.ok(Math.abs(strahlPick(m, ENTLANG_X, { matrizenAktualisieren: true }).abstand - 12) < 1e-9);
  });
});

describe("strahlPick: Schnittebene und Filter", () => {
  it("Schnittebene schließt den ersten Treffer aus und findet den nächsten", () => {
    // Boxes at x = 0 (faces -1..1) and x = 5 (faces 4..6). Plane keeps x >= 2 (normal +x, constant -2:
    // distance = x - 2). The first hit at x = -1 lies behind it; the next one at x = 4 is in front.
    const a = box(0, "a");
    const b = box(5, "b");
    const ebene = new THREE.Plane(new THREE.Vector3(1, 0, 0), -2);
    const t = strahlPick([a, b], ENTLANG_X, { schnittebenen: [ebene] });
    assert.ok(t);
    assert.equal(t.objekt, b);
    assert.ok(Math.abs(t.punkt[0] - 4) < 1e-9);
    assert.ok(Math.abs(t.abstand - 14) < 1e-9);
  });

  it("alle Ebenen müssen erfüllt sein; sind alle Treffer weggeschnitten, ist das Ergebnis null", () => {
    const a = box(0, "a");
    const vorn = new THREE.Plane(new THREE.Vector3(1, 0, 0), -2); // keeps x >= 2
    const hinten = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 3); // keeps x <= 3
    assert.equal(strahlPick(a, ENTLANG_X, { schnittebenen: [vorn, hinten] }), null);
    assert.equal(strahlPick(a, ENTLANG_X, { schnittebenen: [] }).objekt, a, "leere Liste = kein Schnitt");
  });

  it("die 'aus'-Ebene des IFC-Viewers (constant 1e7) schneidet nichts weg", () => {
    const aus = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e7);
    assert.ok(strahlPick(box(0, "a"), ENTLANG_X, { schnittebenen: [aus] }));
  });

  it("filter überspringt Treffer (z. B. ausgeblendete Bauteile)", () => {
    const a = box(0, "a");
    const b = box(5, "b");
    const t = strahlPick([a, b], ENTLANG_X, { filter: (h) => h.object.name !== "a" });
    assert.equal(t.objekt, b);
    assert.equal(strahlPick([a, b], ENTLANG_X, { filter: () => false }), null);
  });

  it("rekursiv trifft Kinder, ohne rekursiv nicht", () => {
    const gruppe = new THREE.Group();
    const kind = box(0, "kind");
    gruppe.add(kind);
    gruppe.updateMatrixWorld(true);
    assert.equal(strahlPick(gruppe, ENTLANG_X), null);
    assert.equal(strahlPick(gruppe, ENTLANG_X, { rekursiv: true }).objekt, kind);
  });
});

describe("strahlAusZeiger / ndcAusEreignis", () => {
  it("Perspektivkamera: Bildmitte zeigt auf die Box, Bildrand daneben", () => {
    const kam = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    kam.position.set(0, 0, 10);
    kam.lookAt(0, 0, 0);
    kam.updateMatrixWorld(true);
    const m = box(0, "a");
    const mitte = strahlAusZeiger(kam, 0, 0);
    assert.ok(Math.abs(mitte.richtung[2] - -1) < 1e-9, "Blick entlang -z");
    const t = strahlPick(m, mitte);
    assert.ok(t);
    assert.ok(Math.abs(t.abstand - 9) < 1e-9, "Vorderfläche bei z = 1, Kamera bei z = 10");
    assert.equal(strahlPick(m, strahlAusZeiger(kam, 0.95, 0.95)), null);
  });

  it("Orthokamera: Strahlen laufen parallel, Ursprung folgt dem Bildpunkt", () => {
    const kam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    kam.position.set(0, 0, 10);
    kam.lookAt(0, 0, 0);
    kam.updateMatrixWorld(true);
    const links = strahlAusZeiger(kam, -1, 0);
    assert.ok(Math.abs(links.ursprung[0] - -5) < 1e-9);
    assert.ok(Math.abs(links.richtung[2] - -1) < 1e-9);
  });

  it("ndcAusEreignis rechnet px in -1..1 um (y nach oben) und meldet leere Elemente als null", () => {
    // Canvas 200 x 100 px at (10, 20): centre = (110, 70) -> (0, 0); top-left = (10, 20) -> (-1, 1).
    const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) };
    assert.deepEqual(ndcAusEreignis(el, 110, 70), { x: 0, y: 0 });
    assert.deepEqual(ndcAusEreignis(el, 10, 20), { x: -1, y: 1 });
    assert.deepEqual(ndcAusEreignis(el, 210, 120), { x: 1, y: -1 });
    assert.equal(ndcAusEreignis({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }, 5, 5), null);
  });
});

describe("identitaetAus", () => {
  it("setzt den Treffer mit dem Auflöser des Viewers zur Identität zusammen", () => {
    const m = box(0, "wand");
    m.userData = { guid: "3Abc", kind: "wall" };
    const t = strahlPick(m, ENTLANG_X);
    const id = identitaetAus(t, (h) => ({ guid: h.objekt.userData.guid, userData: h.objekt.userData }));
    assert.equal(id.guid, "3Abc");
    assert.equal(id.expressId, null);
    assert.equal(id.objekt, m);
    assert.ok(Math.abs(id.abstand - 9) < 1e-9);
  });

  it("kein Treffer oder unbekannter Treffer wird abgelehnt, nicht geraten", () => {
    const t = strahlPick(box(0, "kontext"), ENTLANG_X);
    assert.equal(identitaetAus(null, () => ({ guid: "x" })), null);
    assert.equal(identitaetAus(t, () => null), null);
    assert.equal(identitaetAus(t, undefined), null);
  });
});
