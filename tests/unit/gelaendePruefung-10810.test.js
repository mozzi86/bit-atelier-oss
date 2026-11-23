// 108-10: openings of the outer walls against the governing terrain and the 1,40-m rule of the full storey (hillside house).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aussenNormale, oeffnungGegenGelaende, umrissUeberGelaende, geschosseGegenGelaende, VOLLGESCHOSS_UEBER_GELAENDE_M } from "@core/lib/massing/gelaendePruefung.js";
import { vollgeschossAusDach } from "@core/lib/bauteil/vollgeschoss.js";

/** 12 × 10 m house around the origin; the ground falls 0,25 m per metre towards west (x < 0): ±0,00 on the east wall. */
const FP = [{ x: -6, z: -5 }, { x: 6, z: -5 }, { x: 6, z: 5 }, { x: -6, z: 5 }];
const HANG = (/** @type {{x: number, z: number}} */ p) => Math.min(0, (p.x - 6) * 0.25);
const FLACH = () => 0;
const nahe = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

describe("108-10 Prüfungen gegen das Gelände", () => {
  it("Außennormale zeigt aus dem Umriss, gleich in welcher Richtung die Wand läuft", () => {
    assert.deepEqual(aussenNormale({ x: -6, z: -5 }, { x: 6, z: -5 }, FP), { x: 0, z: -1 });
    assert.deepEqual(aussenNormale({ x: 6, z: -5 }, { x: -6, z: -5 }, FP), { x: -0, z: -1 });
    assert.equal(aussenNormale({ x: 1, z: 1 }, { x: 1, z: 1 }, FP), null);
  });

  it("Kellerfenster an der Ostwand (bergseits) liegt unter Gelände, an der Westwand (talseits) frei", () => {
    // basement window: sill −1,60, head −0,60 (relative to ±0,00)
    const ost = oeffnungGegenGelaende({ a: { x: 6, z: -5 }, b: { x: 6, z: 5 }, u: 5, breite_m: 1, bruestung_m: -1.6, oben_m: -0.6, umriss: FP, hoeheFn: HANG });
    nahe(ost.gelaende_m, 0); // 0,5 m outside the east wall the ground is at ±0,00 (clamped by min(0, …))
    nahe(ost.unter_m, 1.6);
    assert.equal(ost.ganz, true);
    const west = oeffnungGegenGelaende({ a: { x: -6, z: 5 }, b: { x: -6, z: -5 }, u: 5, breite_m: 1, bruestung_m: -1.6, oben_m: -0.6, umriss: FP, hoeheFn: HANG });
    nahe(west.gelaende_m, -3.125, 0.01); // (−6,5 − 6) · 0,25 = −3,125 (rounded to cm)
    assert.ok(west.unter_m < 0);
    assert.equal(west.ganz, false);
  });

  it("auf der Längsseite zählt die höhere Laibung (Hang quer zur Wand)", () => {
    const sued = oeffnungGegenGelaende({ a: { x: -6, z: 5 }, b: { x: 6, z: 5 }, u: 8, breite_m: 2, bruestung_m: -1, oben_m: 0.2, umriss: FP, hoeheFn: HANG });
    // jambs at x = 1 and x = 3: ground −1,25 and −0,75 → the higher one counts
    nahe(sued.gelaende_m, -0.75);
    nahe(sued.unter_m, 0.25);
    assert.equal(sued.ganz, false);
    assert.equal(oeffnungGegenGelaende({ a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, u: NaN, breite_m: 1, bruestung_m: 0, oben_m: 1, umriss: FP, hoeheFn: HANG }), null);
  });

  it("Mittel über den Umriss: längengewichtet, flaches Gelände = Höhe selbst", () => {
    assert.deepEqual(umrissUeberGelaende(FP, 0.5, FLACH), { mittel_m: 0.5, min_m: 0.5, max_m: 0.5 });
    const m = umrissUeberGelaende(FP, 0, HANG);
    // east wall 0, west wall 3, north and south walls run from 0 to 3 (mean 1,5): (10·0 + 10·3 + 12·1,5 + 12·1,5) / 44 = 1,5
    nahe(m.mittel_m, 1.5, 0.01);
    nahe(m.min_m, 0, 0.1);
    nahe(m.max_m, 3, 0.01);
    assert.equal(umrissUeberGelaende([], 0, FLACH), null);
  });

  it("1,40-m-Regel je Geschoss: Keller am Hang wird Vollgeschoss, im flachen Gelände nicht", () => {
    const storeys = [{ level: 0, name: "EG", elevation: 0 }, { level: 1, name: "DG", elevation: 2.9 }, { level: -1, name: "KG", elevation: -2.75 }];
    const hang = geschosseGegenGelaende(storeys, FP, HANG);
    assert.deepEqual(hang.map((g) => g.name), ["KG", "EG"]); // top storey left out
    nahe(hang[0].deckenOK_m, 0);
    assert.ok(hang[0].mittel_m > VOLLGESCHOSS_UEBER_GELAENDE_M);
    assert.equal(hang[0].voll140, true);
    const flach = geschosseGegenGelaende(storeys, FP, FLACH);
    assert.equal(flach[0].voll140, false); // ceiling top on ±0,00 = 0 m above flat ground
    assert.equal(flach[1].voll140, true); // EG: ceiling top 2,90 m above ground
  });

  it("Dachgeschoss: ohne Geländewert wie bisher, mit Wert unter 1,40 m kein Vollgeschoss", () => {
    const grundriss = FP;
    const ebenen = [{ punkt: { x: 0, y: 10, z: 0 }, normale: { x: 0, y: 1, z: 0 } }]; // flat plane 10 m up: everything ≥ 2,30 m
    const ohne = vollgeschossAusDach({ grundriss, dachEbenen: ebenen, boden_m: 0 });
    assert.equal(ohne.voll, true);
    assert.equal(ohne.grund, "Gelände fehlt");
    const hoch = vollgeschossAusDach({ grundriss, dachEbenen: ebenen, boden_m: 0, ueberGelaende_m: 5.2 });
    assert.equal(hoch.voll, true);
    assert.equal(hoch.grund, "");
    const tief = vollgeschossAusDach({ grundriss, dachEbenen: ebenen, boden_m: 0, ueberGelaende_m: 1.2 });
    assert.equal(tief.voll, false);
    assert.match(tief.grund, /1,40 m/);
  });
});
