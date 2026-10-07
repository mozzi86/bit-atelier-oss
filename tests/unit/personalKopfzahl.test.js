// personalKopfzahl.test.js — Kopfzahl §§ 23 KSchG/3 AAG, Schwellenwerte
// (Plan 80-04, Task 3). Behavior 8 mit Rechenweg.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kopfzahlAAG, kopfzahlKSchG, schwellenFuer } from "@/lib/people/kopfzahl.js";

describe("kopfzahlKSchG — § 23 Abs. 1 S. 4 KSchG", () => {
  it("[{h:40},{h:20},{h:30},{h:40, art:'azubi'}] === 2.25 (1 + 0.5 + 0.75 + 0 Azubi)", () => {
    assert.equal(kopfzahlKSchG([{ h: 40 }, { h: 20 }, { h: 30 }, { h: 40, art: "azubi" }]), 2.25);
  });
  it("[{h:10}] === 0.5 (KSchG kennt keine 10h-Stufe, fällt in die ≤20h-Stufe)", () => {
    assert.equal(kopfzahlKSchG([{ h: 10 }]), 0.5);
  });
});

describe("kopfzahlAAG — § 3 Abs. 1 S. 6 AAG", () => {
  it("[{h:10}] === 0.25 (eigene ≤10h-Stufe)", () => {
    assert.equal(kopfzahlAAG([{ h: 10 }]), 0.25);
  });
});

describe("schwellenFuer", () => {
  it("10.5 → KSchG gilt:true", () => {
    const s = schwellenFuer(10.5).find((x) => x.key === "kschg");
    assert.equal(s.gilt, true);
  });
  it("10 → KSchG gilt:false (Kleinbetriebsklausel: > 10, nicht ≥)", () => {
    const s = schwellenFuer(10).find((x) => x.key === "kschg");
    assert.equal(s.gilt, false);
  });
  it("jede Schwelle hat eine norm", () => {
    for (const s of schwellenFuer(15)) assert.ok(s.norm && s.norm.length > 0, `Schwelle ${s.key} ohne Norm`);
  });
});
