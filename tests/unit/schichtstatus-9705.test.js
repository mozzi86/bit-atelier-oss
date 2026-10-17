// 97-05: status per layer (existing wall + new insulation), a NEW opening in an EXISTING wall is a
// demolition quantity of its own, closing an opening is its own element (Zumauerung).
import { test } from "node:test";
import assert from "node:assert/strict";
import { steckbrief } from "@core/lib/bauteil/steckbrief.js";
import { classifiedElements } from "@core/lib/bimClassification.js";
import { fehlplanungPruefen } from "@core/lib/bauteil/pruefregeln.js";

const wand = (extra = {}) => ({ a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, height: 3, composite: "cavity", _idx: 1, ...extra });

test("Schichten erben den Bauteilstatus, eigene Schicht-Status gehen vor", () => {
  const s = steckbrief(wand({ status: "bestand", schicht_status: { 2: "neubau" } }), "wand-aussen");
  assert.deepEqual(s.aufbau.schichten.map((l) => l.status), ["bestand", "bestand", "neubau", "bestand", "bestand"]);
  assert.deepEqual(s.aufbau.schichten.map((l) => l.statusGeerbt), [true, true, false, true, true]);
  assert.equal(steckbrief(wand(), "wand-aussen").aufbau.schichten[0].status, null, "ohne Status bleibt ohne");
});

test("neue Öffnung in Bestandswand → eigene Abbruchmenge; sonst Liste unverändert", () => {
  const fenster = { wallIdx: 1, kind: "window", typeId: null, _idx: 4, u: 3, width: 1.2, height: 1.5 };
  const ohne = classifiedElements({ customWalls: [wand()], customWindows: [fenster] });
  assert.ok(!ohne.some((e) => e.id.startsWith("oeffnung-abbruch-")));
  const mit = classifiedElements({ customWalls: [wand({ status: "bestand", thickness: 0.3 })], customWindows: [{ ...fenster, status: "neubau" }] });
  const a = mit.find((e) => e.id === "oeffnung-abbruch-4");
  assert.equal(a.status, "abbruch"); assert.equal(a.kg, "394");
  assert.equal(a.mengen.area, 1.8);
  assert.equal(a.mengen.volume, 0.828, "Dicke aus dem Schichtaufbau (46 cm), nicht aus thickness");
});

test("Regel 6: Kern Abbruch + Schicht bleibt; Öffnung abgebrochen ohne Zumauerung; mit Zumauerung ruhig", () => {
  const b = fehlplanungPruefen({ modell: { customWalls: [wand({ status: "bestand", schicht_status: { 3: "abbruch", 2: "neubau" } })] } });
  assert.deepEqual(b.map((x) => x.code), ["schichtstatus_widerspruch"]);
  const fenster = { wallIdx: 1, kind: "window", _idx: 4, u: 3, status: "abbruch" };
  const modell = { customWalls: [wand({ status: "bestand" })], customWindows: [fenster] };
  assert.deepEqual(fehlplanungPruefen({ modell }).map((x) => x.code), ["zumauerung_fehlt"]);
  modell.customWalls.push({ a: { x: 2.4, z: 0 }, b: { x: 3.6, z: 0 }, level: 0, thickness: 0.24, _idx: 9, bauteil_typ: "zumauerung", status: "neubau" });
  assert.deepEqual(fehlplanungPruefen({ modell }), []);
  assert.equal(steckbrief(modell.customWalls[1], "wand-innen").label, "Zumauerung");
});
