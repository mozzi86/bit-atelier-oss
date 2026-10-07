// Unit-Tests für packages/nova-designer/src/lib/useFachlayer.js (Phase 39,
// Review-Fix): Save-Resolve darf pendingRef nur löschen, wenn dort noch der
// GERADE GESPEICHERTE Stand liegt — kam während des Save-Awaits eine neuere
// Eingabe, muss sie für den Unmount-Flush erhalten bleiben.
//
// Der Hook selbst (Load-Race, Projektwechsel-Reset, Eingabe-Block während des
// Ladens) ist Effekt-Logik und in der node-only-Suite ohne DOM/Renderer nicht
// testbar — die Entscheidungslogik ist als pure Funktion extrahiert.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pendingNachSave } from "@designer/lib/fachlayerPending";

describe("pendingNachSave (Unmount-Flush-Erhalt)", () => {
  const pend = (sig) => ({ pid: "p1", feld: "schallschutz_layer", state: {}, sig });

  it("löscht den Pending-Eintrag, wenn er dem gespeicherten Stand entspricht", () => {
    assert.equal(pendingNachSave(pend("sig1"), "sig1"), null);
  });

  it("behält eine NEUERE Eingabe, die während des Save-Awaits kam", () => {
    const neuer = pend("sig2");
    assert.equal(pendingNachSave(neuer, "sig1"), neuer);
  });

  it("null bleibt null (kein Pending vorhanden)", () => {
    assert.equal(pendingNachSave(null, "sig1"), null);
  });
});
