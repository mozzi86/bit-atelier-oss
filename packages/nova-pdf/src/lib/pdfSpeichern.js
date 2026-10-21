// 104-09: "Im PDF speichern" of the PDF studio — the studio annotations go into the document file
// as an incremental update (pdfAnmerkungen.js → inkrementell.js), the record points at the new file.
//
// Order of writes (crash safety, same idea as ersetzeAtomar in 104-01): the new file is stored under
// a NEW blob id first, then the Document record is switched over, and only then the old blob is
// deleted. A crash in between leaves the record on the old, complete file; the next save finds the
// annotations by their /NM and does not duplicate anything.
//
// Fixed documents (Document.sha256 set: sent letters, fee offers, order confirmations) are refused
// before anything is read or written — their bytes are the proof of what was sent (ablage.js), and a
// changed file under the old checksum would make that proof wrong without anyone noticing.
//
// Additive Document fields (existing fields keep their meaning):
//   original_bytes     length of the file as uploaded, bytes — the untouched prefix of every later state
//   pdf_anmerkungen    { record id: fingerprint } of the studio annotations in the file (studioStand.js)
//   pdf_gespeichert    ISO time of the last save
//   pdf_speicherungen  [{ bytes, datum, neu, geaendert, entfernt }] one entry per appended update;
//                      `bytes` = file length after it, so every earlier state is the prefix of that length
//
// In: Document record, annotation records, API (bitApi or a test double). Out: updated record + report.

import { anmerkungenAbgleichen, ansichtOhneStudio } from "./pdfAnmerkungen.js";
import { enthaeltStudioMarke, istFestgeschrieben } from "./studioStand.js";
import { inhaltAblegen, inhaltLaden, blobIdNeu } from "@core/lib/speicherOrt";

/**
 * data URL (base64) → bytes.
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
export function dataUrlZuBytes(dataUrl) {
  const bin = atob(String(dataUrl).split(",")[1] || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Bytes → data URL (base64), chunked so large files do not overflow the argument list.
 * @param {Uint8Array} bytes
 * @param {string} [mime]
 * @returns {string}
 */
export function bytesZuDataUrl(bytes, mime = "application/pdf") {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Bytes for the screen: without the studio's own annotations when the file has some (the overlay
 * draws them), otherwise the input itself. Never stored.
 * @param {Uint8Array} bytes stored file
 * @returns {Promise<Uint8Array>}
 */
export async function anzeigeBytes(bytes) {
  return enthaeltStudioMarke(bytes) ? ansichtOhneStudio(bytes) : bytes;
}

/**
 * Minimal API surface used here (bitApi has it).
 * @typedef {object} SpeicherApi
 * @property {any} entities needs entities.Document.update(id, data) → Promise<record>
 * @property {any} blobs needs put(id, json), get(id), delete(id) → Promise
 */

/**
 * Writes the studio annotations into the document file as an incremental update and switches the
 * record over. Local-only records (`_lokal`) are refused — they need a server id first. Fixed
 * documents (istFestgeschrieben: Document.sha256 set) are refused before any read or write.
 * @param {object} o
 * @param {any} o.dokument Document record (data / data_blob as stored by inhaltAblegen)
 * @param {import("./studioStand.js").StudioAnmerkung[]} o.anmerkungen records that shall be in the PDF
 * @param {SpeicherApi} o.api
 * @param {Date} [o.jetzt]
 * @returns {Promise<{dokument: any, bericht: import("./pdfAnmerkungen.js").AbgleichBericht, geschrieben: boolean, hinweis: string|null}>}
 *   geschrieben = false: the file already matched, only the record's map was refreshed
 * @throws {Error} plain-text message (fixed document, file unreadable/protected, local records, storage refused)
 */
export async function imPdfSpeichern({ dokument, anmerkungen, api, jetzt = new Date() }) {
  if (istFestgeschrieben(dokument)) {
    throw new Error("Dokument ist festgeschrieben (versendet bzw. bestätigt, mit Prüfsumme) — die Datei bleibt unverändert. Anmerkungen bleiben im Studio und lassen sich annotiert exportieren.");
  }
  if (anmerkungen.some((a) => a._lokal)) throw new Error("Es gibt Anmerkungen, die der Server noch nicht hat — erst nachtragen.");
  const inhalt = await inhaltLaden(dokument.data, dokument.data_blob, { api });
  if (!inhalt) throw new Error("Dateiinhalt des Dokuments nicht gefunden.");
  const original = dataUrlZuBytes(inhalt);
  const { bytes, objekte, bericht } = await anmerkungenAbgleichen(original, anmerkungen);
  const datum = jetzt.toISOString();
  /** @type {Record<string, any>} */
  const patch = {
    pdf_anmerkungen: Object.fromEntries(Object.entries(objekte).map(([id, o]) => [id, o.fp])),
    pdf_gespeichert: datum,
  };
  let hinweis = null;
  if (bytes) {
    const ablage = await inhaltAblegen(bytesZuDataUrl(bytes, dokument.mime || "application/pdf"), { blobId: blobIdNeu("dok"), art: "dokument", api });
    hinweis = ablage.hinweis;
    Object.assign(patch, {
      data: ablage.inline,
      data_blob: ablage.blob,
      size: bytes.length,
      original_bytes: Number.isFinite(dokument.original_bytes) ? dokument.original_bytes : original.length,
      pdf_speicherungen: [...(Array.isArray(dokument.pdf_speicherungen) ? dokument.pdf_speicherungen : []),
        { bytes: bytes.length, datum, neu: bericht.neu, geaendert: bericht.geaendert, entfernt: bericht.entfernt }],
    });
  }
  const antwort = await api.entities.Document.update(dokument.id, patch);
  if (bytes && dokument.data_blob && dokument.data_blob !== patch.data_blob) {
    // Old file is no longer referenced; a failed delete leaves an orphan blob, never a broken record.
    try { await api.blobs.delete(dokument.data_blob); } catch { /* orphan blob, harmless */ }
  }
  return { dokument: { ...dokument, ...patch, ...(antwort && typeof antwort === "object" ? antwort : {}) }, bericht, geschrieben: !!bytes, hinweis };
}
