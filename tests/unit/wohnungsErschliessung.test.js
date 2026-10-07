// Unit tests for packages/nova-designer/src/lib/wohnungsErschliessung.js (Plan 75-14 Task 1).
//
// Fixture: the user's screenshot apartment (tests/e2e/fixtures/bildWohnung.js) — before
// (no doors, no hall: legacy adjacency reading) and after the 75-14 slicing (hall +
// doors). Expectations are hand-derived; the arithmetic stands in each test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { raumSlicing, TUERBREITEN, TUER_ANSCHLAG_ABSTAND } from "@designer/lib/tesselierung";
import {
  erreichbarkeit, erreichbarkeitJeWe, gemeinsameKante, tuerGeometrie, innenNormale, kantenVon,
  istFlurZone, ADJAZENZ_MIN_M,
} from "@designer/lib/wohnungsErschliessung";
import { BILD_PROGRAMM, BILD_BAND, BILD_ZONEN_VORHER } from "./fixtures/bildWohnung.js";

const r2 = (v) => Math.round(v * 100) / 100;
const nachher = () => raumSlicing(BILD_BAND, BILD_PROGRAMM, { wohnungsgrundriss: true });

describe("wohnungsErschliessung — Erschließungsgraph der Bild-Wohnung", () => {
  it("vorher (Screenshot, keine Türen): Näherung über Adjazenz, 3 Räume unerreichbar, keine Diele", () => {
    // Flur strip x 5,30–7,75 at z 0–2,45: touches Bad (2,45 m) and Kind (1,51 m) fully,
    // Schlafen only 6,24 − 5,30 = 0,94 m < 1,185 m (door + two jambs) → unreachable.
    const e = erreichbarkeit(BILD_ZONEN_VORHER);
    assert.equal(e.naeherung, true);
    assert.equal(e.diele, false);
    assert.deepEqual(e.unerreichbar.map((n) => n.replace(/ \(WE 0-1\) ·WT$/, "")).sort(), ["Küche", "Schlafen", "Wohnen/Essen"]);
    assert.equal(e.fehler.filter((f) => f.regel === "erschliessung").length, 3);
    assert.equal(r2(ADJAZENZ_MIN_M), r2(TUERBREITEN.zimmer + 2 * TUER_ANSCHLAG_ABSTAND));
  });

  it("nachher (75-14-Zuschnitt): Diele vorhanden, 0 unerreichbar, jeder Raum hat genau eine Tür zur Diele", () => {
    const zonen = nachher();
    const e = erreichbarkeit(zonen);
    assert.equal(e.naeherung, false);
    assert.equal(e.diele, true, "Diele benannt");
    assert.deepEqual(e.unerreichbar, []);
    assert.deepEqual(e.fehler, []);
    const diele = zonen.find((z) => /Diele/.test(z.name));
    const raeume = zonen.filter((z) => !istFlurZone(z));
    assert.ok(raeume.length >= 4);
    for (const r of raeume) {
      assert.equal(r.tueren.length, 1, `${r.name} eine Tür`);
      assert.equal(r.tueren[0].nach, diele.name);
    }
    // Door edges: every room door counts, plus the hall's own entrance door (nach null).
    assert.equal(e.graph.kanten.filter((k) => k.typ === "tuer").length, raeume.length);
    assert.equal(diele.tueren.length, 1);
    assert.equal(diele.tueren[0].nach, null);
    assert.equal(diele.tueren[0].typ, "wohnung");
  });

  it("Türbreiten CITED DIN 18100: Zimmer 0,885, Bad + Wohnungstür 0,985; Anschlag 0,15 m von der Wand", () => {
    const zonen = nachher();
    const bad = zonen.find((z) => /^Bad/.test(z.name));
    const wohnen = zonen.find((z) => /^Wohnen/.test(z.name));
    const diele = zonen.find((z) => /Diele/.test(z.name));
    assert.equal(bad.tueren[0].breite_m, 0.985);
    assert.equal(wohnen.tueren[0].breite_m, 0.885);
    assert.equal(diele.tueren[0].breite_m, 0.985);
    assert.equal(wohnen.tueren[0].u_m, 0.15);
    assert.equal(TUERBREITEN.bad, 0.985);
  });

  it("keine Tür in der Fassadenwand: Türwand ≠ fensterwand, Türkante liegt an der Diele", () => {
    const zonen = nachher();
    const diele = zonen.find((z) => /Diele/.test(z.name));
    for (const z of zonen.filter((q) => q.fensterpflicht)) {
      assert.notEqual(z.tueren[0].wand, z.fensterwand, `${z.name}: Tür nicht in der Fensterwand`);
      const g = gemeinsameKante(z, diele);
      assert.ok(g, `${z.name} teilt eine Wand mit der Diele`);
      assert.equal(g.kanteA, z.tueren[0].wand, `${z.name}: Türwand = gemeinsame Wand`);
      assert.ok(g.laenge >= 0.885 + 0.3 - 1e-9);
    }
  });

  it("Aufschlag nie gegen das Fenster: offenes Türblatt zeigt vom Fenster weg (Innen-Normale der Türwand)", () => {
    const zonen = nachher();
    for (const z of zonen.filter((q) => q.fensterpflicht)) {
      const g = tuerGeometrie(z, z.tueren[0]);
      const fenster = kantenVon(z).find((k) => k.i === z.fensterwand);
      // Leaf tip must be farther from the window wall than the hinge: facade at z = 12,
      // the door is in the z-low edge, so the leaf moves towards +z but stays near the
      // door wall (b = 0,885 m ≪ room depth 8,6 m).
      const abstand = (p) => Math.abs((p.x - fenster.a.x) * (fenster.b.z - fenster.a.z) - (p.z - fenster.a.z) * (fenster.b.x - fenster.a.x)) / fenster.laenge;
      assert.ok(abstand(g.offen) > 1.0, `${z.name}: Türblatt bleibt ${r2(abstand(g.offen))} m vom Fenster`);
      assert.ok(abstand(g.offen) < abstand(g.scharnier) + 1e-9, "Blatt schwingt in den Raum, also vom Fenster weg gemessen vom Scharnier");
      assert.equal(g.bogen.length, 9);
    }
  });

  it("Türgeometrie: links = Scharnier am u_m-Ende, rechts = am u_m+breite-Ende, Bogen 90° in den Raum", () => {
    const raum = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] };
    const links = tuerGeometrie(raum, { wand: 0, u_m: 0.15, breite_m: 0.885, aufschlag: "links" });
    const rechts = tuerGeometrie(raum, { wand: 0, u_m: 0.15, breite_m: 0.885, aufschlag: "rechts" });
    assert.deepEqual({ x: r2(links.scharnier.x), z: r2(links.scharnier.z) }, { x: 0.15, z: 0 });
    assert.deepEqual({ x: Math.round(rechts.scharnier.x * 1000) / 1000, z: r2(rechts.scharnier.z) }, { x: 1.035, z: 0 }, "0,15 + 0,885");
    // Edge 0 runs along +x at z = 0; the room lies at +z → inward normal +z.
    assert.deepEqual(innenNormale(raum, kantenVon(raum)[0]), { x: -0, z: 1 });
    assert.equal(r2(links.offen.z), 0.89);
    assert.equal(r2(links.aabb.z1), 0.89);
    assert.equal(tuerGeometrie(raum, { wand: 7, u_m: 0, breite_m: 0.885 }), null, "unbekannte Kante → null");
  });

  it("Durchgangszimmer zählen nie (D-P75-14-C): Tür Bad ← Wohnen = fail, Bad bleibt unerreichbar", () => {
    const flur = { points: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 1.2 }, { x: 0, z: 1.2 }], name: "Diele", we: "A", art: "flur", tueren: [] };
    const wohnen = { points: [{ x: 0, z: 1.2 }, { x: 3, z: 1.2 }, { x: 3, z: 6 }, { x: 0, z: 6 }], name: "Wohnen", we: "A", art: "aufenthalt", tueren: [{ wand: 0, u_m: 0.15, breite_m: 0.885, aufschlag: "links", nach: "Diele" }] };
    const bad = { points: [{ x: 3, z: 1.2 }, { x: 6, z: 1.2 }, { x: 6, z: 6 }, { x: 3, z: 6 }], name: "Bad", we: "A", art: "sanitaer", tueren: [{ wand: 3, u_m: 0.15, breite_m: 0.985, aufschlag: "links", nach: "Wohnen" }] };
    const e = erreichbarkeit([flur, wohnen, bad]);
    assert.deepEqual(e.unerreichbar, ["Bad"]);
    assert.ok(e.fehler.some((f) => f.regel === "bad_vom_wohnraum"), "Bad vom Wohnraum = fail");
    assert.ok(e.fehler.some((f) => f.regel === "erschliessung" && f.raum === "Bad"));
  });

  it("offene Küche: Küche ohne eigene Tür, ≥ 1 m Wand zum erreichbaren Wohnraum = Teil des Wohnraums", () => {
    const flur = { points: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 1.2 }, { x: 0, z: 1.2 }], name: "Diele", we: "A", art: "flur", tueren: [] };
    const wohnen = { points: [{ x: 0, z: 1.2 }, { x: 4, z: 1.2 }, { x: 4, z: 6 }, { x: 0, z: 6 }], name: "Wohnen/Essen", we: "A", art: "aufenthalt", tueren: [{ wand: 0, u_m: 0.15, breite_m: 0.885, aufschlag: "links", nach: "Diele" }] };
    const kueche = { points: [{ x: 4, z: 1.2 }, { x: 6, z: 1.2 }, { x: 6, z: 6 }, { x: 4, z: 6 }], name: "Küche", we: "A", art: "kueche", tueren: [] };
    const e = erreichbarkeit([flur, wohnen, kueche]);
    assert.deepEqual(e.unerreichbar, []);
    assert.ok(e.graph.kanten.some((k) => k.typ === "offen" && k.nach === "Küche"));
    // Switched off: the kitchen needs a door of its own.
    assert.deepEqual(erreichbarkeit([flur, wohnen, kueche], { offeneKueche: false }).unerreichbar, ["Küche"]);
  });

  it("Tür zu unbekanntem Raum + Wohnung ohne Flur werden als Fehler gemeldet, nicht still verworfen", () => {
    const raum = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], name: "Zimmer", we: "A", art: "aufenthalt", tueren: [{ wand: 0, u_m: 0.15, breite_m: 0.885, aufschlag: "links", nach: "Nirgendwo" }] };
    const e = erreichbarkeit([raum]);
    assert.ok(e.fehler.some((f) => f.regel === "tuer" && /Nirgendwo/.test(f.text)));
    assert.ok(e.fehler.some((f) => f.regel === "diele"));
    assert.deepEqual(e.unerreichbar, ["Zimmer"]);
  });

  it("erreichbarkeitJeWe gruppiert über das we-Feld; Flur-/Kernzonen ohne we werden übersprungen", () => {
    const zonen = [...nachher(), { points: [{ x: -2, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 12 }, { x: -2, z: 12 }], name: "Flur 0 ·WT", raumart: "flur" }];
    const m = erreichbarkeitJeWe(zonen);
    assert.deepEqual([...m.keys()], ["WE 0-1"]);
    assert.deepEqual(m.get("WE 0-1").unerreichbar, []);
  });

  it("gemeinsameKante: längste kollineare Überlappung, Intervall in Metern entlang der Kante von A", () => {
    const a = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] };
    const b = { points: [{ x: 2, z: 3 }, { x: 7, z: 3 }, { x: 7, z: 5 }, { x: 2, z: 5 }] };
    const g = gemeinsameKante(a, b);
    assert.equal(g.kanteA, 2, "obere Kante von A (x 4 → 0 bei z 3)");
    assert.equal(r2(g.laenge), 2);
    assert.equal(r2(g.uA0), 0, "Überlappung beginnt am Kantenanfang (x = 4)");
    assert.equal(r2(g.uA1), 2);
    assert.equal(gemeinsameKante(a, { points: [{ x: 10, z: 10 }, { x: 11, z: 10 }, { x: 11, z: 11 }] }), null);
  });
});
