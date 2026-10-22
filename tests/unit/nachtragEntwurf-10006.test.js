// 100-06 (Argon review 18.10.2026): a draft fee amendment with a cost drift is found, so the contract can
// say "im Entwurf — noch nicht beim Bauherrn" while the drift banner is silent.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { driftNachtragImEntwurf, driftBezug } from "@/lib/honorar/honorarNachtrag.js";

const V = { id: "v1", kosten_eingefroren: { "300": 100000 }, kosten_eingefroren_am: "2026-09-01" };
const drift = { aktuell: { "300": 120000 }, aktuell_am: "2026-10-01" };

describe("100-06 Nachtrag im Entwurf", () => {
  it("Entwurf mit Kostendrift wird gefunden (und ist heute schon der Drift-Bezug)", () => {
    const n = [{ id: "n1", nr: 1, honorarvertrag_id: "v1", status: "entwurf", kosten_drift: drift }];
    assert.equal(driftNachtragImEntwurf(V, n)?.id, "n1");
    assert.deepEqual(driftBezug(V, n).kosten_eingefroren, drift.aktuell, "Banner schweigt — deshalb der Hinweis");
  });
  it("angeboten/beauftragt, abgelehnt, anderer Vertrag oder ohne Drift: kein Hinweis", () => {
    for (const n of [
      { nr: 1, honorarvertrag_id: "v1", status: "angeboten", kosten_drift: drift },
      { nr: 2, honorarvertrag_id: "v1", status: "beauftragt", kosten_drift: drift },
      { nr: 3, honorarvertrag_id: "v1", status: "abgelehnt", kosten_drift: drift },
      { nr: 4, honorarvertrag_id: "v2", status: "entwurf", kosten_drift: drift },
      { nr: 5, honorarvertrag_id: "v1", status: "entwurf" },
    ]) assert.equal(driftNachtragImEntwurf(V, [n]), null, JSON.stringify(n));
    assert.equal(driftNachtragImEntwurf(null, []), null);
  });
});
