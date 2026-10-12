#!/usr/bin/env node
// THE PROOF over HTTP (Phase 74-01 Task 10) — against a THROWAWAY project only.
//
// The SQL half (supabase/tests/74-01_zugriff.sql) proves the rules inside one
// rolled-back transaction. This script proves them the way an attacker meets
// them: raw PostgREST, Storage and Edge Functions with the REAL JWT of each
// user, the published anon key, nothing through the UI. The service role is
// used only for setup, the deadline shift, counter-checks and teardown.
//
// Fixture: org H with owner_h, planner_h, leser_h; bidder1, bidder2 (project
// P1, tender T1), bidder3 (P1, tender T2), investor1 (P2); org F with owner_f.
// Contacts for the bidders, T1 with a submission, T2 without, LV positions
// with unit_price, a model, one blob per bucket.
//
// Each case is one attack path of the investigation; PASS/FAIL/SKIP per line.
// SKIP = a precondition is missing (an edge function not deployed on the
// throwaway project) — a run with a SKIP is NOT the 42/42 the plan demands
// (exit 2). FAIL → exit 1. All cases run; teardown always runs (finally).
// Residue that cannot be removed by design: the access log of the test orgs
// (append-only, 0010) — expected in a throwaway project.
//
// SAFETY — this script creates and deletes users and data:
//   - own variables ZUGRIFF_URL / ZUGRIFF_ANON / ZUGRIFF_SERVICE (never the
//     *_DEV names: per docs/BETRIEB.md the LIVE project is historically
//     called bit-atelier-dev and sits in SUPABASE_URL_DEV);
//   - refuses when ZUGRIFF_URL equals SUPABASE_URL_DEV, SUPABASE_URL_PROD,
//     SUPABASE_URL or VITE_SUPABASE_URL, or contains "prod";
//   - requires --wegwerf on the command line.
//
// In:  env as above; --wegwerf. Out: one line per case, summary, exit 0/1/2.
// Usage (PowerShell): node --env-file=.env scripts/supabase-zugriff-check.mjs --wegwerf

import { Blob } from 'node:buffer';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Decides whether the target may be used. Pure — unit-tested.
 * @param {Record<string, string|undefined>} env
 * @param {string[]} argv
 * @returns {{ ok: true, url: string, anon: string, service: string } | { ok: false, grund: string }}
 */
export function zielPruefen(env, argv) {
  const url = String(env.ZUGRIFF_URL || '').trim().replace(/\/+$/, '');
  const anon = String(env.ZUGRIFF_ANON || '').trim();
  const service = String(env.ZUGRIFF_SERVICE || '').trim();
  const fehlt = [['ZUGRIFF_URL', url], ['ZUGRIFF_ANON', anon], ['ZUGRIFF_SERVICE', service]].filter(([, w]) => !w).map(([n]) => n);
  if (fehlt.length) return { ok: false, grund: `Umgebungsvariable fehlt: ${fehlt.join(', ')}.` };
  if (!argv.includes('--wegwerf')) return { ok: false, grund: 'Nur gegen ein Wegwerf-Projekt: Aufruf mit --wegwerf.' };
  const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  for (const name of ['SUPABASE_URL_DEV', 'SUPABASE_URL_PROD', 'SUPABASE_URL', 'VITE_SUPABASE_URL']) {
    if (env[name] && norm(env[name]) === norm(url)) {
      return { ok: false, grund: `ZUGRIFF_URL ist gleich ${name} — das ist (oder kann) das Echtsystem sein. Abbruch.` };
    }
  }
  if (/prod/i.test(url)) return { ok: false, grund: `ZUGRIFF_URL sieht nach prod aus (${url}). Abbruch.` };
  return { ok: true, url, anon, service };
}

/**
 * Collects case results. A case function returns true (PASS), false (FAIL),
 * or a string starting with 'SKIP' (precondition missing); a throw is FAIL
 * with the message.
 */
export class Lauf {
  constructor(ausgabe = console.log) { this.ergebnisse = []; this.ausgabe = ausgabe; }
  /**
   * @param {string} nr case number, e.g. 'A-07'
   * @param {string} text what is attacked, plain German
   * @param {() => Promise<boolean|string>} fn
   */
  async fall(nr, text, fn) {
    let urteil;
    let notiz = '';
    try {
      const r = await fn();
      if (typeof r === 'string' && r.startsWith('SKIP')) { urteil = 'SKIP'; notiz = r.slice(4).replace(/^[:\s]+/, ''); }
      else urteil = r === true ? 'PASS' : 'FAIL';
    } catch (e) {
      urteil = 'FAIL';
      notiz = String(/** @type {any} */ (e)?.message || e);
    }
    this.ergebnisse.push({ nr, text, urteil, notiz });
    this.ausgabe(`[${urteil}] ${nr} ${text}${notiz ? ` — ${notiz}` : ''}`);
  }
  /** @returns {{ pass: number, fail: number, skip: number, code: 0|1|2 }} */
  summe() {
    const n = (u) => this.ergebnisse.filter((e) => e.urteil === u).length;
    const fail = n('FAIL');
    const skip = n('SKIP');
    return { pass: n('PASS'), fail, skip, code: fail ? 1 : skip ? 2 : 0 };
  }
}

/** Fixed test identities (e-mail local parts; domain .invalid never receives mail). */
const NUTZER = ['owner_h', 'planner_h', 'leser_h', 'bidder1', 'bidder2', 'bidder3', 'investor1', 'owner_f'];

async function main(argv) {
  const ziel = zielPruefen(process.env, argv);
  if (!ziel.ok) { console.error(`ABBRUCH: ${ziel.grund}`); return 1; }
  const { createClient } = await import('@supabase/supabase-js');
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const dienst = createClient(ziel.url, ziel.service, opts);
  const anonym = createClient(ziel.url, ziel.anon, opts);
  const lauf = new Lauf();
  const stempel = Date.now().toString(36);
  const passwort = `Zc-${stempel}-${Math.random().toString(36).slice(2)}!`;
  /** @type {Record<string, { id: string, client: any }>} */
  const u = {};
  const orgs = { H: '', F: '' };
  const objekte = [];

  /** Throws with the database message. */
  const ok = (r, was) => { if (r.error) throw new Error(`${was}: ${r.error.message}`); return r.data; };
  const id = (s) => `zc-${stempel}-${s}`;

  try {
    // ---------- Setup (service role) ----------
    for (const name of NUTZER) {
      const { data, error } = await dienst.auth.admin.createUser({ email: `${name}.${stempel}@zugriff-check.invalid`, password: passwort, email_confirm: true });
      if (error) throw new Error(`Nutzer ${name}: ${error.message}`);
      const client = createClient(ziel.url, ziel.anon, opts);
      u[name] = { id: data.user.id, client };
    }
    orgs.H = ok(await dienst.from('orgs').insert({ name: `ZC ${stempel} H` }).select('id').single(), 'Org H').id;
    orgs.F = ok(await dienst.from('orgs').insert({ name: `ZC ${stempel} F` }).select('id').single(), 'Org F').id;
    const extern = (r, kontakt) => ({ role: r, stufe: 'free', can_edit_model: false, can_export_ifc: false, can_view_audit_reports: false, can_submit_bid: r !== 'gast', kontakt_id: kontakt });
    ok(await dienst.from('org_members').insert([
      { user_id: u.owner_h.id, org_id: orgs.H, role: 'owner', stufe: 'enterprise', can_edit_model: true, can_export_ifc: true, can_view_audit_reports: true },
      { user_id: u.planner_h.id, org_id: orgs.H, role: 'planner', stufe: 'enterprise', can_edit_model: true, can_export_ifc: false },
      { user_id: u.leser_h.id, org_id: orgs.H, role: 'leser' },
      { user_id: u.bidder1.id, org_id: orgs.H, ...extern('bidder', id('c1')) },
      { user_id: u.bidder2.id, org_id: orgs.H, ...extern('bidder', id('c2')) },
      { user_id: u.bidder3.id, org_id: orgs.H, ...extern('bidder', id('c3')) },
      { user_id: u.investor1.id, org_id: orgs.H, ...extern('investor', null) },
      { user_id: u.owner_f.id, org_id: orgs.F, role: 'owner', stufe: 'enterprise', can_edit_model: true, can_export_ifc: true, can_view_audit_reports: true },
    ]), 'Mitgliedschaften');
    ok(await dienst.from('projekt_zugang').insert([
      ...['bidder1', 'bidder2', 'bidder3'].map((n) => ({ org_id: orgs.H, user_id: u[n].id, projekt_id: id('P1'), rolle: 'bidder' })),
      { org_id: orgs.H, user_id: u.investor1.id, projekt_id: id('P2'), rolle: 'investor' },
    ]), 'Projektzugang');
    ok(await dienst.from('vergabe_teilnehmer').insert([
      { org_id: orgs.H, user_id: u.bidder1.id, vergabe_id: id('T1'), projekt_id: id('P1'), kontakt_id: id('c1') },
      { org_id: orgs.H, user_id: u.bidder2.id, vergabe_id: id('T1'), projekt_id: id('P1'), kontakt_id: id('c2') },
      { org_id: orgs.H, user_id: u.bidder3.id, vergabe_id: id('T2'), projekt_id: id('P1'), kontakt_id: id('c3') },
    ]), 'Vergabeteilnahme');
    const zeile = (s, entity, data, org = orgs.H) => ({ id: id(s), entity, org_id: org, data });
    ok(await dienst.from('records').insert([
      zeile('P1', 'Project', { name: 'ZC Projekt 1' }),
      zeile('P2', 'Project', { name: 'ZC Projekt 2' }),
      zeile('T1', 'Tender', { name: 'Rohbau', project_id: id('P1'), position_ids: [id('L1')], invited_contact_ids: [id('c1'), id('c2')] }),
      zeile('T2', 'Tender', { name: 'Elektro', project_id: id('P1') }),
      zeile('L1', 'LVPosition', { oz: '01.01', short_text: 'Beton', quantity: 10, unit: 'm3', unit_price: 99.5, project_id: id('P1') }),
      zeile('c1', 'Contact', { name: 'Bieter Eins' }),
      zeile('c2', 'Contact', { name: 'Bieter Zwei' }),
      zeile('c3', 'Contact', { name: 'Bieter Drei' }),
      zeile('CO', 'ChangeOrder', { title: 'Nachtrag' }),
      zeile('K1', 'Din276Katalog', { kg: '300' }),
      zeile('M1', 'BimModel', { name: 'Modell', project_id: id('P1') }),
      zeile('PF', 'Project', { name: 'Fremd' }, orgs.F),
    ]), 'Datensätze');
    // The service role bypasses the anchor trigger: set the anchor columns as the import would.
    ok(await dienst.from('records').update({ projekt_id: id('P1') }).in('id', [id('T1'), id('T2'), id('L1'), id('M1')]), 'Anker');
    ok(await dienst.from('records').update({ projekt_id: id('P1') }).eq('id', id('P1')), 'Anker P1');

    for (const name of NUTZER) {
      const { error } = await u[name].client.auth.signInWithPassword({ email: `${name}.${stempel}@zugriff-check.invalid`, password: passwort });
      if (error) throw new Error(`Anmeldung ${name}: ${error.message}`);
    }
    const c = (name) => u[name].client;
    const anzahl = async (client, filter) => {
      let q = client.from('records').select('id', { count: 'exact', head: true }).eq('org_id', orgs.H);
      for (const [k, v] of Object.entries(filter || {})) q = q.eq(k, v);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    };
    const gebot = (client, nutzer, tender, extra = {}) => client.from('records')
      .insert({ id: id(`bid-${nutzer}-${tender}`), entity: 'Bid', org_id: orgs.H, created_by: u[nutzer].id, data: { tender_id: id(tender), total: 100, ...extra } })
      .select('id, data').single();

    // Submission T1 by the owner, release by the planner.
    ok(await c('owner_h').rpc('submission_anlegen', { p_tender: id('T1'), p_frist: new Date(Date.now() + 3600e3).toISOString() }), 'Submission T1');
    ok(await c('planner_h').rpc('freigabe_erteilen', { p_tender: id('T1') }), 'Freigabe T1');

    // ---------- Cases ----------
    await lauf.fall('A-01', 'owner_f liest keine Zeile von Büro H', async () => (await anzahl(c('owner_f'))) === 0);
    await lauf.fall('A-02', 'anonym (anon key, ohne Sitzung) liest records nicht', async () => {
      const r = await anonym.from('records').select('id').limit(1);
      return !!r.error || (r.data || []).length === 0;
    });
    await lauf.fall('A-03', 'owner_h sieht den ganzen Bestand von H', async () => (await anzahl(c('owner_h'))) >= 11);
    await lauf.fall('A-04', 'leser_h liest, kann aber nicht anlegen', async () => {
      const r = await c('leser_h').from('records').insert({ id: id('leser'), entity: 'Issue', org_id: orgs.H, created_by: u.leser_h.id, data: {} });
      return !!r.error && (await anzahl(c('leser_h'))) >= 11;
    });
    await lauf.fall('A-05', 'Objektspeicher: owner_h legt blobs/<H>/… ab und liest es', async () => {
      const pfad = `${orgs.H}/${id('blob')}.json`;
      const auf = await c('owner_h').storage.from('blobs').upload(pfad, new Blob(['{}'], { type: 'application/json' }));
      if (auf.error) throw new Error(auf.error.message);
      objekte.push(['blobs', pfad]);
      return !(await c('owner_h').storage.from('blobs').download(pfad)).error;
    });
    await lauf.fall('A-06', 'owner_f lädt das blobs-Objekt von H nicht', async () => !!(await c('owner_f').storage.from('blobs').download(`${orgs.H}/${id('blob')}.json`)).error);

    let gebot1 = null;
    await lauf.fall('A-07', 'bidder1 gibt ab und liest sein Gebot; Server setzt Id, Siegel, Kontakt', async () => {
      const r = await gebot(c('bidder1'), 'bidder1', 'T1', { contact_id: id('c2') });
      if (r.error) throw new Error(r.error.message);
      gebot1 = r.data;
      return r.data.id !== id('bid-bidder1-T1') && r.data.data.contact_id === id('c1');
    });
    await lauf.fall('A-08', 'bidder2 sieht das Gebot von bidder1 nicht', async () => {
      const r = await gebot(c('bidder2'), 'bidder2', 'T1');
      if (r.error) throw new Error(r.error.message);
      return (await anzahl(c('bidder2'), { entity: 'Bid' })) === 1;
    });
    await lauf.fall('A-09', 'owner_h sieht vor der Öffnung kein versiegeltes Gebot', async () => (await anzahl(c('owner_h'), { entity: 'Bid' })) === 0);
    await lauf.fall('A-13', 'zweites Gebot desselben Bieters auf T1 → abgewiesen', async () => !!(await gebot(c('bidder1'), 'bidder1', 'T1')).error);
    await lauf.fall('A-14', 'Gebot ohne Submission (bidder3, T2) → abgewiesen', async () => !!(await gebot(c('bidder3'), 'bidder3', 'T2')).error);
    await lauf.fall('A-15', 'Gebot auf eine Vergabe von Büro F → abgewiesen', async () => {
      const r = await c('bidder1').from('records').insert({ id: id('x15'), entity: 'Bid', org_id: orgs.H, created_by: u.bidder1.id, data: { tender_id: id('PF') } });
      return !!r.error;
    });
    await lauf.fall('A-16', 'created_date/sicht/eigner beim INSERT selbst setzen → verweigert', async () => {
      const r = await c('bidder1').from('records').insert({ id: id('x16'), entity: 'BcfRueckfrage', org_id: orgs.H, created_by: u.bidder1.id, created_date: '2000-01-01', data: { project_id: id('P1') } });
      return !!r.error;
    });
    await lauf.fall('A-18', 'bidder1 schreibt sein Gebot auf den Kontakt von bidder2 um → bleibt c1', async () => {
      if (!gebot1) return 'SKIP A-07 fehlgeschlagen';
      await c('bidder1').from('records').update({ data: { ...gebot1.data, contact_id: id('c2') } }).eq('id', gebot1.id);
      const r = await dienst.from('records').select('data').eq('id', gebot1.id).single();
      return r.data?.data?.contact_id === id('c1');
    });
    await lauf.fall('A-19', 'bidder1: keine LVPosition, MengenFreigabe ohne unit_price', async () => {
      if ((await anzahl(c('bidder1'), { entity: 'LVPosition' })) !== 0) return false;
      const r = await c('bidder1').from('records').select('data').eq('org_id', orgs.H).eq('entity', 'MengenFreigabe');
      if (r.error || (r.data || []).length !== 1) return false;
      return !('unit_price' in r.data[0].data) && !('long_text' in r.data[0].data);
    });
    await lauf.fall('A-20', 'bidder1: kein Tender, TenderFreigabe ohne Bieterliste/Zuschlag', async () => {
      if ((await anzahl(c('bidder1'), { entity: 'Tender' })) !== 0) return false;
      const r = await c('bidder1').from('records').select('data').eq('org_id', orgs.H).eq('entity', 'TenderFreigabe');
      return !r.error && (r.data || []).length === 1 && !('invited_contact_ids' in r.data[0].data) && !('awarded_bid_id' in r.data[0].data);
    });
    await lauf.fall('A-21', 'bidder1: Contact, ChangeOrder, Din276Katalog je 0', async () => {
      for (const e of ['Contact', 'ChangeOrder', 'Din276Katalog']) if ((await anzahl(c('bidder1'), { entity: e })) !== 0) return false;
      return true;
    });
    await lauf.fall('A-22', 'bidder3 (T2) liest die Mengen von T1 nicht', async () => (await anzahl(c('bidder3'), { entity: 'MengenFreigabe' })) === 0);
    await lauf.fall('A-23', 'bidder1 löscht weder Bürozeile noch eigenes Gebot', async () => {
      await c('bidder1').from('records').delete().eq('id', id('K1'));
      if (gebot1) await c('bidder1').from('records').delete().eq('id', gebot1.id);
      const r = await dienst.from('records').select('id').in('id', [id('K1'), gebot1?.id || id('K1')]);
      return (r.data || []).length === (gebot1 ? 2 : 1);
    });
    await lauf.fall('A-24', 'Position aus position_ids entfernt, neu freigegeben → Projektion weg', async () => {
      ok(await c('planner_h').from('records').update({ data: { name: 'Rohbau', project_id: id('P1'), position_ids: [] } }).eq('id', id('T1')), 'T1 ändern');
      ok(await c('planner_h').rpc('freigabe_erteilen', { p_tender: id('T1') }), 'erneut freigeben');
      return (await anzahl(c('bidder1'), { entity: 'MengenFreigabe' })) === 0;
    });
    await lauf.fall('A-25', 'unkatalogisierte Entität: intern sichtbar, extern weder lesbar noch schreibbar', async () => {
      ok(await c('owner_h').from('records').insert({ id: id('neu'), entity: 'NeuTest74', org_id: orgs.H, created_by: u.owner_h.id, data: {} }), 'owner legt an');
      const fremd = await c('bidder1').from('records').insert({ id: id('neu2'), entity: 'NeuTest74', org_id: orgs.H, created_by: u.bidder1.id, data: {} });
      return (await anzahl(c('owner_h'), { entity: 'NeuTest74' })) === 1 && (await anzahl(c('bidder1'), { entity: 'NeuTest74' })) === 0 && !!fremd.error;
    });
    await lauf.fall('A-26', '"Bid " mit Leerzeichen umgeht den Katalog nicht', async () => {
      const r = await c('bidder2').from('records').insert({ id: id('x26'), entity: 'Bid ', org_id: orgs.H, created_by: u.bidder2.id, data: { tender_id: id('T1') } });
      return !!r.error;
    });
    await lauf.fall('A-27', 'protokoll_schreiben weder als bidder1 noch anonym aufrufbar', async () => {
      const args = { p_org: orgs.H, p_projekt: null, p_aktion: 'export', p_entity: null, p_record: null, p_detail: {} };
      return !!(await c('bidder1').rpc('protokoll_schreiben', args)).error && !!(await anonym.rpc('protokoll_schreiben', args)).error;
    });
    await lauf.fall('A-28', 'Protokoll: UPDATE/DELETE als service_role abgewiesen, Kette lückenlos', async () => {
      const upd = await dienst.from('zugriffsprotokoll').update({ aktion: 'export' }).eq('org_id', orgs.H);
      const del = await dienst.from('zugriffsprotokoll').delete().eq('org_id', orgs.H);
      const kette = ok(await c('owner_h').rpc('protokoll_kette_pruefen', { p_org: orgs.H }), 'Kette');
      return !!upd.error && !!del.error && (kette || []).length > 0 && kette.every((k) => k.ok);
    });
    await lauf.fall('A-29', 'owner_h liest Gebotseinträge vor der Öffnung nur verdeckt', async () => {
      const r = ok(await c('owner_h').from('zugriffsprotokoll_sicht').select('akteur, record_id, detail').eq('org_id', orgs.H).eq('entity', 'Bid'), 'Sicht');
      return r.length >= 2 && r.every((z) => z.akteur === null && z.record_id === null);
    });
    await lauf.fall('A-30', 'leser_h liest das Protokoll nicht', async () => {
      const r = await c('leser_h').from('zugriffsprotokoll_sicht').select('id').eq('org_id', orgs.H);
      return !r.error && (r.data || []).length === 0;
    });
    await lauf.fall('A-31', 'bidder1 lädt nicht direkt aus blobs', async () => !!(await c('bidder1').storage.from('blobs').download(`${orgs.H}/${id('blob')}.json`)).error);
    await lauf.fall('A-32', 'Function freigabe: Nachbardatei/fremde Id → 403 mit Protokolleintrag', async () => {
      const r = await c('bidder1').functions.invoke('freigabe', { body: { org_id: orgs.H, record_id: id('gibtsnicht') } });
      const status = r.error?.context?.status;
      if (status === 404 && /not found|function/i.test(String(r.error?.message))) return 'SKIP Function freigabe nicht deployt';
      return status === 403;
    });
    await lauf.fall('A-33', 'planner_h ohne can_export_ifc liest ein unverknüpftes Objekt nicht', async () => !!(await c('planner_h').storage.from('blobs').download(`${orgs.H}/${id('blob')}.json`)).error);
    await lauf.fall('A-34', 'gebote: eigener Ordner ja, fremder nein; Büro liest vor der Öffnung nicht', async () => {
      const eigen = `${orgs.H}/${id('T1')}/${u.bidder1.id}/angebot.pdf`;
      const fremd = `${orgs.H}/${id('T1')}/${u.bidder2.id}/angebot.pdf`;
      const a = await c('bidder1').storage.from('gebote').upload(eigen, new Blob(['%PDF']), { contentType: 'application/pdf' });
      if (!a.error) objekte.push(['gebote', eigen]);
      const b = await c('bidder1').storage.from('gebote').upload(fremd, new Blob(['%PDF']), { contentType: 'application/pdf' });
      const lesen = await c('owner_h').storage.from('gebote').download(eigen);
      return !a.error && !!b.error && !!lesen.error;
    });
    await lauf.fall('A-35', 'llm: bidder1 → 403 für connections.list und invoke', async () => {
      const r = await c('bidder1').functions.invoke('llm', { body: { aktion: 'connections.list', org_id: orgs.H } });
      const status = r.error?.context?.status;
      if (status === 404 && /not found|function/i.test(String(r.error?.message))) return 'SKIP Function llm nicht deployt';
      const i = await c('bidder1').functions.invoke('llm', { body: { aktion: 'invoke', org_id: orgs.H, prompt: 'x' } });
      return status === 403 && i.error?.context?.status === 403;
    });
    await lauf.fall('A-36', 'einladung: planner → 403, owner → Zeilen in org_members/projekt_zugang/vergabe_teilnehmer', async () => {
      const email = `neu.${stempel}@zugriff-check.invalid`;
      // Supabase refuses invitation mails to .invalid (seen in 57-02): create
      // the account first, the function then finds it and only assigns.
      const vorab = await dienst.auth.admin.createUser({ email, password: passwort, email_confirm: true });
      if (vorab.error) throw new Error(vorab.error.message);
      u.eingeladen = { id: vorab.data.user.id, client: null };
      const body = { aktion: 'einladen', org_id: orgs.H, email, rolle: 'bidder', projekt_id: id('P1'), vergabe_id: id('T1') };
      const p = await c('planner_h').functions.invoke('einladung', { body });
      const status = p.error?.context?.status;
      if (status === 404 && /not found|function/i.test(String(p.error?.message))) return 'SKIP Function einladung nicht deployt';
      const o = await c('owner_h').functions.invoke('einladung', { body });
      if (o.error) return false;
      const neu = o.data?.nutzer_id;
      const m = await dienst.from('org_members').select('role').eq('org_id', orgs.H).eq('user_id', neu).single();
      const v = await dienst.from('vergabe_teilnehmer').select('vergabe_id').eq('org_id', orgs.H).eq('user_id', neu);
      return status === 403 && m.data?.role === 'bidder' && (v.data || []).length === 1;
    });
    await lauf.fall('A-37', 'bidder mit internem Recht → Constraint-Fehler', async () => {
      const r = await dienst.from('org_members').update({ can_edit_model: true }).eq('user_id', u.bidder1.id).eq('org_id', orgs.H);
      return !!r.error;
    });
    await lauf.fall('A-38', 'ohne Mitgliedschaft: jede RPC mit identischem Text abgewiesen', async () => {
      const texte = [];
      for (const [fn, args] of [
        ['submission_oeffnen', { p_tender: id('T1') }],
        ['submission_oeffnen', { p_tender: 'gibt-es-nicht' }],
        ['submission_frist', { p_tender: id('T1'), p_neu: new Date(Date.now() + 7200e3).toISOString(), p_grund: 'x' }],
        ['zuschlag_erteilen', { p_tender: id('T1'), p_bid: 'x' }],
        ['freigabe_erteilen', { p_tender: id('T1') }],
      ]) texte.push((await c('owner_f').rpc(fn, args)).error?.message);
      return texte.every((t) => t === 'Vorgang nicht zulässig oder nicht gefunden');
    });

    // Deadline expires (service role moves it into the past).
    ok(await dienst.from('submission').update({ frist: new Date(Date.now() - 1000).toISOString() }).eq('org_id', orgs.H).eq('tender_id', id('T1')), 'Frist verschieben');
    // A-11 over HTTP shows the refusal only; that it is the DEADLINE that refuses
    // (and not missing participation) is proven precisely in the SQL test.
    await lauf.fall('A-11', 'Gebot nach Fristablauf → abgewiesen', async () => {
      const r = await c('investor1').from('records').insert({ id: id('x11'), entity: 'Bid', org_id: orgs.H, created_by: u.investor1.id, data: { tender_id: id('T1') } });
      return !!r.error;
    });
    await lauf.fall('A-12', 'eigenes Gebot nach Fristablauf ändern → 0 Zeilen', async () => {
      if (!gebot1) return 'SKIP A-07 fehlgeschlagen';
      await c('bidder1').from('records').update({ data: { ...gebot1.data, total: 1 } }).eq('id', gebot1.id);
      const r = await dienst.from('records').select('data').eq('id', gebot1.id).single();
      return Number(r.data?.data?.total) !== 1;
    });
    await lauf.fall('A-39', 'abgelaufene Frist verlängern → abgewiesen', async () =>
      !!(await c('owner_h').rpc('submission_frist', { p_tender: id('T1'), p_neu: new Date(Date.now() + 86400e3).toISOString(), p_grund: 'x' })).error);
    await lauf.fall('A-10', 'Öffnung: planner nein, owner genau einmal, danach sichtbar', async () => {
      const p = await c('planner_h').rpc('submission_oeffnen', { p_tender: id('T1') });
      const o = await c('owner_h').rpc('submission_oeffnen', { p_tender: id('T1') });
      const zweimal = await c('owner_h').rpc('submission_oeffnen', { p_tender: id('T1') });
      return !!p.error && !o.error && (o.data || []).length === 2 && !!zweimal.error && (await anzahl(c('owner_h'), { entity: 'Bid' })) === 2;
    });
    await lauf.fall('A-40', 'Zuschlag nur per RPC, UPDATE auf versiegeltes Gebot wirkt nicht', async () => {
      if (!gebot1) return 'SKIP A-07 fehlgeschlagen';
      await c('owner_h').from('records').update({ data: { ...gebot1.data, status: 'awarded' } }).eq('id', gebot1.id);
      const vorher = await dienst.from('records').select('data').eq('id', gebot1.id).single();
      if (vorher.data?.data?.status === 'awarded') return false;
      ok(await c('owner_h').rpc('zuschlag_erteilen', { p_tender: id('T1'), p_bid: gebot1.id }), 'Zuschlag');
      const nach = await dienst.from('records').select('data').eq('id', gebot1.id).single();
      return nach.data?.data?.status === 'awarded';
    });
    await lauf.fall('A-42', 'Rechte-Matrix (grants_bericht) ohne Abweichung', async () => {
      const { vergleicheGrants } = await import('./grants-pruefen.mjs');
      const r = ok(await dienst.rpc('grants_bericht'), 'grants_bericht');
      const { zuviel, fehlt } = vergleicheGrants(r || []);
      if (zuviel.length || fehlt.length) throw new Error(`${zuviel.length} zu viel, ${fehlt.length} fehlen`);
      return true;
    });
  } catch (e) {
    console.error(`SETUP/ABLAUF abgebrochen: ${e?.message || e}`);
    lauf.ergebnisse.push({ nr: 'SETUP', text: 'Aufbau', urteil: 'FAIL', notiz: String(e?.message || e) });
  } finally {
    // ---------- Teardown (service role): objects, records, orgs, users ----------
    const aufraeumen = [];
    for (const [bucket, pfad] of objekte) aufraeumen.push(dienst.storage.from(bucket).remove([pfad]));
    await Promise.allSettled(aufraeumen);
    for (const org of [orgs.H, orgs.F].filter(Boolean)) {
      const r = await dienst.from('records').delete().eq('org_id', org);
      if (r.error) console.error(`Aufräumen records ${org}: ${r.error.message}`);
      const o = await dienst.from('orgs').delete().eq('id', org);
      if (o.error) console.error(`Aufräumen Org ${org}: ${o.error.message}`);
    }
    for (const [, nutzer] of Object.entries(u)) {
      const r = await dienst.auth.admin.deleteUser(nutzer.id);
      if (r.error) console.error(`Aufräumen Nutzer ${nutzer.id}: ${r.error.message}`);
    }
    console.log('Aufgeräumt (bis auf das Zugriffsprotokoll der Test-Büros — append-only, gewollt).');
  }
  const s = lauf.summe();
  console.log(`Ergebnis: ${s.pass} PASS, ${s.fail} FAIL, ${s.skip} SKIP${s.code === 2 ? ' — unvollständig, nicht 42/42' : ''}`);
  return s.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`FEHLER: ${e?.message || e}`); process.exit(1); });
}
