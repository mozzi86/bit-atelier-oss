-- 110-01_bauherr.sql — SQL-level proof of migration 0016 (client role `bauherr`).
--
-- WRITTEN 05.11.2026, NEVER RUN: the build machine has no Postgres (same as
-- 74-01_zugriff.sql). Runs once against a THROWAWAY project with 0001…0016
-- applied — never against the live project. One transaction, ROLLBACK at the
-- end; nothing stays behind. Actors are simulated the way PostgREST does it
-- (request.jwt.claims + SET LOCAL ROLE authenticated). The first failing case
-- raises; a green run ends with "110-01 SQL: ALLE FAELLE PASS".
--
-- Usage (PowerShell; connection string of the THROWAWAY project):
--   psql "<connection string Wegwerf>" -v ON_ERROR_STOP=1 -v wegwerf=1 -f supabase/tests/110-01_bauherr.sql
--
-- Cases B-01…B-21 follow 110-01-PLAN.md Task 4. Ids of projections created on
-- the way are kept in transaction-local settings (t11001.*), because every DO
-- block is its own scope.

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
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@t11001.invalid'),
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'planner@t11001.invalid'),
  ('00000000-0000-4000-8000-0000000001a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leser@t11001.invalid'),
  ('00000000-0000-4000-8000-0000000001c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bauherr1@t11001.invalid'),
  ('00000000-0000-4000-8000-0000000001c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bauherr2@t11001.invalid'),
  ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bieter1@t11001.invalid');

insert into public.orgs (id, name) values ('33333333-3333-4333-8333-333333333333', 'T11001 Büro');

insert into public.org_members (user_id, org_id, role, stufe, can_edit_model, can_export_ifc, can_view_audit_reports, can_submit_bid) values
  ('00000000-0000-4000-8000-0000000001a1', '33333333-3333-4333-8333-333333333333', 'owner',   'enterprise', true,  true,  true,  false),
  ('00000000-0000-4000-8000-0000000001a2', '33333333-3333-4333-8333-333333333333', 'planner', 'enterprise', true,  true,  false, false),
  ('00000000-0000-4000-8000-0000000001a3', '33333333-3333-4333-8333-333333333333', 'leser',   'enterprise', false, false, false, false),
  ('00000000-0000-4000-8000-0000000001c1', '33333333-3333-4333-8333-333333333333', 'bauherr', 'free',       false, false, false, false),
  ('00000000-0000-4000-8000-0000000001c2', '33333333-3333-4333-8333-333333333333', 'bauherr', 'free',       false, false, false, false),
  ('00000000-0000-4000-8000-0000000001b1', '33333333-3333-4333-8333-333333333333', 'bidder',  'free',       false, false, false, true);

insert into public.projekt_zugang (org_id, user_id, projekt_id, rolle) values
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-0000000001c1', 't11001-P1', 'bauherr'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-0000000001c2', 't11001-P2', 'bauherr'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-0000000001b1', 't11001-P1', 'bidder');
insert into public.vergabe_teilnehmer (org_id, user_id, vergabe_id, projekt_id) values
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-0000000001b1', 't11001-T1', 't11001-P1');

insert into public.records (id, entity, org_id, data, projekt_id, vergabe_id, sicht) values
  ('t11001-P1',  'Project',          '33333333-3333-4333-8333-333333333333', '{"name":"Projekt 1","notes":"intern","estimated_cost":500000}', 't11001-P1', null, 'intern'),
  ('t11001-P2',  'Project',          '33333333-3333-4333-8333-333333333333', '{"name":"Projekt 2"}', 't11001-P2', null, 'intern'),
  ('t11001-PL1', 'Plan',             '33333333-3333-4333-8333-333333333333', '{"project_id":"t11001-P1","nr":"A-101","titel":"Grundriss","status":"vorabzug"}', 't11001-P1', null, 'intern'),
  ('t11001-D1',  'Document',         '33333333-3333-4333-8333-333333333333', '{"project_id":"t11001-P1","name":"Honorar.pdf","bereich":"buero"}', 't11001-P1', null, 'intern'),
  ('t11001-R1',  'Ausgangsrechnung', '33333333-3333-4333-8333-333333333333', '{"project_id":"t11001-P1","nummer":"R-1","status":"entwurf"}', 't11001-P1', null, 'intern'),
  ('t11001-R2',  'Ausgangsrechnung', '33333333-3333-4333-8333-333333333333', '{"project_id":"t11001-P1","nummer":"R-2","status":"gestellt"}', 't11001-P1', null, 'intern'),
  ('t11001-T1',  'Tender',           '33333333-3333-4333-8333-333333333333', '{"project_id":"t11001-P1","name":"Rohbau"}', 't11001-P1', null, 'intern'),
  ('t11001-TF1', 'TenderFreigabe',   '33333333-3333-4333-8333-333333333333', '{"tender_id":"t11001-T1","project_id":"t11001-P1"}', 't11001-P1', 't11001-T1', 'freigegeben');

set local bit.migration = '';

-- =====================================================================
-- owner: releases
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001a1', true);
set local role authenticated;

do $$ declare v text; d jsonb; ok boolean := false; begin
  -- B-01: extra keys of the client mapping are stripped; project_id is the server's.
  v := public.bauherr_freigeben('BauherrProjekt', 't11001-P1',
         '{"name":"Projekt 1","notes":"intern","honorar":1,"project_id":"t11001-P2","status":"Entwurf"}'::jsonb);
  perform set_config('t11001.projekt', v, true);
  select data into d from public.records where id = v;
  if d ? 'notes' or d ? 'honorar' or d->>'project_id' <> 't11001-P1' or d->>'name' <> 'Projekt 1' then
    raise exception 'B-01 FAIL: Projektion nicht bereinigt: %', d;
  end if;
  raise notice 'B-01 PASS Projektion bereinigt, project_id vom Server';

  -- B-02: an object under an allowed scalar key is dropped; decision flag stays.
  v := public.bauherr_freigeben('BauherrPlan', 't11001-PL1',
         '{"titel":{"versteckt":"x"},"plannummer":"A-101","entscheidung_offen":true}'::jsonb, 'A-101.pdf');
  perform set_config('t11001.plan', v, true);
  select data into d from public.records where id = v;
  if d ? 'titel' or (d->>'entscheidung_offen')::boolean is not true or d->>'datei' <> 'A-101.pdf' or (d->>'freigegeben')::boolean is not true then
    raise exception 'B-02 FAIL: %', d;
  end if;
  raise notice 'B-02 PASS Objekt unter Skalarschlüssel verworfen, Datei und Entscheidung gesetzt';

  -- B-03: an office document never goes out.
  begin
    perform public.bauherr_freigeben('BauherrDokument', 't11001-D1', '{"titel":"x"}'::jsonb);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-03 FAIL: Büro-Dokument freigegeben'; end if;
  ok := false;

  -- B-04: draft invoice refused, issued invoice released.
  begin
    perform public.bauherr_freigeben('BauherrRechnung', 't11001-R1', '{"nummer":"R-1"}'::jsonb);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-04 FAIL: Rechnungsentwurf freigegeben'; end if;
  ok := false;
  perform set_config('t11001.rechnung', public.bauherr_freigeben('BauherrRechnung', 't11001-R2', '{"nummer":"R-2"}'::jsonb), true);

  -- B-05: wrong source entity, IFC file name, folder in file name.
  begin
    perform public.bauherr_freigeben('BauherrPlan', 't11001-R2', '{}'::jsonb);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-05 FAIL: falsche Quelle angenommen'; end if;
  ok := false;
  -- a draft plan without a decision request (D-BH-05)
  begin
    perform public.bauherr_freigeben('BauherrPlan', 't11001-PL1', '{"plannummer":"A-101"}'::jsonb);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-05 FAIL: Vorabzug ohne Entscheidungsanfrage freigegeben'; end if;
  ok := false;
  begin
    perform public.bauherr_freigeben('BauherrPlan', 't11001-PL1', '{"entscheidung_offen":true}'::jsonb, 'modell.ifc');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-05 FAIL: IFC-Original als Datei angenommen'; end if;
  ok := false;
  begin
    perform public.bauherr_freigeben('BauherrPlan', 't11001-PL1', '{"entscheidung_offen":true}'::jsonb, '../x.pdf');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-05 FAIL: Ordner im Dateinamen angenommen'; end if;
  raise notice 'B-03/B-04/B-05 PASS Büro-Dokument, Entwurf, falsche Quelle, Vorabzug ohne Anfrage, IFC, Ordner abgewiesen';
end $$;

-- B-06: `leser` releases nothing.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001a3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001a3', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin
    perform public.bauherr_freigeben('BauherrProjekt', 't11001-P1', '{}'::jsonb);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-06 FAIL: leser gibt frei'; end if;
  raise notice 'B-06 PASS leser gibt nichts frei';
end $$;

-- =====================================================================
-- bauherr1 (P1): reads
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001c1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001c1', true);
set local role authenticated;

do $$ declare n integer; begin
  -- B-07: exactly the three projections of P1; no original, nothing of P2, no bidder projection.
  select count(*) into n from public.records where org_id = '33333333-3333-4333-8333-333333333333';
  if n <> 3 then raise exception 'B-07 FAIL: bauherr1 sieht % statt 3 Zeilen', n; end if;
  select count(*) into n from public.records where entity in ('Project', 'Plan', 'Document', 'Ausgangsrechnung', 'Tender', 'TenderFreigabe');
  if n <> 0 then raise exception 'B-07 FAIL: bauherr1 sieht % Originale/Bieterzeilen', n; end if;
  raise notice 'B-07 PASS bauherr1 sieht genau seine drei Projektionen';
end $$;

-- =====================================================================
-- bauherr1: writes
-- =====================================================================
do $$ declare v text; d jsonb; ok boolean := false; n integer; begin
  -- B-08: approval of the plan projection; data stripped, server time, owner set.
  insert into public.records (id, entity, org_id, data, created_by)
  values ('egal', 'BauherrRueckmeldung', '33333333-3333-4333-8333-333333333333',
          jsonb_build_object('project_id', 't11001-P1', 'art', 'freigabe', 'bezug_id', current_setting('t11001.plan'),
                             'zeitpunkt', '2000-01-01', 'bezug_entity', 'Project', 'geheim', 'x'),
          '00000000-0000-4000-8000-0000000001c1')
  returning id, data into v, d;
  perform set_config('t11001.rueck', v, true);
  if v = 'egal' or d ? 'geheim' or d->>'bezug_entity' <> 'BauherrPlan' or (d->>'zeitpunkt')::timestamptz < now() - interval '1 minute' then
    raise exception 'B-08 FAIL: %', d;
  end if;
  if (select eigner from public.records where id = v) <> '00000000-0000-4000-8000-0000000001c1' then
    raise exception 'B-08 FAIL: eigner nicht gesetzt';
  end if;
  raise notice 'B-08 PASS Freigabe angelegt, bereinigt, Serverzeit, eigene Zeile';

  -- B-09: a decision on a projection that asks for none.
  begin
    insert into public.records (id, entity, org_id, data, created_by)
    values ('x', 'BauherrRueckmeldung', '33333333-3333-4333-8333-333333333333',
            jsonb_build_object('project_id', 't11001-P1', 'art', 'freigabe', 'bezug_id', current_setting('t11001.projekt')),
            '00000000-0000-4000-8000-0000000001c1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-09 FAIL: Entscheidung ohne Anfrage angenommen'; end if;
  ok := false;

  -- B-10: a row on the other client's project (policy: not client of P2).
  begin
    insert into public.records (id, entity, org_id, data, created_by)
    values ('x', 'BauherrRueckmeldung', '33333333-3333-4333-8333-333333333333',
            '{"project_id":"t11001-P2","art":"frage","text":"?"}', '00000000-0000-4000-8000-0000000001c1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-10 FAIL: Zeile auf fremdem Projekt angelegt'; end if;
  ok := false;

  -- B-11: a projection kind is not writable by the client.
  begin
    insert into public.records (id, entity, org_id, data, created_by)
    values ('x', 'BauherrProjekt', '33333333-3333-4333-8333-333333333333',
            '{"project_id":"t11001-P1","name":"selbst"}', '00000000-0000-4000-8000-0000000001c1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-11 FAIL: Projektion vom Bauherrn geschrieben'; end if;
  ok := false;

  -- B-12: a question, too long → refused; normal → accepted.
  begin
    insert into public.records (id, entity, org_id, data, created_by)
    values ('x', 'BauherrRueckmeldung', '33333333-3333-4333-8333-333333333333',
            jsonb_build_object('project_id', 't11001-P1', 'art', 'frage', 'text', repeat('x', 4001)),
            '00000000-0000-4000-8000-0000000001c1');
  exception when string_data_right_truncation then ok := true; end;
  if not ok then raise exception 'B-12 FAIL: überlanger Text angenommen'; end if;
  insert into public.records (id, entity, org_id, data, created_by)
  values ('x', 'BauherrRueckmeldung', '33333333-3333-4333-8333-333333333333',
          '{"project_id":"t11001-P1","art":"frage","text":"Wann ist Richtfest?"}', '00000000-0000-4000-8000-0000000001c1')
  returning id into v;
  perform set_config('t11001.frage', v, true);

  -- B-13: own rows are immutable and undeletable.
  update public.records set data = data || '{"art":"ablehnung"}' where id = current_setting('t11001.rueck');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B-13 FAIL: eigene Entscheidung geändert'; end if;
  delete from public.records where id = current_setting('t11001.rueck');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B-13 FAIL: eigene Entscheidung gelöscht'; end if;
  raise notice 'B-09…B-13 PASS Entscheidung ohne Anfrage, fremdes Projekt, Projektion, Überlänge abgewiesen; eigene Zeilen unveränderlich';

  -- B-14: warum_sichtbar for the own projection.
  if public.warum_sichtbar(current_setting('t11001.plan')) not like 'Projektion, Projekt t11001-P1%' then
    raise exception 'B-14 FAIL: warum_sichtbar = %', public.warum_sichtbar(current_setting('t11001.plan'));
  end if;
  raise notice 'B-14 PASS warum_sichtbar nennt die Projektion';
end $$;

-- =====================================================================
-- bidder1 (P1 + T1) and bauherr2 (P2): see nothing of the client
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001b1', true);
set local role authenticated;
do $$ declare n integer; ok boolean := false; begin
  -- B-15: same project, other audience.
  select count(*) into n from public.records where entity like 'Bauherr%';
  if n <> 0 then raise exception 'B-15 FAIL: Bieter sieht % Bauherren-Zeilen', n; end if;
  select count(*) into n from public.records where id = 't11001-TF1';
  if n <> 1 then raise exception 'B-15 FAIL: Bieter sieht seine Vergabe nicht mehr'; end if;
  if public.warum_sichtbar(current_setting('t11001.plan')) not like 'nicht sichtbar%' then
    raise exception 'B-15 FAIL: warum_sichtbar für Bieter = %', public.warum_sichtbar(current_setting('t11001.plan'));
  end if;
  -- B-16: a bidder cannot write a client row on the project.
  begin
    insert into public.records (id, entity, org_id, data, created_by)
    values ('x', 'BauherrRueckmeldung', '33333333-3333-4333-8333-333333333333',
            '{"project_id":"t11001-P1","art":"frage","text":"?"}', '00000000-0000-4000-8000-0000000001b1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-16 FAIL: Bieter schreibt Bauherren-Zeile'; end if;
  raise notice 'B-15/B-16 PASS Bieter desselben Projekts sieht und schreibt nichts vom Bauherrn';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001c2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001c2', true);
set local role authenticated;
do $$ declare n integer; begin
  select count(*) into n from public.records where org_id = '33333333-3333-4333-8333-333333333333';
  if n <> 0 then raise exception 'B-17 FAIL: bauherr2 sieht % Zeilen von P1', n; end if;
  raise notice 'B-17 PASS anderer Bauherr sieht nichts';
end $$;

-- =====================================================================
-- owner: answer, withdraw, re-release; office sees the client rows
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001a1', true);
set local role authenticated;
do $$ declare v text; n integer; begin
  select count(*) into n from public.records where entity = 'BauherrRueckmeldung' and projekt_id = 't11001-P1';
  if n <> 2 then raise exception 'B-18 FAIL: Büro sieht % statt 2 Rückmeldungen', n; end if;
  perform set_config('t11001.antwort', public.bauherr_antworten(current_setting('t11001.frage'), 'Im Mai.'), true);
  perform public.bauherr_zuruecknehmen(current_setting('t11001.plan'));
  if (select (data->>'freigegeben')::boolean from public.records where id = current_setting('t11001.plan')) is not false then
    raise exception 'B-19 FAIL: Rücknahme nicht in data gespiegelt';
  end if;
  raise notice 'B-18 PASS Büro sieht Rückmeldungen, antwortet';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001c1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001c1', true);
set local role authenticated;
do $$ declare n integer; begin
  select count(*) into n from public.records where id = current_setting('t11001.plan');
  if n <> 0 then raise exception 'B-19 FAIL: zurückgenommener Plan noch sichtbar'; end if;
  select count(*) into n from public.records where entity = 'BauherrAntwort' and data->>'antwort' = 'Im Mai.';
  if n <> 1 then raise exception 'B-19 FAIL: Antwort nicht sichtbar'; end if;
  raise notice 'B-19 PASS Rücknahme wirkt, Antwort sichtbar';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001a2', true);
set local role authenticated;
do $$ declare v text; begin
  -- B-20: the planner re-releases the same plan: same row, visible again, the decision stays attached.
  v := public.bauherr_freigeben('BauherrPlan', 't11001-PL1', '{"plannummer":"A-101","entscheidung_offen":true}'::jsonb);
  if v <> current_setting('t11001.plan') then raise exception 'B-20 FAIL: neue Zeile % statt Aktualisierung', v; end if;
  if (select sicht from public.records where id = v) <> 'freigegeben' then raise exception 'B-20 FAIL: nicht wieder freigegeben'; end if;
  raise notice 'B-20 PASS erneute Freigabe aktualisiert dieselbe Projektion';
end $$;

-- =====================================================================
-- B-21: storage bucket `bauherr`
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001c1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000001c1', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  insert into storage.objects (bucket_id, name, owner)
  values ('bauherr', '33333333-3333-4333-8333-333333333333/t11001-P1/00000000-0000-4000-8000-0000000001c1/brief.pdf',
          '00000000-0000-4000-8000-0000000001c1');
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('bauherr', '33333333-3333-4333-8333-333333333333/t11001-P2/00000000-0000-4000-8000-0000000001c1/x.pdf',
            '00000000-0000-4000-8000-0000000001c1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-21 FAIL: Upload in fremdes Projekt'; end if;
  ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('bauherr', '33333333-3333-4333-8333-333333333333/t11001-P1/00000000-0000-4000-8000-0000000001c2/x.pdf',
            '00000000-0000-4000-8000-0000000001c1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'B-21 FAIL: Upload in fremden Ordner'; end if;
  raise notice 'B-21 PASS Bucket bauherr: nur eigener Ordner im eigenen Projekt';
end $$;

reset role;
\echo '110-01 SQL: ALLE FAELLE PASS'
rollback;
