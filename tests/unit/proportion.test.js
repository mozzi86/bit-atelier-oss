// Unit tests for the golden-ratio house rule (Phase 75-02, MS-02).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHI, PHI_AUSNAHMEN, verhaeltnis, imBand, phiSnap, istAchsparallelesRechteck, proportionHinweis,
} from "@core/lib/proportion";

const nah = (ist, soll, eps = 1e-6) => assert.ok(Math.abs(ist - soll) < eps, `${ist} != ${soll}`);

describe("proportion — Verhältnis und Band", () => {
  it("16,18 × 10 liegt im Band, Status grün", () => {
    const v = verhaeltnis(16.18, 10);
    nah(v, PHI, 1e-3);
    assert.equal(imBand(v), true);
    const h = proportionHinweis({ w: 16.18, d: 10 });
    assert.equal(h.status, "gruen");
    assert.equal(h.text, "1 : 1,62 φ");
  });

  it("0 oder NaN → null / offen", () => {
    assert.equal(verhaeltnis(0, 10), null);
    assert.equal(proportionHinweis({ w: NaN, d: 10 }).status, "offen");
  });

  it("Ausnahmeliste besteht nur aus art-Schlüsseln von wohnungsTypen.js", () => {
    assert.deepEqual(PHI_AUSNAHMEN, ["flur", "abstell", "sanitaer", "kueche"]);
  });
});

describe("proportion — Hinweis (Handrechnung Blatt 00)", () => {
  it("12 × 12 → gelb, Ostkante +7,42 m → φ (Verlängern bevorzugt)", () => {
    const h = proportionHinweis({ w: 12, d: 12 });
    assert.equal(h.status, "gelb");
    assert.equal(h.text, "Ostkante +7,42 m → φ");
  });

  it("stark gestrecktes Rechteck 30 × 10 → kurze Seite verlängern (Südkante +8,54 m)", () => {
    // lang: 10*phi - 30 = -13,82; kurz: 30/phi - 10 = +8,54 -> 13,82 > 2*8,54 -> kurze Seite
    const h = proportionHinweis({ w: 30, d: 10 });
    assert.equal(h.text, "Südkante +8,54 m → φ");
  });

  it("Bbox-Näherung wird markiert", () => {
    assert.equal(proportionHinweis({ w: 10, d: 10 }, { istRechteck: false }).naeherung, true);
    assert.equal(proportionHinweis({ w: 10, d: 10 }).naeherung, false);
  });
});

describe("proportion — phiSnap", () => {
  it("16,0 bei Tiefe 10 rastet auf 16,18; 15,0 rastet nicht", () => {
    assert.equal(phiSnap({ w: 16.0, d: 10 }, "w"), 16.18);
    assert.equal(phiSnap({ w: 15.0, d: 10 }, "w"), null);
  });
  it("Achse d: Tiefe 10,2 bei Breite 16,18 rastet auf 10,00", () => {
    assert.equal(phiSnap({ w: 16.18, d: 10.2 }, "d"), 10);
  });
  it("nimmt den näheren Kandidaten (anderes·φ oder anderes/φ)", () => {
    assert.equal(phiSnap({ w: 6.2, d: 10 }, "w"), 6.18);
  });
});

describe("proportion — istAchsparallelesRechteck", () => {
  const R = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 0, y: 10 }];
  it("Rechteck true", () => assert.equal(istAchsparallelesRechteck(R), true));
  it("L-Form (6 Punkte) false", () => {
    const L = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 10 }, { x: 0, y: 10 }];
    assert.equal(istAchsparallelesRechteck(L), false);
  });
  it("gedrehtes Rechteck false", () => {
    const G = [{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 8, y: 12 }, { x: -2, y: 10 }];
    assert.equal(istAchsparallelesRechteck(G), false);
  });
});
