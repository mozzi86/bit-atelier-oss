// Loader of the access provider (phase 82, 82-02): the only way from src/
// into ZugriffProvider (@core may not import the app). Loads
// - the users through the office store (bueroEntitaet, E-03 — in a cloud build
//   without the release E-20 not at all; the role then comes from the server role),
// - the rights setting (only deviations from the standard matrix),
// - the project assignments through 82-01's adapter ladeZuordnungsProjektion as
//   the narrow projection {mitarbeiter_id, alle, zuordnungen[{project_id,
//   funktion, von, bis}]} — no names or other personnel fields enter the
//   context, which every role holds in memory. It is read with the device/server
//   role, because the "Ansicht als" role only results from these data.
// It never names the personnel API itself (80's leak guard).
//
// In:  {datenquelle, rolle, stichtagIso}, optional api. Out: ladeZugriffsdaten.

import { bitApi } from "@core/api/bitApi";
import { bueroEntitaet, verfuegbar } from "@/lib/bueroOrga/speicher.js";
import { RECHTE_SETTING_KEY } from "@/lib/bueroOrga/entitaeten.js";
import { ladeZuordnungsProjektion } from "@/lib/people/bueroOrgaPersonal.js";

/**
 * @param {{datenquelle: string, rolle: string|null, stichtagIso: string}} kontext
 * @param {{api?: any}} [optionen]
 * @returns {Promise<{nutzer: Array<Record<string, any>>, einstellung: Record<string, any>|null, zuordnungen: Array<any>}>}
 * @throws {Error} plain text when users or the setting cannot be read (the provider shows it)
 */
export async function ladeZugriffsdaten({ datenquelle, rolle, stichtagIso }, { api = bitApi } = {}) {
  const a = /** @type {any} */ (api);
  const [nutzer, einstellungen, zuordnungen] = await Promise.all([
    verfuegbar(datenquelle) ? bueroEntitaet(a, "Nutzer", { datenquelle }).list() : Promise.resolve([]),
    a.entities.Setting.filter({ key: RECHTE_SETTING_KEY }),
    ladeZuordnungsProjektion({ datenquelle, rolle, stichtagIso }),
  ]);
  return {
    nutzer: Array.isArray(nutzer) ? nutzer : [],
    einstellung: Array.isArray(einstellungen) && einstellungen[0] ? einstellungen[0].value || null : null,
    zuordnungen: Array.isArray(zuordnungen) ? zuordnungen : [],
  };
}
