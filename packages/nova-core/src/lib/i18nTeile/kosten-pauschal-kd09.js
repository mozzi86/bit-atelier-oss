// Wave 1 (KD-09): English texts of the assumption notes of the flat cost model
// (designer lib/pauschalKosten.js) in the cost tab and in the AVA cost control.
//
// LAZY part (index.js, sanctioned exception): imported by
// packages/nova-designer/src/components/CostCalculator.jsx and
// packages/nova-ausschreibung/src/components/CostControl.jsx, which call englischErgaenzen(EN).
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Annahme: Infrastruktur auf {f} × Grundfläche ≈ {m} m² Grundstück (entspricht GRZ {grz}); Kostensätze sind Richtwerte, keine Kostenberechnung.":
    "Assumption: infrastructure priced on {f} × footprint ≈ {m} m² of site (a site coverage ratio of {grz}); the rates are guide values, not a cost calculation.",
  "Pauschalschätzung mit Annahmen: Infrastruktur auf {f} × Grundfläche als Grundstück, Kostensätze als Richtwerte.":
    "Flat estimate on assumptions: infrastructure priced on {f} × footprint as site area, rates are guide values.",
};
