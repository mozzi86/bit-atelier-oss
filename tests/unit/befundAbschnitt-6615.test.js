// Unit tests 66-15: finding ↔ construction section (@ifc/lib/befundAbschnitt.js) and the
// new optional field `geschosse` of a delivery (lieferplan.js, lieferung_layer v2).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abschnittsTermine, abschnittVonBefund, ordneNachAbschnitt, befundeJeAbschnitt, schwereVon,
  MAX_ABSCHNITTE, OHNE_ABSCHNITT,
} from "@ifc/lib/befundAbschnitt.js";
import { normalisiereLayer, lieferungAnlegen, sollIst } from "@ifc/lib/lieferplan.js";
import { LAYER_VERSION, migrateLayer } from "@core/lib/fachlayerSchema.js";

const HEUTE = "2026-10-12";
const plan = [
  { id: "a", nr: 1, status: "geplant", termin: "2026-11-20", bauabschnitt: "gesamt", geschosse: [], log: 300 },
  { id: "b", nr: 2, status: "geplant", termin: "2026-10-22", bauabschnitt: "BA 1", geschosse: ["Erdgeschoss"], log: 400 },
  { id: "c", nr: 3, status: "geliefert", termin: "2026-10-01", bauabschnitt: "BA 0", geschosse: ["Erdgeschoss"], log: 400 },
  { id: "d", nr: 4, status: "geplant", termin: null, bauabschnitt: "BA 9", log: 400 },
  { id: "e", nr: 5, status: "geplant", termin: "2026-11-05", bauabschnitt: "1. Obergeschoss", log: 400 },
];
const GESCHOSSE = ["Erdgeschoss", "1. Obergeschoss", "2. Obergeschoss"];

test("abschnittsTermine: only open, dated deliveries, in date order, with days to go", () => {
  const a = abschnittsTermine(plan, { heute: HEUTE, modellGeschosse: GESCHOSSE });
  assert.deepEqual(a.map((x) => x.id), ["b", "e", "a"]);
  assert.equal(a[0].tage, 10);
  assert.deepEqual(a[0].geschosse, ["Erdgeschoss"]);
});

test("abschnittsTermine: same-named storey, else whole building (null)", () => {
  const a = abschnittsTermine(plan, { heute: HEUTE, modellGeschosse: GESCHOSSE });
  assert.deepEqual(a.find((x) => x.id === "e").geschosse, ["1. Obergeschoss"]);
  assert.equal(a.find((x) => x.id === "a").geschosse, null);
});

test("abschnittsTermine: unnamed delivery is called 'Lieferung <nr>', overdue gives negative days", () => {
  const a = abschnittsTermine([{ id: "x", nr: 7, termin: "2026-10-02" }], { heute: HEUTE });
  assert.equal(a[0].name, "Lieferung 7");
  assert.equal(a[0].tage, -10);
});

test("abschnittsTermine: at most MAX_ABSCHNITTE sections", () => {
  const viele = Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, nr: i + 1, termin: `2026-12-${String(i + 1).padStart(2, "0")}` }));
  assert.equal(abschnittsTermine(viele, { heute: HEUTE }).length, MAX_ABSCHNITTE);
});

test("abschnittVonBefund: earliest covering section; storey-less only whole-building", () => {
  const a = abschnittsTermine(plan, { heute: HEUTE, modellGeschosse: GESCHOSSE });
  assert.equal(abschnittVonBefund("erdgeschoss", a).id, "b");
  assert.equal(abschnittVonBefund("1. Obergeschoss", a).id, "e");
  assert.equal(abschnittVonBefund("2. Obergeschoss", a).id, "a");
  assert.equal(abschnittVonBefund(null, a).id, "a");
  assert.equal(abschnittVonBefund(null, a.filter((x) => x.geschosse)), null);
});

test("ordneNachAbschnitt: groups in date order, severity then report number inside", () => {
  const a = abschnittsTermine(plan, { heute: HEUTE, modellGeschosse: GESCHOSSE });
  const befunde = [
    { kind: "clearance", g: "Erdgeschoss" },
    { kind: "hard", g: "2. Obergeschoss" },
    { kind: "duplicate", g: "Erdgeschoss" },
    { kind: "hard", g: "Erdgeschoss" },
  ];
  const gr = ordneNachAbschnitt(befunde, { abschnitte: a, geschossVon: (b) => b.g });
  assert.deepEqual(gr.map((g) => g.abschnitt?.id), ["b", "a"]);
  assert.deepEqual(gr[0].befunde.map((b) => b.kind), ["hard", "duplicate", "clearance"]);
});

test("ordneNachAbschnitt: without sections one group sorted by severity", () => {
  const befunde = [{ kind: "clearance" }, { kind: "duplicate" }, { kind: "hard" }];
  const gr = ordneNachAbschnitt(befunde, { abschnitte: [], geschossVon: () => null });
  assert.equal(gr.length, 1);
  assert.equal(gr[0].key, OHNE_ABSCHNITT);
  assert.deepEqual(gr[0].befunde.map((b) => b.kind), ["hard", "duplicate", "clearance"]);
});

test("ordneNachAbschnitt: report number decides among equal severity", () => {
  const b1 = { kind: "hard" };
  const b2 = { kind: "hard" };
  const nummern = new Map([[b1, 9], [b2, 3]]);
  const gr = ordneNachAbschnitt([b1, b2], { geschossVon: () => null, nummer: (b) => nummern.get(b) });
  assert.deepEqual(gr[0].befunde, [b2, b1]);
});

test("befundeJeAbschnitt: clean sections listed with 0, rest only when not empty", () => {
  const a = abschnittsTermine(plan, { heute: HEUTE, modellGeschosse: GESCHOSSE });
  const gr = ordneNachAbschnitt([{ kind: "hard", g: "Erdgeschoss" }, { kind: "clearance", g: "Erdgeschoss" }], { abschnitte: a, geschossVon: (b) => b.g });
  const z = befundeJeAbschnitt(gr, a);
  assert.deepEqual(z.map((x) => [x.name, x.anzahl, x.hoch, x.niedrig]), [["BA 1", 2, 1, 1], ["1. Obergeschoss", 0, 0, 0], ["gesamt", 0, 0, 0]]);
  const ohne = befundeJeAbschnitt(ordneNachAbschnitt([{ kind: "duplicate" }], { geschossVon: () => null }), []);
  assert.deepEqual(ohne, [{ name: OHNE_ABSCHNITT, termin: null, tage: null, anzahl: 1, hoch: 0, mittel: 1, niedrig: 0 }]);
});

test("schwereVon: unknown kinds rank low", () => {
  assert.equal(schwereVon("hard"), 1);
  assert.equal(schwereVon("gibt-es-nicht"), 3);
});

test("lieferplan: `geschosse` is normalised, kept and new deliveries start empty", () => {
  const layer = normalisiereLayer({ lieferungen: [{ id: "x", termin: "2026-10-20", geschosse: [" EG ", "", "EG", 5, null] }] });
  assert.deepEqual(layer.lieferungen[0].geschosse, ["EG", "5"]);
  assert.deepEqual(normalisiereLayer({ lieferungen: [{ id: "y" }] }).lieferungen[0].geschosse, []);
  assert.deepEqual(lieferungAnlegen(layer, { termin: "2026-10-30" }).lieferung.geschosse, []);
  assert.deepEqual(sollIst(layer, HEUTE)[0].geschosse, ["EG", "5"]);
});

test("fachlayerSchema: lieferung_layer is v2, a v1 blob migrates unchanged", () => {
  assert.equal(LAYER_VERSION.lieferung_layer, 2);
  const alt = { v: 1, fachsicht: "TX", lieferungen: [{ id: "a", termin: "2026-10-20" }] };
  const neu = migrateLayer("lieferung_layer", alt).wert;
  assert.equal(neu.v, 2);
  assert.deepEqual(neu.lieferungen, alt.lieferungen);
});
