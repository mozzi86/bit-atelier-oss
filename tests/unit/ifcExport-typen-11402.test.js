// 114-02: IFC export with catalogue types (D-MH-03). A drawn wall/slab with `katalog_typ` is typed by exactly one IfcWallType /
// IfcSlabType / IfcCoveringType per used type, with the type GUID of katalog.json (= harness typ_guid), the catalogue layer set,
// Pset_BIT_Katalog and one IfcRelDefinesByType per type; its material is an IfcMaterialLayerSetUsage of the type's layer set.
// Elements without `katalog_typ` are written exactly as before: the goldens of 107 stay byte-identical WITH the catalogue loaded.
// The cross-check with ifcopenshell (WHERE rules, harness GUIDs, layer side) is harness/tests/test_app_ifc_export.py.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportIFC, exportIFCMitKatalog, WARNART_KATALOG } from "@designer/lib/ifcExport";
import { ladeKatalog, setzeKatalog, katalogGeladen, katalogTyp, katalogTypGuid } from "@core/lib/bauteil/katalog/index.js";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";
import { ifcAufbauSzenario } from "./fixtures/ifcAufbauModell-10703.js";
import { ifcKatalogSzenario } from "./fixtures/ifcKatalogModell-11402.js";

const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
/** Pinned harness GUID of "KS + WDVS 42 cm" (same constant as bauteilkatalog-app-11401.test.js). */
const KS_WDVS_GUID = "1XEVHbDKvIjAOSAuxNaIEz";

/** STEP rows by entity name: [{id, args}] (args = the raw attribute text). */
function zeilen(/** @type {string} */ text, /** @type {string} */ typ) {
  return [...text.matchAll(new RegExp(`^(#\\d+)=${typ}\\((.*)\\);$`, "gm"))].map((m) => ({ id: m[1], args: m[2] }));
}
/** Refs inside a STEP list attribute "(#1,#2)". */
const refs = (/** @type {string} */ s) => (s.match(/#\d+/g) || []);

function gleich(/** @type {string} */ ist, /** @type {string} */ soll, /** @type {string} */ was) {
  if (ist === soll) return;
  const a = ist.split("\n"), b = soll.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert.fail(`${was}: erste Abweichung in Zeile ${i + 1}\n  ist:  ${a[i]}\n  soll: ${b[i]}`);
}

before(async () => { assert.equal(await ladeKatalog(), true); });
after(() => setzeProjektAufbauten(null));

describe("114-02 Altbestand: ohne katalog_typ byte-gleich (Katalog geladen)", () => {
  it("Golden 107 ohne und mit Steckbrief", () => {
    assert.ok(katalogGeladen());
    const { model, ohne, mit } = ifcGoldenSzenario();
    gleich(exportIFC(model, ohne), lies("ifc-golden-107.ifc"), "ohne Steckbrief");
    gleich(exportIFC(model, mit), lies("ifc-golden-107-steckbrief.ifc"), "mit Steckbrief");
  });
  it("Golden 107-03 (Schichtdetails, LayerSetUsage)", () => {
    const { model, opts, AUFBAUTEN_LAYER } = ifcAufbauSzenario();
    setzeProjektAufbauten(AUFBAUTEN_LAYER);
    gleich(exportIFC(model, opts), lies("ifc-golden-107-aufbau.ifc"), "Aufbau");
    setzeProjektAufbauten(null);
  });
  it("exportIFCMitKatalog liefert für ein Modell ohne Katalogbauteile denselben Text", async () => {
    const { model, mit } = ifcGoldenSzenario();
    gleich(await exportIFCMitKatalog(model, mit), lies("ifc-golden-107-steckbrief.ifc"), "Wrapper");
  });
});

describe("114-02 Typobjekte aus dem Katalog", () => {
  const { model, opts } = ifcKatalogSzenario();
  /** @type {any[]} */
  const meldungen = [];
  // exported in a hook: the describe body runs at import time, before the root hook has loaded the catalogue
  let text = "";
  before(() => { text = exportIFC(model, { ...opts, onWarn: (m, art, d) => meldungen.push({ m, art, d }) }); });

  it("das Beispiel exportiert ohne Warnung", () => assert.deepEqual(meldungen, []));

  it("je benutztem Typ genau ein Typobjekt mit der GUID aus katalog.json", () => {
    const wt = zeilen(text, "IFCWALLTYPE"), st = zeilen(text, "IFCSLABTYPE"), ct = zeilen(text, "IFCCOVERINGTYPE");
    assert.equal(wt.length, 2); // KS + WDVS (4 walls, two reference spellings) and the gypsum partition
    assert.equal(st.length, 2);
    assert.equal(ct.length, 1);
    const guids = [...wt, ...st, ...ct].map((z) => z.args.slice(1, 23));
    for (const ref of ["ks-wdvs-42-cm", "gk-2-lagen-12-5-cm", "rohdecke-stb-20-cm", "holzrahmen-abgehangt-35-5-cm", "estrich-parkett-15-cm"]) {
      assert.ok(guids.includes(/** @type {string} */ (katalogTypGuid(ref))), ref);
    }
    assert.ok(wt.some((z) => z.args.startsWith(`'${KS_WDVS_GUID}',$,'KS + WDVS 42 cm'`) && z.args.endsWith(",$,$,$,.SOLIDWALL.")));
  });

  it("eine IfcRelDefinesByType je Typ mit allen Instanzen", () => {
    const rel = zeilen(text, "IFCRELDEFINESBYTYPE");
    assert.equal(rel.length, 5);
    const ks = zeilen(text, "IFCWALLTYPE").find((z) => z.args.startsWith(`'${KS_WDVS_GUID}'`));
    const relKs = rel.filter((r) => r.args.endsWith(`,${ks?.id}`));
    assert.equal(relKs.length, 1);
    const waende = zeilen(text, "IFCWALL");
    assert.deepEqual(refs(relKs[0].args.split(",$,$,$,")[1]).slice(0, -1), waende.slice(0, 4).map((w) => w.id));
    // every element of the example is typed exactly once
    const getypt = rel.flatMap((r) => refs(r.args).slice(0, -1));
    assert.deepEqual([...getypt].sort(), [...waende, ...zeilen(text, "IFCSLAB"), ...zeilen(text, "IFCCOVERING")].map((z) => z.id).sort());
  });

  it("Pset_BIT_Katalog {Schluessel, Version} und Pset_WallCommon am Typ (HasPropertySets)", () => {
    const ks = /** @type {{id: string, args: string}} */ (zeilen(text, "IFCWALLTYPE").find((z) => z.args.startsWith(`'${KS_WDVS_GUID}'`)));
    const sets = refs(ks.args.split(",$,(")[1].split("),")[0]);
    const namen = sets.map((r) => /** @type {RegExpMatchArray} */ (text.match(new RegExp(`^${r}=IFCPROPERTYSET\\('[^']+',\\$,'([^']+)'`, "m")))[1]);
    assert.deepEqual(namen, ["Pset_WallCommon", "Pset_BIT_Katalog"]);
    assert.match(text, /IFCPROPERTYSINGLEVALUE\('Schluessel',\$,IFCLABEL\('ks-wdvs-42-cm'\),\$\)/);
    assert.match(text, /IFCPROPERTYSINGLEVALUE\('Version',\$,IFCINTEGER\(1\),\$\)/);
    assert.match(text, /IFCPROPERTYSINGLEVALUE\('Reference',\$,IFCIDENTIFIER\('KS \+ WDVS 42 cm'\),\$\)/);
    // no type relation through IfcRelDefinesByProperties
    for (const r of sets) assert.ok(!zeilen(text, "IFCRELDEFINESBYPROPERTIES").some((z) => z.args.endsWith(`,${r}`)), r);
  });

  it("Schichtsatz des Typs mit allen Katalogschichten (auch 0-m-Folie), Kategorie = Rolle", () => {
    const t = /** @type {any} */ (katalogTyp("holzrahmen-abgehangt-35-5-cm"));
    assert.ok(t.schichten.some((/** @type {any} */ s) => s.dicke_m === 0), "Testannahme: der Typ hat eine 0-m-Schicht");
    // the type's layer set through its material association (the name is STEP-encoded: "abgehängt")
    const typId = zeilen(text, "IFCSLABTYPE").find((z) => z.args.startsWith(`'${t.typ_guid}'`))?.id;
    const satzId = zeilen(text, "IFCRELASSOCIATESMATERIAL").map((r) => refs(r.args)).find(([o]) => o === typId)?.[1];
    const satz = zeilen(text, "IFCMATERIALLAYERSET").find((z) => z.id === satzId);
    assert.ok(satz);
    const lagen = refs(/** @type {any} */ (satz).args.split("),")[0]);
    assert.equal(lagen.length, t.schichten.length);
    const ks = zeilen(text, "IFCMATERIALLAYER").filter((z) => /'(LoadBearing|Insulation|Outer finish|Inner finish)'/.test(z.args));
    assert.ok(ks.length > 0);
    assert.ok(zeilen(text, "IFCMATERIALLAYER").some((z) => /,0\.0000,\$,/.test(z.args)), "0-m-Schicht geschrieben");
  });

  it("jede Instanz: LayerSetUsage auf den Typsatz, kein eigener Schichtsatz", () => {
    const usages = zeilen(text, "IFCMATERIALLAYERSETUSAGE");
    // KS: three offsets? no — all four KS walls have the same thickness → one usage; GK one; three slabs/covering one each
    assert.equal(usages.length, 5);
    assert.ok(usages.some((u) => /,\.AXIS2\.,\.NEGATIVE\.,0\.2100,\$$/.test(u.args)));
    assert.ok(usages.some((u) => /,\.AXIS3\.,\.NEGATIVE\.,0\.3545,\$$/.test(u.args)));
    const typSaetze = new Set(zeilen(text, "IFCRELASSOCIATESMATERIAL").map((r) => refs(r.args)).filter((x) => x.length === 2)
      .map(([o, s]) => (/=IFC(WALL|SLAB|COVERING)TYPE\(/.test(text.split("\n").find((l) => l.startsWith(`${o}=`)) || "") ? s : null)).filter(Boolean));
    for (const u of usages) assert.ok(typSaetze.has(refs(u.args)[0]), `${u.id} zeigt nicht auf einen Typsatz`);
    assert.equal(zeilen(text, "IFCMATERIALLAYERSET").length, 5, "nur die Schichtsätze der Typen");
  });

  it("Instanz trägt den PredefinedType des Typs; Belagstyp macht die Decke zum IfcCovering", () => {
    assert.ok(zeilen(text, "IFCWALL").slice(0, 4).every((w) => w.args.endsWith(",$,.SOLIDWALL.")));
    assert.ok(zeilen(text, "IFCWALL")[4].args.endsWith(",$,.PARTITIONING."));
    const c = zeilen(text, "IFCCOVERING");
    assert.equal(c.length, 1);
    assert.ok(c[0].args.endsWith(",$,.FLOORING."));
    assert.match(text, /=IFCPROPERTYSET\('[^']+',\$,'Pset_CoveringCommon'/);
  });

  it("Pset_WallCommon der Instanz widerspricht dem Typ nicht (IsExternal/LoadBearing aus dem Katalog)", () => {
    const ws = zeilen(text, "IFCWALL");
    const rel = zeilen(text, "IFCRELDEFINESBYPROPERTIES");
    const wertVon = (/** @type {string} */ wand, /** @type {string} */ prop) => {
      for (const r of rel.filter((z) => z.args.includes(`(${wand})`))) {
        const ps = /** @type {string} */ (refs(r.args).at(-1));
        const zeile = text.match(new RegExp(`^${ps}=IFCPROPERTYSET\\('[^']+',\\$,'Pset_WallCommon',\\$,\\((.*)\\)\\);$`, "m"));
        if (!zeile) continue;
        for (const v of refs(zeile[1])) {
          const m = text.match(new RegExp(`^${v}=IFCPROPERTYSINGLEVALUE\\('${prop}',\\$,IFCBOOLEAN\\(\\.(T|F)\\.\\)`, "m"));
          if (m) return m[1];
        }
      }
      return null;
    };
    for (const w of ws.slice(0, 4)) { assert.equal(wertVon(w.id, "IsExternal"), "T", w.id); assert.equal(wertVon(w.id, "LoadBearing"), "T", w.id); }
    assert.equal(wertVon(ws[4].id, "IsExternal"), "F");
    assert.equal(wertVon(ws[4].id, "LoadBearing"), "F");
  });

  it("DIN 276 auch am Typ", () => {
    const ks = /** @type {{id: string}} */ (zeilen(text, "IFCWALLTYPE").find((z) => z.args.startsWith(`'${KS_WDVS_GUID}'`)));
    const cref = /** @type {{id: string}} */ (zeilen(text, "IFCCLASSIFICATIONREFERENCE").find((z) => z.args.startsWith("$,'331'")));
    const rel = zeilen(text, "IFCRELASSOCIATESCLASSIFICATION").find((r) => r.args.endsWith(`,${cref.id}`));
    assert.ok(rel && refs(rel.args).includes(ks.id));
  });

  it("ohne Steckbrief-Option: Typen trotzdem, keine Klassifizierung", () => {
    const t = exportIFC(model, { ...opts, steckbrief: null });
    assert.equal(zeilen(t, "IFCRELDEFINESBYTYPE").length, 5);
    assert.equal(zeilen(t, "IFCCLASSIFICATION").length, 0);
    assert.equal(zeilen(t, "IFCMATERIALLAYERSETUSAGE").length, 5);
  });
});

describe("114-02 Warnungen: Element bleibt ohne Typ", () => {
  const { model } = ifcKatalogSzenario();
  const lauf = (/** @type {any} */ extra) => {
    /** @type {any[]} */
    const m = [];
    const text = exportIFC(model, { storeyHeight: 3, onWarn: (msg, art, d) => m.push({ msg, art, d }), ...extra });
    return { text, m };
  };
  const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, height: 3, _idx: 9 };

  it("unbekannter Typ → offen; Tür → ohne-schichten; Deckentyp an Wand → klasse; kein Typobjekt", () => {
    for (const [ref, grund] of [["gibtsnicht", "offen"], ["tuer-innen-1-flg-uz-holz-88-5x213-5", "ohne-schichten"], ["rohdecke-stb-20-cm", "klasse"]]) {
      const { text, m } = lauf({ customWalls: [{ ...wand, katalog_typ: ref }] });
      assert.deepEqual(m.map((x) => [x.art, x.d.grund, x.d.schluessel]), [[WARNART_KATALOG, grund, "cw:9"]], ref);
      assert.equal(zeilen(text, "IFCRELDEFINESBYTYPE").length, 0, ref);
      assert.ok(zeilen(text, "IFCWALL")[0].args.endsWith(",$,.STANDARD."), ref);
    }
  });

  it("Decke mit abweichender Dicke: Warnung „dicke“, Typ wird geschrieben", () => {
    const { text, m } = lauf({ customSlabs: [{ points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: -4 }], level: 0, katalog_typ: "rohdecke-stb-20-cm", _idx: 3 }] });
    assert.deepEqual(m.map((x) => [x.art, x.d.grund, x.d.schluessel]), [[WARNART_KATALOG, "dicke", "cs:3"]]);
    assert.equal(zeilen(text, "IFCSLABTYPE").length, 1);
  });

  it("Katalog nicht geladen: offen; exportIFCMitKatalog lädt ihn und typisiert", async () => {
    setzeKatalog(null);
    try {
      const { m } = lauf({ customWalls: [{ ...wand, katalog_typ: "ks-wdvs-42-cm" }] });
      assert.equal(m[0]?.d?.grund, "offen");
      const text = await exportIFCMitKatalog(model, { storeyHeight: 3, customWalls: [{ ...wand, katalog_typ: "ks-wdvs-42-cm" }] });
      assert.equal(zeilen(text, "IFCWALLTYPE").length, 1);
    } finally {
      assert.equal(await ladeKatalog(), true);
    }
  });
});
