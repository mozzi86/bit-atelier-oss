// personalDb.js — the storage of the "personal" class (Plan 80-02, D-P80-A):
// its OWN IndexedDB stores (hidden by demoIdb's istPersonalStore filter),
// never demoDb's cache, never demoDb's collections.
//
// Why a second storage module next to demoDb.js instead of extending it: the
// whole point of this plan is that HR data is structurally unreachable
// through the paths demoDb feeds (.bitproj export via demoDbAuslesen, the
// snapshot ring, project reset/import via demoDbErsetzen) — sharing demoDb's
// module-level cache would reintroduce exactly the leak this plan closes
// (DS-01/DS-02/DS-03, 80-RESEARCH § Datenschutz-Invarianten).
//
// Why NO tab-wide cache (unlike demoDb, Abgleich 28.09., BEFUNDE-79 N-17): a
// stale personal cache in one tab is not just a doubled seed (demoDb's
// problem) — it is `.bitpers` (80-10) written from OUTDATED HR records, or a
// second tab silently overwriting a colleague's edit. An office's personal
// headcount is small, so reading the store on every call costs nothing.
//
// Why its own mitWiederholung instead of importing src/lib/accounting/speicher.js's:
// that function is private to src/ (app-only) and packages/ may not import
// from @/ (the package-boundary rule in CLAUDE.md) — same bug (BEFUNDE-79 H-4:
// demoIdb rejects a version bump at once while an older connection, including
// this tab's own short read, is still open), same fix, one file each side of
// the boundary.
//
// In:  entity name (one of PERSONAL_ENTITAETEN) + record data, the SAME shape
//      bitApi.personal takes.
// Out: plain records, or the whole personal database for personalDbAuslesen()
//      (used only by 80-10's .bitpers export — never by projektDatei.js).
// Side effects: writes to IndexedDB (or the injected test adapter) and fires
//   "personal:gespeichert" / "personal:speicher-fehler" — same contract as
//   demoDb.js's "demo:*" events, on the "personal:*" namespace so a listener
//   can tell the two storage classes apart.

import { demoIdb } from './demoIdb.js';
import { heuteLokal, plusTage, tageZwischen } from '../lib/kalender/datum.js';
import { neueId, sortiereDatensaetze, passtFilter } from './sammlungKern.js';
import {
  PERSONAL_ENTITAETEN,
  PERSONAL_DATEIEN_STORE,
  personalStoreName,
  istPersonalEntitaet,
} from './personalEntitaeten.js';

const PERSONAL_META_PRAEFIX = 'personal_';
/** Every store the personal class owns — the argument to stelleStoresSicher() (ONE version bump for all ten). */
const ALLE_PERSONAL_STORES = Object.freeze([...PERSONAL_ENTITAETEN.map(personalStoreName), PERSONAL_DATEIEN_STORE]);

/** Reference date the fictional seed's dates were written against (80-RESEARCH § Seed). */
export const PERSONAL_SEED_BEZUG = '2026-09-27';

/** @type {typeof demoIdb} */
let adapter = demoIdb;
/** @type {() => Promise<Record<string, object[]>>} */
let seedLader = async () => (await import('./personalSeed.json')).default;
// 83-02: no build seeds the fictional HR data any more (it belonged to the online
// demo, which is gone). The flag stays injectable so the seed path remains tested.
let istDemoFlag = false;
/** @type {Promise<void>|null} shared across StrictMode's double effect call — bereit() runs its body once per "page life" until it succeeds. */
let bereitPromise = null;

/**
 * Replaces storage, seed loader and the demo flag — for unit tests, which run
 * without a browser. Production code never calls this (same rule as
 * demoDb.js's setzeSpeicher). Resets bereitPromise so the NEXT call to any
 * personalDb method re-runs bereit() against the new adapter — simulating a
 * fresh page load / new tab in tests that need one.
 * @param {typeof demoIdb} neuerAdapter must also implement stelleStoresSicher(namen)
 * @param {() => Promise<Record<string, object[]>>} [neuerSeedLader]
 * @param {{istDemo?: boolean}} [optionen]
 */
export function setzePersonalSpeicher(neuerAdapter, neuerSeedLader, { istDemo } = {}) {
  adapter = neuerAdapter;
  if (neuerSeedLader) seedLader = neuerSeedLader;
  if (istDemo !== undefined) istDemoFlag = istDemo;
  bereitPromise = null;
}

/**
 * Fires a window event. No-op outside a browser (unit tests, SSR) — same
 * pattern as demoDb.js's melde().
 * @param {string} name
 * @param {object} detail
 */
function melde(name, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * @param {unknown} fehler
 * @returns {string}
 */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Private HR-side copy of src/lib/accounting/speicher.js's mitWiederholung
 * (BEFUNDE-79 H-4): a version bump demoIdb rejected as "IndexedDB blockiert"
 * is retried up to 6 times, 150 ms × attempt — everything else is thrown at
 * once. packages/ may not import from src/ (CLAUDE.md package-boundary rule),
 * so this is a deliberate second copy of the SAME six-lines-of-logic, not a
 * second design.
 * @template T
 * @param {() => Promise<T>} arbeit
 * @returns {Promise<T>}
 */
async function mitWiederholung(arbeit) {
  for (let versuch = 1; ; versuch++) {
    try {
      return await arbeit();
    } catch (fehler) {
      if (versuch >= 6 || !/IndexedDB blockiert/.test(text(fehler))) throw fehler;
      await new Promise((ok) => setTimeout(ok, 150 * versuch));
    }
  }
}

/**
 * Runs one write, reports the outcome and re-throws on failure — same
 * "saved can only mean it actually landed" contract as demoDb.js's schreibe().
 * @template T
 * @param {() => Promise<T>} arbeit
 * @returns {Promise<T>}
 */
async function schreibe(arbeit) {
  try {
    const ergebnis = await mitWiederholung(arbeit);
    melde('personal:gespeichert', { zeit: Date.now() });
    return ergebnis;
  } catch (fehler) {
    melde('personal:speicher-fehler', { fehler });
    throw fehler;
  }
}

/**
 * Shifts every 'YYYY-MM-DD' string (bare, or the date part of an ISO
 * timestamp) inside a value by `deltaTage` days — recursively, so it works on
 * the whole seed object without knowing its shape. Non-date strings, numbers,
 * booleans and null pass through unchanged.
 * @param {unknown} wert
 * @param {number} deltaTage
 * @returns {unknown}
 */
function verschiebeTief(wert, deltaTage) {
  if (typeof wert === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(wert)) return plusTage(wert, deltaTage) ?? wert;
    const m = /^(\d{4}-\d{2}-\d{2})(T.*)$/.exec(wert);
    if (m) {
      const verschoben = plusTage(m[1], deltaTage);
      return verschoben ? verschoben + m[2] : wert;
    }
    return wert;
  }
  if (Array.isArray(wert)) return wert.map((v) => verschiebeTief(v, deltaTage));
  if (wert && typeof wert === 'object') {
    /** @type {Record<string, unknown>} */
    const ergebnis = {};
    for (const [k, v] of Object.entries(wert)) ergebnis[k] = verschiebeTief(v, deltaTage);
    return ergebnis;
  }
  return wert;
}

/**
 * The fictional demo seed, with every date shifted so the sample data stays
 * "recent" no matter when a visitor opens the demo (80-RESEARCH § Seed,
 * HANDOFF §5 "Beispieldaten relativ zu heute"). Pure — no storage access.
 * Datumsrechnung nur auf 'YYYY-MM-DD' über den Kalender-Kern (Pitfall 13,
 * BEFUNDE-79-Abgleich), niemals über die JS-Date-Arithmetik von Hand.
 * @param {Record<string, object[]>} seed raw personalSeed.json content
 * @param {string} heute 'YYYY-MM-DD' — the visitor's "today" (heuteLokal())
 * @param {string} [bezug] the date the seed's dates were written against
 * @returns {Record<string, object[]>} the same shape, dates shifted by `heute − bezug` days
 */
export function personalSeedVerschieben(seed, heute, bezug = PERSONAL_SEED_BEZUG) {
  const deltaTage = tageZwischen(bezug, heute);
  if (!deltaTage) return seed; // heute === bezug, or an invalid date → unchanged
  return /** @type {Record<string, object[]>} */ (verschiebeTief(seed, deltaTage));
}

/**
 * Seeds the fictional sample data exactly once — only when seeding is switched
 * on (tests only since 83-02) AND every one of the nine entity stores is still empty AND the
 * "already seeded" meta marker is missing (all three read straight from the
 * adapter, not from any cache — Abgleich 28.09.). A second tab racing the
 * same check writes the SAME seed with the SAME fixed ids, so a concurrent
 * double-seed overwrites instead of duplicating (put-by-id semantics).
 * @returns {Promise<void>}
 */
async function seedFallsNoetig() {
  if (!istDemoFlag) return;
  const schonGeseedet = await adapter.meta(`${PERSONAL_META_PRAEFIX}geseedet`);
  if (schonGeseedet) return;
  for (const entitaet of PERSONAL_ENTITAETEN) {
    // eslint-disable-next-line no-await-in-loop -- sequential existence check, small collections
    const rows = await adapter.alle(personalStoreName(entitaet));
    if (rows.length) return; // office already has HR data under this meta state — never overwrite it
  }
  const roh = await seedLader();
  const heute = heuteLokal();
  const verschoben = personalSeedVerschieben(roh, heute);
  for (const entitaet of PERSONAL_ENTITAETEN) {
    const rows = verschoben[entitaet];
    // eslint-disable-next-line no-await-in-loop -- writes must land before the meta marker below
    if (Array.isArray(rows) && rows.length) await adapter.schreibeViele(personalStoreName(entitaet), rows);
  }
  await adapter.meta(`${PERSONAL_META_PRAEFIX}geseedet`, heute);
}

/**
 * The one-time setup every personalDb call waits for: all ten stores exist
 * (ONE version bump, BEFUNDE-79 H-4-aware retry) and, in the demo, the seed is
 * in place. Memoized so StrictMode's double effect call and ten calls from ten
 * different components still run this exactly once per page life — but only a
 * SUCCESS stays cached: a failed setup (e.g. a transient "IndexedDB blockiert"
 * while another module bumps the version) is dropped, so the next personalDb
 * call tries again instead of replaying the stale rejection until a reload
 * (same rule as demoIdb.js's failed open, 69-13; merge follow-up of phase 80).
 * @returns {Promise<void>}
 */
function bereit() {
  if (!bereitPromise) {
    const lauf = (async () => {
      await mitWiederholung(() => adapter.stelleStoresSicher([...ALLE_PERSONAL_STORES]));
      await seedFallsNoetig();
    })();
    bereitPromise = lauf;
    lauf.catch(() => { if (bereitPromise === lauf) bereitPromise = null; });
  }
  return bereitPromise;
}

/**
 * @param {string} entitaet
 * @returns {Promise<string>} the store name, after bereit() and the entity check
 * @throws {Error} plain text naming the entity when it is not one of PERSONAL_ENTITAETEN
 */
async function store(entitaet) {
  if (!istPersonalEntitaet(entitaet)) throw new Error(`"${entitaet}" ist keine Personal-Entität.`);
  await bereit();
  return personalStoreName(entitaet);
}

/**
 * The personal storage class's record CRUD — same method shapes as demoDb,
 * but scoped to PERSONAL_ENTITAETEN and reading the adapter fresh on every
 * call (no cache, see file header).
 */
export const personalDb = {
  /** @param {string} entitaet @param {string} [sort] @returns {Promise<object[]>} */
  async list(entitaet, sort) {
    const s = await store(entitaet);
    return sortiereDatensaetze(await adapter.alle(s), sort);
  },
  /** @param {string} entitaet @param {Record<string, unknown>} [query] @param {string} [sort] @returns {Promise<object[]>} */
  async filter(entitaet, query = {}, sort) {
    const s = await store(entitaet);
    const rows = (await adapter.alle(s)).filter((r) => passtFilter(r, query));
    return sortiereDatensaetze(rows, sort);
  },
  /** @param {string} entitaet @param {string} recordId @returns {Promise<object|null>} */
  async get(entitaet, recordId) {
    const s = await store(entitaet);
    return (await adapter.alle(s)).find((r) => r.id === recordId) || null;
  },
  /** @param {string} entitaet @param {object} data @returns {Promise<object>} */
  async create(entitaet, data) {
    const s = await store(entitaet);
    const now = new Date().toJSON(); // spells the same ISO-8601 timestamp demoDb.js writes, for a valid Date
    const record = { id: neueId(), created_date: now, updated_date: now, ...data };
    await schreibe(() => adapter.schreiben(s, record));
    return record;
  },
  /** @param {string} entitaet @param {string} recordId @param {object} data @returns {Promise<object|null>} */
  async update(entitaet, recordId, data) {
    const s = await store(entitaet);
    const vorhanden = (await adapter.alle(s)).find((r) => r.id === recordId);
    if (!vorhanden) return null;
    const record = { ...vorhanden, ...data, id: recordId, updated_date: new Date().toJSON() };
    await schreibe(() => adapter.schreiben(s, record));
    return record;
  },
  /** @param {string} entitaet @param {string} recordId @returns {Promise<boolean>} */
  async remove(entitaet, recordId) {
    const s = await store(entitaet);
    await schreibe(() => adapter.loeschen(s, recordId));
    return true;
  },
  /** File payloads (Personaldokument's datei_ref) — its own store, lazily, never in the record cache. */
  dateien: {
    /** @param {string} id @param {{mime: string, name: string, data: string}} datei @returns {Promise<object>} */
    async put(id, datei) {
      await bereit();
      const record = { id, ...datei };
      await schreibe(() => adapter.schreiben(PERSONAL_DATEIEN_STORE, record));
      return record;
    },
    /** @param {string} id @returns {Promise<object|null>} */
    async get(id) {
      await bereit();
      return (await adapter.alle(PERSONAL_DATEIEN_STORE)).find((r) => r.id === id) || null;
    },
    /** @param {string} id @returns {Promise<boolean>} */
    async delete(id) {
      await bereit();
      await schreibe(() => adapter.loeschen(PERSONAL_DATEIEN_STORE, id));
      return true;
    },
  },
};

/**
 * Every personal collection, as one plain object — the ONLY function that may
 * read the whole personal class at once. Used by 80-10's `.bitpers` export,
 * NEVER by projektDatei.js (Personal is structurally absent from the
 * `.bitproj` path, see demoIdb.js's istPersonalStore filter).
 * @returns {Promise<Record<string, object[]>>}
 */
export async function personalDbAuslesen() {
  await bereit();
  /** @type {Record<string, object[]>} */
  const ergebnis = {};
  for (const entitaet of PERSONAL_ENTITAETEN) {
    // eslint-disable-next-line no-await-in-loop -- small collections, sequential read is fine
    ergebnis[entitaet] = await adapter.alle(personalStoreName(entitaet));
  }
  return ergebnis;
}

/**
 * Every file payload, keyed by id — the file-store counterpart of
 * personalDbAuslesen(), also for 80-10's `.bitpers` export.
 * @returns {Promise<Record<string, object>>}
 */
export async function personalDbDateienAuslesen() {
  await bereit();
  /** @type {Record<string, object>} */
  const ergebnis = {};
  for (const eintrag of await adapter.alle(PERSONAL_DATEIEN_STORE)) ergebnis[eintrag.id] = eintrag;
  return ergebnis;
}

/**
 * Replaces every personal collection AND every file — the `.bitpers` import
 * counterpart (80-10). Clears every store first so a shorter incoming file
 * cannot leave orphaned old records behind, exactly like demoDbErsetzen does
 * for project data.
 * @param {Record<string, object[]>} [daten]
 * @param {Record<string, object>} [dateien]
 * @returns {Promise<void>}
 */
export async function personalDbErsetzen(daten = {}, dateien = {}) {
  await bereit();
  for (const entitaet of PERSONAL_ENTITAETEN) {
    const s = personalStoreName(entitaet);
    // eslint-disable-next-line no-await-in-loop -- sequential clear+write per store, small collections
    await adapter.leeren(s);
    const rows = daten[entitaet];
    // eslint-disable-next-line no-await-in-loop
    if (Array.isArray(rows) && rows.length) await adapter.schreibeViele(s, rows);
  }
  await adapter.leeren(PERSONAL_DATEIEN_STORE);
  const dateiListe = Object.values(dateien || {});
  if (dateiListe.length) await adapter.schreibeViele(PERSONAL_DATEIEN_STORE, dateiListe);
}

/**
 * Reads (one argument) or writes (two arguments) a meta value under the
 * `personal_` key prefix — mirrors demoIdb's meta(), scoped to this storage
 * class so a key never collides with demoDb's own meta values in the same
 * `_meta` store. 80-10 uses `personalMeta('letzte_sicherung', …)`.
 * @param {string} key unprefixed key, e.g. 'geseedet'
 * @param {unknown} [wert]
 * @returns {Promise<unknown>}
 */
export async function personalMeta(key, wert) {
  await bereit();
  if (arguments.length === 1) return adapter.meta(`${PERSONAL_META_PRAEFIX}${key}`);
  return adapter.meta(`${PERSONAL_META_PRAEFIX}${key}`, wert);
}
