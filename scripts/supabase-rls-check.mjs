// RLS check against the bit-atelier-dev Supabase project (Phase 57-01, Task 4).
//
// Purpose: PROVE the tenant separation from migrations 0001–0004 holds. The
// script creates two orgs (A/B) and two users (a/b) with the service_role key,
// then signs in as user a with the anon key and exercises six cases:
//   1. insert record into A          → ok
//   2. select records of A           → exactly 1 row
//   3. select records of B           → 0 rows (RLS filters, no error)
//   4. insert record into B          → ERROR (RLS with-check violation)
//   5. upload blob A/<id>.json       → ok
//   6. download blob B/<x>.json      → ERROR (storage policy via ist_mitglied)
// Afterwards everything is cleaned up (blobs, users; orgs cascade records and
// memberships). Exit 1 at the FIRST violation, plain-text output per case.
//
// In:  environment variables (load with `node --env-file=.env`):
//        SUPABASE_URL_DEV      project URL of bit-atelier-dev
//        SUPABASE_ANON_DEV     anon key (public, RLS-protected)
//        SUPABASE_SERVICE_DEV  service_role key (bypasses RLS — NEVER commit)
// Out: six PASS/FAIL lines on stdout; exit code 0 = 6/6, 1 = violation.
//
// Safety: runs ONLY against dev. If SUPABASE_URL_DEV equals SUPABASE_URL_PROD
// or contains "prod", the script refuses. It never touches anything local
// (db.json/blobs are not read or written).
//
// Usage:  node --env-file=.env scripts/supabase-rls-check.mjs

import { createClient } from '@supabase/supabase-js';

/**
 * Reads a required env var or aborts with a plain-text message.
 * @param {string} name environment variable name
 * @returns {string} the value, guaranteed non-empty
 */
function envPflicht(name) {
  const wert = process.env[name];
  if (!wert) {
    console.error(`FEHLT: Umgebungsvariable ${name} ist nicht gesetzt.`);
    console.error('Start mit: node --env-file=.env scripts/supabase-rls-check.mjs');
    process.exit(1);
  }
  return wert;
}

const URL_DEV = envPflicht('SUPABASE_URL_DEV');
const ANON_DEV = envPflicht('SUPABASE_ANON_DEV');
const SERVICE_DEV = envPflicht('SUPABASE_SERVICE_DEV');
const URL_PROD = process.env.SUPABASE_URL_PROD || '';

// Hard stop: this script creates and deletes users — it must never run
// against the production project.
if (URL_PROD && URL_DEV === URL_PROD) {
  console.error('ABBRUCH: SUPABASE_URL_DEV ist gleich der prod-URL. Nur dev erlaubt.');
  process.exit(1);
}
if (/prod/i.test(URL_DEV)) {
  console.error(`ABBRUCH: SUPABASE_URL_DEV sieht nach prod aus (${URL_DEV}). Nur dev erlaubt.`);
  process.exit(1);
}

// Service client: bypasses RLS (service_role). Used for setup + teardown only.
const admin = createClient(URL_DEV, SERVICE_DEV, {
  auth: { autoRefreshToken: false, persistSession: false },
});
// Anon client: what the browser sees. User a signs into THIS client.
const anon = createClient(URL_DEV, ANON_DEV, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Short unique suffix so parallel/repeated runs cannot collide on emails. */
const stempel = Date.now().toString(36);
const ORG_A_NAME = `rls-check-a-${stempel}`;
const ORG_B_NAME = `rls-check-b-${stempel}`;
const USER_A_MAIL = `rls-check-a-${stempel}@example.invalid`;
const USER_B_MAIL = `rls-check-b-${stempel}@example.invalid`;
// Fixed test password for throwaway users (deleted in teardown). Not a
// secret — it protects nothing and never leaves this run.
const PASSWORT = `rls-check-${stempel}-Aa1!`;

/** First failing case aborts immediately with exit 1 (plan: Exit 1 bei erstem Verstoß). */
let verstoesse = 0;

/**
 * Prints one case result and counts violations.
 * @param {number} nr case number 1–6
 * @param {string} text what was tested
 * @param {boolean} ok true = behaved as required
 * @param {string} [detail] extra evidence (error message, row count)
 */
function fall(nr, text, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] Fall ${nr}: ${text}${detail ? ` — ${detail}` : ''}`);
  if (!ok) verstoesse += 1;
}

/**
 * Aborts setup/teardown problems with a plain message (not a PASS/FAIL case).
 * @param {string} what step description
 * @param {{ message?: string, details?: string }} error Supabase error object
 */
function setupFehler(what, error) {
  console.error(`SETUP-FEHLER bei ${what}: ${error?.message || error?.details || JSON.stringify(error)}`);
  process.exit(1);
}

async function main() {
  // --- Setup: two orgs, two users, memberships (service_role, bypasses RLS) --
  const { data: orgA, error: e1 } = await admin
    .from('orgs').insert({ name: ORG_A_NAME }).select('id').single();
  if (e1) setupFehler('orgs A anlegen', e1);
  const { data: orgB, error: e2 } = await admin
    .from('orgs').insert({ name: ORG_B_NAME }).select('id').single();
  if (e2) setupFehler('orgs B anlegen', e2);

  const { data: userA, error: e3 } = await admin.auth.admin.createUser({
    email: USER_A_MAIL, password: PASSWORT, email_confirm: true,
  });
  if (e3) setupFehler('Nutzer a anlegen', e3);
  const { data: userB, error: e4 } = await admin.auth.admin.createUser({
    email: USER_B_MAIL, password: PASSWORT, email_confirm: true,
  });
  if (e4) setupFehler('Nutzer b anlegen', e4);

  // a is member of A only; b is member of B only. The cross-org cases below
  // are only meaningful with strictly separate memberships.
  const { error: e5 } = await admin.from('org_members').insert([
    { user_id: userA.user.id, org_id: orgA.id, role: 'admin' },
    { user_id: userB.user.id, org_id: orgB.id, role: 'admin' },
  ]);
  if (e5) setupFehler('Mitgliedschaften setzen', e5);

  // Seed one blob in B (as admin) so case 6 has something to attempt to read.
  const blobBId = `rlscheck-b-${stempel}`;
  const { error: e6 } = await admin.storage
    .from('blobs')
    .upload(`${orgB.id}/${blobBId}.json`, Buffer.from(JSON.stringify({ geheim: true })), {
      contentType: 'application/json',
    });
  if (e6) setupFehler('Blob in B anlegen', e6);

  // --- Sign in as user a on the ANON client (what the browser would do) ------
  const { error: e7 } = await anon.auth.signInWithPassword({
    email: USER_A_MAIL, password: PASSWORT,
  });
  if (e7) setupFehler('als Nutzer a anmelden', e7);

  const recordIdA = `rlscheck-a-${stempel}`;
  const blobAId = `rlscheck-a-${stempel}`;

  try {
    // Case 1: insert record into own org A → must succeed (created_by = uid).
    const { error: insA } = await anon.from('records').insert({
      id: recordIdA, entity: 'RlsCheckTest', org_id: orgA.id,
      data: { zweck: 'rls-check' }, created_by: userA.user.id,
    });
    fall(1, 'insert record in Org A (Mitglied)', !insA, insA ? insA.message : '');

    // Case 2: select records of own org A → exactly the one row just inserted.
    const { data: rowsA, error: selA } = await anon.from('records')
      .select('id').eq('org_id', orgA.id).eq('entity', 'RlsCheckTest');
    fall(2, 'select records Org A → 1 Zeile', !selA && rowsA?.length === 1,
      selA ? selA.message : `${rowsA?.length ?? '?'} Zeile(n)`);

    // Case 3: select records of foreign org B → 0 rows (RLS filters silently).
    const { data: rowsB, error: selB } = await anon.from('records')
      .select('id').eq('org_id', orgB.id);
    fall(3, 'select records Org B (fremd) → 0 Zeilen', !selB && rowsB?.length === 0,
      selB ? selB.message : `${rowsB?.length ?? '?'} Zeile(n)`);

    // Case 4: insert record into foreign org B → must ERROR (with-check).
    const { error: insB } = await anon.from('records').insert({
      id: `rlscheck-fremd-${stempel}`, entity: 'RlsCheckTest', org_id: orgB.id,
      data: {}, created_by: userA.user.id,
    });
    fall(4, 'insert record in Org B (fremd) → Fehler', Boolean(insB),
      insB ? insB.message : 'KEIN Fehler — RLS-Verstoß!');

    // Case 5: upload blob into own org folder A/<id>.json → must succeed.
    const { error: upA } = await anon.storage
      .from('blobs')
      .upload(`${orgA.id}/${blobAId}.json`, Buffer.from(JSON.stringify({ ok: true })), {
        contentType: 'application/json',
      });
    fall(5, 'upload Blob A/<id>.json (Mitglied)', !upA, upA ? upA.message : '');

    // Case 6: download blob of foreign org B → must ERROR (storage policy).
    const { error: downB } = await anon.storage
      .from('blobs')
      .download(`${orgB.id}/${blobBId}.json`);
    fall(6, 'download Blob B/<x>.json (fremd) → Fehler', Boolean(downB),
      downB ? downB.message : 'KEIN Fehler — RLS-Verstoß!');
  } finally {
    // --- Teardown: blobs first (storage has no cascade), then users, then
    // orgs — deleting an org cascades records + org_members (0001 FKs).
    await anon.auth.signOut();
    const { error: rmBlobA } = await admin.storage.from('blobs')
      .remove([`${orgA.id}/${blobAId}.json`]);
    if (rmBlobA) console.error(`Aufräumen: Blob A nicht gelöscht: ${rmBlobA.message}`);
    const { error: rmBlobB } = await admin.storage.from('blobs')
      .remove([`${orgB.id}/${blobBId}.json`]);
    if (rmBlobB) console.error(`Aufräumen: Blob B nicht gelöscht: ${rmBlobB.message}`);
    // Case 4, if it wrongly succeeded, left a stray record in B — the org
    // delete below cascades it away either way.
    // Records first: they reference both the users (created_by) and the orgs
    // (org_id) via FKs without cascade, so users/orgs cannot go before them
    // (first live run 18.09.2026 left two orgs + one user behind).
    const { error: delRecs } = await admin.from('records').delete().in('org_id', [orgA.id, orgB.id]);
    if (delRecs) console.error(`Aufräumen: Records nicht gelöscht: ${delRecs.message}`);
    const { error: delA } = await admin.auth.admin.deleteUser(userA.user.id);
    if (delA) console.error(`Aufräumen: Nutzer a nicht gelöscht: ${delA.message}`);
    const { error: delB } = await admin.auth.admin.deleteUser(userB.user.id);
    if (delB) console.error(`Aufräumen: Nutzer b nicht gelöscht: ${delB.message}`);
    const { error: delOrgs } = await admin.from('orgs').delete().in('id', [orgA.id, orgB.id]);
    if (delOrgs) console.error(`Aufräumen: Orgs nicht gelöscht: ${delOrgs.message}`);
  }

  if (verstoesse > 0) {
    console.log(`ERGEBNIS: ${verstoesse} Verstoß/Verstöße gegen die Mandantentrennung.`);
    process.exit(1);
  }
  console.log('ERGEBNIS: 6/6 — Mandantentrennung hält.');
}

main().catch((err) => {
  console.error('UNERWARTETER FEHLER:', err?.message || err);
  process.exit(1);
});
