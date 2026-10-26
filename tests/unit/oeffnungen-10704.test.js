// 107-04: the opening chain — sizes, host, height anchor, opening without a filling, penetrations in the IFC, slab holes.
// Hand calculations are written next to the numbers. The three older goldens (107, 107-steckbrief, 107-reflinie, 107-aufbau) must stay
// green (they run in ifcGolden-10701 / aufbauten-10703); this file adds the fourth, ifc-golden-107-oeffnung.ifc, and proves that the new
// fields change nothing when they are absent.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createBuildingModel } from "@core/lib/buildingModel";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { setzeProjektAufbauten, gibProjektAufbautenFrei } from "@core/lib/bauteil/aufbauten.js";
import { fehlplanungPruefen } from "@core/lib/bauteil/pruefregeln.js";
import { wandGeometrie } from "@core/lib/bauteil/referenz.js";
import { classifiedElements } from "@core/lib/bimClassification.js";
import {
  oeffnungsMasse, oeffnungsTyp, bruestungAbWandUk, bodenLage, ankerFuerWand, oeffnungMitte_m, oeffnungPasst, lochImWand, wandPunkt,
  rechteckAufWand, deckenLochRechteck, wirtVon, durchbruchImWirt, neueOeffnung, istOeffnungOhneFuellung, OEFFNUNG_RAND_M,
  durchbruchTiefe, schlitzImKoerper, lochInDecke, lochUeberlappt,
} from "@core/lib/bauteil/oeffnungen.js";
import { durchbruchSteckbriefe as aus_core } from "@core/lib/bauteil/durchbruchSteckbrief.js";
import { durchbruchSteckbriefe as aus_app } from "@/lib/werkplanung/durchbrueche.js";
import { exportIFC, WARNART_DURCHBRUCH } from "@designer/lib/ifcExport";
import { bimBauteil } from "@designer/lib/auswahlBim.js";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";
import { ifcOeffnungSzenario, PROJEKT } from "./fixtures/ifcOeffnungModell-10704.js";

const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const nah = (/** @type {number} */ ist, /** @type {number} */ soll, /** @type {string} */ was, tol = 1e-9) => assert.ok(Math.abs(ist - soll) <= tol, `${was}: ${ist} statt ${soll}`);
const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];

/** Rows of a STEP text by id. */
function zeilen(/** @type {string} */ ifc) {
  const m = new Map();
  for (const l of ifc.split("\n")) { const r = l.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/); if (r) m.set(`#${r[1]}`, { typ: r[2], args: r[3] }); }
  return m;
}
const anzahl = (/** @type {string} */ ifc, /** @type {string} */ k) => (ifc.match(new RegExp(`=${k}\\(`, "g")) || []).length;
/** Rectangle profile sizes [xdim, ydim] of the solid of an element row. */
function profil(/** @type {string} */ ifc, /** @type {string} */ klasse, /** @type {RegExp} */ nameRe) {
  const rows = zeilen(ifc);
  for (const r of rows.values()) {
    if (r.typ !== klasse || !nameRe.test(r.args)) continue;
    const pds = r.args.match(/,(#\d+),(?:\$|'[^']*'),/)?.[1] ?? r.args.split(",")[6];
    const sr = rows.get(pds).args.match(/\(\s*(#\d+)\s*\)/)[1];
    const solid = rows.get(rows.get(sr).args.match(/'SweptSolid',\((#\d+)\)/)[1]);
    const prof = rows.get(solid.args.split(",")[0]);
    const tiefe = Number(solid.args.split(",").at(-1));
    return { typ: prof.typ, werte: prof.args.split(",").slice(3).map(Number), tiefe };
  }
  return null;
}

describe("107-04 Maße einer Öffnung (oeffnungsMasse)", () => {
  it("Typmaß, wenn der Datensatz nichts sagt (Fenster double 1,8 × 1,4, Brüstung 0,9)", () => {
    const m = oeffnungsMasse({ kind: "window", typeId: "double" });
    assert.deepEqual([m.w, m.h, m.sill], [1.8, 1.4, 0.9]);
    nah(m.sturz, 2.3, "Sturz = Brüstung + Höhe (nur Anzeige)");
  });
  it("Datensatz-Override vor dem Typmaß, Feld für Feld", () => {
    const m = oeffnungsMasse({ kind: "window", typeId: "double", width: 1.5 });
    assert.deepEqual([m.w, m.h, m.sill], [1.5, 1.4, 0.9], "nur die Breite überschrieben");
    const n = oeffnungsMasse({ kind: "window", typeId: "double", width: 1.5, height: 1.2, sill: 0.8 });
    assert.deepEqual([n.w, n.h, n.sill], [1.5, 1.2, 0.8]);
    nah(n.sturz, 2.0, "Sturz");
  });
  it("unbrauchbare Werte (0, negativ, Text, leer) fallen auf das Typmaß zurück; Brüstung 0 ist gültig", () => {
    const m = oeffnungsMasse({ kind: "door", typeId: "single", width: 0, height: -1, sill: "" });
    assert.deepEqual([m.w, m.h, m.sill], [1.0, 2.1, 0]);
    assert.equal(oeffnungsMasse({ kind: "window", typeId: "single", sill: 0 }).sill, 0, "0 ist ein gültiger Override");
    assert.equal(oeffnungsMasse({ kind: "window", typeId: "single", width: "x" }).w, 1.0);
  });
  it("Öffnung ohne Füllung hat ein eigenes Standardmaß (1,00 × 2,10 m ab Wand-Unterkante)", () => {
    const m = oeffnungsMasse({ kind: "oeffnung" });
    assert.deepEqual([m.w, m.h, m.sill], [1.0, 2.1, 0]);
    assert.ok(istOeffnungOhneFuellung({ kind: "oeffnung" }) && !istOeffnungOhneFuellung({ kind: "door" }));
  });
  it("oeffnungsTyp legt die Maße über den Typ (Spalten/Reihen bleiben für die Verglasung)", () => {
    const t = oeffnungsTyp({ kind: "window", typeId: "double", width: 1.5 });
    assert.deepEqual([t.w, t.h, t.cols, t.rows], [1.5, 1.4, 2, 2]);
  });
});

describe("107-04 Höhenanker der Brüstung (wand_uk | okrd | okff)", () => {
  beforeEach(() => gibProjektAufbautenFrei(null));
  const hulle = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });

  it("ohne Anker ist die Brüstung wie gespeichert; wand_uk ändert nichts", () => {
    assert.equal(bruestungAbWandUk({ kind: "window", typeId: "single" }, null), 0.9);
    const anker = { wandUk_m: 3, okrd_m: 3.25, okff_m: 3.25 };
    assert.equal(bruestungAbWandUk({ kind: "window", typeId: "single", bruestung_bezug: "wand_uk" }, anker), 0.9);
    assert.equal(bruestungAbWandUk({ kind: "window", typeId: "single" }, anker), 0.9, "Standard = wand_uk");
  });
  it("okrd/okff rechnen auf Wand-Unterkante um (Handrechnung: Wand-UK 3,5 m, OKRD 3,0 → 0,9 − 0,5 = 0,4 m)", () => {
    const anker = { wandUk_m: 3.5, okrd_m: 3.0, okff_m: 3.05 };
    nah(bruestungAbWandUk({ kind: "window", typeId: "single", bruestung_bezug: "okrd" }, anker), 0.4, "okrd");
    nah(bruestungAbWandUk({ kind: "window", typeId: "single", bruestung_bezug: "okff" }, anker), 0.45, "okff");
    nah(oeffnungsMasse({ kind: "window", typeId: "single", sill: 1.2, height: 1.0, bruestung_bezug: "okrd" }, anker).sturz, 1.2 - 0.5 + 1.0, "Sturz folgt der Umrechnung");
  });
  it("Boden: ohne Decke ist OKRD = OKFF = Geschossebene; Hülldecke 0,25 m 'unten' hebt beide auf 3,25 m", () => {
    const leer = bodenLage(1, 3, {});
    assert.deepEqual([leer.okrd_m, leer.okff_m, leer.quelle], [3, 3, "geschossebene"]);
    const huelle = bodenLage(1, 3, { huelle: hulle.slabs });
    assert.deepEqual([huelle.okrd_m, huelle.okff_m, huelle.quelle], [3.25, 3.25, "huelle"]);
    assert.equal(bodenLage(0, 3, { huelle: hulle.slabs }).okrd_m, 0.25, "Bodenplatte (Ebene −1) trägt das Erdgeschoss");
  });
  it("gezeichnete Decke gewinnt, wenn sie den Punkt enthält; Standard 0,22 m 'oben' = Oberkante auf der Geschossebene", () => {
    const decke = { points: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }], level: 0, _idx: 1 };
    const innen = bodenLage(1, 3, { huelle: hulle.slabs, gezeichnet: [decke] }, { x: 0, z: 0 });
    assert.deepEqual([innen.okrd_m, innen.quelle], [3, "gezeichnet"]);
    const aussen = bodenLage(1, 3, { huelle: hulle.slabs, gezeichnet: [decke] }, { x: 4, z: 3 });
    assert.equal(aussen.quelle, "huelle", "Punkt außerhalb der gezeichneten Decke → Hülldecke");
  });
  it("Deckenaufbau: die Schichten über dem Kern liegen zwischen OKRD und OKFF (Estrich 50 mm: 3,25 − 0,05 = 3,20 m)", () => {
    const layer = { aufbauten: { "p-1": { name: "Decke mit Estrich", skins: [
      { name: "Estrich", material: "gipsputz", thickness: 50, funktion: "bekleidung" },
      { name: "Stahlbeton", material: "beton", thickness: 200, funktion: "kern" },
    ] } } };
    setzeProjektAufbauten(layer);
    try {
      const decke = { points: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }], level: 0, dicke_m: 0.25, bezug: "unten", composite: "p-1", _idx: 1 };
      const b = bodenLage(1, 3, { gezeichnet: [decke] }, { x: 0, z: 0 });
      nah(b.okff_m, 3.25, "OKFF = Oberkante der Decke");
      nah(b.okrd_m, 3.2, "OKRD = Oberkante des Kerns");
      const anker = ankerFuerWand({ level: 1, unterkante_m: 3 }, 3, { gezeichnet: [decke] }, { x: 0, z: 0 });
      nah(bruestungAbWandUk({ kind: "window", typeId: "single", bruestung_bezug: "okrd" }, anker), 0.9 + 0.2, "okrd über Wand-UK 3,0");
      nah(bruestungAbWandUk({ kind: "window", typeId: "single", bruestung_bezug: "okff" }, anker), 0.9 + 0.25, "okff über Wand-UK 3,0");
    } finally { gibProjektAufbautenFrei(layer); }
  });
});

describe("107-04 Lage, Klemmung und Passprobe", () => {
  it("Mitte bleibt mit 5 cm Rand in der Wand (wie der IFC-Export schon immer)", () => {
    nah(oeffnungMitte_m(0.2, 1, 5), 0.55, "links");
    nah(oeffnungMitte_m(4.9, 1, 5), 4.45, "rechts");
    nah(oeffnungMitte_m(undefined, 1, 5), 2.5, "ohne u: Wandmitte");
    assert.equal(OEFFNUNG_RAND_M, 0.05);
  });
  it("Passprobe: gleicher Text wie der IFC-Hinweis; zu breit, zu hoch, unter der Wand-Unterkante", () => {
    const gut = oeffnungPasst({ w: 1, h: 1.4, sill: 0.9 }, 5, 3);
    assert.deepEqual([gut.ok, gut.text], [true, null]);
    assert.deepEqual(gut.daten, { w: 1, h: 1.4, sill: 0.9, laenge: 5, hoehe: 3 }, "die Zahlen für den übersetzten Satz der Oberfläche");
    const r = oeffnungPasst({ w: 1, h: 2.1, sill: 0 }, 1.05, 3);
    assert.equal(r.ok, false);
    assert.equal(r.text, "1.00×2.10 m (Brüstung 0.00 m) passt nicht in die Wand (1.05×3.00 m)");
    assert.equal(oeffnungPasst({ w: 1, h: 2.1, sill: 1.0 }, 5, 3).ok, false, "Sturz über der Wand");
    assert.equal(oeffnungPasst({ w: 1, h: 1, sill: -0.2 }, 5, 3).ok, false, "Brüstung unter der Wand-Unterkante");
  });
  it("Loch im 3D folgt derselben Regel (Rand 5 cm, unten/oben 2 cm); eine Tür beginnt bei 2 cm", () => {
    const l = lochImWand({ w: 1, h: 1.4, sill: 0.9 }, 2, 5, 3);
    nah(l.x0, 1.5, "x0"); nah(l.x1, 2.5, "x1"); nah(l.y0, 0.9, "y0"); nah(l.y1, 2.3, "y1");
    nah(lochImWand({ w: 1, h: 2.1, sill: 0 }, 2, 5, 3).y0, 0.02, "Tür: 2 cm Rand unten");
    const rand = lochImWand({ w: 1, h: 1, sill: 1 }, 0.1, 5, 3);
    nah(rand.x0, 0.05, "Loch am Wandende rückt in die Wand wie im IFC");
    nah(rand.x1 - rand.x0, 1, "Breite bleibt");
    assert.equal(lochImWand({ w: 1, h: 1, sill: 5 }, 2, 5, 3), null, "nichts bleibt übrig");
  });
});

describe("107-04 Klick auf die Wandfläche: Wandkoordinaten und Rechteck", () => {
  it("wandPunkt projiziert einen Raumpunkt auf Wandlänge und Höhe ab Unterkante", () => {
    const p = wandPunkt({ x: 0, z: 0 }, { x: 4, z: 0 }, 3, [1.5, 4.2, 0.1]);
    nah(p.u, 1.5, "u"); nah(p.v, 1.2, "v");
    const q = wandPunkt({ x: 0, z: 0 }, { x: 3, z: 4 }, 0, [3, 1, 4]);
    nah(q.u, 5, "schräge Wand: Länge 5"); nah(q.v, 1, "v");
  });
  it("zwei Klickpunkte → Position, Breite, Höhe und Brüstung der Öffnung", () => {
    const r = rechteckAufWand({ u: 1, v: 0.5 }, { u: 2.2, v: 1.7 }, 5, 3);
    assert.deepEqual(r, { u: 1.6, width: 1.2, height: 1.2, sill: 0.5 });
    assert.deepEqual(rechteckAufWand({ u: 2.2, v: 1.7 }, { u: 1, v: 0.5 }, 5, 3), r, "Reihenfolge der Ecken egal");
  });
  it("das Rechteck bleibt in der Wand (Rand 5 cm, Wand-Unterkante und -Oberkante); zu klein → null", () => {
    const r = rechteckAufWand({ u: -1, v: -1 }, { u: 1, v: 5 }, 5, 3);
    assert.deepEqual(r, { u: 0.525, width: 0.95, height: 3, sill: 0 });
    assert.equal(rechteckAufWand({ u: 1, v: 1 }, { u: 1.05, v: 2 }, 5, 3), null, "Breite 5 cm");
    assert.equal(rechteckAufWand({ u: 1, v: 1 }, { u: 2, v: 1.05 }, 5, 3), null, "Höhe 5 cm");
  });
  it("Deckenloch: Rechteck aus zwei Grundrisspunkten; zu klein → null", () => {
    assert.deepEqual(deckenLochRechteck({ x: 2, z: 2.5 }, { x: 3.2, z: 1 }), [{ x: 2, z: 1 }, { x: 3.2, z: 1 }, { x: 3.2, z: 2.5 }, { x: 2, z: 2.5 }]);
    assert.equal(deckenLochRechteck({ x: 0, z: 0 }, { x: 0.05, z: 3 }), null);
  });
});

describe("107-04 Wirt (wirtVon): drei Öffnungsfamilien und Durchbrüche", () => {
  const hull = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });
  const waende = [
    { _idx: 1, a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24 },
    { _idx: 2, a: { x: -4, z: 2 }, b: { x: 2, z: 2 }, level: 1, height: 3, thickness: 0.24, unterkante_versatz_m: 0.5 },
  ];
  const werkstatt = { waende: [
    { a: { x: -3, z: 0 }, b: { x: 3, z: 0 }, dicke_m: 0.115, hoehe_m: 3, level: 0, huelle: false, guid: "0wandWirtWerkstatt0001" },
    { a: { x: -3, z: 9 }, b: { x: 3, z: 9 }, dicke_m: 0.3, hoehe_m: 3, level: 0, huelle: true, guid: "0wandWirtHuelle000001" },
  ] };
  const modell = { customWalls: waende, huelle: hull.walls, werkstatt, projektId: "p", geschosse: 3 };
  const g1 = bauteilGuid("p", "customWalls", { _idx: 1 });
  const g2 = bauteilGuid("p", "customWalls", { _idx: 2 });

  it("gezeichnete Wand über wallIdx: Schlüssel, GUID wie der Export, Maße der Wand", () => {
    const w = wirtVon({ wallIdx: 1, u: 2, kind: "window" }, modell);
    assert.equal(w.familie, "gezeichnet"); assert.equal(w.schluessel, "cw:1"); assert.equal(w.guid, g1);
    nah(w.wand.laenge_m, 6, "Länge"); nah(w.wand.dicke_m, 0.24, "Dicke"); nah(w.wand.hoehe_m, 3, "Höhe"); assert.equal(w.u, 2);
    const o = wirtVon({ wallIdx: 2 }, modell);
    nah(o.wand.unterkante_m, 3.5, "Geschoss 1 (3,0) + Versatz Unterkante 0,5");
  });
  it("Hüllwand über level + edge", () => {
    const w = wirtVon({ level: 0, edge: 1, u: 4, kind: "door" }, modell);
    assert.equal(w.familie, "huelle"); assert.equal(w.schluessel, "env:0:1");
    assert.equal(w.guid, bauteilGuid("p", "huelle", { id: "0:1" }));
    nah(w.wand.laenge_m, 8, "Kante 1 ist 8 m lang"); assert.equal(w.u, 4);
  });
  it("Werkstatt-Tür über die Geometrie (Achse durch die Türmitte, 1 cm), u = Projektion der Mitte; Hüllstücke sind keine Werkstattwand", () => {
    const w = wirtVon({ kind: "door", a: { x: 0, z: 0 }, b: { x: 0.9, z: 0 }, level: 0 }, modell);
    assert.equal(w.familie, "werkstatt"); assert.equal(w.schluessel, "wt:0wandWirtWerkstatt0001"); nah(w.u, 3.45, "Mitte 0,45 − (−3) = 3,45");
    assert.equal(wirtVon({ kind: "door", a: { x: 0, z: 0.02 }, b: { x: 0.9, z: 0.02 }, level: 0 }, modell), null, "2 cm neben der Achse");
    assert.equal(wirtVon({ kind: "door", a: { x: 0, z: 9 }, b: { x: 0.9, z: 9 }, level: 0 }, modell), null, "Hüllstück der Werkstatt");
    assert.equal(wirtVon({ kind: "door", a: { x: 0, z: 0 }, b: { x: 0.9, z: 0 }, level: 1 }, modell), null, "anderes Geschoss");
  });
  it("Durchbruch über bauteil_guid; u aus x/y auf die Wandachse projiziert", () => {
    const w = wirtVon({ x: -2, y: -1.05, z: 1.5, bauteil_guid: g1 }, modell);
    assert.equal(w.schluessel, "cw:1"); nah(w.u, 2, "u = −2 − (−4)");
    assert.equal(wirtVon({ x: 0, y: 0, bauteil_guid: "x".repeat(22) }, modell), null, "unbekannte GUID: kein Raten");
  });
  it("wirt_guid ist der Rückfall, die lebende Bindung gewinnt (nach dem Teilen einer Wand zeigt wirt_guid ins Leere)", () => {
    assert.equal(wirtVon({ wallIdx: 99, u: 1, wirt_guid: g1 }, modell).schluessel, "cw:1", "Bindung tot → GUID");
    assert.equal(wirtVon({ wallIdx: 2, u: 1, wirt_guid: g1 }, modell).schluessel, "cw:2", "Bindung gültig → sie gewinnt");
    assert.equal(wirtVon({ wallIdx: 2, u: 1, wirt_guid: "y".repeat(22) }, modell).schluessel, "cw:2", "veraltete GUID stört nicht");
    assert.equal(wirtVon({ wallIdx: 99, u: 1 }, modell), null);
    assert.notEqual(g1, g2);
  });
  it("Durchbruch liegt im Wirt: Wandachse, Dicke, Länge, Höhe (Toleranz 15 cm)", () => {
    const w = wirtVon({ wallIdx: 1 }, modell);
    const d = (/** @type {any} */ x) => ({ form: "rechteck", b: 0.2, h: 0.2, x: -2, y: -1, z: 1.5, ...x });
    assert.equal(durchbruchImWirt(d({}), w).innen, true);
    const quer = durchbruchImWirt(d({ y: -0.5 }), w);
    assert.equal(quer.innen, false); assert.match(quer.grund, /neben der Wand \(/);
    const laenge = durchbruchImWirt(d({ x: 4 }), w);
    assert.equal(laenge.innen, false); assert.match(laenge.grund, /entlang der Wand/);
    const hoch = durchbruchImWirt(d({ z: 3.5 }), w);
    assert.equal(hoch.innen, false); assert.match(hoch.grund, /Höhe/);
    assert.equal(durchbruchImWirt(d({ z: 3.5 }), w, { hoehe: false }).innen, true, "ohne Geschossquelle keine Höhenprobe");
    assert.equal(durchbruchImWirt(d({ z: undefined }), w).innen, false, "Lage unvollständig");
  });
});

describe("107-04 neue Öffnung: EIN Setter für Plan- und 3D-Klick (neueOeffnung)", () => {
  const modell = { customWalls: [{ _idx: 1, a: { x: 0, z: 0 }, b: { x: 5, z: 0 }, level: 0, height: 3, thickness: 0.24 }], huelle: createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 }).walls, projektId: "p", geschosse: 3 };
  it("gezeichnete Wand: Datensatz mit wallIdx, wirt_guid, Typ; u mit halber Breite + 10 cm Abstand geklemmt", () => {
    const wirt = wirtVon({ wallIdx: 1 }, modell);
    const { scope, satz } = neueOeffnung({ wirt, u: 0.2, kind: "window", typeId: "double", idx: 7 });
    assert.equal(scope, "custom");
    assert.deepEqual(satz, { wallIdx: 1, u: 1.0, typeId: "double", kind: "window", _idx: 7, wirt_guid: bauteilGuid("p", "customWalls", { _idx: 1 }) });
  });
  it("Hüllwand: Datensatz mit level + edge (scope env)", () => {
    const wirt = wirtVon({ level: 0, edge: 2 }, modell);
    const { scope, satz } = neueOeffnung({ wirt, u: 5, kind: "door", typeId: "single", idx: 8 });
    assert.equal(scope, "env");
    assert.deepEqual([satz.level, satz.edge, satz.u, satz.kind, satz.typeId], [0, 2, 5, "door", "single"]);
  });
  it("Rechteck aus dem 3D-Klick: eigene Maße und Anker landen im Datensatz, wand_uk wird nicht geschrieben", () => {
    const wirt = wirtVon({ wallIdx: 1 }, modell);
    const a = neueOeffnung({ wirt, u: 2.5, kind: "oeffnung", typeId: "oeffnung", masse: { width: 1.2, height: 1.2, sill: 0.5 }, idx: 9 });
    assert.deepEqual(a.satz, { wallIdx: 1, u: 2.5, typeId: "oeffnung", kind: "oeffnung", _idx: 9, wirt_guid: wirt.guid, width: 1.2, height: 1.2, sill: 0.5 });
    const b = neueOeffnung({ wirt, u: 2.5, kind: "oeffnung", typeId: "oeffnung", masse: { width: 1.2, height: 1.2, sill: 0.5 }, bezug: "okff", idx: 10 });
    assert.equal(b.satz.bruestung_bezug, "okff");
    const c = neueOeffnung({ wirt, u: 0.1, kind: "oeffnung", masse: { width: 0.8 }, idx: 11 });
    nah(c.satz.u, 0.45, "Rechteck: nur der Randabstand des Lochs (0,4 + 0,05), keine stille Verschiebung um 5 cm");
    const typ = neueOeffnung({ wirt, u: 0.1, kind: "oeffnung", idx: 12 });
    nah(typ.satz.u, 0.6, "Typklick: halbe Breite (0,5) + 10 cm wie der Plan-Klick immer");
    // an Rechteck from two clicks near the wall end sits where it was drawn: u 0.06 … 1.06 → middle 0.56, width 1.0
    const r = rechteckAufWand({ u: 0.06, v: 0.5 }, { u: 1.06, v: 1.5 }, 6, 3);
    const nahAmEnde = neueOeffnung({ wirt, u: r.u, kind: "oeffnung", typeId: "oeffnung", masse: { width: r.width, height: r.height, sill: r.sill }, idx: 13 });
    nah(nahAmEnde.satz.u, 0.56, "Mitte = Mitte der Klickpunkte");
    nah(nahAmEnde.satz.u - nahAmEnde.satz.width / 2, 0.06, "linke Kante = erster Klickpunkt");
  });
});

describe("107-04 IFC: Maße, Öffnung ohne Füllung, Anker", () => {
  /** model with one drawn wall (6 m × 3 m, 24 cm) and the given openings */
  const wand = (/** @type {any[]} */ fenster, extra = {}) => {
    const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    return { model, opts: { storeyHeight: 3, customWalls: [{ a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24, _idx: 1 }], customWindows: fenster, ...extra } };
  };
  it("eigene Breite/Höhe/Brüstung stehen im Void und im Füllkörper (derselbe Leser wie 3D)", () => {
    const o = { wallIdx: 1, u: 3, typeId: "double", kind: "window", width: 1.5, height: 1.2, sill: 0.8, _idx: 2 };
    const { model, opts } = wand([o]);
    const ifc = exportIFC(model, opts);
    const v = profil(ifc, "IFCOPENINGELEMENT", /Fenster/);
    assert.equal(v.typ, "IFCRECTANGLEPROFILEDEF");
    nah(v.werte[0], 1.5, "Breite im Void"); nah(v.werte[1], 0.24 + 0.04, "Tiefe = Wanddicke + 4 cm"); nah(v.tiefe, 1.2, "Höhe");
    const m = oeffnungsMasse(o);
    nah(v.werte[0], m.w, "IFC = oeffnungsMasse"); nah(v.tiefe, m.h, "IFC = oeffnungsMasse (Höhe)");
    const f = profil(ifc, "IFCWINDOW", /Fenster/);
    nah(f.werte[0], 1.5, "Füllkörper hat die Breite des Voids");
  });
  it("kind 'oeffnung': IfcOpeningElement + IfcRelVoidsElement, ohne Füllung (kein Fenster, keine Tür, keine IfcRelFillsElement)", () => {
    const { model, opts } = wand([{ wallIdx: 1, u: 3, typeId: "oeffnung", kind: "oeffnung", width: 1, height: 2, sill: 0, _idx: 2 }]);
    for (const mitSteckbrief of [false, true]) {
      const ifc = exportIFC(model, { ...opts, ...(mitSteckbrief ? { steckbrief: { projektId: "p" } } : {}) });
      assert.equal(anzahl(ifc, "IFCOPENINGELEMENT"), 1, `Öffnung (Steckbrief ${mitSteckbrief})`);
      assert.equal(anzahl(ifc, "IFCRELVOIDSELEMENT"), 1);
      assert.equal(anzahl(ifc, "IFCRELFILLSELEMENT"), 0, "keine Füllung");
      assert.equal(anzahl(ifc, "IFCWINDOW") + anzahl(ifc, "IFCDOOR"), 0);
      assert.match(ifc, /IFCOPENINGELEMENT\('[^']*',\$,'\\X2\\00D6\\X0\\ffnung'/, "Name Öffnung");
      if (mitSteckbrief) assert.match(ifc, /'Bauteiltyp',\$,IFCLABEL\('Durchbruch \(hergestellt\)'\)/, "Datenblatt-Typ oeffnung");
    }
  });
  it("Brüstung ab OKFF: Void-Höhenlage = Brüstung + (Deckenoberkante − Wand-Unterkante)", () => {
    const model = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });
    const opts = { storeyHeight: 3, customWalls: [{ a: { x: -4, z: 2 }, b: { x: 2, z: 2 }, level: 1, height: 3, thickness: 0.24, _idx: 1 }],
      customWindows: [{ wallIdx: 1, u: 3, typeId: "single", kind: "window", sill: 0.9, bruestung_bezug: "okff", _idx: 2 }] };
    // hull slab of level 0: lower edge on the plane of storey 1 (3.0 m), 0.25 m thick → OKFF 3.25 → 0.9 + 0.25 above the wall bottom
    const ifc = exportIFC(model, opts);
    const rows = zeilen(ifc);
    const op = [...rows.values()].find((r) => r.typ === "IFCOPENINGELEMENT");
    const pl = rows.get(op.args.split(",")[5]);
    const a2p = rows.get(pl.args.split(",")[1]);
    const punkt = rows.get(a2p.args.split(",")[0]).args.match(/\(([-\d.]+),([-\d.]+),([-\d.]+)\)/);
    nah(Number(punkt[3]), 1.15, "Void beginnt 1,15 m über der Wand-Unterkante", 1e-4);
    const ohne = exportIFC(model, { ...opts, customWindows: [{ ...opts.customWindows[0], bruestung_bezug: undefined }] });
    assert.ok(ohne !== ifc, "ohne Anker liegt der Void anders");
  });
  it("zu knappe Öffnung: der Export lässt sie aus und meldet den Text der Passprobe", () => {
    const o = { wallIdx: 1, u: 3, typeId: "double", kind: "window", width: 6, height: 1.2, sill: 0.8, _idx: 2 };
    const { model, opts } = wand([o]);
    const meld = [];
    const ifc = exportIFC(model, { ...opts, onWarn: (m) => meld.push(m) });
    assert.equal(anzahl(ifc, "IFCOPENINGELEMENT"), 0);
    const erwartet = oeffnungPasst(oeffnungsMasse(o), 6, 3).text;
    assert.equal(meld.length, 1);
    assert.ok(meld[0].includes(erwartet) && meld[0].endsWith("nicht exportiert."), meld[0]);
  });
  it("gerettet: Öffnung an einer toten Wand-Bindung findet ihre Wand über wirt_guid", () => {
    const wirtGuid = bauteilGuid("p", "customWalls", { _idx: 1 });
    const { model, opts } = wand([{ wallIdx: 99, u: 3, typeId: "single", kind: "window", wirt_guid: wirtGuid, _idx: 2 }]);
    const meld = [];
    const ifc = exportIFC(model, { ...opts, steckbrief: { projektId: "p" }, onWarn: (m) => meld.push(m) });
    assert.equal(anzahl(ifc, "IFCOPENINGELEMENT"), 1);
    assert.deepEqual(meld, []);
  });
});

describe("107-04 Auswahl: eine Öffnung ohne Füllung ist ein IfcOpeningElement mit der GUID des Exports", () => {
  it("bimBauteil liefert Klasse und GUID wie die IFC-Datei", () => {
    const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    const customWalls = [{ a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24, _idx: 1 }];
    const customWindows = [{ wallIdx: 1, u: 3, typeId: "oeffnung", kind: "oeffnung", width: 1, height: 2, sill: 0, _idx: 2 }];
    const ifc = exportIFC(model, { storeyHeight: 3, customWalls, customWindows, steckbrief: { projektId: "p" } });
    const guid = [...zeilen(ifc).values()].find((r) => r.typ === "IFCOPENINGELEMENT").args.match(/^'([^']*)'/)[1];
    const b = bimBauteil({ type: "opening", index: 2, scope: "custom" }, { customWalls, customWindows, envOpenings: [], model, storeyHeight: 3 }, { projektId: "p" });
    assert.equal(b?.klasse, "IfcOpeningElement");
    assert.equal(b?.guid, guid);
  });
});

describe("107-04 Altexport byte-gleich", () => {
  const { model, ohne, mit } = ifcGoldenSzenario();
  it("neue Felder fehlen oder sind Standard → der Text bleibt Zeichen für Zeichen derselbe", () => {
    const alt = exportIFC(model, ohne);
    assert.equal(exportIFC(model, { ...ohne, durchbrueche: [] }), alt, "leere Durchbruchliste");
    assert.equal(exportIFC(model, { ...ohne, durchbrueche: null }), alt, "keine Durchbruchliste");
    const mitFeldern = (/** @type {any[]} */ l) => l.map((o) => ({ ...o, wirt_guid: "z".repeat(22), bruestung_bezug: "wand_uk" }));
    assert.equal(exportIFC(model, { ...ohne, customWindows: mitFeldern(ohne.customWindows), envOpenings: mitFeldern(ohne.envOpenings) }), alt, "wirt_guid + wand_uk");
    const altMit = exportIFC(model, mit);
    assert.equal(exportIFC(model, { ...mit, customSlabs: mit.customSlabs.map((s) => ({ ...s, oeffnungen: [] })) }), altMit, "leere Deckenöffnungen");
  });
  it("entspricht den Golden von 107-01 (ohne und mit Steckbrief)", () => {
    assert.equal(exportIFC(model, { ...ohne, durchbrueche: [] }), lies("ifc-golden-107.ifc"));
    assert.equal(exportIFC(model, { ...mit, durchbrueche: [] }), lies("ifc-golden-107-steckbrief.ifc"));
  });
});

describe("107-04 Durchbrüche im IFC und Deckenöffnungen", () => {
  const { model, opts } = ifcOeffnungSzenario();
  /** @type {any[]} */
  const meld = [];
  const ifc = exportIFC(model, { ...opts, onWarn: (m, a, d) => meld.push({ m, a, d }) });
  const rows = zeilen(ifc);

  it("beantragt → IfcBuildingElementProxy PROVISIONFORVOID mit Kasten b × Tiefe × h (Wanddicke + 4 cm)", () => {
    const proxies = [...rows.values()].filter((r) => r.typ === "IFCBUILDINGELEMENTPROXY" && /PROVISIONFORVOID/.test(r.args));
    assert.equal(proxies.length, 2, "D-001 (mit Wirt) und D-005 (ohne Wirt)");
    const p = profil(ifc, "IFCBUILDINGELEMENTPROXY", /Durchbruch D-001/);
    assert.equal(p.typ, "IFCRECTANGLEPROFILEDEF");
    nah(p.werte[0], 0.2, "b"); nah(p.werte[1], 0.24 + 0.04, "Tiefe = Wanddicke + 4 cm"); nah(p.tiefe, 0.2, "h");
    const p5 = profil(ifc, "IFCBUILDINGELEMENTPROXY", /Durchbruch D-005/);
    nah(p5.werte[1], 0.3, "ohne Wirt: Standardtiefe 0,30 m");
  });
  it("ausgeführt → IfcOpeningElement am Wirt mit IfcRelVoidsElement, ohne Füllung; Brüstung = z − h/2 − Wand-Unterkante", () => {
    const d2 = [...rows.values()].find((r) => r.typ === "IFCOPENINGELEMENT" && /Durchbruch D-002/.test(r.args));
    assert.ok(d2, "Durchbruch D-002 ist eine Öffnung");
    const rel = [...rows.values()].find((r) => r.typ === "IFCRELVOIDSELEMENT" && r.args.endsWith(`,${[...rows.entries()].find(([, v]) => v === d2)[0]}`));
    assert.ok(rel, "IfcRelVoidsElement zeigt auf die Öffnung");
    const wand = rows.get(rel.args.split(",").at(-2));
    assert.equal(wand.typ, "IFCWALL", "Wirt ist eine Wand");
    assert.match(ifc, /'Bruestung',\$,IFCREAL\(1\.3000\)/, "z 1,5 − 0,2 = 1,3 m");
    assert.equal(anzahl(ifc, "IFCRELFILLSELEMENT"), 2, "nur die zwei Fenster haben eine Füllung (die Öffnungen und Durchbrüche haben keine)");
  });
  it("runde Kernbohrung in der Hüllwand → Zylinder quer durch die Wand (IfcCircleProfileDef, Radius 7,5 cm)", () => {
    const p = profil(ifc, "IFCOPENINGELEMENT", /Durchbruch D-003/);
    assert.equal(p.typ, "IFCCIRCLEPROFILEDEF");
    nah(p.werte[0], 0.075, "Radius"); nah(p.tiefe, 0.3 + 0.04, "Tiefe = Hüllwanddicke + 4 cm");
    assert.match(ifc, /'Durchmesser',\$,IFCREAL\(0\.1500\)/);
  });
  it("abgelehnt wird nicht geschrieben; ein Durchbruch ohne Wirt wird gemeldet (WARNART_DURCHBRUCH)", () => {
    assert.ok(!/Durchbruch D-004/.test(ifc));
    assert.deepEqual(meld.map((x) => [x.a, x.d?.nr]), [[WARNART_DURCHBRUCH, "D-005"]]);
    assert.match(meld[0].m, /D-005.*kein Wirt/);
  });
  it("ein ausgeführter Durchbruch außerhalb seines Wirts bleibt Proxy und wird gemeldet", () => {
    const m2 = [];
    const d = { ...opts.durchbrueche[1], x: 9, nr: "D-009" };
    const ifc2 = exportIFC(model, { ...opts, durchbrueche: [d], onWarn: (m, a) => m2.push([m, a]) });
    assert.equal(anzahl(ifc2, "IFCBUILDINGELEMENTPROXY"), 1);
    assert.match(ifc2, /IFCBUILDINGELEMENTPROXY\([^;]*\.PROVISIONFORVOID\.\);/, "auch ein ausgeführter Durchbruch ohne Wirt bleibt eine Vormerkung (PROVISIONFORVOID, nie OPENING am Proxy)");
    assert.ok(![...zeilen(ifc2).values()].some((r) => r.typ === "IFCOPENINGELEMENT" && /Durchbruch D-009/.test(r.args)), "und ist keine Öffnung");
    assert.ok(m2.some(([m, a]) => a === WARNART_DURCHBRUCH && /liegt nicht im Wirt/.test(m)), JSON.stringify(m2));
  });
  it("Deckenöffnung: IfcOpeningElement + IfcRelVoidsElement an der IfcSlab, ohne Füllung", () => {
    const op = [...rows.entries()].find(([, r]) => r.typ === "IFCOPENINGELEMENT" && /Decken\\X2\\00F6\\X0\\ffnung/.test(r.args));
    assert.ok(op, "Deckenöffnung vorhanden");
    const rel = [...rows.values()].find((r) => r.typ === "IFCRELVOIDSELEMENT" && r.args.endsWith(`,${op[0]}`));
    assert.equal(rows.get(rel.args.split(",").at(-2)).typ, "IFCSLAB");
    const p = profil(ifc, "IFCOPENINGELEMENT", /Decken/);
    assert.equal(p.typ, "IFCARBITRARYCLOSEDPROFILEDEF");
    nah(p.tiefe, 0.25 + 0.04, "Dicke der Decke + 4 cm");
  });
  it("Steckbrief eines Durchbruchs: Typ und GUID stabil; der App-Pfad re-exportiert dieselbe Funktion", () => {
    assert.equal(aus_app, aus_core, "src/lib/werkplanung/durchbrueche.js re-exportiert die @core-Funktion");
    const a = aus_core({ id: "d2", nr: "D-002", status: "ausgefuehrt" }, { projektId: PROJEKT }).durchbruch;
    const b = aus_core({ id: "d2", nr: "D-002", status: "beantragt" }, { projektId: PROJEKT }).durchbruch;
    assert.equal(a.typ, "oeffnung"); assert.equal(b.typ, "durchbruch"); assert.equal(a.guid, b.guid, "GUID bleibt, wenn der Durchbruch ausgeführt wird");
  });
  it("vierter Golden: ifc-golden-107-oeffnung.ifc", () => {
    const soll = lies("ifc-golden-107-oeffnung.ifc");
    if (ifc !== soll) {
      const a = ifc.split("\n"), b = soll.split("\n");
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      assert.fail(`erste Abweichung in Zeile ${i + 1}\n  ist:  ${a[i]}\n  soll: ${b[i]}`);
    }
  });
});

describe("107-04 Prüfregel 12: Durchbruch liegt im Wirt", () => {
  const wand = { _idx: 1, a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24 };
  const guid = bauteilGuid("p", "customWalls", wand);
  const d = (/** @type {any} */ x) => ({ nr: "D-1", status: "beantragt", form: "rechteck", b: 0.2, h: 0.2, x: -2, y: -1, z: 1.5, bauteil_guid: guid, ...x });
  const lauf = (/** @type {any[]} */ liste, extra = {}) => fehlplanungPruefen({ modell: { customWalls: [wand] }, durchbrueche: liste, projektId: "p", ...extra }).filter((b) => b.regel === 12);
  it("innen: kein Befund; außerhalb: Hinweis mit Grund (hinweis, nie fail)", () => {
    assert.deepEqual(lauf([d({})]), []);
    const b = lauf([d({ y: 0.5 })]);
    assert.equal(b.length, 1);
    assert.equal(b[0].code, "durchbruch_ausserhalb_wirt"); assert.equal(b[0].stufe, "hinweis"); assert.match(b[0].text, /D-1: Durchbruch liegt nicht im zugeordneten Bauteil \(.*neben der Wand \(/);
  });
  it("GUID eines Bauteils aus einer anderen Modelldatei, abgelehnte und ohne GUID: kein Befund; Höhe nur mit Geschossquelle", () => {
    assert.deepEqual(lauf([d({ bauteil_guid: "q".repeat(22), y: 5 })]), []);
    assert.deepEqual(lauf([d({ status: "abgelehnt", y: 5 })]), []);
    assert.deepEqual(lauf([d({ bauteil_guid: "", y: 5 })]), []);
    assert.deepEqual(lauf([d({ z: undefined })]), [], "unvollständige Lage ist Sache der Durchbruchplanung (lage_fehlt)");
    assert.deepEqual(lauf([d({ z: 3.5 })]), [], "ohne geschosse keine Höhenprobe");
    assert.equal(lauf([d({ z: 3.5 })], { geschosse: 3 }).length, 1, "mit geschosse: Höhe 3,5 m liegt über der Wand");
  });
  it("findet auch eine Hüllwand als Wirt (huelle = model.walls)", () => {
    const hull = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    const hg = bauteilGuid("p", "huelle", { id: "0:0" });
    const innen = fehlplanungPruefen({ modell: {}, durchbrueche: [d({ bauteil_guid: hg, x: 0, y: -4, z: 1 })], projektId: "p", huelle: hull.walls, geschosse: 3 }).filter((b) => b.regel === 12);
    assert.deepEqual(innen, []);
    const aussen = fehlplanungPruefen({ modell: {}, durchbrueche: [d({ bauteil_guid: hg, x: 0, y: -2, z: 1 })], projektId: "p", huelle: hull.walls, geschosse: 3 }).filter((b) => b.regel === 12);
    assert.equal(aussen.length, 1);
  });
});

describe("107-04 Wächter: kein Leser holt Öffnungsmaße noch aus der Typtabelle", () => {
  it("3D-Studio, Plan, Raummodul und IFC-Export lesen Breite, Höhe und Brüstung nur über oeffnungen.js", () => {
    const dateien = ["packages/nova-designer/src/lib/ifcExport.js", "packages/nova-designer/src/lib/raumOeffnungen.js", "packages/nova-designer/src/components/BimPlan2D.jsx", "packages/nova-designer/src/components/BitBimStudio.jsx"];
    for (const f of dateien) {
      const text = readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");
      const treffer = text.split(/\r?\n/).filter((l) => /openingTypeById\([^)]*\)\??\.(w|h|sill)\b/.test(l) && !/^\s*\/\//.test(l));
      assert.deepEqual(treffer, [], `${f} liest ein Maß noch aus der Typtabelle`);
    }
    // 107-04 review: also a variable that holds the TYPE (`const typ = openingTypeById(...)`) and is read as `typ?.w` is such a reader (the quantity list
    // did exactly this); bimClassification.js reads the sizes through oeffnungsGroesse (buildingModel.js, no import cycle).
    for (const f of [...dateien, "packages/nova-core/src/lib/bimClassification.js"]) {
      const text = readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l));
      const variablen = text.map((l) => l.match(/\b(\w+)\s*=\s*openingTypeById\(/)?.[1]).filter(Boolean);
      // typ0 of the inspector is the PLACEHOLDER of the size fields ("empty = size of the type"), it is meant to show the type size
      for (const v of new Set(variablen.filter((n) => n !== "typ0"))) {
        const treffer = text.filter((l) => new RegExp(`\\b${v}\\??\\.(w|h|sill)\\b`).test(l));
        assert.deepEqual(treffer, [], `${f}: ${v} kommt aus der Typtabelle und wird als Maß gelesen`);
      }
    }
    const ifcText = readFileSync(fileURLToPath(new URL("../../packages/nova-designer/src/lib/ifcExport.js", import.meta.url)), "utf8");
    assert.ok(!/openingTypeById/.test(ifcText), "ifcExport.js braucht die Typtabelle nicht mehr");
  });
});

describe("107-04 Review-Fixes: Schlitz mit Teiltiefe", () => {
  const wandG = bauteilGuid(PROJEKT, "customWalls", { _idx: 1 });
  const lauf = (/** @type {any} */ d, extra = {}) => {
    const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    const walls = [{ a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24, _idx: 1 }];
    const meld = [];
    const ifc = exportIFC(model, { storeyHeight: 3, customWalls: walls, durchbrueche: [{ nr: "S-1", id: "s1", art: "schlitz", form: "rechteck", x: -2, y: -1, z: 1.5, b: 0.3, h: 0.4, bauteil_guid: wandG, status: "ausgefuehrt", ...d }], onWarn: (m) => meld.push(m), steckbrief: { projektId: PROJEKT }, ...extra });
    return { ifc, meld };
  };
  it("durchbruchTiefe: t kleiner als die Wanddicke = Schlitz, sonst durch", () => {
    const wirt = /** @type {any} */ ({ wand: { dicke_m: 0.24 } });
    assert.equal(durchbruchTiefe({ t: 0.06 }, wirt), 0.06);
    assert.equal(durchbruchTiefe({ t: 0.24 }, wirt), null, "t = Dicke ist durchgehend");
    assert.equal(durchbruchTiefe({ t: 0.5 }, wirt), null);
    assert.equal(durchbruchTiefe({}, wirt), null);
    assert.equal(durchbruchTiefe({ t: 0.06 }, null), null, "ohne Wirt gibt es nichts zu vergleichen");
  });
  it("Handrechnung: Wand 0,24, t 0,06, Punkt 9 cm von der Mitte → Void 0,08 tief, Mitte 0,12 − 0,03 + 0,01 = 0,10 zur nächsten Wandfläche", () => {
    const s = schlitzImKoerper(0.06, 0.09, 0.24);
    nah(s.tiefe_m, 0.08, "t + 2 cm Überstand"); nah(s.quer_m, 0.1, "Mitte");
    // the void spans quer ± tiefe/2 = [0.06, 0.14]: from 6 cm inside the wall (0.12 − 0.06) to 2 cm beyond the face (0.12 + 0.02)
    nah(s.quer_m - s.tiefe_m / 2, 0.24 / 2 - 0.06, "innere Kante = Wandfläche − t");
    nah(schlitzImKoerper(0.06, -0.09, 0.24).quer_m, -0.1, "andere Seite");
  });
  it("IFC: ausgeführter Schlitz = Void der Tiefe t + 2 cm an der Wandfläche, nicht die volle Dicke; Datenblatt nennt die Tiefe", () => {
    const { ifc } = lauf({ t: 0.06, y: -0.91 });
    const p = profil(ifc, "IFCOPENINGELEMENT", /Durchbruch S-1/);
    assert.equal(p.typ, "IFCRECTANGLEPROFILEDEF");
    nah(p.werte[0], 0.3, "Breite"); nah(p.werte[1], 0.08, "Tiefe t + 2 cm statt Wanddicke + 4 cm"); nah(p.tiefe, 0.4, "Höhe");
    assert.match(ifc, /\(-1\.0000,0\.1000,1\.3000\)/, "Lage quer: +0,10 zur +n-Fläche (Punkt lag bei +0,09)");
    assert.match(ifc, /'Tiefe',\$,IFCREAL\(0\.0600\)/, "Tiefe im Datenblatt");
    const gegen = lauf({ t: 0.06, y: -1.09 }).ifc;
    assert.match(gegen, /\(-1\.0000,-0\.1000,1\.3000\)/, "Punkt auf der −n-Seite → Void an der −n-Fläche");
  });
  it("IFC: t = Dicke oder ohne t bleibt der durchgehende Void (Wanddicke + 4 cm, keine Tiefe im Datenblatt)", () => {
    for (const t of [undefined, 0.24]) {
      const { ifc } = lauf({ t });
      nah(profil(ifc, "IFCOPENINGELEMENT", /Durchbruch S-1/).werte[1], 0.28, `Dicke + 4 cm (t ${t})`);
      assert.ok(!/'Tiefe',/.test(ifc));
    }
  });
  it("runder Schlitz: Zylinder mit derselben Teiltiefe", () => {
    const { ifc } = lauf({ form: "rund", d: 0.15, b: undefined, h: undefined, t: 0.06, y: -0.91 });
    const p = profil(ifc, "IFCOPENINGELEMENT", /Durchbruch S-1/);
    assert.equal(p.typ, "IFCCIRCLEPROFILEDEF"); nah(p.tiefe, 0.08, "Zylinderlänge t + 2 cm");
  });
});

describe("107-04 Review-Fixes: Wirt-GUID, Referenzlinie, Prüfregeln 9/10 an der Hülle", () => {
  const wand = { _idx: 1, a: { x: -4, z: -1 }, b: { x: 2, z: -1 }, level: 0, height: 3, thickness: 0.24 };
  it("Wirt_GUID im Datenblatt ist die GUID, die die Wand in DIESER Datei trägt (auch ohne steckbrief)", () => {
    const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    const d = { nr: "D-1", id: "d1", form: "rechteck", x: -2, y: -1, z: 1.5, b: 0.3, h: 0.4, bauteil_guid: bauteilGuid("p", "customWalls", wand), status: "ausgefuehrt" };
    const ifc = exportIFC(model, { storeyHeight: 3, customWalls: [wand], durchbrueche: [d], steckbrief: { projektId: "p" } });
    const guid = bauteilGuid("p", "customWalls", wand);
    assert.ok(ifc.includes(`=IFCWALL('${guid}'`), "die gezeichnete Wand trägt die abgeleitete GUID");
    assert.equal(ifc.match(/'Wirt_GUID',\$,IFCLABEL\('([^']*)'\)/)?.[1], guid, "Wirt_GUID = GUID der Wand in der Datei");
    // without the option the walls carry sequential GUIDs, the derived `bauteil_guid` finds no host: proxy, reported
    const meld = [];
    const ohne = exportIFC(model, { storeyHeight: 3, customWalls: [wand], durchbrueche: [d], onWarn: (m) => meld.push(m) });
    assert.equal(anzahl(ohne, "IFCBUILDINGELEMENTPROXY"), 1, "ohne steckbrief bleibt der Durchbruch eine Vormerkung");
    assert.ok(meld.some((m) => /kein Wirt gefunden/.test(m)), JSON.stringify(meld));
    assert.ok(!ohne.includes(`'${guid}'`), "die abgeleitete Wand-GUID steht in dieser Datei nicht");
  });
  it("Prüfung gegen den Wandkörper: bei Referenzlinie versetzt sich der Körper, nicht die Achse", () => {
    const dick = { ...wand, thickness: 0.4, refLine: "outside" };
    const wirt = wirtVon({ bauteil_guid: bauteilGuid("p", "customWalls", dick) }, { customWalls: [dick], projektId: "p" });
    const g = wandGeometrie(dick);
    assert.ok(Math.abs(g.versatz_m) > 0.1, "die Referenzlinie versetzt den Körper");
    nah(wirt.wand.versatz_m, g.versatz_m, "Wirt kennt den Versatz");
    const mitte = { x: -2, y: -1 + g.versatz_m, z: 1.5, b: 0.2, h: 0.2 };
    const r = durchbruchImWirt(mitte, wirt);
    assert.equal(r.innen, true); nah(r.koerperQuer_m, 0, "Körpermitte", 1e-9);
    // 0.5 from the axis on the body side: against the axis 0.5 > 0.2 + 0.15 (outside), against the body 0.5 − 0.2 = 0.3 <= 0.35 (inside)
    const amRand = { x: -2, y: -1 + Math.sign(g.versatz_m) * 0.5, z: 1.5, b: 0.2, h: 0.2 };
    assert.equal(durchbruchImWirt(amRand, wirt).innen, true, "Rand des Körpers zählt noch als Wirt");
  });
  it("Regel 9 und 10 finden eine Hüllwand als Wirt (wie Regel 12)", () => {
    const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    const gh = bauteilGuid("p", "huelle", { id: "0:0" });
    const d = { nr: "D-9", id: "d9", form: "rechteck", x: -2, y: -4, z: 1.5, b: 0.2, h: 0.2, bauteil_guid: gh, status: "beantragt" };
    const lauf = (/** @type {any} */ extra = {}) => fehlplanungPruefen({ modell: { customWalls: [], ...extra }, durchbrueche: [d], projektId: "p", huelle: model.walls });
    const b9 = lauf().filter((b) => b.regel === 9);
    assert.equal(b9.length, 1, "Außenwand der Hülle ist tragend: Durchbruch ohne Statik-Freigabe");
    assert.equal(b9[0].stufe, "warn");
    const abbruch = lauf({ bauteil_attribute_layer: { attribute: { "hull-wall": { status: "abbruch" } } } });
    assert.equal(abbruch.filter((b) => b.regel === 10).length, 1, "Hülle wird abgebrochen: Durchbruch gegenstandslos?");
    assert.equal(fehlplanungPruefen({ modell: { customWalls: [] }, durchbrueche: [d], projektId: "p" }).filter((b) => b.regel === 9).length, 0, "ohne huelle bleibt es blind wie bisher");
  });
});

describe("107-04 Review-Fixes: Mengen, Deckenlöcher", () => {
  const w1 = { _idx: 1, a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, height: 3, thickness: 0.24, status: "bestand" };
  it("eine Öffnung ohne Füllung ist kein Fenster in der Mengenliste", () => {
    const els = classifiedElements({ customWalls: [w1], customWindows: [{ wallIdx: 1, kind: "oeffnung", typeId: "oeffnung", u: 2, _idx: 5 }, { wallIdx: 1, kind: "window", typeId: "single", u: 4, _idx: 6 }],
      envOpenings: [{ level: 0, edge: 0, kind: "oeffnung", typeId: "oeffnung", u: 1, _idx: 7 }] });
    assert.deepEqual(els.filter((e) => e.kind === "window").map((e) => e.id), ["window-6"], "nur das echte Fenster");
  });
  it("neue Öffnung in Bestandswand: Abbruchmenge ohne Eigenmaße = 1,00 × 2,10 m (Typ der Öffnung, nicht des Fensters)", () => {
    const els = classifiedElements({ customWalls: [w1], customWindows: [
      { wallIdx: 1, kind: "oeffnung", typeId: "oeffnung", u: 2, status: "neubau", _idx: 5 },
      { wallIdx: 1, kind: "window", typeId: "single", u: 4, status: "neubau", _idx: 6 },
    ] });
    const a = els.find((e) => e.id === "oeffnung-abbruch-5");
    nah(a.mengen.area, 2.1, "1,00 × 2,10 m²"); nah(a.mengen.volume, 2.1 * 0.24, "Fläche × Wanddicke 0,24 m"); nah(a.mengen.length, 1, "Breite");
    nah(els.find((e) => e.id === "oeffnung-abbruch-6").mengen.area, 1.0 * 1.4, "Fenster single 1,0 × 1,4", 1e-3);
  });
  it("Decke mit Loch: Fläche und Volumen sind um das Loch gemindert (Handrechnung 8 × 5 − 1,2 × 1,5 = 38,2 m²)", () => {
    const decke = { points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 5 }, { x: 0, z: 5 }], level: 0, dicke_m: 0.2, _idx: 1,
      oeffnungen: [{ points: [{ x: 2, z: 1 }, { x: 3.2, z: 1 }, { x: 3.2, z: 2.5 }, { x: 2, z: 2.5 }] }] };
    const e = classifiedElements({ customSlabs: [decke] }).find((x) => x.id === "slab-1");
    nah(e.mengen.area, 38.2, "Fläche", 1e-6); nah(e.mengen.volume, 38.2 * 0.2, "Volumen", 1e-6);
    const ohne = classifiedElements({ customSlabs: [{ ...decke, oeffnungen: undefined }] }).find((x) => x.id === "slab-1");
    nah(ohne.mengen.area, 40, "ohne Loch unverändert");
  });
  it("Loch gegen die Decke: ganz innen / über den Rand; Überschneidung zweier Löcher", () => {
    const umriss = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 5 }, { x: 0, z: 5 }];
    assert.equal(lochInDecke(/** @type {any} */ (deckenLochRechteck({ x: 1, z: 1 }, { x: 2, z: 2 })), umriss), true);
    assert.equal(lochInDecke(/** @type {any} */ (deckenLochRechteck({ x: 7, z: 1 }, { x: 9, z: 2 })), umriss), false, "ragt über den Rand");
    assert.equal(lochInDecke(/** @type {any} */ (deckenLochRechteck({ x: 1, z: 1 }, { x: 2, z: 2 })), []), false);
    const alt = [{ points: /** @type {any} */ (deckenLochRechteck({ x: 1, z: 1 }, { x: 2, z: 2 })) }];
    assert.equal(lochUeberlappt(/** @type {any} */ (deckenLochRechteck({ x: 1.5, z: 1.5 }, { x: 3, z: 3 })), alt), true);
    assert.equal(lochUeberlappt(/** @type {any} */ (deckenLochRechteck({ x: 2, z: 1 }, { x: 3, z: 2 })), alt), false, "nur Kante an Kante");
  });
  it("GUID einer Deckenöffnung hängt am Loch (id), nicht an der Listenposition; zwei Decken ohne _idx kollidieren nicht", () => {
    const model = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3 });
    const pts = (/** @type {number} */ dx) => [{ x: dx, z: 0 }, { x: dx + 1, z: 0 }, { x: dx + 1, z: 1 }, { x: dx, z: 1 }];
    const slab = (/** @type {any} */ x) => ({ points: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], level: 0, dicke_m: 0.2, ...x });
    const guids = (/** @type {any[]} */ decken) => {
      const ifc = exportIFC(model, { storeyHeight: 3, customSlabs: decken, steckbrief: { projektId: "p" } });
      return ifc.split("\n").filter((l) => /=IFCOPENINGELEMENT\(/.test(l)).map((l) => l.match(/IFCOPENINGELEMENT\('([^']+)'/)[1]);
    };
    const vorher = guids([slab({ _idx: 3, oeffnungen: [{ id: 1, points: pts(0) }, { id: 2, points: pts(2) }] })]);
    const nachher = guids([slab({ _idx: 3, oeffnungen: [{ id: 2, points: pts(2) }] })]);
    assert.equal(vorher.length, 2); assert.equal(nachher[0], vorher[1], "das zweite Loch behält seine GUID, wenn das erste entfernt wird");
    const zwei = guids([slab({ oeffnungen: [{ points: pts(0) }] }), slab({ oeffnungen: [{ points: pts(2) }] })]);
    assert.equal(new Set(zwei).size, 2, "zwei Decken ohne _idx: verschiedene GUIDs");
  });
});

describe("107-04 Review-Fixes: Maße ohne Brüstung (bewusst anders als der alte IFC-Leser)", () => {
  it("Breite und Höhe ohne Brüstung: die Brüstung des Typs gilt (früher im IFC 0, im 3D schon der Typ)", () => {
    const m = oeffnungsMasse({ kind: "window", typeId: "double", width: 1.5, height: 1.2 });
    assert.deepEqual([m.w, m.h, m.sill], [1.5, 1.2, 0.9]);
  });
});
