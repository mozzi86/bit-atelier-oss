// personalUrlaub.test.js — Mindesturlaub und Urlaubsanspruch (Plan 80-06, Task
// 2): Behavior 3–4 mit Rechenweg (§§ 3–5 BUrlG).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { urlaubMindest, urlaubsanspruch } from "@/lib/people/urlaub.js";

describe("urlaubMindest — Behavior 3 (§ 3 Abs. 1 BUrlG, 24 Werktage)", () => {
  it("5 Arbeitstage/Woche → 20", () => assert.equal(urlaubMindest(5), 20));
  it("4 Arbeitstage/Woche → 16", () => assert.equal(urlaubMindest(4), 16));
  it("6 Arbeitstage/Woche → 24", () => assert.equal(urlaubMindest(6), 24));
  it("3 Arbeitstage/Woche → 12", () => assert.equal(urlaubMindest(3), 12));
});

describe("urlaubsanspruch — Behavior 4 (§§ 3–5 BUrlG), urlaub_tage_jahr 28, jahr 2026", () => {
  it("Eintritt 2026-04-01 → 28 (Wartezeit endet 2026-09-30, im Jahr erfüllt)", () => {
    const a = urlaubsanspruch({ urlaub_tage_jahr: 28, eintritt: "2026-04-01", austritt: null, jahr: 2026 });
    assert.equal(a.tage, 28);
    assert.match(a.berechnung, /2026-09-30/);
  });
  it("Eintritt 2026-07-15 → 12 (5/12 × 28 = 11,67 → aufgerundet)", () => {
    const a = urlaubsanspruch({ urlaub_tage_jahr: 28, eintritt: "2026-07-15", austritt: null, jahr: 2026 });
    assert.equal(a.tage, 12);
  });
  it("Eintritt 2026-11-02 → 2.33 (1/12 × 28 = 2,33, kein Abrunden)", () => {
    const a = urlaubsanspruch({ urlaub_tage_jahr: 28, eintritt: "2026-11-02", austritt: null, jahr: 2026 });
    assert.equal(a.tage, 2.33);
  });
  it("Austritt 2026-03-31 nach Eintritt 2020-01-01 → 7 (3/12 × 28)", () => {
    const a = urlaubsanspruch({ urlaub_tage_jahr: 28, eintritt: "2020-01-01", austritt: "2026-03-31", jahr: 2026 });
    assert.equal(a.tage, 7);
  });
});
