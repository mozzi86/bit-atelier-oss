// IndexedDB storage adapter of the serverless build (lokal). The file name is
// historical: it began as the store of the online demo, removed in 83-02.
//
// Why not localStorage: the database used to live as ONE JSON string under
// a single key. Every write re-serialised the whole database, and localStorage
// caps out around 5 MB — one imported IFC or a handful of site photos and every
// further write failed. The failure was swallowed, so the UI kept reporting
// "saved" while nothing arrived. See .planning/HANDOFF-PRUEFLAUF-PRODUKT.md
// (finding BEF-04 / A-02).
//
// Why no library (idb-keyval, Dexie): the surface needed here is six calls. A
// dependency would need a licence entry and a review; raw IndexedDB is ~120
// lines and has no upgrade path to get wrong later.
//
// In:  collection name (one object store per entity, keyPath "id") + records.
// Out: plain arrays of records. Errors are THROWN, never swallowed — quota
//      failures surface as SpeicherVollError so the UI can say so.

// 80-02 (D-P80-A #1): HR stores are hidden the same way SCHNAPP_STORE already
// is — entities() excluding them is what makes Personal structurally absent
// from demoDbAuslesen/-Ersetzen (export, import, reset, snapshot ring all go
// through adapter.entities()).
import { istPersonalStore } from './personalEntitaeten.js';

// Database name of the client build (70-01). It differed from the old demo's
// 'bit-atelier-demo' because both shared one origin (IndexedDB is per origin, not
// per path). Never rename it: an installed client would open an empty database.
const DB_NAME = 'bit-atelier-lokal';
const META_STORE = '_meta';
/**
 * Snapshot ring store (69-13). Lives in the same database but is NOT project
 * data: entities() must hide it like `_meta`, otherwise the snapshots (each
 * containing the whole project) would enter demoDb's cache and every export
 * would nest them recursively. Created on demand by the transaction helper —
 * an additive schema bump, no migration.
 */
export const SCHNAPP_STORE = 'schnappschuesse';

/** Raised when the browser refuses a write because its storage quota is full. */
export class SpeicherVollError extends Error {
  /** @param {string} entity collection the write was aimed at */
  constructor(entity) {
    super(`Speicher voll — Schreibvorgang auf "${entity}" abgelehnt`);
    this.name = 'SpeicherVollError';
    this.entity = entity;
  }
}

/**
 * True for the various shapes browsers use to report an exceeded quota.
 * Chrome/Edge throw DOMException "QuotaExceededError", Safari uses legacy code
 * 22, Firefox has been seen with "NS_ERROR_DOM_QUOTA_REACHED".
 * @param {unknown} err
 * @returns {boolean}
 */
function istQuotaFehler(err) {
  const e = /** @type {any} */ (err);
  if (!e) return false;
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22
  );
}

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;
/** Stores that must exist after the next version bump. */
const zusatzStores = new Set();

/**
 * How long a version bump waits after `blocked` before it gives up, in
 * milliseconds. BEFUNDE-79 H-4 (merge follow-up of phase 80): every connection
 * this module opens closes itself on `versionchange`, but a connection closed
 * while one of its transactions still runs counts as open until that
 * transaction commits — the browser fires `blocked` and continues the upgrade
 * 1–5 ms later (headless trace of p-07: the accounting seed's store-by-store
 * bumps while /People creates the personnel stores). Rejecting at the first
 * `blocked` handed that transient state to every caller awaiting the shared
 * open (the personnel seed then failed for the rest of the page life).
 * [ASSUMED] 3 s: long enough for any same-tab transaction, short enough that a
 * foreign tab that really keeps an old version open still gets the plain-text
 * error quickly; the callers' own retries (speicher.js, personalDb.js) stay.
 */
const BLOCKIERT_WARTEZEIT_MS = 3000;

/**
 * Opens the database, creating `_meta` and every store queued in zusatzStores.
 * A `blocked` open waits up to BLOCKIERT_WARTEZEIT_MS for the upgrade instead of
 * failing at once; a connection that only arrives after giving up is closed.
 * @param {number} [version] explicit version, used for on-demand store creation
 * @returns {Promise<IDBDatabase>}
 */
function oeffne(version) {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      let erledigt = false;
      /** @type {ReturnType<typeof setTimeout>|null} */
      let wartezeit = null;
      const warteEnde = () => { if (wartezeit) { clearTimeout(wartezeit); wartezeit = null; } };
      const anfrage = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      anfrage.onupgradeneeded = () => {
        warteEnde();
        const db = anfrage.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        for (const name of zusatzStores) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      anfrage.onsuccess = () => {
        warteEnde();
        const db = anfrage.result;
        // Gave up after `blocked` already: never keep this late connection open —
        // it would block the next bump itself.
        if (erledigt) { db.close(); return; }
        erledigt = true;
        // 79-01: another tab bumps the version (the accounting seed creates up to
        // 13 new stores, 69-13). Without closing here that tab's upgrade is
        // blocked ("IndexedDB blockiert"); the next operation reopens the new version.
        db.onversionchange = () => {
          db.close();
          if (dbPromise === offen) dbPromise = null;
        };
        res(db);
      };
      anfrage.onerror = () => {
        warteEnde();
        if (erledigt) return;
        erledigt = true;
        rej(anfrage.error);
      };
      anfrage.onblocked = () => {
        if (erledigt || wartezeit) return;
        wartezeit = setTimeout(() => {
          wartezeit = null;
          if (erledigt) return;
          erledigt = true;
          rej(new Error('IndexedDB blockiert — ein anderer Tab hält eine ältere Version offen'));
        }, BLOCKIERT_WARTEZEIT_MS);
      };
    });
    const offen = dbPromise;
    // 69-13: a FAILED open must not stay cached — every later call would
    // replay the stale rejection even after the blocker is gone (e.g. the
    // other tab closed). Reset so the next operation retries the open — but
    // only if no newer open has replaced it in the meantime.
    dbPromise.catch(() => {
      if (dbPromise === offen) dbPromise = null;
    });
  }
  return dbPromise;
}

/**
 * Guarantees an object store exists, bumping the DB version if it does not.
 * New entity types appear at runtime (a module writes a record of a kind the
 * seed never contained), and IndexedDB can only create stores during an upgrade.
 * @param {string} name
 * @returns {Promise<IDBDatabase>}
 */
async function stelleStoreSicher(name) {
  let db = await oeffne();
  if (db.objectStoreNames.contains(name)) return db;
  zusatzStores.add(name);
  const naechste = db.version + 1;
  db.close();
  dbPromise = null;
  db = await oeffne(naechste);
  return db;
}

/**
 * Pure — no IndexedDB access. Names from `gewuenscht` that are not yet in
 * `vorhanden`, in `gewuenscht` order.
 * @param {string[]} vorhanden existing store names (e.g. Array.from(db.objectStoreNames))
 * @param {string[]} gewuenscht store names that must exist afterwards
 * @returns {string[]} missing store names
 */
export function fehlendeStores(vorhanden, gewuenscht) {
  const da = new Set(vorhanden);
  return gewuenscht.filter((n) => !da.has(n));
}

/**
 * Guarantees EVERY store in `namen` exists, in AT MOST ONE version bump — the
 * batched sibling of stelleStoreSicher() above. 80-02 (Abgleich 28.09.,
 * BEFUNDE-79 H-4/NB-01): the personal storage class needs ten stores at once
 * (nine entities + personal.dateien); bumping once per store, like
 * stelleStoreSicher() does, reopens the connection ten times in a row and each
 * reopen risks "IndexedDB blockiert" while another tab — or this tab's own
 * short-lived read transaction — still holds the previous version open. A
 * single bump that creates every missing store together removes nine of those
 * ten chances to collide. Since the phase-80 merge follow-up oeffne() waits out a
 * transient `blocked` (BLOCKIERT_WARTEZEIT_MS, H-4's root cause) and only then
 * rejects with the existing plain text; retrying after that still belongs to
 * the CALLER (personalDb.js's mitWiederholung), not here.
 * A no-op, with NO version bump at all, when every store already exists.
 * @param {string[]} namen store names that must exist afterwards
 * @returns {Promise<void>}
 */
export async function stelleStoresSicher(namen) {
  const db0 = await oeffne();
  const fehlend = fehlendeStores(Array.from(db0.objectStoreNames), namen);
  if (!fehlend.length) return;
  for (const name of fehlend) zusatzStores.add(name);
  const naechste = db0.version + 1;
  db0.close();
  dbPromise = null;
  await oeffne(naechste);
}

/**
 * Runs a transaction and resolves once it has actually committed — resolving on
 * the request alone would report success before the data is durable.
 * @template T
 * @param {string} store
 * @param {IDBTransactionMode} modus
 * @param {(s: IDBObjectStore) => IDBRequest<T>|null} arbeit
 * @returns {Promise<T|null>}
 */
async function transaktion(store, modus, arbeit) {
  const db = await stelleStoreSicher(store);
  return new Promise((res, rej) => {
    let ergebnis = /** @type {any} */ (null);
    const tx = db.transaction(store, modus);
    tx.oncomplete = () => res(ergebnis);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaktion abgebrochen'));
    try {
      const anfrage = arbeit(tx.objectStore(store));
      if (anfrage) anfrage.onsuccess = () => { ergebnis = anfrage.result; };
    } catch (err) {
      rej(err);
    }
  });
}

/**
 * The demo's IndexedDB adapter. Same shape as the in-memory adapter used by the
 * unit tests, so demoDb never learns which one it is talking to.
 */
export const demoIdb = {
  /**
   * Names of all collections currently stored (excluding the meta store, the
   * snapshot ring and every personal.* store — none of the three is project
   * data, see SCHNAPP_STORE and personalEntitaeten.js's istPersonalStore).
   * This is the ONE filter demoDbAuslesen/-Ersetzen (export, import, reset)
   * and the snapshot ring go through — hiding a store here is what keeps HR
   * data out of all four (80-02, D-P80-A #1).
   * @returns {Promise<string[]>}
   */
  async entities() {
    const db = await oeffne();
    // Array.from statt Spread: DOMStringList ist array-artig, aber in den
    // lib.dom-Typen nicht als Iterable deklariert.
    return Array.from(db.objectStoreNames).filter(
      (n) => n !== META_STORE && n !== SCHNAPP_STORE && !istPersonalStore(n)
    );
  },

  /**
   * Every record of one collection.
   * @param {string} entity
   * @returns {Promise<object[]>}
   */
  async alle(entity) {
    const db = await oeffne();
    if (!db.objectStoreNames.contains(entity)) return [];
    return (await transaktion(entity, 'readonly', (s) => s.getAll())) || [];
  },

  /**
   * Writes ONE record. This is the whole point of the migration: a write touches
   * a single row instead of re-serialising the entire database.
   * @param {string} entity
   * @param {object} datensatz must carry `id`
   * @returns {Promise<void>}
   */
  async schreiben(entity, datensatz) {
    try {
      await transaktion(entity, 'readwrite', (s) => s.put(datensatz));
    } catch (err) {
      if (istQuotaFehler(err)) throw new SpeicherVollError(entity);
      throw err;
    }
  },

  /**
   * Writes many records in ONE transaction (seed, import, migration).
   * @param {string} entity
   * @param {object[]} datensaetze
   * @returns {Promise<void>}
   */
  async schreibeViele(entity, datensaetze) {
    try {
      await transaktion(entity, 'readwrite', (s) => {
        for (const d of datensaetze) s.put(d);
        return null;
      });
    } catch (err) {
      if (istQuotaFehler(err)) throw new SpeicherVollError(entity);
      throw err;
    }
  },

  /**
   * @param {string} entity
   * @param {string} recordId
   * @returns {Promise<void>}
   */
  async loeschen(entity, recordId) {
    await transaktion(entity, 'readwrite', (s) => s.delete(recordId));
  },

  /**
   * @param {string} entity
   * @returns {Promise<void>}
   */
  async leeren(entity) {
    const db = await oeffne();
    if (!db.objectStoreNames.contains(entity)) return;
    await transaktion(entity, 'readwrite', (s) => s.clear());
  },

  /**
   * Reads (one argument) or writes (two arguments) a meta value — schema
   * version, migration marker, last successful write.
   * @param {string} key
   * @param {unknown} [wert]
   * @returns {Promise<unknown>}
   */
  async meta(key, wert) {
    const db = await oeffne();
    if (arguments.length === 1) {
      return new Promise((res, rej) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const anfrage = tx.objectStore(META_STORE).get(key);
        anfrage.onsuccess = () => res(anfrage.result);
        anfrage.onerror = () => rej(anfrage.error);
      });
    }
    return new Promise((res, rej) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.oncomplete = () => res(wert);
      tx.onerror = () => rej(tx.error);
      tx.objectStore(META_STORE).put(wert, key);
    });
  },

  // 80-02: part of the adapter SHAPE (not just a standalone export) so
  // personalDb.js's setzePersonalSpeicher(adapter, …) — the same
  // test-injection pattern demoDb.js uses — can swap it for a mock in unit
  // tests without touching real IndexedDB. Production code always gets the
  // real batched implementation above.
  stelleStoresSicher,
};

/**
 * Current storage usage, for the header status readout.
 * @returns {Promise<{benutzt: number, gesamt: number}|null>} bytes, or null when
 *          the browser does not expose an estimate
 */
export async function speicherStand() {
  try {
    if (!navigator?.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return null;
    return { benutzt: usage, gesamt: quota };
  } catch {
    return null;
  }
}

/**
 * Asks the browser to keep this origin's data out of automatic eviction. Best
 * effort: without a user gesture or an installed PWA most browsers decline, and
 * a refusal is not an error — the demo keeps working either way.
 * @returns {Promise<boolean|null>} granted, denied, or null when unsupported
 */
export async function speicherDauerhaft() {
  try {
    if (!navigator?.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
