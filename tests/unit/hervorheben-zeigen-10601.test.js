// Unit tests for packages/nova-core/src/lib/zeigen/hervorheben.js, part 2 (phase 106-01 review fixes):
// buffer bounds, partial GPU upload, outline cache, section planes, polygon offset, form report and
// the "!" symbol sprite (node has no document: a canvas stub is installed for those tests).
// Style: node:test, German titles.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { hervorhebung, umrissLinie } from "@core/lib/zeigen/hervorheben.js";

function einzelBox() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Two quads (elements A and B), 4 vertices and 6 indices each; ranges in index units A = {0, 6}, B = {6, 6}. */
function gemergtesMesh() {
  const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(24).fill(0.5), 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

const A = { start: 0, count: 6 };
const B = { start: 6, count: 6 };

describe("hervorhebung: Pufferbereich, Cache, Schnittebene, Versatz", () => {
  it("Bereich hinter dem Puffer wird mit Klartext abgelehnt (keine NaN-Farben)", () => {
    const mesh = gemergtesMesh();
    const h = hervorhebung();
    assert.throws(() => h.setzen({ mesh, bereich: { start: 6, count: 7 } }, "fokus"), /hinter dem Ende/);
    assert.throws(() => h.setzen({ mesh, bereich: { start: 12, count: 1 } }, "fokus"), /hinter dem Ende/);
    h.setzen({ mesh, bereich: { start: 6, count: 6 } }, "fokus"); // exactly to the end is fine
    h.alleLoeschen();
  });

  it("nur der berührte Teil des Farbpuffers wird zum Hochladen markiert (addUpdateRange)", () => {
    const mesh = gemergtesMesh();
    const attr = mesh.geometry.attributes.color;
    const h = hervorhebung();
    attr.clearUpdateRanges();
    // Element B uses vertices 4..7 = floats 12..23 of 24
    h.setzen({ mesh, bereich: B }, "fokus");
    assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[12, 12]]);
    attr.clearUpdateRanges();
    h.loeschen({ mesh, bereich: B });
    assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[12, 12]]);
  });

  it("der Umriss übernimmt die Schnittebenen des Mesh-Materials (auch bei Einzel-Mesh-Kopie)", () => {
    const ebene = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.2);
    const merged = gemergtesMesh();
    merged.material.clippingPlanes = [ebene];
    const einzel = einzelBox();
    einzel.material.clippingPlanes = [ebene];
    const h = hervorhebung();
    h.setzen({ mesh: merged, bereich: A }, "fokus");
    h.setzen({ mesh: einzel }, "warnung");
    assert.equal(merged.children[0].material.clippingPlanes[0], ebene, "dieselbe Ebene, damit sie live mitwandert");
    assert.equal(einzel.children[0].material.clippingPlanes[0], ebene, "nicht die kopierte Ebene des Material-Klons");
    h.alleLoeschen();
  });

  it("gemergtes Mesh: Polygon-Versatz nur solange ein Umriss darauf liegt, danach Originalwerte", () => {
    const mesh = gemergtesMesh();
    const mat = mesh.material;
    assert.equal(mat.polygonOffset, false);
    const h = hervorhebung();
    h.setzen({ mesh, bereich: A }, "fokus");
    h.setzen({ mesh, bereich: B }, "fokus");
    assert.equal(mat.polygonOffset, true);
    assert.equal(mat.polygonOffsetFactor, 1);
    h.loeschen({ mesh, bereich: A });
    assert.equal(mat.polygonOffset, true, "B liegt noch darauf");
    h.loeschen({ mesh, bereich: B });
    assert.equal(mat.polygonOffset, false);
    assert.equal(mat.polygonOffsetFactor, 0);
  });

  it("Kanten werden je Ziel gecacht: erneutes Hervorheben baut keine neue EdgesGeometry", () => {
    const mesh = gemergtesMesh();
    const h = hervorhebung();
    h.setzen({ mesh, bereich: A }, "fokus");
    const erste = mesh.children[0].geometry;
    h.loeschen({ mesh, bereich: A });
    h.setzen({ mesh, bereich: A }, "fokus");
    assert.equal(mesh.children[0].geometry, erste, "gleiche Geometrie aus dem Cache");
    h.verwerfen();
    assert.equal(h.aktive().length, 0);
    h.setzen({ mesh, bereich: A }, "fokus");
    assert.notEqual(mesh.children[0].geometry, erste, "nach verwerfen neu gebaut");
    h.verwerfen();
  });

  it("aktive() nennt die Form: Material des Umrisses und ob ein Symbol hängt", () => {
    const mesh = einzelBox();
    const h = hervorhebung();
    h.setzen({ mesh }, "warnung");
    h.setzen({ mesh }, "auswahl");
    const [w, a] = h.aktive();
    assert.equal(w.umriss, "LineDashedMaterial");
    assert.equal(a.umriss, "LineBasicMaterial");
    assert.equal(w.symbol, false);
    h.alleLoeschen();
  });
});

describe("umrissLinie", () => {
  it("baut den Umriss nach der Zustandstabelle und markiert ihn als Hilfsgeometrie", () => {
    const kanten = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const fokus = umrissLinie(kanten, "fokus");
    assert.ok(fokus.material.isLineDashedMaterial, "fokus gepunktet = Strich mit kurzen Strichen");
    assert.ok(fokus.material.dashSize < fokus.material.gapSize);
    assert.equal(fokus.userData.zeigeZustand, "fokus");
    const auswahl = umrissLinie(kanten, "auswahl", { schnittebenen: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)] });
    assert.ok(auswahl.material.isLineBasicMaterial && !auswahl.material.isLineDashedMaterial, "auswahl durchgezogen");
    assert.equal(auswahl.material.clippingPlanes.length, 1);
    assert.equal(auswahl.userData.zeigeHilfe, true);
  });
});

describe("hervorhebung: Fehler-Symbol (Canvas-Stub, kein document in node)", () => {
  /** Runs fn with a minimal document whose 2D context ignores every call but records the glyph. */
  function mitDocument(fn) {
    const gezeichnet = [];
    const ctx = new Proxy({}, { get: (_, k) => (k === "fillText" ? (t) => gezeichnet.push(t) : () => {}), set: () => true });
    const vorher = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try { fn(gezeichnet); } finally { if (vorher === undefined) delete globalThis.document; else globalThis.document = vorher; }
  }

  it("fehler hängt einen Sprite mit dem Zeichen an, warnung nicht; loeschen baut ihn ab", () => {
    mitDocument((gezeichnet) => {
      const mesh = einzelBox();
      const h = hervorhebung();
      h.setzen({ mesh }, "warnung");
      assert.equal(mesh.children.filter((c) => c.isSprite).length, 0);
      h.setzen({ mesh }, "fehler");
      const sprite = mesh.children.find((c) => c.isSprite);
      assert.ok(sprite, "Symbol-Sprite am Mesh");
      assert.deepEqual(gezeichnet, ["!"]);
      assert.equal(sprite.userData.zeigeHilfe, true);
      assert.ok(sprite.position.y > 0.5, "über der Oberkante der 1-m-Box (y-up)");
      assert.deepEqual(h.aktive().map((x) => x.symbol), [false, true]);
      let frei = 0;
      sprite.material.addEventListener("dispose", () => { frei += 1; });
      sprite.material.map.addEventListener("dispose", () => { frei += 1; });
      h.loeschen({ mesh }, "fehler");
      assert.equal(mesh.children.some((c) => c.isSprite), false);
      assert.equal(frei, 2, "Material und Textur freigegeben");
      h.alleLoeschen();
    });
  });

  it("Bereich im gemergten Mesh: Sprite sitzt über dem Bereich, nicht über dem ganzen Mesh", () => {
    mitDocument(() => {
      const mesh = gemergtesMesh();
      const h = hervorhebung();
      h.setzen({ mesh, bereich: B }, "fehler");
      const sprite = mesh.children.find((c) => c.isSprite);
      // element B spans x 2..3, y 0..1: the marker sits above its centre
      assert.ok(Math.abs(sprite.position.x - 2.5) < 1e-6);
      assert.ok(sprite.position.y > 1);
      h.alleLoeschen();
    });
  });
});
