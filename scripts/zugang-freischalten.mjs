#!/usr/bin/env node
// Approves an access request for the cloud build (Plan 83-02, hardened in 57-06
// Task 6): registration is open, approval is manual. The request arrives as an
// e-mail from /registrieren; the operator runs this script once per person.
//
// Order of a run - everything is READ first, then written, so an abort (unknown
// office, unknown address, two offices of one name) never leaves half an
// approval behind (an invited account without membership):
//   1. office      - --org <uuid> must exist (else: abort with the office list);
//                    --neues-buero "<Name>" reuses an office of exactly that name
//                    or creates it later.
//   2. user        - looks the e-mail up, page by page. NOT FOUND IS THE SPECIAL
//                    CASE: without --neues-konto the run aborts and spells the
//                    address out. A typo (meyr@ vs. mayr@) would otherwise invite
//                    a stranger into the office that holds all office records.
//   3. visibility  - counts the records of the office BEFORE anything is written:
//                    "after approval this person sees N records". That is the
//                    line that shows a wrong office while it is still harmless.
//   4. writes      - invitation (only with --neues-konto), office, membership
//                    (new / role changed / unchanged = no write). Every write is
//                    counted; the last line is "Schreibvorgaenge: N". A second run
//                    with the same arguments reports 0.
// --pruefen is a dry run: it reads, reports what would happen and writes nothing.
// --orgs lists the offices (id, name, members) and writes nothing.
// --entziehen deletes the membership only, and says out loud what stays.
//
// Deviation from 57-06-PLAN Task 6 (kept from 83-02 on purpose): the real run is
// the default and the dry run is --pruefen, because docs/BETRIEB.md and the
// operator already work that way; the plan's --ausfuehren would flip a habit.
// The dangerous step - creating an account - needs its own flag instead.
//
// Why a script and not a form endpoint: the RLS rules (supabase/migrations/
// 0002_rls.sql) deliberately forbid clients to create offices or memberships.
// The service-role key that bypasses them belongs on the operator's machine,
// never in a browser - so approval stays a deliberate manual step.
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
//   node scripts/zugang-freischalten.mjs --orgs
//   node scripts/zugang-freischalten.mjs --email neu@buero.de --org <uuid> --neues-konto --pruefen

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

/** Roles the database accepts today (0001_orgs_records.sql: check role in ('admin','mitglied')). */
export const ROLLEN = Object.freeze(['mitglied', 'admin']);

/**
 * After migration 0006 (Phase 74-01) the database stores owner/planner; its
 * BEFORE trigger translates admin/mitglied on write. Reading back, `planner`
 * therefore IS `mitglied` — without this a second run would report a role
 * change every time and never reach "Schreibvorgaenge: 0".
 * @type {Readonly<Record<string, string>>}
 */
const ROLLE_NACH_0006 = Object.freeze({ admin: 'owner', mitglied: 'planner' });

/**
 * Same role, old or new vocabulary.
 * @param {string} gespeichert role as read from org_members
 * @param {string} gewuenscht role from --rolle (admin|mitglied)
 * @returns {boolean}
 */
export function rolleGleich(gespeichert, gewuenscht) {
  return gespeichert === gewuenscht || gespeichert === ROLLE_NACH_0006[gewuenscht];
}

/** Page size of the user lookup, in users per request (Supabase allows up to 1000). */
const SEITE = 1000;

/** Upper bound of the visibility probe, in rows. Far above the 237 office rows of 20.09.2026. */
const SICHT_GRENZE = 10000;

const UUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const HILFE = `Zugang freischalten (Cloud) — scripts/zugang-freischalten.mjs

Aufruf:
  node scripts/zugang-freischalten.mjs --orgs
  node scripts/zugang-freischalten.mjs --email <adresse> [--name "<Name>"]
       (--org <uuid> | --neues-buero "<Büroname>") [--rolle mitglied|admin] [--neues-konto] [--pruefen]
  node scripts/zugang-freischalten.mjs --email <adresse> --org <uuid> --entziehen [--pruefen]

  --orgs         nur auflisten: alle Büros mit ID, Name und Zahl der Mitglieder
  --email        E-Mail-Adresse aus der Zugangsanfrage (Pflicht)
  --name         Name der Person (optional, landet im Konto als full_name)
  --org          ID eines bestehenden Büros (orgs.id; siehe --orgs)
  --neues-buero  Name eines neuen Büros; existiert genau ein Büro mit diesem Namen, wird es benutzt
  --rolle        mitglied (Standard) oder admin
  --neues-konto  erlaubt, für eine noch unbekannte Adresse ein Konto anzulegen (Einladung).
                 Ohne diese Angabe bricht der Lauf ab, wenn es die Adresse nicht gibt —
                 Schutz gegen Tippfehler in der Adresse.
  --entziehen    Mitgliedschaft löschen (nur sie; Konto, Daten und Sicherungen bleiben)
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
 * @typedef {{ hilfe: boolean, orgs: boolean, entziehen: boolean, neuesKonto: boolean,
 *   email: string, name: string, orgId: string, neuesBuero: string,
 *   rolle: 'mitglied'|'admin', pruefen: boolean }} Argumente
 */

/**
 * Parses the arguments. Throws a plain-text Error on anything invalid.
 * @param {string[]} argv arguments after the script name
 * @returns {Argumente}
 */
export function argsLesen(argv) {
  /** @type {Argumente} */
  const o = {
    hilfe: false, orgs: false, entziehen: false, neuesKonto: false,
    email: '', name: '', orgId: '', neuesBuero: '', rolle: 'mitglied', pruefen: false,
  };
  /** @param {number} i @param {string} name @returns {string} */
  const wert = (i, name) => {
    const w = argv[i + 1];
    if (w === undefined || w.startsWith('--')) throw new Error(`${name} braucht einen Wert.`);
    return w;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--hilfe' || a === '--help' || a === '-h') o.hilfe = true;
    else if (a === '--orgs') o.orgs = true;
    else if (a === '--entziehen') o.entziehen = true;
    else if (a === '--neues-konto') o.neuesKonto = true;
    else if (a === '--email') { o.email = wert(i, a).trim(); i += 1; }
    else if (a === '--name') { o.name = wert(i, a).trim(); i += 1; }
    else if (a === '--org') { o.orgId = wert(i, a).trim(); i += 1; }
    else if (a === '--neues-buero') { o.neuesBuero = wert(i, a).trim(); i += 1; }
    else if (a === '--rolle') { o.rolle = /** @type {any} */ (wert(i, a).trim()); i += 1; }
    else if (a === '--pruefen') o.pruefen = true;
    else throw new Error(`Unbekanntes Argument: ${a} (Hilfe: --hilfe).`);
  }
  if (o.hilfe || o.orgs) return o;
  if (!EMAIL_MUSTER.test(o.email)) throw new Error('--email fehlt oder ist keine gültige E-Mail-Adresse.');
  if (o.entziehen) {
    if (!o.orgId || o.neuesBuero) throw new Error('--entziehen braucht --org <uuid> (kein --neues-buero).');
    if (o.neuesKonto) throw new Error('--entziehen und --neues-konto schließen sich aus.');
  } else if (Boolean(o.orgId) === Boolean(o.neuesBuero)) {
    throw new Error('Genau eines angeben: --org <uuid> (bestehendes Büro) oder --neues-buero "<Name>".');
  }
  if (o.orgId && !UUID_MUSTER.test(o.orgId)) throw new Error(`--org ist keine UUID: ${o.orgId}`);
  if (!ROLLEN.includes(o.rolle)) throw new Error(`--rolle muss ${ROLLEN.join(' oder ')} sein, nicht "${o.rolle}".`);
  return o;
}

/**
 * Spells an address out character by character, so a typo becomes visible
 * ("m e y r @ …" vs. "m a y r @ …").
 * @param {string} email
 * @returns {string}
 */
export function buchstabiert(email) {
  return [...email].join(' ');
}

/**
 * Finds an auth user by e-mail (case-insensitive) through the admin API, page by page.
 * @param {any} client Supabase client with service-role key
 * @param {string} email
 * @returns {Promise<{ nutzer: {id: string, email: string}|null, geprueft: number }>}
 *   geprueft = number of accounts compared, printed so a lookup that silently
 *   stopped after the first page would show
 */
export async function nutzerSuchen(client, email) {
  const ziel = email.toLowerCase();
  let geprueft = 0;
  for (let seite = 1; seite <= 100; seite += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page: seite, perPage: SEITE });
    if (error) throw new Error(`Nutzerliste nicht lesbar: ${error.message}`);
    const nutzer = data?.users || [];
    geprueft += nutzer.length;
    const treffer = nutzer.find((u) => String(u.email || '').toLowerCase() === ziel);
    if (treffer) return { nutzer: treffer, geprueft };
    if (nutzer.length < SEITE) return { nutzer: null, geprueft };
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
 * All offices with their number of members, sorted by name. Read only.
 * @param {any} client
 * @returns {Promise<Array<{ id: string, name: string, mitglieder: number }>>}
 */
export async function orgsListe(client) {
  const orgs = await client.from('orgs').select('id, name').order('name');
  pruefeFehler(orgs.error, 'Büros lesen');
  const mit = await client.from('org_members').select('org_id');
  pruefeFehler(mit.error, 'Mitgliedschaften lesen');
  /** @type {Record<string, number>} */
  const zahl = {};
  for (const m of mit.data || []) zahl[m.org_id] = (zahl[m.org_id] || 0) + 1;
  return (orgs.data || []).map((o) => ({ id: o.id, name: o.name, mitglieder: zahl[o.id] || 0 }));
}

/**
 * Lines of the office list, for --orgs and for the "unknown office" abort.
 * @param {Array<{ id: string, name: string, mitglieder: number }>} liste
 * @returns {string[]}
 */
export function orgsZeilen(liste) {
  if (!liste.length) return ['  (keine Büros angelegt)'];
  return liste.map((o) => `  ${o.id}  ${o.name}  (${o.mitglieder} Mitglied${o.mitglieder === 1 ? '' : 'er'})`);
}

/**
 * Records of one office, counted per entity — what a member will see.
 * @param {any} client
 * @param {string} orgId
 * @returns {Promise<{ gesamt: number, haeufigste: Array<[string, number]>, gekappt: boolean }>}
 *   haeufigste = the five most frequent entities; gekappt = probe hit SICHT_GRENZE
 */
export async function sichtbarkeit(client, orgId) {
  const { data, error } = await client.from('records').select('entity').eq('org_id', orgId).range(0, SICHT_GRENZE - 1);
  pruefeFehler(error, 'Datensätze des Büros zählen');
  /** @type {Record<string, number>} */
  const je = {};
  for (const z of data || []) je[z.entity] = (je[z.entity] || 0) + 1;
  const haeufigste = Object.entries(je).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  return { gesamt: (data || []).length, haeufigste, gekappt: (data || []).length >= SICHT_GRENZE };
}

/**
 * Report of one run. Values are German status words, printed as they are.
 * @typedef {{ nutzer: string, nutzerId: string|null, geprueft: number, org: string, orgId: string|null,
 *   orgName: string, mitgliedschaft: string, sicht: string, schreibvorgaenge: number, geaendert: boolean }} FreischaltBericht
 */

/**
 * Runs an approval: reads office, user and visibility first, then writes
 * invitation, office and membership. Idempotent; with `pruefen: true` it calls
 * no write method of the client at all.
 * @param {any} client Supabase client with service-role key (or a test stub)
 * @param {{ email: string, name?: string, orgId?: string, neuesBuero?: string, neuesKonto?: boolean,
 *   rolle: 'mitglied'|'admin', pruefen?: boolean, weiterleitung?: string }} optionen
 *   weiterleitung: landing URL of the invitation mail, or '' for the Supabase site URL
 * @returns {Promise<FreischaltBericht>}
 * @throws {Error} plain text — unknown office (with the list), unknown address
 *   without --neues-konto (spelled out), two offices of one name; nothing written
 */
export async function freischalten(client, optionen) {
  const {
    email, name = '', orgId = '', neuesBuero = '', neuesKonto = false, rolle, pruefen = false, weiterleitung = '',
  } = optionen;
  /** @type {FreischaltBericht} */
  const bericht = {
    nutzer: '', nutzerId: null, geprueft: 0, org: '', orgId: null, orgName: '', mitgliedschaft: '', sicht: '',
    schreibvorgaenge: 0, geaendert: false,
  };
  const geschrieben = () => { bericht.schreibvorgaenge += 1; bericht.geaendert = true; };

  // 1. Office — read only.
  /** @type {{id: string, name: string}|null} */
  let org = null;
  if (orgId) {
    const { data, error } = await client.from('orgs').select('id, name').eq('id', orgId).maybeSingle();
    pruefeFehler(error, 'Büro lesen');
    if (!data) {
      let liste = [];
      try { liste = await orgsListe(client); } catch { /* the abort below is the message that matters */ }
      throw new Error(`Ein Büro mit der ID ${orgId} gibt es nicht. Vorhanden:\n${orgsZeilen(liste).join('\n')}`);
    }
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
    } else {
      bericht.org = pruefen ? 'würde angelegt' : 'wird angelegt';
    }
  }
  bericht.orgName = org?.name || neuesBuero;

  // 2. User — read only. Not found is the special case.
  const suche = await nutzerSuchen(client, email);
  let nutzer = suche.nutzer;
  bericht.geprueft = suche.geprueft;
  if (!nutzer && !neuesKonto) {
    if (!pruefen) {
      throw new Error(
        `Kein Konto für „${email}“ gefunden (${suche.geprueft} Konten geprüft).\n`
        + `Adresse Zeichen für Zeichen: ${buchstabiert(email)}\n`
        + 'Tippfehler? Adresse mit der Anfrage-Mail vergleichen. Stimmt sie, denselben Aufruf mit --neues-konto wiederholen — '
        + 'erst dann wird ein Konto angelegt und eingeladen. Es wurde nichts geschrieben.',
      );
    }
    bericht.nutzer = 'kein Konto — würde nur mit --neues-konto eingeladen';
  } else if (nutzer) {
    bericht.nutzer = 'vorhanden';
  } else {
    bericht.nutzer = pruefen ? 'würde eingeladen' : 'wird eingeladen';
  }

  // 3. Visibility — before anything is written.
  if (org) {
    const s = await sichtbarkeit(client, org.id);
    const liste = s.haeufigste.map(([e, n]) => `${e} ${n}`).join(', ');
    bericht.sicht = `${s.gekappt ? 'mindestens ' : ''}${s.gesamt} Datensätze des Büros „${org.name}“${liste ? ` (${liste})` : ''}`;
  } else {
    bericht.sicht = `0 Datensätze (neues Büro „${neuesBuero}“)`;
  }

  if (pruefen) {
    if (!nutzer || !org) {
      bericht.mitgliedschaft = `würde angelegt (${rolle})`;
      return bericht;
    }
  } else {
    // 4a. Invitation — only reached with --neues-konto (guard above).
    if (!nutzer) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
        data: name ? { full_name: name } : undefined,
        redirectTo: weiterleitung || undefined,
      });
      if (error) {
        // Registered between lookup and invitation (second operator, retry): reuse it.
        if (error.code === 'email_exists' || /already (been )?registered/i.test(error.message || '')) {
          nutzer = (await nutzerSuchen(client, email)).nutzer;
          if (!nutzer) throw new Error(`Einladung abgelehnt („${error.message}“), Nutzer aber nicht auffindbar.`);
          bericht.nutzer = 'vorhanden';
        } else {
          throw new Error(`Einladung fehlgeschlagen: ${error.message}`);
        }
      } else {
        nutzer = data?.user || null;
        if (!nutzer?.id) throw new Error('Einladung ohne Nutzer-ID beantwortet — bitte im Dashboard prüfen.');
        bericht.nutzer = 'eingeladen';
        geschrieben();
      }
    }
    // 4b. Office.
    if (!org) {
      const neu = await client.from('orgs').insert({ name: neuesBuero }).select('id, name').single();
      pruefeFehler(neu.error, 'Büro anlegen');
      org = neu.data;
      bericht.org = 'angelegt';
      geschrieben();
    }
  }
  bericht.nutzerId = nutzer?.id || null;
  bericht.orgId = org?.id || null;
  if (!nutzer || !org) throw new Error('Interner Fehler: Nutzer oder Büro fehlt nach dem Schreiben.');

  // 4c. Membership — three cases: new, other role, unchanged (= no write).
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
      geschrieben();
    }
  } else if (rolleGleich(zeile.role, rolle)) {
    bericht.mitgliedschaft = `vorhanden (${rolle})`;
  } else if (pruefen) {
    bericht.mitgliedschaft = `Rolle würde geändert: ${zeile.role} → ${rolle}`;
  } else {
    const neu = await client.from('org_members').update({ role: rolle }).eq('user_id', nutzer.id).eq('org_id', org.id);
    pruefeFehler(neu.error, 'Rolle ändern');
    bericht.mitgliedschaft = `Rolle geändert: ${zeile.role} → ${rolle}`;
    geschrieben();
  }

  // 4d. Read back what was written, so the report shows the database, not the intent.
  if (!pruefen && bericht.schreibvorgaenge > 0) {
    const rueck = await client.from('org_members')
      .select('role').eq('user_id', nutzer.id).eq('org_id', org.id).maybeSingle();
    pruefeFehler(rueck.error, 'Rückprobe');
    if (!rolleGleich(rueck.data?.role, rolle)) throw new Error(`Rückprobe: Mitgliedschaft steht nicht wie geschrieben (gelesen: ${rueck.data?.role ?? 'keine'}).`);
  }
  return bericht;
}

/** What a revoked membership leaves behind — said out loud on every --entziehen. */
export const BLEIBT_NACH_ENTZUG = Object.freeze([
  'Bleibt: alle Datensätze des Büros (records) — sie gehören dem Büro, nicht der Person.',
  'Bleibt: die Dateien des Büros im Bucket blobs unter <org_id>/….',
  'Bleibt: das Konto (auth.users) mit gültiger Anmeldung — im Dashboard unter Authentication → Users löschen, sonst bleibt eine Karteileiche.',
  'Bleibt: gespeicherte KI-Verbindungen samt Schlüsseln des Büros (llm_connections, kein on delete cascade).',
  'Bleibt: die Datenbankabzüge in OneDrive enthalten die Mitgliedschaft noch bis zu acht Wochen.',
]);

/**
 * Removes one membership — and nothing else.
 * @param {any} client
 * @param {{ email: string, orgId: string, pruefen?: boolean }} o
 * @returns {Promise<{ mitgliedschaft: string, schreibvorgaenge: number }>}
 */
export async function entziehen(client, { email, orgId, pruefen = false }) {
  const { nutzer } = await nutzerSuchen(client, email);
  if (!nutzer) return { mitgliedschaft: `kein Konto für „${email}“ — nichts zu tun`, schreibvorgaenge: 0 };
  const { data: zeile, error } = await client.from('org_members')
    .select('role').eq('user_id', nutzer.id).eq('org_id', orgId).maybeSingle();
  pruefeFehler(error, 'Mitgliedschaft lesen');
  if (!zeile) return { mitgliedschaft: 'keine Mitgliedschaft in diesem Büro — nichts zu tun', schreibvorgaenge: 0 };
  if (pruefen) return { mitgliedschaft: `würde gelöscht (${zeile.role})`, schreibvorgaenge: 0 };
  const weg = await client.from('org_members').delete().eq('user_id', nutzer.id).eq('org_id', orgId);
  pruefeFehler(weg.error, 'Mitgliedschaft löschen');
  return { mitgliedschaft: `gelöscht (war ${zeile.role})`, schreibvorgaenge: 1 };
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
    `Nutzer          : ${o.email} — ${b.nutzer}${b.nutzerId ? ` (${b.nutzerId})` : ''} · ${b.geprueft} Konten geprüft`,
    `Büro            : ${b.orgName || '—'} — ${b.org}${b.orgId ? ` (${b.orgId})` : ''}`,
    `Sichtbar danach : ${b.sicht}`,
    `Mitgliedschaft  : ${b.mitgliedschaft}`,
    o.pruefen ? '' : (b.geaendert ? 'Ergebnis        : geändert' : 'Ergebnis        : nichts zu tun (bereits freigeschaltet)'),
    `Schreibvorgaenge: ${b.schreibvorgaenge}`,
  ].filter(Boolean);
}

/**
 * Adds the "paused project" hint to network-shaped errors: the free tier
 * pauses a project after a week without access, and then every call fails
 * with a bare network error.
 * @param {unknown} err
 * @returns {string}
 */
export function fehlerText(err) {
  const text = String(/** @type {any} */ (err)?.message || err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|\b50[234]\b|paused/i.test(text)) {
    return `${text}\nDas Projekt antwortet nicht — im kostenlosen Tarif ist es nach einer Woche ohne Zugriff pausiert. Im Supabase-Dashboard wecken („Restore project“), dann erneut.`;
  }
  return text;
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
  if (optionen.orgs) {
    console.log('Büros:');
    for (const z of orgsZeilen(await orgsListe(client))) console.log(z);
    console.log('Schreibvorgaenge: 0');
    return;
  }
  if (optionen.entziehen) {
    const e = await entziehen(client, optionen);
    if (optionen.pruefen) console.log('PROBELAUF — es wurde nichts geschrieben.');
    console.log(`Mitgliedschaft  : ${e.mitgliedschaft}`);
    for (const z of BLEIBT_NACH_ENTZUG) console.log(z);
    console.log(`Schreibvorgaenge: ${e.schreibvorgaenge}`);
    return;
  }
  const bericht = await freischalten(client, { ...optionen, weiterleitung });
  for (const zeile of berichtZeilen(bericht, optionen)) console.log(zeile);
}

// Run only when executed directly — the unit tests import the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`FEHLER: ${fehlerText(err)}`);
    process.exit(1);
  });
}
