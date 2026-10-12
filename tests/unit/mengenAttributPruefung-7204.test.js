// 72-04: attribute check before the quantity takeover model → LV position.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefeAttributeVorUebernahme, kgAusModell, kgPasst } from "@ifc/lib/mengenAttributPruefung";

const wand = (fire, load, kg = "341") => ({
  ifcType: "IfcWall",
  classifications: kg ? [`${kg} Tragende Innenwände`] : [],
  psets: { Pset_WallCommon: { ...(fire != null ? { FireRating: fire } : {}), ...(load != null ? { LoadBearing: load } : {}) } },
});
const keys = (r) => r.befunde.map((b) => `${b.key}:${b.status}`).sort();

test("complete and consistent → no findings", () => {
  const r = pruefeAttributeVorUebernahme([wand("REI 90", true), wand("REI 90", ".T.")], { din276: "341", din276_fassung: "2018" });
  assert.equal(r.geprueft, 2);
  assert.deepEqual(r.befunde, []);
});

test("missing attributes are offen, never silently fine", () => {
  const r = pruefeAttributeVorUebernahme([wand(null, null, null)], null);
  assert.deepEqual(keys(r), ["feuer_fehlt:offen", "kg_abgeleitet:offen", "tragend_fehlt:offen"]);
});

test("mixed qualities and a foreign cost group are warn", () => {
  const r = pruefeAttributeVorUebernahme([wand("REI 30", true), wand("REI 90", false, "342")], { din276: "341" });
  assert.deepEqual(keys(r), ["feuer_gemischt:warn", "kg_abweichend:warn", "tragend_gemischt:warn"]);
  assert.deepEqual(r.befunde.find((b) => b.key === "feuer_gemischt").werte, ["REI 30", "REI 90"]);
});

test("cost group hierarchy and 2008 positions", () => {
  assert.ok(kgPasst("340", "342"));
  assert.ok(!kgPasst("341", "342"));
  assert.equal(kgAusModell({ classification: { code: "331" } }), "331");
  assert.equal(kgAusModell({}), null);
  const r = pruefeAttributeVorUebernahme([wand("REI 90", true, "331")], { din276: "341", din276_fassung: "2008" });
  assert.deepEqual(r.befunde, [], "2008 codes are not compared with 2018 element codes");
});

test("classes without fire/load-bearing relevance are not asked for them", () => {
  const r = pruefeAttributeVorUebernahme([{ ifcType: "IfcFurnishingElement", classifications: ["610"] }], null);
  assert.deepEqual(r.befunde, []);
});
