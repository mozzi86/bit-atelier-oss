#!/usr/bin/env node
// Privilege matrix check (Phase 74-01 Task 9, case A-42) — READ ONLY.
//
// The outer gate (grants) and the inner gate (RLS) must agree. The trap this
// catches: 0005_grants.sql:28-29 gave every NEW table full DML for
// authenticated and every new function EXECUTE for PUBLIC (0014 closes that).
// One forgotten revoke in a future migration opens a table or publishes a
// function as RPC — silently. This script asks the database what anon and
// authenticated may actually do (public.grants_bericht(), 0014, service role
// only) and compares with the SOLL list below. Every extra right AND every
// missing right is a deviation. Exit 1 on any — fit for a nightly run.
//
// In:  GRANTS_URL, GRANTS_SERVICE (secret key; read only, never printed).
// Out: deviation lines; exit 0 = matrix as intended, 1 = deviation/error.
//
// Usage:  node --env-file=.env scripts/grants-pruefen.mjs
//
// When a migration intentionally grants something new, the SOLL list here is
// changed in the same commit — that is the point: a grant is a decision.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Functions authenticated may execute (0002/0005/0006-0013, re-granted in 0014). */
const FUNKTIONEN_AUTHENTICATED = [
  'ist_mitglied(p_org uuid)',
  'rolle_in(p_org uuid)', 'ist_intern(p_org uuid)', 'ist_extern(p_org uuid)',
  'hat_recht(p_org uuid, p_flag text)', 'mein_kontakt(p_org uuid)', 'ist_dienst()',
  'darf_projekt(p_org uuid, p_projekt text)', 'darf_vergabe(p_org uuid, p_vergabe text)',
  'entity_bereich(p_entity text)', 'entity_extern(p_entity text)', 'entity_modell(p_entity text)',
  'inhalt_hash(p_data jsonb)',
  'submission_laeuft(p_org uuid, p_vergabe text)', 'submission_offen(p_org uuid, p_vergabe text)',
  'tender_hat_submission(p_org uuid, p_tender text)',
  'submission_anlegen(p_tender text, p_frist timestamp with time zone)',
  'submission_frist(p_tender text, p_neu timestamp with time zone, p_grund text)',
  'submission_oeffnen(p_tender text)', 'gebot_zuruecknehmen(p_id text)', 'zuschlag_erteilen(p_tender text, p_bid text)',
  'protokoll_hash(p_vorher text, p_ts timestamp with time zone, p_id bigint, p_org uuid, p_projekt text, p_akteur uuid, p_aktion text, p_entity text, p_record text, p_detail jsonb)',
  'protokoll_kette_pruefen(p_org uuid)', 'warum_sichtbar(p_id text)',
  'freigabe_erteilen(p_tender text, p_modell text, p_ansicht text)', 'freigabe_zuruecknehmen(p_tender text)',
  'rueckfrage_beantworten(p_tender text, p_frage text, p_antwort text)',
  'als_uuid(p text)', 'blob_ist_modell(p_org uuid, p_name text)',
  'set_updated_date()',
];

/**
 * The intended matrix: every granted (role, kind, object, right) for anon and
 * authenticated. anon: nothing at all.
 * @type {ReadonlyArray<string>}
 */
export const SOLL = Object.freeze([
  ...['orgs', 'org_members', 'records', 'projekt_zugang', 'vergabe_teilnehmer', 'entity_regeln', 'submission']
    .map((t) => `authenticated|table|${t}|SELECT`),
  'authenticated|view|zugriffsprotokoll_sicht|SELECT',
  'authenticated|table|records|DELETE',
  ...['id', 'entity', 'org_id', 'data', 'created_by'].map((s) => `authenticated|column|records.${s}|INSERT`),
  'authenticated|column|records.data|UPDATE',
  ...FUNKTIONEN_AUTHENTICATED.map((f) => `authenticated|function|${f}|EXECUTE`),
]);

/**
 * Compares the actual matrix with SOLL.
 * Function signatures are compared by name and argument TYPES only (the
 * argument names in pg_get_function_identity_arguments depend on the
 * definition and are not part of the right).
 * @param {Array<{ rolle: string, art: string, objekt: string, recht: string }>} ist rows of grants_bericht()
 * @param {ReadonlyArray<string>} [soll]
 * @returns {{ zuviel: string[], fehlt: string[] }}
 */
export function vergleicheGrants(ist, soll = SOLL) {
  const norm = (k) => {
    const [rolle, art, objekt, recht] = k.split('|');
    if (art !== 'function') return k;
    const m = /^([a-z_]+)\((.*)\)$/.exec(objekt);
    if (!m) return k;
    const typen = m[2].split(',').map((a) => a.trim()).filter(Boolean)
      .map((a) => a.replace(/^(?:IN\s+)?[a-z_]+\s+(?=\S)/i, '').replace(/\s+DEFAULT\s.*$/i, '')).join(', ');
    return `${rolle}|${art}|${m[1]}(${typen})|${recht}`;
  };
  const istSet = new Set(ist.map((r) => norm(`${r.rolle}|${r.art}|${r.objekt}|${r.recht}`)));
  const sollSet = new Set(soll.map(norm));
  return {
    zuviel: [...istSet].filter((k) => !sollSet.has(k)).sort(),
    fehlt: [...sollSet].filter((k) => !istSet.has(k)).sort(),
  };
}

async function main() {
  const url = String(process.env.GRANTS_URL || '').trim();
  const key = String(process.env.GRANTS_SERVICE || '').trim();
  if (!url || !key) throw new Error('Umgebungsvariable fehlt: GRANTS_URL und GRANTS_SERVICE (Secret Key).');
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc('grants_bericht');
  if (error) throw new Error(`grants_bericht nicht abrufbar (Migration 0014 eingespielt?): ${error.message}`);
  const { zuviel, fehlt } = vergleicheGrants(data || []);
  for (const z of zuviel) console.log(`ZU VIEL  ${z}`);
  for (const f of fehlt) console.log(`FEHLT    ${f}`);
  console.log(zuviel.length || fehlt.length
    ? `${zuviel.length} Recht(e) zu viel, ${fehlt.length} fehlen — Abweichung.`
    : `Rechte-Matrix wie vorgesehen (${(data || []).length} Einträge).`);
  return zuviel.length || fehlt.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => process.exit(c), (e) => { console.error(`FEHLER: ${e?.message || e}`); process.exit(1); });
}
