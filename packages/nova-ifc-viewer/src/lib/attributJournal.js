// 71-06 (ROHB-06): change journal of the attribute editor on imported IFC elements.
//
// Every edit of a property value in the IFC viewer becomes ONE journal entry (entity
// IfcAenderung of the project — and therefore part of every .bitproj backup). The IFC file
// itself is never touched in the app: the harness writer (71-05, `ifc_run schreibe
// journal=…`) applies the exported journal to a NEW file and keeps every GlobalId; the
// change service (71-09) lays the same journal over a newer model from the client.
//
// In:  journal entries {project_id, modell, guid, pset, eigenschaft, alt, wert, zeit}.
// Out: effective values per property, the editor rows of one element, the export object
//      in the harness format {format: "bit-ifc-journal", version: 1, modell, eintraege}.
//
// Size: one entry is well below 1 KB, so entries live in the database (storage rule
// speicherOrt.js: < 256 KB → record) — no object store involved.

/** Journal file format name shared with harness/skills/ifc/scripts/ifc_write.py. */
export const JOURNAL_FORMAT = "bit-ifc-journal";
/** Journal file format version. Bump only together with ifc_write.lade_journal. */
export const JOURNAL_VERSION = 1;

/** @typedef {string|number|boolean|null} Wert */
/**
 * @typedef {{id?: string, project_id?: string|null, modell: string, guid: string, pset: string,
 *   eigenschaft: string, alt: Wert, wert: Wert, zeit: string, herkunft?: string, befehl_text?: string|null, bestaetigt_durch?: string}} JournalEintrag
 *   herkunft / befehl_text / bestaetigt_durch (106-03, additive, only on entries written by the change commands): who asked
 *   (hand / text / sprache / agent / bild), with which words, and which channel confirmed. Entries of the attribute editor
 *   do not carry them; readers and the harness writer ignore unknown fields.
 */

const SEP = "\u0000";
const schluessel = (/** @type {string} */ pset, /** @type {string} */ eigenschaft) => `${pset}${SEP}${eigenschaft}`;

/**
 * Converts the text typed into the editor to the type of the current value: numbers stay
 * numbers (German decimal comma accepted), booleans stay booleans (ja/nein/true/false),
 * everything else is text. Throws with a plain-text reason when a number or boolean is
 * expected but the text is none.
 * @param {string} eingabe text from the input field
 * @param {Wert} vorlage current value (decides the type)
 * @returns {Wert}
 */
export function wertTypisieren(eingabe, vorlage) {
  const text = String(eingabe ?? "").trim();
  if (typeof vorlage === "number") {
    const n = Number(text.replace(/\s/g, "").replace(",", "."));
    if (text === "" || !Number.isFinite(n)) throw new Error(`„${text}“ ist keine Zahl`);
    return n;
  }
  if (typeof vorlage === "boolean") {
    const k = text.toLowerCase();
    if (["true", "ja", "wahr", "1"].includes(k)) return true;
    if (["false", "nein", "falsch", "0"].includes(k)) return false;
    throw new Error(`„${text}“ ist weder ja noch nein`);
  }
  return text;
}

/**
 * Builds and validates one journal entry. Throws with a plain-text reason on missing fields.
 * @param {{projectId?: string|null, modell: string, guid: string, pset: string, eigenschaft: string,
 *   alt: Wert, wert: Wert, zeit?: string}} p
 * @returns {JournalEintrag}
 */
export function eintragBauen({ projectId = null, modell, guid, pset, eigenschaft, alt, wert, zeit }) {
  for (const [k, v] of Object.entries({ modell, guid, pset, eigenschaft })) {
    if (!v || !String(v).trim()) throw new Error(`Journal-Eintrag: ${k} fehlt`);
  }
  return {
    project_id: projectId,
    modell: String(modell),
    guid: String(guid),
    pset: String(pset),
    eigenschaft: String(eigenschaft),
    alt: alt ?? null,
    wert: wert ?? null,
    zeit: zeit || new Date().toISOString(),
  };
}

/** @param {JournalEintrag[]} eintraege */
const chronologisch = (eintraege) =>
  [...eintraege].sort((a, b) => String(a.zeit).localeCompare(String(b.zeit)));

/**
 * Effective values of one element: per (pset, property) the newest entry wins; `original`
 * is the value the model had before the FIRST edit (the `alt` of the oldest entry).
 * @param {JournalEintrag[]} eintraege all entries (any model/element)
 * @param {string} modell model file name
 * @param {string} guid GlobalId
 * @returns {Map<string, {pset: string, eigenschaft: string, wert: Wert, original: Wert, letzter: JournalEintrag, anzahl: number}>}
 */
export function wirksameWerte(eintraege, modell, guid) {
  /** @type {Map<string, {pset: string, eigenschaft: string, wert: Wert, original: Wert, letzter: JournalEintrag, anzahl: number}>} */
  const out = new Map();
  for (const e of chronologisch(eintraege || [])) {
    if (e.modell !== modell || e.guid !== guid) continue;
    const k = schluessel(e.pset, e.eigenschaft);
    const vorher = out.get(k);
    out.set(k, { pset: e.pset, eigenschaft: e.eigenschaft, wert: e.wert,
      original: vorher ? vorher.original : e.alt, letzter: e, anzahl: (vorher?.anzahl || 0) + 1 });
  }
  return out;
}

/**
 * Editor rows of one element: model psets overlaid with the journal. Rows of properties
 * the journal added (not in the model) are included too.
 * @param {Record<string, Record<string, any>>} psets element psets from ifcImport (pset → prop → value)
 * @param {JournalEintrag[]} eintraege
 * @param {string} modell
 * @param {string} guid
 * @returns {Array<{pset: string, eigenschaft: string, wert: Wert, original: Wert, geaendert: boolean, letzter: JournalEintrag|null}>}
 */
export function editorZeilen(psets, eintraege, modell, guid) {
  const wirksam = wirksameWerte(eintraege, modell, guid);
  /** @type {Array<{pset: string, eigenschaft: string, wert: Wert, original: Wert, geaendert: boolean, letzter: JournalEintrag|null}>} */
  const zeilen = [];
  const gesehen = new Set();
  for (const [pset, props] of Object.entries(psets || {})) {
    for (const [eigenschaft, roh] of Object.entries(props || {})) {
      const wert = roh == null || typeof roh === "object" ? (roh == null ? null : String(roh)) : roh;
      const k = schluessel(pset, eigenschaft);
      gesehen.add(k);
      const w = wirksam.get(k);
      zeilen.push(w
        ? { pset, eigenschaft, wert: w.wert, original: wert, geaendert: !gleich(w.wert, wert), letzter: w.letzter }
        : { pset, eigenschaft, wert, original: wert, geaendert: false, letzter: null });
    }
  }
  for (const [k, w] of wirksam) {
    if (!gesehen.has(k)) zeilen.push({ pset: w.pset, eigenschaft: w.eigenschaft, wert: w.wert, original: w.original, geaendert: true, letzter: w.letzter });
  }
  return zeilen;
}

/**
 * Value equality across number/text (1 == "1", 1 == 1.0); null only equals null.
 * @param {Wert} a
 * @param {Wert} b
 */
export function gleich(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") return Math.abs(na - nb) < 1e-9;
  return String(a) === String(b);
}

/**
 * Journal of one model in the harness format (ifc_write.lade_journal): one consolidated
 * entry per (guid, pset, property) — `alt` is the value before the first edit (the writer
 * applies it only while the file still holds that value, else conflict), `wert` the newest.
 * Edits that went back to the original value drop out.
 * @param {JournalEintrag[]} eintraege
 * @param {string} modell
 * @param {string} [exportiert] ISO time (tests)
 * @returns {{format: string, version: number, modell: string, exportiert: string,
 *   eintraege: Array<{guid: string, pset: string, eigenschaft: string, alt: Wert, wert: Wert, zeit: string}>}}
 */
export function journalExport(eintraege, modell, exportiert) {
  /** @type {Map<string, {guid: string, pset: string, eigenschaft: string, alt: Wert, wert: Wert, zeit: string}>} */
  const je = new Map();
  for (const e of chronologisch(eintraege || [])) {
    if (e.modell !== modell) continue;
    const k = `${e.guid}${SEP}${schluessel(e.pset, e.eigenschaft)}`;
    const vorher = je.get(k);
    je.set(k, { guid: e.guid, pset: e.pset, eigenschaft: e.eigenschaft,
      alt: vorher ? vorher.alt : e.alt, wert: e.wert, zeit: e.zeit });
  }
  return {
    format: JOURNAL_FORMAT,
    version: JOURNAL_VERSION,
    modell,
    exportiert: exportiert || new Date().toISOString(),
    eintraege: [...je.values()].filter((e) => !gleich(e.alt, e.wert)),
  };
}

/**
 * The entry to delete for "undo the last edit of this property" (newest one), or null.
 * @param {JournalEintrag[]} eintraege
 * @param {string} modell
 * @param {string} guid
 * @param {string} pset
 * @param {string} eigenschaft
 * @returns {JournalEintrag|null}
 */
export function letzterEintrag(eintraege, modell, guid, pset, eigenschaft) {
  const passend = chronologisch(eintraege || []).filter((e) =>
    e.modell === modell && e.guid === guid && e.pset === pset && e.eigenschaft === eigenschaft);
  return passend.length ? passend[passend.length - 1] : null;
}

/**
 * File name of the journal download: "<model stem>.journal.json" (harness reads it with
 * `ifc_run schreibe journal=model/<name>.journal.json`).
 * @param {string} modell
 */
export function journalDateiname(modell) {
  const stamm = String(modell || "modell").replace(/\.ifc$/i, "").replace(/[^\w.-]+/g, "_");
  return `${stamm}.journal.json`;
}
