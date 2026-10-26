// 107-02: vertical binding — @core/lib/bauteil/hoehen.js is the ONE place where a storey index becomes a height.
// Covers: elevation / storey height (one number and storey table), wall height linked to the storey versus absolute
// (storey height 3.0 → 3.2 m), offsets, slab / roof thickness and side with the old literals as default, the roof
// unit conflict (`pitch` in metres versus degrees), unknown storey in the IFC export, the storey table through
// createBuildingModel / IFC / workshop walls / data-sheet quantity / selection, the export of the default model
// against the golden of 107-01, and a guard that scans the whole source tree for the old `level * storeyHeight` multiplications.
// Review fixes: one writer for the storey height (row for a new storey), top-storey level, section dimension, AVA/workshop heights, roof slope 0.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuildingModel } from "@core/lib/buildingModel";
import {
  elevationOf, geschosshoehe, gesamtHoehe, unterkante, oberkante, wandHoehe, stuetzenHoehe, raumHoehe, deckenLage, DECKEN_STANDARD,
  dachHalbspannweite_m, dachFirsthoehe_m, dachNeigung_grad, dachMigrieren, dachHatGetrennteFelder, firsthoeheAusNeigung,
  geschosseErzeugen, geschosseAus, MIN_WANDHOEHE_M, FLACHDACH_BIS_GRAD, MAX_NEIGUNG_GRAD,
  geschossHoeheAusModell, okfObersterGeschoss, patchAlleGeschosshoehen, patchGeschosshoehe,
} from "@core/lib/bauteil/hoehen.js";
import { eckfueller } from "@core/lib/bauteil/referenz.js";
import { mengeVon, BAUTEIL_TYPEN } from "@core/lib/bauteil/steckbrief.js";
import { classifiedElements, synthHull } from "@core/lib/bimClassification.js";
import { werkstattBauteile } from "@core/lib/werkstattBauteile.js";
import { programMetrics, buildingProgram } from "@core/lib/useBuildingProgram.js";
import { ausEinzelkoerper } from "@core/lib/massing/massingModell.js";
import { exportIFC, WARNART_GESCHOSS } from "@designer/lib/ifcExport";
import { bimBauteil } from "@designer/lib/auswahlBim.js";
import { schnittGrafik } from "@designer/lib/vektorPlan";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const FP = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
const RECHTECK = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];

// ---- tiny STEP reader: the placement height and the extrusion depth of an element, from the text ----
/** @param {string} text @param {string} ref e.g. "#12" @returns {string} the full row */
const zeile = (text, ref) => (text.split("\n").find((l) => l.startsWith(`${ref}=`)) || "");
/** z of an IFCLOCALPLACEMENT (absolute placements only) */
function platzierungZ(/** @type {string} */ text, /** @type {string} */ plRef) {
  const a2p = /IFCLOCALPLACEMENT\(\$,(#\d+)\)/.exec(zeile(text, plRef))[1];
  const loc = /IFCAXIS2PLACEMENT3D\((#\d+),/.exec(zeile(text, a2p))[1];
  return Number(/\(([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(zeile(text, loc))[3]);
}
/** all rows of one entity type as { ref, args } */
function zeilenVon(/** @type {string} */ text, /** @type {string} */ typ) {
  return text.split("\n").filter((l) => new RegExp(`^#\\d+=${typ}\\(`).test(l)).map((l) => ({ ref: l.slice(0, l.indexOf("=")), args: l.slice(l.indexOf("(") + 1, l.lastIndexOf(")")) }));
}
/** extrusion depth of the solid of an element row: attribute 7 (Representation) → product shape → shape representation → solid */
function tiefe(/** @type {string} */ text, /** @type {string} */ elementArgs) {
  const pds = elementArgs.split(",")[6];
  const sr = /\$,\$,\((#\d+)\)/.exec(zeile(text, pds))[1];
  const solid = /'SweptSolid',\((#\d+)\)/.exec(zeile(text, sr))[1];
  return Number(/IFCEXTRUDEDAREASOLID\(#\d+,#\d+,#\d+,([-\d.]+)\)/.exec(zeile(text, solid))[1]);
}
const wandzeilen = (/** @type {string} */ text) => zeilenVon(text, "IFCWALL");
const platzierungRef = (/** @type {string} */ args) => args.split(",").find((t, i) => i > 4 && /^#\d+$/.test(t));

/** drawn wall of 4 m × 0.3 m, level 0, top edge linked to the storey */
const wandGeschoss = (extra = {}) => ({ a: { x: -2, z: 0 }, b: { x: 2, z: 0 }, level: 0, height: 3, thickness: 0.3, oberkante_bezug: "geschoss", oberkante_geschosse: 1, oberkante_versatz_m: 0, _idx: 1, ...extra });

describe("107-02 elevationOf / geschosshoehe", () => {
  it("eine Höhe: Ebene mal Höhe wie der alte Code, ohne Angabe 3 m", () => {
    assert.equal(elevationOf(0, 3), 0);
    assert.equal(elevationOf(2, 3.2), 2 * 3.2);
    assert.equal(elevationOf(3, undefined), 9);
    assert.equal(elevationOf(undefined, 3), 0);
    assert.equal(geschosshoehe(5, 3.2), 3.2);
    assert.equal(geschosshoehe(0, 0), 3, "Höhe 0 oder negativ fällt auf 3 m");
  });

  it("Geschosstabelle: Summe der Höhen, außerhalb der Tabelle gilt die nächstliegende Zeile, negative Ebenen zählen nach unten", () => {
    const t = [{ level: 0, hoehe_m: 3.5 }, { level: 1, hoehe_m: 3 }, { level: 2, hoehe_m: 2.8 }];
    nah(elevationOf(0, t), 0); nah(elevationOf(1, t), 3.5); nah(elevationOf(2, t), 6.5); nah(elevationOf(3, t), 9.3);
    nah(elevationOf(4, t), 9.3 + 2.8, 1e-9);
    nah(geschosshoehe(7, t), 2.8); nah(geschosshoehe(-3, t), 3.5);
    nah(elevationOf(-1, t), -3.5); nah(elevationOf(-2, t), -7);
    nah(gesamtHoehe(3, t), 9.3);
  });

  it("geschosseErzeugen / geschosseAus: Tabelle aus storeys × Höhe, kaputte Zeilen fallen weg, ohne Tabelle die Zahl", () => {
    assert.deepEqual(geschosseErzeugen(3, 3.1), [{ level: 0, name: "EG", hoehe_m: 3.1 }, { level: 1, name: "1. OG", hoehe_m: 3.1 }, { level: 2, name: "2. OG", hoehe_m: 3.1 }]);
    assert.equal(geschosseAus({ storeyHeight: 3.2 }), 3.2);
    assert.equal(geschosseAus({}), 3);
    assert.equal(geschosseAus({ geschosse: [], storeyHeight: 2.9 }), 2.9);
    assert.equal(geschosseAus({ geschosse: [{ level: "x", hoehe_m: 3 }, { level: 0, hoehe_m: -1 }], storeyHeight: 2.9 }), 2.9);
    assert.deepEqual(geschosseAus({ geschosse: [{ level: 1, hoehe_m: 3 }, { level: 0, hoehe_m: 3.4, name: "EG" }, null], storeyHeight: 3 }),
      [{ level: 0, name: "EG", hoehe_m: 3.4 }, { level: 1, name: undefined, hoehe_m: 3 }]);
  });
});

describe("107-02 Wandhöhe: bis Geschoss gegen absolut", () => {
  it("Geschosshöhe 3,0 → 3,2: die Wand bis Geschoss wächst mit, die absolute bleibt", () => {
    const folgt = wandGeschoss(), fest = wandGeschoss({ oberkante_bezug: "absolut" }), alt = { level: 0, height: 3 };
    nah(wandHoehe(folgt, 3), 3); nah(wandHoehe(folgt, 3.2), 3.2);
    nah(wandHoehe(fest, 3.2), 3); nah(wandHoehe(alt, 3.2), 3);
  });

  it("Versatz Oberkante und Unterkante: Höhe = Oberkante − Unterkante, in einem Obergeschoss und über zwei Geschosse", () => {
    const w = wandGeschoss({ level: 1, oberkante_versatz_m: -0.2 });
    nah(wandHoehe(w, 3), 2.8); nah(unterkante(w, 3), 3); nah(oberkante(w, 3), 5.8);
    const u = wandGeschoss({ unterkante_versatz_m: 0.5 }); // lower edge 0.5 m up → top stays on the storey above
    nah(unterkante(u, 3), 0.5); nah(wandHoehe(u, 3), 2.5);
    const zwei = wandGeschoss({ oberkante_geschosse: 2 });
    nah(wandHoehe(zwei, 3.2), 6.4);
  });

  it("Wand ohne Höhe und ohne Verknüpfung nimmt die Geschosshöhe (wie das alte `height || storeyHeight`)", () => {
    nah(wandHoehe({ level: 0 }, 3.4), 3.4);
    nah(wandHoehe({ level: 1, height: 0 }, [{ level: 0, hoehe_m: 3 }, { level: 1, hoehe_m: 2.7 }]), 2.7);
  });

  it("Oberkante unter der Unterkante: Mindesthöhe statt null oder negativ", () => {
    nah(wandHoehe(wandGeschoss({ oberkante_versatz_m: -5 }), 3), MIN_WANDHOEHE_M);
  });

  it("Stütze: Geschosshöhe ihrer Ebene; verknüpft wie die Wand. Raum: 98 % oder verknüpft", () => {
    nah(stuetzenHoehe({ level: 1 }, [{ level: 0, hoehe_m: 3 }, { level: 1, hoehe_m: 2.6 }]), 2.6);
    nah(stuetzenHoehe({ level: 0, oberkante_bezug: "geschoss", oberkante_versatz_m: -0.3 }, 3), 2.7);
    nah(raumHoehe({ level: 0 }, 3), 2.94);
    nah(raumHoehe({ level: 0, oberkante_bezug: "geschoss" }, 3), 3);
  });
});

describe("107-02 Decke und Dach: Dicke und Bezug", () => {
  it("Standard = die alten Literale: Hülle 0,25 unten, gezeichnet 0,22 oben, Dach 0,2 unten", () => {
    assert.deepEqual(DECKEN_STANDARD, { huelle: { dicke_m: 0.25, bezug: "unten" }, decke: { dicke_m: 0.22, bezug: "oben" }, dach: { dicke_m: 0.2, bezug: "unten" } });
    assert.deepEqual(deckenLage({ level: 1, elevation: 6 }, 3, "huelle"), { unterkante_m: 6, oberkante_m: 6.25, dicke_m: 0.25 });
    const dl = deckenLage({ level: 1 }, 3, "decke");
    nah(dl.oberkante_m, 6); nah(dl.unterkante_m, 6 - 0.22); nah(dl.dicke_m, 0.22);
    assert.deepEqual(deckenLage({ level: 1 }, 3, "dach"), { unterkante_m: 6, oberkante_m: 6.2, dicke_m: 0.2 });
  });

  it("dicke_m und bezug wirken: oben/unten tauschen die Kante an der Ebene, die Ebene bleibt", () => {
    assert.deepEqual(deckenLage({ level: 0, dicke_m: 0.3, bezug: "oben" }, 3, "dach"), { unterkante_m: 3 - 0.3, oberkante_m: 3, dicke_m: 0.3 });
    assert.deepEqual(deckenLage({ level: 0, elevation: 3, dicke_m: 0.4, bezug: "oben" }, 3, "huelle"), { unterkante_m: 3 - 0.4, oberkante_m: 3, dicke_m: 0.4 });
    assert.deepEqual(deckenLage({ level: 0, dicke_m: 0.18, bezug: "unten" }, 3, "decke"), { unterkante_m: 3, oberkante_m: 3.18, dicke_m: 0.18 });
    // unbrauchbare Werte fallen auf den Standard
    assert.deepEqual(deckenLage({ level: 0, dicke_m: -1, bezug: "mitte" }, 3, "decke"), deckenLage({ level: 0 }, 3, "decke"));
  });

  it("Geschosstabelle verschiebt die Ebene von gezeichneter Decke und Dach", () => {
    const t = [{ level: 0, hoehe_m: 3.5 }, { level: 1, hoehe_m: 3 }];
    nah(deckenLage({ level: 0 }, t, "decke").oberkante_m, 3.5);
    nah(deckenLage({ level: 1 }, t, "dach").unterkante_m, 6.5);
  });
});

describe("107-02 Dach: Firsthöhe (m) und Neigung (°) getrennt", () => {
  const rf = { points: RECHTECK, level: 1, pitch: 2.5 }; // 10 × 8 m → half span 4 m

  it("Altfeld pitch wird als Firsthöhe in m gelesen; Neigung = atan(Firsthöhe / halbe Spannweite)", () => {
    nah(dachHalbspannweite_m(RECHTECK), 4);
    nah(dachFirsthoehe_m(rf), 2.5);
    nah(dachNeigung_grad(rf), (Math.atan2(2.5, 4) * 180) / Math.PI, 1e-9);
    assert.ok(dachNeigung_grad(rf) > FLACHDACH_BIS_GRAD, "2,5 m Firsthöhe über 4 m ist ein geneigtes Dach (≈ 32°), kein Flachdach");
    assert.equal(dachFirsthoehe_m({ points: RECHTECK }), 2.5, "ohne alles: 2,5 m");
  });

  it("neigung_grad führt, wenn gesetzt: die Firsthöhe folgt der Spannweite; firsthoehe_m führt sonst", () => {
    nah(dachFirsthoehe_m({ points: RECHTECK, neigung_grad: 45 }), 4, 1e-9);
    nah(dachNeigung_grad({ points: RECHTECK, neigung_grad: 20, firsthoehe_m: 9 }), 20);
    nah(dachFirsthoehe_m({ points: RECHTECK, firsthoehe_m: 1.2, pitch: 2.5 }), 1.2);
    nah(firsthoeheAusNeigung(RECHTECK, 30), 4 * Math.tan(Math.PI / 6), 1e-12);
    nah(firsthoeheAusNeigung(RECHTECK, 200), 4 * Math.tan((85 * Math.PI) / 180), 1e-9);
    assert.equal(dachNeigung_grad({ firsthoehe_m: 1 }), 0, "ohne Umriss keine Spannweite → 0 °");
  });

  it("dachMigrieren: nur pitch → firsthoehe_m dazu, pitch bleibt; schon getrennt → dasselbe Objekt", () => {
    const m = dachMigrieren(rf);
    assert.equal(m.firsthoehe_m, 2.5); assert.equal(m.pitch, 2.5); assert.equal(m.level, 1);
    assert.equal(dachHatGetrennteFelder(m), true); assert.equal(dachHatGetrennteFelder(rf), false);
    assert.equal(dachMigrieren(m), m);
  });

  it("D-BK-25: Altdach nur mit pitch hat dieselbe echte Neigung wie sein migriertes Gegenstück (Handrechnung: atan(2,5 / 4) = 32,005°)", () => {
    // 2,5 m ridge over 4 m half span: tan(32,005°) = 0,625 = 2,5 / 4. The old export read 2,5 as degrees.
    nah(dachNeigung_grad(rf), 32.0054, 1e-4);
    nah(dachNeigung_grad(dachMigrieren(rf)), dachNeigung_grad(rf), 1e-12);
    nah(dachNeigung_grad({ points: RECHTECK, neigung_grad: 5 }), 5);
    // 0,5 m over 4 m: atan(0,125) = 7,125° <= FLACHDACH_BIS_GRAD (flat); 0,8 m over 4 m: atan(0,2) = 11,310° (sloped)
    nah(dachNeigung_grad({ points: RECHTECK, pitch: 0.5 }), 7.125, 1e-3);
    assert.ok(dachNeigung_grad({ points: RECHTECK, pitch: 0.5 }) <= FLACHDACH_BIS_GRAD);
    nah(dachNeigung_grad({ points: RECHTECK, pitch: 0.8 }), 11.31, 1e-2);
    assert.ok(dachNeigung_grad({ points: RECHTECK, pitch: 0.8 }) > FLACHDACH_BIS_GRAD);
  });
});

describe("107-02 createBuildingModel: Geschosstabelle, Deckendicke und -bezug", () => {
  it("ohne Tabelle und mit Standardwerten: Objekte wie vorher (keine neuen Felder)", () => {
    const m = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });
    assert.deepEqual(m.slabs[0], { level: -1, elevation: 0, polygon: m.footprint });
    assert.deepEqual(m.slabs[1], { level: 0, elevation: 3, polygon: m.footprint });
    assert.deepEqual(m.storeys, [{ level: 0, elevation: 0, name: "EG" }, { level: 1, elevation: 3, name: "1. OG" }]);
    assert.equal(m.totalHeight, 6);
    assert.deepEqual(createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3, deckenDicke: 0.25, deckenBezug: "unten", geschosse: null }), m);
    assert.deepEqual(createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3, geschosse: [] }), m);
  });

  it("Tabelle: Höhe je Geschoss, kumulierte Elevation, Namen aus der Tabelle, Gesamthöhe, Attika auf der Oberkante", () => {
    const m = createBuildingModel({ footprintM: FP, storeys: 3, storeyHeight: 3, geschosse: [{ level: 0, name: "Erdgeschoss", hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }, { level: 2, hoehe_m: 2.8 }] });
    assert.deepEqual(m.storeys.map((s) => [s.name, s.elevation]), [["Erdgeschoss", 0], ["1. OG", 3.6], ["2. OG", 6.6]]);
    nah(m.totalHeight, 9.4);
    assert.deepEqual([...new Set(m.walls.map((w) => `${w.level}:${w.height}`))].sort(), ["0:3.6", "1:3", "2:2.8"]);
    assert.deepEqual(m.slabs.slice(0, 3).map((s) => Number(s.elevation.toFixed(6))), [0, 3.6, 6.6]);
    nah(m.slabs[3].elevation, 9.4);
    nah(m.parapets[0].elevation, 9.4);
  });

  it("deckenDicke und deckenBezug schreiben dicke_m / bezug an die Hüllplatten, nur wenn sie vom Standard abweichen", () => {
    const m = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3, deckenDicke: 0.3, deckenBezug: "oben" });
    assert.ok(m.slabs.every((s) => s.dicke_m === 0.3 && s.bezug === "oben"));
    const nurDicke = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3, deckenDicke: 0.2 });
    assert.ok(nurDicke.slabs.every((s) => s.dicke_m === 0.2 && !("bezug" in s)));
    const nurBezug = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3, deckenBezug: "oben" });
    assert.ok(nurBezug.slabs.every((s) => s.bezug === "oben" && !("dicke_m" in s)));
  });

  it("programMetrics: Gebäudehöhe aus der Tabelle, sonst storeys × Höhe", () => {
    assert.equal(programMetrics({ storeys: 3, storeyHeight: 3 }).height, 9);
    nah(programMetrics({ storeys: 3, storeyHeight: 3, geschosse: [{ level: 0, hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }, { level: 2, hoehe_m: 2.8 }] }).height, 9.4);
  });
});

describe("107-02 IFC: Höhen, Decken, Dächer, Geschosstabelle", () => {
  const basis = (/** @type {any} */ extra = {}, /** @type {any} */ modellOpt = {}) => {
    const model = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3, ...modellOpt });
    return { model, opt: { storeyHeight: 3, projectName: "t", customWalls: [], ...extra } };
  };

  it("Standardmodell: Text Zeichen für Zeichen gleich dem Golden von 107-01 (Decken, Dach, Stütze, Netz, Träger unverändert)", () => {
    const { model, ohne, mit } = ifcGoldenSzenario();
    assert.equal(exportIFC(model, ohne), lies("ifc-golden-107.ifc"));
    assert.equal(exportIFC(model, mit), lies("ifc-golden-107-steckbrief.ifc"));
  });

  it("Wand bis Geschoss: Geschosshöhe 3,0 → 3,2 macht die IFC-Wand 3,2 m hoch; die absolute Wand bleibt 3,0", () => {
    const walls = [wandGeschoss({ _idx: 1 }), wandGeschoss({ _idx: 2, oberkante_bezug: "absolut", a: { x: -2, z: 1 }, b: { x: 2, z: 1 } })];
    const hoehen = (/** @type {number} */ sh) => {
      const { model, opt } = basis({ customWalls: walls, storeyHeight: sh }, { storeyHeight: sh });
      const t = exportIFC(model, opt);
      // the drawn walls are the last two IFCWALLs of the file (hull walls come first)
      return wandzeilen(t).slice(-2).map((w) => tiefe(t, w.args));
    };
    assert.deepEqual(hoehen(3), [3, 3]);
    assert.deepEqual(hoehen(3.2), [3.2, 3]);
  });

  it("unterkante_versatz_m verschiebt die Wand im IFC um den Versatz; die Höhe der verknüpften Wand schrumpft um ihn", () => {
    const { model, opt } = basis({ customWalls: [wandGeschoss({ unterkante_versatz_m: 0.5, level: 1 })] });
    const t = exportIFC(model, opt);
    const w = wandzeilen(t).at(-1);
    nah(platzierungZ(t, platzierungRef(w.args)), 3.5);
    nah(tiefe(t, w.args), 2.5);
  });

  it("gezeichnete Decke: dicke_m und bezug bewegen Dicke und Höhenlage; Standard 0,22 oben", () => {
    const decke = (/** @type {any} */ extra) => {
      const { model, opt } = basis({ customSlabs: [{ points: RECHTECK, level: 1, _idx: 9, ...extra }] });
      const t = exportIFC(model, opt);
      const s = zeilenVon(t, "IFCSLAB").at(-1);
      return { z: platzierungZ(t, platzierungRef(s.args)), d: tiefe(t, s.args) };
    };
    let r = decke({}); nah(r.z, 6 - 0.22); nah(r.d, 0.22);
    r = decke({ dicke_m: 0.3 }); nah(r.z, 5.7); nah(r.d, 0.3);
    r = decke({ dicke_m: 0.3, bezug: "unten" }); nah(r.z, 6); nah(r.d, 0.3);
  });

  it("Hüllplatte mit deckenDicke/deckenBezug: Dicke und Lage im IFC; Standard 0,25 auf der Ebene", () => {
    const platten = (/** @type {any} */ mo) => {
      const { model, opt } = basis({}, mo);
      const t = exportIFC(model, opt);
      return zeilenVon(t, "IFCSLAB").map((s) => ({ z: platzierungZ(t, platzierungRef(s.args)), d: tiefe(t, s.args) }));
    };
    const std = platten({});
    assert.deepEqual(std.map((p) => [p.z, p.d]), [[0, 0.25], [3, 0.25], [6, 0.25]]);
    const oben = platten({ deckenDicke: 0.3, deckenBezug: "oben" });
    assert.deepEqual(oben.map((p) => [Number(p.z.toFixed(4)), p.d]), [[-0.3, 0.3], [2.7, 0.3], [5.7, 0.3]]);
  });

  it("Dach: Klasse nach der echten Neigung, auch beim Altdach nur mit pitch (D-BK-25); Neigung im Datenblatt", () => {
    const roof = (/** @type {any} */ rf) => {
      const { model, opt } = basis({ customRoofs: [{ points: RECHTECK, level: 1, _idx: 10, ...rf }], steckbrief: { projektId: "p" } });
      const t = exportIFC(model, opt);
      const z = zeilenVon(t, "IFCROOF")[0];
      const neigung = /'Neigung',\$,IFCREAL\(([-\d.]+)\)/.exec(t)?.[1];
      return { typ: /\.([A-Z_]+_ROOF)\.$/.exec(z.args)?.[1], neigung: Number(neigung) };
    };
    // D-BK-25: the old field `pitch` is a ridge rise in metres. 2,5 m over the 4 m half span: atan(0,625) = 32,0054° -> pitched (before: 2,5 read as degrees -> flat)
    assert.deepEqual(roof({ pitch: 2.5 }), { typ: "GABLE_ROOF", neigung: 32.0054 }, "Altdach nur mit pitch: echte Neigung, geneigt");
    // 0,5 m over 4 m: atan(0,125) = 7,1250° <= 10° -> flat, and the sheet shows the degrees, not the metres
    assert.deepEqual(roof({ pitch: 0.5 }), { typ: "FLAT_ROOF", neigung: 7.125 }, "flache Altdach-Neigung in Grad, nicht 0,5");
    const neu = roof({ pitch: 2.5, firsthoehe_m: 2.5 });
    assert.notEqual(neu.typ, "FLAT_ROOF", "2,5 m Firsthöhe über 4 m halber Spannweite ist geneigt");
    nah(neu.neigung, Number(((Math.atan2(2.5, 4) * 180) / Math.PI).toFixed(4)), 1e-9);
    assert.equal(roof({ neigung_grad: 4 }).typ, "FLAT_ROOF");
    assert.notEqual(roof({ neigung_grad: 25 }).typ, "FLAT_ROOF");
  });

  it("Dach: dicke_m/bezug am Dach; Standard 0,2 auf der Traufe (Ebene darüber)", () => {
    const lage = (/** @type {any} */ extra) => {
      const { model, opt } = basis({ customRoofs: [{ points: RECHTECK, level: 1, _idx: 10, ...extra }] });
      const t = exportIFC(model, opt);
      const z = zeilenVon(t, "IFCROOF")[0];
      return { z: platzierungZ(t, platzierungRef(z.args)), d: tiefe(t, z.args) };
    };
    assert.deepEqual(lage({}), { z: 6, d: 0.2 });
    const o = lage({ dicke_m: 0.25, bezug: "oben" }); nah(o.z, 5.75); nah(o.d, 0.25);
  });

  it("unbekannter Level erzeugt eine onWarn-Meldung (einmal je Level), das Element landet im ersten Geschoss; bekannter und fehlender Level nicht", () => {
    const meldungen = [];
    const { model, opt } = basis({ customColumns: [{ x: 0, z: 0, level: 7, size: 0.4, _idx: 1 }, { x: 1, z: 0, level: 7, size: 0.4, _idx: 2 }, { x: 2, z: 0, level: 1, size: 0.4, _idx: 3 }, { x: 3, z: 0, size: 0.4, _idx: 4 }], onWarn: (m, art, daten) => meldungen.push({ m, art, daten }) });
    const t = exportIFC(model, opt);
    assert.equal(meldungen.length, 1);
    assert.match(meldungen[0].m, /Geschoss 7/);
    assert.match(meldungen[0].m, /EG/);
    // the studio tells the kind by the structured argument, not by the wording
    assert.equal(meldungen[0].art, WARNART_GESCHOSS);
    assert.deepEqual(meldungen[0].daten, { level: 7, ziel: "EG" });
    assert.equal(zeilenVon(t, "IFCCOLUMN").length, 4, "nichts geht verloren");
    // a fully known model warns about nothing
    const ruhig = [];
    const b = basis({ customColumns: [{ x: 0, z: 0, level: 1, size: 0.4, _idx: 1 }], onWarn: (m) => ruhig.push(m) });
    exportIFC(b.model, b.opt);
    assert.deepEqual(ruhig, []);
  });

  it("Geschosstabelle: Stütze, Wand und Raum je Geschoss in der eigenen Höhe, Platzierung auf der kumulierten Elevation", () => {
    const tab = [{ level: 0, hoehe_m: 3.5 }, { level: 1, hoehe_m: 2.8 }];
    const { model, opt } = basis({
      geschosse: tab, storeyHeight: 3,
      customColumns: [{ x: 0, z: 0, level: 0, size: 0.4, _idx: 1 }, { x: 1, z: 0, level: 1, size: 0.4, _idx: 2 }],
      customWalls: [wandGeschoss({ level: 1, _idx: 3 })],
      customZones: [{ points: RECHTECK, level: 1, name: "Z", _idx: 5 }],
    }, { geschosse: tab });
    const t = exportIFC(model, opt);
    const sp = zeilenVon(t, "IFCCOLUMN").map((c) => [platzierungZ(t, platzierungRef(c.args)), tiefe(t, c.args)]);
    assert.deepEqual(sp.map(([z, h]) => [Number(z.toFixed(4)), h]), [[0, 3.5], [3.5, 2.8]]);
    const w = wandzeilen(t).at(-1);
    nah(platzierungZ(t, platzierungRef(w.args)), 3.5); nah(tiefe(t, w.args), 2.8, 1e-9);
    const raum = zeilenVon(t, "IFCSPACE").find((r) => /'Z'/.test(r.args));
    nah(tiefe(t, raum.args), 2.8 * 0.98, 1e-4);
    // IFCBUILDINGSTOREY elevations come from the model (cumulated)
    assert.deepEqual(zeilenVon(t, "IFCBUILDINGSTOREY").map((s) => Number(/\.ELEMENT\.,([-\d.]+)$/.exec(s.args)[1])), [0, 3.5]);
  });
});

describe("107-02 weitere Leser: Werkstattwände, Menge, Eckpfeiler, Auswahl, Prüfbox", () => {
  it("Werkstattwände: ohne Tabelle eine Höhe, mit Tabelle die Höhe des eigenen Geschosses", () => {
    const zonen = [0, 1].flatMap((level) => [
      { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], level, name: `A${level} ·WT`, we: "1", raumart: "Wohnen" },
    ]);
    const hoehen = (/** @type {any} */ o) => [...new Set(werkstattBauteile(zonen, o).waende.map((w) => `${w.level}:${w.hoehe_m}`))].sort();
    assert.deepEqual(hoehen({ storeyHeight: 3 }), ["0:3", "1:3"]);
    assert.deepEqual(hoehen({ storeyHeight: 3, geschosse: [{ level: 0, hoehe_m: 3.4 }, { level: 1, hoehe_m: 2.7 }] }), ["0:3.4", "1:2.7"]);
  });

  it("Menge der Wand: verknüpfte Wand rechnet mit der abgeleiteten Höhe (Länge × Höhe), fest mit height", () => {
    const typ = BAUTEIL_TYPEN["wand-innen"] || Object.values(BAUTEIL_TYPEN).find((t) => t.einheit === "m2");
    assert.equal(mengeVon(typ, wandGeschoss(), { storeyHeight: 3 }).wert, 12);
    assert.equal(mengeVon(typ, wandGeschoss(), { storeyHeight: 3.2 }).wert, 12.8);
    assert.equal(mengeVon(typ, wandGeschoss({ oberkante_bezug: "absolut" }), { storeyHeight: 3.2 }).wert, 12);
    assert.equal(mengeVon(typ, wandGeschoss({ level: 1 }), { geschosse: [{ level: 0, hoehe_m: 3 }, { level: 1, hoehe_m: 2.5 }] }).wert, 10);
  });

  it("Eckpfeiler: Höhe der höchsten Wand über wandHoehe, Unterkante der tiefsten; ohne Angabe wie früher 3 m", () => {
    const walls = [
      wandGeschoss({ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, _idx: 1, height: undefined }),
      wandGeschoss({ a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, _idx: 2, height: undefined }),
    ];
    const f = eckfueller(walls, undefined, 3.2)[0];
    assert.equal(f.hoehe_m, 3.2); assert.equal(f.unterkante_m, 0);
    assert.equal(eckfueller([{ a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, _idx: 1, level: 0 }, { a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, _idx: 2, level: 0 }])[0].hoehe_m, 3);
  });

  it("Auswahl: Mittelpunkt der Wand liegt auf halber abgeleiteter Höhe über der Unterkante, mit Tabelle auf der kumulierten Elevation", () => {
    const w = wandGeschoss({ level: 1, _idx: 7 });
    const daten = { customWalls: [w], model: createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 }), storeyHeight: 3 };
    nah(bimBauteil({ type: "wall", index: 7 }, daten).mittelpunkt[1], 3 + 1.5);
    const tab = [{ level: 0, hoehe_m: 3.5 }, { level: 1, hoehe_m: 2.8 }];
    nah(bimBauteil({ type: "wall", index: 7 }, { ...daten, geschosse: tab }).mittelpunkt[1], 3.5 + 1.4);
  });

  it("Plan und PDF: Hüllplatte mit dicke_m/bezug erscheint dort mit derselben Dicke (Schnitt)", () => {
    const m = createBuildingModel({ footprintM: FP, storeys: 1, storeyHeight: 3, deckenDicke: 0.4, deckenBezug: "oben" });
    const g = schnittGrafik({ model: m, storeyHeight: 3 });
    const decken = g.elemente.filter((e) => e.ebene === "decke");
    // each slab polygon spans 0.4 m in height (z = −height in the section primitives)
    for (const d of decken) { const zs = d.pts.map((p) => p.z); nah(Math.max(...zs) - Math.min(...zs), 0.4, 1e-9); }
    assert.ok(decken.length === 2);
  });
});

describe("107-02 Mengen (AVA-Pfad classifiedElements): Wandhöhe, Stützen, Deckendicke, Hülle", () => {
  const mengen = (/** @type {any[]} */ els, /** @type {string} */ idp) => els.find((e) => String(e.id).startsWith(idp)).mengen;
  it("verknüpfte Wand: Fläche = Länge × abgeleitete Höhe; absolute und alte Wand bleiben bei height", () => {
    const rec = (sh) => ({ storeyHeight: sh, storeys: 2, customWalls: [wandGeschoss({ _idx: 1 }), wandGeschoss({ _idx: 2, oberkante_bezug: "absolut", a: { x: 0, z: 5 }, b: { x: 4, z: 5 } }), { a: { x: 0, z: 8 }, b: { x: 4, z: 8 }, level: 0, thickness: 0.3, _idx: 3 }] });
    const a = classifiedElements(rec(3)), b = classifiedElements(rec(3.2));
    nah(mengen(a, "wall-1").area, 12); nah(mengen(b, "wall-1").area, 12.8);
    nah(mengen(b, "wall-2").area, 12, 1e-9);
    nah(mengen(b, "wall-3").area, 12.8, 1e-9); // an old wall without height has always followed the storey height
  });
  it("Geschosstabelle: Wand im Obergeschoss, Stütze und Hülle mit der Höhe ihres Geschosses", () => {
    const rec = { storeyHeight: 3, storeys: 2, geschosse: [{ level: 0, hoehe_m: 3.5 }, { level: 1, hoehe_m: 2.5 }], customWalls: [wandGeschoss({ level: 1, height: undefined })], customColumns: [{ x: 0, z: 0, level: 1, size: 0.4, _idx: 4 }] };
    const els = classifiedElements(rec);
    nah(mengen(els, "wall-1").area, 4 * 2.5); nah(mengen(els, "column-4").length, 2.5);
    const hull = synthHull(rec).find((e) => e.id === "hull-wall");
    nah(hull.mengen.area, hull.mengen.length / 2 * 6, 1e-6); // perimeter × (3,5 + 2,5)
  });
  it("Deckendicke: dicke_m bestimmt das Volumen der gezeichneten Decke, ohne Feld bleibt 0,25 (AVA-Annahme)", () => {
    const decke = (extra) => ({ points: RECHTECK, level: 0, _idx: 9, ...extra });
    const flaeche = 10 * 8;
    nah(mengen(classifiedElements({ customSlabs: [decke({})] }), "slab-9").volume, flaeche * 0.25);
    nah(mengen(classifiedElements({ customSlabs: [decke({ dicke_m: 0.3 })] }), "slab-9").volume, flaeche * 0.3);
  });
});

describe("107-02 Review-Fixes: ein Schreiber für die Geschosshöhe, OKF, Schnittmaß, Dach 0°, Massing-Körper", () => {
  it("patchAlleGeschosshoehen: setzt storeyHeight und, mit Tabelle, jede Zeile; ohne Tabelle nur die Zahl", () => {
    assert.deepEqual(patchAlleGeschosshoehen({ geschosse: null }, 3.2), { storeyHeight: 3.2 });
    const p = patchAlleGeschosshoehen({ geschosse: [{ level: 0, name: "EG", hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }] }, 3.2);
    assert.equal(p.storeyHeight, 3.2);
    assert.deepEqual(p.geschosse.map((g) => g.hoehe_m), [3.2, 3.2]);
    assert.equal(p.geschosse[0].name, "EG", "Namen bleiben");
  });

  it("patchGeschosshoehe: erste Eingabe erzeugt die Tabelle; ein Geschoss ohne Zeile (Geschosszahl erhöht) bekommt eine neue Zeile statt zu verpuffen", () => {
    const p1 = patchGeschosshoehe({ storeys: 3, storeyHeight: 3 }, 1, 3.4);
    assert.deepEqual(p1.geschosse.map((g) => [g.level, g.hoehe_m]), [[0, 3], [1, 3.4], [2, 3]]);
    // 3 Geschosse -> Tabelle -> Geschosszahl auf 4 -> Geschoss 3 bearbeiten
    const tabelle = p1.geschosse;
    const p2 = patchGeschosshoehe({ storeys: 4, storeyHeight: 3, geschosse: tabelle }, 3, 3.8);
    assert.deepEqual(p2.geschosse.map((g) => [g.level, g.hoehe_m]), [[0, 3], [1, 3.4], [2, 3], [3, 3.8]]);
    assert.equal(p2.geschosse[3].name, "3. OG");
    nah(elevationOf(4, p2.geschosse), 3 + 3.4 + 3 + 3.8, 1e-9);
    assert.equal(patchGeschosshoehe({ storeys: 3, storeyHeight: 3 }, 1, 0), null, "keine Höhe > 0 -> nichts schreiben");
    assert.equal(patchGeschosshoehe({ storeys: 3, storeyHeight: 3 }, 1, NaN), null);
  });

  it("Store: setAlleGeschosshoehen (Massing-Schieber) hält Zahl und Tabelle gleich; setGeschosshoehe legt eine fehlende Zeile an", () => {
    const vorher = buildingProgram.get();
    try {
      buildingProgram.set({ storeys: 3, storeyHeight: 3, geschosse: [{ level: 0, name: "EG", hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }, { level: 2, hoehe_m: 3 }] });
      buildingProgram.setAlleGeschosshoehen(3.2);
      assert.equal(buildingProgram.get().storeyHeight, 3.2);
      assert.deepEqual(buildingProgram.get().geschosse.map((g) => g.hoehe_m), [3.2, 3.2, 3.2], "Schieber ändert auch die Tabelle");
      nah(programMetrics(buildingProgram.get()).height, 9.6);
      buildingProgram.set({ storeys: 4 });
      buildingProgram.setGeschosshoehe(3, 3.5);
      assert.equal(buildingProgram.get().geschosse.length, 4);
      nah(programMetrics(buildingProgram.get()).height, 3.2 * 3 + 3.5);
      buildingProgram.setAlleGeschosshoehen(0); // ignored
      assert.equal(buildingProgram.get().storeyHeight, 3.2);
    } finally { buildingProgram.set({ storeys: vorher.storeys, storeyHeight: vorher.storeyHeight, geschosse: vorher.geschosse }); }
  });

  it("OKF des obersten Geschosses: Elevation aus der Tabelle (Brandschutz 22-m-Grenze), ohne Tabelle (storeys - 1) x Höhe wie vorher", () => {
    nah(okfObersterGeschoss(4, 3), 9);
    nah(okfObersterGeschoss(1, 3), 0);
    nah(okfObersterGeschoss(0, 3), 0, 1e-12);
    const tab = [{ level: 0, hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }, { level: 2, hoehe_m: 3 }];
    nah(okfObersterGeschoss(3, tab), 6.6); // the old inline code said (3 - 1) x 3 = 6.0
    const pm = programMetrics({ storeys: 3, storeyHeight: 3, geschosse: tab, footprintM: null });
    nah(pm.okf_m, 6.6); nah(pm.height, 9.6);
    nah(programMetrics({ storeys: 3, storeyHeight: 3 }).okf_m, 6);
  });

  it("Schnitt (PDF): die Geschosshöhen-Maßlinie zeigt die Höhe des EG aus dem Modell, mit Tabelle 3,60 neben der Kote +3,60 (nicht 3,00)", () => {
    const text = (/** @type {any} */ model, sh = 3) => schnittGrafik({ model, storeyHeight: sh }).elemente.filter((e) => e.ebene === "bemassung" && e.art === "text").map((e) => e.text);
    const mit = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3, geschosse: [{ level: 0, hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }] });
    assert.ok(text(mit).includes("3,60"), `Maßtexte: ${text(mit)}`);
    assert.ok(!text(mit).includes("3,00"));
    const koten = schnittGrafik({ model: mit, storeyHeight: 3 }).elemente.filter((e) => e.ebene === "kote" && e.art === "text").map((e) => e.text);
    assert.ok(koten.some((k) => k.includes("+3,60")), `Koten: ${koten}`);
    // without a table the figure is the uniform storey height as always
    const ohne = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3.2 });
    assert.ok(text(ohne, 3.2).includes("3,20"));
    nah(geschossHoeheAusModell(mit), 3.6); nah(geschossHoeheAusModell(mit, 1), 3);
    assert.equal(geschossHoeheAusModell(mit, 5), 0); assert.equal(geschossHoeheAusModell(null), 0);
  });

  it("Dach 0°: Firsthöhe 0 (flach), nicht 2,5 m; Neigung über 85° wird auf 85° begrenzt (Datenblatt = 3D)", () => {
    const flach = { points: RECHTECK, level: 0, neigung_grad: 0 };
    assert.equal(dachFirsthoehe_m(flach), 0);
    assert.equal(dachNeigung_grad(flach), 0);
    assert.equal(dachFirsthoehe_m({ points: RECHTECK, level: 0, firsthoehe_m: 0 }), 0);
    assert.equal(dachFirsthoehe_m({ points: RECHTECK }), 2.5, "ohne jedes Feld bleibt der Standard 2,5 m (der 3D-Rückfall `|| 2,5` ist überflüssig und falsch)");
    assert.equal(MAX_NEIGUNG_GRAD, 85);
    assert.equal(dachNeigung_grad({ points: RECHTECK, neigung_grad: 90 }), 85);
    nah(dachFirsthoehe_m({ points: RECHTECK, neigung_grad: 90 }), 4 * Math.tan((85 * Math.PI) / 180), 1e-9);
  });

  it("ausEinzelkoerper: mit Tabelle so hoch wie die Summe der Geschosse (= model.totalHeight), ohne Tabelle storeys x Höhe", () => {
    const tab = [{ level: 0, hoehe_m: 3.6 }, { level: 1, hoehe_m: 3 }];
    const mit = ausEinzelkoerper(FP, 2, 3, tab), ohne = ausEinzelkoerper(FP, 2, 3);
    nah(mit.koerper[0].hoehe, 6.6); nah(ohne.koerper[0].hoehe, 6);
    nah(mit.koerper[0].hoehe, createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3, geschosse: tab }).totalHeight);
  });

  it("AVA-Pfad: Werkstattwände rechnen mit der Tabelle wie Studio und IFC; Zone mit Oberkantenverknüpfung rechnet mit der verknüpften Höhe", () => {
    const zonen = [0, 1].flatMap((level) => [
      { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], level, name: `A${level} ·WT`, we: "1", raumart: "Wohnen" },
      { points: [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }], level, name: `B${level} ·WT`, we: "1", raumart: "Schlafen" },
    ]);
    const tab = [{ level: 0, hoehe_m: 3.4 }, { level: 1, hoehe_m: 2.7 }];
    const flaecheAva = (/** @type {any} */ rec) => classifiedElements(rec, undefined, { werkstattZonen: zonen }).filter((e) => String(e.id).startsWith("wt-wall-")).reduce((a, e) => a + e.mengen.area, 0);
    const erwartet = (/** @type {any} */ o) => werkstattBauteile(zonen, o).waende.filter((w) => !w.huelle).reduce((a, w) => a + w.flaeche_m2, 0);
    assert.ok(erwartet({ storeyHeight: 3 }) > 0, "es gibt Innenwände");
    nah(flaecheAva({ storeyHeight: 3, storeys: 2 }), erwartet({ storeyHeight: 3 }), 1e-9);
    nah(flaecheAva({ storeyHeight: 3, storeys: 2, geschosse: tab }), erwartet({ storeyHeight: 3, geschosse: tab }), 1e-9);
    assert.ok(Math.abs(flaecheAva({ storeyHeight: 3, storeys: 2, geschosse: tab }) - flaecheAva({ storeyHeight: 3, storeys: 2 })) > 0.1, "die Tabelle ändert das Ergebnis");
    // zone volume
    const vol = (/** @type {any} */ z, rec = {}) => classifiedElements({ storeyHeight: 3, storeys: 2, customZones: [{ points: RECHTECK, level: 0, _idx: 1, ...z }], ...rec }).find((e) => e.id === "zone-1").mengen.volume;
    nah(vol({}), 80 * 3);
    nah(vol({ oberkante_bezug: "geschoss", oberkante_versatz_m: -0.3 }), 80 * 2.7);
    nah(vol({ oberkante_bezug: "geschoss", oberkante_geschosse: 2 }), 80 * 6);
  });
});

describe("107-02 Wächter: keine eigene Multiplikation Geschossindex × Geschosshöhe im ganzen Quellbaum außer hoehen.js", () => {
  /** source without comments: a mention in a comment is no multiplication */
  const ohneKommentare = (/** @type {string} */ q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  // `level * storeyHeight`, `(… + 1) * storeyHeight`, `lvl * sh`, `(pm.storeys - 1) * pm.storeyHeight`, `i * floorH`, `(storeys - 1) * (store.storeyHeight || 3)`,
  // and the swapped order `storeyHeight * level` — but not `storeyHeight * 0.98` (room height) or BoxGeometry(s, storeyHeight, s).
  const HOEHE = /(?:\w+\.)?(?:storeyHeight|sh|gh|floorH|geschosshoehe_m)/.source;
  const MUSTER_A = new RegExp(/(?:\blevel|\blvl|\bl|\bi|\bidx|\))\s*\*\s*\(?\s*/.source + HOEHE + /\b/.source, "g");
  const MUSTER_B = new RegExp(HOEHE + /\s*\*\s*\(?\s*(?:level|lvl|idx|i\b|\(?\s*(?:\w+\.)?storeys)/.source, "g");
  const treffer = (/** @type {string} */ quelle) => [...(quelle.match(MUSTER_A) || []), ...(quelle.match(MUSTER_B) || [])];

  /** @param {string} dir absolute @returns {string[]} */
  const dateienUnter = (dir) => readdirSync(dir).flatMap((n) => {
    if (n === "node_modules") return [];
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return dateienUnter(p);
    return /\.(jsx?|mjs)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
  const wurzel = fileURLToPath(new URL("../../", import.meta.url));
  const alle = ["packages", "src"].flatMap((d) => dateienUnter(join(wurzel, d))).map((p) => relative(wurzel, p).split(sep).join("/"));

  // Known remaining readers, each with the reason why it stays on ONE height. Not a hole: the test fails when an entry has no hit any more
  // (stale), and every other file must have none.
  /** @type {Record<string, string>} */
  const AUSNAHMEN = {
    "packages/nova-core/src/lib/buildingModel.js": "uniform-height path of createBuildingModel (the old arithmetic, kept byte-identical; with a table the same function uses elevationOf)",
    "packages/nova-designer/src/components/MassingView3D.jsx": "Massing-Studio focus overlay: that studio has ONE floor height (its own slider, which now writes all table rows too)",
    "packages/nova-ifc-viewer/src/components/BimModelViewer.jsx": "generic viewer of a plain storey height, not the programme",
    "packages/nova-ifc-viewer/src/lib/interop.js": "legacy toIfcText (switched off, not part of 107)",
    "src/components/reports/Drawings.jsx": "report sketch with one floor height",
    "src/components/site/ARSiteView.jsx": "AR site preview with one floor height",
  };

  it("der Quellbaum wird wirklich gelesen (nicht nur neun feste Dateien)", () => {
    assert.ok(alle.length > 300, `nur ${alle.length} Dateien gefunden`);
    for (const d of ["packages/nova-designer/src/lib/ifcExport.js", "packages/nova-designer/src/components/BrandschutzPlanner.jsx", "packages/nova-designer/src/components/MassingStudio.jsx", "packages/nova-core/src/lib/werkstattBauteile.js"]) assert.ok(alle.includes(d), d);
  });

  it("keine Datei außer hoehen.js und der Ausnahmeliste multipliziert einen Geschossindex mit einer Höhe", () => {
    const offen = [];
    for (const d of alle) {
      if (d === "packages/nova-core/src/lib/bauteil/hoehen.js" || d in AUSNAHMEN) continue;
      const t = treffer(ohneKommentare(readFileSync(join(wurzel, d), "utf8")));
      if (t.length) offen.push(`${d}: ${JSON.stringify(t)}`);
    }
    assert.deepEqual(offen, [], "noch eine eigene Multiplikation (durch hoehen.js ersetzen oder mit Grund in AUSNAHMEN eintragen)");
  });

  it("jede Ausnahme trifft noch (sonst ist der Eintrag veraltet)", () => {
    for (const d of Object.keys(AUSNAHMEN)) assert.ok(treffer(ohneKommentare(readFileSync(join(wurzel, d), "utf8"))).length > 0, `${d} hat keinen Treffer mehr, Eintrag streichen`);
  });

  it("das Muster erkennt die alten und die erweiterten Schreibweisen (Gegenprobe, sonst wäre der Wächter blind)", () => {
    for (const alt of ["(c.level || 0) * storeyHeight", "w.level * storeyHeight", "(t.level + 1) * storeyHeight", "lvl * sh", "(pm.storeys - 1) * pm.storeyHeight",
      "i * floorH", "(Math.max(1, n) - 1) * (store.storeyHeight || 3)", "storeyHeight * level", "lvl * gh"]) {
      assert.ok(treffer(alt).length > 0, alt);
    }
    for (const ok of ["storeyHeight * 0.98", "new THREE.BoxGeometry(s, storeyHeight, s)", "geschosshoehe(x, gs) * 0.98", "pm.okf_m * 10", "elevationOf(level, gs)"]) {
      assert.equal(treffer(ok).length, 0, ok);
    }
  });
});
