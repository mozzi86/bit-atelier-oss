// One-time import: server/db.json + server/blobs/ → Supabase `records` + Storage.
// (Phase 57-03; `leseDbJson` is exported for reuse by 70-03, which imports the
// same source into the desktop client's file adapter — other target, same shape.)
//
// Purpose: move the own office's whole data stock into the org of the prod
// project, reproducibly (upsert by id) and reversibly (nothing local is
// touched — db.json and blobs remain as the way back).
//
// In:  --ziel dev|prod, --org <uuid> (target org), optional --dry-run (count
//      and measure only, no writes), --ja-prod (explicit consent for a REAL
//      prod run; a prod dry-run needs it not). Env: SUPABASE_URL_<ZIEL>,
//      SUPABASE_SERVICE_<ZIEL> (service_role — bypasses RLS; created_by stays
//      null, intended). Load with `node --env-file=.env`.
// Out: report table  entity | db.json | records after run | blobs local |
//      storage after run; exit 1 when any real-run deviation ≠ 0 or on error.
//
// The mapping record → row is zeileAusDatensatz from @core abfrage.js — the
// SAME function the client (57-02) uses. There is deliberately no second
// mapping (57-03 key_links). ids are preserved verbatim; created_date/
// updated_date are lifted from the jsonb payload onto the row columns.
//
// Usage:
//   node --env-file=.env scripts/supabase-import.mjs --ziel dev --org <uuid> --dry-run
//   node --env-file=.env scripts/supabase-import.mjs --ziel dev --org <uuid>
//   node --env-file=.env scripts/supabase-import.mjs --ziel prod --org <uuid> --ja-prod

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// One mapping for client and import (57-03 key_links). Relative import —
// scripts run in plain node without the Vite/@core alias loader.
import { zeileAusDatensatz } from '../packages/nova-core/src/api/abfrage.js';
// The SAME id whitelist as the local blob store (blobs.js:17) — exported there
// for this script; invalid names are reported, never silently skipped.
import { ID_MUSTER } from '../packages/nova-core/server/blobs.js';
// Plan 80-02 (D-P80-A #5): Personal-Entitäten bleiben lokal — ein
// db.json-Export, der eine von ihnen enthält, darf nicht in die Cloud-Tabelle
// `records` gelangen (die hat vor Phase 74 keine Organisations-Allowlist).
import { PERSONAL_ENTITAETEN } from '../packages/nova-core/src/api/personalEntitaeten.js';

const WURZEL = path.resolve(import.meta.dirname, '..');
/** Default source files (never modified by this script). */
const DB_PFAD = path.join(WURZEL, 'server', 'db.json');
const BLOB_VERZEICHNIS = path.join(WURZEL, 'server', 'blobs');
/** Batch size for upserts: 500 rows per request (plan 57-03 Task 1). */
const BATCH_GROESSE = 500;
/** Free-plan upload limit in MB (57-RESEARCH §7) — dry-run measures against it. */
const UPLOAD_GRENZE_MB = 50;
const UUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads and validates a db.json-shaped file: { <Entity>: [ {id, …}, … ] }.
 *
 * Every row MUST carry a non-empty string id — the import preserves ids
 * verbatim because cross-references inside the data (project_id,
 * element_guid, blob references) depend on them. A row without id aborts
 * the whole run with a plain-text error naming the entity.
 *
 * @param {string} pfad absolute or relative path to the db.json file
 * @returns {{ entitaeten: Array<{ name: string, zeilen: object[] }>, gesamt: number }}
 *   entities in file order (empty collections included, they count 0), plus
 *   the total row count
 * @throws {Error} plain-text error when the file is unreadable, a collection
 *   is not an array, or any row lacks an id
 */
export function leseDbJson(pfad) {
  let roh;
  try {
    roh = JSON.parse(fs.readFileSync(pfad, 'utf-8'));
  } catch (e) {
    throw new Error(`db.json unlesbar (${pfad}): ${e?.message || e}`);
  }
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) {
    throw new Error(`db.json hat keine Objekt-Form (<Entität>: […]): ${pfad}`);
  }
  const entitaeten = [];
  let gesamt = 0;
  for (const [name, zeilen] of Object.entries(roh)) {
    if (PERSONAL_ENTITAETEN.includes(name)) {
      throw new Error(`Entität "${name}" ist eine Personal-Entität und bleibt lokal – Import abgebrochen.`);
    }
    if (!Array.isArray(zeilen)) {
      throw new Error(`Entität "${name}" in db.json ist kein Array — Import abgebrochen.`);
    }
    for (const zeile of zeilen) {
      if (!zeile || typeof zeile.id !== 'string' || zeile.id === '') {
        throw new Error(
          `Datensatz ohne id in Entität "${name}" — Import abgebrochen. ` +
          'Ids müssen unverändert bleiben, sonst brechen Querverweise (project_id, element_guid, Blob-Referenzen).'
        );
      }
    }
    entitaeten.push({ name, zeilen });
    gesamt += zeilen.length;
  }
  return { entitaeten, gesamt };
}

/**
 * Splits a list into consecutive batches (pure — unit-tested with 1201 rows).
 * @param {any[]} liste rows to split
 * @param {number} [groesse] max rows per batch (default 500)
 * @returns {any[][]} batches in order; empty input → empty array
 */
export function inBatches(liste, groesse = BATCH_GROESSE) {
  const batches = [];
  for (let i = 0; i < liste.length; i += groesse) {
    batches.push(liste.slice(i, i + groesse));
  }
  return batches;
}

/**
 * Checks blob ids against the blobs.js whitelist (same regex, one truth).
 * @param {string[]} ids blob ids (file names without ".json")
 * @returns {{ gueltig: string[], ungueltig: string[] }} split result
 */
export function blobIdsPruefen(ids) {
  const gueltig = [];
  const ungueltig = [];
  for (const id of ids) {
    if (ID_MUSTER.test(id)) gueltig.push(id);
    else ungueltig.push(id);
  }
  return { gueltig, ungueltig };
}

/**
 * Maps one db.json record to a `records` row, PRESERVING timestamps.
 * zeileAusDatensatz strips created_date/updated_date from the jsonb payload
 * (they live as columns); the import lifts the original values back onto the
 * row so sorting and audit dates survive the move unchanged.
 * @param {string} entity entity name (e.g. "Project")
 * @param {string} orgId target org uuid
 * @param {object} datensatz record from db.json (id required — see leseDbJson)
 * @returns {object} row for upsert
 */
function zeileMitZeitstempeln(entity, orgId, datensatz) {
  const zeile = zeileAusDatensatz(entity, orgId, datensatz);
  if (datensatz.created_date) zeile.created_date = datensatz.created_date;
  if (datensatz.updated_date) zeile.updated_date = datensatz.updated_date;
  return zeile;
}

/**
 * Reads the local blob directory and measures sizes.
 * @param {string} verzeichnis directory containing <id>.json blobs
 * @returns {{ ids: string[], groesster: { id: string, mb: number } | null, gesamtBytes: number }}
 */
function blobsMessen(verzeichnis) {
  let dateien;
  try {
    dateien = fs.readdirSync(verzeichnis).filter((f) => f.endsWith('.json'));
  } catch {
    return { ids: [], groesster: null, gesamtBytes: 0 }; // no blobs dir = no blobs
  }
  const ids = dateien.map((f) => f.slice(0, -'.json'.length));
  let groesster = null;
  let gesamtBytes = 0;
  for (const id of ids) {
    const bytes = fs.statSync(path.join(verzeichnis, `${id}.json`)).size;
    gesamtBytes += bytes;
    const mb = bytes / 1e6;
    if (!groesster || mb > groesster.mb) groesster = { id, mb };
  }
  return { ids, groesster, gesamtBytes };
}

/**
 * Counts rows per entity for one org via head-count queries.
 * @param {object} client supabase-js client (service_role for the real run)
 * @param {string} orgId org uuid
 * @param {string[]} entityNamen entities to count
 * @returns {Promise<Map<string, number>>} entity → row count
 */
async function zaehlenJeEntitaet(client, orgId, entityNamen) {
  const counts = new Map();
  for (const name of entityNamen) {
    const { count, error } = await client
      .from('records').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('entity', name);
    if (error) throw new Error(`Zählen "${name}" fehlgeschlagen: ${error.message}`);
    counts.set(name, count ?? 0);
  }
  return counts;
}

/**
 * The whole import against an (injected) supabase client — no module-level
 * client so unit tests can pass a mock and stay offline.
 *
 * @param {object} client supabase-js client with .from() and .storage
 * @param {object} opts
 * @param {string} opts.orgId target org uuid
 * @param {boolean} opts.dryRun true = count/measure only; the ONLY network
 *   calls are head-count selects (connection test), never writes
 * @param {{ entitaeten: Array<{ name: string, zeilen: object[] }>, gesamt: number }} opts.db
 *   parsed db.json (from leseDbJson)
 * @param {string} opts.blobVerzeichnis local blob directory
 * @returns {Promise<{ erfolge: boolean, zeilen: object[], abweichungen: number,
 *   blobs: { lokal: number, storage: number, groessterMb: number, ungueltig: string[] } }>}
 *   report rows + deviations; `erfolge` false ⇒ caller exits 1
 * @throws {Error} plain-text on any Supabase error (no silent catch) or on
 *   invalid blob names (reported, run aborted — nothing half-uploaded)
 */
export async function importiere(client, opts) {
  const { orgId, dryRun, db, blobVerzeichnis } = opts;

  // Blobs: measure first, validate names BEFORE any write (dry-run reports too).
  const blobMessung = blobsMessen(blobVerzeichnis);
  const { gueltig, ungueltig } = blobIdsPruefen(blobMessung.ids);
  if (ungueltig.length > 0) {
    throw new Error(
      `Ungültige Blob-Namen (Whitelist ${ID_MUSTER}): ${ungueltig.join(', ')} — ` +
      'Import abgebrochen, nichts geschrieben. Namen werden gemeldet, nie still übersprungen.'
    );
  }

  // Connection test (also the dry-run's only query): count per entity.
  const vorher = await zaehlenJeEntitaet(client, orgId, db.entitaeten.map((e) => e.name));

  if (!dryRun) {
    // Upsert by id in batches of 500 — repeatable: a second run overwrites
    // with the same values instead of duplicating (must-have 57-03).
    for (const { name, zeilen } of db.entitaeten) {
      if (zeilen.length === 0) continue;
      const rows = zeilen.map((z) => zeileMitZeitstempeln(name, orgId, z));
      for (const batch of inBatches(rows)) {
        const { error } = await client
          .from('records').upsert(batch, { onConflict: 'id' });
        if (error) {
          throw new Error(`Upsert "${name}" fehlgeschlagen: ${error.message}`);
        }
      }
    }
    // Storage upload: <org_id>/<id>.json, matching the 0003 policies.
    for (const id of gueltig) {
      const bytes = fs.readFileSync(path.join(blobVerzeichnis, `${id}.json`));
      const { error } = await client.storage.from('blobs')
        .upload(`${orgId}/${id}.json`, bytes, { upsert: true, contentType: 'application/json' });
      if (error) {
        throw new Error(`Blob-Upload "${id}" fehlgeschlagen: ${error.message}`);
      }
    }
  }

  // Counts after the run: for real runs these must equal db.json per entity;
  // for dry runs they are the CURRENT stock (deviation check not applicable —
  // nothing was written; failing here would make repeated dry-runs unusable).
  const nachher = dryRun ? vorher : await zaehlenJeEntitaet(client, orgId, db.entitaeten.map((e) => e.name));

  let storageAnzahl = 0;
  {
    const { data, error } = await client.storage.from('blobs').list(orgId);
    if (error) throw new Error(`Storage-Liste fehlgeschlagen: ${error.message}`);
    storageAnzahl = (data || []).length;
  }

  const zeilen = [];
  let abweichungen = 0;
  for (const { name, zeilen: daten } of db.entitaeten) {
    const ist = nachher.get(name) ?? 0;
    const diff = dryRun ? 0 : ist - daten.length;
    if (diff !== 0) abweichungen += 1;
    zeilen.push({ entitaet: name, dbJson: daten.length, records: ist, abweichung: diff });
  }

  const blobDiff = dryRun ? 0 : storageAnzahl - gueltig.length;
  if (blobDiff !== 0) abweichungen += 1;

  return {
    erfolge: abweichungen === 0,
    zeilen,
    abweichungen,
    vorher: Object.fromEntries(vorher),
    blobs: {
      lokal: gueltig.length,
      storage: storageAnzahl,
      groessterMb: blobMessung.groesster ? Number(blobMessung.groesster.mb.toFixed(2)) : 0,
      groessterId: blobMessung.groesster?.id ?? null,
      gesamtMb: Number((blobMessung.gesamtBytes / 1e6).toFixed(2)),
      abweichung: blobDiff,
    },
  };
}

/**
 * Prints the report table (German headers, fixed-width columns).
 * @param {object} bericht result of importiere()
 * @param {boolean} dryRun whether this was a dry run
 */
function berichtDrucken(bericht, dryRun) {
  const kopf = ['Entität', 'db.json', dryRun ? 'records (vorher)' : 'records (nach Lauf)', 'Abweichung'];
  const zeilen = bericht.zeilen.map((z) => [
    z.entitaet, String(z.dbJson), String(z.records), dryRun ? '–' : String(z.abweichung),
  ]);
  const blobZeile = ['_Blobs_', String(bericht.blobs.lokal), String(bericht.blobs.storage),
    dryRun ? '–' : String(bericht.blobs.abweichung)];
  const alle = [kopf, ...zeilen, blobZeile];
  const breiten = kopf.map((_, i) => Math.max(...alle.map((z) => z[i].length)));
  for (const z of alle) {
    console.log(z.map((f, i) => f.padEnd(breiten[i])).join(' | '));
  }
  console.log('');
  console.log(`Größter Blob: ${bericht.blobs.groessterId ?? '–'} = ${bericht.blobs.groessterMb} MB ` +
    `(gesamt ${bericht.blobs.gesamtMb} MB; Upload-Grenze Free-Plan ${UPLOAD_GRENZE_MB} MB)`);
  if (bericht.blobs.groessterMb > UPLOAD_GRENZE_MB) {
    console.log(`ACHTUNG: größter Blob überschreitet die ${UPLOAD_GRENZE_MB}-MB-Grenze des Free-Plans.`);
  }
}

/**
 * Reads a required env var or aborts with a plain-text message.
 * @param {string} name environment variable name
 * @returns {string} the value, guaranteed non-empty
 */
function envPflicht(name) {
  const wert = process.env[name];
  if (!wert) {
    console.error(`FEHLT: Umgebungsvariable ${name} ist nicht gesetzt (siehe .env.example).`);
    process.exit(1);
  }
  return wert;
}

/**
 * Parses argv into options; aborts with a plain message on anything invalid.
 * @param {string[]} argv process.argv (from index 2)
 * @returns {{ ziel: 'dev'|'prod', orgId: string, dryRun: boolean, jaProd: boolean }}
 */
function argsLesen(argv) {
  let ziel = null;
  let orgId = null;
  let dryRun = false;
  let jaProd = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--ziel') { ziel = argv[++i]; }
    else if (a === '--org') { orgId = argv[++i]; }
    else if (a === '--dry-run') { dryRun = true; }
    else if (a === '--ja-prod') { jaProd = true; }
    else {
      console.error(`Unbekanntes Argument: ${a}. Erlaubt: --ziel dev|prod --org <uuid> [--dry-run] [--ja-prod]`);
      process.exit(1);
    }
  }
  if (ziel !== 'dev' && ziel !== 'prod') {
    console.error('--ziel fehlt oder ungültig (erlaubt: dev, prod).');
    process.exit(1);
  }
  if (!orgId || !UUID_MUSTER.test(orgId)) {
    console.error(`--org fehlt oder ist keine UUID: ${JSON.stringify(orgId)}. Org per SQL-Editor anlegen (supabase/README.md).`);
    process.exit(1);
  }
  // A REAL prod run needs explicit consent; the dry-run may not write anyway.
  if (ziel === 'prod' && !dryRun && !jaProd) {
    console.error('Abbruch: echter Lauf gegen prod braucht --ja-prod (Nutzer-Checkpoint, 57-03 Task 3). Dry-Run geht ohne.');
    process.exit(1);
  }
  return { ziel, orgId, dryRun, jaProd };
}

async function main() {
  const { ziel, orgId, dryRun } = argsLesen(process.argv.slice(2));
  const OBER = ziel.toUpperCase(); // env names are DEV/PROD (57-01 .env.example)
  const url = envPflicht(`SUPABASE_URL_${OBER}`);
  const serviceKey = envPflicht(`SUPABASE_SERVICE_${OBER}`);

  // service_role bypasses RLS — that is what the import needs (created_by
  // stays null). The key must never reach a browser bundle or a commit.
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Quelle : ${DB_PFAD}`);
  console.log(`Blobs  : ${BLOB_VERZEICHNIS}`);
  console.log(`Ziel   : ${ziel} (${url}) · Org ${orgId} · ${dryRun ? 'DRY-RUN (keine Schreibvorgänge)' : 'ECHTER LAUF'}`);
  console.log('');

  const db = leseDbJson(DB_PFAD);
  console.log(`db.json: ${db.entitaeten.length} Entitäten, ${db.gesamt} Datensätze.`);

  const bericht = await importiere(client, {
    orgId, dryRun, db, blobVerzeichnis: BLOB_VERZEICHNIS,
  });
  berichtDrucken(bericht, dryRun);

  if (dryRun) {
    console.log('');
    console.log('DRY-RUN beendet — es wurde nichts geschrieben.');
    process.exit(0);
  }
  if (bericht.abweichungen > 0) {
    console.error(`ABBRUCH: ${bericht.abweichungen} Abweichung(en) ungleich 0 — Bericht oben prüfen.`);
    process.exit(1);
  }
  console.log('');
  console.log('Import abgeschlossen: alle Differenzen 0. Lokale Daten unverändert (Rückweg intakt).');
}

// Run the CLI only when executed directly (node scripts/supabase-import.mjs).
// Unit tests import leseDbJson/inBatches/blobIdsPruefen/importiere from this
// module — a top-level main() call would abort the test runner on missing args.
// import.meta.url comparison works on Windows (both sides are file:// URLs).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`FEHLER: ${err?.message || err}`);
    process.exit(1);
  });
}
