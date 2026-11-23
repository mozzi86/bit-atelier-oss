// User finding 15.11.2026 ("im Schnitt ist das Dach nicht zu sehen"): a section along the ridge shows the roof faces in elevation
// and its cut gable walls reach up to the roof; a section across the ridge is unchanged (the cut roof plate is the picture).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dachBerechnen, dachSchnittLinie, dachAnsichtImSchnitt, dachFalllinienImSchnitt, wandOberkanteUnterDach, schnittAchseQuerZumFirst } from "@core/lib/bauteil/dachGeometrie.js";

/** 12 × 8 m house, eaves at 5,60 m, gable roof 40°, ridge along x (the longer side). */
const PROFIL = [{ x: -6, z: -4 }, { x: 6, z: -4 }, { x: 6, z: 4 }, { x: -6, z: 4 }];
const dach = dachBerechnen(PROFIL, { form: "sattel", neigung_grad: 40 }, { traufhoehe_m: 5.6 });

describe("Dach im Schnitt", () => {
  it("Beispieldach: Satteldach, First längs x", () => {
    assert.ok(dach.ok);
    assert.equal(schnittAchseQuerZumFirst(dach), "z");
  });

  it("Schnitt längs zum First: beide Dachflächen in der Ansicht von der Traufe bis zum First", () => {
    const quer = schnittAchseQuerZumFirst(dach), laengs = quer === "z" ? "x" : "z";
    const ringe = dachAnsichtImSchnitt(dach, laengs);
    assert.equal(ringe.length, 1); // both faces project onto the same outline: one picture
    // rafter lines every 0,8 m from the eaves to the ridge: 12 m → 15 fields → 14 lines
    const linien = dachFalllinienImSchnitt(ringe[0]);
    assert.equal(linien.length, 14);
    for (const [a, b] of linien) { assert.ok(Math.abs(a.h_m - dach.traufhoehe_m) < 1e-6); assert.ok(Math.abs(b.h_m - (dach.traufhoehe_m + dach.anstieg_m)) < 1e-6); assert.equal(a.s_m, b.s_m); }
    assert.deepEqual(dachFalllinienImSchnitt([]), []);
    const first = dach.traufhoehe_m + dach.anstieg_m;
    for (const r of ringe) {
      assert.ok(Math.abs(Math.min(...r.map((q) => q.h_m)) - dach.traufhoehe_m) < 1e-6);
      assert.ok(Math.abs(Math.max(...r.map((q) => q.h_m)) - first) < 1e-6);
    }
    // across the ridge the faces are seen edge-on: nothing in elevation
    assert.deepEqual(dachAnsichtImSchnitt(dach, quer), []);
    assert.deepEqual(dachAnsichtImSchnitt(null, "x"), []);
  });

  it("geschnittene Giebelwand reicht bis unter das Dach, die Traufwand bleibt auf Traufhöhe", () => {
    const quer = schnittAchseQuerZumFirst(dach), laengs = quer === "z" ? "x" : "z";
    const first = dach.traufhoehe_m + dach.anstieg_m;
    const unterLaengs = dachSchnittLinie(dach, laengs, 0), unterQuer = dachSchnittLinie(dach, quer, 0);
    const [s0, s1] = [unterLaengs.punkte[0].s_m, unterLaengs.punkte[unterLaengs.punkte.length - 1].s_m];
    assert.ok(Math.abs(wandOberkanteUnterDach(unterLaengs, s0, s0 + 0.365, dach.traufhoehe_m) - first) < 1e-6);
    assert.ok(Math.abs(wandOberkanteUnterDach(unterLaengs, s1 - 0.365, s1, dach.traufhoehe_m) - first) < 1e-6);
    const q0 = unterQuer.punkte[0].s_m;
    assert.ok(Math.abs(wandOberkanteUnterDach(unterQuer, q0, q0 + 0.365, dach.traufhoehe_m) - dach.traufhoehe_m) < 1e-6);
    // no roof / wall outside the roof frame: the eaves height
    assert.equal(wandOberkanteUnterDach(null, 0, 0.3, 5.6), 5.6);
    assert.equal(wandOberkanteUnterDach(unterLaengs, s1 + 1, s1 + 1.3, 5.6), 5.6);
  });
});
