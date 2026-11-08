// portfolioKennzahlen.js — key figures and latest activities of the page "Portfolio (Projektentwicklung)"
// (src/pages/AtelierDeveloper.jsx), computed only from records that exist (112-01, foreign review point 1).
//
// Why: the page showed fixed numbers ("mock data for now": 125 000 m² BGF, 82.4 % efficiency, 23.1 % energy savings,
// 45.6 Mio. € portfolio value), three invented activities and a static "system state" — also with an empty database.
// The Project schema (packages/nova-core/server/schemas/Project.json) has no gross floor area, efficiency, energy saving
// or value field, so those tiles are gone; the area is the sum of the area the user entered per project (projectArea,
// building_area or area_net) and is labelled as such, not as BGF.
//
// In:  the projects the role may see (already filtered by projekteNachZugriff), EnergyScenario records.
// Out: portfolioKennzahlen, letzteAktivitaeten. Pure — no storage, no clock.

import { projectArea } from "@core/lib/projectModel.js";
import { screeningZaehlung } from "@core/lib/energieScreening";

/**
 * @typedef {{ id: string, name?: string, updated_date?: string, created_date?: string, building_area?: number, area_net?: number }} PortfolioProjekt
 * @typedef {{ id?: string, project_id?: string, created_date?: string, geg_compliance?: { passes_geg?: boolean } }} PortfolioSzenario
 */

/**
 * Key figures of the visible projects.
 * @param {PortfolioProjekt[]} projekte projects the role may see (filtered list, not the raw one)
 * @param {PortfolioSzenario[]} szenarien EnergyScenario records (any project; only visible projects count)
 * @returns {{ anzahl: number, flaecheM2: number|null, mitFlaeche: number, screening: { eingehalten: number, mitErgebnis: number } }}
 *   anzahl = number of projects; flaecheM2 = sum of the entered project areas in m² (null when no project has one —
 *   the page shows "—", never 0 m² as if it were measured); mitFlaeche = number of projects with an area;
 *   screening = count of projects whose newest energy screening stays below the guide value (energieScreening.js)
 */
export function portfolioKennzahlen(projekte = [], szenarien = []) {
  const liste = Array.isArray(projekte) ? projekte : [];
  let summe = 0;
  let mitFlaeche = 0;
  for (const p of liste) {
    const a = Number(projectArea(p));
    if (Number.isFinite(a) && a > 0) {
      summe += a;
      mitFlaeche += 1;
    }
  }
  return {
    anzahl: liste.length,
    flaecheM2: mitFlaeche > 0 ? summe : null,
    mitFlaeche,
    screening: screeningZaehlung(liste, Array.isArray(szenarien) ? szenarien : []),
  };
}

/**
 * One line of the activity list.
 * @typedef {{ id: string, art: "projekt"|"angelegt"|"screening", projektName: string, datum: string }} PortfolioAktivitaet
 *   art = what happened: "angelegt" = project record created and not changed since (no updated_date, or updated_date equal
 *   to created_date - db.js sets both on create), "projekt" = project record changed later, "screening" = energy screening
 *   stored; projektName = record data (not translated, "" when the project has no name - the page shows a placeholder);
 *   datum = ISO timestamp of the record
 */

/**
 * Latest activities from real timestamps: a project record's updated_date (created_date when it was never changed) and an
 * energy screening's created_date.
 * Screenings of projects the role does not see are left out (same filter as the key figures). Records without a
 * valid date are left out — an honest empty list is better than an invented "vor 2 Stunden".
 * @param {PortfolioProjekt[]} projekte projects the role may see
 * @param {PortfolioSzenario[]} szenarien EnergyScenario records
 * @param {number} [anzahl=5] maximum number of lines
 * @returns {PortfolioAktivitaet[]} newest first
 */
export function letzteAktivitaeten(projekte = [], szenarien = [], anzahl = 5) {
  const liste = Array.isArray(projekte) ? projekte : [];
  const namen = new Map(liste.map((p) => [p.id, p.name || ""]));
  const gueltig = (d) => typeof d === "string" && Number.isFinite(Date.parse(d));
  /** @type {PortfolioAktivitaet[]} */
  const zeilen = [];
  for (const p of liste) {
    const datum = p.updated_date || p.created_date;
    const angelegt = !p.updated_date || p.updated_date === p.created_date;
    if (gueltig(datum)) zeilen.push({ id: `projekt-${p.id}`, art: angelegt ? "angelegt" : "projekt", projektName: p.name || "", datum: /** @type {string} */ (datum) });
  }
  for (const s of Array.isArray(szenarien) ? szenarien : []) {
    if (!s?.project_id || !namen.has(s.project_id) || !gueltig(s.created_date)) continue;
    zeilen.push({ id: `screening-${s.id ?? s.project_id + s.created_date}`, art: "screening", projektName: namen.get(s.project_id) || "", datum: /** @type {string} */ (s.created_date) });
  }
  zeilen.sort((a, b) => Date.parse(b.datum) - Date.parse(a.datum));
  return zeilen.slice(0, Math.max(0, anzahl));
}
