// sammlungKern.js — the three record-collection helpers demoDb.js and the
// "personal" storage class's own module both need (id generation, sort,
// filter). Extracted from demoDb.js (Plan 80-02 Task 1) so the second storage
// class does not grow a SECOND copy of the same three functions — the exact
// failure mode "second editor next to an existing one" the project rules warn
// against.
//
// In:  plain record arrays / a sort string / a filter query object.
// Out: same shapes, no side effects, no storage access — safe to import from
//      anywhere, including plain node (unit tests, scripts/supabase-import.mjs
//      indirectly via personalEntitaeten.js which does NOT import this, but
//      the same purity rule applies).

/**
 * Compact unique id (timestamp + random) — the SAME shape server/db.js uses,
 * so demo/lokal and Express ids are interchangeable in fixtures and tests.
 * @returns {string}
 */
export function neueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Orders records by a bitApi-style sort string: "-feld" descending, "feld"
 * ascending, missing/empty string = unchanged order. `null`/`undefined`
 * values sort last regardless of direction (missing data should not jump to
 * the top just because descending order inverts everything else).
 * @param {object[]} records
 * @param {string} [sortStr]
 * @returns {object[]} a NEW array; `records` itself is never mutated
 */
export function sortiereDatensaetze(records, sortStr) {
  if (!sortStr) return records;
  const desc = sortStr.startsWith('-');
  const field = desc ? sortStr.slice(1) : sortStr;
  return [...records].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

/**
 * One record against a filter query, with TOLERANT equality: a URL query
 * (`req.query` on Express, `?k=v` parsed by bitApi) always arrives as a
 * string, so a strict `===` never matched number/boolean fields (`?aktiv=true`
 * never found `aktiv: true`). The strict check stays first so identical JS
 * values short-circuit; the `String()` fallback is the SAME rule as
 * server/db.js's `matchesQuery` and PostgREST's `data->>k` (text comparison)
 * — one rule, three storage paths (measured by the parity test in
 * abfrage.test.js for the entity path; the "personal" storage class's own
 * module reuses it verbatim for the HR path so a fourth copy never appears).
 * @param {object} record
 * @param {Record<string, unknown>} query
 * @returns {boolean}
 */
export function passtFilter(record, query) {
  return Object.entries(query).every(
    ([k, v]) => record?.[k] === v || String(record?.[k]) === String(v)
  );
}
