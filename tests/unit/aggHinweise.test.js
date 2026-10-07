// aggHinweise.test.js — AGG-Textheuristik für Stellentexte (Plan 80-08, Behavior 4).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pruefeStellentext } from "@/lib/people/aggHinweise.js";

describe("pruefeStellentext — Behavior 4", () => {
  it("'Architekt gesucht' meldet '(m/w/d) fehlt'", () => {
    const treffer = pruefeStellentext("Architekt gesucht");
    assert.ok(treffer.some((h) => h.hinweis.includes("(m/w/d) fehlt")));
    assert.ok(treffer.every((h) => h.schwere === "warn"));
  });
  it("'für unser junges Team' meldet einen Altersbezug", () => {
    const treffer = pruefeStellentext("für unser junges Team");
    assert.ok(treffer.some((h) => h.hinweis.toLowerCase().includes("altersbezug")));
  });
  it("'Muttersprache Deutsch' meldet einen Hinweis", () => {
    const treffer = pruefeStellentext("Muttersprache Deutsch");
    assert.ok(treffer.some((h) => h.hinweis.includes("Muttersprache")));
  });
  it("'Architekt:in (m/w/d) für LPH 5–8' → []", () => {
    assert.deepEqual(pruefeStellentext("Architekt:in (m/w/d) für LPH 5–8"), []);
  });
  it("alle Einträge tragen schwere:'warn'", () => {
    const treffer = pruefeStellentext("junges Team, Muttersprache Deutsch, belastbar");
    assert.ok(treffer.length > 0);
    assert.ok(treffer.every((h) => h.schwere === "warn"));
  });
  it("'belastbar' ohne Tätigkeitsbezug meldet einen Hinweis, 'belastbar im Bauleitungsalltag' nicht", () => {
    assert.ok(pruefeStellentext("Architekt:in (m/w/d), belastbar").some((h) => h.hinweis.includes("belastbar")));
    assert.ok(!pruefeStellentext("Architekt:in (m/w/d), belastbar im Bauleitungsalltag").some((h) => h.hinweis.includes("belastbar")));
  });
});
