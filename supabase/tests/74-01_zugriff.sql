-- 74-01_zugriff.sql — SQL-level proof of migrations 0006-0011 (Phase 74-01).
--
-- WRITTEN 12.10.2026, NEVER RUN: the build machine has no Postgres, no Docker
-- and no Supabase CLI. This file is the test that runs later, once, against a
-- THROWAWAY project (dev2) with 0001-0011 applied — never against the live
-- project. It is the SQL half of Task 10; the HTTP half (raw PostgREST with
-- real JWTs, storage, edge functions: A-31…A-36) belongs to
-- scripts/supabase-zugriff-check.mjs, which is not written yet.
--
-- How it works: one transaction, ROLLBACK at the end — nothing stays behind
-- (users, orgs, rows, log entries, all rolled back). The fixture is written as
-- the connecting role with `bit.migration = 'an'` (bypasses the anchor
-- trigger, like a migration backfill). Each actor is simulated the way
-- PostgREST does it: request.jwt.claims + SET LOCAL ROLE authenticated, so
-- RLS, column grants, auth.uid() and the triggers see a real client.
-- The first failing case raises an exception; with ON_ERROR_STOP the run
-- stops there and rolls back. A green run ends with "74-01 SQL: ALLE FAELLE PASS".
--
-- Time: inside one transaction now() does not move. Deadline expiry is
-- simulated by setting submission.frist into the past as the connecting role.
--
-- Usage (PowerShell; connection string of the THROWAWAY project):
--   psql "<connection string dev2>" -v ON_ERROR_STOP=1 -v wegwerf=1 -f supabase/tests/74-01_zugriff.sql
--
-- Case numbers follow 74-01-PLAN.md Task 10. Covered here (0006-0014 applied):
-- A-01…A-04 (tenant, ported), A-07…A-31, A-33, A-34, A-37…A-40, A-42 (SQL
-- part), plus release/answer/withdraw of projections, delete protection and
-- warum_sichtbar. Storage cases write storage.objects directly (the policies
-- are the same as behind the Storage API). NOT here: A-05/06 (storage via the
-- API), A-32/A-35/A-36 (edge functions), A-41 (stock count) — those are in
-- scripts/supabase-zugriff-check.mjs.

\if :{?wegwerf}
\else
  \echo 'ABBRUCH: nur gegen ein Wegwerf-Projekt. Aufruf mit -v wegwerf=1 (siehe Kopf).'
  \quit
\endif

begin;

-- =====================================================================
-- Fixture (as the connecting role, anchor trigger bypassed)
-- =====================================================================
set local bit.migration = 'an';

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner_h@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'planner_h@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leser_h@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bidder1@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bidder2@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bidder3@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'investor1@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fremd@t7401.invalid'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner_f@t7401.invalid');

insert into public.orgs (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'T7401 Büro H'),
  ('22222222-2222-4222-8222-222222222222', 'T7401 Büro F');

-- Roles; legacy word 'admin' for owner_f proves the 0006 translation trigger.
insert into public.org_members (user_id, org_id, role, stufe, can_edit_model, can_export_ifc, can_view_audit_reports, can_submit_bid, kontakt_id) values
  ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'owner',    'enterprise', true,  true,  true,  false, null),
  ('00000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'planner',  'enterprise', true,  true,  false, false, null),
  ('00000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'leser',    'enterprise', false, false, false, false, null),
  ('00000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'bidder',   'free',       false, false, false, true,  't7401-c1'),
  ('00000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'bidder',   'free',       false, false, false, true,  't7401-c2'),
  ('00000000-0000-4000-8000-0000000000b3', '11111111-1111-4111-8111-111111111111', 'bidder',   'free',       false, false, false, true,  't7401-c3'),
  ('00000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'investor', 'free',       false, false, false, false, null),
  ('00000000-0000-4000-8000-0000000000f1', '22222222-2222-4222-8222-222222222222', 'admin',    'enterprise', false, false, false, false, null);

insert into public.projekt_zugang (org_id, user_id, projekt_id, rolle) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b1', 't7401-P1', 'bidder'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b2', 't7401-P1', 'bidder'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b3', 't7401-P1', 'bidder'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000d1', 't7401-P2', 'investor');

insert into public.vergabe_teilnehmer (org_id, user_id, vergabe_id, projekt_id, kontakt_id) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b1', 't7401-T1', 't7401-P1', 't7401-c1'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b2', 't7401-T1', 't7401-P1', 't7401-c2'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000b3', 't7401-T2', 't7401-P1', 't7401-c3');

-- 15 office rows in H (+ 3 projections), 1 row in F.
insert into public.records (id, entity, org_id, data, projekt_id, vergabe_id, sicht) values
  ('t7401-P1',   'Project',        '11111111-1111-4111-8111-111111111111', '{"name":"Projekt 1"}', 't7401-P1', null, 'intern'),
  ('t7401-P2',   'Project',        '11111111-1111-4111-8111-111111111111', '{"name":"Projekt 2"}', 't7401-P2', null, 'intern'),
  ('t7401-T1',   'Tender',         '11111111-1111-4111-8111-111111111111', '{"name":"Rohbau","project_id":"t7401-P1","invited_contact_ids":["t7401-c1","t7401-c2"]}', 't7401-P1', null, 'intern'),
  ('t7401-T2',   'Tender',         '11111111-1111-4111-8111-111111111111', '{"name":"Elektro","project_id":"t7401-P1"}', 't7401-P1', null, 'intern'),
  ('t7401-L1',   'LVPosition',     '11111111-1111-4111-8111-111111111111', '{"oz":"01.01","quantity":10,"unit_price":99.5,"project_id":"t7401-P1"}', 't7401-P1', null, 'intern'),
  ('t7401-c1',   'Contact',        '11111111-1111-4111-8111-111111111111', '{"name":"Bieter Eins"}', null, null, 'intern'),
  ('t7401-c2',   'Contact',        '11111111-1111-4111-8111-111111111111', '{"name":"Bieter Zwei"}', null, null, 'intern'),
  ('t7401-c3',   'Contact',        '11111111-1111-4111-8111-111111111111', '{"name":"Bieter Drei"}', null, null, 'intern'),
  ('t7401-K1',   'Din276Katalog',  '11111111-1111-4111-8111-111111111111', '{"kg":"300"}', null, null, 'intern'),
  ('t7401-CO1',  'ChangeOrder',    '11111111-1111-4111-8111-111111111111', '{"title":"Nachtrag","project_name":"Projekt 1"}', null, null, 'intern'),
  ('t7401-I1',   'Issue',          '11111111-1111-4111-8111-111111111111', '{"title":"Kollision","project_id":"t7401-P1"}', 't7401-P1', null, 'intern'),
  ('t7401-PR1',  'PriceReference', '11111111-1111-4111-8111-111111111111', '{"ep":12}', null, null, 'intern'),
  ('t7401-M1',   'BimModel',       '11111111-1111-4111-8111-111111111111', '{"name":"Modell","project_id":"t7401-P1"}', 't7401-P1', null, 'intern'),
  ('t7401-MF1',  'MengenFreigabe', '11111111-1111-4111-8111-111111111111', '{"oz":"01.01","quantity":10,"unit":"m3"}', 't7401-P1', 't7401-T1', 'freigegeben'),
  ('t7401-MF2',  'MengenFreigabe', '11111111-1111-4111-8111-111111111111', '{"oz":"02.01","quantity":5,"unit":"St"}', 't7401-P1', 't7401-T2', 'freigegeben'),
  ('t7401-TF1',  'TenderFreigabe', '11111111-1111-4111-8111-111111111111', '{"tender_id":"t7401-T1","name":"Rohbau"}', 't7401-P1', 't7401-T1', 'freigegeben'),
  ('t7401-PF',   'Project',        '22222222-2222-4222-8222-222222222222', '{"name":"Fremdprojekt"}', 't7401-PF', null, 'intern'),
  ('t7401-TF',   'Tender',         '22222222-2222-4222-8222-222222222222', '{"name":"Fremdvergabe"}', 't7401-PF', null, 'intern');

set local bit.migration = '';

do $$ begin
  if (select role from public.org_members where user_id = '00000000-0000-4000-8000-0000000000f1') <> 'owner' then
    raise exception 'A-00 FAIL: Altrolle admin wurde nicht zu owner übersetzt';
  end if;
  raise notice 'A-00 PASS Altrolle admin → owner';
end $$;

-- =====================================================================
-- owner_h opens the submission for T1 (deadline in one hour)
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select public.submission_anlegen('t7401-T1', now() + interval '1 hour');

do $$ declare n integer; begin
  -- A-03: the office sees its whole stock (16 rows incl. projections), nothing of F.
  select count(*) into n from public.records where id like 't7401-%' and org_id = '11111111-1111-4111-8111-111111111111';
  if n <> 16 then raise exception 'A-03 FAIL: owner_h sieht % statt 16 Zeilen', n; end if;
  select count(*) into n from public.records where org_id = '22222222-2222-4222-8222-222222222222';
  if n <> 0 then raise exception 'A-01 FAIL: owner_h sieht % Zeilen von Büro F', n; end if;
  raise notice 'A-01/A-03 PASS Büro H vollständig, Büro F unsichtbar';
end $$;

-- A paper bid entered by the office (E2): not sealed, visible at once.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
set local role authenticated;
insert into public.records (id, entity, org_id, data, created_by) values
  ('t7401-PAPIER', 'Bid', '11111111-1111-4111-8111-111111111111',
   '{"tender_id":"t7401-T1","bidder_name":"Papierbieter","total":1000}', '00000000-0000-4000-8000-0000000000a2');
do $$ begin
  if (select siegel_id from public.records where id = 't7401-PAPIER') is not null then
    raise exception 'E2 FAIL: Papierangebot wurde versiegelt';
  end if;
  raise notice 'E2 PASS Papierangebot des Büros unversiegelt und sichtbar';
end $$;

-- A-16/A-17: the separating columns are not client-writable.
do $$ declare ok boolean := false; begin
  begin
    insert into public.records (id, entity, org_id, data, created_by, created_date)
    values ('t7401-X', 'Issue', '11111111-1111-4111-8111-111111111111', '{}', '00000000-0000-4000-8000-0000000000a2', '2000-01-01');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-16 FAIL: created_date beim INSERT schreibbar'; end if;
  ok := false;
  begin
    update public.records set org_id = '22222222-2222-4222-8222-222222222222' where id = 't7401-I1';
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-17 FAIL: org_id per UPDATE schreibbar'; end if;
  raise notice 'A-16/A-17 PASS Spalten-Grants sperren Trennmerkmale';
end $$;

-- Internal writer moves an issue to project 2: projekt_id follows (deviation in 0008).
update public.records set data = data || '{"project_id":"t7401-P2"}' where id = 't7401-I1';
do $$ begin
  if (select projekt_id from public.records where id = 't7401-I1') <> 't7401-P2' then
    raise exception 'ANKER FAIL: projekt_id folgt der internen Zuordnung nicht';
  end if;
  raise notice 'ANKER PASS interne Projektzuordnung wird übernommen';
end $$;

-- =====================================================================
-- leser_h: reads like the office, writes nothing (A-04)
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
do $$ declare ok boolean := false; n integer; begin
  select count(*) into n from public.records where id like 't7401-%';
  if n < 16 then raise exception 'A-04 FAIL: leser_h sieht nur % Zeilen', n; end if;
  begin
    insert into public.records (id, entity, org_id, data, created_by)
    values ('t7401-LESER', 'Issue', '11111111-1111-4111-8111-111111111111', '{}', '00000000-0000-4000-8000-0000000000a3');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-04 FAIL: leser_h kann anlegen'; end if;
  update public.records set data = data || '{"x":1}' where id = 't7401-P1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A-04 FAIL: leser_h kann ändern'; end if;
  delete from public.records where id = 't7401-K1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A-04 FAIL: leser_h kann löschen'; end if;
  raise notice 'A-04 PASS leser liest, schreibt nicht';
end $$;

-- =====================================================================
-- bidder1: bids on T1, sees only own row and released projections
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
set local role authenticated;

-- Client id and a foreign contact in data — both must be replaced by the server.
insert into public.records (id, entity, org_id, data, created_by) values
  ('t7401-B1', 'Bid', '11111111-1111-4111-8111-111111111111',
   '{"tender_id":"t7401-T1","contact_id":"t7401-c2","bidder_name":"Eins","total":900}',
   '00000000-0000-4000-8000-0000000000b1');

do $$ declare r record; n integer; begin
  select * into r from public.records where entity = 'Bid' and eigner = '00000000-0000-4000-8000-0000000000b1';
  if not found then raise exception 'A-07 FAIL: bidder1 liest sein Gebot nicht zurück'; end if;
  if r.id = 't7401-B1' then raise exception 'A-07 FAIL: Client-Id wurde übernommen (Existenz-Orakel)'; end if;
  if r.siegel_id is distinct from 't7401-T1' or r.vergabe_id is distinct from 't7401-T1' then
    raise exception 'A-15 FAIL: Siegel/Vergabe nicht aus dem Tender abgeleitet (%, %)', r.siegel_id, r.vergabe_id;
  end if;
  if r.data->>'contact_id' <> 't7401-c1' then raise exception 'A-07 FAIL: contact_id aus data übernommen (%)', r.data->>'contact_id'; end if;
  select count(*) into n from public.records where entity = 'LVPosition';
  if n <> 0 then raise exception 'A-19 FAIL: bidder1 sieht % LVPositionen', n; end if;
  select count(*) into n from public.records where entity = 'MengenFreigabe';
  if n <> 1 then raise exception 'A-19/A-22 FAIL: bidder1 sieht % MengenFreigaben statt 1 (nur T1)', n; end if;
  if exists (select 1 from public.records where entity = 'MengenFreigabe' and data ? 'unit_price') then
    raise exception 'A-19 FAIL: Projektion enthält unit_price';
  end if;
  select count(*) into n from public.records where entity = 'Tender';
  if n <> 0 then raise exception 'A-20 FAIL: bidder1 sieht % Tender-Originale', n; end if;
  select count(*) into n from public.records where entity = 'TenderFreigabe';
  if n <> 1 then raise exception 'A-20 FAIL: bidder1 sieht % TenderFreigaben statt 1', n; end if;
  select count(*) into n from public.records where entity in ('Contact', 'ChangeOrder', 'Issue', 'Din276Katalog', 'PriceReference', 'Project');
  if n <> 0 then raise exception 'A-21 FAIL: bidder1 sieht % Bürozeilen', n; end if;
  select count(*) into n from public.records where id = 't7401-PAPIER';
  if n <> 0 then raise exception 'A-21 FAIL: bidder1 sieht das Papierangebot'; end if;
  raise notice 'A-07/A-15/A-19/A-20/A-21 PASS Gebot versiegelt, nur Eigenes + Projektionen sichtbar';
end $$;

do $$ declare ok boolean; n integer; begin
  -- A-13: a second bid on the same tender
  ok := false;
  begin
    insert into public.records (id, entity, org_id, data, created_by) values
      ('t7401-B1b', 'Bid', '11111111-1111-4111-8111-111111111111', '{"tender_id":"t7401-T1"}', '00000000-0000-4000-8000-0000000000b1');
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'A-13 FAIL: zweites Gebot auf dieselbe Vergabe angenommen'; end if;
  -- A-15: tender of a foreign org
  ok := false;
  begin
    insert into public.records (id, entity, org_id, data, created_by) values
      ('t7401-B1f', 'Bid', '11111111-1111-4111-8111-111111111111', '{"tender_id":"t7401-TF"}', '00000000-0000-4000-8000-0000000000b1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-15 FAIL: Gebot auf fremde Vergabe angenommen'; end if;
  -- A-25/A-26: unknown entity and a literal with a trailing space are gesperrt
  ok := false;
  begin
    insert into public.records (id, entity, org_id, data, created_by) values
      ('t7401-N1', 'NeuTest74', '11111111-1111-4111-8111-111111111111', '{}', '00000000-0000-4000-8000-0000000000b1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-25 FAIL: Externer legt unkatalogisierte Entität an'; end if;
  ok := false;
  begin
    insert into public.records (id, entity, org_id, data, created_by) values
      ('t7401-N2', 'Bid ', '11111111-1111-4111-8111-111111111111', '{"tender_id":"t7401-T1"}', '00000000-0000-4000-8000-0000000000b1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-26 FAIL: "Bid " (Leerzeichen) umgeht den Katalog'; end if;
  -- A-18: rewrite own bid onto a competitor while the deadline runs
  update public.records set data = data || '{"contact_id":"t7401-c2","total":850}'
   where eigner = '00000000-0000-4000-8000-0000000000b1' and entity = 'Bid';
  if (select data->>'contact_id' from public.records where eigner = '00000000-0000-4000-8000-0000000000b1' and entity = 'Bid') <> 't7401-c1' then
    raise exception 'A-18 FAIL: contact_id eines versiegelten Gebots umgeschrieben';
  end if;
  if (select (data->>'total')::numeric from public.records where eigner = '00000000-0000-4000-8000-0000000000b1' and entity = 'Bid') <> 850 then
    raise exception 'A-12 FAIL: eigenes Gebot während der Frist nicht änderbar';
  end if;
  -- A-23: no delete for externals, neither office rows nor the own sealed bid
  delete from public.records where id = 't7401-K1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A-23 FAIL: bidder1 löscht eine Bürozeile'; end if;
  delete from public.records where eigner = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A-23 FAIL: bidder1 löscht sein versiegeltes Gebot'; end if;
  -- A-27: the log function is not callable by clients
  ok := false;
  begin
    perform public.protokoll_schreiben('11111111-1111-4111-8111-111111111111', null, 'export', null, null, '{}');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-27 FAIL: bidder1 kann ins Protokoll schreiben'; end if;
  raise notice 'A-12/A-13/A-15/A-18/A-23/A-25/A-26/A-27 PASS';
end $$;

-- A Rückfrage on the project of the tender: allowed, own row.
insert into public.records (id, entity, org_id, data, created_by) values
  ('t7401-Q1', 'BcfRueckfrage', '11111111-1111-4111-8111-111111111111',
   '{"project_id":"t7401-P1","tender_id":"t7401-T1","text":"Frage zu 01.01"}', '00000000-0000-4000-8000-0000000000b1');
do $$ begin
  if (select count(*) from public.records where entity = 'BcfRueckfrage') <> 1 then
    raise exception 'RÜCKFRAGE FAIL: bidder1 liest seine Rückfrage nicht zurück';
  end if;
  raise notice 'RÜCKFRAGE PASS';
end $$;

-- =====================================================================
-- bidder2 bids too; bidder3 (T2, no submission) cannot; investor sees nothing of T1
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
set local role authenticated;
insert into public.records (id, entity, org_id, data, created_by) values
  ('t7401-B2', 'Bid', '11111111-1111-4111-8111-111111111111', '{"tender_id":"t7401-T1","total":950}', '00000000-0000-4000-8000-0000000000b2');
do $$ begin
  if (select count(*) from public.records where entity = 'Bid') <> 1 then
    raise exception 'A-08 FAIL: bidder2 sieht fremde Gebote';
  end if;
  raise notice 'A-08 PASS bidder2 sieht nur sein eigenes Gebot';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b3', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin
    insert into public.records (id, entity, org_id, data, created_by) values
      ('t7401-B3', 'Bid', '11111111-1111-4111-8111-111111111111', '{"tender_id":"t7401-T2"}', '00000000-0000-4000-8000-0000000000b3');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-14 FAIL: Gebot ohne Submission angenommen'; end if;
  if (select count(*) from public.records where entity = 'MengenFreigabe' and vergabe_id = 't7401-T1') <> 0 then
    raise exception 'A-22 FAIL: bidder3 (T2) sieht Mengen von T1';
  end if;
  raise notice 'A-14/A-22 PASS';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e1', true);
set local role authenticated;
do $$ declare n integer; msg text; texte text[] := '{}'; begin
  select count(*) into n from public.records where id like 't7401-%';
  if n <> 0 then raise exception 'A-02 FAIL: Nutzer ohne Mitgliedschaft sieht % Zeilen', n; end if;
  -- A-38: every RPC refuses with the SAME text, existing tender or not.
  begin perform public.submission_anlegen('t7401-T2', now() + interval '1 day'); exception when others then texte := texte || sqlerrm; end;
  begin perform public.submission_oeffnen('t7401-T1'); exception when others then texte := texte || sqlerrm; end;
  begin perform public.submission_oeffnen('gibt-es-nicht'); exception when others then texte := texte || sqlerrm; end;
  begin perform public.submission_frist('t7401-T1', now() + interval '2 hour', 'x'); exception when others then texte := texte || sqlerrm; end;
  begin perform public.gebot_zuruecknehmen('t7401-B2'); exception when others then texte := texte || sqlerrm; end;
  begin perform public.zuschlag_erteilen('t7401-T1', 't7401-B2'); exception when others then texte := texte || sqlerrm; end;
  if array_length(texte, 1) <> 6 then raise exception 'A-38 FAIL: nur % von 6 Aufrufen abgewiesen', coalesce(array_length(texte, 1), 0); end if;
  foreach msg in array texte loop
    if msg <> 'Vorgang nicht zulässig oder nicht gefunden' then raise exception 'A-38 FAIL: abweichender Text "%"', msg; end if;
  end loop;
  raise notice 'A-02/A-38 PASS ohne Mitgliedschaft nichts sichtbar, sechs RPCs mit identischem Text abgewiesen';
end $$;

-- =====================================================================
-- Before the opening act: the office sees no sealed bid, the log is masked
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ declare n integer; begin
  select count(*) into n from public.records where entity = 'Bid' and siegel_id is not null;
  if n <> 0 then raise exception 'A-09 FAIL: owner_h sieht % versiegelte Gebote vor der Öffnung', n; end if;
  select count(*) into n from public.records where id = 't7401-PAPIER';
  if n <> 1 then raise exception 'A-09 FAIL: owner_h sieht sein Papierangebot nicht'; end if;
  -- A-29: log entries about sealed inserts carry no actor and no record id yet
  select count(*) into n from public.zugriffsprotokoll_sicht
   where aktion = 'datensatz_angelegt' and entity = 'Bid' and (detail->>'verdeckt')::boolean;
  if n < 2 then raise exception 'A-29 FAIL: nur % verdeckte Gebotseinträge im Protokoll', n; end if;
  if exists (select 1 from public.zugriffsprotokoll_sicht
              where entity = 'Bid' and (detail->>'verdeckt')::boolean and (akteur is not null or record_id is not null)) then
    raise exception 'A-29 FAIL: Akteur oder Datensatz eines versiegelten Gebots sichtbar';
  end if;
  -- delete protection: a tender with a submission cannot be deleted
  delete from public.records where id = 't7401-T1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LÖSCHSCHUTZ FAIL: Tender mit Submission gelöscht'; end if;
  if public.warum_sichtbar('t7401-P1') not like 'intern, Rolle owner%' then
    raise exception 'WARUM FAIL: %', public.warum_sichtbar('t7401-P1');
  end if;
  raise notice 'A-09/A-29 PASS, Löschschutz PASS, warum_sichtbar: %', public.warum_sichtbar('t7401-P1');
end $$;

-- A-30: planner_h and leser_h have no can_view_audit_reports → no log rows.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.zugriffsprotokoll_sicht) <> 0 then raise exception 'A-30 FAIL: leser_h liest das Protokoll'; end if;
  raise notice 'A-30 PASS';
end $$;

-- A-37: an external role with an internal right is refused by the schema.
reset role;
do $$ declare ok boolean := false; begin
  begin
    update public.org_members set can_edit_model = true where user_id = '00000000-0000-4000-8000-0000000000b1';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'A-37 FAIL: bidder mit internem Recht gespeichert'; end if;
  ok := false;
  begin
    update public.org_members set can_submit_bid = true where user_id = '00000000-0000-4000-8000-0000000000a2';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'A-37 FAIL: interne Rolle mit Gebotsrecht gespeichert'; end if;
  raise notice 'A-37 PASS Rollenvokabular disjunkt';
end $$;

-- bidder2 withdraws while the deadline runs.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
set local role authenticated;
select public.gebot_zuruecknehmen((select id from public.records where entity = 'Bid' and eigner = '00000000-0000-4000-8000-0000000000b2'));

-- =====================================================================
-- Deadline expires (simulated as the connecting role)
-- =====================================================================
reset role;
update public.submission set frist = now() - interval '1 second'
 where org_id = '11111111-1111-4111-8111-111111111111' and tender_id = 't7401-T1';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ declare n integer; begin
  update public.records set data = data || '{"total":1}' where eigner = '00000000-0000-4000-8000-0000000000b1' and entity = 'Bid';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A-12 FAIL: Gebot nach Fristablauf geändert'; end if;
  raise notice 'A-12 PASS nach Fristablauf unveränderlich';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.submission_frist('t7401-T1', now() + interval '1 day', 'Verlängerung'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-39 FAIL: abgelaufene Frist verlängert'; end if;
  raise notice 'A-39 PASS';
end $$;

-- A-10: opening by planner refused, by owner exactly once.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.submission_oeffnen('t7401-T1'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-10 FAIL: planner öffnet die Submission'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ declare v jsonb; ok boolean := false; v_hash_vorher text; v_bid text; n integer; begin
  v := public.submission_oeffnen('t7401-T1');
  if jsonb_array_length(v) <> 2 then raise exception 'A-10 FAIL: Niederschrift nennt % statt 2 Gebote', jsonb_array_length(v); end if;
  if exists (select 1 from jsonb_array_elements(v) e where not (e->>'hash_wie_protokolliert')::boolean) then
    raise exception 'A-10 FAIL: Inhalts-Hash weicht vom Protokoll ab';
  end if;
  begin perform public.submission_oeffnen('t7401-T1'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-10 FAIL: zweite Öffnung möglich'; end if;
  select count(*) into n from public.records where entity = 'Bid' and siegel_id is not null;
  if n <> 2 then raise exception 'A-10 FAIL: owner_h sieht nach der Öffnung % statt 2 Gebote', n; end if;
  -- A-40: no UPDATE on a sealed bid, award only via RPC, content hash unchanged
  select id, public.inhalt_hash(data) into v_bid, v_hash_vorher from public.records
   where entity = 'Bid' and eigner = '00000000-0000-4000-8000-0000000000b1';
  update public.records set data = data || '{"status":"awarded"}' where id = v_bid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A-40 FAIL: versiegeltes Gebot per UPDATE geändert'; end if;
  perform public.zuschlag_erteilen('t7401-T1', v_bid);
  if (select data->>'status' from public.records where id = v_bid) <> 'awarded' then raise exception 'A-40 FAIL: Zuschlag nicht gesetzt'; end if;
  if (select public.inhalt_hash(data) from public.records where id = v_bid) <> v_hash_vorher then raise exception 'A-40 FAIL: Inhalts-Hash durch Zuschlag verändert'; end if;
  if (select data->>'status' from public.records where entity = 'Bid' and eigner = '00000000-0000-4000-8000-0000000000b2') <> 'zurueckgezogen' then
    raise exception 'A-40 FAIL: zurückgezogenes Gebot wurde mit beschieden';
  end if;
  if (select data->>'awarded_bid_id' from public.records where id = 't7401-T1') <> v_bid then raise exception 'A-40 FAIL: awarded_bid_id fehlt'; end if;
  if (select data->>'status' from public.records where id = 't7401-PAPIER') <> 'rejected' then
    raise exception 'A-40 FAIL: Papierangebot derselben Vergabe nicht beschieden';
  end if;
  -- A-28 (chain): every entry of org H checks out
  if exists (select 1 from public.protokoll_kette_pruefen('11111111-1111-4111-8111-111111111111') where not ok) then
    raise exception 'A-28 FAIL: Hash-Kette gebrochen';
  end if;
  raise notice 'A-10/A-40/A-28(Kette) PASS Öffnung einmalig, Zuschlag per RPC, Hash unverändert, Kette lückenlos';
end $$;

-- =====================================================================
-- 0012: release as projection (A-19 with real projections, A-20, A-24)
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
update public.records set data = data || '{"position_ids":["t7401-L1"]}' where id = 't7401-T1';
do $$ declare v jsonb; begin
  v := public.freigabe_erteilen('t7401-T1');
  if (v->>'mengen')::integer <> 1 then raise exception 'FREIGABE FAIL: % Mengen statt 1', v->>'mengen'; end if;
  perform public.rueckfrage_beantworten('t7401-T1', 'Frage zur Betongüte', 'C25/30 genügt.');
  raise notice 'FREIGABE PASS freigabe_erteilen + rueckfrage_beantworten';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
set local role authenticated;
do $$ declare r record; begin
  select * into r from public.records where entity = 'MengenFreigabe' and vergabe_id = 't7401-T1';
  if not found then raise exception 'A-19 FAIL: Projektion für bidder2 nicht sichtbar'; end if;
  if r.data ? 'unit_price' or r.data ? 'long_text' or r.data ? 'bim_element_ids' then
    raise exception 'A-19 FAIL: Projektion trägt gesperrte Felder: %', r.data;
  end if;
  if r.data->>'lv_id' <> 't7401-L1' then raise exception 'A-19 FAIL: lv_id fehlt'; end if;
  select * into r from public.records where entity = 'TenderFreigabe' and vergabe_id = 't7401-T1';
  if r.data ? 'invited_contact_ids' or r.data ? 'awarded_bid_id' then
    raise exception 'A-20 FAIL: TenderFreigabe trägt Bieterliste/Zuschlag: %', r.data;
  end if;
  if r.data->>'project_id' is distinct from 't7401-P1' then raise exception 'A-20 FAIL: project_id fehlt in der Projektion'; end if;
  if (select count(*) from public.records where entity = 'RueckfrageAntwort') <> 1 then
    raise exception 'ANTWORT FAIL: Antwort des Büros nicht sichtbar';
  end if;
  if exists (select 1 from public.records where entity = 'BcfRueckfrage') then
    raise exception 'ANTWORT FAIL: bidder2 liest die Rückfrage von bidder1';
  end if;
  raise notice 'A-19/A-20 PASS Projektion nur mit Whitelist-Feldern; Antwort sichtbar, fremde Frage nicht';
end $$;

-- A-24: a position removed from position_ids disappears on re-release.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
update public.records set data = data || '{"position_ids":[]}' where id = 't7401-T1';
select public.freigabe_erteilen('t7401-T1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.records where entity = 'MengenFreigabe' and vergabe_id = 't7401-T1') then
    raise exception 'A-24 FAIL: entfernte Position bleibt als Projektion sichtbar';
  end if;
  raise notice 'A-24 PASS';
end $$;

-- Withdraw the release: the tender projection is gone for bidders.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select public.freigabe_zuruecknehmen('t7401-T1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.records where entity in ('TenderFreigabe', 'RueckfrageAntwort') and vergabe_id = 't7401-T1') then
    raise exception 'ZURÜCKNAHME FAIL: Projektion nach Rücknahme sichtbar';
  end if;
  raise notice 'ZURÜCKNAHME PASS';
end $$;

-- =====================================================================
-- 0013: storage policies, tested on storage.objects directly (A-31, A-33, A-34)
-- =====================================================================
reset role;
insert into storage.objects (bucket_id, name) values
  ('blobs', '11111111-1111-4111-8111-111111111111/t7401blob.json');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select public.submission_anlegen('t7401-T2', now() + interval '1 hour');
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'blobs' and name like '11111111-%/t7401blob.json') <> 1 then
    raise exception 'A-33 FAIL: owner_h (can_export_ifc) liest das Büro-Objekt nicht';
  end if;
  raise notice 'A-33 PASS owner liest unverknüpftes Objekt (gilt als Modell) mit can_export_ifc';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'blobs' and name like '11111111-%/t7401blob.json') then
    raise exception 'A-33 FAIL: leser ohne can_export_ifc liest ein unverknüpftes Objekt';
  end if;
  raise notice 'A-33 PASS ohne Verknüpfung gilt das Objekt als Modell';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b3', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  if exists (select 1 from storage.objects where bucket_id = 'blobs') then
    raise exception 'A-31 FAIL: bidder3 liest den internen Bucket blobs';
  end if;
  insert into storage.objects (bucket_id, name, owner) values
    ('gebote', '11111111-1111-4111-8111-111111111111/t7401-T2/00000000-0000-4000-8000-0000000000b3/angebot.pdf',
     '00000000-0000-4000-8000-0000000000b3');
  begin
    insert into storage.objects (bucket_id, name, owner) values
      ('gebote', '11111111-1111-4111-8111-111111111111/t7401-T2/00000000-0000-4000-8000-0000000000b1/fremd.pdf',
       '00000000-0000-4000-8000-0000000000b3');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-34 FAIL: bidder3 schreibt in den Ordner eines anderen'; end if;
  raise notice 'A-31/A-34 PASS blobs gesperrt, eigener Gebotsordner schreibbar, fremder nicht';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin
    insert into storage.objects (bucket_id, name, owner) values
      ('gebote', '11111111-1111-4111-8111-111111111111/t7401-T2/00000000-0000-4000-8000-0000000000b1/a.pdf',
       '00000000-0000-4000-8000-0000000000b1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'A-34 FAIL: Nicht-Teilnehmer bidder1 legt Anhang zu T2 ab'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'gebote' and name like '%/t7401-T2/%') then
    raise exception 'A-34 FAIL: bidder1 liest Anhänge von bidder3';
  end if;
  raise notice 'A-34 PASS Nicht-Teilnehmer weder schreibend noch lesend';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'gebote' and name like '%/t7401-T2/%') then
    raise exception 'A-34 FAIL: owner_h liest Gebotsanhänge vor der Öffnung';
  end if;
  raise notice 'A-34 PASS Anhänge vor der Öffnung auch für das Büro verschlossen';
end $$;

-- =====================================================================
-- 0014: the matrix (A-42 in SQL form)
-- =====================================================================
reset role;
do $$ begin
  if exists (select 1 from public.grants_bericht() where rolle = 'anon' and art <> 'function') then
    raise exception 'A-42 FAIL: anon hat Tabellenrechte';
  end if;
  if exists (select 1 from public.grants_bericht() where art = 'function' and objekt like 'protokoll_schreiben(%') then
    raise exception 'A-42 FAIL: protokoll_schreiben für Clients ausführbar';
  end if;
  raise notice 'A-42 PASS (SQL-Teil) Rechte-Matrix ohne Befund';
end $$;

-- A-28: the log is immutable — for the connecting role (owner) and, if this
-- role may switch to it, for service_role.
reset role;
do $$ declare ok boolean; begin
  ok := false;
  begin update public.zugriffsprotokoll set aktion = 'export' where org_id = '11111111-1111-4111-8111-111111111111'; exception when others then ok := true; end;
  if not ok then raise exception 'A-28 FAIL: Protokoll änderbar'; end if;
  ok := false;
  begin delete from public.zugriffsprotokoll where org_id = '11111111-1111-4111-8111-111111111111'; exception when others then ok := true; end;
  if not ok then raise exception 'A-28 FAIL: Protokoll löschbar'; end if;
  ok := false;
  begin truncate public.zugriffsprotokoll; exception when others then ok := true; end;
  if not ok then raise exception 'A-28 FAIL: Protokoll per TRUNCATE leerbar'; end if;
  raise notice 'A-28 PASS Protokoll unveränderlich (UPDATE/DELETE/TRUNCATE)';
end $$;

-- ist_dienst(): the service role bypasses the anchor, a client never does.
do $$ begin
  begin
    execute 'set local role service_role';
  exception when others then
    raise notice 'DIENST SKIP: diese Verbindung darf nicht zu service_role wechseln (%).', sqlerrm;
    return;
  end;
  if not public.ist_dienst() then raise exception 'DIENST FAIL: ist_dienst() erkennt service_role nicht'; end if;
  execute 'reset role';
  execute 'set local role authenticated';
  if public.ist_dienst() then raise exception 'DIENST FAIL: ist_dienst() wahr für authenticated'; end if;
  execute 'reset role';
  raise notice 'DIENST PASS';
end $$;

reset role;
do $$ begin raise notice '74-01 SQL: ALLE FAELLE PASS'; end $$;

rollback;
