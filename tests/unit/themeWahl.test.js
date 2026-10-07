// Unit tests of the theme selection core (80-03, behavior 6).
//
// In:  packages/nova-core/src/lib/themeWahl.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_WERTE, aufgeloestesTheme, normalisiereTheme } from "@core/lib/themeWahl.js";

test("THEME_WERTE — die drei Werte in Anzeige-Reihenfolge", () => {
  assert.deepEqual(THEME_WERTE, ["light", "dark", "system"]);
});

test("Behavior 6: normalisiereTheme fällt auf 'light' zurück", () => {
  assert.equal(normalisiereTheme("blau"), "light");
  assert.equal(normalisiereTheme("dark"), "dark");
  assert.equal(normalisiereTheme("system"), "system");
  assert.equal(normalisiereTheme(undefined), "light");
  assert.equal(normalisiereTheme(null), "light");
  assert.equal(normalisiereTheme(""), "light");
});

test("Behavior 6: aufgeloestesTheme löst 'system' über die OS-Präferenz auf", () => {
  assert.equal(aufgeloestesTheme("system", true), "dark");
  assert.equal(aufgeloestesTheme("system", false), "light");
  assert.equal(aufgeloestesTheme("dark", false), "dark", "dark bleibt dark, unabhängig von der OS-Präferenz");
  assert.equal(aufgeloestesTheme("light", true), "light", "light bleibt light, unabhängig von der OS-Präferenz");
});

test("ein unbekannter Wert normalisiert zuerst auf 'light' — die OS-Präferenz greift dann nicht mehr", () => {
  assert.equal(aufgeloestesTheme("unbekannt", true), "light");
  assert.equal(aufgeloestesTheme("unbekannt", false), "light");
});
