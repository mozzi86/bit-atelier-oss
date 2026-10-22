// LO-05: only a four-digit year between 2020 and the current year enables the DÖE import.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doeeJahr } from "@ava/lib/doeeJahr";

describe("doeeJahr", () => {
  it("gültige Jahre", () => {
    assert.equal(doeeJahr("2025", 2026), 2025);
    assert.equal(doeeJahr(2026, 2026), 2026);
    assert.equal(doeeJahr(" 2020 ", 2026), 2020);
  });
  it("leer, NaN, 0, zu alt, Zukunft, Kommazahl → null", () => {
    for (const x of ["", null, undefined, "abc", "0", "1999", "2027", "2025.5", "20255"]) assert.equal(doeeJahr(x, 2026), null, String(x));
  });
});
