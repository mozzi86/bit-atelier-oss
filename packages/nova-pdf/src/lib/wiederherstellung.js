// 104-09: crash recovery of the PDF studio — a journal of the editing state per document hash.
//
// What can be lost in the studio: the comment typed into an open pin popover or text field (not yet
// confirmed), and annotations / deletions the server did not take (backend stopped, network gone —
// the studio then keeps them as "local"). Everything else is a server record the moment it is made.
// The studio writes exactly that into this journal (debounced, and at once when the tab is hidden);
// with nothing pending the entry is removed. An entry found when the same file is opened again is
// therefore always unsaved work from a crash or a closed tab, and the studio offers "Wiederherstellen".
//
// Key = SHA-256 of the file bytes: a journal belongs to exactly this file state; after "Im PDF
// speichern" the file (and its hash) changes and the old entry is cleared by the save.
// Storage rule (speicherOrt.js): a journal below 256 KB lives in localStorage, a larger one (long
// freehand strokes) in IndexedDB — the browser-side counterparts of "database" and "object store".
//
// In: studio state (records, drafts, page). Out: journal objects; storage through an adapter.

import { speicherOrt } from "@core/lib/speicherOrt";

/** Journal format version; a different version is ignored, never misread. */
export const JOURNAL_VERSION = 1;
/** Key prefix in localStorage / IndexedDB. */
export const JOURNAL_PRAEFIX = "bit-pdfstudio-journal:";
/** Autosave delay after the last change, milliseconds [ASSUMED: short enough to lose at most one word]. */
export const AUTOSAVE_MS = 800;
/** Journals older than this are dropped when the studio starts, days [ASSUMED: a month of grace]. */
export const JOURNAL_MAX_TAGE = 30;

/** @typedef {import("./studioStand.js").StudioAnmerkung} StudioAnmerkung */

/**
 * Unsaved editing state of one document.
 * @typedef {object} StudioJournal
 * @property {number} v format version (JOURNAL_VERSION)
 * @property {string} hash document hash (dokumentHash)
 * @property {string} dokumentId Document record id
 * @property {string} name file name, for the offer text
 * @property {string} zeit ISO time of the last write
 * @property {number} seite page shown, 1-based
 * @property {StudioAnmerkung[]} ausstehend annotations the server has not confirmed
 * @property {string[]} loeschungen record ids whose deletion did not reach the server
 * @property {{pin: {x: number, y: number, page: number, text: string}|null, text: {x: number, y: number, page: number, value: string}|null}} entwurf
 *   open drafts (normalised 0…1 coordinates like the records)
 */

/**
 * Storage adapter of the journal (browser: browserSpeicher(); tests: a Map).
 * @typedef {object} JournalSpeicher
 * @property {(key: string) => Promise<string|null>} lesen
 * @property {(key: string, text: string) => Promise<void>} schreiben
 * @property {(key: string) => Promise<void>} loeschen
 * @property {() => Promise<string[]>} schluessel all keys with JOURNAL_PRAEFIX
 */

/**
 * Hex SHA-256 of the file bytes (Web Crypto). Without Web Crypto (insecure context) a FNV-1a hash
 * plus the length is used — weaker, but only a lookup key, never a security check.
 * @param {Uint8Array} bytes whole file
 * @returns {Promise<string>} 64 hex digits, or "fnv-<8 hex>-<length>"
 */
export async function dokumentHash(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const puffer = await subtle.digest("SHA-256", /** @type {BufferSource} */ (/** @type {any} */ (bytes)));
    return Array.from(new Uint8Array(puffer), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv-${h.toString(16).padStart(8, "0")}-${bytes.length}`;
}

/**
 * Storage key of a document's journal.
 * @param {string} hash dokumentHash
 * @returns {string}
 */
export function journalSchluessel(hash) {
  return `${JOURNAL_PRAEFIX}${hash}`;
}

/**
 * Builds the journal from the studio state, or null when nothing would be lost (then the entry
 * is removed). An empty draft (popover open, nothing typed) is not worth an offer.
 * @param {object} o
 * @param {string} o.hash
 * @param {{id: string, name?: string}} o.dokument
 * @param {number} o.seite page shown, 1-based
 * @param {StudioAnmerkung[]} o.anmerkungen current records (local ones carry `_lokal`)
 * @param {string[]} [o.loeschungen]
 * @param {{x: number, y: number}|null} [o.draftPin] open pin popover
 * @param {string} [o.pinText] text typed into it
 * @param {{x: number, y: number, value: string}|null} [o.draftText] open text field
 * @param {Date} [o.jetzt]
 * @returns {StudioJournal|null}
 */
export function journalBauen({ hash, dokument, seite, anmerkungen, loeschungen = [], draftPin = null, pinText = "", draftText = null, jetzt = new Date() }) {
  const ausstehend = anmerkungen.filter((a) => a._lokal);
  const pin = draftPin && String(pinText || "").trim() ? { x: draftPin.x, y: draftPin.y, page: seite, text: String(pinText) } : null;
  const text = draftText && String(draftText.value || "").trim() ? { x: draftText.x, y: draftText.y, page: seite, value: String(draftText.value) } : null;
  if (!ausstehend.length && !loeschungen.length && !pin && !text) return null;
  return {
    v: JOURNAL_VERSION, hash, dokumentId: dokument.id, name: dokument.name || "", zeit: jetzt.toISOString(), seite,
    ausstehend, loeschungen: [...loeschungen], entwurf: { pin, text },
  };
}

/**
 * What a restore would do against the records the server has now.
 * A local annotation that the server has after all (same type, page and creation time — the answer
 * was lost, not the write) is not created twice; a deletion of a record that is gone is dropped.
 * @param {StudioJournal|null} journal
 * @param {StudioAnmerkung[]} serverAnmerkungen records loaded from the server
 * @returns {{anlegen: StudioAnmerkung[], loeschen: string[], entwurf: StudioJournal["entwurf"], anzahl: number, zeit: string, seite: number}|null}
 *   null = nothing to offer; anzahl = number of items shown in the offer
 */
export function wiederherstellungsPlan(journal, serverAnmerkungen) {
  if (!journal) return null;
  const schonDa = new Set(serverAnmerkungen.map((a) => `${a.type}|${a.page}|${a.created_date || ""}`));
  const anlegen = (journal.ausstehend || []).filter((a) => !schonDa.has(`${a.type}|${a.page}|${a.created_date || ""}`));
  const ids = new Set(serverAnmerkungen.map((a) => a.id));
  const loeschen = (journal.loeschungen || []).filter((id) => ids.has(id));
  const entwurf = { pin: journal.entwurf?.pin || null, text: journal.entwurf?.text || null };
  const anzahl = anlegen.length + loeschen.length + (entwurf.pin ? 1 : 0) + (entwurf.text ? 1 : 0);
  if (!anzahl) return null;
  return { anlegen, loeschen, entwurf, anzahl, zeit: journal.zeit, seite: journal.seite || 1 };
}

/**
 * Parses a stored journal; anything unreadable or of another version → null (never thrown, the
 * studio must open the file in any case).
 * @param {string|null} text
 * @returns {StudioJournal|null}
 */
export function journalLesen(text) {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (!j || j.v !== JOURNAL_VERSION || typeof j.hash !== "string" || !Array.isArray(j.ausstehend) || !Array.isArray(j.loeschungen)) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * Stores (or, with null, removes) the journal of a document.
 * @param {JournalSpeicher} speicher
 * @param {string} hash
 * @param {StudioJournal|null} journal
 * @returns {Promise<void>}
 */
export async function journalSpeichern(speicher, hash, journal) {
  const key = journalSchluessel(hash);
  if (!journal) { await speicher.loeschen(key); return; }
  await speicher.schreiben(key, JSON.stringify(journal));
}

/**
 * Loads the journal of a document.
 * @param {JournalSpeicher} speicher
 * @param {string} hash
 * @returns {Promise<StudioJournal|null>}
 */
export async function journalLaden(speicher, hash) {
  return journalLesen(await speicher.lesen(journalSchluessel(hash)));
}

/**
 * Removes journals older than `maxTage` and unreadable ones.
 * @param {JournalSpeicher} speicher
 * @param {{maxTage?: number, jetzt?: Date}} [o] maxTage in days
 * @returns {Promise<number>} number of entries removed
 */
export async function journalAufraeumen(speicher, { maxTage = JOURNAL_MAX_TAGE, jetzt = new Date() } = {}) {
  let weg = 0;
  for (const key of await speicher.schluessel()) {
    const j = journalLesen(await speicher.lesen(key));
    const alter = j ? (jetzt.getTime() - Date.parse(j.zeit)) / 86400000 : Infinity;
    if (!(alter <= maxTage)) { await speicher.loeschen(key); weg += 1; }
  }
  return weg;
}

// ---------- Browser storage: localStorage for small, IndexedDB for large journals ----------

const IDB_NAME = "bit-atelier-pdfstudio";
const IDB_STORE = "journal";

/** Opens the journal database (one store, out-of-line string keys). */
function idbOeffnen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One request in a fresh transaction; resolves with its result once the transaction completed.
 * @param {"readonly"|"readwrite"} modus
 * @param {(store: IDBObjectStore) => IDBRequest} auftrag
 * @returns {Promise<any>}
 */
async function idb(modus, auftrag) {
  const db = await idbOeffnen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, modus);
      const req = auftrag(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB-Transaktion abgebrochen"));
    });
  } finally {
    db.close();
  }
}

/**
 * Journal storage of the browser. Where a journal goes is decided by the platform's storage rule
 * (speicherOrt): "db" → localStorage, "blob" → IndexedDB; the other place is cleared so a key never
 * exists twice. When localStorage refuses (quota, private mode) the journal goes to IndexedDB.
 * Errors are thrown — the studio reports them in plain text.
 * @returns {JournalSpeicher}
 */
export function browserSpeicher() {
  const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
  const hatIdb = () => typeof indexedDB !== "undefined";
  return {
    async lesen(key) {
      const l = ls()?.getItem(key);
      if (l != null) return l;
      return hatIdb() ? ((await idb("readonly", (s) => s.get(key))) ?? null) : null;
    },
    async schreiben(key, text) {
      // A journal grows with the editing session (freehand strokes) — that answers the grey zone.
      const { ort } = speicherOrt(text, { waechst: true });
      const store = ls();
      if (ort === "db" && store) {
        try {
          store.setItem(key, text);
          if (hatIdb()) await idb("readwrite", (s) => s.delete(key));
          return;
        } catch { /* quota or blocked: fall through to IndexedDB */ }
      }
      if (!hatIdb()) throw new Error("Kein Browserspeicher verfügbar — der Bearbeitungsstand kann nicht gesichert werden.");
      await idb("readwrite", (s) => s.put(text, key));
      try { store?.removeItem(key); } catch { /* noop */ }
    },
    async loeschen(key) {
      try { ls()?.removeItem(key); } catch { /* noop */ }
      if (hatIdb()) await idb("readwrite", (s) => s.delete(key));
    },
    async schluessel() {
      /** @type {Set<string>} */
      const out = new Set();
      const store = ls();
      if (store) for (let i = 0; i < store.length; i += 1) { const k = store.key(i); if (k?.startsWith(JOURNAL_PRAEFIX)) out.add(k); }
      if (hatIdb()) for (const k of /** @type {any[]} */ (await idb("readonly", (s) => s.getAllKeys()))) if (String(k).startsWith(JOURNAL_PRAEFIX)) out.add(String(k));
      return [...out];
    },
  };
}
