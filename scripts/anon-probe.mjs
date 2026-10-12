#!/usr/bin/env node
// Anonymous probe against the cloud project (57-06 Task 8) - READ ONLY.
//
// The claim "anonymous access is excluded" rests on the files: 0005_grants.sql
// gives anon nothing but `usage on schema public`, no `grant … on table` names
// anon, every policy reads `to authenticated`. That class of claim was wrong
// once already - 0005 exists because default privileges did not apply when
// `db push` ran under another role. So this script measures instead of
// believing: it calls PostgREST with the publishable key and NO session, the
// exact position of any visitor of the public app.
//
// Expected: an ERROR for every table and for rpc/ist_mitglied - not "0 rows".
// The difference matters and is reported apart:
//   verweigert  (PASS) no grant for anon - nothing to filter, nothing to see
//   0 Zeilen    (WARN) anon has a grant and only RLS stands in between; one
//                      wrong policy later and rows leak
//   sichtbar    (FAIL) rows came back - anonymous read access
// Optional `--signup <adresse>`: POST /auth/v1/signup with an address on a
// domain the operator owns. Expected: refused ("Signups not allowed"). If the
// dashboard switch "Allow new users to sign up" is on, an account is created -
// FAIL, with the address so the operator deletes it (this script has no
// service key and deletes nothing). Without --signup nothing at all is written.
//
// Allowed against the live project on purpose and therefore WITHOUT the prod
// lock of scripts/supabase-rls-check.mjs (which creates and deletes users and
// keeps its lock): this one only reads, with a key that ships in every page.
//
// In:  SUPABASE_URL + SUPABASE_ANON_KEY, or VITE_SUPABASE_URL +
//      VITE_SUPABASE_ANON_KEY (same values the cloud build uses).
// Out: one line per probe; exit 0 = no FAIL, 1 = at least one FAIL or a
//      configuration error.
//
// Usage (PowerShell):
//   node --env-file=.env scripts/anon-probe.mjs
//   node --env-file=.env scripts/anon-probe.mjs --signup probe-2026-10@bit-atelier.de

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

/** Tables of the public schema the probe reads (57-01 migrations 0001 + 0004). */
export const TABELLEN = Object.freeze(['records', 'orgs', 'org_members', 'llm_connections']);

/**
 * Connection from the environment; plain-text error naming what is missing.
 * The key is never printed.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ url: string, anon: string }}
 */
export function umgebungLesen(env = process.env) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anon = String(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  const fehlt = [];
  if (!url) fehlt.push('SUPABASE_URL (oder VITE_SUPABASE_URL)');
  if (!anon) fehlt.push('SUPABASE_ANON_KEY (oder VITE_SUPABASE_ANON_KEY)');
  if (fehlt.length) throw new Error(`Umgebungsvariable fehlt: ${fehlt.join(', ')}.`);
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('SUPABASE_URL ist keine http(s)-Adresse.');
  return { url, anon };
}

/**
 * Classifies one PostgREST answer.
 * @param {number} status HTTP status
 * @param {unknown} body parsed JSON body (array for a select, object for an error)
 * @returns {{ urteil: 'PASS'|'WARN'|'FAIL', text: string }}
 */
export function bewerteTabelle(status, body) {
  if (status >= 400) {
    const code = /** @type {any} */ (body)?.code || '';
    return { urteil: 'PASS', text: `verweigert (HTTP ${status}${code ? `, ${code}` : ''})` };
  }
  if (Array.isArray(body) && body.length === 0) {
    return { urteil: 'WARN', text: '0 Zeilen — anon hat einen Grant, nur RLS filtert' };
  }
  const n = Array.isArray(body) ? body.length : 1;
  return { urteil: 'FAIL', text: `${n} Zeile(n) sichtbar — anonymer Lesezugriff` };
}

/**
 * Classifies the rpc answer: an error is expected; `false` means anon may call it.
 * @param {number} status
 * @param {unknown} body
 * @returns {{ urteil: 'PASS'|'WARN'|'FAIL', text: string }}
 */
export function bewerteRpc(status, body) {
  if (status >= 400) return { urteil: 'PASS', text: `verweigert (HTTP ${status})` };
  if (body === false) return { urteil: 'WARN', text: 'aufrufbar (liefert false) — Execute-Grant für anon prüfen' };
  return { urteil: 'FAIL', text: `aufrufbar, Antwort ${JSON.stringify(body)}` };
}

/**
 * Classifies the signup answer.
 * @param {number} status
 * @param {unknown} body
 * @param {string} adresse the probe address, named in the FAIL text
 * @returns {{ urteil: 'PASS'|'FAIL', text: string }}
 */
export function bewerteSignup(status, body, adresse) {
  if (status >= 400) {
    const grund = /** @type {any} */ (body)?.msg || /** @type {any} */ (body)?.message || /** @type {any} */ (body)?.error_code || '';
    return { urteil: 'PASS', text: `abgelehnt (HTTP ${status}${grund ? `: ${grund}` : ''})` };
  }
  return {
    urteil: 'FAIL',
    text: `Selbstregistrierung ist AN — Konto „${adresse}“ wurde angelegt. Im Dashboard unter Authentication → Users löschen `
      + 'und unter Authentication → Providers → Email „Allow new users to sign up“ ausschalten.',
  };
}

/**
 * Runs all probes with an injectable fetch (tests pass a stub).
 * @param {{ url: string, anon: string }} verbindung
 * @param {{ signup?: string, fetchFn?: typeof fetch }} [o]
 * @returns {Promise<Array<{ probe: string, urteil: 'PASS'|'WARN'|'FAIL', text: string }>>}
 */
export async function probeLaufen({ url, anon }, { signup = '', fetchFn = fetch } = {}) {
  const kopf = { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };
  /** @param {Response} r */
  const lies = async (r) => {
    const t = await r.text();
    try { return t ? JSON.parse(t) : null; } catch { return t; }
  };
  const ergebnisse = [];
  for (const t of TABELLEN) {
    const r = await fetchFn(`${url}/rest/v1/${t}?select=*&limit=5`, { headers: kopf });
    ergebnisse.push({ probe: `GET /rest/v1/${t}`, ...bewerteTabelle(r.status, await lies(r)) });
  }
  const rpc = await fetchFn(`${url}/rest/v1/rpc/ist_mitglied`, {
    method: 'POST', headers: kopf, body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000' }),
  });
  ergebnisse.push({ probe: 'POST /rest/v1/rpc/ist_mitglied', ...bewerteRpc(rpc.status, await lies(rpc)) });
  if (signup) {
    // Random password: should the switch be on, nobody can sign in with it.
    const passwort = crypto.randomBytes(24).toString('base64url');
    const s = await fetchFn(`${url}/auth/v1/signup`, {
      method: 'POST', headers: kopf, body: JSON.stringify({ email: signup, password: passwort }),
    });
    ergebnisse.push({ probe: 'POST /auth/v1/signup', ...bewerteSignup(s.status, await lies(s), signup) });
  }
  return ergebnisse;
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--signup');
  const signup = i >= 0 ? String(argv[i + 1] || '') : '';
  if (i >= 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signup)) throw new Error('--signup braucht eine E-Mail-Adresse auf einer eigenen Domain.');
  const verbindung = umgebungLesen();
  console.log(`Projekt: ${new URL(verbindung.url).host} · anonym, ohne Sitzung · nur lesend${signup ? ' (plus Signup-Probe)' : ''}`);
  const ergebnisse = await probeLaufen(verbindung, { signup });
  for (const e of ergebnisse) console.log(`[${e.urteil}] ${e.probe.padEnd(32)} ${e.text}`);
  const fail = ergebnisse.filter((e) => e.urteil === 'FAIL').length;
  const warn = ergebnisse.filter((e) => e.urteil === 'WARN').length;
  console.log(`Ergebnis: ${ergebnisse.length - fail - warn} PASS, ${warn} WARN, ${fail} FAIL`);
  return fail ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => process.exit(c), (e) => { console.error(`FEHLER: ${e?.message || e}`); process.exit(1); });
}
