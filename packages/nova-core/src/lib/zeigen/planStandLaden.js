// 106-11: loading side of the model state of plans (planStand.js stays pure). Reads the stored model record and the step records
// of a project and builds the state; reads the state line back out of a plan PDF (its keywords) when a sheet is filed in the plan
// list. Every failure becomes a state "nicht ermittelt" with the reason - never an exception into the page and never a clean state.
//
// In:  project id, optional model loader (the studio passes its shared loadBimModel), PDF bytes.
// Out: ModellStand (planStand.js), PlanModellstand or null.
import { bitApi } from "@core/api/bitApi";
import { schritteLaden } from "./aenderungsProtokollSpeicher.js";
import { modellStand, modellStandUnbekannt, modellstandLesen } from "./planStand.js";

/**
 * Current model state of a project.
 * @param {string|null|undefined} projektId
 * @param {{modell?: () => Promise<any>, quelle?: "bim"|"ifc"|"alle"}} [opt]
 *   modell: loader of the stored BimModel record (default: a fresh read of the entity - the plan list must not trust a cache of
 *   another tab); quelle: which steps belong to the plan (default "bim").
 * @returns {Promise<import("./planStand.js").ModellStand>}  Never rejects.
 */
export async function aktuellenModellStandLaden(projektId, opt = {}) {
  if (!projektId) return modellStandUnbekannt("kein Projekt");
  try {
    const lade = opt.modell || (async () => ((await /** @type {any} */ (bitApi.entities).BimModel.filter({ project_id: projektId })) || [])[0] || null);
    const [modell, schritte] = await Promise.all([lade(), schritteLaden(String(projektId))]);
    return modellStand({ modell, schritte: Array.isArray(schritte) ? schritte : [], quelle: opt.quelle ?? "bim", projektId });
  } catch (e) {
    // fixed i18n key, the error text goes along untranslated (detail)
    return modellStandUnbekannt("Laden fehlgeschlagen", String(/** @type {any} */ (e)?.message || e));
  }
}

/**
 * The state line of a plan PDF (vektorPlanPdf writes it into the keywords). pdf-lib is loaded on demand - the plan list does not
 * carry it in its chunk.
 * @param {Uint8Array|ArrayBuffer} bytes  PDF file.
 * @returns {Promise<import("./planStand.js").PlanModellstand|null>}  null when the file is no readable PDF or has no state line
 *   (a sheet from elsewhere) - the upload itself goes on.
 */
export async function modellstandAusPdf(bytes) {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    return modellstandLesen(`${doc.getKeywords() ?? ""} ${doc.getSubject() ?? ""}`);
  } catch {
    return null;
  }
}
