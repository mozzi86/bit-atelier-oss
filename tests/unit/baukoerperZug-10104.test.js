// 101-04: building pulled open on the site plan + its label values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { baukoerperAusZug, baukoerperKennwerte, BAUKOERPER_MIN_M } from "@designer/lib/siteParcel.js";

const PARZELLE = { m_per_px: 1.25, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 800 }, { x: 0, y: 800 }] };

test("Aufziehen: Rechteck aus zwei Ecken in jeder Richtung, zu klein = null", () => {
  const r = baukoerperAusZug({ x: 120, y: 80 }, { x: 100, y: 100 }, PARZELLE, 3);
  assert.deepEqual(r, { x: 100, y: 80, width: 20, height: 20, floors: 3 });
  const min = BAUKOERPER_MIN_M / 1.25;
  assert.equal(baukoerperAusZug({ x: 0, y: 0 }, { x: min - 0.1, y: 40 }, PARZELLE, 3), null);
});

test("Kennwerte: Geschosse und BGF in m² (Grundfläche × Geschosse)", () => {
  // 16 × 12 canvas units × 1.25 m = 20 × 15 m = 300 m² × 3 = 900 m² BGF
  assert.deepEqual(baukoerperKennwerte({ width: 16, height: 12, floors: 3 }, PARZELLE), { geschosse: 3, bgfM2: 900, breiteM: 20, tiefeM: 15 });
  assert.equal(baukoerperKennwerte({ width: 16, height: 12 }, PARZELLE).geschosse, 1);
});
