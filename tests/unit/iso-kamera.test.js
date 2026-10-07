// Unit-Tests für packages/nova-designer/src/lib/isoKamera.js (Phase 75-08, MS-08).
// Stil: node:test, deutsche Beschreibungen, Handrechnung im Kommentar.
// Der TEST importiert three für die Gegenprobe (OrthographicCamera.project =
// bildschirmVonWelt) — die Lib selbst bleibt three-frei (grep "^import" = 0).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  ISO_PITCH_GRAD, ISO_YAWS, ISO_START_YAW, ISO_ZOOMSTUFEN, CSS_PX_JE_M, TWEEN_MS,
  KAMERA_ABSTAND_M, RAND_SCROLL_PX, RAD_SCHWELLE,
  pxJeMeter, frustumFuer, blickHorizontal, kameraBasis, kameraPosition,
  bildschirmVonWelt, bodenpunktUnterCursor, zoomAufPunkt, verschiebeZiel,
  zoomEinrasten, naechsteZoomstufe, einpassenStufe,
  yawEinrasten, yawDrehen, yawInterpol, tweenFortschritt, tweenDauer,
  nordpfeilWinkel, randScrollRichtung,
  planZoomFuerMassstab, isoSzeneAusModell,
} from "@designer/lib/isoKamera";
import { MASSING_MASSSTAEBE } from "@designer/lib/massstab";

// Standard-Kamera für die Projektionstests: Yaw 45, Pitch 30, Ziel (0,0),
// Canvas 800 × 520 px, Maßstab 1:500.
const KAM = {
  yaw: 45, pitch: ISO_PITCH_GRAD, ziel: { x: 0, z: 0 },
  pxJeM: pxJeMeter(500), breitePx: 800, hoehePx: 520,
};

describe("isoKamera: Konstanten", () => {
  it("Pitch 30°, vier Yaws, Start 45°, Leiter enthält die Massing-Maßstäbe", () => {
    assert.equal(ISO_PITCH_GRAD, 30);
    assert.deepEqual(ISO_YAWS, [45, 135, 225, 315]);
    assert.equal(ISO_START_YAW, 45);
    assert.deepEqual(ISO_ZOOMSTUFEN, [2000, 1000, 500, 200]);
    for (const m of MASSING_MASSSTAEBE) assert.ok(ISO_ZOOMSTUFEN.includes(m), `Leiter fehlt ${m}`);
    assert.ok(CSS_PX_JE_M > 3700 && CSS_PX_JE_M < 3800); // 96/0.0254 ≈ 3779.53
    assert.equal(TWEEN_MS, 250);
    assert.equal(KAMERA_ABSTAND_M, 500);
    assert.equal(RAND_SCROLL_PX, 24);
    assert.equal(RAD_SCHWELLE, 100);
  });
});

describe("isoKamera: Frustum und pxJeMeter", () => {
  it("1:500 auf 800 × 520 px → pxJeM 7.559055, rechts 52.9167 m, oben 34.3958 m", () => {
    // Handrechnung: 1 px = 500 · 0.0254 / 96 = 0.1322917 m → 400 px = 52.9167 m.
    const f = frustumFuer(500, 800, 520);
    assert.ok(Math.abs(f.pxJeM - 7.5590551181) < 1e-6, `pxJeM ${f.pxJeM}`);
    assert.ok(Math.abs(f.rechts - 52.91666667) < 1e-5, `rechts ${f.rechts}`);
    assert.ok(Math.abs(f.links + f.rechts) < 1e-12);
    assert.ok(Math.abs(f.oben - 34.39583333) < 1e-5, `oben ${f.oben}`);
    assert.ok(Math.abs(f.unten + f.oben) < 1e-12);
  });
  it("1:200 auf 800 × 520 px → pxJeM 18.89764, rechts 21.1667 m, oben 13.7583 m", () => {
    const f = frustumFuer(200, 800, 520);
    assert.ok(Math.abs(f.pxJeM - 18.8976378) < 1e-6, `pxJeM ${f.pxJeM}`);
    assert.ok(Math.abs(f.rechts - 21.16666667) < 1e-5, `rechts ${f.rechts}`);
    assert.ok(Math.abs(f.oben - 13.75833333) < 1e-5, `oben ${f.oben}`);
  });
  it("pxJeMeter(massstab) = CSS_PX_JE_M / massstab", () => {
    assert.ok(Math.abs(pxJeMeter(500) - CSS_PX_JE_M / 500) < 1e-12);
  });
});

describe("isoKamera: Blick und Basis", () => {
  it("blickHorizontal: yaw 0 → (0, −1) = Plan-oben; yaw 90 → (1, 0) = Plan-rechts", () => {
    const b0 = blickHorizontal(0);
    assert.ok(Math.abs(b0.x) < 1e-12 && Math.abs(b0.z + 1) < 1e-12);
    const b90 = blickHorizontal(90);
    assert.ok(Math.abs(b90.x - 1) < 1e-12 && Math.abs(b90.z) < 1e-12);
  });
  it("kameraBasis ist orthonormal; yaw 0 → rechts = +x (Ost)", () => {
    for (const yaw of ISO_YAWS) {
      const { vor, rechts, hoch } = kameraBasis({ yaw, pitch: ISO_PITCH_GRAD });
      for (const v of [vor, rechts, hoch]) {
        assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-12, `|v| bei yaw ${yaw}`);
      }
      const sk = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
      assert.ok(Math.abs(sk(vor, rechts)) < 1e-12);
      assert.ok(Math.abs(sk(vor, hoch)) < 1e-12);
      assert.ok(Math.abs(sk(rechts, hoch)) < 1e-12);
    }
    const b0 = kameraBasis({ yaw: 0, pitch: ISO_PITCH_GRAD });
    assert.ok(Math.abs(b0.rechts.x - 1) < 1e-12 && Math.abs(b0.rechts.y) < 1e-12 && Math.abs(b0.rechts.z) < 1e-12);
  });
  it("kameraPosition: vier Yaws bei r = 1, Elevationswinkel = Pitch", () => {
    // Erwartung aus dem Plan (Handrechnung): yaw 45 → (−0.6124, 0.5, 0.6124) usw.
    const erwartet = {
      45: [-0.6123724357, 0.5, 0.6123724357],
      135: [-0.6123724357, 0.5, -0.6123724357],
      225: [0.6123724357, 0.5, -0.6123724357],
      315: [0.6123724357, 0.5, 0.6123724357],
    };
    for (const yaw of ISO_YAWS) {
      const p = kameraPosition({ yaw, pitch: ISO_PITCH_GRAD, abstand: 1 }, { x: 0, z: 0 });
      const e = erwartet[yaw];
      assert.ok(Math.abs(p.x - e[0]) < 1e-9, `yaw ${yaw} x ${p.x}`);
      assert.ok(Math.abs(p.y - e[1]) < 1e-12, `yaw ${yaw} y ${p.y}`);
      assert.ok(Math.abs(p.z - e[2]) < 1e-9, `yaw ${yaw} z ${p.z}`);
      const elev = (Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180) / Math.PI;
      assert.ok(Math.abs(elev - ISO_PITCH_GRAD) < 1e-9, `Elevation ${elev} bei yaw ${yaw}`);
    }
  });
});

describe("isoKamera: three.js-Gegenprobe (OrthographicCamera.project = bildschirmVonWelt)", () => {
  it("4 Yaws × 3 Punkte: NDC aus three.js und aus der Lib stimmen überein (|Δ| < 1e-9)", () => {
    const ziel = { x: 4, z: -3 };
    const punkte = [
      { x: 0, y: 0, z: 0 },          // Ziel-Bodenpunkt
      { x: 12.5, y: 15, z: -8.25 },  // Dachkante Ost
      { x: -20, y: 0, z: 17 },       // Bodenecke Südwest
    ];
    for (const yaw of ISO_YAWS) {
      const f = frustumFuer(500, 800, 520);
      const cam = new THREE.OrthographicCamera(f.links, f.rechts, f.oben, f.unten, 0.1, 2000);
      const pos = kameraPosition({ yaw, pitch: ISO_PITCH_GRAD, abstand: KAMERA_ABSTAND_M }, ziel);
      cam.position.set(pos.x, pos.y, pos.z);
      cam.lookAt(ziel.x, 0, ziel.z);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const kam = { yaw, pitch: ISO_PITCH_GRAD, ziel, pxJeM: f.pxJeM, breitePx: 800, hoehePx: 520 };
      for (const p of punkte) {
        const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
        const s = bildschirmVonWelt(p, kam);
        // CSS-px → NDC: x = 2·sx/W − 1, y = 1 − 2·sy/H.
        const ndcX = (2 * s.sx) / 800 - 1;
        const ndcY = 1 - (2 * s.sy) / 520;
        assert.ok(Math.abs(v.x - ndcX) < 1e-9, `yaw ${yaw} Punkt ${JSON.stringify(p)} x: three ${v.x} lib ${ndcX}`);
        assert.ok(Math.abs(v.y - ndcY) < 1e-9, `yaw ${yaw} Punkt ${JSON.stringify(p)} y: three ${v.y} lib ${ndcY}`);
      }
    }
  });
});

describe("isoKamera: Projektion und Rundreise", () => {
  it("bodenpunktUnterCursor(bildschirmVonWelt(G)) = G für Bodenpunkte; Bildmitte → Ziel", () => {
    const G = { x: 13.7, z: -8.2 };
    const s = bildschirmVonWelt({ x: G.x, y: 0, z: G.z }, KAM);
    const zurueck = bodenpunktUnterCursor(s.sx, s.sy, KAM);
    assert.ok(Math.abs(zurueck.x - G.x) < 1e-9, `x ${zurueck.x}`);
    assert.ok(Math.abs(zurueck.z - G.z) < 1e-9, `z ${zurueck.z}`);
    const mitte = bodenpunktUnterCursor(400, 260, KAM);
    assert.ok(Math.abs(mitte.x - KAM.ziel.x) < 1e-9 && Math.abs(mitte.z - KAM.ziel.z) < 1e-9);
  });
});

describe("isoKamera: Zoom auf den Cursor", () => {
  it("zoomAufPunkt: Bodenpunkt unter (620, 140) bleibt bei 1:500 → 1:200 auf (620, 140), |Δ| < 1e-6 px", () => {
    const kam500 = { ...KAM, pxJeM: pxJeMeter(500) };
    const kam200 = { ...KAM, pxJeM: pxJeMeter(200) };
    const G = bodenpunktUnterCursor(620, 140, kam500);
    const zielNeu = zoomAufPunkt(kam500.ziel, G, kam500.pxJeM, kam200.pxJeM);
    const s = bildschirmVonWelt({ x: G.x, y: 0, z: G.z }, { ...kam200, ziel: zielNeu });
    assert.ok(Math.abs(s.sx - 620) < 1e-6, `sx ${s.sx}`);
    assert.ok(Math.abs(s.sy - 140) < 1e-6, `sy ${s.sy}`);
  });
  it("Gegenprobe: ohne Zielkorrektur wandert der Punkt ≥ 50 px", () => {
    const kam500 = { ...KAM, pxJeM: pxJeMeter(500) };
    const kam200 = { ...KAM, pxJeM: pxJeMeter(200) };
    const G = bodenpunktUnterCursor(620, 140, kam500);
    const s = bildschirmVonWelt({ x: G.x, y: 0, z: G.z }, kam200); // Ziel unverändert
    const wanderung = Math.hypot(s.sx - 620, s.sy - 140);
    assert.ok(wanderung >= 50, `Wanderung nur ${wanderung} px`);
  });
});

describe("isoKamera: Pan", () => {
  it("verschiebeZiel(k, −40, −25): Bodenpunkt unter (300, 200) steht danach auf (340, 225)", () => {
    // Ziehen mit der Maus ruft verschiebeZiel(k, −mdx, −mdy) — der gegriffene
    // Punkt „klebt" am Cursor: Blick um (−40, −25) ⇒ Punkt scheinbar um (+40, +25).
    const G = bodenpunktUnterCursor(300, 200, KAM);
    const zielNeu = verschiebeZiel(KAM, -40, -25);
    const s = bildschirmVonWelt({ x: G.x, y: 0, z: G.z }, { ...KAM, ziel: zielNeu });
    assert.ok(Math.abs(s.sx - 340) < 1e-6, `sx ${s.sx}`);
    assert.ok(Math.abs(s.sy - 225) < 1e-6, `sy ${s.sy}`);
  });
});

describe("isoKamera: Zoomleiter", () => {
  it("naechsteZoomstufe: 500 +1 → 200, Klemmung an den Enden, 500 −1 → 1000, 2000 −1 → 2000", () => {
    assert.equal(naechsteZoomstufe(500, 1), 200);
    assert.equal(naechsteZoomstufe(200, 1), 200); // geklemmt
    assert.equal(naechsteZoomstufe(500, -1), 1000);
    assert.equal(naechsteZoomstufe(2000, -1), 2000); // geklemmt
  });
  it("zoomEinrasten(650) = 500 (Log-Raum: 650/500 = 1.3 < 1000/650 = 1.54)", () => {
    assert.equal(zoomEinrasten(650), 500);
    assert.equal(zoomEinrasten(500), 500);
    assert.equal(zoomEinrasten(2000), 2000);
  });
});

describe("isoKamera: einpassenStufe", () => {
  it("30 × 20 × 12 m auf 800 × 520 → 1:500; 10 × 10 × 6 → 1:200; 300 × 300 × 20 → 1:2000", () => {
    assert.equal(einpassenStufe({ breiteM: 30, tiefeM: 20, hoeheM: 12 }, 800, 520), 500);
    assert.equal(einpassenStufe({ breiteM: 10, tiefeM: 10, hoeheM: 6 }, 800, 520), 200);
    // Nichts passt in 90 % des Bildes → gröbste Stufe (Kontext vor Detail).
    assert.equal(einpassenStufe({ breiteM: 300, tiefeM: 300, hoeheM: 20 }, 800, 520), 2000);
  });
});

describe("isoKamera: Yaw", () => {
  it("yawEinrasten: 44 → 45, 100 → 135, 359 → 315, 0 → 45 (Gleichstand), 405 → 45", () => {
    assert.equal(yawEinrasten(44), 45);
    assert.equal(yawEinrasten(100), 135);
    assert.equal(yawEinrasten(359), 315);
    assert.equal(yawEinrasten(0), 45); // Math.round(−0.5) = −0 → Gleichstand geht auf 45
    assert.equal(yawEinrasten(405), 45);
  });
  it("yawDrehen: 315 +1 → 45 (Umlauf), 45 −1 → 315", () => {
    assert.equal(yawDrehen(315, 1), 45);
    assert.equal(yawDrehen(45, -1), 315);
    assert.equal(yawDrehen(45, 1), 135);
  });
  it("yawInterpol: kürzester Bogen — (315, 45, 0.5) = 0 (über 360, nicht 180); (45, 135, 0.5) = 90", () => {
    assert.ok(Math.abs(yawInterpol(315, 45, 0.5) - 0) < 1e-9, `${yawInterpol(315, 45, 0.5)}`);
    assert.ok(Math.abs(yawInterpol(45, 135, 0.5) - 90) < 1e-9);
    assert.ok(Math.abs(yawInterpol(45, 135, 0) - 45) < 1e-9);
    assert.ok(Math.abs(yawInterpol(45, 135, 1) - 135) < 1e-9);
  });
});

describe("isoKamera: Tween", () => {
  it("tweenFortschritt: Smoothstep, geklemmt, Dauer ≤ 0 → 1", () => {
    assert.equal(tweenFortschritt(0, 250), 0);
    assert.ok(Math.abs(tweenFortschritt(125, 250) - 0.5) < 1e-12); // 0.25 · 2
    assert.equal(tweenFortschritt(250, 250), 1);
    assert.equal(tweenFortschritt(-10, 250), 0);
    assert.equal(tweenFortschritt(999, 250), 1);
    assert.equal(tweenFortschritt(123, 0), 1);
  });
  it("tweenDauer: reduced motion → 0, sonst TWEEN_MS", () => {
    assert.equal(tweenDauer(true), 0);
    assert.equal(tweenDauer(false), TWEEN_MS);
  });
});

describe("isoKamera: Nordpfeil", () => {
  it("nordpfeilWinkel: (0,30,0) = 0 · (90,30,0) = −90 · (45,30,0) = −63.43 (Verkürzung) · (0,30,90) = −90", () => {
    assert.ok(Math.abs(nordpfeilWinkel(0, 30, 0) - 0) < 1e-9);
    assert.ok(Math.abs(nordpfeilWinkel(90, 30, 0) + 90) < 1e-9, `${nordpfeilWinkel(90, 30, 0)}`);
    // Handrechnung yaw 45: Norden = (0, −1) im Plan; rechts-Komponente
    // −sin45 = −0.7071, hoch-Komponente cos45·sin30 = 0.3536 (die Pitch-
    // Verkürzung) → atan2(−0.7071, 0.3536) = −63.4349°.
    assert.ok(Math.abs(nordpfeilWinkel(45, 30, 0) + 63.4349488) < 1e-6, `${nordpfeilWinkel(45, 30, 0)}`);
    assert.ok(Math.abs(nordpfeilWinkel(0, 30, 90) + 90) < 1e-9, `${nordpfeilWinkel(0, 30, 90)}`);
  });
});

describe("isoKamera: Rand-Scroll", () => {
  it("randScrollRichtung: links (−1, 0) · Mitte (0, 0) · Ecke unten rechts (1, 1)", () => {
    assert.deepEqual(randScrollRichtung(10, 200, 800, 520), { dx: -1, dy: 0 });
    assert.deepEqual(randScrollRichtung(400, 260, 800, 520), { dx: 0, dy: 0 });
    assert.deepEqual(randScrollRichtung(795, 515, 800, 520), { dx: 1, dy: 1 });
  });
});

// ---- 75-09 Task 2: fester Plan-Maßstab (eine Konvention mit der Iso) -------------------
describe("isoKamera: planZoomFuerMassstab (75-09)", () => {
  it("Handrechnung: 1:50 bei SCALE 12,86 u/m und s0 1,3889 px/u ⇒ Zoom 4,232", () => {
    // zoom = pxJeMeter(50) / (12,86 · 1,3889) = 75,5906 / 17,8613 = 4,2321…
    const z = planZoomFuerMassstab(50, 12.86, 1.3889);
    assert.ok(Math.abs(z - 4.232) < 1e-3, `zoom ${z}`);
  });
  it("Rundreise: SCALE · s0 · zoom = pxJeMeter(massstab)", () => {
    for (const [n, u, s0] of [[50, 12.86, 1.3889], [200, 6, 1], [100, 30, 2.5]]) {
      const z = planZoomFuerMassstab(n, u, s0);
      assert.ok(Math.abs(u * s0 * z - pxJeMeter(n)) < 1e-9, `1:${n}`);
    }
  });
  it("ungültige Eingaben ⇒ 1 (kein Maßstabsmodus)", () => {
    assert.equal(planZoomFuerMassstab(0, 12.86, 1.3889), 1);
    assert.equal(planZoomFuerMassstab(50, 0, 1), 1);
    assert.equal(planZoomFuerMassstab(50, 12.86, -1), 1);
    assert.equal(planZoomFuerMassstab(NaN, 12.86, 1), 1);
  });
});

// ---- 75-09 Task 3: isoSzeneAusModell (reine Abbildung Modell → Szenen-Frame) -------------
describe("isoKamera: isoSzeneAusModell (75-09)", () => {
  // Handrechnung aus dem Plan-<behavior>: Footprint 30 × 20 m bei (−15…15, −10…10),
  // Zone 5 × 4 m bei (−15…−10, −10…−6), level 1, 4 Geschosse à 3 m, rand 4.
  const FOOTPRINT = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
  const ZONE = {
    points: [{ x: -15, z: -10 }, { x: -10, z: -10 }, { x: -10, z: -6 }, { x: -15, z: -6 }],
    level: 1,
  };

  it("Plan-Handrechnung: siteW 38, siteD 28, height 12, poly[0] = zone[0] = {4, 4}, level 1", () => {
    const s = isoSzeneAusModell(FOOTPRINT, [ZONE], { storeys: 4, storeyHeight: 3, rand: 4 });
    assert.equal(s.siteW, 38);
    assert.equal(s.siteD, 28);
    assert.equal(s.height, 12);
    assert.deepEqual(s.poly[0], { x: 4, y: 4 });
    assert.deepEqual(s.fokusZonen[0].points[0], { x: 4, y: 4 });
    assert.equal(s.fokusZonen[0].level, 1);
  });

  it("Rundreise: toX3d/toZ3d (MassingView3D) = Footprint − Bbox-Mitte", () => {
    const s = isoSzeneAusModell(FOOTPRINT, [ZONE], { storeys: 4, storeyHeight: 3, rand: 4 });
    const toX3d = (p) => p.x - s.siteW / 2;
    const toZ3d = (p) => p.y - s.siteD / 2;
    s.poly.forEach((p, i) => {
      const mitteX = (Math.min(...FOOTPRINT.map((q) => q.x)) + Math.max(...FOOTPRINT.map((q) => q.x))) / 2;
      const mitteZ = (Math.min(...FOOTPRINT.map((q) => q.z)) + Math.max(...FOOTPRINT.map((q) => q.z))) / 2;
      assert.ok(Math.abs(toX3d(p) - (FOOTPRINT[i].x - mitteX)) < 1e-9, `poly[${i}] x`);
      assert.ok(Math.abs(toZ3d(p) - (FOOTPRINT[i].z - mitteZ)) < 1e-9, `poly[${i}] y`);
    });
  });

  it("Defaults: storeys 1, storeyHeight 3, rand 4; Zonen ohne level ⇒ 0", () => {
    const s = isoSzeneAusModell(FOOTPRINT, [{ points: ZONE.points }]);
    assert.equal(s.height, 3);
    assert.equal(s.siteW, 38);
    assert.equal(s.fokusZonen[0].level, 0);
  });

  it("leere/ungültige Eingaben ⇒ null (Aufrufer rendert keine Iso)", () => {
    assert.equal(isoSzeneAusModell(null, []), null);
    assert.equal(isoSzeneAusModell([{ x: 0, z: 0 }, { x: 1, z: 1 }], []), null); // < 3 Punkte
    assert.equal(isoSzeneAusModell([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }], []), null); // degeneriert
    // Ungültige Zonen fallen raus (filtert < 3 gültige Punkte), Szene bleibt gültig:
    const s = isoSzeneAusModell(FOOTPRINT, [{ points: [{ x: 0, z: 0 }] }, ZONE]);
    assert.equal(s.fokusZonen.length, 1);
    assert.equal(isoSzeneAusModell(FOOTPRINT, null).fokusZonen.length, 0);
  });
});
