// 115-13: IFC structure of the two-flight stair with intermediate landing — the 114-02 combination scenario (catalogue types, gable,
// dormer) with its straight stair replaced by a U stair at the same antritt. Checked on the STEP text: IfcStair HALF_TURN_STAIR
// aggregates exactly two IfcStairFlight (9 + 8 risers of the 2.90 m EG: n = 17, n1 = ceil(17 / 2) = 9, n2 = 8) and one IfcSlab LANDING,
// the stair carries Pset_StairCommon / Pset_BIT_Bauteil like the straight stair, the derived slab opening is an L-shaped hexagon, every
// `#n` resolves and the GlobalIds are unique. Then the file is read back with web-ifc (ifcLesen, main-thread fallback in node).
// The straight stair's export is guarded byte for byte by the existing goldens and by ifcExport-kombi-11402.test.js.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { exportIFCMitKatalog } from "@designer/lib/ifcExport";
import { ladeKatalog } from "@core/lib/bauteil/katalog/index.js";
import { TREPPE_U } from "@core/lib/bauteil/treppeU.js";
import { ifcLesen } from "../../packages/nova-ifc-viewer/src/lib/ifcLesen.js";
import { ifcKombiSzenario } from "./fixtures/ifcKatalogKombi-11402.js";

/** id → {typ, args} of the DATA section. @param {string} text @returns {Map<string, {typ: string, args: string}>} */
function entitaeten(text) {
  const m = new Map();
  for (const z of text.matchAll(/^(#\d+)=([A-Z0-9]+)\((.*)\);$/gm)) {
    assert.equal(m.has(z[1]), false, `Entity-Id doppelt: ${z[1]}`);
    m.set(z[1], { typ: z[2], args: z[3] });
  }
  return m;
}
const refs = (/** @type {string} */ s) => s.match(/#\d+/g) || [];
/** Top-level attributes of an args text. @param {string} args @returns {string[]} */
function attribute(args) {
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

/** @type {string} */ let text;
/** @type {Map<string, {typ: string, args: string}>} */ let m;
/** @type {string[]} */ const meldungen = [];

before(async () => {
  assert.equal(await ladeKatalog(), true);
  const sz = ifcKombiSzenario();
  const gerade = sz.opts.customStairs[0];
  const opts = { ...sz.opts, customStairs: [{ ...gerade, art: TREPPE_U }], onWarn: (/** @type {string} */ msg) => meldungen.push(msg) };
  text = await exportIFCMitKatalog(sz.model, opts);
  m = entitaeten(text);
});

describe("115-13 IFC: IfcStair → 2 × IfcStairFlight + IfcSlab LANDING", () => {
  it("exports without a warning; one stair, two flights, one landing, aggregated together", () => {
    assert.deepEqual(meldungen, []);
    const von = (/** @type {string} */ typ) => [...m.entries()].filter(([, e]) => e.typ === typ);
    const treppen = von("IFCSTAIR");
    assert.equal(treppen.length, 1);
    assert.equal(attribute(treppen[0][1].args)[8], ".HALF_TURN_STAIR.");
    const laeufe = von("IFCSTAIRFLIGHT");
    assert.equal(laeufe.length, 2);
    // NumberOfRisers / NumberOfTreads / RiserHeight / TreadLength / PredefinedType (attributes 8…12)
    assert.deepEqual(laeufe.map(([, e]) => attribute(e.args).slice(8)), [["9", "8", "0.1706", "0.2888", ".STRAIGHT."], ["8", "7", "0.1706", "0.2888", ".STRAIGHT."]]);
    const podeste = von("IFCSLAB").filter(([, e]) => attribute(e.args)[8] === ".LANDING.");
    assert.equal(podeste.length, 1);
    const agg = von("IFCRELAGGREGATES").filter(([, e]) => attribute(e.args)[4] === treppen[0][0]);
    assert.equal(agg.length, 1);
    assert.deepEqual(refs(attribute(agg[0][1].args)[5]).sort(), [...laeufe.map(([id]) => id), podeste[0][0]].sort());
    // every part has a body: flight 1 has 8 treads, flight 2 seven, the landing one plate
    const koerper = (/** @type {string} */ id) => refs(attribute(/** @type {any} */ (m.get(refs(attribute(/** @type {any} */ (m.get(refs(attribute(/** @type {any} */ (m.get(id)).args)[6])[0])).args)[2])[0])).args)[3]).length;
    assert.deepEqual([...laeufe.map(([id]) => koerper(id)), koerper(podeste[0][0])], [8, 7, 1]);
  });

  it("property sets of the stair and the landing", () => {
    const werte = (/** @type {string} */ name) => {
      const ps = [...m.values()].find((e) => e.typ === "IFCPROPERTYSET" && attribute(e.args)[2] === `'${name}'`);
      assert.ok(ps, name);
      return refs(attribute(ps.args)[4]).map((r) => attribute(/** @type {any} */ (m.get(r)).args)[0]);
    };
    assert.ok(werte("Pset_StairCommon").includes("'NumberOfRiser'"));
    const bit = [...m.values()].filter((e) => e.typ === "IFCPROPERTYSET" && attribute(e.args)[2] === "'Pset_BIT_Bauteil'")
      .map((e) => refs(attribute(e.args)[4]).map((r) => /** @type {any} */ (m.get(r)).args).join("|"));
    assert.ok(bit.some((b) => b.includes("Treppe (zweil") && b.includes("'Treppenauge'") && b.includes("'Podesttiefe'")), "stair data sheet");
    assert.ok(bit.some((b) => b.includes("'Podest'")), "landing data sheet");
  });

  it("the slab opening above is the L-shaped hexagon (IfcOpeningElement + IfcRelVoidsElement)", () => {
    const op = [...m.entries()].filter(([, e]) => e.typ === "IFCOPENINGELEMENT" && /Treppe/.test(attribute(e.args)[2]));
    assert.equal(op.length, 1);
    const voids = [...m.values()].filter((e) => e.typ === "IFCRELVOIDSELEMENT" && attribute(e.args)[5] === op[0][0]);
    assert.equal(voids.length, 1);
    // largest polyline reachable from the representation (attribute 6) of the opening
    const gesehen = new Set(), offen = refs(attribute(/** @type {any} */ (m.get(op[0][0])).args)[6]);
    while (offen.length) { const id = /** @type {string} */ (offen.pop()); if (gesehen.has(id)) continue; gesehen.add(id); offen.push(...refs(m.get(id)?.args || "")); }
    const ecken = Math.max(...[...gesehen].map((id) => m.get(id)).filter((e) => e?.typ === "IFCPOLYLINE").map((e) => new Set(refs(/** @type {any} */ (e).args)).size));
    assert.equal(ecken, 6);
  });

  it("every #n reference resolves, GlobalIds unique", () => {
    const fehlend = [];
    for (const [id, e] of m) for (const r of refs(e.args)) if (!m.has(r)) fehlend.push(`${id} → ${r}`);
    assert.deepEqual(fehlend, []);
    const gesehen = new Set();
    for (const [, e] of m) {
      const g = /^'([0-9A-Za-z_$]{22})',(\$|#\d+),/.exec(e.args);
      if (!g) continue;
      assert.equal(gesehen.has(g[1]), false, `GlobalId ${g[1]} doppelt`);
      gesehen.add(g[1]);
    }
  });

  it("web-ifc reads the file back (ifcLesen, main thread in node)", async () => {
    const r = await ifcLesen(new TextEncoder().encode(text).buffer, { parse: true }, () => {});
    assert.equal(r.parseFehler, null);
    const el = /** @type {any} */ (r.parsed).elements;
    assert.deepEqual(el.filter((/** @type {any} */ e) => e.ifcType === "IfcStairFlight").map((/** @type {any} */ e) => e.name), ["Treppenlauf 1", "Treppenlauf 2"]);
    assert.equal(el.filter((/** @type {any} */ e) => e.ifcType === "IfcStair").length, 1);
    assert.equal(el.filter((/** @type {any} */ e) => e.ifcType === "IfcSlab" && e.name === "Podest").length, 1);
  });
});
