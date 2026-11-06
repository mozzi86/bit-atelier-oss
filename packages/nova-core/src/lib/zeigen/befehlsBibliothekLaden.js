// 106-10: loads the office's command library (entity Befehlsvorlage) into the cache of befehlsBibliothek.js. Called by the speech field
// when it opens and by the library page after every save. A failed load leaves the old cache and says why (the grammar then works
// without office templates, as before 106-10).
//
// In:  nothing (office-wide entity). Out: the active, valid templates.
import { bitApi } from "@core/api/bitApi";
import { VORLAGE_ENTITY, bibliothekSetzen, bibliothekAktuell } from "./befehlsBibliothek.js";

/** @type {Promise<any[]>|null} one request at a time */
let laeuft = null;

/**
 * Reads all templates of the office and fills the cache.
 * @param {{neu?: boolean}} [opt]  neu: load again even when a load ran before.
 * @returns {Promise<{vorlagen: any[], roh: any[], fehler: string|null}>}  vorlagen: active, valid ones (cache); roh: all stored records
 *   (the library page shows the invalid ones with their reason); fehler: German text when the store could not be read.
 */
export async function bibliothekLaden(opt = {}) {
  try {
    if (!laeuft || opt.neu) laeuft = /** @type {any} */ (bitApi.entities)[VORLAGE_ENTITY].list();
    const roh = (await laeuft) || [];
    return { vorlagen: bibliothekSetzen(roh), roh, fehler: null };
  } catch (e) {
    laeuft = null;
    return { vorlagen: bibliothekAktuell(), roh: [], fehler: `Befehlsbibliothek nicht geladen: ${/** @type {any} */ (e)?.message || e}` };
  }
}
