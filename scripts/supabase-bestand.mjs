#!/usr/bin/env node
// Stock count as the signed-in operator (Phase 74-01 Task 0/12) — READ ONLY.
//
// Counts what the POLICIES show: it signs in with the publishable (anon) key
// and the operator's own account, exactly like the app. Counted with the
// service role every regression would be invisible, because the service role
// bypasses RLS. Run once before 0006 and after 0014 (and after each file
// during the rollout, Task 12) and compare: any difference per entity is the
// abort criterion (rollback 0011_down.sql).
//
// Counts: rows per entity in `records` (all orgs the operator sees, paged by
// 1000), objects in the operator's org folder of bucket `blobs` (and of
// `freigaben`/`gebote` once 0013 exists; a missing bucket is reported, not
// an error). Writes only the JSON report into .planning/ — entity names and
// numbers, no record content, no host.
//
// In:  BESTAND_URL, BESTAND_ANON (publishable key), BESTAND_EMAIL,
//      BESTAND_PASSWORT (operator login; session only, never printed);
//      --ziel <name> label in the file name (prod, dev2 …).
// Out: .planning/bestand-<yyyy-mm-dd>-<ziel>.json; with --vergleich a.json b.json
//      a comparison, exit 1 on any difference. No writes to the database.
//
// Usage (PowerShell):
//   node scripts/supabase-bestand.mjs --ziel prod
//   node scripts/supabase-bestand.mjs --vergleich .planning/bestand-2026-10-20-prod.json .planning/bestand-2026-10-21-prod.json

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Page size of the records read, in rows. */
const SEITE = 1000;

/**
 * Rows per entity.
 * @param {Array<{ entity: string }>} zeilen
 * @returns {Record<string, number>} sorted by entity name
 */
export function zaehleEntitaeten(zeilen) {
  /** @type {Record<string, number>} */
  const z = {};
  for (const r of zeilen) z[r.entity] = (z[r.entity] || 0) + 1;
  return Object.fromEntries(Object.entries(z).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Differences between two reports (records per entity and objects per bucket).
 * @param {{ records: Record<string, number>, objekte: Record<string, number|null> }} a before
 * @param {{ records: Record<string, number>, objekte: Record<string, number|null> }} b after
 * @returns {string[]} one plain-text line per difference; empty = identical
 */
export function vergleicheBestand(a, b) {
  const zeilen = [];
  for (const bereich of /** @type {const} */ (['records', 'objekte'])) {
    const schluessel = new Set([...Object.keys(a[bereich] || {}), ...Object.keys(b[bereich] || {})]);
    for (const k of [...schluessel].sort()) {
      const va = a[bereich]?.[k] ?? 0;
      const vb = b[bereich]?.[k] ?? 0;
      if (va !== vb) zeilen.push(`${bereich} ${k}: ${va} → ${vb}`);
    }
  }
  return zeilen;
}

/**
 * Reads the connection; plain text names what is missing, values never printed.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ url: string, anon: string, email: string, passwort: string }}
 */
export function umgebungLesen(env = process.env) {
  const namen = ['BESTAND_URL', 'BESTAND_ANON', 'BESTAND_EMAIL', 'BESTAND_PASSWORT'];
  const fehlt = namen.filter((n) => !String(env[n] || '').trim());
  if (fehlt.length) throw new Error(`Umgebungsvariable fehlt: ${fehlt.join(', ')}.`);
  return { url: String(env.BESTAND_URL).trim(), anon: String(env.BESTAND_ANON).trim(), email: String(env.BESTAND_EMAIL).trim(), passwort: String(env.BESTAND_PASSWORT) };
}

/**
 * Counts everything visible to the signed-in client.
 * @param {any} client supabase-js client, signed in
 * @returns {Promise<{ records: Record<string, number>, objekte: Record<string, number|null>, orgs: number }>}
 */
export async function zaehlen(client) {
  const zeilen = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await client.from('records').select('id, entity').order('id').range(von, von + SEITE - 1);
    if (error) throw new Error(`records nicht lesbar: ${error.message}`);
    zeilen.push(...(data || []));
    if (!data || data.length < SEITE) break;
  }
  const { data: orgs, error: fo } = await client.from('org_members').select('org_id');
  if (fo) throw new Error(`Mitgliedschaften nicht lesbar: ${fo.message}`);
  /** @type {Record<string, number|null>} */
  const objekte = {};
  for (const bucket of ['blobs', 'freigaben', 'gebote']) {
    let summe = 0;
    let fehlt = false;
    for (const { org_id: org } of orgs || []) {
      const { data, error } = await client.storage.from(bucket).list(org, { limit: 10000 });
      if (error) { fehlt = true; break; }
      summe += (data || []).length;
    }
    objekte[bucket] = fehlt ? null : summe;
  }
  return { records: zaehleEntitaeten(zeilen), objekte, orgs: (orgs || []).length };
}

async function main(argv) {
  const iv = argv.indexOf('--vergleich');
  if (iv >= 0) {
    const [a, b] = [argv[iv + 1], argv[iv + 2]].map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
    const diff = vergleicheBestand(a, b);
    console.log(diff.length ? diff.join('\n') : 'Keine Abweichung je Entität und Bucket.');
    return diff.length ? 1 : 0;
  }
  const iz = argv.indexOf('--ziel');
  const ziel = iz >= 0 ? String(argv[iz + 1] || '') : '';
  if (!/^[a-z0-9-]{2,20}$/.test(ziel)) throw new Error('--ziel <name> fehlt (z. B. prod oder dev2).');
  const { url, anon, email, passwort } = umgebungLesen();
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: passwort });
  if (error) throw new Error(`Anmeldung fehlgeschlagen: ${error.message}`);
  try {
    const bericht = { erstellt: new Date().toISOString(), ziel, ...(await zaehlen(client)) };
    const datei = path.join(path.resolve(import.meta.dirname, '..'), '.planning', `bestand-${bericht.erstellt.slice(0, 10)}-${ziel}.json`);
    fs.writeFileSync(datei, `${JSON.stringify(bericht, null, 2)}\n`);
    const summe = Object.values(bericht.records).reduce((s, n) => s + n, 0);
    console.log(`${summe} Datensätze in ${Object.keys(bericht.records).length} Entitäten, ${bericht.orgs} Büro(s); Objekte: ${JSON.stringify(bericht.objekte)}`);
    console.log(`Bericht: ${datei}`);
  } finally {
    await client.auth.signOut();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`FEHLER: ${e?.message || e}`); process.exit(1); });
}
