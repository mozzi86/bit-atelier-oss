// Data of the controlling chip in "Aktives Projekt" (phase 81-05, CTRL-02, E-03).
// The project overview is NOT a locked page, so the chip must not read time and
// fee data where the office modules are locked (Supabase build without the
// release E-20): it checks verfuegbar(datenquelle) BEFORE any query and returns
// null — no request, no chip. Otherwise it reads only the four collections of
// the one project through the storage layer (src/lib/zeitHonorar/speicher.js)
// and the cost rates through the personnel adapter (empty without access → the
// controlling falls back to the office rate).
//
// In:  {api, datenquelle, cloudFreigabe, rolle, projectId}; optionally an injected
//      personnel api (tests). Out: the loaded lists or null; the chip state.

import { ladeZeitHonorar, verfuegbar } from "@/lib/zeitHonorar/speicher.js";
import { ladePersonalFuerZeit } from "@/lib/people/zeitHonorarPersonal.js";
import { hauptvertrag, projektControlling } from "./controlling.js";

/** Collections the chip reads, filtered by project_id. */
export const AMPEL_CHIP_ENTITAETEN = Object.freeze(["Honorarvertrag", "Honorarnachtrag", "Zeitbuchung", "HoaiPlan"]);

/**
 * Loads what the chip needs for one project — or null on a locked data path or
 * without a project (then nothing is queried at all).
 * @param {{api: any, datenquelle: string, cloudFreigabe?: boolean, rolle?: string|null, projectId: string|null|undefined}} kontext
 * @param {{personalApi?: any}} [optionen] personalApi: fake with the shape of bitApi (tests)
 * @returns {Promise<{daten: Record<string, any[]>, personal: import("@/lib/people/zeitHonorarPersonal.js").PersonalFuerZeit}|null>}
 * @throws {Error} plain text when the storage refuses or a read fails
 */
export async function ladeAmpelChipDaten({ api, datenquelle, cloudFreigabe, rolle = null, projectId }, { personalApi } = {}) {
  if (!projectId || !verfuegbar(datenquelle, cloudFreigabe)) return null;
  const [daten, personal] = await Promise.all([
    ladeZeitHonorar(api, { entitaeten: AMPEL_CHIP_ENTITAETEN, filter: { project_id: projectId } }),
    ladePersonalFuerZeit({ datenquelle, rolle }, { api: personalApi }),
  ]);
  return { daten, personal };
}

/**
 * Chip state of a project: null without a contract (the chip only shows for
 * projects with an architect's contract); otherwise the project light. Without
 * personnel access the office rate is used — personal rates never leave the
 * personnel class (T-81-24).
 * @param {{daten: Record<string, any[]>, personal: {zugang: string, mitarbeiter: any[], kostensaetze: any[]}}|null} geladen
 * @param {{regeln: {ampel_gelb?: number, ampel_rot?: number, buerosatz?: number|null}, heute: string}} kontext
 * @returns {{ampel: string, tafelFehlt: boolean}|null}
 */
export function ampelChipZustand(geladen, { regeln, heute }) {
  if (!geladen) return null;
  const vertrag = hauptvertrag(geladen.daten.Honorarvertrag || []);
  if (!vertrag) return null;
  const mitZugang = geladen.personal?.zugang === "erlaubt";
  const c = projektControlling({
    vertrag,
    nachtraege: geladen.daten.Honorarnachtrag || [],
    hoaiPlan: (geladen.daten.HoaiPlan || [])[0] || null,
    buchungen: geladen.daten.Zeitbuchung || [],
    kostensaetze: mitZugang ? geladen.personal.kostensaetze : [],
    mitarbeiter: mitZugang ? geladen.personal.mitarbeiter : [],
    regeln,
  }, { satzModus: mitZugang ? "persoenlich" : "buero", stichtagIso: heute });
  return { ampel: c.ampel, tafelFehlt: c.tafelFehlt };
}
