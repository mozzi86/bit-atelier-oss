// Unit tests of the personnel access gate and the /People tab registry (80-01,
// behavior 11 and the People half of behavior 12).
//
// In:  src/lib/people/zugang.js, src/lib/people/reiter.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PERSONAL_ZUGAENGE, personalZugang } from "@/lib/people/zugang.js";
import {
  PERSONAL_REITER, PERSONAL_REITER_ALIAS, PERSONAL_REITER_INFO, STANDARD_PERSONAL_REITER,
} from "@/lib/people/reiter.js";
import { waehleTab } from "@core/lib/tabParam.js";

test("Behavior 11: personalZugang je Datenquelle und Rolle", () => {
  assert.equal(personalZugang({ datenquelle: "serverlos", rolle: "admin" }), "erlaubt");
  assert.equal(personalZugang({ datenquelle: "express", rolle: "owner" }), "erlaubt");
  assert.equal(personalZugang({ datenquelle: "express", rolle: "mitglied" }), "keine-berechtigung");
  assert.equal(personalZugang({ datenquelle: "supabase", rolle: "admin" }), "nur-lokal", "DS-04: Cloud vor der Rolle");
  assert.equal(personalZugang({ datenquelle: "serverlos", rolle: undefined }), "keine-berechtigung", "Nutzer lädt noch");
  assert.equal(personalZugang(), "keine-berechtigung");
  assert.equal(personalZugang({ datenquelle: "serverlos", rolle: null }), "keine-berechtigung");
  assert.deepEqual([...PERSONAL_ZUGAENGE], ["erlaubt", "nur-lokal", "keine-berechtigung"]);
});

test("Behavior 12: PERSONAL_REITER in fester Reihenfolge, Standard staff", () => {
  assert.deepEqual([...PERSONAL_REITER], ["staff", "recruiting", "onboarding", "contracts"]);
  assert.equal(STANDARD_PERSONAL_REITER, "staff");
  assert.ok(Object.isFrozen(PERSONAL_REITER_INFO) && Object.isFrozen(PERSONAL_REITER_INFO[0]));
  for (const r of PERSONAL_REITER_INFO) assert.ok(r.label && r.hinweis, `${r.key}: Text fehlt`);
});

test("Behavior 12: jeder deutsche Alias löst über waehleTab auf den englischen Schlüssel auf", () => {
  const faelle = { mitarbeitende: "staff", mitarbeiter: "staff", team: "staff", suche: "recruiting", bewerbungen: "recruiting",
    einstellung: "onboarding", austritt: "onboarding", vertraege: "contracts", vertrag: "contracts", Vertraege: "contracts" };
  for (const [alias, ziel] of Object.entries(faelle)) {
    assert.equal(waehleTab(alias, PERSONAL_REITER, STANDARD_PERSONAL_REITER, PERSONAL_REITER_ALIAS), ziel, alias);
  }
  for (const r of PERSONAL_REITER_INFO) {
    for (const a of r.alias) assert.equal(waehleTab(a, PERSONAL_REITER, STANDARD_PERSONAL_REITER, PERSONAL_REITER_ALIAS), r.key, a);
  }
  assert.equal(waehleTab("xyz", PERSONAL_REITER, STANDARD_PERSONAL_REITER, PERSONAL_REITER_ALIAS), "staff");
  // No alias is also a key, and no alias points at two tabs.
  const alle = PERSONAL_REITER_INFO.flatMap((r) => r.alias);
  assert.equal(new Set(alle).size, alle.length);
  assert.ok(alle.every((a) => !PERSONAL_REITER.includes(a)));
});

test("zugang.js und reiter.js importieren weder React noch bitApi", () => {
  for (const datei of ["src/lib/people/zugang.js", "src/lib/people/reiter.js"]) {
    const quelle = fs.readFileSync(new URL(`../../${datei}`, import.meta.url), "utf8");
    assert.doesNotMatch(quelle, /^\s*import\b/m, `${datei} importiert etwas`);
  }
});
