// Entity list of phase 82 (Kalender, Schriftverkehr & Rechte): the seven
// collections the phase owns, which of them the storage layer locks in the
// cloud (E-03), the marker Setting of the sample data, and the three rows of
// the export registry (79-12, E-07) — one table for the storage layer, the
// export dialog and the rights (82-02).
//
// Abwesenheit is NOT here: it is personnel data and lives in the personnel
// storage class of phase 80 (its entity list in personalEntitaeten.js, D-P82-38).
//
// In:  the rule lists of the phase (their override keys travel with the row
//      "Termine & Gewährleistung"). Out: BUERO_ORGA_ENTITAETEN,
//      BUERO_ORGA_GESPERRT, BUERO_ORGA_SETTING_KEY, RECHTE_SETTING_KEY,
//      BUERO_ORGA_EXPORT_BEREICHE.

import { FRISTEN_REGELN } from "../termine/fristenRegeln.js";
import { KALENDER_REGELN } from "../abwesenheit/kalenderRegeln.js";

/** The seven collections of phase 82 (bitApi.entities, IndexedDB stores of the same name). */
export const BUERO_ORGA_ENTITAETEN = Object.freeze(["Termin", "Terminquittung", "Abnahme", "Nutzer", "Schreiben", "Briefvorlage", "Postbucheintrag"]);

/**
 * Collections the storage layer refuses in the cloud without the release E-20
 * (E-03 names /Correspondence and the rights; deadlines and acceptances are
 * project data and stay open).
 */
export const BUERO_ORGA_GESPERRT = Object.freeze(["Nutzer", "Schreiben", "Briefvorlage", "Postbucheintrag"]);

/** Key of the phase's marker Setting (sample data, § 5). */
export const BUERO_ORGA_SETTING_KEY = "buero_orga";

/** Key of the rights Setting (deviations from the standard matrix, rechte.js). */
export const RECHTE_SETTING_KEY = "rechte";

/**
 * The three rows of the export registry (79-12 ExportBereich form). The marker
 * buero_orga is in all three: it travels only when all three areas travel
 * (pattern 79 `buchhaltung`, 81 `ZEIT_HONORAR_SETTING_KEYS`). The override keys
 * of the rule groups fristen and kalender are generated from the rule ids, so a
 * new rule travels with its row automatically.
 */
export const BUERO_ORGA_EXPORT_BEREICHE = Object.freeze([
  Object.freeze({
    key: "fristen",
    label: "Termine & Gewährleistung",
    entitaeten: Object.freeze(["Termin", "Terminquittung", "Abnahme"]),
    settingKeys: Object.freeze([BUERO_ORGA_SETTING_KEY, ...[...FRISTEN_REGELN, ...KALENDER_REGELN].map((r) => "regel:" + r.id)]),
    separat: null,
  }),
  Object.freeze({
    key: "schriftverkehr",
    label: "Schriftverkehr & Postbuch",
    entitaeten: Object.freeze(["Schreiben", "Briefvorlage", "Postbucheintrag"]),
    // 82-02: office and accounting letters (Document.bereich, DOKUMENT_BEREICH of 82-01) only with this row.
    dokumentBereiche: Object.freeze(["schriftverkehr", "buchhaltung"]),
    settingKeys: Object.freeze([BUERO_ORGA_SETTING_KEY]),
    separat: null,
  }),
  Object.freeze({
    key: "rechte",
    label: "Nutzer & Rechte",
    entitaeten: Object.freeze(["Nutzer"]),
    settingKeys: Object.freeze([RECHTE_SETTING_KEY, BUERO_ORGA_SETTING_KEY]),
    separat: null,
  }),
]);
