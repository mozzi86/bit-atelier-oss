// 106-10: storage of the change log (entity AenderungsSchritt) - the one place that writes it. A viewer hands in its confirmed steps
// (protokollAnbinden -> schrittBestaetigt / schrittZurueckgenommen, called by the change commands of 106-03), the review page loads
// the list and writes the release and reversal notes.
//
// The viewer must never wait for the log: the register answers synchronously, the record follows; a failed write is said in words
// (onFehler) and does not undo the change - the change itself is stored with its origin mark / journal fields anyway (106-03).
//
// In:  step records (verlauf/schrittVerlauf.js), patches (aenderungsProtokoll.js). Out: promises of stored records.
import { bitApi } from "@core/api/bitApi";
import { SCHRITT_ENTITY, schrittAusEintrag } from "../verlauf/schrittVerlauf.js";
import { ruecknahmeVermerk } from "./aenderungsProtokoll.js";

/** @returns {any} the entity accessor of the log */
const tabelle = () => /** @type {any} */ (bitApi.entities)[SCHRITT_ENTITY];

/**
 * All steps of a project (unordered; aenderungsProtokoll.js orders them).
 * @param {string} projektId @returns {Promise<any[]>}
 */
export async function schritteLaden(projektId) {
  if (!projektId) return [];
  return (await tabelle().filter({ project_id: String(projektId) })) || [];
}

/**
 * Writes a patch onto one stored step (release or reversal note).
 * @param {string} id  Record id. @param {Record<string, any>} patch @returns {Promise<any>} the stored record
 */
export function schrittAktualisieren(id, patch) {
  return tabelle().update(id, patch);
}

/**
 * Connects a viewer's change commands to the log. Spread the result into the viewer's AenderungsFlaeche.
 * @param {{projektId: () => (string|null), autor: () => (string|null), quelle: "bim"|"ifc", modell?: () => (string|null), onFehler?: (was: string, detail: string) => void}} o
 *   projektId / autor / modell are read at the moment of the step (project switch, sign-in); onFehler gets an i18n key (German) and the error text.
 * @returns {{schrittBestaetigt: (vorschlag: any, eintrag: any) => Promise<any|null>, schrittZurueckgenommen: (eintrag: any, ort?: "fenster"|"speichern") => Promise<any|null>}}
 *   schrittBestaetigt: stores the step (null without project); schrittZurueckgenommen: marks the stored step of this proposal as reversed
 *   (waits for its record when it is still being written).
 */
export function protokollAnbinden(o) {
  /** records being written, by proposal id: a reversal right after the confirmation must find its record */
  const imFlug = new Map();
  const fehler = (/** @type {string} */ was, /** @type {any} */ e) => o.onFehler?.(was, String(e?.message || e));
  return {
    schrittBestaetigt(vorschlag, eintrag) {
      const pid = o.projektId();
      if (!pid) return Promise.resolve(null);
      let rec;
      try {
        rec = schrittAusEintrag(eintrag, { projektId: pid, quelle: o.quelle, modell: o.modell?.() ?? null, pruefung: vorschlag?.pruefung, autor: o.autor() });
      } catch (e) { fehler("Änderungsprotokoll", e); return Promise.resolve(null); }
      const p = tabelle().create(rec).catch((/** @type {any} */ e) => { fehler("Änderungsprotokoll nicht gespeichert", e); return null; });
      imFlug.set(String(eintrag.vorschlag_id), p);
      return p;
    },
    async schrittZurueckgenommen(eintrag, ort = "fenster") {
      const pid = o.projektId();
      const id = String(eintrag?.vorschlag_id ?? "");
      if (!pid || !id) return null;
      try {
        const neu = await imFlug.get(id);
        const rec = neu?.id ? neu : ((await tabelle().filter({ project_id: String(pid), vorschlag_id: id })) || [])[0];
        if (!rec?.id) return null;
        return await schrittAktualisieren(rec.id, ruecknahmeVermerk({ durch: o.autor(), ort }));
      } catch (e) { fehler("Änderungsprotokoll nicht aktualisiert", e); return null; }
    },
  };
}
