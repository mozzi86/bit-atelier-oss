// 115-05c (D-115-12 "Verlassen fragt nach"): the registry that a project switch and an in-app link ask before leaving a page
// with unsaved model changes. It lives in the entry chunk (ProjectContext asks it), so it holds no logic of its own: a guard
// says whether it takes the leaving over (and calls `weiter` itself after the person decided), else the caller goes on.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verlassenWaechterSetzen, verlassenPruefen } from "@core/lib/verlassenWaechter.js";

test("no guard → the caller goes on at once, `weiter` is not called by the registry", () => {
  let n = 0;
  assert.equal(verlassenPruefen(() => { n += 1; }, { art: "projekt" }), false);
  assert.equal(n, 0);
});

test("a guard with unsaved work takes the leaving over and continues after the decision", () => {
  /** @type {null | (() => void)} */ let spaeter = null;
  /** @type {any} */ let gesehen = null;
  const weg = verlassenWaechterSetzen((weiter, ziel) => { gesehen = ziel; spaeter = weiter; return true; });
  let n = 0;
  assert.equal(verlassenPruefen(() => { n += 1; }, { art: "projekt", ziel: "p2" }), true);
  assert.deepEqual(gesehen, { art: "projekt", ziel: "p2" });
  assert.equal(n, 0, "nothing happens before the decision");
  /** @type {any} */ (spaeter)();
  assert.equal(n, 1);
  weg();
  assert.equal(verlassenPruefen(() => {}, { art: "projekt" }), false, "unregistered");
});

test("a guard without unsaved work lets it pass", () => {
  const weg = verlassenWaechterSetzen(() => false);
  assert.equal(verlassenPruefen(() => {}, { art: "link" }), false);
  weg();
});

test("a failing guard never traps the person (the leaving goes on)", () => {
  const weg = verlassenWaechterSetzen(() => { throw new Error("kaputt"); });
  assert.equal(verlassenPruefen(() => {}, { art: "link" }), false);
  weg();
});
