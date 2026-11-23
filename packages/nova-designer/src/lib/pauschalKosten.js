// Flat cost model of the complex designer's cost tab (components/CostCalculator.jsx),
// pulled out as a pure function in wave 1 (KD-09) so the numbers can be pinned
// by a test (tests/unit/kostenPauschal-kd09.test.js) and the formerly unexplained
// factor 4 has a name.
//
// Four lines: building (BGF × rate), infrastructure (assumed SITE area × rate),
// energy (kW × rate), site preparation (footprint × rate). The sum is mirrored
// into the shared store as costEstimate and shown in the AVA cost control as the
// budget of the building model — it is a rough flat estimate, not a DIN 276 cost
// calculation from quantities.
//
// In:  BGF (m²), footprint (m²), installed energy capacity (kW), rates.
// Out: the cost lines in euro (same keys as before, plus grundstueck_m2).

/**
 * [ASSUMED] Site area per m² of building footprint (m²/m²): the infrastructure
 * rate is a rate per m² of SITE (designated land), but the cost tab knows only
 * the footprint, so the site is taken as 4 × footprint — i.e. an implied site
 * coverage ratio (GRZ, § 19 BauNVO) of 0.25. Origin: the factor came with the
 * first import of the cost tab without a comment (git 7b32f93c); the reading
 * "site = footprint / GRZ 0.25" is the only one consistent with the unit of the
 * rate ("€/m² site"). It is NOT double counting with the site-preparation line
 * (that line prices the footprint itself, a different cost item). Way to a
 * confirmed value: the real plot area of the project (site parcel) or the GRZ of
 * the development plan instead of this constant.
 * @type {number}
 */
export const GRUNDSTUECK_JE_GRUNDFLAECHE = 4;

/**
 * [ASSUMED] Default rates of the flat model — guide values from the first
 * import of the cost tab, without a cited source; editable in the tab. Not
 * confirmed by a cost database (BKI or the office's own figures) — do not use
 * as a cost calculation. Units: construction €/m² BGF, infrastructure €/m² site,
 * energy €/kW installed, site_prep €/m² footprint.
 * @type {Readonly<{construction: number, infrastructure: number, energy: number, site_prep: number}>}
 */
export const PAUSCHAL_SAETZE = Object.freeze({ construction: 2400, infrastructure: 180, energy: 1200, site_prep: 95 });

/**
 * The flat estimate. Numbers unchanged from the inline formula before KD-09
 * (infrastructure = footprint × 4 × rate).
 * pauschalKosten({bgf: 1000, footprint: 250, totalKw: 10, rates: PAUSCHAL_SAETZE}).total_cost = 2 615 750.
 * @param {{bgf: number, footprint: number, totalKw: number,
 *   rates: {construction: number, infrastructure: number, energy: number, site_prep: number}}} e
 *   bgf m², footprint m², totalKw kW, rates as PAUSCHAL_SAETZE (euro per unit)
 * @returns {{construction_cost: number, infrastructure_cost: number, energy_system_cost: number,
 *   site_preparation_cost: number, total_cost: number, cost_per_m2: number, grundstueck_m2: number}}
 *   euro (cost_per_m2 in €/m² BGF, 0 without BGF); grundstueck_m2 = the assumed site area in m²
 */
export function pauschalKosten({ bgf, footprint, totalKw, rates }) {
  const b = Number(bgf) || 0;
  const f = Number(footprint) || 0;
  const kw = Number(totalKw) || 0;
  const grundstueck_m2 = f * GRUNDSTUECK_JE_GRUNDFLAECHE;
  const construction_cost = b * (Number(rates.construction) || 0);
  const infrastructure_cost = grundstueck_m2 * (Number(rates.infrastructure) || 0);
  const energy_system_cost = kw * (Number(rates.energy) || 0);
  const site_preparation_cost = f * (Number(rates.site_prep) || 0);
  const total_cost = construction_cost + infrastructure_cost + energy_system_cost + site_preparation_cost;
  return {
    construction_cost,
    infrastructure_cost,
    energy_system_cost,
    site_preparation_cost,
    total_cost,
    cost_per_m2: b ? total_cost / b : 0,
    grundstueck_m2,
  };
}
