// Unit tests for architectural dimension chains (Phase 75-15, MS-09, MSB-23).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ketteGeometrie, kettenPaar, normiereWinkel, seiteVon, formatMeter,
  UEBERSTAND_PX, STRICH_HALB_PX, TEXT_ABSTAND_PX,
} from "@designer/lib/masskette";

const nah = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** Perpendicular distance of a point from the line through a→b. */
const abstandVonLinie = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
  return Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / l;
};

describe("masskette — Format und Winkel", () => {
  it("formatMeter: Meter, zwei Nachkommastellen, Komma, keine Einheit", () => {
    assert.equal(formatMeter(3.14159), "3,14");
    assert.equal(formatMeter(3), "3,00");
    assert.equal(formatMeter(0.79), "0,79");
    assert.equal(formatMeter(NaN), "0,00");
  });
  it("normiereWinkel: nie kopfüber — 180 → 0, 135 → -45, 90 → -90, -90 bleibt, -135 → 45", () => {
    assert.equal(normiereWinkel(0), 0);
    assert.equal(normiereWinkel(180), 0);
    assert.equal(normiereWinkel(-180), 0);
    assert.equal(normiereWinkel(135), -45);
    assert.equal(normiereWinkel(90), -90);
    assert.equal(normiereWinkel(-90), -90);
    assert.equal(normiereWinkel(-135), 45);
    assert.equal(normiereWinkel(89.9999999), -90); // float noise snaps to the vertical case
  });
  it("seiteVon: Kette weg vom Zentrum", () => {
    // bottom edge (z = 5) of a box around (0,0): outside is +z = left normal of (1,0) → +1
    assert.equal(seiteVon([{ x: -3, z: 5 }, { x: 3, z: 5 }], { x: 0, z: 0 }), 1);
    // same edge, points right→left: left normal of (-1,0) is -z → inside → -1
    assert.equal(seiteVon([{ x: 3, z: 5 }, { x: -3, z: 5 }], { x: 0, z: 0 }), -1);
    // right edge bottom→top order (0,1): left normal (-1,0) points inside → -1
    assert.equal(seiteVon([{ x: 5, z: -3 }, { x: 5, z: 3 }], { x: 0, z: 0 }), -1);
  });
});

describe("masskette — waagerechte Kette", () => {
  const pxJeM = 40;
  const g = ketteGeometrie({ punkte: [{ x: 0, z: 0 }, { x: 3.14, z: 0 }, { x: 5.1, z: 0 }], offsetM: 0.5, seite: 1, pxJeM, schrift: 9 });
  it("Maßlinie parallel im Abstand offsetM, Winkel 0, drei Striche, drei Hilfslinien, zwei Texte", () => {
    nah(g.linie.a.z, 0.5); nah(g.linie.b.z, 0.5);
    nah(g.linie.a.x, 0); nah(g.linie.b.x, 5.1);
    assert.equal(g.winkel, 0);
    assert.equal(g.striche.length, 3);
    assert.equal(g.hilfslinien.length, 3);
    assert.deepEqual(g.texte.map((t) => t.text), ["3,14", "1,96"]);
  });
  it("Hilfslinie: vom Messpunkt bis UEBERSTAND_PX über die Maßlinie", () => {
    const h = g.hilfslinien[1];
    nah(h.a.x, 3.14); nah(h.a.z, 0);
    nah(h.b.x, 3.14); nah(h.b.z, 0.5 + UEBERSTAND_PX / pxJeM);
  });
  it("Schrägstrich 45°: gleich lange Komponenten, Gesamtlänge 2·STRICH_HALB_PX", () => {
    const s = g.striche[0];
    nah(Math.abs(s.b.x - s.a.x), Math.abs(s.b.z - s.a.z));
    nah(dist(s.a, s.b), 2 * STRICH_HALB_PX / pxJeM);
    nah((s.a.x + s.b.x) / 2, 0); nah((s.a.z + s.b.z) / 2, 0.5); // centred on the line
  });
  it("Text mittig ÜBER der Linie (Bildschirm-oben = kleineres z), nicht außen", () => {
    const t = g.texte[0];
    nah(t.x, 1.57);
    nah(t.z, 0.5 - TEXT_ABSTAND_PX / pxJeM);
    assert.equal(t.aussen, false);
    assert.equal(t.hinweis, undefined);
  });
  it("Punkte rückwärts (rechts → links) ergeben denselben Winkel 0 und dieselben Texte", () => {
    const r = ketteGeometrie({ punkte: [{ x: 5.1, z: 0 }, { x: 3.14, z: 0 }, { x: 0, z: 0 }], offsetM: 0.5, seite: -1, pxJeM, schrift: 9 });
    assert.equal(r.winkel, 0);
    nah(r.linie.a.z, 0.5);
    assert.deepEqual(r.texte.map((t) => t.text).sort(), ["1,96", "3,14"]);
    // text still ABOVE the line on screen, independent of the point order
    assert.ok(r.texte.every((t) => t.z < 0.5));
  });
  it("Dubletten (< 1 cm) fallen zusammen, unsortierte Eingabe wird sortiert", () => {
    const d = ketteGeometrie({ punkte: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 2, z: 0 }, { x: 2.005, z: 0 }], pxJeM });
    assert.equal(d.striche.length, 3);
    assert.deepEqual(d.texte.map((t) => t.text), ["2,00", "3,00"]);
  });
});

describe("masskette — senkrechte und schräge Ketten", () => {
  it("senkrechte Kette rechts: Winkel -90, Text links der Linie (Bildschirm-oben beim Lesen von unten)", () => {
    // right edge x = 9, points top→bottom, chain outside = +x
    const g = ketteGeometrie({ punkte: [{ x: 9, z: 0 }, { x: 9, z: 4.2 }, { x: 9, z: 9.55 }], offsetM: 0.5, seite: -1, pxJeM: 40 });
    nah(g.linie.a.x, 9.5); nah(g.linie.b.x, 9.5);
    assert.equal(g.winkel, -90);
    assert.deepEqual(g.texte.map((t) => t.text), ["4,20", "5,35"]);
    assert.ok(g.texte.every((t) => t.x < 9.5), "numbers sit left of the dimension line");
    nah(g.texte[0].z, 2.1);
  });
  it("45°-Kette: Winkel -45 oder 45, Text senkrecht TEXT_ABSTAND_PX von der Maßlinie", () => {
    const pxJeM = 50;
    const g = ketteGeometrie({ punkte: [{ x: 0, z: 0 }, { x: 4, z: 4 }], offsetM: 0.7, seite: 1, pxJeM });
    assert.equal(Math.abs(g.winkel), 45);
    nah(abstandVonLinie(g.linie.a, { x: 0, z: 0 }, { x: 4, z: 4 }), 0.7);
    nah(abstandVonLinie(g.texte[0], g.linie.a, g.linie.b), TEXT_ABSTAND_PX / pxJeM);
    assert.equal(g.texte[0].text, formatMeter(Math.hypot(4, 4)));
  });
  it("Winkel für jede Richtung im Bereich [-90, 90)", () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const r = deg * Math.PI / 180;
      const g = ketteGeometrie({ punkte: [{ x: 0, z: 0 }, { x: 3 * Math.cos(r), z: 3 * Math.sin(r) }], pxJeM: 40 });
      assert.ok(g.winkel >= -90 && g.winkel < 90, `${deg}° → ${g.winkel}`);
    }
  });
});

describe("masskette — Kollision und Gesamtkette", () => {
  it("zu kurzes Stück: Zahl außen (aussen: true) mit Hinweislinie; lange Stücke bleiben innen", () => {
    // 0,20 m at 40 px/m = 8 px — "0,20" needs ≈ 4·0,55·9 + 4 ≈ 24 px
    const g = ketteGeometrie({ punkte: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3.2, z: 0 }, { x: 6, z: 0 }], offsetM: 0.5, pxJeM: 40, schrift: 9 });
    assert.deepEqual(g.texte.map((t) => t.aussen), [false, true, false]);
    const a = g.texte[1];
    assert.ok(a.hinweis, "leader present");
    nah(a.hinweis.a.x, 3.1); nah(a.hinweis.a.z, 0.5); // leader starts on the line at the piece centre
    assert.ok(a.z > g.texte[0].z, "outer row lies further from the building than the inner text");
    assert.equal(g.aussenReihe, true);
  });
  it("zwei kurze Stücke nebeneinander: Außen-Texte überlappen nicht", () => {
    const g = ketteGeometrie({ punkte: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2.1, z: 0 }, { x: 2.2, z: 0 }, { x: 5, z: 0 }], pxJeM: 40, schrift: 9 });
    const aussen = g.texte.filter((t) => t.aussen);
    assert.equal(aussen.length, 2);
    const breiteM = ("0,10".length * 0.55 * 9 + 4) / 40;
    assert.ok(aussen[1].x - aussen[0].x >= breiteM - 1e-9, "second outer text starts after the first one ends");
  });
  it("Gesamtkette liegt AUSSERHALB der Teilkette und misst erste bis letzte Station", () => {
    const { teil, gesamt } = kettenPaar({ punkte: [{ x: 0, z: 0 }, { x: 3.14, z: 0 }, { x: 5.1, z: 0 }], offsetM: 0.5, seite: 1, pxJeM: 40 });
    assert.ok(gesamt, "overall chain present");
    assert.ok(gesamt.linie.a.z > teil.linie.a.z + UEBERSTAND_PX / 40, "beyond the part chain's extension overshoot");
    assert.ok(gesamt.linie.a.z > Math.max(...teil.texte.map((t) => t.z)), "beyond the part chain's text row");
    assert.deepEqual(gesamt.texte.map((t) => t.text), ["5,10"]);
    nah(gesamt.hilfslinien[0].a.x, 0); nah(gesamt.hilfslinien[1].a.x, 5.1); // extension lines from the building
  });
  it("Gesamtkette entfällt bei nur einem Stück oder gesamt:false", () => {
    assert.equal(kettenPaar({ punkte: [{ x: 0, z: 0 }, { x: 4, z: 0 }], pxJeM: 40 }).gesamt, null);
    assert.equal(kettenPaar({ punkte: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }], pxJeM: 40, gesamt: false }).gesamt, null);
  });
  it("weniger als zwei gültige Punkte → leere Kette ohne Fehler", () => {
    const g = ketteGeometrie({ punkte: [{ x: 1, z: 1 }, { x: NaN, z: 0 }], pxJeM: 40 });
    assert.equal(g.texte.length, 0);
    assert.equal(g.striche.length, 0);
    assert.equal(ketteGeometrie({ punkte: null }).hilfslinien.length, 0);
  });
});
