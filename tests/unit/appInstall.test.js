// Unit tests for src/lib/settings/appInstall.js (Settings › System, "Als App installieren").
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserHinweis, istInstalliert, installStatus, appInstallieren, registriereInstallPrompt, _setzeZurueck } from "../../src/lib/settings/appInstall.js";

test("browserHinweis: iOS before Safari, Firefox, Chromium fallback", () => {
  assert.equal(browserHinweis("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "ios");
  assert.equal(browserHinweis("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"), "safari");
  assert.equal(browserHinweis("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0"), "firefox");
  assert.equal(browserHinweis("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0"), "chromium");
  assert.equal(browserHinweis(""), "chromium");
});

test("istInstalliert: standalone display mode or iOS navigator.standalone", () => {
  const w = (matches, standalone) => /** @type {any} */ ({ matchMedia: () => ({ matches }), navigator: { standalone } });
  assert.equal(istInstalliert(w(true, false)), true);
  assert.equal(istInstalliert(w(false, true)), true);
  assert.equal(istInstalliert(w(false, false)), false);
  assert.equal(istInstalliert(undefined), false);
});

test("installStatus and appInstallieren follow the deferred beforeinstallprompt", async () => {
  _setzeZurueck();
  /** @type {Record<string, Function>} */ const handler = {};
  const w = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ n, /** @type {Function} */ f) => { handler[n] = f; },
    matchMedia: () => ({ matches: false }), navigator: {},
  });
  registriereInstallPrompt(w);
  assert.equal(installStatus(w), "manuell");
  assert.equal(await appInstallieren(), null);
  let prompted = 0;
  handler.beforeinstallprompt({ preventDefault() {}, prompt() { prompted += 1; }, userChoice: Promise.resolve({ outcome: "accepted" }) });
  assert.equal(installStatus(w), "bereit");
  assert.equal(await appInstallieren(), "accepted");
  assert.equal(prompted, 1);
  assert.equal(installStatus(w), "manuell", "accepted prompt is consumed");
  registriereInstallPrompt(w);
  assert.equal(w.__bitInstallPromptRegistriert, true, "registered once");
  _setzeZurueck();
});
