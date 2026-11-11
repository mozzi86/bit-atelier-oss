// Grundriss-Bedienung Teil 2 (Auswahl ziehen) and Teil 3 (Maß tippen in der Wandkette): the pure rules in
// @core/lib/bauteil/grundrissBearbeiten.js and the cancelled drag of @designer/lib/bimHistorie. Expected values are computed by
// hand in the comments; neutral test geometry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auswahlVerschieben, auswahlGetroffen, zugBezugspunkt, auswahlPunkte, fangQuellenDerAuswahl, massEingabeLesen, punktInRichtung,
} from "@core/lib/bauteil/grundrissBearbeiten.js";
import { leereHistorie, vorAenderung, zieheStart, zieheAbbrechen, zieheEnde } from "@designer/lib/bimHistorie";

// wall 1 along +x (0,0)→(6,0) with a 1.00-m door at u = 3; wall 2 along +z (10,0)→(10,4) with a 1.00-m window at u = 2;
// column 7 at (3, 3); a 2 × 2 zone 9 at (20..22, 0..2) with no holes
const STAND = {
  customWalls: [
    { _idx: 1, a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.3 },
    { _idx: 2, a: { x: 10, z: 0 }, b: { x: 10, z: 4 }, level: 0, thickness: 0.3 },
  ],
  customColumns: [{ _idx: 7, x: 3, z: 3, level: 0, size: 0.4 }],
  customWindows: [
    { _idx: 5, kind: "door", wallIdx: 1, u: 3, width: 1 },
    { _idx: 6, kind: "window", wallIdx: 2, u: 2, width: 1 },
  ],
  envOpenings: [],
  customZones: [{ _idx: 9, level: 0, points: [{ x: 20, z: 0 }, { x: 22, z: 0 }, { x: 22, z: 2 }, { x: 20, z: 2 }] }],
  customSlabs: [],
  customRoofs: [],
};
const KOPIE = JSON.stringify(STAND);

describe("Auswahl ziehen: auswahlVerschieben", () => {
  it("Wand und Stütze wandern um den vollen Versatz, die Tür der Wand bleibt unverändert an ihr (u)", () => {
    const r = auswahlVerschieben(STAND, [{ type: "wall", index: 1 }, { type: "column", index: 7 }], { dx: 1.5, dz: -0.25 });
    assert.deepEqual(r.customWalls?.[0].a, { x: 1.5, z: -0.25 });
    assert.deepEqual(r.customWalls?.[0].b, { x: 7.5, z: -0.25 });
    assert.equal(r.customWalls?.[1], STAND.customWalls[1], "nicht gewählte Wand: dasselbe Objekt");
    assert.deepEqual([r.customColumns?.[0].x, r.customColumns?.[0].z], [4.5, 2.75]);
    assert.equal(r.customWindows, undefined, "Öffnungen hängen über wallIdx + u an der Wand, nichts zu schreiben");
    assert.equal(JSON.stringify(STAND), KOPIE, "Eingabe unverändert");
  });

  it("einzeln gewählte Tür gleitet nur entlang ihrer Wand (Projektion des Versatzes) und bleibt geklemmt", () => {
    // wall 1 runs along +x: offset (1.2, 5) → du = 1.2 → u = 4.2
    const r = auswahlVerschieben(STAND, [{ type: "opening", index: 5, scope: "custom" }], { dx: 1.2, dz: 5 });
    assert.equal(r.customWindows?.find((o) => o._idx === 5).u, 4.2);
    assert.equal(r.customWalls, undefined, "die Wand bewegt sich nicht");
    // far past the end: max = 6 − 0.5 − 0.05 = 5.45
    const weit = auswahlVerschieben(STAND, [{ type: "opening", index: 5, scope: "custom" }], { dx: 20, dz: 0 });
    assert.equal(weit.customWindows?.find((o) => o._idx === 5).u, 5.45);
    // wall 2 runs along +z: offset (3, −1) → du = −1 → u = 1
    const z = auswahlVerschieben(STAND, [{ type: "opening", index: 6, scope: "custom" }], { dx: 3, dz: -1 });
    assert.equal(z.customWindows?.find((o) => o._idx === 6).u, 1);
  });

  it("Tür zusammen mit ihrer Wand gewählt: sie gleitet nicht zusätzlich", () => {
    const r = auswahlVerschieben(STAND, [{ type: "wall", index: 1 }, { type: "opening", index: 5, scope: "custom" }], { dx: 2, dz: 0 });
    assert.equal(r.customWindows, undefined);
  });

  it("Raum: alle Ecken wandern, Versatz 0 ändert nichts", () => {
    const r = auswahlVerschieben(STAND, [{ type: "zone", index: 9 }], { dx: -1, dz: 0.5 });
    assert.deepEqual(r.customZones?.[0].points[0], { x: 19, z: 0.5 });
    assert.deepEqual(auswahlVerschieben(STAND, [{ type: "zone", index: 9 }], { dx: 0, dz: 0 }), {});
  });

  it("Hüllöffnung gleitet entlang ihrer Hüllwand", () => {
    const stand = { ...STAND, envOpenings: [{ _idx: 30, level: 0, edge: 2, u: 2, width: 1 }] };
    const huelle = [{ level: 0, edge: 2, a: { x: 0, z: 10 }, b: { x: 0, z: 0 } }]; // along −z
    const r = auswahlVerschieben(stand, [{ type: "opening", index: 30, scope: "env" }], { dx: 0, dz: -1 }, huelle);
    assert.equal(r.envOpenings?.[0].u, 3); // −1 in z is +1 along the wall
  });
});

describe("Auswahl ziehen: Treffer, Bezugspunkt, Fangquellen", () => {
  const auswahl = [{ type: "wall", index: 1 }, { type: "column", index: 7 }];
  it("Treffer: Wand in halber Dicke + Toleranz, Stütze im Quadrat + Toleranz, daneben nicht", () => {
    assert.equal(auswahlGetroffen(STAND, auswahl, { x: 2, z: 0.2 }, 0.06), true); // 0.15 + 0.06 ≥ 0.2
    assert.equal(auswahlGetroffen(STAND, auswahl, { x: 2, z: 0.25 }, 0.06), false);
    assert.equal(auswahlGetroffen(STAND, auswahl, { x: 3.25, z: 3 }, 0.06), true); // 0.2 + 0.06
    assert.equal(auswahlGetroffen(STAND, [{ type: "wall", index: 2 }], { x: 2, z: 0 }, 0.06), false, "nur die Auswahl zählt");
    assert.equal(auswahlGetroffen(STAND, [{ type: "zone", index: 9 }], { x: 21, z: 1 }, 0.06), true, "im Raum");
    assert.equal(auswahlGetroffen(STAND, [{ type: "opening", index: 5, scope: "custom" }], { x: 3.5, z: 0 }, 0.06), true);
  });
  it("Bezugspunkt: nächstgelegener Punkt der Auswahl im Fangradius, sonst der gedrückte Punkt", () => {
    assert.deepEqual(zugBezugspunkt(STAND, auswahl, { x: 5.8, z: 0.1 }, 0.3), { x: 6, z: 0 });
    assert.deepEqual(zugBezugspunkt(STAND, auswahl, { x: 2, z: 0.1 }, 0.3), { x: 2, z: 0.1 });
    assert.equal(auswahlPunkte(STAND, auswahl).length, 3); // two wall ends + column middle
  });
  it("Fangquellen: gezogene Wände, Stützen, Polygone werden ausgelassen, Öffnungen sind keine Quelle", () => {
    assert.deepEqual(fangQuellenDerAuswahl([...auswahl, { type: "zone", index: 9 }, { type: "opening", index: 5 }]), ["w1", "c7", "p9"]);
  });
});

describe("Maß tippen in der Wandkette", () => {
  it("Komma und Punkt, Meter, auf mm gerundet", () => {
    assert.deepEqual(massEingabeLesen("2,5"), { ok: true, laenge_m: 2.5 });
    assert.deepEqual(massEingabeLesen("3.75"), { ok: true, laenge_m: 3.75 });
    assert.deepEqual(massEingabeLesen(",5"), { ok: true, laenge_m: 0.5 });
    assert.deepEqual(massEingabeLesen("1,23456"), { ok: true, laenge_m: 1.235 });
  });
  it("ungültig oder unter 5 cm: abgelehnt mit Grund; *3 und /3 sind kein Maß", () => {
    for (const t of ["", "abc", "1,2,3", "*3", "/3", "-1", "2,5m"]) assert.equal(massEingabeLesen(t).ok, false, t);
    const kurz = massEingabeLesen("0,04");
    assert.equal(kurz.ok, false);
    assert.match("grund" in kurz ? kurz.grund : "", /mindestens 5 cm/);
    assert.equal(massEingabeLesen("0,05").ok, true);
  });
  it("Punkt in Zeigerrichtung: Länge vom letzten Punkt, ohne Richtung null", () => {
    assert.deepEqual(punktInRichtung({ x: 1, z: 1 }, { x: 4, z: 5 }, 10), { x: 7, z: 9 }); // 3-4-5 → (6, 8)
    assert.deepEqual(punktInRichtung({ x: 0, z: 0 }, { x: -0.3, z: 0 }, 2.5), { x: -2.5, z: 0 });
    assert.equal(punktInRichtung({ x: 1, z: 1 }, { x: 1, z: 1 }, 2), null);
    assert.equal(punktInRichtung({ x: 1, z: 1 }, null, 2), null);
  });
});

describe("Abgebrochener Zug: kein Rückgängig-Schritt", () => {
  const A = { w: ["a"] }, B = { w: ["a", "b"] };
  it("Esc nach der ersten Änderung nimmt den Schritt des Zugs wieder weg", () => {
    let h = vorAenderung(leereHistorie(), A); // an earlier step: A before
    h = zieheStart(h);
    h = vorAenderung(h, B); // the drag's first move stores B (state at the press)
    h = vorAenderung(h, { w: ["x"] }); // later moves store nothing
    assert.equal(h.stack.past.length, 2);
    h = zieheAbbrechen(h, B);
    assert.deepEqual(h.stack.past, [A], "nur der frühere Schritt bleibt");
    assert.equal(h.ziehe, false);
  });
  it("Esc ohne Änderung oder mit fremdem letzten Eintrag: Stapel bleibt", () => {
    const h0 = vorAenderung(leereHistorie(), A);
    assert.deepEqual(zieheAbbrechen(zieheStart(h0), B).stack.past, [A], "nichts gemerkt");
    const h1 = vorAenderung(zieheStart(h0), B);
    assert.deepEqual(zieheAbbrechen(h1, { w: ["anders"] }).stack.past, [A, B], "letzter Eintrag ist nicht der des Zugs");
    assert.deepEqual(zieheEnde(h1).stack.past, [A, B], "normales Loslassen behält den Schritt");
  });
});
