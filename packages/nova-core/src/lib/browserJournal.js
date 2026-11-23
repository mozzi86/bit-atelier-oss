// 115-05c (§6.2): a journal of unsaved work in the browser - localStorage for small entries, IndexedDB for large ones.
// Moved here from the PDF studio (packages/nova-pdf/src/lib/wiederherstellung.js browserSpeicher, 104-09) so the draft of the
// building model uses the same storage; the database name, store name and key prefix are PARAMETERS now. The PDF studio
// passes its old names ("bit-atelier-pdfstudio" / "journal" / "bit-pdfstudio-journal:"), so no stored key is renamed.
//
// Storage rule (speicherOrt.js): an entry below 256 KB lives in localStorage, a larger one in IndexedDB; the other place is
// cleared, so a key never exists twice. When localStorage refuses (quota, private mode) the entry goes to IndexedDB. When both
// refuse, the write REJECTS with a plain-text error - the caller reports it (a full store is never swallowed).
//
// In:  {idbName, idbStore, praefix}. Out: a JournalSpeicher {lesen, schreiben, loeschen, schluessel}.

import { speicherOrt } from "./speicherOrt.js";

/**
 * Storage adapter of a journal (browser: browserJournal(); tests: a Map).
 * @typedef {object} JournalSpeicher
 * @property {(key: string) => Promise<string|null>} lesen
 * @property {(key: string, text: string) => Promise<void>} schreiben rejects when no browser store takes the entry
 * @property {(key: string) => Promise<void>} loeschen
 * @property {() => Promise<string[]>} schluessel all keys with the prefix
 */

/** Plain-text refusal when neither localStorage nor IndexedDB takes an entry. */
export const KEIN_SPEICHER_TEXT = "Kein Browserspeicher verfügbar — der Bearbeitungsstand kann nicht gesichert werden.";

/**
 * Journal storage of the browser for one purpose.
 * @param {{idbName: string, idbStore: string, praefix: string}} o idbName / idbStore = IndexedDB database and object store;
 *   praefix = key prefix of this journal (schluessel() lists only these keys)
 * @returns {JournalSpeicher}
 */
export function browserJournal({ idbName, idbStore, praefix }) {
  const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
  const hatIdb = () => typeof indexedDB !== "undefined";
  /** Opens the database (one store, out-of-line string keys). @returns {Promise<IDBDatabase>} */
  const oeffnen = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(idbName, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(idbStore)) req.result.createObjectStore(idbStore); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  /**
   * One request in a fresh transaction; resolves with its result once the transaction completed.
   * @param {"readonly"|"readwrite"} modus @param {(store: IDBObjectStore) => IDBRequest} auftrag @returns {Promise<any>}
   */
  const idb = async (modus, auftrag) => {
    const db = await oeffnen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(idbStore, modus);
        const req = auftrag(tx.objectStore(idbStore));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || new Error("IndexedDB-Transaktion abgebrochen"));
      });
    } finally {
      db.close();
    }
  };
  return {
    async lesen(key) {
      const l = ls()?.getItem(key);
      if (l != null) return l;
      return hatIdb() ? ((await idb("readonly", (s) => s.get(key))) ?? null) : null;
    },
    async schreiben(key, text) {
      // a journal grows with the editing session (strokes, drawn elements) - that answers the grey zone
      const { ort } = speicherOrt(text, { waechst: true });
      const store = ls();
      if (ort === "db" && store) {
        try {
          store.setItem(key, text);
          if (hatIdb()) await idb("readwrite", (s) => s.delete(key));
          return;
        } catch { /* quota or blocked: fall through to IndexedDB */ }
      }
      if (!hatIdb()) throw new Error(KEIN_SPEICHER_TEXT);
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
      if (store) for (let i = 0; i < store.length; i += 1) { const k = store.key(i); if (k?.startsWith(praefix)) out.add(k); }
      if (hatIdb()) for (const k of /** @type {any[]} */ (await idb("readonly", (s) => s.getAllKeys()))) if (String(k).startsWith(praefix)) out.add(String(k));
      return [...out];
    },
  };
}
