// Unit tests for phase 103 (terrain study): packages/nova-designer/src/lib/gelaendeStudie.js and
// gelaendeSzene.js. Style: node:test, German descriptions, hand calculation in the comment.
// Regressions covered: "terrain always shown from below" (normals up, camera above the
// surface for every yaw/pitch/exaggeration) and the north–south mirror (row 0 = south).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  demRaster, hoeheAn, knotenM, canvasZuPlanM, baukoerperEckenM, grundstueckM, baukoerperListe, mJePx,
  startUeberhoehung, kameraPose, pitchKlemmen, verdichten, minHoeheInPolygon, maxHoeheInPolygon,
  hoehenKoten, massstabsLeiste, flutKurve, ueberfluteteFlaeche, okffNHN, flutReihenfolge, pegelBereich,
  hqMarken, mJePxBildmitte, hoeheText, PITCH_MIN, PITCH_MAX, START_YAW, START_PITCH, FREI_M, SOCKEL_M,
} from "@designer/lib/gelaendeStudie";
import { terrainGeometrie, schuerzeGeometrie, terrainMaterial, grundstuecksLinie, baukoerperMesh, wasserEbene } from "@designer/lib/gelaendeSzene";
import { canvasPointToLngLat } from "@designer/lib/maplibreStyles";
import { buildingsToGeoJson } from "@designer/lib/mapDraw";
import { kameraPosition } from "@designer/lib/isoKamera";

const M_PER_LAT = 111320;

/** 3×3 grid, row i = south → north: heights 100 (south row), 110, 120 (north row), +j per column. */
const RASTER = demRaster([[100, 101, 102], [110, 111, 112], [120, 121, 122]], 200);

describe("gelaendeStudie: Raster und Achsen", () => {
  it("Zeile 0 ist Süd (z = +halbM), Spalte 0 ist West (x = −halbM)", () => {
    assert.equal(RASTER.n, 3);
    assert.equal(RASTER.zelleM, 100);
    assert.deepEqual(knotenM(RASTER, 0, 0), { x: -100, z: 100 });
    assert.equal(hoeheAn(RASTER, -100, 100), 100); // south-west corner = grid[0][0]
    assert.equal(hoeheAn(RASTER, 100, -100), 122); // north-east corner = grid[2][2]
    assert.equal(hoeheAn(RASTER, 0, 0), 111); // centre
    // halfway between south row and middle row: (100+110)/2 at x = −100
    assert.equal(hoeheAn(RASTER, -100, 50), 105);
  });

  it("außerhalb des Rasters wird geklemmt", () => {
    assert.equal(hoeheAn(RASTER, -500, 500), 100);
    assert.equal(hoeheAn(RASTER, 500, -500), 122);
  });

  it("Zeilenrichtung passt zu useElevationGrid (Breite steigt mit i) und canvasPointToLngLat", () => {
    // useElevationGrid: lat_i = lat − dLat/2 + dLat·i/(n−1) — row index from a latitude:
    const lat0 = 49.45, lng0 = 11.08, spanKm = 0.2, n = 3;
    const dLat = spanKm / 111;
    const zeileAusLat = (lat) => ((lat - (lat0 - dLat / 2)) / dLat) * (n - 1);
    // A canvas point 40 units below the centre (south) at 1.25 m/unit = 50 m south.
    const [, lat] = canvasPointToLngLat({ x: 600, y: 440 }, lat0, lng0);
    const zeileGeo = zeileAusLat(lat);
    const p = canvasZuPlanM({ x: 600, y: 440 }, 1.25);
    assert.equal(p.z, 50);
    assert.equal(p.x, 0);
    // hoeheAn's row index for the same point: (halbM − z)/zelleM, with halbM from the 200-m raster
    const zeilePlan = (100 - p.z) / 100;
    assert.ok(Math.abs(zeileGeo - zeilePlan) < 0.01, `${zeileGeo} vs ${zeilePlan}`);
    assert.ok(zeilePlan < 1, "Süden liegt unterhalb der Mittelzeile");
  });

  it("canvasZuPlanM: Vorzeichen wie canvasPointToLngLat (x Ost, z Süd)", () => {
    const lat0 = 50, lng0 = 10;
    const mPerLon = M_PER_LAT * Math.cos((lat0 * Math.PI) / 180);
    for (const q of [{ x: 700, y: 300 }, { x: 500, y: 520 }]) {
      const [lng, lat] = canvasPointToLngLat(q, lat0, lng0, 2);
      const p = canvasZuPlanM(q, 2);
      assert.ok(Math.abs((lng - lng0) * mPerLon - p.x) < 1e-6);
      assert.ok(Math.abs(-(lat - lat0) * M_PER_LAT - p.z) < 1e-6);
    }
  });

  it("baukoerperEckenM = Ecken von buildingsToGeoJson (auch gedreht)", () => {
    const lat0 = 49, lng0 = 11;
    const mPerLon = M_PER_LAT * Math.cos((lat0 * Math.PI) / 180);
    const b = { id: "b1", x: 580, y: 390, width: 40, height: 20, floors: 3, drehung_grad: 30 };
    const fc = buildingsToGeoJson([b], lat0, lng0, 1.5);
    const ring = fc.features[0].geometry.coordinates[0];
    const ecken = baukoerperEckenM(b, 1.5);
    ecken.forEach((e, k) => {
      assert.ok(Math.abs((ring[k][0] - lng0) * mPerLon - e.x) < 1e-6);
      assert.ok(Math.abs(-(ring[k][1] - lat0) * M_PER_LAT - e.z) < 1e-6);
    });
    assert.equal(baukoerperEckenM({ x: 0, y: 0, width: 0, height: 5 }, 1), null);
  });

  it("grundstueckM, mJePx und baukoerperListe lesen complexData", () => {
    const cd = {
      site_parcel: { m_per_px: 0.5, assumed: false, points: [{ x: 580, y: 380 }, { x: 620, y: 380 }, { x: 620, y: 420 }, { x: 580, y: 420 }] },
      buildings: [{ id: "a", x: 590, y: 390, width: 20, height: 10, floors: 4 }, { id: "leer", x: 0, y: 0, width: 0, height: 0 }],
    };
    assert.equal(mJePx(cd), 0.5);
    assert.equal(mJePx({}), 1.25);
    const g = grundstueckM(cd);
    assert.equal(g.geschaetzt, false);
    assert.deepEqual(g.poly[0], { x: -10, z: -10 });
    assert.equal(grundstueckM({ site_parcel: { ...cd.site_parcel, assumed: true } }).geschaetzt, true);
    assert.equal(grundstueckM({}), null);
    const liste = baukoerperListe(cd, { storeyHeight: 3.2 });
    assert.equal(liste.length, 1);
    assert.equal(liste[0].geschosse, 4);
    assert.equal(liste[0].geschossHoeheM, 3.2);
    assert.deepEqual(liste[0].ecken[0], { x: -5, z: -5 });
  });
});

describe("gelaendeSzene: Geometrie zeigt nach oben (Regression „von unten“)", () => {
  it("alle Normalen der Geländeoberfläche haben y > 0", () => {
    const geo = terrainGeometrie(RASTER, 100);
    const nor = geo.getAttribute("normal");
    for (let k = 0; k < nor.count; k++) assert.ok(nor.getY(k) > 0, `Normale ${k} zeigt nach unten`);
    // and every triangle is CCW seen from +y (face normal up)
    const pos = geo.getAttribute("position"), idx = geo.getIndex();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t)); b.fromBufferAttribute(pos, idx.getX(t + 1)); c.fromBufferAttribute(pos, idx.getX(t + 2));
      const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      assert.ok(nrm.y > 0);
    }
    // vertex 0 = row 0 col 0 = south-west, y = h − bezug
    assert.deepEqual([pos.getX(0), pos.getY(0), pos.getZ(0)], [-100, 0, 100]);
  });

  it("Schürze: Wände zeigen nach außen und reichen 5 m unter den Bezug", () => {
    const geo = schuerzeGeometrie(RASTER, 100);
    const pos = geo.getAttribute("position");
    let minY = Infinity;
    for (let t = 0; t < pos.count; t += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, t), b = new THREE.Vector3().fromBufferAttribute(pos, t + 1), c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
      const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const mitte = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
      assert.ok(nrm.x * mitte.x + nrm.z * mitte.z > 0, "Wand zeigt nach innen");
      minY = Math.min(minY, a.y, b.y, c.y);
    }
    assert.equal(minY, -5);
  });

  it("Material, Wasser, Linie und Baukörper lassen sich bauen", () => {
    const mat = terrainMaterial();
    assert.ok(mat.userData.u.uPegel && mat.userData.u.uBezug && mat.userData.u.uWasserAn);
    assert.equal(mat.customProgramCacheKey(), "gelaende-103-flut");
    // shader patch hits all four anchors of the Lambert shader
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    mat.onBeforeCompile(shader, /** @type {any} */ (null));
    assert.match(shader.vertexShader, /vHoeheM = transformed\.y \+ uBezug/);
    assert.match(shader.fragmentShader, /uniform float uPegel/);
    assert.match(shader.fragmentShader, /fwidth\(vHoeheM\)/);
    assert.equal(shader.uniforms.uPegel, mat.userData.u.uPegel);
    const w = wasserEbene(300);
    assert.equal(w.renderOrder, 2);
    assert.equal(w.material.depthWrite, false);
    const quad = [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }];
    assert.ok(grundstuecksLinie(RASTER, quad, 100));
    const m = baukoerperMesh(quad, 105, 120, 100);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    assert.ok(Math.abs(bb.min.y) < 1e-9 && Math.abs(bb.max.y - 15) < 1e-9);
    assert.ok(Math.abs(bb.min.z + 10) < 1e-9 && Math.abs(bb.max.z - 10) < 1e-9);
    assert.equal(m.position.y, 5);
  });
});

describe("gelaendeStudie: Kamera", () => {
  it("Startpose steht südlich des Ziels und über dem Gelände", () => {
    assert.ok(START_PITCH >= PITCH_MIN && START_PITCH <= PITCH_MAX);
    const p = kameraPose({ yaw: START_YAW, pitch: START_PITCH, abstand: 300 }, { x: 0, y: 11, z: 0 }, () => 0);
    assert.ok(p.z > 0, "Kamera steht im Süden (z > 0)");
    assert.ok(p.y > 11);
    assert.equal(p.angehoben, false);
  });

  it("Kamera immer ≥ freiM über dem Gelände — Raster über Yaw, Pitch und Überhöhung", () => {
    const r = demRaster([[300, 340, 420], [310, 360, 430], [305, 350, 500]], 1000);
    const bezug = Math.floor(r.minNHN);
    for (const ue of [1, 3, 10]) {
      const hs = (x, z) => (hoeheAn(r, x, z) - bezug) * ue;
      const ziel = { x: 0, y: hs(0, 0), z: 0 };
      for (let yaw = 0; yaw < 360; yaw += 30) {
        for (const pitch of [-20, 0, PITCH_MIN, 20, 45, PITCH_MAX, 120]) {
          for (const abstand of [150, 600, 4000]) {
            const p = kameraPose({ yaw, pitch, abstand }, ziel, hs);
            assert.ok(p.y - hs(p.x, p.z) >= FREI_M - 1e-9, `ü ${ue} yaw ${yaw} pitch ${pitch} r ${abstand}`);
          }
        }
      }
    }
  });

  it("pitchKlemmen hält [12°, 85°], kameraPose nutzt isoKamera-Konvention", () => {
    assert.equal(pitchKlemmen(-5), PITCH_MIN);
    assert.equal(pitchKlemmen(95), PITCH_MAX);
    assert.equal(pitchKlemmen(NaN), START_PITCH);
    const q = kameraPosition({ yaw: 90, pitch: 30, abstand: 100 }, { x: 0, z: 0 });
    const p = kameraPose({ yaw: 90, pitch: 30, abstand: 100 }, { x: 0, y: 0, z: 0 }, () => -1000);
    assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9 && p.x < 0, "Blick nach Osten → Kamera im Westen");
  });

  it("startUeberhoehung: 6 % der Ausdehnung, ganzzahlig 1…10", () => {
    assert.equal(startUeberhoehung(20, 1000), 3); // 60/20
    assert.equal(startUeberhoehung(3, 1000), 10); // 20 → 10
    assert.equal(startUeberhoehung(100, 1000), 1); // 0.6 → 1
    assert.equal(startUeberhoehung(6, 300), 3);
    assert.equal(startUeberhoehung(0, 1000), 1);
  });

  it("massstabsLeiste 1-2-5 und mJePxBildmitte", () => {
    assert.deepEqual(massstabsLeiste(1, 120), { m: 100, px: 100 });
    assert.deepEqual(massstabsLeiste(0.5, 120), { m: 50, px: 100 });
    assert.deepEqual(massstabsLeiste(2, 120), { m: 200, px: 100 });
    assert.equal(massstabsLeiste(0.1, 120).m, 10);
    assert.equal(massstabsLeiste(0), null);
    // fov 90°, distance 50 m, 100 px high: 2·50·tan45 / 100 = 1 m/px
    assert.ok(Math.abs(mJePxBildmitte(50, 90, 100) - 1) < 1e-9);
  });
});

describe("gelaendeStudie: Höhen im Polygon, Koten", () => {
  const quad = [{ x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 }];
  it("minHoehe/maxHoehe: Rand und innere Knoten", () => {
    // south-west corner (−50, 50): row 0.5, col 0.5 → 105.5; north-east (50, −50) → 116.5
    assert.ok(Math.abs(minHoeheInPolygon(RASTER, quad) - 105.5) < 1e-9);
    assert.ok(Math.abs(maxHoeheInPolygon(RASTER, quad) - 116.5) < 1e-9);
    // a saddle: inner node is the minimum, the boundary never reaches it
    const r = demRaster([[10, 10, 10], [10, 0, 10], [10, 10, 10]], 200);
    assert.equal(minHoeheInPolygon(r, quad), 0);
    assert.equal(maxHoeheInPolygon(r, quad), 10 - 10 * 0.25); // corner (±50, ±50): bilinear 7.5
    assert.equal(minHoeheInPolygon(r, []), null);
  });

  it("hoehenKoten: mit Grundstück im Grundstück, ohne über das Raster", () => {
    const k = hoehenKoten(RASTER, quad);
    assert.ok(Math.abs(k.tief.h - 105.5) < 1e-9 && k.tief.z > 0, "tiefster Punkt im Süden");
    assert.ok(Math.abs(k.mitte.h - 111) < 1e-9);
    const g = hoehenKoten(RASTER, null);
    assert.deepEqual([g.tief.h, g.hoch.h, g.mitte.h], [100, 122, 111]);
    assert.equal(hoeheText(312.44), "312,4");
  });

  it("verdichten: kein Stück länger als der Schritt, Ring geschlossen", () => {
    const v = verdichten(quad, 2);
    assert.equal(v.length, 4 * 50 + 1);
    assert.deepEqual(v[0], v[v.length - 1]);
    for (let k = 1; k < v.length; k++) assert.ok(Math.hypot(v[k].x - v[k - 1].x, v[k].z - v[k - 1].z) <= 2 + 1e-9);
  });
});

describe("gelaendeStudie: Hochwasser (Badewanne)", () => {
  // tilted plane: 0 m at the south edge, 10 m at the north edge (z = −50 … 50 over a 100-m raster)
  const r = demRaster([[0, 0], [10, 10]], 100);
  const quad = [{ x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 }];
  const kurve = flutKurve(r, quad, 64);

  it("überflutete Fläche 0 % / 50 % / 100 %", () => {
    assert.ok(Math.abs(kurve.flaecheM2 - 10000) < 1e-6);
    assert.deepEqual(ueberfluteteFlaeche(kurve, -1), { m2: 0, anteil: 0 });
    const h = ueberfluteteFlaeche(kurve, 5);
    assert.ok(Math.abs(h.anteil - 0.5) < 1e-9 && Math.abs(h.m2 - 5000) < 1e-6);
    assert.equal(ueberfluteteFlaeche(kurve, 11).anteil, 1);
    assert.deepEqual(ueberfluteteFlaeche(null, 5), { m2: 0, anteil: 0 });
    let vorher = -1;
    for (let p = -1; p <= 11; p += 0.5) { const a = ueberfluteteFlaeche(kurve, p).anteil; assert.ok(a >= vorher); vorher = a; }
  });

  it("okffNHN: höchster Punkt unter dem Körper + Sockel, Override gewinnt", () => {
    const koerper = [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }];
    assert.ok(Math.abs(okffNHN(r, koerper) - (6 + SOCKEL_M)) < 1e-9); // north edge z = −10 → 6 m
    assert.equal(okffNHN(r, koerper, { overrideNHN: 8.5 }), 8.5);
  });

  it("flutReihenfolge aufsteigend: Grundstück, Baukörper, EG", () => {
    const koerper = [{ x: -10, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 20 }, { x: -10, z: 20 }];
    const liste = flutReihenfolge(r, { grundstueck: quad, baukoerper: [{ id: "b1", name: "Haus A", ecken: koerper }] });
    assert.deepEqual(liste.map((e) => e.art), ["grundstueck", "baukoerper", "eg"]);
    assert.ok(Math.abs(liste[0].pegelNHN - 0) < 1e-9);
    assert.ok(Math.abs(liste[1].pegelNHN - 3) < 1e-9); // south edge z = 20 → 3 m
    assert.ok(Math.abs(liste[2].pegelNHN - 5.3) < 1e-9); // north edge z = 0 → 5 m + 0.30
    assert.deepEqual(flutReihenfolge(null, {}), []);
  });

  it("pegelBereich und hqMarken", () => {
    const b = pegelBereich(demRaster([[300.4, 301], [302, 305.6]], 100));
    assert.deepEqual(b, { min: 299, max: 308, schritt: 0.05 });
    const m = hqMarken({ hq: [
      { id: "x", name: "HQ100", pegelNHN: "303,5", quelle: "Amt" },
      { name: "HQ10", pegelNHN: 301 },
      { name: "leer", pegelNHN: "" },
      { name: "kaputt", pegelNHN: "abc" },
    ] }, b);
    assert.deepEqual(m.map((x) => x.name), ["HQ10", "HQ100"]);
    assert.equal(m[1].pegelNHN, 303.5);
    assert.equal(m[1].testId, "gelaende-hq-HQ100");
    assert.ok(Math.abs(m[0].lage - 2 / 9) < 1e-9);
    assert.deepEqual(hqMarken(null, b), []);
  });
});
