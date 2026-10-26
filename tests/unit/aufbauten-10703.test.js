// 107-03: layer function and priority in the one build-up table, element override, core reference lines with real offsets (hand
// calculations), material density, IFC layer details (third golden), project build-ups (fachlayer aufbauten_layer), the section of the hull
// at "center" (user decision 25.10.: the section follows the line like plan and 3D). Pure functions, no browser.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WALL_COMPOSITES, FUNKTIONEN, MAX_PRIORITAET, aufbauVon, funktionVorschlag, prioritaetVorschlag, kernLage,
  setzeProjektAufbauten, aufbauById, aufbautenListe, normalisiereProjektAufbauten, gibProjektAufbautenFrei, overridesNachEntfernen,
} from "@core/lib/bauteil/aufbauten.js";
import { MATERIAL_KATALOG, materialById } from "@core/lib/bauteil/materialien.js";
import * as bauteilAufbauAlt from "@designer/lib/bauteilAufbau";
import { createBuildingModel, compositeById, compositeTotalM } from "@core/lib/buildingModel";
import { refVersatz_m, wandGeometrie, kernVon, huellSchnittWaende } from "@core/lib/bauteil/referenz.js";
import { steckbrief } from "@core/lib/bauteil/steckbrief.js";
import { exportIFC } from "@designer/lib/ifcExport";
import { schnittGrafik } from "@designer/lib/vektorPlan";
import { LAYER_VERSION, migrateLayer } from "@core/lib/fachlayerSchema";
import { EN } from "@core/lib/i18nTeile/bauteilkern-107.js";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";
import { ifcAufbauSzenario } from "./fixtures/ifcAufbauModell-10703.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const funktionen = (/** @type {any} */ el) => aufbauVon(el).schichten.map((s) => s.funktion);

afterEach(() => setzeProjektAufbauten(null));

describe("107-03 Material-Katalog in @core", () => {
  it("der Katalog ist nach @core gezogen, der alte Ort exportiert dieselben Objekte", () => {
    assert.equal(bauteilAufbauAlt.MATERIAL_KATALOG, MATERIAL_KATALOG);
    assert.equal(bauteilAufbauAlt.materialById, materialById);
    assert.equal(MATERIAL_KATALOG.length, 22);
  });
  it("jedes Material hat eine Kategorie; Dichte (kg/m³) ist eine positive Zahl oder fehlt (Luft)", () => {
    for (const m of MATERIAL_KATALOG) {
      assert.ok(["Massiv", "Holz", "Platte", "Putz", "Dämmung", "Bahn", "Luft"].includes(m.kategorie), m.id);
      if (m.dichte !== undefined) assert.ok(Number.isFinite(m.dichte) && m.dichte > 0, `${m.id}: Dichte`);
      else assert.equal(m.kategorie, "Luft", `${m.id} ohne Dichte`);
    }
    assert.equal(materialById("beton").dichte, 2400);
    assert.equal(materialById("ks").dichte, 1800);
  });
});

describe("107-03 Funktion der festen Aufbauten: ausdrücklich gesetzt, nicht aus der Kategorie", () => {
  it("single24: Stahlbeton = Kern", () => assert.deepEqual(funktionen({ composite: "single24" }), ["kern"]));
  it("cavity: Klinker Bekleidung, Luft und Dämmung sonstig, Kalksandstein Kern, Innenputz Bekleidung", () => {
    assert.deepEqual(funktionen({ composite: "cavity" }), ["bekleidung", "sonstig", "sonstig", "kern", "bekleidung"]);
  });
  it("timber: Dämmung (Ständerlage) = Kern, OSB sonstig", () => {
    assert.deepEqual(funktionen({ composite: "timber" }), ["bekleidung", "sonstig", "kern", "sonstig", "bekleidung"]);
  });
  it("gesetzt, nicht abgeleitet; die Priorität ist (noch) ein Vorschlag", () => {
    for (const c of WALL_COMPOSITES) {
      const a = aufbauVon({ composite: c.id });
      assert.equal(a.funktionAbgeleitet, false, c.id);
      assert.ok(a.schichten.every((s) => !s.funktionAbgeleitet), c.id);
      assert.equal(a.prioritaetAbgeleitet, true, c.id);
    }
  });
  it("die Kategorie allein träfe den Kern nicht: die Außenschichten der Tabelle sind Massiv bzw. Holz und trotzdem kein Kern", () => {
    assert.equal(materialById(WALL_COMPOSITES[1].skins[0].material).kategorie, "Massiv");
    assert.equal(materialById(WALL_COMPOSITES[2].skins[0].material).kategorie, "Holz");
    assert.notEqual(funktionen({ composite: "cavity" })[0], "kern");
    assert.notEqual(funktionen({ composite: "timber" })[0], "kern");
  });
  it("aufbauVon ohne Angabe: Dicke, Wände ohne Aufbau, Klasse: unverändertes Verhalten, Fallback-Schicht Kern = kern (abgeleitet)", () => {
    const d = aufbauVon({ thickness: 0.3 });
    assert.equal(d.quelle, "dicke");
    assert.equal(d.schichten[0].funktion, "kern");
    assert.equal(d.schichten[0].funktionAbgeleitet, true);
    assert.equal(aufbauVon({}).quelle, "keine");
    assert.equal(aufbauVon({ klasse: "tragend" }).schichten[0].funktion, "kern", "Kalksandstein-Klasse: einzige Massiv-Schicht");
    assert.equal(aufbauVon({ composite: "cavity" }).dicke_m, 0.46);
  });
});

describe("107-03 Vorschlag für Schichten ohne Angabe (funktionVorschlag, prioritaetVorschlag)", () => {
  const L = (/** @type {string} */ material, /** @type {number} */ mm) => ({ material, thickness: mm });
  const f = (/** @type {any[]} */ l) => funktionVorschlag(l).map((x) => x.funktion);
  it("Kern = dickste Massiv/Holz-Schicht, die nicht die äußerste ist", () => {
    assert.deepEqual(f([L("klinker", 115), L("eps032", 160), L("hlz", 300), L("gipsputz", 15)]), ["bekleidung", "sonstig", "kern", "bekleidung"]);
    assert.deepEqual(f([L("gipsputz", 15), L("beton", 200), L("mw035", 100)]), ["bekleidung", "kern", "sonstig"]);
  });
  it("Außenschicht ist nie Kern, auch nicht als dickste Massiv- oder Holz-Schicht", () => {
    assert.deepEqual(f([L("holz", 200), L("mw035", 100)]), ["bekleidung", "sonstig"]);
    assert.deepEqual(f([L("beton", 300), L("gk", 12)]), ["bekleidung", "bekleidung"]);
    assert.equal(kernLage(aufbauVon({ composite: "x" }).schichten), null, "kein Aufbau, kein Kern");
  });
  it("eine einzelne Schicht ist die äußerste eines einschichtigen Aufbaus: Massiv/Holz = Kern, unbekanntes Material = Kern (Dicke-Wand)", () => {
    assert.deepEqual(f([L("beton", 240)]), ["kern"]);
    assert.deepEqual(f([L("holz", 100)]), ["kern"]);
    assert.deepEqual(f([{ material: null, thickness: 300 }]), ["kern"]);
    assert.deepEqual(f([L("mw035", 100)]), ["sonstig"], "eine einzelne Dämmung ist kein Kern");
  });
  it("Putz und Platte = Bekleidung; Dämmung, Bahn und Luft = sonstig; unbekanntes Material zwischen anderen = sonstig", () => {
    assert.deepEqual(f([L("gipsputz", 10), L("gk", 12), L("mw035", 50), L("dampfbremse", 1), L("luft", 30), { material: "gibtsnicht", thickness: 20 }]),
      ["bekleidung", "bekleidung", "sonstig", "sonstig", "sonstig", "sonstig"]);
  });
  it("gleich dicke Kandidaten: die äußere gewinnt; ein gesetzter Kern sperrt den Vorschlag", () => {
    assert.deepEqual(f([L("gk", 12), L("ks", 100), L("ks", 100)]), ["bekleidung", "kern", "bekleidung"]);
    const r = funktionVorschlag([{ material: "klinker", thickness: 100, funktion: "bekleidung" }, { material: "ks", thickness: 175, funktion: "sonstig" }, { material: "beton", thickness: 200, funktion: "kern" }, { material: "hlz", thickness: 300 }]);
    assert.deepEqual(r.map((x) => x.funktion), ["bekleidung", "sonstig", "kern", "bekleidung"]);
    assert.deepEqual(r.map((x) => x.abgeleitet), [false, false, false, true]);
  });
  it("die drei festen Aufbauten ohne die ausdrückliche Funktion: cavity trifft den Kern (Kalksandstein), timber ohne Angabe hat keinen", () => {
    const ohne = (/** @type {string} */ id) => funktionVorschlag(WALL_COMPOSITES.find((c) => c.id === id).skins.map(({ funktion, ...rest }) => rest));
    assert.deepEqual(ohne("cavity").map((x) => x.funktion), ["bekleidung", "sonstig", "sonstig", "kern", "bekleidung"]);
    assert.deepEqual(ohne("single24").map((x) => x.funktion), ["kern"]);
    assert.ok(!ohne("timber").some((x) => x.funktion === "kern"), "timber: Außenschicht Holz ausgeschlossen, OSB ist Platte — kein Kandidat, deshalb steht der Kern dort ausdrücklich in der Tabelle");
  });
  it("Priorität nach Kategorie (Richtwerte): Beton 850, Mauerwerk 650, Holz 620, Trockenbau 450, Dämmung 320, Putz/Luft 150, unbekannt 500", () => {
    const soll = { beton: 850, ks: 650, hlz: 650, klinker: 650, holz: 620, gk: 450, osb: 450, mw035: 320, eps032: 320, gipsputz: 150, luftbel: 150, dampfbremse: 150 };
    for (const [id, p] of Object.entries(soll)) assert.equal(prioritaetVorschlag(id), p, id);
    assert.equal(prioritaetVorschlag(null), 500);
    assert.equal(prioritaetVorschlag("gibtsnicht"), 500);
    for (const m of MATERIAL_KATALOG) { const p = prioritaetVorschlag(m.id); assert.ok(Number.isInteger(p) && p >= 0 && p <= MAX_PRIORITAET, m.id); }
  });
});

describe("107-03 Element-Override (schicht_funktion, schicht_prioritaet)", () => {
  it("der Override schlägt die Tabelle; ungültige Werte werden ignoriert", () => {
    const a = aufbauVon({ composite: "cavity", schicht_funktion: { 0: "kern", 3: "bekleidung", 1: "blubb" }, schicht_prioritaet: { 4: 100, 0: 1000, 1: -1, 2: 3.5 } });
    assert.deepEqual(a.schichten.map((s) => s.funktion), ["kern", "sonstig", "sonstig", "bekleidung", "bekleidung"]);
    // proposals klinker 650, luftbel 150, mw035 320, ks 650; only the plaster has a valid override (100)
    assert.deepEqual(a.schichten.map((s) => s.prioritaet), [650, 150, 320, 650, 100]);
    assert.equal(a.schichten[4].prioritaetAbgeleitet, false);
    assert.equal(a.schichten[0].prioritaetAbgeleitet, true, "1000 liegt außerhalb 0-999: Vorschlag");
    assert.equal(a.schichten[0].funktionAbgeleitet, false);
  });
  it("Override auf einer Dicke-Wand: nur die einzige Schicht lässt sich umsetzen, der Vorschlag verschwindet", () => {
    const a = aufbauVon({ thickness: 0.24, schicht_funktion: { 0: "sonstig" } });
    assert.equal(a.schichten[0].funktion, "sonstig");
    assert.equal(a.funktionAbgeleitet, false);
    assert.equal(kernLage(a.schichten), null);
  });
  it("ein Override mit Kern in einer Schicht verschiebt die Kernlage (cavity: Klinker als Kern)", () => {
    const k = kernVon({ composite: "cavity", schicht_funktion: { 0: "kern" } });
    assert.deepEqual({ aussen_m: k.aussen_m, kern_m: k.kern_m }, { aussen_m: 0, kern_m: 0.1 }, "erste Kernschicht = Klinker, der Kalksandstein ist getrennt und zählt nicht");
  });
  it("zwei Kernschichten hintereinander bilden einen Kern (Beton + Kalksandstein)", () => {
    const l = kernLage(aufbauVon({ composite: "cavity", schicht_funktion: { 4: "kern" } }).schichten);
    assert.deepEqual({ aussen_m: l.aussen_m, kern_m: l.kern_m }, { aussen_m: 0.27, kern_m: 0.19 });
  });
  it("FUNKTIONEN und Obergrenze", () => {
    assert.deepEqual([...FUNKTIONEN], ["kern", "bekleidung", "sonstig"]);
    assert.equal(MAX_PRIORITAET, 999);
  });
});

describe("107-03 Kern-Lagen mit echtem Versatz (Handrechnung)", () => {
  // the wall runs along +x, so the normal n = (0, 1): the body occupies z ∈ [o − d/2, o + d/2]; layers run outside → inside along −n,
  // the core lies from z = o + d/2 − aussen down to z = o + d/2 − aussen − kern. The reference line is z = 0.
  const wand = (/** @type {any} */ extra) => ({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, _idx: 1, ...extra });
  const kernKanten = (/** @type {any} */ w) => {
    const g = wandGeometrie(w), k = /** @type {any} */ (kernVon(w));
    return { aussen: g.versatz_m + g.dicke_m / 2 - k.aussen_m, innen: g.versatz_m + g.dicke_m / 2 - k.aussen_m - k.kern_m };
  };
  const SOLL = {
    // composite: [d, aussen, kern, innen] in m, then the offsets for coreOutside / coreInside / coreCenter
    single24: { d: 0.24, aussen: 0, kern: 0.24, innen: 0, o: [-0.12, 0.12, 0] },
    cavity: { d: 0.46, aussen: 0.27, kern: 0.175, innen: 0.015, o: [0.04, 0.215, 0.1275] },
    timber: { d: 0.3, aussen: 0.064, kern: 0.2, innen: 0.036, o: [-0.086, 0.114, 0.014] },
  };
  for (const [id, s] of Object.entries(SOLL)) {
    it(`${id}: außen ${s.aussen}, Kern ${s.kern}, innen ${s.innen} m; Versatz je Kernlage`, () => {
      const k = /** @type {any} */ (kernVon({ composite: id }));
      nah(k.aussen_m, s.aussen); nah(k.kern_m, s.kern);
      nah(/** @type {number} */ (compositeTotalM(id)) - k.aussen_m - k.kern_m, s.innen);
      assert.equal(k.abgeleitet, false);
      const lagen = ["coreOutside", "coreInside", "coreCenter"];
      lagen.forEach((refLine, i) => nah(refVersatz_m(refLine, s.d, k), s.o[i], 1e-9));
      nah(wandGeometrie(wand({ composite: id, refLine: "coreOutside" })).versatz_m, s.o[0]);
    });
    it(`${id}: die Referenzlinie z = 0 liegt wirklich auf der Außenfläche / Innenfläche / Mitte der Kernschicht`, () => {
      const e = kernKanten(wand({ composite: id, refLine: "coreOutside" })); nah(e.aussen, 0);
      const i = kernKanten(wand({ composite: id, refLine: "coreInside" })); nah(i.innen, 0);
      const m = kernKanten(wand({ composite: id, refLine: "coreCenter" })); nah((m.aussen + m.innen) / 2, 0);
    });
  }
  it("ohne Kernschicht (alle Schichten sonstig) gilt center", () => {
    const w = wand({ thickness: 0.24, schicht_funktion: { 0: "sonstig" }, refLine: "coreInside" });
    assert.equal(kernVon(w), null);
    assert.equal(wandGeometrie(w).versatz_m, 0);
  });
  it("Dämmstärke ändern (Projektaufbau): die Kernlinie bleibt, der Wandkörper wandert", () => {
    const lage = (/** @type {number} */ mm) => {
      setzeProjektAufbauten({ aufbauten: { "p-1": { name: "x", skins: [
        { name: "Klinker", material: "klinker", thickness: 100 }, { name: "Dämmung", material: "mw035", thickness: mm }, { name: "Kalksandstein", material: "ks", thickness: 175 }, { name: "Innenputz", material: "gipsputz", thickness: 15 } ] } } });
      const w = wand({ composite: "p-1", refLine: "coreOutside" });
      return { g: wandGeometrie(w), kante: kernKanten(w) };
    };
    const a = lage(120), b = lage(200);
    nah(a.kante.aussen, 0); nah(b.kante.aussen, 0);
    assert.notEqual(a.g.versatz_m, b.g.versatz_m, "die Körpermitte wandert mit der Dämmung");
    nah(b.g.dicke_m - a.g.dicke_m, 0.08);
  });
  it("Kernwert mit vorgeschlagenem Kern: Steckbrief meldet die Lage als abgeleitet (Vorschlag), ohne Kern als „ohne Kern-Schicht“", () => {
    setzeProjektAufbauten({ aufbauten: { "p-1": { name: "x", skins: [{ name: "Klinker", material: "klinker", thickness: 100 }, { name: "Dämmung", material: "mw035", thickness: 100 }, { name: "Ziegel", material: "hlz", thickness: 300 }] } } });
    const vorschlag = steckbrief({ ...wand({ composite: "p-1", refLine: "coreOutside" }) }, "wand-tragend");
    assert.equal(vorschlag.quelle.refLine, "abgeleitet");
    assert.ok(vorschlag.annahmen.some((t) => /vorgeschlagene Kern-Schicht/.test(t)));
    for (const t of vorschlag.annahmen) assert.ok(EN[t] || t === "Funktion der Schichten aus dem Material abgeleitet — bitte bestätigen" || EN[t], `EN fehlt: ${t}`);
    const ohne = steckbrief({ ...wand({ thickness: 0.24, schicht_funktion: { 0: "sonstig" }, refLine: "coreCenter" }) }, "wand-tragend");
    assert.equal(ohne.quelle.refLine, "abgeleitet");
    assert.ok(ohne.annahmen.some((t) => /ohne Kern-Schicht/.test(t)));
    const gesetzt = steckbrief(wand({ composite: "cavity", refLine: "coreOutside" }), "wand-aussen");
    assert.ok(!("refLine" in gesetzt.quelle), "ausdrücklich gesetzter Kern: keine Annahme");
  });
});

describe("107-03 Steckbrief: Funktion und Priorität je Schicht mit Herkunft", () => {
  it("feste Aufbauten: Funktion gesetzt, Priorität abgeleitet; Kern im Aufbau", () => {
    const s = steckbrief({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "cavity", level: 0, height: 3 }, "wand-aussen");
    assert.deepEqual(s.aufbau.schichten.map((l) => [l.funktion, l.funktionAbgeleitet]), [["bekleidung", false], ["sonstig", false], ["sonstig", false], ["kern", false], ["bekleidung", false]]);
    assert.equal(s.aufbau.funktionAbgeleitet, false);
    assert.equal(s.aufbau.prioritaetAbgeleitet, true);
    assert.deepEqual({ a: s.aufbau.kern.aussen_m, k: s.aufbau.kern.kern_m }, { a: 0.27, k: 0.175 });
    assert.deepEqual(s.annahmen, [], "feste Aufbauten: keine Funktions-Annahme");
    assert.equal(s.aufbau.schichten[3].prioritaet, 650);
  });
  it("Override gesetzt: Funktion und Priorität der Schicht sind gesetzt, der Rest bleibt Vorschlag", () => {
    const s = steckbrief({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "cavity", level: 0, height: 3, schicht_funktion: { 0: "sonstig" }, schicht_prioritaet: { 3: 700 } }, "wand-aussen");
    assert.equal(s.aufbau.schichten[0].funktion, "sonstig");
    assert.equal(s.aufbau.schichten[3].prioritaet, 700);
    assert.equal(s.aufbau.schichten[3].prioritaetAbgeleitet, false);
    assert.equal(s.aufbau.schichten[2].prioritaetAbgeleitet, true);
  });
  it("Projektaufbau ohne Funktion: Funktion abgeleitet, Annahmetext mit englischer Fassung", () => {
    setzeProjektAufbauten({ aufbauten: { "p-9": { name: "P", skins: [{ name: "Klinker", material: "klinker", thickness: 100 }, { name: "HLZ", material: "hlz", thickness: 300 }] } } });
    const s = steckbrief({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-9", level: 0, height: 3 }, "wand-tragend");
    assert.equal(s.aufbau.funktionAbgeleitet, true);
    assert.ok(s.annahmen.includes("Funktion der Schichten aus dem Material abgeleitet — bitte bestätigen"));
    assert.ok(EN["Funktion der Schichten aus dem Material abgeleitet — bitte bestätigen"]);
    assert.deepEqual(s.aufbau.schichten.map((l) => l.funktion), ["bekleidung", "kern"]);
  });
  it("Decke mit composite hat einen Aufbau, ohne composite weiter keinen", () => {
    setzeProjektAufbauten({ aufbauten: { "p-2": { name: "Decke", skins: [{ name: "Stahlbeton", material: "beton", thickness: 200 }, { name: "Dämmung", material: "mw040", thickness: 30 }] } } });
    const mit = steckbrief({ points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }], level: 1, composite: "p-2" }, "decke");
    assert.equal(mit.aufbau.schichten.length, 2);
    assert.equal(mit.aufbau.quelle, "composite");
    assert.equal(steckbrief({ points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }], level: 1 }, "decke").aufbau, null);
  });
});

describe("107-03 IFC: Category, Priority, LayerSetUsage, Material-Psets", () => {
  const { model, opts, AUFBAUTEN_LAYER } = ifcAufbauSzenario();
  const ifc = (/** @type {any} */ extra = {}) => { setzeProjektAufbauten(AUFBAUTEN_LAYER); return exportIFC(model, { ...opts, ...extra }); };

  it("dritter Golden: Text Zeichen für Zeichen gleich ifc-golden-107-aufbau.ifc", () => {
    const meldungen = [];
    const ist = ifc({ onWarn: (/** @type {string} */ m) => meldungen.push(m) });
    const soll = lies("ifc-golden-107-aufbau.ifc");
    if (ist !== soll) {
      const a = ist.split("\n"), b = soll.split("\n"); let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      assert.fail(`erste Abweichung in Zeile ${i + 1}\n  ist:  ${a[i]}\n  soll: ${b[i]}`);
    }
    assert.deepEqual(meldungen, []);
  });
  it("Category und Priority je Schicht (Priorität /10 gerundet), Funktion → Core / Finish / Other", () => {
    const t = ifc();
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.2400,\.F\.,'Stahlbeton',\$,'Core',85\);/, "Beton 850 → 85");
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.1750,\.F\.,'Kalksandstein',\$,'Core',65\);/);
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.1000,\.F\.,'Klinker',\$,'Finish',65\);/);
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.0500,\.T\.,'Luftschicht',\$,'Other',15\);/);
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.0150,\.F\.,'Innenputz',\$,'Finish',10\);/, "Override: Priorität 100 → 10");
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.1000,\.F\.,'Klinker',\$,'Core',65\);/, "Override: Klinker als Kern");
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.3000,\.F\.,'Hochlochziegel',\$,'Core',65\);/, "Projektaufbau ohne Funktion: Vorschlag hlz = Kern");
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.2000,\.F\.,'Stahlbeton',\$,'Core',90\);/, "Decke mit gesetzter Priorität 900");
    assert.match(t, /IFCMATERIALLAYER\(#\d+,0\.2400,\.F\.,'Kern',\$,'Core',50\);/, "Dicke-Wand: abgeleiteter Kern, Priorität 500 → 50");
  });
  it("jede Wand mit echtem Aufbau (Hülle, gezeichnet, Werkstattklasse) bekommt eine IfcMaterialLayerSetUsage, die Dicke-Wand nicht", () => {
    const t = ifc();
    const z = (/** @type {RegExp} */ re) => (t.match(re) || []).length;
    assert.equal(z(/=IFCWALL\(/g), 15);
    assert.equal(z(/=IFCMATERIALLAYERSETUSAGE\(/g), 14, "15 Wände, davon eine nur mit Dicke");
    // the usage points at a layer set and states the stacking: AXIS2 (plan normal), NEGATIVE (outside → inside), offset = half the build-up
    assert.match(t, /IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.2300,\$\);/, "cavity 0,46 m → 0,23 m");
    assert.match(t, /IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.1200,\$\);/, "single24 0,24 m → 0,12 m");
    assert.match(t, /IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.1500,\$\);/, "timber 0,30 m → 0,15 m");
    assert.match(t, /IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.2950,\$\);/, "Projektaufbau 0,59 m");
    assert.match(t, /IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.0575,\$\);/, "Werkstattwand 0,115 m");
    // the slab with a project build-up carries a layer set (Core/90 above) but no usage: the layer direction of a slab is the vertical axis, outside this plan
  });
  it("das Datenblatt nennt Referenzlinie, Versatz (Handrechnung) und die Herkunft von Funktion und Priorität", () => {
    const t = ifc();
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('Referenzlinie',\$,IFCLABEL\('coreOutside'\),\$\);/);
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('Referenzlinie_Versatz',\$,IFCREAL\(0\.0400\),\$\);/, "cavity coreOutside: +0,04 m");
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('Referenzlinie_Versatz',\$,IFCREAL\(0\.1140\),\$\);/, "timber coreInside: +0,114 m");
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('Referenzlinie_Versatz',\$,IFCREAL\(-0\.0200\),\$\);/, "Projektaufbau coreOutside: −0,02 m");
    assert.match(t, /'Schichtfunktion_Herkunft',\$,IFCLABEL\('abgeleitet \(Vorschlag\)'\)/);
    assert.match(t, /'Schichtfunktion_Herkunft',\$,IFCLABEL\('gesetzt'\)/);
  });
  it("Material: Dichte (Pset_MaterialCommon.MassDensity) und Wärmeleitfähigkeit (Pset_MaterialThermal.ThermalConductivity)", () => {
    const t = ifc();
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('MassDensity',\$,IFCMASSDENSITYMEASURE\(2400\.0000\),\$\);/);
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('MassDensity',\$,IFCMASSDENSITYMEASURE\(1800\.0000\),\$\);/);
    assert.match(t, /IFCPROPERTYSINGLEVALUE\('ThermalConductivity',\$,IFCTHERMALCONDUCTIVITYMEASURE\(2\.3000\),\$\);/);
    assert.match(t, /IFCMATERIALPROPERTIES\('Pset_MaterialCommon',\$,\(#\d+\),#\d+\);/);
    assert.match(t, /IFCMATERIALPROPERTIES\('Pset_MaterialThermal',\$,\(#\d+\),#\d+\);/);
    // luftbel has neither density nor conductivity: no property set on that material
    assert.ok(!/MassDensity',\$,IFCMASSDENSITYMEASURE\(0/.test(t));
  });
  it("ohne die Option (und mit schichtdetails: false) bleibt der Export byte-gleich zum ersten Golden und trägt nichts Neues", () => {
    const { model: m1, mit } = ifcGoldenSzenario();
    const alt = exportIFC(m1, mit);
    assert.equal(alt, lies("ifc-golden-107-steckbrief.ifc"));
    assert.equal(exportIFC(m1, { ...mit, steckbrief: { ...mit.steckbrief, schichtdetails: false } }), alt);
    assert.ok(!/LAYERSETUSAGE|MATERIALPROPERTIES|Referenzlinie_Versatz/.test(alt));
    const neu = exportIFC(m1, { ...mit, steckbrief: { ...mit.steckbrief, schichtdetails: true } });
    assert.notEqual(neu, alt);
    assert.match(neu, /IFCMATERIALLAYERSETUSAGE/);
  });
  it("ohne Steckbrief-Option ändert sich nichts, auch wenn schichtdetails fehlt (kein Datenblatt = kein Material)", () => {
    const { model: m1, ohne } = ifcGoldenSzenario();
    assert.equal(exportIFC(m1, ohne), lies("ifc-golden-107.ifc"));
  });
});

describe("107-03 Projektbezogene Aufbauten (Fachlayer aufbauten_layer, D-BK-22)", () => {
  const LAYER = { aufbauten: {
    "p-1": { name: "Wand A", skins: [{ name: "Putz", material: "kalkzementputz", thickness: 20 }, { name: "Ziegel", material: "hlz", thickness: 365, funktion: "kern", prioritaet: 700 }] },
    "kaputt": { name: "ohne Schichten", skins: [] },
    "": { name: "ohne Id", skins: [{ thickness: 10 }] },
    "p-2": { skins: [{ material: "ks", thickness: 0 }, { material: "ks", thickness: 175, funktion: "irgendwas", prioritaet: 5000 }] },
  } };
  it("Version 1 im Register, Migration ohne Version lässt den Inhalt unverändert", () => {
    assert.equal(LAYER_VERSION.aufbauten_layer, 1);
    const r = migrateLayer("aufbauten_layer", { aufbauten: LAYER.aufbauten });
    assert.equal(r.migriert, true);
    assert.equal(r.wert.v, 1);
    assert.deepEqual(r.wert.aufbauten, LAYER.aufbauten);
  });
  it("normalisiereProjektAufbauten: kaputte Einträge fallen weg, fehlende Felder kommen aus dem Material, ungültige Funktion/Priorität entfallen", () => {
    const n = normalisiereProjektAufbauten(LAYER);
    assert.deepEqual(n.map((c) => c.id), ["p-1", "p-2"]);
    assert.equal(n[0].skins[0].color, materialById("kalkzementputz").color);
    assert.equal(n[0].skins[0].schicht, "Putz");
    assert.equal(n[0].skins[1].funktion, "kern");
    assert.equal(n[0].skins[1].prioritaet, 700);
    assert.equal(n[1].name, "p-2", "ohne Namen gilt die Id");
    assert.equal(n[1].skins.length, 1, "Schicht ohne Dicke fällt weg");
    assert.equal(n[1].skins[0].funktion, undefined);
    assert.equal(n[1].skins[0].prioritaet, undefined);
    assert.deepEqual(normalisiereProjektAufbauten(null), []);
    assert.deepEqual(normalisiereProjektAufbauten({ aufbauten: "x" }), []);
  });
  it("compositeById und aufbauVon fragen erst den Layer, dann die Konstanten; ohne Layer wie vorher", () => {
    assert.equal(compositeById("p-1"), null, "ohne Layer gibt es die Id nicht");
    assert.equal(compositeById("cavity").id, "cavity");
    setzeProjektAufbauten(LAYER);
    assert.equal(compositeById("p-1").name, "Wand A");
    assert.equal(aufbauById("p-1"), compositeById("p-1"));
    assert.equal(compositeById("cavity").id, "cavity", "die festen Aufbauten bleiben");
    nah(/** @type {number} */ (compositeTotalM("p-1")), 0.385);
    assert.equal(aufbauVon({ composite: "p-1" }).dicke_m, 0.385);
    assert.deepEqual(aufbautenListe().map((c) => c.id), ["p-1", "p-2", "single24", "cavity", "timber"]);
    setzeProjektAufbauten(null);
    assert.deepEqual(aufbautenListe().map((c) => c.id), ["single24", "cavity", "timber"]);
    assert.equal(aufbauVon({ composite: "p-1", thickness: 0.3 }).quelle, "dicke", "Id gelöscht: die Wand fällt auf ihre Dicke zurück, nichts bricht");
  });
  it("eine Layer-Id vor einer festen Id gilt zuerst im Projekt", () => {
    setzeProjektAufbauten({ aufbauten: { cavity: { name: "Eigene Cavity", skins: [{ name: "KS", material: "ks", thickness: 300 }] } } });
    assert.equal(compositeById("cavity").name, "Eigene Cavity");
    assert.deepEqual(aufbautenListe().map((c) => c.id), ["cavity", "single24", "timber"], "kein Doppeleintrag");
    assert.equal(aufbauVon({ composite: "cavity" }).dicke_m, 0.3);
  });
  it("Wanddicke und Hüllmodell folgen dem Projektaufbau (createBuildingModel über compositeTotalM)", () => {
    setzeProjektAufbauten(LAYER);
    const m = createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 1, wallComposite: "p-1" });
    nah(m.walls[0].thickness, 0.385);
  });
});

describe("107-03 Zusatzaufgabe: der Schnitt der Hülle folgt bei center der Linie (Nutzerentscheid 25.10.2026)", () => {
  const FP = [{ x: -10, z: -6 }, { x: 10, z: -6 }, { x: 10, z: 6 }, { x: -10, z: 6 }];
  const modell = (/** @type {any} */ b) => createBuildingModel({ footprintM: FP, storeys: 2, wallThickness: 0.3, huelleBezug: b });
  const rund = (/** @type {any[]} */ l) => l.map((s) => [s.von_m, s.bis_m].map((v) => Math.round(v * 1e6) / 1e6));
  it("center: die Schnittwände sind um die halbe Dicke nach außen gerückt, Dicke und Summe bleiben (Vorher/Nachher)", () => {
    // before: [[-10, -9.7], [9.7, 10]] (inside the footprint box); now centred on x = ±10 like plan, 3D and IFC
    assert.deepEqual(rund(huellSchnittWaende(modell("center"))), [[-10.15, -9.85], [9.85, 10.15]]);
    for (const s of huellSchnittWaende(modell("center"))) nah(s.dicke_m, 0.3);
  });
  it("Schnitt = Grundriss-Wandkörper in der Schnittebene für center, outside und inside", () => {
    for (const b of ["center", "outside", "inside"]) {
      const m = modell(b);
      const links = m.walls.filter((w) => w.level === 0 && Math.abs(wandGeometrie(w).richtung.z) > 0.5).map((w) => wandGeometrie(w).polygon.map((p) => p.x));
      const xs = links.map((l) => [Math.min(...l), Math.max(...l)]);
      const s = huellSchnittWaende(m);
      nah(s[0].von_m, Math.min(...xs.map((x) => x[0]))); nah(s[0].bis_m, Math.min(...xs.map((x) => x[1])));
      nah(s[1].von_m, Math.max(...xs.map((x) => x[0]))); nah(s[1].bis_m, Math.max(...xs.map((x) => x[1])));
    }
  });
  it("PDF-Schnitt: die geschnittenen Wände und die Attika liegen an denselben Kanten", () => {
    const g = schnittGrafik({ model: createBuildingModel({ footprintM: FP, storeys: 2, wallThickness: 0.3, parapet: { enabled: true, height: 0.6 } }), storeyHeight: 3 });
    const waende = g.elemente.filter((e) => e.ebene === "wand").map((e) => [Math.min(...e.pts.map((p) => p.x)), Math.max(...e.pts.map((p) => p.x))].map((v) => Math.round(v * 1e6) / 1e6));
    assert.deepEqual(waende, [[-10.15, -9.85], [9.85, 10.15]]);
    const dach = g.elemente.filter((e) => e.ebene === "dach").map((e) => [Math.min(...e.pts.map((p) => p.x)), Math.max(...e.pts.map((p) => p.x))].map((v) => Math.round(v * 1e6) / 1e6));
    assert.deepEqual(dach, [[-10.15, -9.85], [9.85, 10.15]], "Attika folgt der Wand");
  });
});

describe("107-03 Review-Fixes", () => {
  it("timber: die [ASSUMED]-Funktionen (Kern = Dämmung, OSB = sonstig) sind als Annahme gekennzeichnet, cavity und single24 nicht", () => {
    const t = aufbauVon({ composite: "timber" });
    assert.deepEqual(t.schichten.map((l) => l.funktionAnnahme), [false, false, true, true, false]);
    assert.equal(t.funktionAnnahme, true);
    assert.equal(t.funktionAbgeleitet, false, "gesetzt, nicht abgeleitet: der Vorschlag bleibt dem Material vorbehalten");
    assert.equal(aufbauVon({ composite: "cavity" }).funktionAnnahme, false);
    assert.equal(aufbauVon({ composite: "single24" }).funktionAnnahme, false);
    // the element's own override is the user's decision: it ends the flag on that layer only
    const o = aufbauVon({ composite: "timber", schicht_funktion: { 2: "kern" } });
    assert.deepEqual(o.schichten.map((l) => l.funktionAnnahme), [false, false, false, true, false]);
  });
  it("timber: Steckbrief nennt die Annahme (mit englischer Fassung), cavity nicht; IFC-Herkunft der Funktion sagt Annahme", () => {
    const text = "Funktion einzelner Schichten des Aufbaus ist eine Annahme — bitte bestätigen";
    const w = (/** @type {string} */ composite) => ({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, composite, _idx: 1 });
    assert.ok(steckbrief(w("timber"), "wand-tragend").annahmen.includes(text));
    assert.ok(EN[text]);
    assert.ok(!steckbrief(w("cavity"), "wand-tragend").annahmen.includes(text));
    const leer = () => createBuildingModel({ footprintM: [], storeys: 1 });
    const ifc = exportIFC(leer(), { customWalls: [w("timber")], storeyHeight: 3, steckbrief: { schichtdetails: true } });
    assert.match(ifc, /'Schichtfunktion_Herkunft',\$,IFCLABEL\('gesetzt \(Annahme, bitte best\\X2\\00E4\\X0\\tigen\)'\)/);
    const cav = exportIFC(leer(), { customWalls: [w("cavity")], storeyHeight: 3, steckbrief: { schichtdetails: true } });
    assert.match(cav, /'Schichtfunktion_Herkunft',\$,IFCLABEL\('gesetzt'\)/);
  });
  it("Wand nur mit Dicke: ein Kernwert wirkt wie center (Altprojekte laden unverändert), der Aufbau hat weiter seine abgeleitete Kern-Schicht", () => {
    const d = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, thickness: 0.24, _idx: 1 };
    assert.equal(kernVon(d), null);
    for (const v of ["coreOutside", "coreInside", "coreCenter"]) assert.equal(wandGeometrie({ ...d, refLine: v }).versatz_m, 0, v);
    assert.equal(aufbauVon(d).schichten[0].funktion, "kern");
    // the data sheet names it, like in 107-01 (not "derived core")
    const s = steckbrief({ ...d, refLine: "coreOutside" }, "wand-tragend");
    assert.equal(s.quelle.refLine, "abgeleitet");
    assert.match(s.annahmen.join("|"), /ohne Kern-Schicht wie Mitte behandelt/);
    // a build-up wall with the same value still gets its real offset
    assert.notEqual(wandGeometrie({ ...d, composite: "cavity", refLine: "coreOutside" }).versatz_m, 0);
  });
  it("steckbrief: ctx.kern = null heißt kein Kern (nicht nicht angegeben)", () => {
    const w = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, composite: "cavity", refLine: "coreOutside", _idx: 1 };
    assert.equal(steckbrief(w, "wand-tragend").quelle.refLine, undefined, "ohne ctx.kern: aus dem Aufbau abgeleitet, Kern gesetzt");
    assert.equal(steckbrief(w, "wand-tragend", { kern: null }).quelle.refLine, "abgeleitet");
  });
  it("overridesNachEntfernen: Schlüssel hinter der entfernten Schicht rücken auf, der der entfernten fällt weg", () => {
    const el = { schicht_funktion: { 0: "kern", 3: "kern" }, schicht_prioritaet: { 3: 770 }, schicht_status: { 1: "bestand", 4: "abbruch" } };
    assert.deepEqual(overridesNachEntfernen(el, 1), { schicht_funktion: { 0: "kern", 2: "kern" }, schicht_prioritaet: { 2: 770 }, schicht_status: { 3: "abbruch" } });
    assert.deepEqual(overridesNachEntfernen(el, 3), { schicht_funktion: { 0: "kern" }, schicht_prioritaet: undefined, schicht_status: { 1: "bestand", 3: "abbruch" } });
    assert.equal(overridesNachEntfernen({ schicht_funktion: { 0: "kern" } }, 2), null, "Schicht hinter allen Schlüsseln: nichts zu tun");
    assert.equal(overridesNachEntfernen({}, 0), null);
    // the override still sits on the same layer: after removing the insulation (index 1) the calcium silicate (was index 2) is index 1
    const nach = { composite: "p-9", ...overridesNachEntfernen({ schicht_prioritaet: { 2: 770 } }, 1) };
    setzeProjektAufbauten({ aufbauten: { "p-9": { name: "x", skins: [
      { name: "Klinker", material: "klinker", thickness: 100 },
      { name: "Kalksandstein", material: "ks", thickness: 175 }, { name: "Innenputz", material: "gipsputz", thickness: 15 }] } } });
    const l = aufbauVon(nach).schichten;
    assert.equal(l[1].name, "Kalksandstein");
    assert.equal(l[1].prioritaet, 770);
    assert.equal(l[1].prioritaetAbgeleitet, false);
    assert.equal(l[2].prioritaetAbgeleitet, true);
  });
  it("gibProjektAufbautenFrei: leert nur, was dieselbe Layer-Referenz gesetzt hat (Projektwechsel, Unmount)", () => {
    const a = { aufbauten: { "p-1": { name: "A", skins: [{ name: "Beton", material: "beton", thickness: 200 }] } } };
    const b = { aufbauten: { "p-1": { name: "B", skins: [{ name: "Beton", material: "beton", thickness: 300 }] } } };
    setzeProjektAufbauten(a);
    assert.equal(aufbauById("p-1")?.name, "A");
    setzeProjektAufbauten(b);
    gibProjektAufbautenFrei(a);
    assert.equal(aufbauById("p-1")?.name, "B", "a view that set an older value must not wipe the newer one");
    gibProjektAufbautenFrei(b);
    assert.equal(aufbauById("p-1"), null, "released: the id of the old project does not resolve any more");
    setzeProjektAufbauten(null);
    gibProjektAufbautenFrei(undefined);
    assert.equal(aufbauById("p-1"), null);
  });
  it("normalisiereProjektAufbauten behält funktionAnnahme nur bei gesetzter Funktion", () => {
    const n = normalisiereProjektAufbauten({ aufbauten: { "p-1": { name: "x", skins: [
      { material: "beton", thickness: 100, funktion: "kern", funktionAnnahme: true },
      { material: "mw035", thickness: 100, funktionAnnahme: true },
      { material: "gipsputz", thickness: 15, funktion: "bekleidung" }] } } });
    assert.deepEqual(n[0].skins.map((k) => k.funktionAnnahme), [true, undefined, undefined]);
  });
  it("Studio: der IFC-Download übergibt bauteilAttribute als Option (Regression: ein Zeilenkommentar hatte sie verschluckt)", () => {
    const quelle = readFileSync(fileURLToPath(new URL("../../packages/nova-designer/src/components/BitBimStudio.jsx", import.meta.url)), "utf8");
    const start = quelle.indexOf("const downloadIFC = () => {");
    assert.ok(start > 0);
    const aufruf = quelle.slice(start, quelle.indexOf("projectName:", start));
    // without line comments: what the engine actually sees
    const code = aufruf.split("\n").map((z) => z.replace(/\/\/.*$/, "")).join("\n");
    assert.match(code, /bauteilAttribute:\s*attributLayer/);
    assert.match(code, /steckbrief:\s*\{[^}]*schichtdetails:\s*true/);
    assert.match(code, /tragwerk:\s*statikLayer/);
  });
});
