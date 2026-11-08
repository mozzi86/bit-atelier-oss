// Regression for the three review findings on catalogue surfaces:
// layered hulls must take the outer band, zone floors use metre UVs, and
// colour-map URLs follow Vite's base (`/` and `/app/`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { erscheinungUrl, materialFuerSchluessel, musterWiederholung } from "@designer/lib/erscheinungTextur.js";
import { huellMeshWeg } from "@designer/lib/huellErscheinung.js";
import { bodenBelag, musterSpanne_m } from "@core/lib/bauteil/erscheinung.js";

describe("Erscheinung: Pfad, Maßstab, Hülle", () => {
  it("die Farbkarte hängt an BASE_URL, Wurzel und /app/", () => {
    assert.equal(erscheinungUrl("Wood051_Color.jpg", "/"), "/erscheinung/Wood051_Color.jpg");
    assert.equal(erscheinungUrl("Tiles074_Color.jpg", "/app/"), "/app/erscheinung/Tiles074_Color.jpg");
    assert.equal(erscheinungUrl("Wood051_Color.jpg", "/app"), "/app/erscheinung/Wood051_Color.jpg");
    assert.equal(erscheinungUrl("Wood051_Color.jpg", ""), "/erscheinung/Wood051_Color.jpg");
  });

  it("ExtrudeGeometry-UV ist in Metern; die Wiederholung ist eine Katalogspanne", () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(4, 0);
    shape.lineTo(4, -3);
    shape.lineTo(0, -3);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
    const uv = geo.getAttribute("uv");
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) maxU = Math.max(maxU, uv.getX(i));
    assert.ok(maxU > 3.5 && maxU < 4.5, `UV-Maximum ${maxU} ist nicht die Raumkante in Metern`);

    const holz = musterSpanne_m("Wood051");
    const fliese = musterSpanne_m("Tiles074");
    const holzRepeat = musterWiederholung(holz, 4, "meter");
    const flieseRepeat = musterWiederholung(fliese, 4, "meter");
    assert.ok(Math.abs(holzRepeat - 1 / 0.8) < 1e-9);
    assert.ok(Math.abs(flieseRepeat - 1 / 2.1) < 1e-9);
    assert.ok(flieseRepeat < 1, "eine 2,1-m-Fliese darf nicht auf mindestens eine Wiederholung je Meter geklemmt werden");
    // tiles across the 4 m edge: UV span times repeat equals length / span
    assert.ok(Math.abs(maxU * holzRepeat - 4 / holz) < 0.15);
    // a 0–1 wall face of 4 m still repeats length/span, at least once
    assert.equal(musterWiederholung(holz, 4, "normiert"), 5);
    assert.equal(musterWiederholung(0.8, 0.2, "normiert"), 1);

    const boden = materialFuerSchluessel(bodenBelag("estrich-parkett-15-cm").sicht.schluessel, 4, false, "meter");
    assert.ok(boden.map, "Parkett trägt die Farbkarte");
    assert.equal(boden.map.userData.url, "/erscheinung/Wood051_Color.jpg");
    assert.ok(Math.abs(boden.map.repeat.x - holzRepeat) < 1e-9);
    assert.equal(boden.map.repeat.y, boden.map.repeat.x);
    const putz = materialFuerSchluessel("lehmputz-370", 4);
    assert.equal(putz.map, null, "Putz ohne geprüfte Karte bleibt die Katalogfarbe");
    assert.equal(putz.color.getHexString(), "bfa58c");
    geo.dispose();
    boden.map.dispose();
    boden.dispose();
    putz.dispose();
  });

  it("eine gesetzte Hüllen-Oberfläche färbt das äußere Band, nicht nur die einschichtige Wand", () => {
    assert.deepEqual(huellMeshWeg({ hatSolid: true, hatAufbau: true, kellerImRender: false }), { weg: "solid", aussen: true, einMaterial: false, beton: false });
    assert.deepEqual(huellMeshWeg({ hatSolid: false, hatAufbau: true, kellerImRender: false }), { weg: "schichten", aussen: true, einMaterial: false, beton: false });
    assert.deepEqual(huellMeshWeg({ hatSolid: false, hatAufbau: false, kellerImRender: false }), { weg: "koerper", aussen: false, einMaterial: true, beton: false });
    assert.deepEqual(huellMeshWeg({ hatSolid: true, hatAufbau: false, kellerImRender: true }), { weg: "solid", aussen: false, einMaterial: true, beton: true });
  });
});
