// 100-05 (Argon review 18.10.2026): outdated office catalogues (demolition under LB 040, no KG 212) are
// found and the update steps listed — never applied silently.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { katalogUpdateBefund, katalogUpdateSchritte } from "@core/lib/rules/katalogUpdate.js";
import { catalogSeed } from "../../packages/nova-core/server/catalog-seed.js";

describe("100-05 Katalog-Update", () => {
  it("frischer Seed ist aktuell", () => {
    assert.equal(katalogUpdateBefund(catalogSeed()).faellig, false);
  });
  it("alter Katalog: LB 040 Abbruch wird zu 084 (Update), KG 212 wird ergänzt", () => {
    const alt = { StlbKatalog: [{ id: "s1", lb: "040", name: "Abbruch- und Rückbauarbeiten", einheit: "m3" }], Din276Katalog: [{ id: "d1", fassung: "2018", code: "311" }] };
    const b = katalogUpdateBefund(alt);
    assert.equal(b.faellig, true);
    const s = katalogUpdateSchritte(b);
    assert.deepEqual(s.map((x) => [x.entity, x.art]), [["StlbKatalog", "update"], ["Din276Katalog", "create"]]);
    assert.equal(s[0].daten.lb, "084");
    assert.equal(s[0].daten.einheit, "m3", "eigene Felder bleiben");
    assert.equal(s[1].daten.code, "212");
  });
  it("Projekt-Override zählt nicht als Bürostandard; LB 084 vorhanden → 040 nur gemeldet, nicht angefasst", () => {
    const k = { StlbKatalog: [{ id: "s1", lb: "040", name: "Abbruch" }, { id: "s2", lb: "084", name: "Abbruch" }], Din276Katalog: [{ code: "212", fassung: "2018" }] };
    const b = katalogUpdateBefund(k);
    assert.equal(b.alt040.length, 1);
    assert.deepEqual(katalogUpdateSchritte(b), []);
    const o = katalogUpdateBefund({ StlbKatalog: [{ id: "p", lb: "084", projekt_override_id: "x" }], Din276Katalog: [] });
    assert.equal(o.fehlt084, true);
  });
  it("leere Kataloge (nicht geseedet) lösen nichts aus", () => {
    assert.equal(katalogUpdateBefund({}).faellig, false);
  });
});
