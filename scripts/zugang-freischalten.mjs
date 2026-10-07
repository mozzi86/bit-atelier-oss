#!/usr/bin/env node
// Approves an access request for the cloud build (Plan 83-02): registration is
// open, approval is manual. The request arrives as an e-mail from /registrieren;
// the operator runs this script once per person.
//
// What it does, in this order, each step idempotent (a second run with the same
// arguments changes nothing):
//   1. user        — looks the e-mail up; if it does not exist yet, invites it
//                    with auth.admin.inviteUserByEmail (Supabase sends the mail
//                    with the sign-in link; the landing page /passwort-zuruecksetzen
//                    lets the person set a password). An existing user is reused.
//   2. office      — --org <uuid> uses an existing office; --neues-buero "<Name>"
//                    reuses an office of exactly that name or creates it.
//   3. membership  — writes org_members(user_id, org_id, role); an existing row
//                    with the same role is left alone, a different role is updated.
// --pruefen is a dry run: it reads, reports what would happen and writes nothing.
//
// Why a script and not a form endpoint: the RLS rules (supabase/migrations/
// 0002_rls.sql) deliberately forbid clients to create offices or memberships.
// The service-role key that bypasses them belongs on the operator's machine,
// never in a browser — so approval stays a deliberate manual step. No migration,
// no change to the Supabase settings is needed.
//
// In:  environment SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (only read from the
//      environment, never from a file, never printed), optional BIT_APP_URL
//      (address of the cloud app; sets the invitation's landing page);
//      arguments, see HILFE below.
// Out: a plain-text report on stdout; exit code 0 on success, 1 on any error
//      (message on stderr in plain German).
//
// Usage (PowerShell, values only for this session):
//   $env:SUPABASE_URL = "https://<projekt>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<secret key>"
//   node scripts/zugang-freischalten.mjs --email neu@buero.de --name "Vorname Name" --neues-buero "Büro Muster" --pruefen

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

/** Roles the database accepts (0001_orgs_records.sql: check role in ('admin','mitglied')). */
export const ROLLEN = Object.freeze(['mitglied', 'admin']);

/** Page size of the user lookup, in users per request (Supabase allows up to 1000). */
const SEITE = 1000;

const UUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const HILFE = `Zugang freischalten (Cloud) — scripts/zugang-freischalten.mjs

Aufruf:
  node scripts/zugang-freischalten.mjs --email <adresse> [--name "<Name>"]
       (--org <uuid> | --neues-buero "<Büroname>") [--rolle mitglied|admin] [--pruefen]

  --email        E-Mail-Adresse aus der Zugangsanfrage (Pflicht)
  --name         Name der Person (optional, landet im Konto als full_name)
  --org          ID eines bestehenden Büros (orgs.id)
  --neues-buero  Name eines neuen Büros; existiert genau ein Büro mit diesem Namen, wird es benutzt
  --rolle        mitglied (Standard) oder admin
  --pruefen      Probelauf: liest nur und sagt, was passieren würde
  --hilfe        diese Hilfe

Umgebung (nur in der Sitzung setzen, nie in eine Datei im Repo):
  SUPABASE_URL                 https://<projekt>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    Secret Key aus dem Supabase-Dashboard (Settings → API)
  BIT_APP_URL                  optional, Adresse der Cloud-App; die Einladung führt dann auf
                               <BIT_APP_URL>/passwort-zuruecksetzen?type=einladung (Passwort festlegen)`;

/**
 * Reads the connection from the environment. Throws a plain-text Error naming
 * the missing variable — the message never contains a key value.
 * @param {Record<string, string|undefined>} [env] process.env or a stub
 * @returns {{ url: string, schluessel: string, appUrl: string }} appUrl without trailing slash, '' when unset
 */
export function umgebungLesen(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const schluessel = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const fehlt = [];
  if (!url) fehlt.push('SUPABASE_URL');
  if (!schluessel) fehlt.push('SUPABASE_SERVICE_ROLE_KEY');
  if (fehlt.length) {
    throw new Error(
      `Umgebungsvariable fehlt: ${fehlt.join(', ')}. In PowerShell nur für diese Sitzung setzen, `
      + 'z. B. $env:SUPABASE_SERVICE_ROLE_KEY = "<Secret Key aus Supabase → Settings → API>". '
      + 'Der Schlüssel gehört nie in eine Datei im Repo.',
    );
  }
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('SUPABASE_URL ist keine http(s)-Adresse.');
  const appUrl = String(env.BIT_APP_URL || '').trim().replace(/\/+$/, '');
  if (appUrl && !/^https?:\/\/[^\s]+$/.test(appUrl)) throw new Error('BIT_APP_URL ist keine http(s)-Adresse.');
  return { url, schluessel, appUrl };
}

/**
 * Parses the arguments. Throws a plain-text Error on anything invalid.
 * @param {string[]} argv arguments after the script name
 * @returns {{ hilfe: boolean, email: string, name: string, orgId: string, neuesBuero: string,
 *   rolle: 'mitglied'|'admin', pruefen: boolean }}
 */
export function argsLesen(argv) {
  const o = { hilfe: false, email: '', name: '', orgId: '', neuesBuero: '', rolle: 'mitglied', pruefen: false };
  /** @param {number} i @param {string} name @returns {string} */
  const wert = (i, name) => {
    const w = argv[i + 1];
    if (w === undefined || w.startsWith('--')) throw new Error(`${name} braucht einen Wert.`);
    return w;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--hilfe' || a === '--help' || a === '-h') o.hilfe = true;
    else if (a === '--email') { o.email = wert(i, a).trim(); i += 1; }
    else if (a === '--name') { o.name = wert(i, a).trim(); i += 1; }
    else if (a === '--org') { o.orgId = wert(i, a).trim(); i += 1; }
    else if (a === '--neues-buero') { o.neuesBuero = wert(i, a).trim(); i += 1; }
    else if (a === '--rolle') { o.rolle = /** @type {any} */ (wert(i, a).trim()); i += 1; }
    else if (a === '--pruefen') o.pruefen = true;
    else throw new Error(`Unbekanntes Argument: ${a} (Hilfe: --hilfe).`);
  }
  if (o.hilfe) return o;
  if (!EMAIL_MUSTER.test(o.email)) throw new Error('--email fehlt oder ist keine gültige E-Mail-Adresse.');
  if (Boolean(o.orgId) === Boolean(o.neuesBuero)) {
    throw new Error('Genau eines angeben: --org <uuid> (bestehendes Büro) oder --neues-buero "<Name>".');
  }
  if (o.orgId && !UUID_MUSTER.test(o.orgId)) throw new Error(`--org ist keine UUID: ${o.orgId}`);
  if (!ROLLEN.includes(o.rolle)) throw new Error(`--rolle muss ${ROLLEN.join(' oder ')} sein, nicht "${o.rolle}".`);
  return o;
}

/**
 * Finds an auth user by e-mail (case-insensitive) through the admin API, page by page.
 * @param {any} client Supabase client with service-role key
 * @param {string} email
 * @returns {Promise<{id: string, email: string}|null>}
 */
export async function nutzerSuchen(client, email) {
  const ziel = email.toLowerCase();
  for (let seite = 1; seite <= 100; seite += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page: seite, perPage: SEITE });
    if (error) throw new Error(`Nutzerliste nicht lesbar: ${error.message}`);
    const nutzer = data?.users || [];
    const treffer = nutzer.find((u) => String(u.email || '').toLowerCase() === ziel);
    if (treffer) return treffer;
    if (nutzer.length < SEITE) return null;
  }
  throw new Error('Mehr als 100 Seiten Nutzer — Suche abgebrochen.');
}

/**
 * Throws a plain-text Error for a failed PostgREST call.
 * @param {{message?: string}|null} error
 * @param {string} was what was being done, German
 */
function pruefeFehler(error, was) {
  if (error) throw new Error(`${was} fehlgeschlagen: ${error.message || String(error)}`);
}

/**
 * Report of one run. Values are German status words, printed as they are.
 * @typedef {{ nutzer: string, nutzerId: string|null, org: string, orgId: string|null,
 *   orgName: string, mitgliedschaft: string, geaendert: boolean }} FreischaltBericht
 */

/**
 * Runs the three steps (user, office, membership). Idempotent; with
 * `pruefen: true` it calls no write method of the client at all.
 * @param {any} client Supabase client with service-role key (or a test stub)
 * @param {{ email: string, name?: string, orgId?: string, neuesBuero?: string,
 *   rolle: 'mitglied'|'admin', pruefen?: boolean, weiterleitung?: string }} optionen
 *   weiterleitung: landing URL of the invitation mail, or '' for the Supabase site URL
 * @returns {Promise<FreischaltBericht>}
 */
export async function freischalten(client, optionen) {
  const { email, name = '', orgId = '', neuesBuero = '', rolle, pruefen = false, weiterleitung = '' } = optionen;
  /** @type {FreischaltBericht} */
  const bericht = { nutzer: '', nutzerId: null, org: '', orgId: null, orgName: '', mitgliedschaft: '', geaendert: false };

  // 1. User — look up first, so a second run never sends a second invitation.
  let nutzer = await nutzerSuchen(client, email);
  if (nutzer) {
    bericht.nutzer = 'vorhanden';
  } else if (pruefen) {
    bericht.nutzer = 'würde eingeladen';
  } else {
    const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
      data: name ? { full_name: name } : undefined,
      redirectTo: weiterleitung || undefined,
    });
    if (error) {
      // Registered between lookup and invitation (second operator, retry): reuse it.
      if (error.code === 'email_exists' || /already (been )?registered/i.test(error.message || '')) {
        nutzer = await nutzerSuchen(client, email);
        if (!nutzer) throw new Error(`Einladung abgelehnt („${error.message}“), Nutzer aber nicht auffindbar.`);
        bericht.nutzer = 'vorhanden';
      } else {
        throw new Error(`Einladung fehlgeschlagen: ${error.message}`);
      }
    } else {
      nutzer = data?.user || null;
      if (!nutzer?.id) throw new Error('Einladung ohne Nutzer-ID beantwortet — bitte im Dashboard prüfen.');
      bericht.nutzer = 'eingeladen';
      bericht.geaendert = true;
    }
  }
  bericht.nutzerId = nutzer?.id || null;

  // 2. Office.
  /** @type {{id: string, name: string}|null} */
  let org = null;
  if (orgId) {
    const { data, error } = await client.from('orgs').select('id, name').eq('id', orgId).maybeSingle();
    pruefeFehler(error, 'Büro lesen');
    if (!data) throw new Error(`Ein Büro mit der ID ${orgId} gibt es nicht.`);
    org = data;
    bericht.org = 'vorhanden';
  } else {
    const { data, error } = await client.from('orgs').select('id, name').eq('name', neuesBuero);
    pruefeFehler(error, 'Büros lesen');
    const treffer = Array.isArray(data) ? data : [];
    if (treffer.length > 1) {
      throw new Error(`Mehrere Büros heißen „${neuesBuero}“ (${treffer.map((o) => o.id).join(', ')}) — bitte --org <id> angeben.`);
    }
    if (treffer.length === 1) {
      org = treffer[0];
      bericht.org = 'vorhanden';
    } else if (pruefen) {
      bericht.org = 'würde angelegt';
    } else {
      const neu = await client.from('orgs').insert({ name: neuesBuero }).select('id, name').single();
      pruefeFehler(neu.error, 'Büro anlegen');
      org = neu.data;
      bericht.org = 'angelegt';
      bericht.geaendert = true;
    }
  }
  bericht.orgId = org?.id || null;
  bericht.orgName = org?.name || neuesBuero;

  // 3. Membership — without user or office (dry run) it can only be "would create".
  if (!nutzer || !org) {
    bericht.mitgliedschaft = `würde angelegt (${rolle})`;
    return bericht;
  }
  const { data: zeile, error } = await client.from('org_members')
    .select('role').eq('user_id', nutzer.id).eq('org_id', org.id).maybeSingle();
  pruefeFehler(error, 'Mitgliedschaft lesen');
  if (!zeile) {
    if (pruefen) {
      bericht.mitgliedschaft = `würde angelegt (${rolle})`;
    } else {
      const neu = await client.from('org_members').insert({ user_id: nutzer.id, org_id: org.id, role: rolle });
      pruefeFehler(neu.error, 'Mitgliedschaft anlegen');
      bericht.mitgliedschaft = `angelegt (${rolle})`;
      bericht.geaendert = true;
    }
  } else if (zeile.role === rolle) {
    bericht.mitgliedschaft = `vorhanden (${rolle})`;
  } else if (pruefen) {
    bericht.mitgliedschaft = `Rolle würde geändert: ${zeile.role} → ${rolle}`;
  } else {
    const neu = await client.from('org_members').update({ role: rolle }).eq('user_id', nutzer.id).eq('org_id', org.id);
    pruefeFehler(neu.error, 'Rolle ändern');
    bericht.mitgliedschaft = `Rolle geändert: ${zeile.role} → ${rolle}`;
    bericht.geaendert = true;
  }
  return bericht;
}

/**
 * The report as printable lines.
 * @param {FreischaltBericht} b
 * @param {{ email: string, pruefen?: boolean }} o
 * @returns {string[]}
 */
export function berichtZeilen(b, o) {
  return [
    o.pruefen ? 'PROBELAUF — es wurde nichts geschrieben.' : 'Freischaltung',
    `Nutzer          : ${o.email} — ${b.nutzer}${b.nutzerId ? ` (${b.nutzerId})` : ''}`,
    `Büro            : ${b.orgName || '—'} — ${b.org}${b.orgId ? ` (${b.orgId})` : ''}`,
    `Mitgliedschaft  : ${b.mitgliedschaft}`,
    o.pruefen ? '' : (b.geaendert ? 'Ergebnis        : geändert' : 'Ergebnis        : nichts zu tun (bereits freigeschaltet)'),
  ].filter(Boolean);
}

async function main() {
  const optionen = argsLesen(process.argv.slice(2));
  if (optionen.hilfe) {
    console.log(HILFE);
    return;
  }
  const { url, schluessel, appUrl } = umgebungLesen();
  // The service-role key bypasses RLS — that is the point of this script. It is
  // passed to the client only and never printed; the log shows the host alone.
  const client = createClient(url, schluessel, { auth: { autoRefreshToken: false, persistSession: false } });
  const weiterleitung = appUrl ? `${appUrl}/passwort-zuruecksetzen?type=einladung` : '';
  console.log(`Projekt: ${new URL(url).host}${weiterleitung ? ` · Einladung führt auf ${weiterleitung}` : ' · Einladung führt auf die Site URL des Projekts'}`);
  const bericht = await freischalten(client, { ...optionen, weiterleitung });
  for (const zeile of berichtZeilen(bericht, optionen)) console.log(zeile);
}

// Run only when executed directly — the unit tests import the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`FEHLER: ${err?.message || err}`);
    process.exit(1);
  });
}
