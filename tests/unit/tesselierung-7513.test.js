// 75-13 Regression: with none of the 75-13 switches the output of tesseliere() is
// identical to the snapshot (tests/unit/fixtures/tesselierung-default-7513.json).
// History: generated at 2206d15 (before 75-13); REGENERATED on purpose in 84-01, 84-07 (stair core standard + entrance hall), 84-06 (corridor end on a door) and 84-08 (bath doors open outward) and 84-09 (gable units, corridor never at the outer wall) and 85-02 (deep bands: window row cut to the aspect-ratio target, FP40 is 26 m deep)
// (D-P84-A, doors always — room zones now always carry hall + doors). Regenerate only
// for a deliberate behaviour change: .planning/phases/84-tueren-immer/tmp-e2e/snapshots-8401.mjs.
// New switches: regeln.fensterMax / fensterMaxJeRaum (read by autoOpenings, not by the
// solver), regeln.balkon, regeln.treppenraum / aufzug / treppenraumErweiterung_m.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const SNAP = JSON.parse(fs.readFileSync(new URL("./fixtures/tesselierung-default-7513.json", import.meta.url), "utf8"));
const FP40 = [{ x: -20, z: -13 }, { x: 20, z: -13 }, { x: 20, z: 13 }, { x: -20, z: 13 }];
const FP30 = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);

// The snapshot cases cover every typology with a core (MFH, Spänner), the corridor types,
// the 75-07 + 75-14 rules and the band (non-room) mode.
const FAELLE = {
  "fp40-mfh-4g-ref": { footprintM: FP40, storeys: 4, typ: "mfh", einheiten: REF, raumzonen: true },
  "fp30-mfh-2g-std": { footprintM: FP30, storeys: 2, typ: "mfh", einheiten: STD, raumzonen: true },
  "fp40-spaenner-2g-ref": { footprintM: FP40, storeys: 2, typ: "spaenner", einheiten: REF, raumzonen: true },
  "fp40-mittelflur-2g-ref": { footprintM: FP40, storeys: 2, typ: "mittelflur", einheiten: REF, raumzonen: true },
  "fp40-laubengang-1g-std": { footprintM: FP40, storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true },
  "fp30-mfh-1g-std-regeln-ohne-rettungsweg": { footprintM: FP30, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true, regeln: { mindestbreiten: true, phi: true, wandstaerken: true, himmelsrichtung: true, wohnungsgrundriss: true } },
  "fp40-mfh-1g-ref-bandzonen": { footprintM: FP40, storeys: 1, typ: "mfh", einheiten: REF },
};

/**
 * Every 75-13 switch explicitly in its OFF position. 84-07: `treppenraum: false` is
 * ignored for MFH/Spänner (stair core standard) — so the lift and extension switches
 * are LIVE there and no longer part of this "all off" set.
 */
const AUS = { fensterMax: 1, fensterMaxJeRaum: {}, balkon: {}, treppenraum: false };

describe("tesselierung.js — 75-13 Schalter aus = Snapshot (84-01 neu erzeugt)", () => {
  it("der Snapshot enthält alle sieben Fälle", () => {
    assert.deepEqual(Object.keys(SNAP).sort(), Object.keys(FAELLE).sort());
  });

  for (const [name, opts] of Object.entries(FAELLE)) {
    it(`${name}: JSON identisch zum Snapshot (ohne neue Schalter)`, () => {
      assert.equal(JSON.stringify(tesseliere(opts)), JSON.stringify(SNAP[name]));
    });
    it(`${name}: neue Schalter ausdrücklich aus (treppenraum false, balkon {}, …) → weiterhin identisch`, () => {
      const o = { ...opts, regeln: { ...(opts.regeln || {}), ...AUS } };
      assert.equal(JSON.stringify(tesseliere(o)), JSON.stringify(SNAP[name]));
    });
  }

  it("ohne regeln.rettungsweg kein rettungsweg_*-Feld und keine rettungswegWarnungen (auch mit Treppenraum an)", () => {
    const r = tesseliere({ ...FAELLE["fp30-mfh-2g-std"], regeln: { treppenraum: true } });
    assert.equal(r.rettungswegWarnungen, undefined);
    assert.ok(r.weListe.every((w) => !Object.keys(w).some((k) => k.startsWith("rettungsweg"))));
  });
});
