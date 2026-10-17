// 97-01: one look per renovation status, following the state permit regulations
// (Bestand grey, Neubau red, Abbruch yellow); unknown never looks like new build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS_DARSTELLUNG, statusDarstellung, statusFarbe, statusRgb } from "@core/lib/plan/statusDarstellung.js";
import { STATUS_COLORS } from "@ifc/lib/ifcGeometry";

test("Konvention: Abbruch gelb, Neubau rot, Bestand grau", () => {
  const [r, g, b] = statusRgb("abbruch");
  assert.ok(r > 0.8 && g > 0.6 && b < 0.3, "Abbruch ist gelb");
  const [r2, g2] = statusRgb("neubau");
  assert.ok(r2 > 0.7 && g2 < 0.4, "Neubau ist rot");
  const [r3, g3, b3] = statusRgb("bestand");
  assert.ok(Math.abs(r3 - g3) < 0.1 && Math.abs(g3 - b3) < 0.1, "Bestand ist grau");
});

test("ohne / unbekannt / null sehen nie wie Neubau aus", () => {
  for (const s of [null, undefined, "unbekannt", "quatsch"]) {
    assert.equal(statusDarstellung(s), STATUS_DARSTELLUNG.ohne);
    assert.notEqual(statusFarbe(s), statusFarbe("neubau"));
  }
});

test("Viewer liest dieselbe Tabelle (keine zweite Farbwelt)", () => {
  for (const s of ["abbruch", "neubau", "bestand"]) assert.deepEqual(STATUS_COLORS[s], [...statusRgb(s)]);
  assert.deepEqual(STATUS_COLORS.unbekannt, [...statusRgb(null)]);
});
