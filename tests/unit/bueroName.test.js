// 94-02 (B-ABN-02): one office name — letterhead first, legacy accounting field
// only as fallback, the shipped placeholder never beats a real name.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { briefkopfName, bueroNameAus, nurAlterBueroName } from "../../src/lib/accounting/bueroName.js";

describe("bueroName (94-02)", () => {
  it("letterhead wins over the accounting copy", () => {
    assert.equal(bueroNameAus({ office: "Musterbüro Architektur" }, { buero: { name: "Architekturbüro Beispiel" } }), "Musterbüro Architektur");
  });

  it("placeholder letterhead falls back to the legacy accounting name", () => {
    assert.equal(bueroNameAus({ office: "Architekturbüro" }, { buero: { name: "Büro Alt" } }), "Büro Alt");
    assert.equal(nurAlterBueroName({ office: "Architekturbüro" }, { buero: { name: "Büro Alt" } }), true);
  });

  it("only the placeholder or nothing → empty (never the placeholder on an invoice)", () => {
    assert.equal(bueroNameAus({ office: "Architekturbüro" }, { buero: { name: "" } }), "");
    assert.equal(bueroNameAus(null, null), "");
    assert.equal(briefkopfName({ office: "  " }), "");
  });

  it("no offer to move the name when the letterhead already has one", () => {
    assert.equal(nurAlterBueroName({ office: "Musterbüro" }, { buero: { name: "Alt" } }), false);
    assert.equal(nurAlterBueroName({ office: "Architekturbüro" }, { buero: { name: "" } }), false);
  });
});
