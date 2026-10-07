// Mengenbasen: 15 benannte IFC-BaseQuantities + die 4 Altwerte als Alias (Phase 33 / W2).
//
// Warum getestet: „area/volume/length" waren drei Kübel, in die der IFC-Import alles
// warf, was seinem Regex entsprach — `NetFloorArea` entsprach keinem und fiel ersatzlos
// weg. Das ist die größte Einzelmenge des Realprojekts. Und die 4 Altwerte MÜSSEN
// erhalten bleiben, sonst brechen bestehende Filter und Positionen still.

import test from "node:test";
import assert from "node:assert/strict";
import {
  QUANTITY_BASES,
  IFC_QUANTITY_KEYS,
  ALIAS_QUELLEN,
  mengenAusQty,
  basisEinheit,
  quantityFromElements,
  floorElements,
} from "@core/lib/bimElements";

test("es gibt 15 IFC-Basen und alle stehen in QUANTITY_BASES", () => {
  assert.equal(IFC_QUANTITY_KEYS.length, 15);
  assert.equal(new Set(IFC_QUANTITY_KEYS).size, 15, "keine Dubletten");
  const werte = QUANTITY_BASES.map((b) => b.value);
  for (const k of IFC_QUANTITY_KEYS) assert.ok(werte.includes(k), `${k} fehlt`);
  assert.ok(werte.includes("NetFloorArea"), "NetFloorArea ist die größte Menge des Projekts");
});

test("die 4 Altwerte bleiben als Alias erhalten (Rückwärtskompatibilität)", () => {
  const werte = QUANTITY_BASES.map((b) => b.value);
  for (const alt of ["area", "volume", "length", "count"]) {
    assert.ok(werte.includes(alt), `Altwert ${alt} wurde entfernt — bestehende Filter brechen`);
    assert.equal(QUANTITY_BASES.find((b) => b.value === alt).alias, true);
  }
  assert.equal(QUANTITY_BASES.length, 19);
  assert.equal(new Set(werte).size, 19, "keine doppelten Basen");
});

test("jede Basis hat Einheit und Dimension", () => {
  for (const b of QUANTITY_BASES) {
    assert.ok(b.label && b.unit && b.dimension, `${b.value} unvollständig`);
  }
  assert.equal(basisEinheit("NetFloorArea"), "m²");
  assert.equal(basisEinheit("Length"), "m");
  assert.equal(basisEinheit("GibtsNicht"), "");
});

test("mengenAusQty projiziert die Altwerte über die IFC-Basen (L9)", () => {
  assert.deepEqual(mengenAusQty({ NetSideArea: 12.5, GrossSideArea: 14.75, NetVolume: 3 }), {
    area: 12.5, volume: 3, length: 0, count: 1,
  });
  // Raumfläche darf NICHT verloren gehen — der alte Import verwarf sie ersatzlos.
  assert.equal(mengenAusQty({ NetFloorArea: 23.4567 }).area, 23.4567);
  // Netto gewinnt vor Brutto (Reihenfolge in ALIAS_QUELLEN).
  assert.equal(ALIAS_QUELLEN.area[0], "NetSideArea");
  assert.equal(mengenAusQty({ GrossSideArea: 9, NetSideArea: 8 }).area, 8);
  assert.equal(mengenAusQty({ Perimeter: 4 }).length, 4);
  // count ist immer 1 — ein Bauteil ist ein Stück.
  assert.equal(mengenAusQty({}).count, 1);
  assert.deepEqual(mengenAusQty(null), { area: 0, volume: 0, length: 0, count: 1 });
});

test("mengenAusQty ignoriert Unsinn statt zu werfen", () => {
  const m = mengenAusQty({ NetSideArea: "keine Zahl", GrossSideArea: -5, NetArea: 7 });
  assert.equal(m.area, 7, "negative und nicht-numerische Werte werden übersprungen");
  assert.equal(mengenAusQty({ NetVolume: NaN }).volume, 0);
});

test("die Bestandsfunktionen des Demo-Modells rechnen unverändert", () => {
  const els = floorElements({ floors: 3, area_net: 600 });
  assert.equal(els.length, 3);
  assert.ok(quantityFromElements({ floors: 3, area_net: 600 }, ["floor-0"], "area") > 0);
  assert.equal(quantityFromElements({ floors: 3 }, ["floor-0", "floor-1"], "count"), 2);
});
