// Unit tests for the form dialog close guard (72-11, N-07):
// packages/nova-core/src/lib/dialogSchutz.js.
//
// Runs the full matrix gesture × changed × question open × guard on/off, plus the
// defaults and an unknown gesture. FormModal wires Escape, backdrop and X to this
// rule; the headless proof n-07-dialog.mjs checks the wiring in the browser.
//
// In: the pure module. Out: assertions, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { schliessAnfrage, SCHLIESS_AUSLOESER } from "@core/lib/dialogSchutz.js";

test("SCHLIESS_AUSLOESER: genau Escape, Hintergrund und X, unveränderlich", () => {
  assert.deepEqual([...SCHLIESS_AUSLOESER], ["esc", "aussen", "x"]);
  assert.ok(Object.isFrozen(SCHLIESS_AUSLOESER));
});

test("ohne Änderung schließt jede Geste sofort", () => {
  for (const ausloeser of SCHLIESS_AUSLOESER) {
    assert.equal(schliessAnfrage({ geaendert: false, ausloeser }), "schliessen", ausloeser);
  }
});

test("mit Änderung fragt jede Geste nach", () => {
  for (const ausloeser of SCHLIESS_AUSLOESER) {
    assert.equal(schliessAnfrage({ geaendert: true, ausloeser }), "nachfragen", ausloeser);
  }
});

test("Rückfrage offen: Escape heißt weiter bearbeiten, Hintergrund und X lassen die Frage stehen", () => {
  assert.equal(schliessAnfrage({ geaendert: true, ausloeser: "esc", rueckfrageOffen: true }), "weiter");
  assert.equal(schliessAnfrage({ geaendert: true, ausloeser: "aussen", rueckfrageOffen: true }), "nachfragen");
  assert.equal(schliessAnfrage({ geaendert: true, ausloeser: "x", rueckfrageOffen: true }), "nachfragen");
});

test("schuetzen=false: schließt immer, auch mit Änderung und offener Frage", () => {
  for (const ausloeser of SCHLIESS_AUSLOESER) {
    for (const geaendert of [false, true]) {
      for (const rueckfrageOffen of [false, true]) {
        assert.equal(
          schliessAnfrage({ geaendert, ausloeser, rueckfrageOffen, schuetzen: false }),
          "schliessen",
          JSON.stringify({ ausloeser, geaendert, rueckfrageOffen })
        );
      }
    }
  }
});

test("vollständige Matrix mit schuetzen=true", () => {
  const erwartet = (ausloeser, geaendert, rueckfrageOffen) => {
    if (!geaendert) return "schliessen";
    if (rueckfrageOffen && ausloeser === "esc") return "weiter";
    return "nachfragen";
  };
  let faelle = 0;
  for (const ausloeser of SCHLIESS_AUSLOESER) {
    for (const geaendert of [false, true]) {
      for (const rueckfrageOffen of [false, true]) {
        assert.equal(
          schliessAnfrage({ geaendert, ausloeser, rueckfrageOffen, schuetzen: true }),
          erwartet(ausloeser, geaendert, rueckfrageOffen),
          JSON.stringify({ ausloeser, geaendert, rueckfrageOffen })
        );
        faelle++;
      }
    }
  }
  assert.equal(faelle, 12);
});

test("Voreinstellungen: nicht geändert, keine Frage offen, Schutz an", () => {
  assert.equal(schliessAnfrage({ ausloeser: "esc" }), "schliessen");
  assert.equal(schliessAnfrage({ ausloeser: "aussen", geaendert: true }), "nachfragen");
  // Only an explicit false switches the guard off; a missing value keeps it on.
  assert.equal(schliessAnfrage({ ausloeser: "x", geaendert: true, schuetzen: undefined }), "nachfragen");
});

test("unbekannte Geste mit Änderung fragt nach (sicherer Rückfall)", () => {
  assert.equal(schliessAnfrage({ ausloeser: "unbekannt", geaendert: true }), "nachfragen");
  assert.equal(schliessAnfrage({ ausloeser: "unbekannt", geaendert: true, rueckfrageOffen: true }), "nachfragen");
  assert.equal(schliessAnfrage({ ausloeser: "unbekannt", geaendert: false }), "schliessen");
});
