// 107-13 (D-BK-20, D-P61-09 lifted): basements as model storeys. Covers the model golden (no basement = byte-identical), the
// appended basement entries, bauteil/ebenen.js, no rule windows below ground, the synthetic hull, column loads and the riser
// diagram on level −1, the IFC export (negative storey, containment, base slab vs. basement ceiling with distinct GlobalIds,
// a second golden), the selection of hull slabs, the vector section with basement, the plan model dependency and hoehen.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createBuildingModel, UG_AUFBAU_STANDARD } from "@core/lib/buildingModel";
import {
  untergeschosseAnzahl, geschossName, geschossLabel, ebenenListe, ebenenGrenzen, ebeneKlemmen, untersterLevel, istBodenplatte,
  huellPlattenId, ebeneName, oberirdischeGeschosse, MAX_UNTERGESCHOSSE,
} from "@core/lib/bauteil/ebenen.js";
import { elevationOf, geschossHoeheAusModell } from "@core/lib/bauteil/hoehen.js";
import { ugSchnittWaende } from "@core/lib/bauteil/referenz.js";
import { synthHull } from "@core/lib/bimClassification.js";
import { autoEnvOpenings } from "@designer/lib/autoOpenings";
import { exportIFC } from "@designer/lib/ifcExport";
import { bimBauteil, bimAlle } from "@designer/lib/auswahlBim.js";
import { schnittGrafik } from "@designer/lib/vektorPlan";
import { stuetzenBerechnung } from "@designer/lib/tragwerkPlan";
import { strangschema, neuerKnoten, neueKante } from "@designer/lib/tgaNetz";
import { planModellBauen, planModellAbhaengigkeiten } from "@designer/lib/usePlanModel";
import { parseIfcText } from "@ifc/lib/interop";
import { dxfDateiname } from "@designer/lib/dxfPlaene";
import { ifcUgSzenario } from "./fixtures/ifcUgModell-10713.js";

const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const GOLDEN = JSON.parse(lies("gebaeudemodell-golden-107-13.json"));
const L = [{ x: -8, z: -6 }, { x: 8, z: -6 }, { x: 8, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 6 }, { x: -8, z: 6 }];
const EINGABE_A = { storeys: 4, storeyHeight: 3 };
const EINGABE_B = { footprintM: L, storeys: 3, storeyHeight: 3, wallComposite: "cavity", parapet: { enabled: true, height: 1.0 } };
const zeilen = (/** @type {string} */ ifc, /** @type {string} */ typ) => ifc.split("\n").filter((l) => l.includes(`=${typ}(`));
const idVon = (/** @type {string} */ l) => l.split("=")[0];
const guidVon = (/** @type {string} */ l) => l.split("(")[1].split(",")[0];

describe("107-13 Modell-Golden: ohne Untergeschosse Zeichen für Zeichen gleich", () => {
  it("Standardfootprint, 4 Geschosse", () => assert.equal(JSON.stringify(createBuildingModel(EINGABE_A)), GOLDEN.standard));
  it("L-Footprint, 3 Geschosse, Aufbau cavity, Attika", () => assert.equal(JSON.stringify(createBuildingModel(EINGABE_B)), GOLDEN.lform));
  it("untergeschosse 0 ist dasselbe wie ohne Feld", () => assert.equal(JSON.stringify(createBuildingModel({ ...EINGABE_A, untergeschosse: 0 })), GOLDEN.standard));
});

describe("107-13 Modell mit Untergeschossen", () => {
  for (const U of [1, 2]) {
    it(`U = ${U}: Einträge für level >= 0 gleich dem Golden, UG hinten angehängt`, () => {
      const alt = JSON.parse(GOLDEN.standard);
      const m = createBuildingModel({ ...EINGABE_A, untergeschosse: U });
      const oben = (/** @type {any[]} */ l) => l.filter((x) => x.level >= 0);
      assert.deepEqual(oben(m.storeys), alt.storeys);
      assert.deepEqual(oben(m.walls), alt.walls);
      assert.deepEqual(oben(m.spaces), alt.spaces);
      assert.deepEqual(oben(m.slabs), oben(alt.slabs));
      assert.deepEqual(m.parapets, alt.parapets);
      assert.equal(m.totalHeight, alt.totalHeight);
      assert.equal(m.walls[0].level, 0, "walls[0] bleibt die Fassade des EG");
      assert.equal(m.storeys[4].level, -1, "storeys[n] ist das 1. UG");
      assert.equal(m.storeys.length, 4 + U);
      assert.equal(m.untergeschosse, U);
      assert.equal(m.fusshoehe_m, -3 * U);
      // base slab: first, level −(U+1), id "-1", at the foot level
      assert.deepEqual([m.slabs[0].level, m.slabs[0].id, m.slabs[0].elevation, m.slabs[0].unterirdisch], [-(U + 1), "-1", -3 * U, true]);
      const decke1 = m.slabs.find((s) => s.level === -1);
      assert.deepEqual([decke1.id, decke1.elevation, decke1.unterirdisch], ["ug-1", 0, true]);
      for (const s of m.slabs.filter((x) => x.level < 0)) assert.equal(s.unterirdisch, true);
      assert.equal(m.slabs.filter((s) => istBodenplatte(m, s)).length, 1, "genau eine Bodenplatte");
      assert.ok(istBodenplatte(m, m.slabs[0]));
      // basement walls: build-up single24 (0.24 m), no rule windows
      const ugWaende = m.walls.filter((w) => w.level < 0);
      assert.equal(ugWaende.length, 4 * U);
      for (const w of ugWaende) assert.deepEqual([w.composite, w.thickness, w.unterirdisch], [UG_AUFBAU_STANDARD, 0.24, true]);
    });
  }
  it("Namen „1. UG“/„2. UG“ fest, Elevationen −3 und −6", () => {
    const m1 = createBuildingModel({ ...EINGABE_A, untergeschosse: 1 });
    const m2 = createBuildingModel({ ...EINGABE_A, untergeschosse: 2 });
    assert.equal(m1.storeys.find((s) => s.level === -1).name, "1. UG");
    assert.equal(m2.storeys.find((s) => s.level === -1).name, "1. UG");
    assert.equal(m2.storeys.find((s) => s.level === -2).name, "2. UG");
    assert.deepEqual(m2.storeys.filter((s) => s.level < 0).map((s) => s.elevation), [-3, -6]);
  });
  it("Obergrenze 3 [ASSUMED], Unsinn = 0", () => {
    assert.equal(createBuildingModel({ ...EINGABE_A, untergeschosse: 9 }).untergeschosse, MAX_UNTERGESCHOSSE);
    assert.equal(createBuildingModel({ ...EINGABE_A, untergeschosse: -2 }).untergeschosse, undefined);
    assert.equal(JSON.stringify(createBuildingModel({ ...EINGABE_A, untergeschosse: /** @type {any} */ ("x") })), GOLDEN.standard);
  });
  it("Geschosstabelle mit eigener UG-Zeile: Name und Höhe aus der Tabelle", () => {
    const geschosse = [{ level: -1, name: "Keller", hoehe_m: 2.6 }, { level: 0, hoehe_m: 3 }, { level: 1, hoehe_m: 3 }];
    const m = createBuildingModel({ storeys: 2, geschosse, untergeschosse: 1 });
    const ug = m.storeys.find((s) => s.level === -1);
    assert.deepEqual([ug.name, ug.elevation], ["Keller", -2.6]);
    assert.equal(m.fusshoehe_m, -2.6);
    assert.equal(m.slabs.find((s) => s.level === -1).elevation, 0, "Kellerdecke auf ±0,00");
  });
});

describe("107-13 bauteil/ebenen.js", () => {
  const m = createBuildingModel({ storeys: 3, untergeschosse: 2 });
  it("Anzahl, Namen und Label", () => {
    assert.deepEqual([0, 1, 2, 3, 4, -1, 1.6, "2", null].map(untergeschosseAnzahl), [0, 1, 2, 3, 3, 0, 2, 2, 0]);
    assert.deepEqual([0, 1, 3, -1, -2].map(geschossName), ["EG", "1. OG", "3. OG", "1. UG", "2. UG"]);
    const t = (/** @type {string} */ k) => ({ EG: "GF", OG: "UF", UG: "B" })[k] || k;
    assert.deepEqual([0, 2, -1].map((l) => geschossLabel(l, t)), ["GF", "2. UF", "1. B"]);
    assert.equal(geschossLabel(-3), "3. UG");
  });
  it("Liste aufsteigend, Grenzen, Klemme, unterster Level, Name je Level", () => {
    assert.deepEqual(ebenenListe(m).map((e) => [e.level, e.name, e.unterirdisch]), [[-2, "2. UG", true], [-1, "1. UG", true], [0, "EG", false], [1, "1. OG", false], [2, "2. OG", false]]);
    assert.deepEqual(ebenenGrenzen(m), { min: -2, max: 2 });
    assert.deepEqual([-5, -2, 0, 2, 7].map((l) => ebeneKlemmen(m, l)), [-2, -2, 0, 2, 2]);
    assert.equal(ebeneKlemmen(null, -1), -1, "ohne Modell unverändert");
    const ohne = createBuildingModel({ storeys: 3 });
    assert.equal(ebeneKlemmen(ohne, -1), 0, "gespeicherte Ansicht auf −1 nach Entfernen des UG klemmt aufs EG");
    assert.equal(untersterLevel(m), -2);
    assert.equal(untersterLevel(ohne), 0);
    assert.equal(ebeneName(m, -1), "1. UG");
    assert.equal(ebeneName(m, 2), "2. OG");
    assert.equal(oberirdischeGeschosse(m), 3);
    assert.deepEqual(ebenenListe(null), []);
  });
  it("istBodenplatte ohne UG gleichwertig zur alten Regel, Platten-Id", () => {
    const ohne = createBuildingModel({ storeys: 3 });
    for (const s of ohne.slabs) assert.equal(istBodenplatte(ohne, s), s.level <= 0 && !(s.elevation > 0));
    assert.deepEqual(ohne.slabs.map(huellPlattenId), ["-1", "0", "1", "2"]);
    assert.deepEqual(m.slabs.map(huellPlattenId), ["-1", "0", "1", "2", "ug-1", "ug-2"]);
  });
});

describe("107-13 hoehen.js mit negativen Leveln", () => {
  it("Zahl: −|level| · Höhe; Tabelle: Summe abwärts; level >= 0 unverändert", () => {
    assert.equal(elevationOf(-1, 3), -3);
    assert.equal(elevationOf(-2, 3), -6);
    assert.equal(elevationOf(2, 3), 6);
    const tab = [{ level: -2, hoehe_m: 2.5 }, { level: -1, hoehe_m: 2.8 }, { level: 0, hoehe_m: 3.5 }, { level: 1, hoehe_m: 3 }];
    assert.equal(elevationOf(-1, tab), -2.8);
    assert.equal(elevationOf(-2, tab), -5.3);
    assert.equal(elevationOf(2, tab), 6.5);
    // a basement without its own row takes the height of the nearest row (107-02 rule, verified here)
    assert.equal(elevationOf(-1, [{ level: 0, hoehe_m: 3.6 }]), -3.6);
  });
  it("Geschosshöhe aus dem Modell sucht das Geschoss darüber nach Level (UG hängt hinten)", () => {
    const m = createBuildingModel({ storeys: 3, untergeschosse: 1 });
    assert.equal(geschossHoeheAusModell(m, 2), 3, "oberstes Geschoss: Gesamthöhe minus Elevation, nicht das UG dahinter");
    assert.equal(geschossHoeheAusModell(m, -1), 3);
    assert.equal(geschossHoeheAusModell(m, 0), 3);
  });
});

describe("107-13 Leser des Modells", () => {
  it("autoEnvOpenings: keine Regelfenster auf Level −1, EG unverändert", () => {
    const ohne = createBuildingModel(EINGABE_A);
    const mit = createBuildingModel({ ...EINGABE_A, untergeschosse: 1 });
    const a = autoEnvOpenings(ohne.walls, {}, []), b = autoEnvOpenings(mit.walls, {}, []);
    assert.equal(b.filter((o) => o.level < 0).length, 0);
    assert.deepEqual(b, a);
  });
  it("synthHull: bei 0 gleich, bei 1 Wandlänge und Deckenzahl n + 1", () => {
    const basis = { storeys: 4, storeyHeight: 3 };
    assert.deepEqual(synthHull({ ...basis, untergeschosse: 0 }), synthHull(basis));
    const [w0, , d0] = synthHull(basis);
    const [w1, , d1] = synthHull({ ...basis, untergeschosse: 1 });
    assert.equal(w1.mengen.length, (w0.mengen.length / 4) * 5);
    assert.equal(d1.mengen.count, 5);
    assert.ok(Math.abs(w1.mengen.area - (w0.mengen.area / 12) * 15) < 1e-9, "Wandfläche über 15 m statt 12 m Höhe");
  });
  it("stuetzenBerechnung: Level −1 trägt storeys − level = 5 Decken", () => {
    const fp = createBuildingModel(EINGABE_A).footprint;
    const r = stuetzenBerechnung({ footprint: fp, stuetzen: [{ x: 0, z: 0, level: -1, size: 0.4, _idx: 1 }], level: -1, storeys: 4, qFlaeche: 10, fcd: 14200 });
    assert.equal(r.length, 1);
    assert.equal(r[0].geschosse, 5);
  });
  it("strangschema mit Untergeschossen: Zeilen aufsteigend ab −U, Schacht −1 bis 2", () => {
    let netz = neuerKnoten(null, { gewerk: "trinkwasser", art: "schacht", level: -1, levelBis: 2, x: 0, z: 0 }).netz;
    const id = netz.knoten[0].id;
    netz = neueKante(netz, { gewerk: "trinkwasser", level: -1, von: id, points: [{ x: 0, z: 0 }, { x: 2, z: 0 }] }).netz;
    const ohne = strangschema(netz, 4);
    assert.deepEqual(ohne.zeilen, [0, 1, 2, 3], "ohne UG wie bisher");
    assert.deepEqual(strangschema(netz, 4, 0), ohne);
    const mit = strangschema(netz, 4, 1);
    assert.deepEqual(mit.zeilen, [-1, 0, 1, 2, 3]);
    assert.deepEqual(mit.zellen.map((z) => [z.level, z.kanten]), [[-1, 1], [0, 0], [1, 0], [2, 0]]);
  });
  it("Plan-Modell: untergeschosse gehört zu den Abhängigkeiten, 0 → 1 gibt neue Geschosse", () => {
    const bp = { footprintM: null, storeys: 2, storeyHeight: 3, geschosse: null, untergeschosse: 0 };
    const a = planModellAbhaengigkeiten(bp, null), b = planModellAbhaengigkeiten({ ...bp, untergeschosse: 1 }, null);
    assert.notDeepEqual(a, b);
    assert.equal(planModellBauen(bp, null).storeys.length, 2);
    assert.deepEqual(planModellBauen({ ...bp, untergeschosse: 1 }, null).storeys.map((s) => s.level), [0, 1, -1]);
  });
});

describe("107-13 IFC-Export mit Untergeschoss", () => {
  it("Storey-Zahl n + U, UG-Elevation -3.0000, parseIfcText liefert das UG als unterstes Geschoss", () => {
    const m = createBuildingModel({ storeys: 2, untergeschosse: 1 });
    const ifc = exportIFC(m, {});
    const st = zeilen(ifc, "IFCBUILDINGSTOREY");
    assert.equal(st.length, 3);
    assert.ok(st.some((l) => l.includes("'1. UG'") && l.trimEnd().endsWith(",-3.0000);")));
    const p = parseIfcText(ifc);
    assert.deepEqual(p.storeys[0], { name: "1. UG", elevation: -3 });
  });
  it("Wand auf Level −1 im UG-Containment, Bodenplatte im UG, Kellerdecke .FLOOR., genau eine .BASESLAB.", () => {
    const { model, optionen } = ifcUgSzenario();
    const ifc = exportIFC(model, optionen);
    const ug = idVon(zeilen(ifc, "IFCBUILDINGSTOREY").find((l) => l.includes("'1. UG'")));
    const eg = idVon(zeilen(ifc, "IFCBUILDINGSTOREY").find((l) => l.includes("'EG'")));
    const rel = (/** @type {string} */ st) => zeilen(ifc, "IFCRELCONTAINEDINSPATIALSTRUCTURE").find((r) => r.trimEnd().endsWith(`),${st});`)) || "";
    const enthaelt = (/** @type {string} */ r, /** @type {string} */ ref) => r.includes(`${ref},`) || r.includes(`${ref})`);
    // the drawn wall is the last IFCWALL with the drawn wall's data sheet; find it by its placement x = -4
    const waende = zeilen(ifc, "IFCWALL");
    const ugWandRefs = waende.map(idVon).filter((ref) => enthaelt(rel(ug), ref));
    assert.equal(ugWandRefs.length, 4 + 1, "vier Hüllwände des UG und die gezeichnete Wand");
    assert.equal(waende.map(idVon).filter((ref) => enthaelt(rel(eg), ref)).length, 4, "EG behält seine vier Hüllwände");
    const platten = zeilen(ifc, "IFCSLAB");
    const basis = platten.filter((l) => l.includes(".BASESLAB."));
    assert.equal(basis.length, 1);
    assert.ok(enthaelt(rel(ug), idVon(basis[0])), "Bodenplatte im untersten UG");
    assert.equal(platten.filter((l) => l.includes(".FLOOR.")).length, 3, "Kellerdecke + zwei Geschossdecken");
    const zone = zeilen(ifc, "IFCSPACE").find((l) => l.includes("'Kellerraum'"));
    // B-114-02-01: a space is aggregated under its storey (IfcRelAggregates), not contained
    const aggregiert = zeilen(ifc, "IFCRELAGGREGATES").find((r) => r.includes(`,${ug},(`)) || "";
    assert.ok(enthaelt(aggregiert, idVon(zone)), "Raum auf −1 am UG aggregiert");
    assert.ok(!enthaelt(rel(ug), idVon(zone)), "Raum nicht mehr im Containment");
  });
  it("Bodenplatten-GUID mit und ohne UG gleich, alle IFCSLAB-GlobalIds paarweise verschieden (U = 0, 1, 2; mit und ohne Steckbrief)", () => {
    const sb = { steckbrief: { projektId: "p-10713" } };
    const basisGuid = (/** @type {string} */ ifc) => guidVon(zeilen(ifc, "IFCSLAB").find((l) => l.includes(".BASESLAB.")));
    const g0 = basisGuid(exportIFC(createBuildingModel({ storeys: 2 }), sb));
    for (const U of [0, 1, 2]) {
      const m = createBuildingModel({ storeys: 2, untergeschosse: U });
      for (const opt of [{}, sb]) {
        const guids = zeilen(exportIFC(m, opt), "IFCSLAB").map(guidVon);
        assert.equal(guids.length, 3 + U);
        assert.equal(new Set(guids).size, guids.length, `U = ${U}, ${opt === sb ? "mit" : "ohne"} Steckbrief`);
      }
      assert.equal(basisGuid(exportIFC(m, sb)), g0, `Bodenplatte stabil bei U = ${U}`);
    }
  });
  it("zweites Golden (Modell mit einem UG, Wand und Raum auf −1) Zeichen für Zeichen", () => {
    const { model, optionen } = ifcUgSzenario();
    const warn = [];
    assert.equal(exportIFC(model, { ...optionen, onWarn: (/** @type {string} */ w) => warn.push(w) }), lies("ifc-golden-107-13-ug.ifc"));
    assert.deepEqual(warn, [], "kein Element fällt ins EG zurück");
  });
  it("Auswahl: „hullslab“ trifft Bodenplatte und Kellerdecke mit verschiedener GUID, gleich der GUID im Export", () => {
    const { model, optionen } = ifcUgSzenario();
    const daten = { model, storeyHeight: 3 };
    const opt = { projektId: optionen.steckbrief.projektId };
    const boden = bimBauteil({ type: "hullslab", id: "-1" }, daten, opt);
    const decke = bimBauteil({ type: "hullslab", level: -1, id: "ug-1" }, daten, opt);
    assert.ok(boden && decke);
    assert.notEqual(boden.guid, decke.guid);
    assert.equal(boden.steckbrief.typ, "bodenplatte");
    assert.equal(decke.steckbrief.typ, "decke");
    assert.equal(decke.geschoss, "1. UG");
    const ifc = exportIFC(model, optionen);
    const ifcGuids = zeilen(ifc, "IFCSLAB").map((l) => guidVon(l).slice(1, -1));
    assert.ok(ifcGuids.includes(boden.guid) && ifcGuids.includes(decke.guid), "Auswahl und Export bilden dieselbe GUID");
    const alle = bimAlle(daten, opt).filter((b) => b.sel.type === "hullslab");
    assert.equal(new Set(alle.map((b) => b.guid)).size, alle.length, "jede Hüllplatte eine eigene GUID");
  });
});

describe("107-13 Planausgaben tragen den UG-Namen", () => {
  it("DXF-Dateiname aus „Grundriss_1. UG“ wird Grundriss_1_UG (Name aus der Ebenenliste)", () => {
    const m = createBuildingModel({ storeys: 2, untergeschosse: 1 });
    assert.equal(dxfDateiname("Testprojekt", `Grundriss_${ebeneName(m, -1)}`), "Testprojekt_Grundriss_1_UG.dxf");
  });
});

describe("107-13 Vektorschnitt mit UG", () => {
  it("Wand bis fusshoehe_m, Kote „-3,00  1. UG“, bbox schließt das UG ein; ohne UG unverändert", () => {
    const ohne = createBuildingModel(EINGABE_A);
    const mit = createBuildingModel({ ...EINGABE_A, untergeschosse: 1 });
    const gOhne = schnittGrafik({ model: ohne }), gMit = schnittGrafik({ model: mit });
    assert.ok(gMit.elemente.some((e) => e.art === "text" && e.text === "-3,00  1. UG"));
    // z is stored as −height: the basement wall reaches z = +3
    const ugW = ugSchnittWaende(mit);
    assert.equal(ugW.length, 2);
    assert.ok(gMit.elemente.some((e) => e.ebene === "wand" && e.pts.some((p) => Math.abs(p.z - 3) < 1e-9)));
    assert.ok(gMit.bbox.z1 > gOhne.bbox.z1 + 2.9, "bbox reicht unter das UG");
    assert.equal(ugSchnittWaende(ohne).length, 0);
    assert.ok(!gOhne.elemente.some((e) => e.ebene === "wand" && e.pts.some((p) => p.z > 0.01)), "ohne UG keine Wand unter ±0,00");
    // basement wall thinner than the facade (single24 vs. the 0.3 m default)
    assert.ok(Math.abs(ugW[0].dicke_m - 0.24) < 1e-9);
  });
});
