// Unit tests for 73-02: the registry's second reading. Without a kind of work (or "neubau") the lookup is
// byte-identical to 72-02; "bestand" changes braucht/stand of exactly the ten listed tabs; the five site
// tabs read the same in both kinds; no tab is hidden; the provenance line names source, storeys, date.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DESIGNER_REITER, BESTAND_LESART, reiterFuerTab, reiterImBereich, aufloesen } from "@designer/config/designerNavigation";
import { herkunftZeile } from "@core/lib/bauart";

const ZEHN = ["bauaufnahme", "bim", "buildings", "program", "statics", "interiors", "haustechnik", "brandschutz", "asr", "barrierefreiheit", "raumklima"];

describe("73-02 Registry, zweite Lesart", () => {
  it("without kind of work or for neubau the very same entry object comes back", () => {
    for (const r of DESIGNER_REITER) {
      assert.equal(reiterFuerTab(r.key), r);
      assert.equal(reiterFuerTab(r.key, "neubau"), r);
    }
  });

  it("bestand changes exactly the ten tabs; keys, labels, areas stay", () => {
    assert.deepEqual(Object.keys(BESTAND_LESART).sort(), [...ZEHN].sort());
    for (const r of DESIGNER_REITER) {
      const b = reiterFuerTab(r.key, "bestand");
      assert.equal(b.key, r.key); assert.equal(b.label, r.label); assert.equal(b.bereich, r.bereich);
      if (ZEHN.includes(r.key)) assert.notDeepEqual(b.braucht, r.braucht, r.key);
      else assert.equal(b, r, `${r.key} unverändert`);
    }
    for (const k of ["bauaufnahme", "bim", "buildings", "program"]) assert.equal(reiterFuerTab(k, "bestand").stand, "gemessen");
    for (const k of ["interiors", "asr", "barrierefreiheit"]) assert.ok(reiterFuerTab(k, "bestand").braucht.includes("Räume aus IfcSpace"));
  });

  it("the five site tabs read word for word the same; no tab hidden; deep links unchanged", () => {
    for (const r of reiterImBereich("standort")) assert.deepEqual(reiterFuerTab(r.key, "bestand"), r);
    assert.equal(DESIGNER_REITER.length, 31);
    assert.equal(aufloesen("studio"), "studio");
    assert.equal(aufloesen("gibtsnicht"), null);
  });

  it("provenance line: source, storeys, element count, date; null without a snapshot", () => {
    const z = herkunftZeile({ name: "Aufmaß 2026", geschosse: ["KG", "EG", "OG"], anzahl: 1234, updated_date: "2026-10-01T10:00:00Z" });
    assert.match(z, /^Bauaufnahme: Aufmaß 2026 · 3 Geschosse · 1\.234 Bauteile · Stand 1\.10\.2026$/);
    assert.equal(herkunftZeile(null), null);
    assert.equal(herkunftZeile({}), "Bauaufnahme: Modellstand");
  });
});
