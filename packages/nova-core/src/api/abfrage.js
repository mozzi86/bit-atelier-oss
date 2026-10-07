// abfrage.js — pure mapping between the client's record shape (db.js style)
// and Supabase/PostgREST queries (Phase 57).
//
// Created in 57-03 (zeileAusDatensatz/neueId per the 57-02 <interfaces>
// contract); completed in 57-02 Task 2 with the remaining three pure functions
// sortNachPostgrest / filterNachPostgrest / datensatzAusZeile and the parity
// tests against db.js.
//
// Rules for this file (57-02 <interfaces>): pure, node-testable, NO supabase
// import, no import.meta.env — so scripts/supabase-import.mjs (57-03), the
// unit tests and supabaseDb.js can all use it directly. The import and the
// client share this ONE mapping; there is deliberately no second truth about
// what a `records` row looks like (57-03 key_links).
//
// Row shape in `records` (supabase/migrations/0001_orgs_records.sql):
//   { id: text, entity: text, org_id: uuid, data: jsonb,
//     created_date, updated_date, created_by }
// Client record shape (packages/nova-core/server/db.js:131-141):
//   { id, created_date, updated_date, ...fachfelder }
//
// The jsonb/text shift (Research §7): db.js compares JS values with strict
// equality (===, db.js:114); Postgres compares TEXT via `data->>k`. Numbers and
// booleans must therefore be compared as text on both sides — filterNachPostgrest
// stringifies, and the parity test MEASURES this against db.js on the same
// fixtures instead of assuming it.

/** Columns that live on the row itself, not inside the jsonb `data` payload. */
const ECHTE_SPALTEN = new Set(['id', 'created_date', 'updated_date']);

/**
 * Generates a compact unique id — the SAME algorithm as db.js:81 id()
 * (timestamp base36 + 6 random chars), so ids created through the Supabase
 * path are indistinguishable from ids created through the Express path.
 * @returns {string} new id, e.g. "m5k3x9ab12cd"
 */
export function neueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Maps one client record (db.js shape) to one `records` row.
 *
 * `id` is kept when present — the import (57-03) MUST preserve ids, otherwise
 * cross-references inside the data (project_id, element_guid, blob references)
 * break. Without id a new one is generated (client `create` path).
 *
 * `created_date`/`updated_date` are stripped from the jsonb payload: they live
 * as real columns on the row (kept current by trigger, sortable, indexable).
 * Everything else goes into `data` unchanged.
 *
 * @param {string} entity entity name, e.g. "Project" (becomes the `entity` column)
 * @param {string} orgId uuid of the owning org (`org_id` column; RLS anchor)
 * @param {Record<string, any>} datensatz client record; may carry id/created_date/updated_date
 * @returns {{ id: string, entity: string, org_id: string, data: Record<string, any> }}
 *   the `records` row WITHOUT the timestamp columns — callers that need to
 *   preserve original timestamps (the import) set them on the returned object.
 */
export function zeileAusDatensatz(entity, orgId, datensatz) {
  // Destructure to DROP the three column-backed fields from the jsonb payload
  // (ignoreRestSiblings pattern; underscore names silence unused-vars).
  const { id: _id, created_date: _created, updated_date: _updated, ...data } =
    datensatz || {};
  return {
    id: datensatz?.id ?? neueId(),
    entity,
    org_id: orgId,
    data,
  };
}

/**
 * Translates a bitApi-style sort string into a PostgREST order description.
 *
 * Mirrors db.js:97-110 sortRecords: a leading "-" means descending, everything
 * else ascending; nulls always go LAST (db.js:104-106 returns 1/-1 so a null
 * sorts after a value in both directions) — that is `nullsFirst: false` on the
 * supabase .order() call in supabaseDb.js.
 *
 * Sorting a real column (id/created_date/updated_date) orders by that column
 * directly; any other field lives inside the jsonb payload and orders by the
 * text projection `data->>field` (jsonPfad true). Text ordering of numbers
 * differs from numeric ordering — acceptable, because the dominant sorts in the
 * app are -created_date / name (both exact under text projection).
 *
 * @param {string|undefined|null} sortStr e.g. "-created_date" or "name"
 * @returns {{ spalte: string, aufsteigend: boolean, jsonPfad: boolean } | null}
 *   null when there is nothing to sort by (matches "no sort" in db.js)
 */
export function sortNachPostgrest(sortStr) {
  if (!sortStr) return null;
  const aufsteigend = !String(sortStr).startsWith('-');
  const feld = aufsteigend ? String(sortStr) : String(sortStr).slice(1);
  const jsonPfad = !ECHTE_SPALTEN.has(feld);
  return {
    spalte: jsonPfad ? `data->>${feld}` : feld,
    aufsteigend,
    jsonPfad,
  };
}

/**
 * Translates a bitApi-style query object into PostgREST equality pairs.
 *
 * Every value is stringified because `data->>key` yields TEXT (Research §7):
 * `{ aktiv: true }` becomes `['data->>aktiv', 'true']`, matching the jsonb
 * boolean via its text form. undefined/null values are dropped, exactly like
 * buildQuery in bitApi.js:43-45 (a null query value must not filter everything
 * out). This reproduces db.js:114 strict equality for the values the app
 * actually queries — measured in the parity test, not assumed.
 *
 * @param {Record<string, any>|undefined|null} query field → value (JS types)
 * @returns {Array<[string, string]>} pairs of [column-expression, text-value]
 */
export function filterNachPostgrest(query) {
  /** @type {Array<[string, string]>} Tupel-Liste (TS: string[][] genügt dem JSDoc nicht) */
  const paare = [];
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue; // wie buildQuery
    paare.push([`data->>${k}`, String(v)]);
  }
  return paare;
}

/**
 * Maps one `records` row back to the client record shape (inverse of
 * zeileAusDatensatz). The jsonb `data` payload is spread first, then the three
 * column-backed fields — so the real columns WIN over anything stored inside
 * data (that is how db.js writes records: id/created_date/updated_date are
 * authoritative top-level fields, db.js:133-138).
 *
 * @param {{ id: string, data?: Record<string, any>, created_date?: string,
 *   updated_date?: string }} zeile a `records` row from Supabase
 * @returns {Record<string, any>} client record { ...data, id, created_date, updated_date }
 */
export function datensatzAusZeile(zeile) {
  return {
    ...(zeile?.data || {}),
    id: zeile?.id,
    created_date: zeile?.created_date,
    updated_date: zeile?.updated_date,
  };
}
