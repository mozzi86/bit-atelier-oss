// 97-06: checks against wrong planning on the ONE model — hints, never blocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fehlplanungPruefen, feuerMinuten } from "@core/lib/bauteil/pruefregeln.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 3 }, b: { x: 6, z: idx * 3 }, level: 0, thickness: 0.24, _idx: idx, ...extra });
const codes = (b) => b.map((x) => `${x.regel}:${x.code}`).sort();

test("leeres Modell, Neubau ohne Status: keine Befunde", () => {
  assert.deepEqual(fehlplanungPruefen({ modell: {} }), []);
  assert.deepEqual(fehlplanungPruefen({ modell: { customWalls: [wand(1)] } }), []);
});

test("1: Bestandsprojekt — Bauteile ohne Status gesammelt, Hülle eingeschlossen", () => {
  const b = fehlplanungPruefen({ modell: { customWalls: [wand(1), wand(2, { status: "bestand" })], customColumns: [{ x: 1, z: 1, _idx: 5 }] }, bauart: "bestand" });
  assert.deepEqual(codes(b), ["1:ohne_status"]);
  assert.deepEqual(b[0].ids, ["wall-1", "column-5", "hull-wall"]);
  assert.equal(b[0].stufe, "hinweis");
});

test("3 + 5: Fenster in Abbruchwand, tragende Wand ohne Statikvermerk (mit Vermerk ruhig)", () => {
  const modell = { customWalls: [wand(1, { status: "abbruch" })], customWindows: [{ wallIdx: 1, kind: "window", _idx: 9, u: 2 }] };
  assert.deepEqual(codes(fehlplanungPruefen({ modell })), ["3:oeffnung_in_abbruchwand", "5:abbruch_tragend"]);
  modell.customWalls[0].statik_vermerk = "Abfangung lt. Statik Pos. 12";
  modell.customWindows[0].status = "abbruch";
  assert.deepEqual(fehlplanungPruefen({ modell }), []);
  assert.deepEqual(fehlplanungPruefen({ modell: { customWalls: [wand(1, { status: "abbruch", thickness: 0.115 })] } }), [], "nichttragende Wand: kein Statikhinweis");
});

test("8, 9, 10: Durchbrüche — ohne Schott, Schott schwächer, tragend ohne Statik, in Abbruchwand", () => {
  const w = wand(1, { status: "abbruch" });
  const guid = bauteilGuid("p", "customWalls", w);
  const d = [
    { nr: "D-001", feuerwiderstand: "EI 90", status: "beantragt" },
    { nr: "D-002", feuerwiderstand: "EI 90", brandschott: { klasse: "EI 60" }, status: "beantragt" },
    { nr: "D-003", bauteil_guid: guid, feuerwiderstand: "ohne", status: "beantragt", pruefung: { statik: null } },
    { nr: "D-004", feuerwiderstand: "EI 90", status: "abgelehnt" },
  ];
  const b = fehlplanungPruefen({ modell: { customWalls: [w] }, durchbrueche: d, projektId: "p" });
  assert.deepEqual(codes(b), ["10:durchbruch_in_abbruchwand", "5:abbruch_tragend", "8:schott_fehlt", "8:schott_schwaecher", "9:durchbruch_tragend_ohne_statik"]);
  d[2].pruefung = { statik: { ergebnis: "ok" } };
  assert.ok(!codes(fehlplanungPruefen({ modell: { customWalls: [w] }, durchbrueche: d, projektId: "p" })).includes("9:durchbruch_tragend_ohne_statik"));
});

test("11: Leitung kreuzt Wand — ohne Durchbruch Hinweis, mit Durchbruch an der Stelle ruhig, Abbruchwand egal", () => {
  const w = wand(1);
  const netz = { kanten: [{ id: "k1", gewerk: "heizung", level: 0, points: [{ x: 3, z: 0 }, { x: 3, z: 6 }] }] };
  const b = fehlplanungPruefen({ modell: { customWalls: [w], netz_layer: netz }, projektId: "p" });
  assert.deepEqual(codes(b), ["11:kreuzung_ohne_durchbruch"]);
  assert.deepEqual(b[0].ids, ["k1×wall-1"]);
  const d = [{ nr: "D-1", bauteil_guid: bauteilGuid("p", "customWalls", w), x: 3.2, y: 3, status: "beantragt", pruefung: { statik: { ergebnis: "ok" } } }];
  assert.deepEqual(fehlplanungPruefen({ modell: { customWalls: [w], netz_layer: netz }, durchbrueche: d, projektId: "p" }), []);
  assert.deepEqual(fehlplanungPruefen({ modell: { customWalls: [wand(1, { status: "abbruch", statik_vermerk: "x" })], netz_layer: netz } }), []);
});

test("Werkstatt-Wände zählen mit ihrem Tabellenstatus; feuerMinuten", () => {
  const werkstatt = { waende: [{ guid: "G1", level: 0, a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, tragend: true, status: null }], tueren: [] };
  const modell = { bauteil_attribute_layer: { attribute: { "wt-wall-G1": { status: "abbruch" } } } };
  assert.deepEqual(codes(fehlplanungPruefen({ modell, werkstatt })), ["5:abbruch_tragend"]);
  assert.equal(feuerMinuten("EI 120"), 120);
});
