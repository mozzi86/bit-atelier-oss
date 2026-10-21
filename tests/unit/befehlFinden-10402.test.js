// 104-02: typed command → tool: short form, full name, unique prefix, umlauts, ambiguity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { befehlFinden } from "@core/lib/befehlszeile.js";

const B = [
  { id: "linie", label: "Linie", kurz: ["l"] },
  { id: "pushpull", label: "Push/Pull", kurz: ["p", "pp"] },
  { id: "verschieben", label: "Verschieben", kurz: ["m"] },
  { id: "gelaende", label: "Gelände", kurz: ["g"] },
  { id: "drehen", label: "Drehen", kurz: ["q"] },
];

test("Kurzform, voller Name, eindeutiger Anfang, Umlaut, Groß/klein", () => {
  assert.deepEqual(befehlFinden("L", B), { id: "linie" });
  assert.deepEqual(befehlFinden("pp", B), { id: "pushpull" });
  assert.deepEqual(befehlFinden("push/pull", B), { id: "pushpull" });
  assert.deepEqual(befehlFinden("ver", B), { id: "verschieben" });
  assert.deepEqual(befehlFinden("Gelände", B), { id: "gelaende" });
  assert.deepEqual(befehlFinden("gelae", B), { id: "gelaende" });
});

test("mehrdeutig oder unbekannt", () => {
  assert.deepEqual(befehlFinden("d", [...B, { id: "dach", label: "Dach" }]), { kandidaten: ["drehen", "dach"] });
  assert.equal(befehlFinden("xyz", B), null);
  assert.equal(befehlFinden("  ", B), null);
});
