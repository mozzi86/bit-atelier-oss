// 97-02a: the fire stop is its own element at the opening — rating ≥ penetrated element,
// approval, marking; opening and stop each have a data sheet (provision for void → opening).
// Records before 97-02a (free text `abschottung`) keep working unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { durchbruchHinweise, neuerDurchbruch, brandschottAus, durchbruchSteckbriefe, feuerMinuten } from "@/lib/werkplanung/durchbrueche.js";

const GUID = "0123456789ABCDEFGHIJKL";
const basis = { art: "durchbruch", form: "rechteck", b: 0.2, h: 0.2, x: 1, y: 1, z: 1, bauteil_guid: GUID, status: "beantragt" };
const codes = (d) => durchbruchHinweise(d).map((h) => h.code).sort();

test("Feuerwiderstand in Minuten", () => {
  assert.equal(feuerMinuten("EI 90"), 90);
  assert.equal(feuerMinuten("ohne"), 0);
  assert.equal(feuerMinuten("REI 90"), null);
});

test("Formular → Brandschott nur bei Feuerwiderstand und Angaben; Klasse folgt dem Bauteil", () => {
  assert.equal(brandschottAus({ feuerwiderstand: "ohne", schott_system: "X" }), null);
  assert.equal(brandschottAus({ feuerwiderstand: "EI 90" }), null);
  const s = brandschottAus({ feuerwiderstand: "EI 90", schott_system: "Mörtelschott", schott_zulassung_art: "abZ", schott_zulassung_nr: "Z-19.53-0000" });
  assert.deepEqual(s, { klasse: "EI 90", system: "Mörtelschott", zulassung_art: "abZ", zulassung_nr: "Z-19.53-0000", hersteller: "", kennzeichnung: false });
  const d = neuerDurchbruch({ art: "kernbohrung", d_mm: "150", feuerwiderstand: "EI 90", schott_system: "Manschette" }, { projectId: "p", alle: [], rng: () => 0.5 });
  assert.equal(d.brandschott.klasse, "EI 90");
  assert.equal(neuerDurchbruch({ art: "durchbruch" }, { projectId: "p", alle: [], rng: () => 0.5 }).brandschott, null);
});

test("Prüfhinweise: altes Freitextfeld gilt weiter, Schott schwächer warnt, Zulassung und Schild fehlen", () => {
  assert.deepEqual(codes({ ...basis, feuerwiderstand: "EI 90" }), ["abschottung_fehlt"]);
  assert.deepEqual(codes({ ...basis, feuerwiderstand: "EI 90", abschottung: "System X, Z-19" }), [], "Datensätze vor 97-02a");
  assert.deepEqual(codes({ ...basis, feuerwiderstand: "EI 90", brandschott: { klasse: "EI 60", system: "X", zulassung_nr: "Z-1" } }), ["schott_schwaecher"]);
  assert.deepEqual(codes({ ...basis, feuerwiderstand: "EI 90", brandschott: { klasse: "EI 120", system: "X", zulassung_nr: "" } }), ["schott_zulassung_fehlt"]);
  assert.deepEqual(codes({ ...basis, status: "ausgefuehrt", feuerwiderstand: "EI 30", brandschott: { klasse: "EI 30", system: "X", zulassung_nr: "Z-1", kennzeichnung: false } }), ["schott_kennzeichnung_fehlt"]);
  const warn = durchbruchHinweise({ ...basis, feuerwiderstand: "EI 90", brandschott: { klasse: "EI 60", system: "X", zulassung_nr: "Z" } });
  assert.equal(warn[0].stufe, "warn", "Haftungsfrage: Hinweis, keine Sperre");
});

test("Steckbriefe: beantragt = Provision for Void, ausgeführt = Öffnung, Schott eigenes Bauteil (LB 047)", () => {
  const a = durchbruchSteckbriefe({ ...basis, id: "x1" }, { projektId: "p" });
  assert.deepEqual(a.durchbruch.ifc, { klasse: "IfcBuildingElementProxy", typ: "PROVISIONFORVOID" });
  assert.equal(a.brandschott, null);
  const b = durchbruchSteckbriefe({ ...basis, id: "x1", status: "ausgefuehrt", brandschott: { klasse: "EI 90", system: "Mörtel", hersteller: "H" } }, { projektId: "p" });
  assert.deepEqual(b.durchbruch.ifc, { klasse: "IfcOpeningElement", typ: "OPENING" });
  assert.equal(b.brandschott.gewerk.lb, "047");
  assert.equal(b.brandschott.material, "Mörtel, H");
  assert.notEqual(b.durchbruch.guid, b.brandschott.guid);
  assert.equal(a.durchbruch.guid, durchbruchSteckbriefe({ ...basis, id: "x1" }, { projektId: "p" }).durchbruch.guid);
});
