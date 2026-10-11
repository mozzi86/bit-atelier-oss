// Fachlayer schema versions and migrations (Plan 87-07).
//
// Why: every planning tab stores one untyped JSON blob in the BimModel record
// (werkstatt_layer, netz_layer, … — register in .planning/FACHLAYER-SCHEMA.md and the
// head of @designer/lib/useFachlayer.js). None of them carried a version, so a second
// client (Supabase, desktop) or a later field change had no way to tell an old blob
// from a new one. This module gives every layer a version `v`, migrates old blobs on
// load (deterministic chain v → v+1 → …) and stamps `updatedAt` on save.
//
// In:  a layer field name and its raw blob. Out: the blob at the current version
//      (same object when nothing changed), plus the version table.
// No React, no I/O — the hooks (useFachlayer, useSketchLayer, BcfIssues, …) call this.

/**
 * Current schema version per layer field. A blob without `v` is version 0. Bump a
 * version only together with a migration in MIGRATIONEN — never silently.
 * @type {Record<string, number>}
 */
export const LAYER_VERSION = {
  werkstatt_layer: 2,
  netz_layer: 1,
  aussenanlagen_layer: 1,
  entwaesserung_layer: 1,
  brandschutz_layer: 1,
  statik_layer: 1,
  schallschutz_layer: 1,
  raumklima_layer: 1,
  sketch_layer: 1,
  befunde_layer: 1,
  lieferung_layer: 1,
  pruefung_layer: 1,
};

/**
 * Migrations per layer: index i turns version i into i + 1. Pure functions that return
 * a NEW object; they never mutate their input. Version 0 → 1 is the identity for every
 * layer today (only `v` is added) — the table exists so the next real change has a
 * place to go and a test to pass.
 * @type {Record<string, Array<(wert: any) => any>>}
 */
export const MIGRATIONEN = {
  ...Object.fromEntries(Object.keys(LAYER_VERSION).map((feld) => [feld, [(wert) => wert]])),
  // werkstatt_layer 1 → 2 (86-05b): two OPTIONAL fields appear — `riegelMinFlaeche_m2` (m²,
  // missing = 120 = solver default) and `gewaehlterVorschlag` (missing = none). Nothing has
  // to be rewritten: a v1 blob is a valid v2 blob, the workshop defaults fill the gaps.
  werkstatt_layer: [(wert) => wert, (wert) => ({ ...wert })],
};

/** @param {unknown} feld @returns {feld is string} true for a registered layer field */
export function istFachlayer(feld) {
  return typeof feld === "string" && Object.prototype.hasOwnProperty.call(LAYER_VERSION, feld);
}

/**
 * Migrate a stored blob to the current version of its field.
 * - Unknown field or non-object blob (null, array, primitive): returned unchanged,
 *   `migriert: false` — the caller keeps its own default handling.
 * - Blob newer than this code: returned unchanged with `zuNeu: true` (a newer client
 *   wrote it; do not downgrade, do not touch).
 * - Otherwise every migration from `v` up to LAYER_VERSION runs; the result carries `v`.
 * @param {string} feld layer field name, e.g. "werkstatt_layer"
 * @param {any} wert stored blob
 * @returns {{wert: any, migriert: boolean, von: number, nach: number, zuNeu?: boolean}}
 */
export function migrateLayer(feld, wert) {
  const ziel = istFachlayer(feld) ? LAYER_VERSION[feld] : null;
  if (ziel === null || !wert || typeof wert !== "object" || Array.isArray(wert)) {
    return { wert, migriert: false, von: 0, nach: ziel ?? 0 };
  }
  const von = Number.isInteger(wert.v) && wert.v >= 0 ? wert.v : 0;
  if (von > ziel) return { wert, migriert: false, von, nach: ziel, zuNeu: true };
  if (von === ziel) return { wert, migriert: false, von, nach: ziel };
  let aktuell = wert;
  for (let i = von; i < ziel; i += 1) {
    const schritt = MIGRATIONEN[feld]?.[i];
    if (typeof schritt !== "function") throw new Error(`Fachlayer ${feld}: Migration ${i} → ${i + 1} fehlt`);
    aktuell = { ...schritt(aktuell), v: i + 1 };
  }
  return { wert: aktuell, migriert: true, von, nach: ziel };
}

/**
 * The blob as it is written: current `v` and `updatedAt` (ISO 8601, client clock —
 * groundwork for a later sync decision, D-P87-01). Non-object blobs pass through.
 * @param {string} feld layer field name
 * @param {any} wert blob to save
 * @param {Date} [jetzt] for tests
 * @returns {any}
 */
export function stempelFuerSave(feld, wert, jetzt = new Date()) {
  if (!istFachlayer(feld) || !wert || typeof wert !== "object" || Array.isArray(wert)) return wert;
  return { ...wert, v: LAYER_VERSION[feld], updatedAt: jetzt.toISOString() };
}
