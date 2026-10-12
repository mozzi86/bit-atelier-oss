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
 * @param {{ email: string, rolle: 'bidder'|'investor'|'gast', projektId: string, vergabeId?: string,
 *   kontaktId?: string }} e
 * @returns {Promise<{ nutzer_id: string, eingeladen: boolean, rolle: string }>}
 * @throws {Error} outside the cloud build, or with the function's message
 */
export async function einladungSenden(e) {
  if (DATENQUELLE !== 'supabase') {
    throw new Error('Zugriffstrennung gibt es nur im Cloud-Betrieb (angemeldet).');
  }
  const { supabaseClient } = await import('./supabaseClient.js');
  const { authSupabase } = await import('./supabaseDb.js');
  const orgId = await authSupabase.aktuelleOrgId();
  const weiterleitung = typeof window !== 'undefined' ? `${window.location.origin}/passwort-zuruecksetzen?type=einladung` : undefined;
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
