// Project deletion guard (phase 81-06, BUERO-03, D-P81-30, T-81-31): a project
// that carries time bookings, fee offers, fee contracts or outgoing invoices is
// not deleted — those records have retention duties (time records as proof of
// the fee, contracts and invoices as business records; period [ASSUMED] as 79's
// GESETZ.AUFBEWAHRUNG, src/lib/accounting/einstellungen.js) and would be
// orphaned. The UI offers "Archivieren" instead (Project.archiviert_am).
//
// loeschSperre is pure. ladeLoeschDaten reads the four collections ONLY through
// the storage layer of phase 81 (src/lib/zeitHonorar/speicher.js, which also
// reads 79's Honorarvertrag/Ausgangsrechnung read-only) and only where the office
// modules are available (E-03): on a locked data path it queries nothing and
// returns empty lists — there no such record can have been written.
//
// In:  project id, the lists (or api + data path for the loader).
// Out: {gesperrt, gruende[{entitaet, anzahl}]}; istArchiviert (re-export from @core).

import { ladeZeitHonorar, verfuegbar } from "@/lib/zeitHonorar/speicher.js";

export { istArchiviert } from "@core/lib/projektArchiv.js";

/**
 * Lists the guard looks at.
 * @typedef {{zeitbuchungen: any[], angebote: any[], vertraege: any[], ausgangsrechnungen: any[]}} LoeschDaten
 */

/** Order and entity names of the reasons. */
const GRUENDE = Object.freeze([
  ["Zeitbuchung", "zeitbuchungen"],
  ["Honorarangebot", "angebote"],
  ["Honorarvertrag", "vertraege"],
  ["Ausgangsrechnung", "ausgangsrechnungen"],
]);

/**
 * Whether a project may be deleted. An invoice counts for the project by its
 * project_id or through one of the project's contracts (79 invoices may carry
 * only honorarvertrag_id).
 * @param {string} projectId
 * @param {Partial<LoeschDaten>} daten
 * @returns {{gesperrt: boolean, gruende: Array<{entitaet: string, anzahl: number}>}}
 */
export function loeschSperre(projectId, daten) {
  const vertragsIds = new Set((daten?.vertraege || []).filter((v) => v?.project_id === projectId).map((v) => v.id));
  /** @param {string} schluessel */
  const anzahl = (schluessel) => (/** @type {any} */ (daten)?.[schluessel] || []).filter((r) => r && (r.project_id === projectId
    || (schluessel === "ausgangsrechnungen" && !r.project_id && vertragsIds.has(r.honorarvertrag_id)))).length;
  const gruende = GRUENDE.map(([entitaet, schluessel]) => ({ entitaet, anzahl: anzahl(schluessel) })).filter((g) => g.anzahl > 0);
  return { gesperrt: gruende.length > 0, gruende };
}

/**
 * Loads the guard's lists for one project — or empty lists on a locked data path
 * without any query.
 * @param {any} api bitApi or a fake
 * @param {string} projectId
 * @param {{datenquelle: string, cloudFreigabe?: boolean}} kontext
 * @returns {Promise<LoeschDaten>}
 * @throws {Error} plain text when a read fails (the caller must not delete then)
 */
export async function ladeLoeschDaten(api, projectId, { datenquelle, cloudFreigabe }) {
  const leer = { zeitbuchungen: [], angebote: [], vertraege: [], ausgangsrechnungen: [] };
  if (!verfuegbar(datenquelle, cloudFreigabe)) return leer;
  const [projekt, rechnungen] = await Promise.all([
    ladeZeitHonorar(api, { entitaeten: ["Zeitbuchung", "Honorarangebot", "Honorarvertrag"], filter: { project_id: projectId } }),
    // Invoices without project_id are matched through the contract, so the whole list.
    ladeZeitHonorar(api, { entitaeten: ["Ausgangsrechnung"] }),
  ]);
  return { zeitbuchungen: projekt.Zeitbuchung, angebote: projekt.Honorarangebot, vertraege: projekt.Honorarvertrag, ausgangsrechnungen: rechnungen.Ausgangsrechnung };
}
