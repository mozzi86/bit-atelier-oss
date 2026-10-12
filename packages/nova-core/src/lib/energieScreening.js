// Honest wording for the energy screening (liability, 12.10.2026).
//
// The app compares a calculated demand with a reference guide value (EnergyScenario.geg_compliance:
// calculated_demand vs. reference_building_demand in kWh/(m²·a), passes_geg = below the reference). That is a
// SCREENING with guide values — it is never a GEG proof (the proof under the Gebäudeenergiegesetz is drawn up
// by an entitled person with a full DIN V 18599 calculation). Before, the report printed a passed GEG
// proof with a tick and the portfolio dashboard showed a GEG conformity rate. Every place that shows the result takes its
// words from here, so the wording cannot drift back. The strings are German i18n keys; the EN entries live in
// i18nTeile/energie-screening.js. tests/unit/energieScreening.test.js scans the sources for proof claims.
//
// In:  the geg_compliance object of an EnergyScenario (or nothing). Out: state + display texts.

/** Short disclaimer appended to every screening statement. */
export const KEIN_GEG_NACHWEIS = "kein GEG-Nachweis";

/** Label of the screening (row label, KPI label, tab title). */
export const SCREENING_TITEL = "Energie-Screening";

/**
 * Portfolio count: per project the NEWEST EnergyScenario (created_date) decides. Replaces the former
 * GEG conformity KPI that was a flat 89 % of all projects.
 * @param {Array<{ id: string }>} projekte
 * @param {Array<{ project_id?: string, created_date?: string, geg_compliance?: { passes_geg?: boolean } }>} szenarien
 * @returns {{ eingehalten: number, mitErgebnis: number }} number of projects (count, not percent)
 */
export function screeningZaehlung(projekte = [], szenarien = []) {
  /** @type {Map<string, { created_date?: string, geg_compliance?: { passes_geg?: boolean } }>} */
  const neuestes = new Map();
  for (const s of szenarien || []) {
    if (!s?.project_id) continue;
    const bisher = neuestes.get(s.project_id);
    if (!bisher || String(s.created_date ?? "") > String(bisher.created_date ?? "")) neuestes.set(s.project_id, s);
  }
  let eingehalten = 0;
  let mitErgebnis = 0;
  for (const p of projekte || []) {
    const stand = screeningAussage(neuestes.get(p?.id)?.geg_compliance).stand;
    if (stand === "offen") continue;
    mitErgebnis += 1;
    if (stand === "eingehalten") eingehalten += 1;
  }
  return { eingehalten, mitErgebnis };
}

/**
 * Screening statement for one scenario.
 * @param {{ passes_geg?: boolean } | null | undefined} geg EnergyScenario.geg_compliance
 * @returns {{ stand: "eingehalten"|"ueberschritten"|"offen", wert: string, text: string }}
 *   wert = value next to the label "Energie-Screening"; text = full sentence incl. the label
 */
export function screeningAussage(geg) {
  if (!geg || typeof geg.passes_geg !== "boolean") {
    return {
      stand: "offen",
      wert: "Kein Ergebnis — kein GEG-Nachweis",
      text: "Energie-Screening: kein Ergebnis — kein GEG-Nachweis",
    };
  }
  return geg.passes_geg
    ? {
      stand: "eingehalten",
      wert: "Richtwert eingehalten — kein GEG-Nachweis",
      text: "Energie-Screening: Richtwert eingehalten — kein GEG-Nachweis",
    }
    : {
      stand: "ueberschritten",
      wert: "Richtwert überschritten — kein GEG-Nachweis",
      text: "Energie-Screening: Richtwert überschritten — kein GEG-Nachweis",
    };
}
