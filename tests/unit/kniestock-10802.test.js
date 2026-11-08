// 108-02 (D-EFH-01): knee wall in the building model, collar-beam floor and full-storey rule from the roof geometry.
// Test house: tests/unit/fixtures/efh-108.js (generic EFH 11.40 × 10.20 m, KG −1 2.75 m, EG 0 2.90 m, DG 1 2.60 m, gable roof 45°, ridge
// along x, span 10.20 m across z). Hand calculation (default hull slab 0.25 m, bezug "unten" = the slab STANDS on the storey elevation):
//   DG elevation 2.90 → top of the structural slab under the DG 2.90 + 0.25 = 3.15 → eaves 3.15 + 1.00 = 4.15 m, DG hull walls 1.25 m.
//   (The plan text says 3.90 / 1.00 m "beim Standardbezug" — that is the bezug "oben" case, where the slab hangs below the elevation;
//   both are tested below, see 108-02-SUMMARY.md.)
//   Collar-beam floor: slab over the DG on 2.90 + 2.60 = 5.50, top 5.75 → 1.60 m above the eaves → at 45° 1.60 m in from each eaves line:
//   strip 10.20 − 2 · 1.60 = 7.00 m wide (z = ±3.50), area 11.40 · 7.00 = 79.80 m².
//   Full storey: clear height ≥ 2.30 m from the top of the structural slab = 1.30 m above the eaves → 10.20 − 2 · 1.30 = 7.60 m → 7.60 / 10.20
//   = 74.5 % ≥ 2/3 → full. Knee wall 0.50 m: 1.80 m above the eaves → 10.20 − 3.60 = 6.60 m → 64.7 % < 2/3 → not full.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geschosseAus, elevationOf, MIN_WANDHOEHE_M, kniestockAus, kniestockVerwaist, patchKniestock, patchAlleGeschosshoehen, patchGeschosshoehe, MAX_KNIESTOCK_M } from "@core/lib/bauteil/hoehen.js";
import { globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js";
import { globalesDach, dachEbenen, deckeUnterDach, umrissSpanneBeiZ, dachSchnittLinie } from "@core/lib/bauteil/dachGeometrie.js";
import { flaecheAbHoehe } from "@core/lib/bauteil/lichteHoehe.js";
import { vollgeschossAusDach, VOLLGESCHOSS_ANTEIL } from "@core/lib/bauteil/vollgeschoss.js";
import { createBuildingModel, kniestockGeometrie } from "@core/lib/buildingModel";
import { synthHull } from "@core/lib/bimClassification";
import { dachgeschossDach, dachschraegenAnteile } from "@designer/lib/dachschraegenAnteile";
import { schnittGrafik, planGrafik } from "@designer/lib/vektorPlan";
import { planModellBauen } from "@designer/lib/usePlanModel";
import { exportIFC } from "@designer/lib/ifcExport";
import { autoEnvOpenings, regelfensterPasst } from "@designer/lib/autoOpenings";
import { EFH_108, EFH_FOOTPRINT, efhModell, efhModellMitKniestock, efhGeschosseMitKniestock } from "./fixtures/efh-108.js";
import { ifcKniestockSzenario } from "./fixtures/ifcKniestockModell-10802.js";
import { jsxUmgebung } from "./helpers/jsxRender.mjs";

const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const nahe = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ was, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${was}: ${a} ≠ ${b}`);
/** @param {Array<{x: number, z: number}>} p @returns {number} m² */
const flaeche = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.z - b.x * a.z; }, 0)) / 2;

describe("108-02 Feld kniestock_m in der Geschosstabelle", () => {
  it("geschosseAus behält das Feld (nur endliche Werte ≥ 0), Zeilen ohne Feld bleiben bei drei Schlüsseln", () => {
    const t = geschosseAus({ geschosse: [{ level: 1, name: "DG", hoehe_m: 2.6, kniestock_m: 1 }, { level: 0, name: "EG", hoehe_m: 2.9 }] });
    assert.deepEqual(t, [{ level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.6, kniestock_m: 1 }]);
    assert.deepEqual(Object.keys(/** @type {any[]} */ (t)[0]), ["level", "name", "hoehe_m"]);
    for (const falsch of [-1, "x", null, "", Infinity]) {
      const r = /** @type {any[]} */ (geschosseAus({ geschosse: [{ level: 0, hoehe_m: 3, kniestock_m: falsch }] }));
      assert.equal("kniestock_m" in r[0], false, String(falsch));
    }
    assert.equal(/** @type {any[]} */ (geschosseAus({ geschosse: [{ level: 0, hoehe_m: 3, kniestock_m: 0 }] }))[0].kniestock_m, 0, "0 ist ein gültiger Kniestock");
  });

  it("kniestockAus: nur der oberste Eintrag und nur auf Level storeys − 1; verschobener Eintrag → null und verwaist", () => {
    const tab = efhGeschosseMitKniestock(1);
    assert.equal(kniestockAus(tab, 2), 1);
    assert.equal(kniestockAus(tab, 3), null, "ein drittes Geschoss ergänzt: der DG-Wert gilt nicht mehr");
    assert.equal(kniestockVerwaist(tab, 3), true);
    assert.equal(kniestockVerwaist(tab, 2), false);
    assert.equal(kniestockAus(2.9, 2), null, "Zahl statt Tabelle");
    assert.equal(kniestockAus(efhGeschosseMitKniestock(null), 2), null);
    // a knee wall on the EG row while the DG is the top storey is stale too
    const eg = EFH_108.geschosse.map((g) => (g.level === 0 ? { ...g, kniestock_m: 1 } : g));
    assert.equal(kniestockAus(eg, 2), null);
    assert.equal(kniestockVerwaist(eg, 2), true);
  });

  it("patchKniestock: Tabelle erzeugen, setzen, entfernen, fremde Einträge räumen; andere Felder bleiben", () => {
    assert.deepEqual(patchKniestock({ storeys: 2, storeyHeight: 2.9, geschosse: null }, 1).geschosse,
      [{ level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "1. OG", hoehe_m: 2.9, kniestock_m: 1 }]);
    const mit = patchKniestock({ storeys: 2, storeyHeight: 2.9, geschosse: EFH_108.geschosse }, 0.8).geschosse;
    assert.deepEqual(mit, efhGeschosseMitKniestock(0.8));
    assert.deepEqual(patchKniestock({ storeys: 2, geschosse: mit }, null).geschosse, efhGeschosseMitKniestock(null), "null entfernt das Feld");
    assert.deepEqual(patchKniestock({ storeys: 2, geschosse: mit }, -1).geschosse, efhGeschosseMitKniestock(null), "negativ entfernt das Feld");
    // a stale value on the old top storey disappears when the new top storey gets one; the new row takes the nearest storey height
    const drei = patchKniestock({ storeys: 3, storeyHeight: 2.9, geschosse: mit }, 1).geschosse;
    assert.deepEqual(drei.map((g) => [g.level, g.hoehe_m, g.kniestock_m]), [[-1, 2.75, undefined], [0, 2.9, undefined], [1, 2.6, undefined], [2, 2.6, 1]]);
    assert.equal(kniestockVerwaist(drei, 3), false);
    assert.equal(MAX_KNIESTOCK_M, 2.5);
  });

  it("patchAlleGeschosshoehen und patchGeschosshoehe verlieren das Feld nicht", () => {
    const tab = efhGeschosseMitKniestock(1);
    assert.equal(/** @type {any[]} */ (patchAlleGeschosshoehen({ geschosse: tab }, 3).geschosse).find((g) => g.level === 1).kniestock_m, 1);
    assert.equal(/** @type {any} */ (patchGeschosshoehe({ geschosse: tab }, 1, 2.8)).geschosse.find((/** @type {any} */ g) => g.level === 1).kniestock_m, 1);
    assert.equal(/** @type {any} */ (patchGeschosshoehe({ geschosse: tab }, 0, 3.1)).geschosse.find((/** @type {any} */ g) => g.level === 1).kniestock_m, 1);
  });
});

describe("108-02 Gebäudemodell mit Kniestock", () => {
  it("ohne Kniestock byte-gleich: Dachform allein, Kniestock bei Flachdach, Kniestock ohne Dachform", () => {
    const ohne = JSON.stringify(efhModell());
    assert.equal(JSON.stringify(efhModell({ dachform: "sattel", dachneigung: 45 })), ohne);
    assert.equal(JSON.stringify(efhModell({ geschosse: efhGeschosseMitKniestock(1), dachform: "flach", dachneigung: 45 })), ohne);
    assert.equal(JSON.stringify(efhModell({ geschosse: efhGeschosseMitKniestock(1) })), ohne);
    // the default model of every older test (no table): unchanged keys
    assert.deepEqual(Object.keys(createBuildingModel({ dachform: "sattel", dachneigung: 30 })), ["footprint", "storeys", "walls", "slabs", "spaces", "parapets", "parapetHeight", "storeyHeight", "totalHeight"]);
  });

  it("Modell mit Kniestock = Golden 108-02 (1,00 m, 1,00 m Bezug oben, 0,50 m)", () => {
    const golden = JSON.parse(lies("gebaeudemodell-golden-108-02.json"));
    assert.equal(JSON.stringify(efhModellMitKniestock(1)), golden.efh_kniestock_100);
    assert.equal(JSON.stringify(efhModellMitKniestock(1, { deckenBezug: "oben" })), golden.efh_kniestock_100_bezug_oben);
    assert.equal(JSON.stringify(efhModellMitKniestock(0.5)), golden.efh_kniestock_050);
  });

  it("Traufe, Wandhöhe, Räume und Gesamthöhe nach der Hand-Rechnung (Kopf der Datei)", () => {
    const m = efhModellMitKniestock(1);
    const o = efhModell();
    nahe(m.traufhoehe_m, 4.15, "Traufe Bezug unten");
    assert.equal(m.kniestock_m, 1);
    nahe(globaleTraufhoehe_m(m), 4.15, "globaleTraufhoehe_m liest die Modelltraufe");
    nahe(globaleTraufhoehe_m(o), 5.5, "ohne Kniestock wie bisher (Summe der Geschosshöhen)");
    for (const w of m.walls.filter((/** @type {any} */ x) => x.level === 1)) nahe(w.height, 1.25, "DG-Hüllwand");
    assert.deepEqual(m.walls.filter((/** @type {any} */ x) => x.level !== 1), o.walls.filter((/** @type {any} */ x) => x.level !== 1), "EG/KG-Wände unverändert");
    assert.deepEqual(m.spaces, o.spaces, "Räume (auch das DG) behalten ihre Geschosshöhe");
    assert.equal(m.totalHeight, o.totalHeight, "totalHeight bleibt die Summe der Geschosshöhen");
    const oben = efhModellMitKniestock(1, { deckenBezug: "oben" });
    nahe(oben.traufhoehe_m, 3.9, "Traufe Bezug oben (Planbeispiel)");
    for (const w of oben.walls.filter((/** @type {any} */ x) => x.level === 1)) nahe(w.height, 1, "DG-Hüllwand Bezug oben");
    const null0 = efhModellMitKniestock(0);
    nahe(null0.traufhoehe_m, 3.15, "Kniestock 0: Traufe auf OK Rohdecke");
    // the roof of 3D / section / IFC sits on the new eaves
    const dach = /** @type {any} */ (globalesDach(m, "sattel", 45));
    nahe(dach.traufhoehe_m, 4.15, "globalesDach");
    nahe(dach.traufhoehe_m + dach.anstieg_m, 9.25, "First 4,15 + 5,10");
    // the parapet stands on the eaves
    const mitAttika = efhModellMitKniestock(1, { parapet: { enabled: true, height: 1 } });
    for (const p of mitAttika.parapets) nahe(p.elevation, 4.15, "Attika auf der Traufe");
  });

  it("Kehlbalkenlage bleibt, auf die Dachkontur in ihrer Höhe beschnitten (Nutzerentscheid 01.11.)", () => {
    const m = efhModellMitKniestock(1);
    const kehl = m.slabs.filter((/** @type {any} */ s) => s.kehlbalkenlage);
    assert.equal(kehl.length, 1);
    assert.equal(m.slabs.length, efhModell().slabs.length, "keine Decke entfällt");
    assert.equal(kehl[0].level, 1);
    nahe(kehl[0].elevation, 5.5, "Ebene der Decke über dem DG");
    const zs = kehl[0].polygon.map((/** @type {any} */ p) => p.z), xs = kehl[0].polygon.map((/** @type {any} */ p) => p.x);
    nahe(Math.min(...zs), -3.5, "z min"); nahe(Math.max(...zs), 3.5, "z max");
    nahe(Math.min(...xs), -5.7, "x min"); nahe(Math.max(...xs), 5.7, "x max");
    nahe(flaeche(kehl[0].polygon), 79.8, "Fläche 11,40 · 7,00", 1e-6);
    // other slabs keep the full footprint
    for (const s of m.slabs.filter((/** @type {any} */ x) => !x.kehlbalkenlage)) assert.deepEqual(s.polygon, EFH_FOOTPRINT.map((p) => ({ ...p })));
    // Kniestock 0.50: 2.10 m above the eaves → z = ±3.00
    const h = efhModellMitKniestock(0.5).slabs.find((/** @type {any} */ s) => s.kehlbalkenlage);
    nahe(Math.max(...h.polygon.map((/** @type {any} */ p) => p.z)), 3, "z max bei 0,50 m");
  });

  it("Decke über dem First entfällt mit Kennzeichen; deckeUnterDach rechnet exakt", () => {
    // DG 8 m high: slab top 2.90 + 8 + 0.25 = 11.15 > ridge 4.15 + 5.10 = 9.25
    const hoch = efhModell({ geschosse: EFH_108.geschosse.map((g) => (g.level === 1 ? { ...g, hoehe_m: 8, kniestock_m: 1 } : g)), dachform: "sattel", dachneigung: 45 });
    assert.equal(hoch.kehlbalkenlage_entfallen, true);
    assert.equal(hoch.slabs.some((/** @type {any} */ s) => s.level === 1), false);
    const dach = /** @type {any} */ (globalesDach({ footprint: EFH_FOOTPRINT, traufhoehe_m: 0 }, "sattel", 45));
    const e = dachEbenen(dach);
    assert.deepEqual(deckeUnterDach(EFH_FOOTPRINT, e, 6), [], "über dem First (5,10)");
    nahe(flaeche(deckeUnterDach(EFH_FOOTPRINT, e, 0)), 116.28, "auf der Traufe: ganzer Umriss", 1e-9);
    nahe(flaeche(deckeUnterDach(EFH_FOOTPRINT, e, 2)), 11.4 * 6.2, "2 m über der Traufe: 10,20 − 4,00", 1e-9);
    const walm = /** @type {any} */ (globalesDach({ footprint: EFH_FOOTPRINT, traufhoehe_m: 0 }, "walm", 45));
    assert.ok(flaeche(deckeUnterDach(EFH_FOOTPRINT, dachEbenen(walm), 1)) < 11.4 * 8.2, "Walm schneidet auch die Enden");
    assert.deepEqual(umrissSpanneBeiZ([{ x: -1, z: -1 }, { x: 2, z: -1 }, { x: 2, z: 1 }, { x: -1, z: 1 }], 0), { von_m: -1, bis_m: 2 });
    assert.equal(umrissSpanneBeiZ([{ x: -1, z: 1 }, { x: 2, z: 1 }, { x: 2, z: 3 }], 0), null);
  });

  it("kniestockGeometrie ist die eine Rechnung für Modell und Mengen; usePlanModel reicht die Dachform durch", () => {
    const g = /** @type {any} */ (kniestockGeometrie({ footprintM: EFH_FOOTPRINT, storeys: 2, storeyHeight: 2.9, geschosse: efhGeschosseMitKniestock(1), dachform: "sattel", dachneigung: 45 }));
    nahe(g.okRohdecke_m, 3.15, "OK Rohdecke"); nahe(g.wandHoehe_m, 1.25, "Wandhöhe");
    const bp = { footprintM: EFH_FOOTPRINT, storeys: 2, storeyHeight: 2.9, geschosse: efhGeschosseMitKniestock(1), untergeschosse: 1 };
    assert.equal(JSON.stringify(planModellBauen(bp, { dachform: "sattel", dachneigung: 45 })), JSON.stringify(efhModellMitKniestock(1)));
    assert.equal(planModellBauen(bp, null).kniestock_m, undefined, "ohne Datensatz (Dachform unbekannt) kein Kniestock");
  });
});

describe("108-02 Regelfenster an der Kniestockwand", () => {
  it("keine 0,90 + 1,40-m-Regelfenster in einer 1,25-m-Kniestockwand; ohne Kniestock unverändert; hoher Kniestock nimmt sie wieder", () => {
    const zaehle = (/** @type {any} */ m, /** @type {number} */ l) => autoEnvOpenings(m.walls, {}, []).filter((o) => o.level === l && o.kind === "window").length;
    const ohne = efhModell();
    assert.ok(zaehle(ohne, 1) > 0, "DG ohne Kniestock hat Regelfenster");
    assert.equal(zaehle(efhModellMitKniestock(1), 1), 0, "Kniestockwand 1,25 m");
    assert.equal(zaehle(efhModellMitKniestock(1), 0), zaehle(ohne, 0), "EG unverändert");
    assert.equal(zaehle(efhModellMitKniestock(2.1), 1), zaehle(ohne, 1), "Kniestock 2,10 m: Wand 2,35 m ≥ 2,30 m");
    assert.equal(ohne.walls.some((/** @type {any} */ w) => "kniestock" in w), false);
  });
});

describe("108-02 Mengen (synthHull)", () => {
  const satz = { footprintM: EFH_FOOTPRINT, storeys: 2, storeyHeight: 2.9, untergeschosse: 1, dachform: "sattel", dachneigung: 45 };
  it("ohne Feld byte-gleich", () => {
    assert.equal(JSON.stringify(synthHull({ ...satz, geschosse: efhGeschosseMitKniestock(null) })), JSON.stringify(synthHull({ ...satz, geschosse: efhGeschosseMitKniestock(null), dachform: undefined })));
    assert.equal(JSON.stringify(synthHull({ ...satz, geschosse: efhGeschosseMitKniestock(1), dachform: "flach" })), JSON.stringify(synthHull({ ...satz, geschosse: efhGeschosseMitKniestock(null) })));
  });
  it("mit Kniestock: DG-Wandfläche mit 1,25 m, Kehlbalkenlage mit 79,80 m²", () => {
    const h = synthHull({ ...satz, geschosse: efhGeschosseMitKniestock(1) });
    const wand = h.find((x) => x.id === "hull-wall"), decke = h.find((x) => x.id === "hull-slab");
    // perimeter 43.20 m × (2.75 + 2.90 + 1.25) = 43.20 × 6.90
    // 108-03: the two gable walls reach the ridge — their triangles above the knee wall (2 × ½ · 10.20 · 5.10 = 52.02 m²) are added
    nahe(/** @type {any} */ (wand).mengen.area, 43.2 * 6.9 + 52.02, "Wandfläche", 1e-6);
    // two full slabs (KG ceiling, EG ceiling) + the clipped collar-beam floor
    nahe(/** @type {any} */ (decke).mengen.area, 116.28 * 2 + 79.8, "Deckenfläche", 1e-6);
    assert.equal(/** @type {any} */ (decke).mengen.count, 3);
  });
});

describe("108-02 Vollgeschoss aus der Dachgeometrie (@core)", () => {
  /** @param {number} k */
  const pruefen = (k) => {
    const m = efhModellMitKniestock(k);
    const dach = /** @type {any} */ (globalesDach(m, "sattel", 45));
    return vollgeschossAusDach({ grundriss: m.footprint, dachEbenen: dachEbenen(dach), boden_m: m.traufhoehe_m - m.kniestock_m });
  };
  it("Kniestock 1,00 m: 7,60 / 10,20 = 74,5 % → Vollgeschoss", () => {
    const v = pruefen(1);
    nahe(v.flaeche_m2, 116.28, "Grundfläche", 1e-9);
    nahe(v.flaeche_h230_m2, 11.4 * 7.6, "Fläche ≥ 2,30 m", 1e-9);
    nahe(v.anteil, 7.6 / 10.2, "Anteil", 1e-9);
    assert.equal(v.voll, true);
    assert.equal(v.grund, "Gelände fehlt", "1,40-m-Regel ungeprüft (108-10)");
    nahe(v.mindestAnteil, VOLLGESCHOSS_ANTEIL, "2/3");
  });
  it("Kniestock 0,50 m: 6,60 / 10,20 = 64,7 % < 2/3 → kein Vollgeschoss", () => {
    const v = pruefen(0.5);
    nahe(v.anteil, 6.6 / 10.2, "Anteil", 1e-9);
    assert.equal(v.voll, false);
  });
  it("ohne Grundriss oder ohne Dachebenen nicht entscheidbar", () => {
    assert.equal(vollgeschossAusDach({}).voll, null);
    assert.equal(vollgeschossAusDach({ grundriss: EFH_FOOTPRINT, dachEbenen: [] }).voll, null);
  });
  it("flaecheAbHoehe aus @core: dieselben Werte wie vorher in der Werkstatt (WoFlV) — eine Quelle für den Kniestock", () => {
    // workshop frame: floor = 0, eaves = knee wall (dachgeschossDach); same planes as the model shifted by OK Rohdecke
    const ds = /** @type {any} */ (dachgeschossDach({ footprint: EFH_FOOTPRINT, dachform: "sattel", dachneigung: 45, kniestock_m: 1 }));
    nahe(flaecheAbHoehe(EFH_FOOTPRINT, dachEbenen(ds), 2.3, 0), 11.4 * 7.6, "2,30 m", 1e-9);
    const a = dachschraegenAnteile(EFH_FOOTPRINT, ds);
    assert.deepEqual(a, { unter1m_m2: 0, zwischen1und2m_m2: 22.8, flaeche_m2: 116.28 }, "WoFlV: < 1 m nichts, 1–2 m zwei Streifen 1,00 × 11,40");
    nahe(vollgeschossAusDach({ grundriss: EFH_FOOTPRINT, dachEbenen: dachEbenen(ds), boden_m: 0 }).anteil, 7.6 / 10.2, "gleicher Anteil im Werkstatt-Rahmen", 1e-9);
  });
});

describe("108-02 IFC und PDF-Schnitt", () => {
  it("IFC mit Kniestock = Golden ifc-golden-108-02-kniestock.ifc (Dach auf 4,15 m, Kehlbalkenlage im Datenblatt)", () => {
    const { model, optionen } = ifcKniestockSzenario();
    const text = exportIFC(model, optionen);
    assert.equal(text, lies("ifc-golden-108-02-kniestock.ifc"));
    assert.match(text, /IFCCARTESIANPOINT\(\(0\.0000,0\.0000,4\.1500\)\)/);
    assert.match(text, /'Kehlbalkenlage',\$,IFCBOOLEAN\(\.T\.\)/);
    assert.equal((text.match(/=IFCSLAB\(/g) || []).length, 4, "Bodenplatte, KG-Decke, EG-Decke, Kehlbalkenlage");
  });

  it("PDF-Schnitt B-B: Seitenwände bis zur Traufe, Kehlbalkenlage ±3,50, Maß „Kniestock 1,00“; ohne Kniestock unverändert", () => {
    const m = efhModellMitKniestock(1);
    const dach = globalesDach(m, "sattel", 45);
    const g = schnittGrafik({ model: m, storeyHeight: 2.9, dach, achse: "z" });
    const texte = g.elemente.filter((/** @type {any} */ e) => e.art === "text").map((/** @type {any} */ e) => e.text);
    assert.ok(texte.includes("Kniestock 1,00"), texte.join(" | "));
    assert.ok(texte.some((/** @type {string} */ t) => t.includes("+4,15") && t.includes("Traufe")));
    const waende = g.elemente.filter((/** @type {any} */ e) => e.ebene === "wand" && e.art === "poly");
    assert.ok(waende.length >= 2);
    for (const w of waende.filter((/** @type {any} */ e) => Math.max(...e.pts.map((/** @type {any} */ p) => p.z)) === 0)) nahe(Math.min(...w.pts.map((/** @type {any} */ p) => p.z)), -4.15, "Wandoberkante");
    const decken = g.elemente.filter((/** @type {any} */ e) => e.ebene === "decke");
    const kehl = decken.find((/** @type {any} */ d) => Math.abs(Math.min(...d.pts.map((/** @type {any} */ p) => p.z)) + 5.75) < 1e-9);
    assert.ok(kehl, "Kehlbalkenlage im Schnitt");
    nahe(Math.min(...kehl.pts.map((/** @type {any} */ p) => p.x)), -3.5, "von"); nahe(Math.max(...kehl.pts.map((/** @type {any} */ p) => p.x)), 3.5, "bis");
    // the roof line starts at the eaves
    nahe(/** @type {any} */ (dachSchnittLinie(dach, "z", 0)).traufe_m, 4.15, "Dachlinie ab der Traufe");
    const ohne = efhModell();
    const d0 = globalesDach(ohne, "sattel", 45);
    assert.equal(JSON.stringify(schnittGrafik({ model: efhModell({ geschosse: efhGeschosseMitKniestock(1), dachform: "flach" }), storeyHeight: 2.9, dach: d0, achse: "z" })),
      JSON.stringify(schnittGrafik({ model: ohne, storeyHeight: 2.9, dach: d0, achse: "z" })), "ohne wirksamen Kniestock byte-gleich");
  });
});

describe("108-02 Bildschirm-Schnitt (BimPlan2D, SSR)", () => {
  /** @type {Awaited<ReturnType<typeof jsxUmgebung>>} */
  let u;
  /** @type {any} */
  let BimPlan2D;
  before(async () => {
    u = await jsxUmgebung();
    BimPlan2D = (await u.laden("/packages/nova-designer/src/components/BimPlan2D.jsx")).default;
  });
  after(async () => { await u?.schliessen(); });

  it("Kote „Kniestock“ und beschnittene Kehlbalkenlage; ohne Kniestock keines von beiden", () => {
    const m = efhModellMitKniestock(1);
    const svg = u.rendern(BimPlan2D, { model: m, mode: "schnitt", storeyHeight: 2.9, height: 520, dach: globalesDach(m, "sattel", 45), achse: "z" });
    assert.match(svg, /data-kote="kniestock"/);
    assert.match(svg, /Kniestock 1[.,]00/);
    assert.match(svg, /data-kehlbalkenlage="1"/);
    const o = efhModell();
    const svg0 = u.rendern(BimPlan2D, { model: o, mode: "schnitt", storeyHeight: 2.9, height: 520, dach: globalesDach(o, "sattel", 45), achse: "z" });
    assert.doesNotMatch(svg0, /data-kote="kniestock"|data-kehlbalkenlage/);
  });
});

describe("108-02 Review-Fixes", () => {
  it("Zeile über dem obersten Geschoss (Geschosszahl verringert): neu gesetzter Kniestock wirkt, nicht verwaist", () => {
    // table with a row for level 2 left from a former third storey; the studio does not shorten the table when the storey count drops
    const tab = [...EFH_108.geschosse, { level: 2, name: "2. OG", hoehe_m: 2.6 }];
    const g = /** @type {any[]} */ (patchKniestock({ storeys: 2, storeyHeight: 2.9, geschosse: tab }, 1).geschosse);
    assert.equal(g.find((x) => x.level === 1).kniestock_m, 1);
    assert.equal(kniestockAus(g, 2), 1, "die Zeile storeys − 1 zählt, nicht die höchste");
    assert.equal(kniestockVerwaist(g, 2), false);
    // the model follows: knee wall effective
    const m = createBuildingModel({ footprintM: EFH_FOOTPRINT, storeys: 2, storeyHeight: 2.9, geschosse: g, untergeschosse: 1, dachform: "sattel", dachneigung: 45 });
    nahe(m.traufhoehe_m, 4.15, "Traufe");
    // a value left on the row above the top storey is stale
    const oben = tab.map((x) => (x.level === 2 ? { ...x, kniestock_m: 1 } : x));
    assert.equal(kniestockAus(oben, 2), null);
    assert.equal(kniestockVerwaist(oben, 2), true);
  });

  it("patchKniestock: Entfernen ohne Tabelle erzeugt keine Tabelle", () => {
    assert.deepEqual(patchKniestock({ storeys: 2, storeyHeight: 2.9, geschosse: null }, null), {});
    assert.deepEqual(patchKniestock({ storeys: 2, storeyHeight: 2.9 }, ""), {});
  });

  it("Kniestock 0 mit Bezug oben: Traufe = Oberkante der geklemmten DG-Wand (ragt nicht ins Dach)", () => {
    const m = efhModellMitKniestock(0, { deckenBezug: "oben" });
    const elev = elevationOf(1, efhGeschosseMitKniestock(0));
    for (const w of m.walls.filter((/** @type {any} */ x) => x.level === 1)) {
      nahe(w.height, MIN_WANDHOEHE_M, "Wandhöhe geklemmt");
      nahe(w.elevation + w.height, m.traufhoehe_m, "Wandoberkante = Traufe");
    }
    nahe(m.traufhoehe_m, elev + MIN_WANDHOEHE_M, "Traufe angehoben");
  });

  it("regelfensterPasst: eine Regel für 3D/IFC und die gezeichneten Kopien", () => {
    assert.equal(regelfensterPasst({ level: -1 }), false, "Keller");
    assert.equal(regelfensterPasst({ level: 1, kniestock: true, height: 1.25 }), false, "Kniestockwand 1,25 m");
    assert.equal(regelfensterPasst({ level: 1, kniestock: true, height: 2.35 }), true, "Kniestockwand 2,35 m");
    assert.equal(regelfensterPasst({ level: 1, height: 1 }), true, "ohne Kniestock unverändert");
    assert.equal(regelfensterPasst({ level: 1, kniestock: true, height: 1.25 }, { sill: 0.2, height: 1 }), true, "eigene Fenstermaße");
  });

  it("PDF-Grundriss DG: keine Regelfenster an der Kniestockwand; ohne Kniestock da", () => {
    const fenster = (/** @type {any} */ m) => planGrafik({ model: m, level: 1, ansicht: {} }).elemente.filter((/** @type {any} */ e) => e.ebene === "oeffnung").length;
    assert.ok(fenster(efhModell()) > 0, "ohne Kniestock Regelfenster im DG");
    assert.equal(fenster(efhModellMitKniestock(1)), 0);
  });
});

describe("108-02 Review-Fixes: Bildschirm-Grundriss DG (BimPlan2D, SSR)", () => {
  /** @type {Awaited<ReturnType<typeof jsxUmgebung>>} */
  let u;
  /** @type {any} */
  let BimPlan2D;
  before(async () => {
    u = await jsxUmgebung();
    BimPlan2D = (await u.laden("/packages/nova-designer/src/components/BimPlan2D.jsx")).default;
  });
  after(async () => { await u?.schliessen(); });

  it("keine Fenstersymbole und keine Fenster-Schnitte in den Maßketten an der Kniestockwand", () => {
    const zeichne = (/** @type {any} */ m) => u.rendern(BimPlan2D, { model: m, mode: "grundriss", level: 1, storeyHeight: 2.9, height: 520 });
    const ohne = zeichne(efhModell()), mit = zeichne(efhModellMitKniestock(1));
    const symbole = (/** @type {string} */ svg) => (svg.match(/fill="#dbeafe"/g) || []).length;
    assert.ok(symbole(ohne) > 0, "ohne Kniestock Fenster im DG-Grundriss");
    assert.equal(symbole(mit), 0, "Kniestockwand ohne Regelfenster");
    // the window cuts (1.40 m segments) leave the chains; the overall lengths stay
    assert.match(ohne, />1,40</);
    assert.doesNotMatch(mit, />1,40</);
    assert.match(mit, />11,40</);
  });
});
