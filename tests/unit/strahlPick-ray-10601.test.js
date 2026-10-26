// Unit tests for strahlPick.js, part 2 (phase 106-01 review fixes): the THREE.Ray form (the road of
// a VR controller or a pen: no camera), ray validation, guidPflicht and the pick budget.
// Style: node:test, German titles, hand calculation in comments.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { strahlPick, strahlAusZeiger, identitaetAus, pickDrossel } from "@core/lib/zeigen/strahlPick.js";

/** Box 2 x 2 x 2 m centred at (cx, 0, 0): faces at x = cx - 1 and cx + 1. */
function box(cx) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  m.position.set(cx, 0, 0);
  m.updateMatrixWorld(true);
  return m;
}

describe("strahlPick: THREE.Ray wie ein einfacher Strahl behandelt", () => {
  it("eine kurze oder lange Richtung wird normiert: gleicher Treffer wie mit Einheitsrichtung", () => {
    // Front face at x = -1, origin x = -10: distance 9 m for every direction length.
    const m = box(0);
    for (const laenge of [0.01, 0.2, 1, 7]) {
      const t = strahlPick(m, new THREE.Ray(new THREE.Vector3(-10, 0.9, 0), new THREE.Vector3(laenge, 0, 0)));
      assert.ok(t, `Richtung ${laenge} trifft`);
      assert.ok(Math.abs(t.abstand - 9) < 1e-9, `Richtung ${laenge}: Abstand ${t.abstand}`);
    }
  });

  it("der übergebene Ray wird nicht verändert (kein Normieren am Original)", () => {
    const ray = new THREE.Ray(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(5, 0, 0));
    strahlPick(box(0), ray);
    assert.equal(ray.direction.x, 5);
    assert.equal(ray.origin.x, -10);
  });

  it("NaN im Ursprung oder in der Richtung, Null-Richtung und Infinity sind ein Fehltreffer", () => {
    const m = box(0);
    assert.equal(strahlPick(m, new THREE.Ray(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(1, 0, 0))), null);
    assert.equal(strahlPick(m, new THREE.Ray(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(NaN, 0, 0))), null);
    assert.equal(strahlPick(m, new THREE.Ray(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(0, 0, 0))), null);
    assert.equal(strahlPick(m, new THREE.Ray(new THREE.Vector3(-Infinity, 0, 0), new THREE.Vector3(1, 0, 0))), null);
  });

  it("fehlender Strahl und Strahl ohne Felder sind ein Fehltreffer, kein Wurf", () => {
    const m = box(0);
    assert.equal(strahlPick(m, null), null);
    assert.equal(strahlPick(m, {}), null);
    assert.equal(strahlPick(m, { ursprung: [0, 0, 0] }), null);
  });

  it("zwei Controller-Strahlen ohne Kamera: jeder trifft sein Bauteil, ein verfehlender liefert null", () => {
    // Two boxes side by side at x = 0 and x = 10; two parallel rays at z = 0 from the left.
    const links = box(0);
    const rechts = box(10);
    const a = strahlPick([links, rechts], new THREE.Ray(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0)));
    assert.equal(a.objekt, links);
    // second ray starts between the boxes (x = 4) and travels +x: hits the right box at x = 9 (5 m)
    const b = strahlPick([links, rechts], new THREE.Ray(new THREE.Vector3(4, 0, 0), new THREE.Vector3(1, 0, 0)));
    assert.equal(b.objekt, rechts);
    assert.ok(Math.abs(b.abstand - 5) < 1e-9);
    // a ray above both boxes misses; no camera is involved anywhere
    assert.equal(strahlPick([links, rechts], new THREE.Ray(new THREE.Vector3(-5, 5, 0), new THREE.Vector3(1, 0, 0))), null);
  });

  it("derselbe Strahl als THREE.Ray und als {ursprung, richtung} liefert denselben Treffer", () => {
    const m = box(0);
    const o = [-10, 0.3, 0.2];
    const d = [3, 0.01, 0];
    const a = strahlPick(m, new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d)));
    const b = strahlPick(m, { ursprung: o, richtung: d });
    assert.deepEqual(a.punkt, b.punkt);
    assert.equal(a.abstand, b.abstand);
  });
});

describe("strahlAusZeiger: gemeinsame Objekte, kein Kamera-Rest", () => {
  it("wiederholte Aufrufe liefern unabhängige Ergebnis-Arrays und der Raycaster behält keine Kamera für Sprites", () => {
    const kam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    kam.position.set(0, 0, 10);
    kam.lookAt(0, 0, 0);
    kam.updateMatrixWorld(true);
    const eins = strahlAusZeiger(kam, 0, 0);
    const zwei = strahlAusZeiger(kam, 0.5, 0);
    assert.notEqual(eins.richtung, zwei.richtung);
    assert.ok(Math.abs(eins.richtung[0]) < 1e-9, "Bildmitte: keine seitliche Komponente");
    assert.ok(zwei.richtung[0] > 0.1, "rechts vom Bildmittelpunkt");
    // a hit afterwards without a camera option must not see the camera of the previous call
    assert.ok(strahlPick(box(0), eins));
  });
});

describe("identitaetAus: guidPflicht", () => {
  it("ein bekannter Treffer ohne GUID wird mit guidPflicht abgelehnt, ohne Option bleibt er erhalten", () => {
    const t = strahlPick(box(0), { ursprung: [-10, 0, 0], richtung: [1, 0, 0] });
    const ohneGuid = () => ({ guid: null, expressId: 7 });
    assert.equal(identitaetAus(t, ohneGuid).expressId, 7, "Klickpfad: weiter wie bisher");
    assert.equal(identitaetAus(t, ohneGuid, { guidPflicht: true }), null);
    assert.equal(identitaetAus(t, () => ({ guid: "" }), { guidPflicht: true }), null, "leere GUID zählt nicht");
    assert.equal(identitaetAus(t, () => ({ guid: "3AbcDefGhiJklMnoPqrSt0" }), { guidPflicht: true }).guid, "3AbcDefGhiJklMnoPqrSt0");
  });
});

describe("pickDrossel", () => {
  it("schnelle Picks bremsen nie, ein langsamer Pick verzögert den nächsten um das Dreifache seiner Dauer", () => {
    const d = pickDrossel({ budgetMs: 8, faktor: 3 });
    assert.ok(d.darf(0));
    d.messen(3, 100); // fast
    assert.ok(d.darf(100.1));
    d.messen(20, 200); // slow: next pick no earlier than 200 + 60 = 260 ms
    assert.equal(d.darf(259), false);
    assert.equal(d.darf(260), true);
    d.messen(2, 300); // fast again: the brake is released
    assert.ok(d.darf(300.5));
  });
});
