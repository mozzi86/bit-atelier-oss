// Wave 1 (KD-09): the flat cost model of the complex designer's cost tab. The
// factor 4 on the infrastructure line is a named [ASSUMED] constant now; this
// test pins today's numbers so a later change of rates or factor is a visible
// decision, not a silent drift of the budget the AVA cost control reads.
//
// In:  @designer/lib/pauschalKosten, source text of ComplexDesigner.jsx. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GRUNDSTUECK_JE_GRUNDFLAECHE, PAUSCHAL_SAETZE, pauschalKosten } from "@designer/lib/pauschalKosten";

test("the factor 4 is a named constant (site area per m² of footprint) and the rates are unchanged", () => {
  assert.equal(GRUNDSTUECK_JE_GRUNDFLAECHE, 4);
  assert.deepEqual({ ...PAUSCHAL_SAETZE }, { construction: 2400, infrastructure: 180, energy: 1200, site_prep: 95 });
  assert.ok(Object.isFrozen(PAUSCHAL_SAETZE));
});

test("today's numbers pinned: 1000 m² BGF, 250 m² footprint, 10 kW", () => {
  const k = pauschalKosten({ bgf: 1000, footprint: 250, totalKw: 10, rates: PAUSCHAL_SAETZE });
  assert.equal(k.construction_cost, 2_400_000); // 1000 m² × 2400 €/m²
  assert.equal(k.grundstueck_m2, 1000); // 250 m² × 4 (assumed site area)
  assert.equal(k.infrastructure_cost, 180_000); // 1000 m² × 180 €/m² = 250 × 4 × 180 as before
  assert.equal(k.energy_system_cost, 12_000); // 10 kW × 1200 €/kW
  assert.equal(k.site_preparation_cost, 23_750); // 250 m² × 95 €/m²
  assert.equal(k.total_cost, 2_615_750);
  assert.equal(k.cost_per_m2, 2615.75);
});

test("no BGF → cost per m² 0, no NaN; missing values count 0", () => {
  const k = pauschalKosten({ bgf: 0, footprint: 0, totalKw: 0, rates: PAUSCHAL_SAETZE });
  assert.equal(k.total_cost, 0);
  assert.equal(k.cost_per_m2, 0);
  const l = pauschalKosten({ bgf: /** @type {any} */ (undefined), footprint: 100, totalKw: /** @type {any} */ (null), rates: PAUSCHAL_SAETZE });
  assert.equal(l.total_cost, 100 * 4 * 180 + 100 * 95);
});

// Size budget (wave 1 review): the KD-09 additions (pure model, assumption
// texts, EN part) grew the ComplexDesigner chunk, the largest JS chunk of the
// build (budget chunk_max), by about 0.3 KB gzip. The cost tab now loads lazily
// like its sibling tabs; this guards the source cause.
test("the cost tab is a lazy chunk of the complex designer (chunk_max)", async () => {
  const fs = await import("node:fs");
  const quelle = fs.readFileSync(new URL("../../packages/nova-designer/src/pages/ComplexDesigner.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(quelle, /^import CostCalculator /m);
  assert.match(quelle, /const CostCalculator = React\.lazy\(\(\) => import\("\.\.\/components\/CostCalculator"\)\);/);
  assert.match(quelle, /<ReiterLaden><CostCalculator\b/);
});
