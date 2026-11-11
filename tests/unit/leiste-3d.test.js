// Unit tests for leiste.js (quick task 261110-mzl): which entries the "3D-Fenster" bar shows and what the tooltip says.
// Style: node:test, German titles.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { leistenEintraege, leistenTitel } from "@core/lib/zeigen/leiste.js";

const eintrag = (id, mehr = {}) => ({ id, text: `Text ${id}`, symbol: () => null, onClick: () => {}, ...mehr });

describe("leistenEintraege", () => {
  it("behält die Reihenfolge und lässt Leeres und Ausgeblendetes weg", () => {
    const liste = [eintrag("a"), null, eintrag("b", { sichtbar: false }), false, undefined, eintrag("c", { sichtbar: true })];
    assert.deepEqual(leistenEintraege(liste).map((e) => e.id), ["a", "c"]);
  });
  it("zeigt Gesperrtes weiter an (kein verschwindender Knopf)", () => {
    assert.deepEqual(leistenEintraege([eintrag("a", { gesperrt: true })]).map((e) => e.id), ["a"]);
  });
  it("jede Kennung nur einmal, die erste gewinnt", () => {
    const erste = eintrag("a", { text: "erste" });
    const out = leistenEintraege([erste, eintrag("a", { text: "zweite" })]);
    assert.equal(out.length, 1);
    assert.equal(out[0], erste);
  });
  it("ohne Kennung kein Eintrag; leere Eingabe ergibt eine leere Leiste", () => {
    assert.deepEqual(leistenEintraege([eintrag("")]), []);
    assert.deepEqual(leistenEintraege([]), []);
    assert.deepEqual(leistenEintraege(/** @type {any} */ (null)), []);
  });
});

describe("leistenTitel", () => {
  it("übersetzter Text, mit Taste dahinter", () => {
    const t = (s) => s.toUpperCase();
    assert.equal(leistenTitel(eintrag("a"), t), "TEXT A");
    assert.equal(leistenTitel(eintrag("a", { taste: "F3" }), t), "TEXT A · F3");
    assert.equal(leistenTitel(eintrag("a", { taste: "F3" })), "Text a · F3");
  });
});
