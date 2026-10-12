-- 0014_grants_zugriff.sql — Phase 74-01 Task 9: the outer gate, once over everything.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- RULE FOR EVERY FUTURE MIGRATION: every `create function` gets its
-- `revoke all … from public` line in the same block. The Postgres default is
-- EXECUTE for PUBLIC, and PostgREST publishes every function of schema public
-- as an RPC — in a draft of this plan exactly one slipped through at the
-- place of the proof.
--
-- This file
--   1. closes the default-privilege trap of 0005_grants.sql:28-29 (every NEW
--      table got full DML for authenticated, every new function EXECUTE for
--      PUBLIC) — from now on a new object is closed until granted;
--   2. takes EXECUTE away from PUBLIC and anon on every function of schema
--      public and re-grants exactly the client functions of 0006-0013;
--   3. takes everything away from anon on every table;
--   4. adds grants_bericht() — the privilege matrix for
--      scripts/grants-pruefen.mjs (service role only);
--   5. ends with a self-check that ABORTS the migration (and its transaction)
--      if a known table is open where it must not be.

-- 1. Future objects: closed by default. ----------------------------------------
alter default privileges in schema public revoke insert, update, delete on tables from authenticated;
alter default privileges in schema public revoke execute on functions from public;

-- 2. Functions. ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

-- Client functions (authenticated): guards used inside policies and the RPCs.
grant execute on function
  public.ist_mitglied(uuid),
  public.rolle_in(uuid), public.ist_intern(uuid), public.ist_extern(uuid),
  public.hat_recht(uuid, text), public.mein_kontakt(uuid), public.ist_dienst(),
  public.darf_projekt(uuid, text), public.darf_vergabe(uuid, text),
  public.entity_bereich(text), public.entity_extern(text), public.entity_modell(text),
  public.inhalt_hash(jsonb),
  public.submission_laeuft(uuid, text), public.submission_offen(uuid, text),
  public.tender_hat_submission(uuid, text),
  public.submission_anlegen(text, timestamptz), public.submission_frist(text, timestamptz, text),
  public.submission_oeffnen(text), public.gebot_zuruecknehmen(text), public.zuschlag_erteilen(text, text),
  public.protokoll_hash(text, timestamptz, bigint, uuid, text, uuid, text, text, text, jsonb),
  public.protokoll_kette_pruefen(uuid),
  public.warum_sichtbar(text),
  public.freigabe_erteilen(text, text, text), public.freigabe_zuruecknehmen(text),
  public.rueckfrage_beantworten(text, text, text),
  public.als_uuid(text), public.blob_ist_modell(uuid, text),
  public.set_updated_date()
to authenticated;

-- The service role additionally writes the log (edge functions) and reads the matrix.
grant execute on function public.protokoll_schreiben(uuid, text, text, text, text, jsonb, uuid) to service_role;

-- 3. Tables: anon gets nothing anywhere. -------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 4. The privilege matrix. -----------------------------------------------------------
-- One row per (role, object, privilege) that is GRANTED, for anon and
-- authenticated, over every table, view and function of schema public, plus
-- the column privileges on records. Service role only — the matrix describes
-- the attack surface and is no client business.
create function public.grants_bericht()
  returns table (rolle text, art text, objekt text, recht text)
language sql security definer stable set search_path = public as $$
  with rollen(r) as (values ('anon'), ('authenticated')),
  tabellen as (
    select c.oid, c.relname, c.relkind from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  ),
  rechte(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'))
  select r, case t.relkind when 'v' then 'view' else 'table' end, t.relname, p
    from rollen, tabellen t, rechte
   where has_table_privilege(r, t.oid, p)
  union all
  select r, 'column', 'records.' || a.attname, p
    from rollen, pg_attribute a, (values ('INSERT'), ('UPDATE')) as cr(p)
   where a.attrelid = 'public.records'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(r, 'public.records'::regclass, a.attname, p)
     and not has_table_privilege(r, 'public.records'::regclass, p)
  union all
  select r, 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'EXECUTE'
    from rollen, pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege(r, p.oid, 'EXECUTE')
$$;
revoke all on function public.grants_bericht() from public, anon, authenticated;
grant execute on function public.grants_bericht() to service_role;

-- 5. Self-check: abort if a known table is open. ------------------------------------
do $$
declare
  v_fehler text := '';
  v_t text;
begin
  -- anon: nothing on any table of public
  if exists (select 1 from public.grants_bericht() where rolle = 'anon' and art in ('table', 'view', 'column')) then
    v_fehler := v_fehler || ' anon hat Tabellenrechte;';
  end if;
  -- authenticated: no DML on the tables that are written only by RPC / service
  foreach v_t in array array['projekt_zugang', 'vergabe_teilnehmer', 'entity_regeln', 'submission',
                             'zugriffsprotokoll', 'llm_connections', 'orgs', 'org_members'] loop
    if exists (select 1 from public.grants_bericht()
                where rolle = 'authenticated' and art = 'table' and objekt = v_t
                  and recht in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) then
      v_fehler := v_fehler || format(' authenticated darf %s schreiben;', v_t);
    end if;
  end loop;
  -- records: table-level INSERT/UPDATE must be gone (column grants of 0008 only)
  if exists (select 1 from public.grants_bericht()
              where rolle = 'authenticated' and art = 'table' and objekt = 'records' and recht in ('INSERT', 'UPDATE')) then
    v_fehler := v_fehler || ' authenticated hat Tabellen-INSERT/UPDATE auf records;';
  end if;
  -- the log writer is never a client function
  if exists (select 1 from public.grants_bericht() where art = 'function' and objekt like 'protokoll_schreiben(%') then
    v_fehler := v_fehler || ' protokoll_schreiben ist für Clients ausführbar;';
  end if;
  if v_fehler <> '' then
    raise exception '0014 Selbstprüfung fehlgeschlagen:%', v_fehler;
  end if;
end $$;
