// Unit tests for 73-01: bauartVon is the one resolver of the kind of work ("sanierung" → "bestand",
// missing → neubau but NOT set), the start path swaps "Entwurf beginnen" for "Bauaufnahme laden" in an
// existing-building project, and the seed's showcase refurbishment is a refurbishment in the data.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bauartVon, istBestand, BAUART_LABEL } from "@core/lib/bauart";
import { startSchritte } from "../../src/components/projects/startpfadRegel.js";
import { projects } from "../../packages/nova-core/server/seed-data.js";

describe("73-01 bauartVon", () => {
  it("maps form and legacy values, flags a missing field", () => {
    assert.deepEqual(bauartVon({ build_kind: "sanierung" }), { bauart: "bestand", gesetzt: true });
    assert.deepEqual(bauartVon({ build_kind: "Bestand" }), { bauart: "bestand", gesetzt: true });
    assert.deepEqual(bauartVon({ build_kind: "neubau" }), { bauart: "neubau", gesetzt: true });
    assert.deepEqual(bauartVon({}), { bauart: "neubau", gesetzt: false });
    assert.deepEqual(bauartVon(null), { bauart: "neubau", gesetzt: false });
    assert.deepEqual(bauartVon({ build_kind: "irgendwas" }), { bauart: "neubau", gesetzt: false });
    assert.equal(istBestand({ build_kind: "sanierung" }), true);
    assert.ok(BAUART_LABEL.bestand && BAUART_LABEL.neubau);
  });

  it("start path: survey first in an existing building, design first in a new build", () => {
    assert.deepEqual(startSchritte("bestand"), ["bauaufnahme", "pruefen", "ausschreiben"]);
    assert.deepEqual(startSchritte("neubau"), ["entwurf", "pruefen", "ausschreiben"]);
  });

  it("seed: every project states its kind; the refurbishment showcase is a refurbishment", () => {
    for (const p of projects) assert.equal(bauartVon(p).gesetzt, true, p.name);
    assert.equal(bauartVon(projects.find((p) => /Sanierung/.test(p.name))).bauart, "bestand");
  });
});
