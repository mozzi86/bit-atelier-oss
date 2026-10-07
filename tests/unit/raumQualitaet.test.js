// Unit tests for packages/nova-designer/src/lib/raumQualitaet.js (Plan 75-14 Tasks 3+4).
//
// Fixture: the screenshot apartment before (2,19 × 9,55 m bedroom, 1,51 m strip) and
// after the 75-14 slicing. The honest numbers of the picture unit stand in the tests:
// a 7,75 m facade cannot light three rooms at ≤ 1 : 1,8 (needs 9,20 m at the minimum
// widths), so the slicing merges the child room into the bedroom and the ratio stays a
// WARN (not a fail) — see 75-14-SUMMARY.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { raumSlicing, wohnungsRegeln, WOHNUNGS_REGELN } from "@designer/lib/tesselierung";
import {
  seitenverhaeltnis, mindestflaeche, mindestbreite, schrankwand, pruefe, pruefeWohnung, pruefeAlle, fensterKanten, bboxVon,
} from "@designer/lib/raumQualitaet";
import { BILD_PROGRAMM, BILD_BAND, BILD_ZONEN_VORHER, BILD_BBOX } from "./fixtures/bildWohnung.js";

const r2 = (v) => Math.round(v * 100) / 100;
const WR = wohnungsRegeln({ wohnungsgrundriss: true });
const kurz = (n) => n.replace(/ \(WE 0-1\) ·WT$/, "");

describe("raumQualitaet — Regeln und Auflösung", () => {
  it("wohnungsRegeln: ohne Schalter alles aus; wohnungsgrundriss setzt die Büro-Defaults; Einzelwerte überschreiben", () => {
    assert.equal(wohnungsRegeln(null).aktiv, false);
    assert.equal(wohnungsRegeln({}).aktiv, false);
    assert.deepEqual({ ...WR }, { aktiv: true, diele: true, raumMin_m2: 10, seitenverhaeltnisMax: 1.8, seitenverhaeltnisFail: 2.5, schrankwand_m: 3, schlafenMinBreite_m: 2.4 });
    const nur = wohnungsRegeln({ raumMin_m2: 12 });
    assert.equal(nur.aktiv, true);
    assert.equal(nur.raumMin_m2, 12);
    assert.equal(nur.diele, false);
    assert.equal(wohnungsRegeln({ wohnungsgrundriss: true, schrankwand_m: 0 }).schrankwand_m, 0);
    assert.equal(WOHNUNGS_REGELN.schlafenMinBreite_m, 2.4, "D-P75-14-A");
    assert.equal(WOHNUNGS_REGELN.seitenverhaeltnisMax, 1.8, "D-P75-14-B");
  });

  it("Bild-Wohnung vorher: Schlafen 2,19 × 9,55 = 1 : 4,36 fail, Kind 1,51 m fail, Kind 14 m² ok, Streifen < 2,40 m", () => {
    const schlafen = BILD_ZONEN_VORHER.find((z) => /Schlafen/.test(z.name));
    const kind = BILD_ZONEN_VORHER.find((z) => /Kind/.test(z.name));
    const sv = seitenverhaeltnis(schlafen, WR);
    assert.equal(sv.stufe, "fail");
    assert.equal(sv.wert, 4.36);
    assert.match(sv.text, /Schlauch/);
    assert.match(sv.text, /braucht der Raum ≥ 3,41 m Fassade/, "sqrt(20,9 / 1,8) = 3,41 m");
    assert.equal(seitenverhaeltnis(kind, WR).stufe, "fail");
    assert.equal(mindestbreite(kind, WR).stufe, "fail");
    assert.equal(mindestbreite(kind, WR).wert, 1.51);
    assert.equal(mindestflaeche(kind, WR).stufe, "ok", "14 m² ≥ 10 m²");
    const alle = pruefeAlle(BILD_ZONEN_VORHER, { regeln: { wohnungsgrundriss: true }, bbox: BILD_BBOX });
    assert.equal(alle.length, 1);
    const q = alle[0];
    // 3 unreachable rooms + unit line + no hall → access fails.
    assert.equal(q.eintraege.filter((e) => e.regel === "erschliessung" && e.stufe === "fail").length, 4);
    assert.ok(q.eintraege.some((e) => e.regel === "diele" && e.stufe === "fail"));
    // Schlafen 1 : 4,36 and Kind 1 : 6,32 → fail; Wohnen 4,05 × 9,55 = 1 : 2,36 → warn (< 2,5).
    assert.equal(q.eintraege.filter((e) => e.regel === "seitenverhaeltnis" && e.stufe === "fail").length, 2);
    assert.equal(q.eintraege.filter((e) => e.regel === "seitenverhaeltnis" && e.stufe === "warn").length, 1);
    assert.ok(q.zaehler.fail >= 7, `fails: ${q.zaehler.fail}`);
  });

  it("Bild-Wohnung nachher: kein Raum < 2,40 m, keiner < 10 m², 0 fail; Seitenverhältnis bleibt warn (Fassade 7,75 m)", () => {
    const zonen = raumSlicing(BILD_BAND, BILD_PROGRAMM, { wohnungsgrundriss: true });
    const q = pruefeWohnung(zonen, { regeln: { wohnungsgrundriss: true }, bbox: BILD_BBOX });
    assert.equal(q.zaehler.fail, 0, JSON.stringify(q.eintraege.filter((e) => e.stufe === "fail")));
    for (const z of zonen.filter((x) => x.art === "aufenthalt")) {
      const bb = bboxVon(z);
      assert.ok(Math.min(bb.w, bb.d) >= 2.4 - 1e-9, `${z.name} ${r2(Math.min(bb.w, bb.d))} m`);
      assert.ok(z.flaeche_m2 >= 10, `${z.name} ${r2(z.flaeche_m2)} m²`);
    }
    assert.equal(zonen.filter((z) => z.art === "aufenthalt").length, 2, "Kind in Schlafen zusammengelegt");
    assert.ok(zonen.warns.some((w) => /zusammengelegt/.test(w) && /nötig 9,20 m/.test(w)), zonen.warns.join(" | "));
    const sv = q.eintraege.filter((e) => e.regel === "seitenverhaeltnis");
    assert.equal(sv.length, 2);
    assert.ok(sv.every((e) => e.stufe === "warn"), "1 : 2,11 und 1 : 2,35 — über 1,8, unter 2,5");
    assert.ok(q.eintraege.some((e) => e.regel === "erschliessung" && e.stufe === "ok"));
  });

  it("Schrankwand Bild-Wohnung nachher: Schlafen hat die Trennwand zu Wohnen frei (8,61 − 0,20 m), nicht Tür-, nicht Fensterwand", () => {
    const zonen = raumSlicing(BILD_BAND, BILD_PROGRAMM, { wohnungsgrundriss: true });
    const schlafen = zonen.find((z) => /^Schlafen/.test(z.name));
    const s = schrankwand(schlafen, { bbox: BILD_BBOX }, WR);
    assert.equal(s.stufe, "ok", s.text);
    assert.equal(s.wert, 8.41, "8,61 m Tiefe − 2 × 0,10 m");
    assert.notEqual(s.wand, schlafen.tueren[0].wand);
    assert.notEqual(s.wand, schlafen.fensterwand);
    assert.ok(s.rect && s.rect.x1 - s.rect.x0 > 0 && s.rect.z1 - s.rect.z0 > 0);
  });

  it("Schrankwand: Raum 2,19 m breit → längste freie Wand ist die Längswand; ein 2,8 × 3,5-Raum mit Tür + Fenster quer liefert warn mit Zahl", () => {
    // 2,8 × 3,5 m: door in edge 0 (3,5 m side? no — edges: 0 bottom 2,8, 1 right 3,5, 2 top 2,8, 3 left 3,5),
    // door in the left wall, window in the right wall → free walls are the 2,8 m ones: 2,60 m < 3,00 → warn.
    const raum = {
      points: [{ x: 0, z: 0 }, { x: 2.8, z: 0 }, { x: 2.8, z: 3.5 }, { x: 0, z: 3.5 }],
      name: "Kind", art: "aufenthalt", flaeche_m2: 9.8, fensterwand: 1,
      tueren: [{ wand: 3, u_m: 0.15, breite_m: 0.885, aufschlag: "links", nach: "Diele" }],
    };
    const s = schrankwand(raum, {}, WR);
    assert.equal(s.stufe, "warn");
    assert.equal(s.wert, 2.6);
    assert.match(s.text, /längste freie Wand 2,60 m/);
    // Window wall from the bbox when the slicing did not tag one.
    const ohneTag = { ...raum, fensterwand: undefined };
    assert.deepEqual([...fensterKanten(ohneTag, { minX: -5, maxX: 2.8, minZ: -5, maxZ: 10 })], [1]);
  });

  it("Schrankwand: Türaufschlag in die Schrank-Bewegungsfläche → warn Türaufschlag", () => {
    // 3,4 × 3,4 room, window wall 2 (top), door in wall 1 (right) near the bottom corner
    // → free wall 0 (bottom) hosts the wardrobe; the leaf swings along the bottom wall
    // into the wardrobe strip (0,60 + 0,90 m) → warn.
    const raum = {
      points: [{ x: 0, z: 0 }, { x: 3.4, z: 0 }, { x: 3.4, z: 3.4 }, { x: 0, z: 3.4 }],
      name: "Schlafen", art: "aufenthalt", flaeche_m2: 11.56, fensterwand: 2,
      tueren: [{ wand: 1, u_m: 0.15, breite_m: 0.885, aufschlag: "links", nach: "Diele" }],
    };
    const s = schrankwand(raum, {}, WR);
    assert.equal(s.stufe, "warn");
    assert.match(s.text, /Türaufschlag/);
    // Hinge at the far end instead → the leaf swings away from the wardrobe → ok.
    const ok = schrankwand({ ...raum, tueren: [{ ...raum.tueren[0], u_m: 2.3 }] }, {}, WR);
    assert.equal(ok.stufe, "ok", ok.text);
    assert.equal(ok.wand, 0);
  });

  it("Stufe R vertieft die Bewegungsfläche vor dem Schrank (0,90 → 1,50 m) — Text nennt die Tiefe", () => {
    const raum = {
      points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }],
      name: "Schlafen", art: "aufenthalt", flaeche_m2: 16, fensterwand: 2, tueren: [{ wand: 1, u_m: 2.9, breite_m: 0.885, aufschlag: "links", nach: "Diele" }],
    };
    assert.match(schrankwand(raum, { stufe: "standard" }, WR).text, /1,50 m Bewegungsfläche/);
    assert.match(schrankwand(raum, { stufe: "R" }, WR).text, /2,10 m Bewegungsfläche/);
  });

  it("pruefe: Flur/Bad liefern keine Aufenthalts-Prüfungen; Regel aus → leere Liste", () => {
    const bad = { points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 5 }, { x: 0, z: 5 }], name: "Bad", art: "sanitaer", flaeche_m2: 5 };
    assert.deepEqual(pruefe(bad, { regeln: { wohnungsgrundriss: true } }), []);
    const schlauch = { points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 6 }, { x: 0, z: 6 }], name: "Wohnen", art: "aufenthalt", flaeche_m2: 12 };
    assert.deepEqual(pruefe(schlauch, { regeln: {} }), []);
    const mit = pruefe(schlauch, { regeln: { wohnungsgrundriss: true } });
    assert.deepEqual(mit.map((e) => `${e.regel}:${e.stufe}`), ["seitenverhaeltnis:fail", "raumMin:ok"]);
  });

  it("raumMin: 9 m² Aufenthaltsraum = fail mit Vorschlag; Seitenverhältnis 1 : 1,8 genau = ok, 1 : 1,81 = warn", () => {
    const klein = { points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }], name: "Kind", art: "aufenthalt", flaeche_m2: 9 };
    const m = mindestflaeche(klein, WR);
    assert.equal(m.stufe, "fail");
    assert.match(m.text, /Abstellraum/);
    const genau = { points: [{ x: 0, z: 0 }, { x: 2.5, z: 0 }, { x: 2.5, z: 4.5 }, { x: 0, z: 4.5 }], name: "Wohnen", art: "aufenthalt", flaeche_m2: 11.25 };
    assert.equal(seitenverhaeltnis(genau, WR).stufe, "ok");
    const knapp = { ...genau, points: [{ x: 0, z: 0 }, { x: 2.5, z: 0 }, { x: 2.5, z: 4.525 }, { x: 0, z: 4.525 }] };
    assert.equal(seitenverhaeltnis(knapp, WR).stufe, "warn");
  });
});
