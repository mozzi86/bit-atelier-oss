// Wave 1 (i18n-Grundriss): the German key "Grundriss" names the VIEW (floor
// plan tab, plan lists) and must read "Floor plan" in English. The building
// outline (record field footprintM of the sync conflict card) has its own key
// that reads "Footprint". Before the fix one key served both and the view tab
// read "Footprint".
//
// In:  the dictionary parts (as text, tests/unit/helpers/woerterbuch.mjs),
//      @core/lib/abgleich/modellAbgleich. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { englischePaareAlle } from "./helpers/woerterbuch.mjs";
import { feldName } from "@core/lib/abgleich/modellAbgleich";

const EN = new Map(englischePaareAlle().map(([k, v]) => [k, v]));

test("the view 'Grundriss' reads 'Floor plan'", () => {
  assert.equal(EN.get("Grundriss"), "Floor plan");
});

test("the building outline has its own key that reads 'Footprint'", () => {
  const umriss = feldName("footprintM");
  assert.notEqual(umriss, "Grundriss");
  assert.equal(EN.get(umriss), "Footprint");
  const herkunft = feldName("footprintQuelle");
  assert.equal(EN.get(herkunft), "Footprint source");
});
