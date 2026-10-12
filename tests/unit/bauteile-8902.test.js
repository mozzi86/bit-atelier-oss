// 89-02 / 89-03: workshop components — stable IFC GUIDs, walls (exterior = envelope, separating
// vs. light partitions), D-BW-02 bookkeeping (zones untouched, shell grows), doors and rooms,
// classified elements for the AVA (byte-identical without workshop zones), IFC export with
// property sets.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stabileGuid, werkstattWaende, werkstattTueren, werkstattRaeume, werkstattBauteile, rohbauZuschlag, WAND_KLASSEN,
} from "@core/lib/werkstattBauteile";
import { classifiedElements } from "@core/lib/bimClassification";
import { tesseliere } from "@designer/lib/tesselierung";
import { innenwaende } from "@designer/lib/raumGrenzen";
import { exportIFC } from "@designer/lib/ifcExport";
import { createBuildingModel } from "@core/lib/buildingModel";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const FP = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
const zonenVon = (extra = {}) => tesseliere({ footprintM: FP, storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true, ...extra }).zonen;

describe("89-02 — stabile GUIDs", () => {
  it("22 Zeichen IFC-Base64, erstes Zeichen 0–3, deterministisch, kollisionsarm", () => {
    const g = stabileGuid("wand|0|A|B|0");
    assert.match(g, /^[0-3][0-9A-Za-z_$]{21}$/);
    assert.equal(g, stabileGuid("wand|0|A|B|0"));
    const viele = new Set(Array.from({ length: 2000 }, (_, i) => stabileGuid(`k${i}`)));
    assert.equal(viele.size, 2000);
  });
});

describe("89-02 — Wände, Türen, Räume der Werkstatt", () => {
  it("Außenwände = Umfang je Geschoss, Trennwände zwischen WE/Flur tragend, innerhalb einer WE leicht", () => {
    const zonen = zonenVon();
    const w = werkstattWaende(zonen, { storeyHeight: 3 });
    for (const l of [0, 1]) {
      const aussen = w.filter((x) => x.level === l && x.huelle).reduce((s, x) => s + x.lichteLaenge_m, 0);
      assert.ok(Math.abs(aussen - 172) < 0.05, `Umfang ${aussen}`);
    }
    for (const x of w.filter((q) => !q.huelle)) {
      const gleich = x.we[0] && x.we[0] === x.we[1];
      assert.equal(x.klasse, gleich ? "leicht" : "tragend");
      assert.equal(x.dicke_m, WAND_KLASSEN[x.klasse].dicke_m);
      assert.equal(x.status, null, "D-BW-03: kein Status-Default");
      assert.ok(Math.abs(x.rohbauLaenge_m - x.lichteLaenge_m - x.dicke_m) < 1e-3);
    }
    assert.ok(w.some((x) => x.klasse === "tragend") && w.some((x) => x.klasse === "leicht"));
  });

  it("D-BW-02: Zonen bleiben unverändert (lichte Maße), Rohbau wächst um die Wände", () => {
    const zonen = zonenVon();
    const vorher = JSON.stringify(zonen);
    const b = werkstattBauteile(zonen, { storeyHeight: 3 });
    assert.equal(JSON.stringify(zonen), vorher);
    const eg = b.rohbau.find((r) => r.level === 0);
    const licht = b.raeume.filter((r) => r.level === 0).reduce((s, r) => s + r.flaeche_m2, 0);
    assert.ok(Math.abs(eg.licht_m2 - licht) < 0.01);
    assert.ok(eg.rohbau_m2 > eg.licht_m2 + eg.aussenwand_m2 - 1e-6);
    assert.deepEqual(rohbauZuschlag([], []), []);
  });

  it("GUIDs stabil über Re-Tesselierung und über eine verschobene Innenwand (75-12)", () => {
    const a = werkstattBauteile(zonenVon(), { storeyHeight: 3 });
    const b = werkstattBauteile(zonenVon(), { storeyHeight: 3 });
    assert.deepEqual(a.waende.map((x) => x.guid), b.waende.map((x) => x.guid));
    const z0 = zonenVon();
    const wand = innenwaende(z0).find((x) => x.spielraumPlus >= 0.5);
    const c = werkstattBauteile(zonenVon({ raumGrenzen: { [wand.key]: 0.5 } }), { storeyHeight: 3 });
    assert.deepEqual(new Set(c.raeume.map((x) => x.guid)), new Set(a.raeume.map((x) => x.guid)));
    assert.deepEqual(new Set(c.tueren.map((x) => x.guid)), new Set(a.tueren.map((x) => x.guid)));
    const alle = [...a.waende, ...a.tueren, ...a.raeume].map((x) => x.guid);
    assert.equal(new Set(alle).size, alle.length, "eindeutig");
  });

  it("Türen: je tueren-Eintrag ein Bauteil, Hauseingang = Hülle (KG 334), sonst KG 344", () => {
    const zonen = zonenVon();
    const t = werkstattTueren(zonen);
    assert.equal(t.length, zonen.reduce((s, z) => s + (Array.isArray(z.tueren) ? z.tueren.length : 0), 0));
    for (const x of t) assert.equal(x.kg, x.huelle ? "334" : "344");
    assert.ok(werkstattRaeume(zonen).every((r) => r.flaeche_m2 > 0 && r.status === null));
  });
});

describe("89-03 — AVA-Elemente und IFC", () => {
  it("classifiedElements: ohne Werkstatt-Zonen byte-gleich; mit Zonen Innenwände/-türen mit KG", () => {
    const bm = { footprintM: FP, storeys: 2, storeyHeight: 3 };
    assert.deepEqual(classifiedElements(bm, null, {}), classifiedElements(bm, null));
    assert.deepEqual(classifiedElements(bm, null, { werkstattZonen: [] }), classifiedElements(bm, null));
    const els = classifiedElements(bm, null, { werkstattZonen: zonenVon() });
    const wt = els.filter((e) => e.id.startsWith("wt-"));
    assert.ok(wt.some((e) => e.kind === "wall-inner" && e.kg === "341" && e.mengen.area > 0));
    assert.ok(wt.some((e) => e.kind === "wall-inner" && e.kg === "342"));
    assert.ok(wt.some((e) => e.kind === "door" && e.kg === "344"));
    assert.ok(els.some((e) => e.kind === "wall-hull"), "Hülle bleibt (keine Doppelzählung der Außenwände)");
  });

  it("IFC: Werkstatt-Wände/-Türen/-Räume mit stabiler GUID und Pset_BIT_Bauteil; ohne Option unverändert", () => {
    const model = createBuildingModel({ footprintM: FP, storeys: 2, storeyHeight: 3 });
    assert.equal(exportIFC(model, { storeyHeight: 3 }), exportIFC(model, { storeyHeight: 3, werkstatt: null }));
    const b = werkstattBauteile(zonenVon(), { storeyHeight: 3 });
    const meld = [];
    const ifc = exportIFC(model, { storeyHeight: 3, werkstatt: b, onWarn: (m) => meld.push(m) });
    assert.deepEqual(meld, []);
    const innen = b.waende.find((w) => !w.huelle);
    assert.ok(ifc.includes(`'${innen.guid}'`));
    assert.ok(ifc.includes(`'${b.raeume[0].guid}'`));
    assert.ok(ifc.includes(`'${b.tueren.find((t) => !t.huelle).guid}'`));
    assert.ok(ifc.includes("'Pset_BIT_Bauteil'") && ifc.includes("'Pset_WallCommon'"));
    assert.ok(ifc.includes("IFCLABEL('ohne Status')"), "D-BW-03 im Pset");
    assert.equal((ifc.match(/=IFCDOOR\(/g) || []).length, b.tueren.filter((t) => !t.huelle).length);
  });
});
