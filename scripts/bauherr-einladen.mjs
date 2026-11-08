// bauherr-einladen.mjs — invites a client ("Bauherr") to ONE project and prints
// the invitation link instead of mailing it (Phase 110-04, 06.11.2026).
//
// Why a script and not the edge function `einladung`: the function is not
// deployed yet, and Supabase's built-in mail server only delivers to members
// of the Supabase team — an invitation mail to a client would not arrive. The
// office sends the printed link itself (mail, messenger). The client opens it,
// sets an own password on /passwort-zuruecksetzen?type=einladung and signs in
// with e-mail + password from then on.
//
// What it writes (service role, bypasses RLS — therefore only with --ja-prod):
//   auth user (through generateLink 'invite'; an existing account gets a
//   'recovery' link instead), org_members with the FIXED client rights of
//   zugriffRegeln.mitgliedschaftFuerExterne('bauherr'), projekt_zugang for the
//   one project, and a log entry 'einladung'. An internal member of the office
//   is never turned into a client (einladungErlaubt).
//
// Usage (PowerShell, in the app folder, .env with SUPABASE_URL_PROD and
// SUPABASE_SERVICE_PROD):
//   node --env-file=.env scripts/bauherr-einladen.mjs --email kunde@example.de --projekt <records.id> --org <uuid> --ja-prod
//   optional: --weiterleitung https://…/passwort-zuruecksetzen?type=einladung
//
// The printed link is a key to the account until used — send it to the client
// only, do not paste it anywhere else.

import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { einladungErlaubt, einladungPruefen, mitgliedschaftFuerExterne } from '../supabase/functions/_shared/zugriffRegeln.js';

/** Default landing page of the link: set a password, then into the portal. */
export const STANDARD_WEITERLEITUNG = 'https://bit-atelier.pages.dev/passwort-zuruecksetzen?type=einladung';

/**
 * Reads and checks the command line. Validation of org/email/project is the
 * same as the edge function's (einladungPruefen), role fixed to bauherr.
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ ok: true, daten: { orgId: string, email: string, projektId: string, weiterleitung: string, jaProd: boolean } }
 *   | { ok: false, fehler: string }}
 */
export function argumenteLesen(argv) {
  /** @type {Record<string, string|boolean>} */
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) return { ok: false, fehler: `Unbekanntes Argument: ${k}` };
    const name = k.slice(2);
    if (name === 'ja-prod') { a[name] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { ok: false, fehler: `Wert fehlt für ${k}` };
    a[name] = v;
    i += 1;
  }
  const p = einladungPruefen({ aktion: 'einladen', org_id: a.org, email: a.email, rolle: 'bauherr', projekt_id: a.projekt });
  if (!p.ok) return { ok: false, fehler: p.fehler };
  const weiterleitung = typeof a.weiterleitung === 'string' ? a.weiterleitung : STANDARD_WEITERLEITUNG;
  if (!/^https:\/\/[^\s]+$/.test(weiterleitung)) return { ok: false, fehler: 'weiterleitung muss eine https-Adresse sein.' };
  return { ok: true, daten: { orgId: p.daten.orgId, email: p.daten.email, projektId: p.daten.projektId, weiterleitung, jaProd: a['ja-prod'] === true } };
}

/**
 * Runs the invitation.
 * @param {{ orgId: string, email: string, projektId: string, weiterleitung: string }} d
 * @param {import('@supabase/supabase-js').SupabaseClient} admin service-role client
 * @returns {Promise<{ link: string, nutzerId: string, neu: boolean, projektName: string }>}
 * @throws {Error} plain text on every refusal or failed write
 */
export async function einladen(d, admin) {
  const { data: projekt, error: pf } = await admin.from('records').select('id, data')
    .eq('org_id', d.orgId).eq('entity', 'Project').eq('id', d.projektId).maybeSingle();
  if (pf) throw new Error(`Projekt nicht lesbar: ${pf.message}`);
  if (!projekt) throw new Error(`Projekt ${d.projektId} gibt es in diesem Büro nicht.`);

  let neu = true;
  let r = await admin.auth.admin.generateLink({ type: 'invite', email: d.email, options: { redirectTo: d.weiterleitung } });
  if (r.error && /already|registered|exists/i.test(r.error.message)) {
    // Existing account: a recovery link lands on the same password page.
    neu = false;
    r = await admin.auth.admin.generateLink({ type: 'recovery', email: d.email, options: { redirectTo: d.weiterleitung.replace('type=einladung', 'type=recovery') } });
  }
  if (r.error || !r.data?.user?.id || !r.data?.properties?.action_link) {
    throw new Error(`Einladelink nicht erzeugt: ${r.error?.message || 'keine Antwort'}`);
  }
  const nutzerId = r.data.user.id;

  const { data: bestehend, error: mf } = await admin.from('org_members').select('role')
    .eq('user_id', nutzerId).eq('org_id', d.orgId).maybeSingle();
  if (mf) throw new Error(`Mitgliedschaft nicht lesbar: ${mf.message}`);
  const erlaubt = einladungErlaubt(bestehend);
  if (!erlaubt.ok) throw new Error(erlaubt.grund || 'Nicht erlaubt.');

  const m = await admin.from('org_members').upsert({
    user_id: nutzerId, org_id: d.orgId, ...mitgliedschaftFuerExterne('bauherr'), eingeladen_am: new Date().toISOString(),
  }, { onConflict: 'user_id,org_id' });
  if (m.error) throw new Error(`Mitgliedschaft nicht geschrieben: ${m.error.message}`);
  const z = await admin.from('projekt_zugang').upsert({
    org_id: d.orgId, user_id: nutzerId, projekt_id: d.projektId, rolle: 'bauherr',
  }, { onConflict: 'org_id,user_id,projekt_id' });
  if (z.error) throw new Error(`Projektzugang nicht geschrieben: ${z.error.message}`);

  const p = await admin.rpc('protokoll_schreiben', {
    p_org: d.orgId, p_projekt: d.projektId, p_aktion: 'einladung', p_entity: 'org_members', p_record: nutzerId,
    p_detail: { rolle: 'bauherr', neu_eingeladen: neu, weg: 'skript' }, p_akteur: null,
  });
  if (p.error) console.warn(`Hinweis: Protokolleintrag nicht geschrieben (${p.error.message}) — Zugang ist trotzdem angelegt.`);

  return { link: r.data.properties.action_link, nutzerId, neu, projektName: String(projekt.data?.name || d.projektId) };
}

async function main() {
  const a = argumenteLesen(process.argv.slice(2));
  if (!a.ok) { console.error(`FEHLER: ${a.fehler}`); process.exit(1); }
  if (!a.daten.jaProd) {
    console.error('ABBRUCH: Schreibt in die Live-Datenbank — nur mit --ja-prod.');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL_PROD;
  const key = process.env.SUPABASE_SERVICE_PROD;
  if (!url || !key) { console.error('FEHLER: SUPABASE_URL_PROD oder SUPABASE_SERVICE_PROD fehlt in .env.'); process.exit(1); }
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const e = await einladen(a.daten, admin);
    console.log(`Bauherr ${a.daten.email} hat Zugang zu: ${e.projektName} (nur dieses Projekt).`);
    console.log(e.neu ? 'Neues Konto angelegt.' : 'Konto bestand schon — Link zum Passwort-Setzen erzeugt.');
    console.log('\nEINLADELINK (nur an den Bauherrn schicken, gilt bis zur ersten Nutzung):\n');
    console.log(e.link);
    console.log('\nDer Bauherr öffnet den Link, legt sein Passwort fest und meldet sich danach mit E-Mail + Passwort an.');
  } catch (err) {
    console.error(`FEHLER: ${/** @type {any} */ (err)?.message || err}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
