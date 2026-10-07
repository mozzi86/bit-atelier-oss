// personalLink.test.js — URL-Vertrag von /People, nur opake IDs (Plan 80-04,
// Task 4, DS-07). Behavior 10.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAL_PARAMETER,
  bauePersonalLink,
  entfernePersonalParameter,
  lesePersonalLink,
} from "@/lib/people/personalLink.js";

describe("bauePersonalLink", () => {
  it("{tab:'staff', mitarbeiter:'abc123'} → '?tab=staff&mitarbeiter=abc123'", () => {
    assert.equal(bauePersonalLink({ tab: "staff", mitarbeiter: "abc123" }), "?tab=staff&mitarbeiter=abc123");
  });
  it("hält die feste Reihenfolge aus PERSONAL_PARAMETER ein, auch bei anderer Eingabereihenfolge", () => {
    assert.equal(bauePersonalLink({ neu: true, mitarbeiter: "xy1234", tab: "staff" }), "?tab=staff&mitarbeiter=xy1234&neu=1");
  });
  it("leere Eingabe → ''", () => {
    assert.equal(bauePersonalLink({}), "");
  });
});

describe("lesePersonalLink — DS-07: kein Name in der URL", () => {
  it("'?mitarbeiter=Erika%20Muster' → mitarbeiter ist undefined (kein ID-Muster-Treffer)", () => {
    assert.equal(lesePersonalLink("?mitarbeiter=Erika%20Muster").mitarbeiter, undefined);
  });
  it("'?neu=ja' → neu ist undefined (nur exakt '1' zählt)", () => {
    assert.equal(lesePersonalLink("?neu=ja").neu, undefined);
  });
  it("'?neu=1' → neu ist true", () => {
    assert.equal(lesePersonalLink("?neu=1").neu, true);
  });
  it("gültige opake ID kommt durch", () => {
    assert.equal(lesePersonalLink("?mitarbeiter=abc123").mitarbeiter, "abc123");
  });
  it("ohne Eingabe → {}", () => {
    assert.deepEqual(lesePersonalLink(undefined), {});
  });
});

describe("entfernePersonalParameter", () => {
  it("entfernt genannte Parameter, lässt andere stehen, ändert die Eingabe nicht", () => {
    const eingabe = new URLSearchParams("?tab=staff&mitarbeiter=abc123&neu=1");
    const aufgeraeumt = entfernePersonalParameter(eingabe, ["mitarbeiter", "neu"]);
    assert.equal(aufgeraeumt.toString(), "tab=staff");
    assert.equal(eingabe.toString(), "tab=staff&mitarbeiter=abc123&neu=1");
  });
});

describe("PERSONAL_PARAMETER", () => {
  it("enthält alle sieben Schlüssel in fester Reihenfolge", () => {
    assert.deepEqual([...PERSONAL_PARAMETER], ["tab", "mitarbeiter", "vertrag", "bewerbung", "stelle", "vorgang", "neu"]);
  });
});
