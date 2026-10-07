// Unit tests of the letterhead core (80-03, behavior 1): defaults and
// normalisation shared by the editor, the sidebar footer and the reports.
//
// In:  packages/nova-core/src/lib/briefkopf.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALTER_STANDARD_UNTERTITEL, BRIEFKOPF_SCHLUESSEL, DEFAULT_BRIEFKOPF, normalisiereBriefkopf,
} from "@core/lib/briefkopf.js";

test("Schlüssel und Standardwerte", () => {
  assert.equal(BRIEFKOPF_SCHLUESSEL, "briefkopf");
  assert.deepEqual(DEFAULT_BRIEFKOPF, { office: "Architekturbüro", tagline: "", address: "", contact: "" });
  assert.equal(ALTER_STANDARD_UNTERTITEL, "INTEGRATED PROJECT PLATFORM");
});

test("Behavior 1: normalisiereBriefkopf löscht den Alt-Untertitel und füllt Standardwerte auf", () => {
  assert.equal(normalisiereBriefkopf({ tagline: "INTEGRATED PROJECT PLATFORM" }).tagline, "");
  assert.deepEqual(normalisiereBriefkopf(undefined), { office: "Architekturbüro", tagline: "", address: "", contact: "" });
  assert.deepEqual(normalisiereBriefkopf(null), { office: "Architekturbüro", tagline: "", address: "", contact: "" });
});

test("Behavior 1: ein unbekanntes Feld fehlt im Ergebnis", () => {
  const raus = normalisiereBriefkopf({ office: "Büro Muster", foo: "bar" });
  assert.equal(raus.office, "Büro Muster");
  assert.ok(!("foo" in raus), "unbekanntes Feld foo landet nicht im Ergebnis");
  assert.deepEqual(Object.keys(raus).sort(), ["address", "contact", "office", "tagline"]);
});

test("ein eigener Untertitel bleibt erhalten (nur der exakte Alt-Wert wird gelöscht)", () => {
  assert.equal(normalisiereBriefkopf({ tagline: "Planungsbüro seit 1998" }).tagline, "Planungsbüro seit 1998");
  assert.equal(normalisiereBriefkopf({ tagline: "integrated project platform" }).tagline, "integrated project platform", "Groß/Klein ist keine Übereinstimmung — nur der exakte Alt-Wert zählt");
});

test("Adresse und Kontakt füllen sich unabhängig auf", () => {
  const raus = normalisiereBriefkopf({ address: "Musterstraße 1, 90402 Nürnberg" });
  assert.equal(raus.address, "Musterstraße 1, 90402 Nürnberg");
  assert.equal(raus.contact, "");
});
