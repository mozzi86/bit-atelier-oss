// 106-10: names of the entities of the review workplace, in a file without imports so the server (routes.js) can read them
// without loading the change functions.
//
// In: nothing. Out: entity names.

/** One record per confirmed change of a model (the ordered step list, verlauf/schrittVerlauf.js). */
export const SCHRITT_ENTITY = "AenderungsSchritt";

/** One record per sentence template of the office's command library (zeigen/befehlsBibliothek.js). */
export const VORLAGE_ENTITY = "Befehlsvorlage";

/**
 * Entities only the person in the app's own page may write (POST/PUT/DELETE): release and reversal notes are human actions
 * (decision D-IM-04), and the office's allowed values steer the speech grammar - a program (an agent over the MCP server, curl)
 * may read them, never write them. Enforced in packages/nova-core/server/routes.js.
 */
export const NUR_PERSON_SCHREIBT = Object.freeze([SCHRITT_ENTITY, VORLAGE_ENTITY]);
