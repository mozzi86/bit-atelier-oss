// Unit tests for 69-20 (register Nr. 41): finding keys are stable (A/B swap, list order), runs diff into
// new / fixed / unchanged per rule, the hard-clash growth for the CLI exit code, unstable findings, and the
// run-file reader refuses foreign or newer files.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clashSchluessel, laufZusammenfassung, laufVergleich, laufLesen, LAUF_VERSION } from "@ifc/lib/laufVergleich";

const c = (a, b, kind = "hard", regel = { id: "R1" }) => ({ aGuid: a, bGuid: b, kind, regel });
const lauf = (clashes, ids = []) => laufZusammenfassung({ clash: { clashes }, ids }, { datum: "2026-10-11T10:00:00Z", modell: "m.ifc", regelsatz: "BAP" });

describe("69-20 Prüflauf-Vergleich", () => {
  it("clash key ignores A/B order; missing GlobalIds are flagged unstable", () => {
    assert.equal(clashSchluessel(c("x", "y")).schluessel, clashSchluessel(c("y", "x")).schluessel);
    assert.equal(clashSchluessel({ aId: 1, bId: 2, kind: "duplicate" }).stabil, false);
  });

  it("diff: new, fixed, unchanged per rule; hard growth", () => {
    const alt = lauf([c("a", "b"), c("c", "d"), c("e", "f", "duplicate", null)], [{ spec: { name: "BRAND-01" }, verletzungen: [{ globalId: "w1", facette: "property", erwartet: "FireRating" }] }]);
    const neu = lauf([c("b", "a"), c("g", "h"), c("i", "j")], [{ spec: { name: "BRAND-01" }, verletzungen: [{ globalId: "w1", facette: "property", erwartet: "FireRating" }, { globalId: "w2", facette: "property", erwartet: "FireRating" }] }]);
    const v = laufVergleich(alt, neu);
    assert.equal(v.unveraendert.length, 2); // a↔b and the IDS w1 violation
    assert.equal(v.neu.length, 3); // g↔h, i↔j, IDS w2
    assert.equal(v.behoben.length, 2); // c↔d, duplicate e↔f
    assert.equal(v.hartZunahme, 1); // +2 hard new − 1 hard fixed
    const r1 = v.jeRegel.find((r) => r.regel === "R1");
    assert.deepEqual([r1.neu, r1.behoben, r1.unveraendert], [2, 1, 1]);
    assert.equal(v.gleicherRegelsatz, true);
  });

  it("run JSON round trip; foreign and newer files refused in plain text", () => {
    const l = lauf([c("a", "b")]);
    assert.deepEqual(laufLesen(JSON.stringify(l)).befunde, l.befunde);
    assert.throws(() => laufLesen({ foo: 1 }), /Keine Prüflauf-Datei/);
    assert.throws(() => laufLesen({ v: LAUF_VERSION + 1, befunde: [] }), /neuer/);
  });
});
