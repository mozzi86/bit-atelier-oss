// Unit-Tests für packages/nova-core/src/lib/zonenNachLoad.js (I-02, externe
// Review Phase 61): ein Route-Wechsel (Re-Mount des Komplex-Designers im SELBEN
// Projekt) darf die Session-Zonen ·W (Wohnungsplaner) und ·WT (Wohnungs-
// Werkstatt) nicht aus dem Store werfen — ein Projektwechsel schon.
//
// Das Prädikat ist genau das, was ComplexDesigner übergibt (dieselben Marker
// wie der KD-18-Merge in BitBimStudio).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { zonenNachLoad } from "@core/lib/zonenNachLoad";
import { istGeneriert } from "@designer/lib/apartments";
import { istWerkstattZone } from "@designer/lib/tesselierung";

const behalten = (z) => istGeneriert(z) || istWerkstattZone(z);
const pts = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];

const geladenManuell = { points: pts, level: 0, name: "Büro" };
const schnell = { points: pts, level: 0, name: "2-Zimmer 0-1 ·W" };
const werkstatt = { points: pts, level: 0, name: "Flur 0 ·WT", raumart: "flur" };
const werkstattWe = { points: pts, level: 0, name: "Wohnen (WE 0-1) ·WT", we: "WE 0-1" };
const altManuell = { points: pts, level: 0, name: "Alt" }; // Spiegel eines früheren Stands

describe("zonenNachLoad — Re-Mount im selben Projekt (I-02)", () => {
  it("behält ·W- und ·WT-Zonen aus dem Store, ersetzt den manuellen Anteil durch den geladenen", () => {
    const r = zonenNachLoad({
      geladen: [geladenManuell],
      vorhanden: [altManuell, schnell, werkstatt, werkstattWe],
      gleichesProjekt: true,
      behalten,
    });
    assert.deepEqual(r.map((z) => z.name), ["Büro", "2-Zimmer 0-1 ·W", "Flur 0 ·WT", "Wohnen (WE 0-1) ·WT"]);
  });

  it("behält die Session-Zonen als DIESELBEN Objekte — we/raumart überleben", () => {
    const r = zonenNachLoad({ geladen: [], vorhanden: [werkstatt, werkstattWe], gleichesProjekt: true, behalten });
    assert.equal(r[0], werkstatt);
    assert.equal(r[0].raumart, "flur");
    assert.equal(r[1].we, "WE 0-1");
  });

  it("Werkstatt-Zonen ohne Fenster-/Flur-Zusatz: nur der strikte Marker zählt", () => {
    const r = zonenNachLoad({
      geladen: [],
      vorhanden: [{ points: pts, level: 0, name: "Trakt·WTest" }, { points: pts, level: 0, name: "Halle ·West" }],
      gleichesProjekt: true,
      behalten,
    });
    assert.equal(r.length, 0, "keine falschen Treffer über includes()");
  });
});

describe("zonenNachLoad — Projektwechsel und Randfälle", () => {
  it("Projektwechsel: nichts aus dem alten Store überlebt", () => {
    const r = zonenNachLoad({
      geladen: [geladenManuell],
      vorhanden: [schnell, werkstatt],
      gleichesProjekt: false,
      behalten,
    });
    assert.deepEqual(r, [geladenManuell]);
  });

  it("ohne Prädikat: nur die geladenen Zonen (Verhalten vor I-02)", () => {
    const r = zonenNachLoad({ geladen: [geladenManuell], vorhanden: [schnell], gleichesProjekt: true });
    assert.deepEqual(r, [geladenManuell]);
  });

  it("geladen/vorhanden undefined → leere Liste, kein Wurf", () => {
    assert.deepEqual(zonenNachLoad({ gleichesProjekt: true, behalten }), []);
    assert.deepEqual(zonenNachLoad({ geladen: undefined, vorhanden: undefined, gleichesProjekt: false }), []);
  });
});
