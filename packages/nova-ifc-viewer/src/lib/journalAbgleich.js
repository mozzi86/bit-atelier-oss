// 106-09: the IFC change journal (entity IfcAenderung, see attributJournal.js) between devices. The journal is
// append-only - a confirmed property change is a NEW entry, an undo deletes its own entry - so two devices never
// overwrite each other's records. What can happen is that both change the SAME property of the same element from the
// same starting value at the same time: two entries with equal `alt` and different `wert`. That is the conflict this
// module detects (Task 3): it is shown with both values and the person decides; the decision is a new entry.
//
// Pure: no I/O. In: the journal as the viewer holds it, one stream event (+ its record), the model name, which entries
// this page wrote itself. Out: the new journal, a note line, a conflict or null; konfliktSchluessel(), entscheidungsEintrag().

import { gleich, letzterEintrag } from "./attributJournal.js";

/** @typedef {import("./attributJournal.js").JournalEintrag} JournalEintrag */

/** @param {{guid: string, pset: string, eigenschaft: string}} e @returns {string} conflict id part of one property */
export const konfliktSchluessel = (e) => `${e.guid}|${e.pset}|${e.eigenschaft}`;

/** @param {any} v @returns {string} */
const wertText = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** German sentence pattern of a note line (translated through t; review 106-09: no fixed German word in the data text). */
export const ZEILE_MUSTER = "{eigenschaft} ({pset}) an {guid}: {werte}";

/**
 * Note line of one entry: "Feuerwiderstand (Pset_WallCommon) an <GUID>: F30 → F90".
 * @param {JournalEintrag} e @param {boolean} [zurueck] the entry was withdrawn (deleted) on the other device
 * @param {(s: string) => string} [t] translator of the sentence pattern
 * @returns {{text: string, herkunft: string[]|null, bestaetigt_durch: string|null, zurueck: boolean}}
 */
export function journalZeile(e, zurueck = false, t = (s) => s) {
  const werte = zurueck ? `${wertText(e.wert)} → ${wertText(e.alt)}` : `${wertText(e.alt)} → ${wertText(e.wert)}`;
  const text = t(ZEILE_MUSTER).replace("{eigenschaft}", String(e.eigenschaft)).replace("{pset}", String(e.pset))
    .replace("{guid}", String(e.guid)).replace("{werte}", werte);
  return { text, herkunft: e.herkunft ? [String(e.herkunft)] : null, bestaetigt_durch: e.bestaetigt_durch ?? null, zurueck };
}

/**
 * Applies one stream event of another device to the journal.
 * @param {JournalEintrag[]} journal entries of the loaded model as the viewer holds them
 * @param {{art: "angelegt"|"geaendert"|"geloescht", id: string}} ereignis
 * @param {JournalEintrag|null} rec the record (null for a deletion)
 * @param {{modell: string, eigen: (e: JournalEintrag) => boolean, t?: (s: string) => string}} o modell = loaded model;
 *   eigen = entry written by this page; t = translator of the note line
 * @returns {{journal: JournalEintrag[], geaendert: boolean, zeile?: ReturnType<typeof journalZeile>,
 *   konflikt?: {mein: JournalEintrag, fremd: JournalEintrag}|null, schluessel?: string}}
 */
export function journalFremdAnwenden(journal, ereignis, rec, { modell, eigen, t = (s) => s }) {
  if (ereignis.art === "geloescht") {
    const alt = journal.find((x) => x.id === ereignis.id);
    if (!alt) return { journal, geaendert: false };
    return { journal: journal.filter((x) => x !== alt), geaendert: true, zeile: journalZeile(alt, true, t), konflikt: null, schluessel: konfliktSchluessel(alt) };
  }
  if (!rec || rec.modell !== modell) return { journal, geaendert: false };
  const schluessel = konfliktSchluessel(rec);
  const vorhanden = journal.find((x) => x.id != null && x.id === rec.id);
  if (vorhanden) {
    return { journal: journal.map((x) => (x === vorhanden ? rec : x)), geaendert: true, zeile: journalZeile(rec, false, t), konflikt: null, schluessel };
  }
  // both started from the same value and ended at different ones: neither saw the other's change
  const mein = [...journal].reverse().find((x) => eigen(x) && konfliktSchluessel(x) === schluessel && gleich(x.alt, rec.alt) && !gleich(x.wert, rec.wert));
  return { journal: [...journal, rec], geaendert: true, zeile: journalZeile(rec, false, t), konflikt: mein ? { mein, fremd: rec } : null, schluessel };
}

/**
 * Review 106-09: after a gap in the stream, what changed in the stored journal of the loaded model as events: entries
 * this page does not hold yet ("angelegt") and entries of other devices it holds that are gone ("geloescht"). Own entries
 * still on their way to the server (no id yet) are never taken for deleted.
 * @param {JournalEintrag[]} journal what the viewer holds @param {JournalEintrag[]} gespeichert the stored entries of the model
 * @param {(e: JournalEintrag) => boolean} eigen entry written by this page
 * @returns {Array<{ereignis: {art: "angelegt"|"geloescht", id: string}, rec: JournalEintrag|null}>}
 */
export function journalLuecke(journal, gespeichert, eigen) {
  const da = new Set(journal.map((x) => x.id).filter((x) => x != null));
  const dort = new Set(gespeichert.map((x) => x.id).filter((x) => x != null));
  /** @type {Array<{ereignis: {art: "angelegt"|"geloescht", id: string}, rec: JournalEintrag|null}>} */
  const out = [];
  for (const rec of gespeichert) if (rec.id != null && !da.has(rec.id)) out.push({ ereignis: { art: "angelegt", id: String(rec.id) }, rec });
  for (const x of journal) if (x.id != null && !dort.has(x.id) && !eigen(x)) out.push({ ereignis: { art: "geloescht", id: String(x.id) }, rec: null });
  return out;
}

/**
 * The entry that records the person's decision in a conflict: from the value in force now to the chosen one, or null
 * when the chosen value is already in force (nothing to write).
 * @param {JournalEintrag[]} journal @param {{mein: JournalEintrag, fremd: JournalEintrag}} k @param {"mein"|"fremd"} wahl
 * @param {{zeit?: string}} [o]
 * @returns {JournalEintrag|null}
 */
export function entscheidungsEintrag(journal, k, wahl, o = {}) {
  const ziel = wahl === "mein" ? k.mein : k.fremd;
  const jetzt = letzterEintrag(journal, ziel.modell, ziel.guid, ziel.pset, ziel.eigenschaft);
  if (jetzt && gleich(jetzt.wert, ziel.wert)) return null;
  return {
    project_id: ziel.project_id ?? null, modell: ziel.modell, guid: ziel.guid, pset: ziel.pset, eigenschaft: ziel.eigenschaft,
    alt: jetzt ? jetzt.wert : ziel.alt, wert: ziel.wert, zeit: o.zeit || new Date().toISOString(),
    // the person picked the version in the conflict card: a decision by hand, confirmed by hand
    herkunft: "hand", befehl_text: null, bestaetigt_durch: "hand",
  };
}
