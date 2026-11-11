// Drawing model: element operations, per-storey counts, the footprint double-click
// guard, and the editor undo shortcut. The studio applies these through bimHistorie.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  leeresZeichenmodell, wandAnlegen, wandAusRichtung, punktAusLaengeWinkel, oeffnungAnlegen,
  deckeAnlegen, zoneAnlegen, elementAendern, elementLoeschen, geschossKopieren, zaehleGeschoss, abfragen,
  griffLoeschenErlaubt, fussabdruckNachDoppelklick, GRIFF_LOESCH_WARTE_MS, editorKuerzel, fokusImEditor,
  elementFuerApi, zahlKlemmen,
} from "@designer/lib/zeichnenModell.js";

const ECKEN = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 }];

describe("zeichnenModell", () => {
  it("Wand aus Länge und Winkel: 0° nach +x, 90° nach +z, Dicke und Höhe in Metern", () => {
    assert.deepEqual(punktAusLaengeWinkel({ x: 1, z: 2 }, 5, 0), { x: 6, z: 2 });
    assert.deepEqual(punktAusLaengeWinkel({ x: 0, z: 0 }, 4, 90), { x: 0, z: 4 });
    const r = wandAusRichtung(leeresZeichenmodell(), {
      start: { x: 0, z: 0 }, laenge_m: 6, winkel_grad: 0, level: 1, thickness_m: 0.24, height_m: 2.8,
    });
    assert.equal(r.ok, true);
    assert.equal(r.modell.customWalls[0].thickness, 0.24);
    assert.equal(r.modell.customWalls[0].height, 2.8);
    assert.equal(r.modell.customWalls[0].oberkante_bezug, "absolut");
    assert.equal(r.modell.customWalls[0].level, 1);
    assert.equal(r.element.id, 1);
    assert.equal(wandAnlegen(leeresZeichenmodell(), { a: { x: 0, z: 0 }, b: { x: 0.01, z: 0 } }).ok, false);
  });

  it("Öffnung sitzt auf der Wand, Änderung und Löschen gehen über dieselbe Nummer", () => {
    const w = wandAnlegen(leeresZeichenmodell(), { a: { x: 0, z: 0 }, b: { x: 8, z: 0 }, level: 0 });
    const o = oeffnungAnlegen(w.modell, { wandId: 1, kind: "window", versatz_m: 2, breite_m: 1.2, hoehe_m: 1.4, bruestung_m: 0.85 });
    assert.equal(o.ok, true);
    assert.equal(o.modell.customWindows[0].u, 2);
    assert.equal(o.modell.customWindows[0].sill, 0.85);
    const geaendert = elementAendern(o.modell, { art: "opening", id: o.element.id, patch: { width: 1.5 } });
    assert.equal(geaendert.modell.customWindows[0].width, 1.5);
    const weg = elementLoeschen(geaendert.modell, { art: "wall", id: 1 });
    assert.equal(weg.modell.customWalls.length, 0);
    assert.equal(weg.modell.customWindows.length, 0, "die Öffnung der Wand geht mit");
  });

  it("Decke und Raum als Rechteck, Zähler gelten nur für das Geschoss", () => {
    let m = leeresZeichenmodell();
    m = deckeAnlegen(m, { x: 0, z: 0, breite_m: 4, tiefe_m: 3, level: 0, dicke_m: 0.22 }).modell;
    m = zoneAnlegen(m, { x: 0, z: 0, breite_m: 4, tiefe_m: 3, level: 0, name: "Wohnen" }).modell;
    m = wandAnlegen(m, { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0 }).modell;
    m = wandAnlegen(m, { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 2 }).modell;
    const eg = zaehleGeschoss(m, 0);
    assert.equal(eg.bereich, "geschoss");
    assert.equal(eg.waende, 1);
    assert.equal(eg.decken, 1);
    assert.equal(eg.raeume, 1);
    assert.equal(zaehleGeschoss(m, 2).waende, 1);
    assert.equal(zaehleGeschoss(m, 1).waende, 0);
    assert.equal(abfragen(m, { art: "zone", level: 0 })[0].name, "Wohnen");
  });

  it("Geschoss kopieren übernimmt Wände und Öffnungen auf die neue Geschossnummer", () => {
    const w = wandAnlegen(leeresZeichenmodell(), { a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0 });
    const o = oeffnungAnlegen(w.modell, { wandId: w.element.id, kind: "door", versatz_m: 2 });
    const k = geschossKopieren(o.modell, { von: 0, nach: 1 });
    assert.equal(k.ok, true);
    assert.equal(k.element.anzahl, 2);
    assert.equal(k.modell.customWalls.filter((x) => x.level === 1).length, 1);
    const tuer = k.modell.customWindows.find((x) => x.wallIdx !== w.element.id);
    assert.ok(tuer);
    assert.notEqual(tuer.wallIdx, w.element.id);
    assert.equal(tuer.guid, undefined);
    assert.equal(zaehleGeschoss(k.modell, 1).tueren, 1);
    assert.equal(zaehleGeschoss(k.modell, 1).oeffnungen, 0, "eine Tür ist keine leere Öffnung");
    assert.equal(zaehleGeschoss(k.modell, 1).fenster, 0);
    assert.equal(zaehleGeschoss(k.modell, 0).waende, 1);
    const leer = oeffnungAnlegen(o.modell, { wandId: w.element.id, kind: "oeffnung", versatz_m: 3 });
    assert.equal(zaehleGeschoss(leer.modell, 0).oeffnungen, 1);
    assert.equal(zaehleGeschoss(leer.modell, 0).tueren, 1);
    assert.equal(zaehleGeschoss(leer.modell, 0).fenster, 0);
    const api = elementFuerApi(w);
    assert.equal(api.ok, true);
    assert.equal(api.element.art, "wall");
    assert.equal(api.element.id, w.element.id);
    assert.equal(api.element._idx, w.element.id);
    assert.equal("modell" in api, false);
    assert.equal(geschossKopieren(o.modell, { von: 0, nach: 0 }).ok, false);
  });

  it("Doppelklick direkt nach dem Wählen löscht keine Grundriss-Ecke", () => {
    assert.equal(griffLoeschenErlaubt(50, GRIFF_LOESCH_WARTE_MS), false);
    assert.equal(griffLoeschenErlaubt(GRIFF_LOESCH_WARTE_MS), true);
    const frisch = fussabdruckNachDoppelklick(ECKEN, 1, 30);
    assert.equal(frisch.length, 4, "dieselbe Eckenanzahl — der Grundriss bleibt");
    assert.deepEqual(frisch[1], ECKEN[1]);
    const spaeter = fussabdruckNachDoppelklick(ECKEN, 1, 800);
    assert.equal(spaeter.length, 3);
    assert.equal(fussabdruckNachDoppelklick(ECKEN.slice(0, 3), 0, 800).length, 3, "mindestens drei Ecken");
  });

  it("Strg+Z macht rückgängig, Strg+Y und Strg+Umschalt+Z wiederholen, Eingabefelder nicht", () => {
    const taste = (extra) => ({ key: "z", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, target: { tagName: "BUTTON", closest: () => null }, ...extra });
    assert.equal(editorKuerzel(taste({})), "undo");
    assert.equal(editorKuerzel(taste({ key: "y" })), "redo");
    assert.equal(editorKuerzel(taste({ key: "Z", shiftKey: true })), "redo");
    assert.equal(editorKuerzel(taste({ target: { tagName: "INPUT", closest: () => null } })), null);
    const root = { contains: (n) => n === "drin" };
    assert.equal(fokusImEditor(root, "drin"), true);
    assert.equal(fokusImEditor(root, "neben", { body: "seite" }), false);
    assert.equal(fokusImEditor(root, "seite", { body: "seite" }), true);
    const haupt = { contains: (n) => n === "plan" };
    assert.equal(fokusImEditor(root, "plan", { haupt }), true, "Klick in die Zeichenfläche fokussiert main");
    assert.equal(fokusImEditor(null, "plan", { haupt }), true);
    assert.equal(fokusImEditor(root, "sidebar", { haupt }), false);
  });

  it("Zahlfelder klemmen auf Minimum und Maximum und lassen Leeres stehen", () => {
    assert.deepEqual(zahlKlemmen("36", 0.1, 0.6), { leer: false, wert: 0.6 });
    assert.deepEqual(zahlKlemmen("0,24", 0.1, 0.6), { leer: false, wert: 0.24 });
    assert.deepEqual(zahlKlemmen("0.02", 0.1, 0.6), { leer: false, wert: 0.1 });
    assert.deepEqual(zahlKlemmen("", 0.1, 0.6), { leer: true });
    assert.equal(zahlKlemmen("abc", 0.1, 0.6), null);
  });
});
