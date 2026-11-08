// Thin wrappers around the access-separation RPCs (Phase 74-01 Task 14,
// supabase/migrations/0009 + 0010 + 0011).
//
// Cloud build only. Outside it there is no database to call: every function
// throws a plain-text error instead of pretending. supabase-js is loaded by a
// dynamic import behind the folded DATENQUELLE literal, so the local build
// carries none of it (same pattern as bitApi.js, 57-02 tree-shaking proof).
//
// The database answers every refusal with ONE text ("Vorgang nicht zulässig
// oder nicht gefunden", 0009) — passed through unchanged, no guessing why.
//
// In:  ids and dates. Out: what the RPC returns. Side effects: the RPCs write
//      the access log (0010).

import { DATENQUELLE } from '../lib/umgebung.js';

/**
 * Calls one RPC.
 * @param {string} name function name in schema public
 * @param {Record<string, unknown>} argumente named arguments (p_…)
 * @returns {Promise<any>} the RPC result
 * @throws {Error} outside the cloud build, or with the database's message
 */
async function rpc(name, argumente) {
  if (DATENQUELLE !== 'supabase') {
    throw new Error('Zugriffstrennung gibt es nur im Cloud-Betrieb (angemeldet).');
  }
  const { supabaseClient } = await import('./supabaseClient.js');
  const { data, error } = await supabaseClient().rpc(name, argumente);
  if (error) throw new Error(error.message || `${name} fehlgeschlagen`);
  return data;
}

/**
 * Opens the submission of a tender (owner/planner; deadline in the future).
 * @param {string} tenderId records.id of the Tender
 * @param {string|Date} frist deadline (ISO string or Date)
 * @returns {Promise<void>}
 */
export function submissionAnlegen(tenderId, frist) {
  return rpc('submission_anlegen', { p_tender: tenderId, p_frist: new Date(frist).toISOString() });
}

/**
 * Moves the deadline later (owner; only while it runs; reason required).
 * @param {string} tenderId
 * @param {string|Date} neu new deadline
 * @param {string} grund reason, goes to the log
 * @returns {Promise<void>}
 */
export function submissionFrist(tenderId, neu, grund) {
  return rpc('submission_frist', { p_tender: tenderId, p_neu: new Date(neu).toISOString(), p_grund: grund });
}

/**
 * The opening act (owner; at/after the deadline; once).
 * @param {string} tenderId
 * @returns {Promise<Array<{ record_id: string, bieter_kontakt: string|null, eingang_am: string,
 *   status: string|null, summe: unknown, inhalt_hash: string, hash_wie_protokolliert: boolean }>>}
 *   the record (Niederschrift), one entry per bid
 */
export function submissionOeffnen(tenderId) {
  return rpc('submission_oeffnen', { p_tender: tenderId });
}

/**
 * Withdraws the caller's own bid while the deadline runs.
 * @param {string} gebotId records.id of the bid
 * @returns {Promise<void>}
 */
export function gebotZuruecknehmen(gebotId) {
  return rpc('gebot_zuruecknehmen', { p_id: gebotId });
}

/**
 * Awards one bid of an opened tender (owner). Replaces Bid.update for portal bids.
 * @param {string} tenderId
 * @param {string} gebotId
 * @returns {Promise<void>}
 */
export function zuschlagErteilen(tenderId, gebotId) {
  return rpc('zuschlag_erteilen', { p_tender: tenderId, p_bid: gebotId });
}

/**
 * Why the caller sees a row — or not — in plain words.
 * @param {string} id records.id
 * @returns {Promise<string>}
 */
export function warumSichtbar(id) {
  return rpc('warum_sichtbar', { p_id: id });
}

/**
 * Checks the hash chain of the access log of one org.
 * @param {string} orgId
 * @returns {Promise<Array<{ eintrag: number, ok: boolean }>>}
 */
export function protokollKettePruefen(orgId) {
  return rpc('protokoll_kette_pruefen', { p_org: orgId });
}

/**
 * The submission row of a tender (deadline, opening), or null when none
 * exists. Cloud only; internal roles and participants may read it (0009).
 * @param {string} tenderId
 * @returns {Promise<{ tender_id: string, org_id: string, frist: string, geoeffnet_am: string|null } | null>}
 */
export async function submissionLesen(tenderId) {
  if (DATENQUELLE !== 'supabase') return null;
  const { supabaseClient } = await import('./supabaseClient.js');
  const { data, error } = await supabaseClient().from('submission').select('*').eq('tender_id', tenderId).maybeSingle();
  if (error) throw new Error(error.message || 'Submission nicht lesbar');
  return data || null;
}

/**
 * Releases a tender to its invited bidders as projections (0012).
 * @param {string} tenderId
 * @param {{ modellId?: string, ansicht?: string }} [modell] optional model view
 * @returns {Promise<{ mengen: number, modell: boolean }>}
 */
export function freigabeErteilen(tenderId, modell = {}) {
  return rpc('freigabe_erteilen', { p_tender: tenderId, p_modell: modell.modellId || null, p_ansicht: modell.ansicht || null });
}

/**
 * Withdraws the release (projections back to internal).
 * @param {string} tenderId
 * @returns {Promise<number>} number of projection rows withdrawn
 */
export function freigabeZuruecknehmen(tenderId) {
  return rpc('freigabe_zuruecknehmen', { p_tender: tenderId });
}

/**
 * Answers a question for every participant of the tender (own projection row).
 * @param {string} tenderId
 * @param {string} frage the question as the office words it
 * @param {string} antwort
 * @returns {Promise<string>} id of the answer row
 */
export function rueckfrageBeantworten(tenderId, frage, antwort) {
  return rpc('rueckfrage_beantworten', { p_tender: tenderId, p_frage: frage, p_antwort: antwort });
}

/**
 * Invites an external person through the edge function `einladung` (owner only).
 * A client (`bauherr`, 110-01) lands in the app straight from the invitation
 * mail — no password to set (D-BH-03, magic link); later sign-ins use the
 * login link of /anmeldung. The other roles set a password first.
 * @param {{ email: string, rolle: 'bidder'|'investor'|'gast'|'bauherr', projektId: string, vergabeId?: string,
 *   kontaktId?: string }} e
 * @returns {Promise<{ nutzer_id: string, eingeladen: boolean, rolle: string }>}
 *   eingeladen=false: the address already had an account, no mail was sent
 * @throws {Error} outside the cloud build, or with the function's message
 */
export async function einladungSenden(e) {
  if (DATENQUELLE !== 'supabase') {
    throw new Error('Zugriffstrennung gibt es nur im Cloud-Betrieb (angemeldet).');
  }
  const { supabaseClient } = await import('./supabaseClient.js');
  const { authSupabase } = await import('./supabaseDb.js');
  const orgId = await authSupabase.aktuelleOrgId();
  const ziel = e.rolle === 'bauherr' ? '/' : '/passwort-zuruecksetzen?type=einladung';
  const weiterleitung = typeof window !== 'undefined' ? `${window.location.origin}${ziel}` : undefined;
  const { data, error } = await supabaseClient().functions.invoke('einladung', {
    body: {
      aktion: 'einladen', org_id: orgId, email: e.email, rolle: e.rolle,
      projekt_id: e.projektId, vergabe_id: e.vergabeId || null, kontakt_id: e.kontaktId || null, weiterleitung,
    },
  });
  if (error) {
    // The function answers { error: "<plain text>" } with a status; surface it.
    /** @type {any} */
    const ctx = /** @type {any} */ (error).context;
    let text = error.message;
    try { text = (await ctx?.json?.())?.error || text; } catch { /* keep the generic message */ }
    throw new Error(text);
  }
  return data;
}

// --- Invitation by link (110-06, migration 0017) -------------------------------

/**
 * Creates an invitation code for one project (owner only). The code is
 * returned ONCE — the database stores only its SHA-256.
 * @param {string} projektId records.id of the Project
 * @param {'bauherr'} [rolle] the only role with an audience so far (0016)
 * @param {number} [tage] validity in days (1…90)
 * @param {number} [nutzungen] how many accounts may redeem it (1…20)
 * @returns {Promise<string>} the code
 */
export function einladungscodeErstellen(projektId, rolle = 'bauherr', tage = 14, nutzungen = 1) {
  return rpc('einladungscode_erstellen', { p_projekt: projektId, p_rolle: rolle, p_tage: tage, p_nutzungen: nutzungen });
}

/**
 * The link of a code — the public page /einladung of this app.
 * @param {string} code
 * @param {string} [herkunft] origin, default window.location.origin
 * @returns {string}
 */
export function einladungsLink(code, herkunft = typeof window !== 'undefined' ? window.location.origin : '') {
  return `${herkunft}/einladung?code=${encodeURIComponent(code)}`;
}

/**
 * Redeems a code for the signed-in account: membership with the fixed rights
 * of the role and access to the code's project (0017).
 * @param {string} code
 * @returns {Promise<{ projekt_id: string, rolle: string }>}
 */
export function einladungscodeEinloesen(code) {
  return rpc('einladungscode_einloesen', { p_code: code });
}

// --- Client portal (110-01, migration 0016) -----------------------------------

/**
 * Releases one projection to the project's client (owner/planner). The
 * database strips every key that is not on its whitelist (bauherr_bereinigen)
 * and updates an existing release of the same source in place.
 * @param {string} art projection kind, e.g. 'BauherrPlan' (BAUHERR_ARTEN)
 * @param {string} quelleId records.id of the source row
 * @param {Record<string, unknown>} inhalt projection built by bauherrProjektion.js
 * @param {string|null} [datei] file name in freigaben/<org>/<projekt>/_bauherr/ (uploaded before)
 * @param {string|null} [projektId] project of the source — used on the local data
 *   paths only (the RPC derives it from the source row)
 * @returns {Promise<string>} id of the projection row
 *
 * Local data paths (express/serverlos, "Ansicht als Bauherr", 110-03): the
 * same row is written through bitApi (freigabeZeile — the whitelist of the
 * RPC), updated in place for the same source. Locally this is a preview store,
 * no access control: whoever holds the device reads the local data anyway.
 */
export async function bauherrFreigeben(art, quelleId, inhalt, datei = null, projektId = null) {
  if (DATENQUELLE === 'supabase') {
    return rpc('bauherr_freigeben', { p_art: art, p_quelle: quelleId, p_inhalt: inhalt, p_datei: datei });
  }
  if (!projektId) throw new Error('Freigabe ohne Projekt nicht möglich.');
  const { bitApi } = await import('./bitApi.js');
  const { BAUHERR_FELDER, freigabeZeile } = await import('../lib/bauherrProjektion.js');
  const zeile = freigabeZeile(art, quelleId, projektId, inhalt, datei);
  const vorhanden = (await bitApi.entities[art].filter({ project_id: projektId })).find((/** @type {any} */ r) => r.quelle_id === quelleId);
  if (vorhanden) {
    // The local update MERGES (db.js update); the RPC REPLACES data. Keys the new
    // release no longer carries are cleared, so e.g. a withdrawn decision request
    // does not survive.
    /** @type {Record<string, unknown>} */
    const leer = Object.fromEntries((BAUHERR_FELDER[art] || []).filter((k) => !(k in zeile)).map((k) => [k, null]));
    await bitApi.entities[art].update(vorhanden.id, { ...leer, ...zeile });
    return vorhanden.id;
  }
  return (await bitApi.entities[art].create(zeile)).id;
}

/**
 * Withdraws a client projection (back to internal, kept for the log).
 * Locally: `freigegeben` false on the row (same mirror as the RPC writes).
 * @param {string} projektionId
 * @param {string} [art] entity of the projection — needed on the local data paths
 * @returns {Promise<boolean>}
 */
export async function bauherrZuruecknehmen(projektionId, art) {
  if (DATENQUELLE === 'supabase') return rpc('bauherr_zuruecknehmen', { p_projektion: projektionId });
  if (!art) throw new Error('Rücknahme ohne Art nicht möglich.');
  const { bitApi } = await import('./bitApi.js');
  await bitApi.entities[art].update(projektionId, { freigegeben: false });
  return true;
}

/**
 * Answers a client's question as a projection the client sees.
 * @param {string} rueckmeldungId records.id of the BauherrRueckmeldung
 * @param {string} antwort plain text, at most 8 000 characters
 * @returns {Promise<string>} id of the answer row
 */
export function bauherrAntworten(rueckmeldungId, antwort) {
  return rpc('bauherr_antworten', { p_rueckmeldung: rueckmeldungId, p_antwort: antwort });
}

/**
 * Uploads a file (PDF, view) of the office for a client release to
 * freigaben/<org>/<projekt>/_bauherr/<name> — before bauherrFreigeben.
 * @param {string} projektId
 * @param {string} name file name without folders (bauherrDateiname)
 * @param {Blob} datei
 * @returns {Promise<string>} the name, to pass as `datei`
 */
export async function bauherrDateiAblegen(projektId, name, datei) {
  if (DATENQUELLE !== 'supabase') throw new Error('Freigaben für den Bauherrn gibt es nur im Cloud-Betrieb.');
  const { supabaseClient } = await import('./supabaseClient.js');
  const { authSupabase } = await import('./supabaseDb.js');
  const orgId = await authSupabase.aktuelleOrgId();
  const { error } = await supabaseClient().storage.from('freigaben').upload(`${orgId}/${projektId}/_bauherr/${name}`, datei, { upsert: true });
  if (error) throw new Error(`Datei nicht abgelegt: ${error.message}`);
  return name;
}

/**
 * A signed download URL (60 s) of a released file, through the edge function
 * `freigabe` — the only way an external role reads bucket `freigaben` (0013).
 * @param {string} recordId id of the projection row
 * @returns {Promise<string>} the URL
 */
export async function freigabeDateiLink(recordId) {
  if (DATENQUELLE !== 'supabase') throw new Error('Downloads gibt es nur im Cloud-Betrieb.');
  const { supabaseClient } = await import('./supabaseClient.js');
  const { authSupabase } = await import('./supabaseDb.js');
  const orgId = await authSupabase.aktuelleOrgId();
  const { data, error } = await supabaseClient().functions.invoke('freigabe', { body: { org_id: orgId, record_id: recordId } });
  if (error || !data?.url) throw new Error('Datei nicht verfügbar — Vorgang nicht zulässig oder nicht gefunden.');
  return data.url;
}

/**
 * The client uploads an own document: file to bucket `bauherr` (own folder),
 * then the row BauherrUpload (immutable, 0016).
 * @param {string} projektId
 * @param {File|Blob} datei
 * @param {string} name file name without folders (bauherrDateiname)
 * @param {string} [text] own note
 * @returns {Promise<void>}
 */
export async function bauherrHochladen(projektId, datei, name, text = '') {
  if (DATENQUELLE !== 'supabase') throw new Error('Hochladen gibt es nur im Cloud-Betrieb.');
  const { supabaseClient } = await import('./supabaseClient.js');
  const { authSupabase } = await import('./supabaseDb.js');
  const client = supabaseClient();
  const orgId = await authSupabase.aktuelleOrgId();
  const { data: s } = await client.auth.getSession();
  const uid = s?.session?.user?.id;
  if (!uid) throw new Error('Nicht angemeldet.');
  const { error } = await client.storage.from('bauherr').upload(`${orgId}/${projektId}/${uid}/${name}`, datei, { upsert: false });
  if (error) throw new Error(`Hochladen fehlgeschlagen: ${error.message}`);
  const { bitApi } = await import('./bitApi.js');
  await bitApi.entities.BauherrUpload.create({
    project_id: projektId, titel: name, datei: name, groesse_bytes: datei.size, mime: datei.type || '', text,
  });
}
