// Unit tests for packages/nova-core/src/lib/zeigen/hervorheben.js and zustaende.js (phase 106-01).
// Style: node:test, German titles. three runs in node; there is no document, so the symbol tests (second
// file hervorheben-zeigen-10601.test.js) install a canvas stub.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { hervorhebung } from "@core/lib/zeigen/hervorheben.js";
import { ZEIGE_ZUSTAENDE, ZEIGE_ZUSTAND_NAMEN, istZeigeZustand } from "@core/lib/zeigen/zustaende.js";

/** Single box with a standard material (has emissive). */
function einzelBox() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * Merged mesh with two quads (elements A and B), 4 vertices and 6 indices each, vertex colours grey.
 * Ranges in index units: A = {0, 6}, B = {6, 6}.
 */
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
const farbe = (mesh, v) => [0, 1, 2].map((k) => mesh.geometry.attributes.color.array[v * 3 + k]);

describe("zustaende: Tabelle", () => {
  it("vier Zustände, eingefroren, hex passt zu rgb, jeder mit Form-Merkmal oder Symbol", () => {
    assert.deepEqual([...ZEIGE_ZUSTAND_NAMEN], ["fokus", "auswahl", "warnung", "fehler"]);
    assert.ok(Object.isFrozen(ZEIGE_ZUSTAENDE) && Object.isFrozen(ZEIGE_ZUSTAENDE.fokus) && Object.isFrozen(ZEIGE_ZUSTAENDE.fokus.rgb));
    for (const n of ZEIGE_ZUSTAND_NAMEN) {
      const z = ZEIGE_ZUSTAENDE[n];
      assert.match(z.hex, /^#[0-9a-f]{6}$/);
      const num = parseInt(z.hex.slice(1), 16);
      const rgb = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((v) => v / 255);
      z.rgb.forEach((v, i) => assert.ok(Math.abs(v - rgb[i]) < 1e-9));
      assert.equal(z.umriss === "durchgezogen", z.strich === null, `${n}: Strich nur bei nicht durchgezogenem Umriss`);
    }
  });

  it("Warnung gestrichelt, Fokus gepunktet, Fehler mit Symbol; Auswahl bleibt das Blau des IFC-Viewers", () => {
    assert.equal(ZEIGE_ZUSTAENDE.warnung.umriss, "gestrichelt");
    assert.equal(ZEIGE_ZUSTAENDE.fokus.umriss, "gepunktet");
    assert.equal(ZEIGE_ZUSTAENDE.fehler.symbol, "!");
    const [r, g, b] = ZEIGE_ZUSTAENDE.auswahl.rgb;
    assert.ok(Math.abs(r - 0.23) < 0.01 && Math.abs(g - 0.51) < 0.01 && Math.abs(b - 0.96) < 0.01);
  });

  it("istZeigeZustand erkennt nur die vier Namen", () => {
    assert.ok(istZeigeZustand("fehler"));
    assert.ok(!istZeigeZustand("toString") && !istZeigeZustand("rot") && !istZeigeZustand(null));
  });
});

describe("hervorhebung: Einzel-Mesh", () => {
  it("setzen färbt emissive auf einer Kopie, loeschen stellt Material und emissive wieder her", () => {
    const mesh = einzelBox();
    const original = mesh.material;
    const emissivVorher = original.emissive.getHex();
    const h = hervorhebung();
    h.setzen({ mesh }, "auswahl");
    assert.notEqual(mesh.material, original, "eigene Materialkopie");
    assert.equal(mesh.material.emissive.getHex(), new THREE.Color(ZEIGE_ZUSTAENDE.auswahl.hex).getHex());
    assert.equal(original.emissive.getHex(), emissivVorher, "das Original wird nie verändert");
    assert.equal(h.aktive().length, 1);
    h.loeschen({ mesh });
    assert.equal(mesh.material, original);
    assert.equal(original.emissive.getHex(), emissivVorher);
    assert.equal(h.aktive().length, 0);
    assert.equal(mesh.children.length, 0, "Umriss entfernt");
  });

  it("der Umriss ist ein Kind des Meshs, nie pickbar; Warnung gestrichelt, Auswahl durchgezogen", () => {
    const mesh = einzelBox();
    const h = hervorhebung();
    h.setzen({ mesh }, "warnung");
    const linie = mesh.children[0];
    assert.ok(linie.isLineSegments);
    assert.ok(linie.material.isLineDashedMaterial, "Warnung: gestrichelter Umriss");
    assert.ok(linie.material.dashSize > 0 && linie.material.gapSize > 0);
    assert.ok(linie.geometry.attributes.lineDistance, "computeLineDistances wurde aufgerufen");
    assert.equal(linie.material.color.getHex(), new THREE.Color(ZEIGE_ZUSTAENDE.warnung.hex).getHex());
    const hits = [];
    linie.raycast(new THREE.Raycaster(), hits);
    assert.equal(hits.length, 0);
    h.loeschen({ mesh }, "warnung");
    h.setzen({ mesh }, "auswahl");
    assert.ok(mesh.children[0].material.isLineBasicMaterial && !mesh.children[0].material.isLineDashedMaterial);
    h.alleLoeschen();
  });

  it("Zustände stapeln sich: der höhere Rang bestimmt die Farbe, nach dem Löschen gilt der nächste", () => {
    const mesh = einzelBox();
    const original = mesh.material;
    const h = hervorhebung();
    h.setzen({ mesh }, "fehler");
    h.setzen({ mesh }, "fokus"); // hover on an element with an error must not hide the error colour
    assert.equal(mesh.material.emissive.getHex(), new THREE.Color(ZEIGE_ZUSTAENDE.fehler.hex).getHex());
    assert.equal(mesh.children.length, 2, "beide Umrisse");
    h.loeschen({ mesh }, "fehler");
    assert.equal(mesh.material.emissive.getHex(), new THREE.Color(ZEIGE_ZUSTAENDE.fokus.hex).getHex());
    h.loeschen({ mesh }, "fokus");
    assert.equal(mesh.material, original);
  });

  it("derselbe Zustand zweimal setzen ergibt einen Eintrag und einen Umriss", () => {
    const mesh = einzelBox();
    const h = hervorhebung();
    h.setzen({ mesh }, "fokus");
    h.setzen({ mesh }, "fokus");
    assert.equal(h.aktive().length, 1);
    assert.equal(mesh.children.length, 1);
    h.alleLoeschen();
  });

  it("Materialien ohne emissive (Basic) werden über die Farbe getönt und zurückgegeben", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x123456 }));
    const original = mesh.material;
    const h = hervorhebung();
    h.setzen({ mesh }, "fehler");
    assert.equal(mesh.material.color.getHex(), new THREE.Color(ZEIGE_ZUSTAENDE.fehler.hex).getHex());
    assert.equal(original.color.getHex(), 0x123456);
    h.alleLoeschen();
    assert.equal(mesh.material, original);
  });

  it("unbekannter Zustand und fehlendes Mesh werfen Klartext-Fehler", () => {
    const h = hervorhebung();
    assert.throws(() => h.setzen({ mesh: einzelBox() }, "rot"), /Unbekannter Zustand/);
    assert.throws(() => h.setzen({}, "fokus"), /ohne Mesh/);
    assert.throws(() => h.setzen({ mesh: gemergtesMesh(), bereich: { start: 0, count: 0 } }, "fokus"), /Bereich/);
  });
});

describe("hervorhebung: Bereich im gemergten Mesh", () => {
  it("setzen färbt nur die Vertices des Bereichs, loeschen stellt die Originalfarben wieder her", () => {
    const mesh = gemergtesMesh();
    const h = hervorhebung();
    h.setzen({ mesh, bereich: A }, "auswahl");
    const blau = [...ZEIGE_ZUSTAENDE.auswahl.rgb];
    for (let v = 0; v < 4; v++) farbe(mesh, v).forEach((c, i) => assert.ok(Math.abs(c - blau[i]) < 1e-6));
    for (let v = 4; v < 8; v++) assert.deepEqual(farbe(mesh, v), [0.5, 0.5, 0.5], "Element B bleibt unberührt");
    h.loeschen({ mesh, bereich: A });
    for (let v = 0; v < 8; v++) assert.deepEqual(farbe(mesh, v), [0.5, 0.5, 0.5]);
    assert.equal(mesh.children.length, 0);
  });

  it("zwei Zustände auf demselben Bereich: Rang entscheidet, Löschen des oberen gibt den unteren frei", () => {
    const mesh = gemergtesMesh();
    const h = hervorhebung();
    h.setzen({ mesh, bereich: A }, "auswahl");
    h.setzen({ mesh, bereich: A }, "warnung");
    const w = [...ZEIGE_ZUSTAENDE.warnung.rgb];
    farbe(mesh, 0).forEach((c, i) => assert.ok(Math.abs(c - w[i]) < 1e-6));
    h.loeschen({ mesh, bereich: A }, "warnung");
    const a = [...ZEIGE_ZUSTAENDE.auswahl.rgb];
    farbe(mesh, 0).forEach((c, i) => assert.ok(Math.abs(c - a[i]) < 1e-6));
    h.loeschen({ mesh, bereich: A }, "auswahl");
    assert.deepEqual(farbe(mesh, 0), [0.5, 0.5, 0.5]);
  });

  it("zwei Bereiche gleichzeitig; Umriss je Bereich mit Warnung gestrichelt; aktive() nennt die Bereiche", () => {
    const mesh = gemergtesMesh();
    const h = hervorhebung();
    h.setzen({ mesh, bereich: A }, "fokus");
    h.setzen({ mesh, bereich: B }, "warnung");
    assert.equal(mesh.children.length, 2);
    const warn = mesh.children.find((c) => c.material.isLineDashedMaterial);
    assert.ok(warn, "gestrichelter Umriss am Warnungs-Bereich");
    assert.deepEqual(h.aktive().map((x) => [x.bereich.start, x.zustand]), [[0, "fokus"], [6, "warnung"]]);
    h.loeschen({ mesh, bereich: A });
    assert.equal(h.aktive().length, 1);
    farbe(mesh, 0).forEach((c) => assert.equal(c, 0.5));
    h.alleLoeschen();
  });

  it("ein anderes Farb-Attribut kann übergeben werden", () => {
    const mesh = gemergtesMesh();
    const eigenes = new THREE.Float32BufferAttribute(new Array(24).fill(0.1), 3);
    const h = hervorhebung();
    h.setzen({ mesh, bereich: A, farbAttribut: eigenes }, "fokus");
    assert.ok(Math.abs(eigenes.getX(0) - ZEIGE_ZUSTAENDE.fokus.rgb[0]) < 1e-6);
    assert.equal(mesh.geometry.attributes.color.getX(0), 0.5, "das Mesh-Attribut bleibt");
    h.alleLoeschen();
    assert.ok(Math.abs(eigenes.getX(0) - 0.1) < 1e-6);
  });
});

describe("hervorhebung: alleLoeschen und dispose", () => {
  it("alleLoeschen stellt alles wieder her und gibt Materialien frei, verwerfen auch die Kanten-Geometrien", () => {
    const einzel = einzelBox();
    const originalMaterial = einzel.material;
    const merged = gemergtesMesh();
    const h = hervorhebung();
    h.setzen({ mesh: einzel }, "warnung");
    h.setzen({ mesh: merged, bereich: A }, "fehler");
    h.setzen({ mesh: merged, bereich: B }, "auswahl");

    const freigegeben = [];
    const spaeher = (obj) => obj.addEventListener("dispose", () => freigegeben.push(obj.type || obj.constructor.name));
    const kopie = einzel.material;
    spaeher(kopie);
    for (const m of [einzel, merged]) for (const c of m.children) { spaeher(c.geometry); spaeher(c.material); }
    const erwartet = 1 + 3; // material clone + one line material per outline

    h.alleLoeschen();
    assert.equal(freigegeben.length, erwartet, `freigegeben: ${freigegeben.join(", ")}`);
    // the outline edge geometries stay cached for the next hover; verwerfen() frees them
    h.verwerfen();
    assert.equal(freigegeben.length, erwartet + 3, `nach verwerfen: ${freigegeben.join(", ")}`);
    assert.equal(einzel.material, originalMaterial);
    assert.equal(einzel.children.length + merged.children.length, 0);
    for (let v = 0; v < 8; v++) assert.deepEqual(farbe(merged, v), [0.5, 0.5, 0.5]);
    assert.equal(h.aktive().length, 0);
    assert.ok(merged.geometry.attributes.position, "die Mesh-Geometrie selbst wird nicht freigegeben");
  });

  it("nach alleLoeschen kann dasselbe Ziel wieder hervorgehoben werden", () => {
    const mesh = einzelBox();
    const h = hervorhebung();
    h.setzen({ mesh }, "auswahl");
    h.alleLoeschen();
    h.setzen({ mesh }, "auswahl");
    assert.equal(h.aktive().length, 1);
    h.alleLoeschen();
  });
});
