// 114-02 (user sample, 08.11.2026): catalogue types together with the roof paths of phase 108 in ONE export — gable profile walls,
// a drawn attic wall with `katalog_typ` cut by the roof, a slab with a stair opening (IfcOpeningElement), a dormer (IfcRoof) and a
// catalogue covering (fixture ifcKatalogKombi-11402.js). Checked on the STEP text: the export runs without a warning, every `#n`
// reference resolves, entity ids and GlobalIds are unique, and every catalogue type has exactly one IfcRelDefinesByType whose
// references are the typed elements and the type object. The schema check with ifcopenshell (WHERE rules) is
// harness/tests/test_app_ifc_export.py (variant "kombi").
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { exportIFCMitKatalog } from "@designer/lib/ifcExport";
import { ladeKatalog, katalogTypGuid } from "@core/lib/bauteil/katalog/index.js";
import { ifcKombiSzenario } from "./fixtures/ifcKatalogKombi-11402.js";

/**
 * Parses the DATA section: id → {typ, args}. Fails on a duplicate id.
 * @param {string} text STEP file
 * @returns {Map<string, {typ: string, args: string}>}
 */
function entitaeten(text) {
  /** @type {Map<string, {typ: string, args: string}>} */
  const m = new Map();
  for (const z of text.matchAll(/^(#\d+)=([A-Z0-9]+)\((.*)\);$/gm)) {
    assert.equal(m.has(z[1]), false, `Entity-Id doppelt: ${z[1]}`);
    m.set(z[1], { typ: z[2], args: z[3] });
  }
  return m;
}
/** `#n` references of an attribute text. */
const refs = (/** @type {string} */ s) => s.match(/#\d+/g) || [];
/** Splits the top-level attributes of an args text (commas inside parentheses and strings stay). */
function attribute(/** @type {string} */ args) {
  const out = [];
  let tiefe = 0, inStr = false, start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "'") inStr = !inStr;
    else if (!inStr && c === "(") tiefe++;
    else if (!inStr && c === ")") tiefe--;
    else if (!inStr && c === "," && tiefe === 0) { out.push(args.slice(start, i)); start = i + 1; }
  }
  out.push(args.slice(start));
  return out;
}
/** All entities reachable from the given references (transitive). */
function erreichbar(/** @type {Map<string, {typ: string, args: string}>} */ m, /** @type {string[]} */ von) {
  const gesehen = new Set(), offen = [...von];
  while (offen.length) {
    const id = /** @type {string} */ (offen.pop());
    if (gesehen.has(id)) continue;
    gesehen.add(id);
    offen.push(...refs(m.get(id)?.args || ""));
  }
  return [...gesehen].map((id) => ({ id, ...(/** @type {{typ: string, args: string}} */ (m.get(id))) }));
}
/** Largest number of distinct points of a polyline in the geometry of an element (its Representation attribute, index 6). */
function profilPunkte(/** @type {Map<string, {typ: string, args: string}>} */ m, /** @type {string} */ id) {
  const rep = refs(attribute(/** @type {{args: string}} */ (m.get(id)).args)[6]);
  return Math.max(0, ...erreichbar(m, rep).filter((e) => e.typ === "IFCPOLYLINE").map((e) => new Set(refs(e.args)).size));
}

/** @type {string} */ let text;
/** @type {Map<string, {typ: string, args: string}>} */ let m;
/** @type {Array<{msg: string, art?: string}>} */ const meldungen = [];
const sz = ifcKombiSzenario();

before(async () => {
  assert.equal(await ladeKatalog(), true);
  text = await exportIFCMitKatalog(sz.model, { ...sz.opts, onWarn: (/** @type {string} */ msg, /** @type {string} */ art) => meldungen.push({ msg, art }) });
  m = entitaeten(text);
});

describe("114-02 Stichprobe: Katalogtypen + Giebel + Treppenloch + Gaube in einem Export", () => {
  it("exportiert ohne Warnung und enthält alle vier Pfade", () => {
    assert.deepEqual(meldungen, []);
    const zahl = (/** @type {string} */ typ) => [...m.values()].filter((e) => e.typ === typ).length;
    assert.equal(zahl("IFCWALLTYPE"), sz.erwartet.wandTypen.length);
    assert.equal(zahl("IFCCOVERINGTYPE"), sz.erwartet.belagTypen.length);
    assert.equal(zahl("IFCSTAIR"), 1);
    assert.equal(zahl("IFCRELVOIDSELEMENT"), zahl("IFCOPENINGELEMENT"));
    const namen = (/** @type {string} */ typ) => [...m.values()].filter((e) => e.typ === typ).map((e) => attribute(e.args)[2]);
    assert.ok(namen("IFCOPENINGELEMENT").some((n) => /Treppe/.test(n)), "Deckenöffnung der Treppe fehlt");
    assert.deepEqual(namen("IFCROOF").sort(), ["'Dach'", "'Gaube'"]);
    // 108-03: the two hull gable walls follow the roof contour (pentagon: knee wall, two slopes) — more than four profile corners
    const giebel = [...m.entries()].filter(([id, e]) => e.typ === "IFCWALL" && profilPunkte(m, id) === 5);
    assert.equal(giebel.length, 2, "zwei Giebel-Profilwände der Hülle");
  });

  it("jeder #n-Verweis zeigt auf eine vorhandene Entity", () => {
    const fehlend = [];
    for (const [id, e] of m) for (const r of refs(e.args)) if (!m.has(r)) fehlend.push(`${id} (${e.typ}) → ${r}`);
    assert.deepEqual(fehlend, []);
  });

  it("GlobalIds sind eindeutig und 22 Zeichen lang", () => {
    /** @type {Map<string, string>} */
    const gesehen = new Map();
    for (const [id, e] of m) {
      const g = /^'([^']*)',/.exec(e.args);
      // rooted entities carry the GlobalId as first attribute, followed by OwnerHistory ($ or a reference)
      if (!g || !/^'[^']*',(\$|#\d+),/.test(e.args) || !/^[0-9A-Za-z_$]{22}$/.test(g[1])) continue;
      assert.equal(gesehen.has(g[1]), false, `GlobalId ${g[1]} doppelt: ${gesehen.get(g[1])} und ${id}`);
      gesehen.set(g[1], id);
    }
    // every product, type and relation of the file was seen (none skipped by the pattern)
    for (const [id, e] of m) if (/^IFC(WALL|SLAB|COVERING|ROOF|STAIR|STAIRFLIGHT|OPENINGELEMENT|WALLTYPE|COVERINGTYPE|RELDEFINESBYTYPE|RELVOIDSELEMENT)$/.test(e.typ)) {
      assert.ok([...gesehen.values()].includes(id), `${id} (${e.typ}) ohne gültige GlobalId`);
    }
  });

  it("je Katalogtyp genau ein IfcRelDefinesByType mit gültigen Verweisen", () => {
    const rels = [...m.entries()].filter(([, e]) => e.typ === "IFCRELDEFINESBYTYPE");
    const typen = [...m.entries()].filter(([, e]) => /^IFC(WALL|SLAB|COVERING)TYPE$/.test(e.typ));
    assert.equal(rels.length, typen.length);
    const erwarteteGuids = [...sz.erwartet.wandTypen, ...sz.erwartet.belagTypen].map((s) => katalogTypGuid(s)).sort();
    assert.deepEqual(typen.map(([, e]) => attribute(e.args)[0].slice(1, -1)).sort(), erwarteteGuids);
    const elementKlasse = { IFCWALLTYPE: "IFCWALL", IFCSLABTYPE: "IFCSLAB", IFCCOVERINGTYPE: "IFCCOVERING" };
    const getypt = new Set();
    for (const [typId, typ] of typen) {
      const zu = rels.filter(([, r]) => attribute(r.args)[5] === typId);
      assert.equal(zu.length, 1, `${typId}: ${zu.length} Zuordnungen`);
      const objekte = refs(attribute(zu[0][1].args)[4]);
      assert.ok(objekte.length >= 1);
      for (const o of objekte) {
        assert.equal(m.get(o)?.typ, elementKlasse[/** @type {keyof typeof elementKlasse} */ (typ.typ)], `${o} unter ${typId}`);
        assert.equal(getypt.has(o), false, `${o} zweimal typisiert`);
        getypt.add(o);
      }
    }
    // 3 catalogue walls + 1 covering are typed; hull walls, slabs, roof and dormer are not
    assert.equal(getypt.size, sz.opts.customWalls.length + sz.opts.customSlabs.length);
  });

  it("die DG-Katalogwand ist vom Dach geschnitten (Profil), ohne Gebäudedach rechteckig", async () => {
    const gkGuid = katalogTypGuid("gk-2-lagen-12-5-cm");
    const waendeDesTyps = (/** @type {Map<string, {typ: string, args: string}>} */ mm) => {
      const typ = [...mm.entries()].find(([, e]) => e.typ === "IFCWALLTYPE" && e.args.startsWith(`'${gkGuid}'`));
      const rel = [...mm.values()].find((e) => e.typ === "IFCRELDEFINESBYTYPE" && attribute(e.args)[5] === typ?.[0]);
      return refs(attribute(/** @type {{args: string}} */ (rel).args)[4]);
    };
    // with the roof: one of the two partition walls has a profile with more than four corners (cut at both eaves and the ridge)
    const mit = waendeDesTyps(m).map((id) => profilPunkte(m, id));
    assert.equal(mit.length, 2);
    assert.ok(Math.max(...mit) > 4, `Profilpunkte ${mit}`);
    assert.ok(Math.min(...mit) <= 4, `die EG-Wand bleibt rechteckig: ${mit}`);
    const ohneDach = entitaeten(await exportIFCMitKatalog(sz.model, { ...sz.opts, dachGlobal: null, gauben: [] }));
    assert.ok(Math.max(...waendeDesTyps(ohneDach).map((id) => profilPunkte(ohneDach, id))) <= 4);
  });
});
