-- 0009_submission.sql — Phase 74-01 Task 4: submission, deadline, opening act,
-- seal. Additive; sealed rows only appear once an EXTERNAL role bids (0008),
-- and none is invited before the whole chain is live (Task 11).
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- Runtime dependency: the RPCs below write to the access log through
-- public.protokoll_schreiben(), created in 0010. plpgsql resolves the call at
-- execution time, so this file applies on its own; the RPCs work once 0010
-- is in. Both belong to the same rollout (Task 12) — never one without the other.
--
-- Scope decision E1 (19.09.2026): no formal public procurement under VgV/UVgO.
-- The opening act is therefore single-step with a record (E3); the operator
-- who holds the service key can still read every bid before the deadline
-- (G-1). What this file gives: the APPLICATION path is closed, and every
-- change after the deadline is detectable through the content hash.
--
-- Every RPC: security definer, search_path pinned, role check as the FIRST
-- statement, log entry as the LAST, one error text for every refusal
-- ("Vorgang nicht zulässig oder nicht gefunden") — different texts for
-- "not found" and "not allowed" would be an existence oracle (A-38).

create table public.submission (
  -- org in the key: with a global tender_id key a stranger could put a
  -- submission on a foreign tender and later open it himself.
  tender_id     text not null,
  org_id        uuid not null references public.orgs on delete cascade,
  projekt_id    text,
  frist         timestamptz not null,
  geoeffnet_am  timestamptz,
  geoeffnet_von uuid references auth.users on delete set null,
  angelegt_am   timestamptz not null default now(),
  angelegt_von  uuid references auth.users on delete set null,
  primary key (org_id, tender_id)
);

alter table public.submission enable row level security;
revoke all on public.submission from anon, authenticated;
grant select on public.submission to authenticated;
grant all privileges on public.submission to service_role;

-- Internal roles of the org see the submissions; a participant sees the one
-- of their tender (they need the deadline). No write grant — RPCs only.
create policy submission_select on public.submission
  for select to authenticated
  using (public.ist_intern(org_id) or public.darf_vergabe(org_id, tender_id));

-- The ONE refusal. Internal helper, not callable by clients.
create function public.vorgang_abweisen() returns void
language plpgsql set search_path = public as $$
begin
  raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
end;
$$;
revoke all on function public.vorgang_abweisen() from public;

-- Content hash of a bid. Over the whole jsonb EXCEPT the award status, so the
-- award (zuschlag_erteilen) does not change the hash of the document it
-- decides on (A-40). sha256() is built in (PG 11+); NOT pgcrypto digest(),
-- which lives in schema `extensions` on Supabase and dies under
-- search_path = public — taking release, deadline and opening down with it.
create function public.inhalt_hash(p_data jsonb) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to((coalesce(p_data, '{}'::jsonb) - 'status')::text, 'UTF8')), 'hex')
$$;
revoke all on function public.inhalt_hash(jsonb) from public;
grant execute on function public.inhalt_hash(jsonb) to authenticated, service_role;

-- Check functions — fail-shut: no submission means NO bid.
create function public.submission_laeuft(p_org uuid, p_vergabe text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select geoeffnet_am is null and now() < frist
       from public.submission where org_id = p_org and tender_id = p_vergabe),
    false)
$$;
revoke all on function public.submission_laeuft(uuid, text) from public;
grant execute on function public.submission_laeuft(uuid, text) to authenticated, service_role;

create function public.submission_offen(p_org uuid, p_vergabe text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select geoeffnet_am is not null
       from public.submission where org_id = p_org and tender_id = p_vergabe),
    false)
$$;
revoke all on function public.submission_offen(uuid, text) from public;
grant execute on function public.submission_offen(uuid, text) to authenticated, service_role;

-- Used by the delete policy (0011): a tender with a submission is never deleted,
-- otherwise delete + recreate with the same id would reset the time lock.
create function public.tender_hat_submission(p_org uuid, p_tender text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.submission where org_id = p_org and tender_id = p_tender)
$$;
revoke all on function public.tender_hat_submission(uuid, text) from public;
grant execute on function public.tender_hat_submission(uuid, text) to authenticated, service_role;

-- One sealed bid per bidder and tender. The policy is the friendly message,
-- this index is the control: two concurrent requests both see "no bid yet".
-- A withdrawn bid still counts — a withdrawn envelope stays on the table.
create unique index gebot_je_bieter on public.records (vergabe_id, eigner)
  where entity in ('Bid', 'InvestmentBid') and siegel_id is not null;

-- 1. Create a submission: org and project come from the Tender row, never
-- from a parameter; owner/planner of that org; deadline in the future; one per tender.
create function public.submission_anlegen(p_tender text, p_frist timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_projekt text;
begin
  select org_id, nullif(data->>'project_id', '') into v_org, v_projekt
    from public.records where id = p_tender and entity = 'Tender';
  if v_org is null or coalesce(public.rolle_in(v_org), '') not in ('owner', 'planner')
     or p_frist is null or p_frist <= now()
     or public.tender_hat_submission(v_org, p_tender) then
    perform public.vorgang_abweisen();
  end if;
  insert into public.submission (tender_id, org_id, projekt_id, frist, angelegt_von)
  values (p_tender, v_org, v_projekt, p_frist, auth.uid());
  perform public.protokoll_schreiben(v_org, v_projekt, 'submission_angelegt', 'Tender', p_tender,
                                     jsonb_build_object('frist', p_frist));
end;
$$;
revoke all on function public.submission_anlegen(text, timestamptz) from public;
grant execute on function public.submission_anlegen(text, timestamptz) to authenticated;

-- 2. Move the deadline: owner only, only while it runs (an expired deadline is
-- never extended), only later, never after opening; the reason goes to the log.
create function public.submission_frist(p_tender text, p_neu timestamptz, p_grund text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_s public.submission%rowtype;
begin
  select s.* into v_s from public.submission s
    join public.records t on t.id = s.tender_id and t.org_id = s.org_id and t.entity = 'Tender'
   where s.tender_id = p_tender and coalesce(public.rolle_in(s.org_id), '') = 'owner';
  if not found or v_s.geoeffnet_am is not null or now() >= v_s.frist
     or p_neu is null or p_neu <= v_s.frist or coalesce(trim(p_grund), '') = '' then
    perform public.vorgang_abweisen();
  end if;
  update public.submission set frist = p_neu where org_id = v_s.org_id and tender_id = p_tender;
  perform public.protokoll_schreiben(v_s.org_id, v_s.projekt_id, 'frist_geaendert', 'Tender', p_tender,
                                     jsonb_build_object('alt', v_s.frist, 'neu', p_neu, 'grund', p_grund));
end;
$$;
revoke all on function public.submission_frist(text, timestamptz, text) from public;
grant execute on function public.submission_frist(text, timestamptz, text) to authenticated;

-- 3. Opening act: owner only, only at or after the deadline, only once. Writes
-- the record (Niederschrift) to the log: per bid id, bidder contact, arrival,
-- content hash, sum — and re-checks each hash against the last logged one.
create function public.submission_oeffnen(p_tender text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s public.submission%rowtype;
  v_gebot record;
  v_hash text;
  v_alt text;
  v_liste jsonb := '[]'::jsonb;
begin
  select s.* into v_s from public.submission s
   where s.tender_id = p_tender and coalesce(public.rolle_in(s.org_id), '') = 'owner';
  if not found or v_s.geoeffnet_am is not null or now() < v_s.frist then
    perform public.vorgang_abweisen();
  end if;

  update public.submission set geoeffnet_am = now(), geoeffnet_von = auth.uid()
   where org_id = v_s.org_id and tender_id = p_tender;

  for v_gebot in
    select r.id, r.data, r.created_date from public.records r
     where r.org_id = v_s.org_id and r.vergabe_id = p_tender and r.siegel_id is not null
     order by r.created_date, r.id
  loop
    v_hash := public.inhalt_hash(v_gebot.data);
    select p.detail->>'inhalt_hash_nachher' into v_alt from public.zugriffsprotokoll p
     where p.org_id = v_s.org_id and p.record_id = v_gebot.id and p.detail ? 'inhalt_hash_nachher'
     order by p.id desc limit 1;
    v_liste := v_liste || jsonb_build_object(
      'record_id', v_gebot.id,
      'bieter_kontakt', v_gebot.data->>'contact_id',
      'eingang_am', v_gebot.created_date,
      'status', v_gebot.data->>'status',
      'summe', v_gebot.data->'total',
      'inhalt_hash', v_hash,
      'hash_wie_protokolliert', v_alt is not distinct from v_hash);
  end loop;

  perform public.protokoll_schreiben(v_s.org_id, v_s.projekt_id, 'submission_geoeffnet', 'Tender', p_tender,
                                     jsonb_build_object('frist', v_s.frist, 'niederschrift', v_liste));
  return v_liste;
end;
$$;
revoke all on function public.submission_oeffnen(text) from public;
grant execute on function public.submission_oeffnen(text) to authenticated;

-- 4. Withdraw: the author only, only while the deadline runs. No hard delete —
-- a withdrawn envelope is visible in a paper procedure too.
create function public.gebot_zuruecknehmen(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_r record;
begin
  select r.id, r.org_id, r.projekt_id, r.vergabe_id into v_r from public.records r
   where r.id = p_id and r.eigner = auth.uid() and r.siegel_id is not null;
  -- Two ifs on purpose: reading v_r.* of an unassigned record would raise
  -- "record is not assigned yet" - a different text, i.e. an existence oracle.
  if not found then
    perform public.vorgang_abweisen();
  end if;
  if not public.submission_laeuft(v_r.org_id, v_r.vergabe_id) then
    perform public.vorgang_abweisen();
  end if;
  perform set_config('bit.steuerung', 'an', true);
  update public.records set data = jsonb_set(data, '{status}', '"zurueckgezogen"') where id = p_id;
  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_r.org_id, v_r.projekt_id, 'gebot_zurueckgezogen', 'Bid', p_id,
                                     jsonb_build_object('vergabe_id', v_r.vergabe_id));
end;
$$;
revoke all on function public.gebot_zuruecknehmen(text) from public;
grant execute on function public.gebot_zuruecknehmen(text) to authenticated;

-- 5. Award: owner only, only after the opening act. Sets the status on every
-- bid of the tender and awarded_bid_id on the tender — without touching
-- line_items. After 0011 a sealed row is not updatable by anyone, so this is
-- the only way to award a bid that came in through the portal
-- (AVA.jsx:595-599 keeps working for paper bids, which are never sealed).
create function public.zuschlag_erteilen(p_tender text, p_bid text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_s public.submission%rowtype;
begin
  select s.* into v_s from public.submission s
   where s.tender_id = p_tender and coalesce(public.rolle_in(s.org_id), '') = 'owner';
  if not found or v_s.geoeffnet_am is null
     or not exists (select 1 from public.records b
                     where b.id = p_bid and b.org_id = v_s.org_id and b.entity in ('Bid', 'InvestmentBid')
                       and (b.vergabe_id = p_tender or (b.siegel_id is null and b.data->>'tender_id' = p_tender))
                       and coalesce(b.data->>'status', '') <> 'zurueckgezogen') then
    perform public.vorgang_abweisen();
  end if;
  perform set_config('bit.steuerung', 'an', true);
  update public.records
     set data = jsonb_set(data, '{status}', to_jsonb(case when id = p_bid then 'awarded' else 'rejected' end))
   where org_id = v_s.org_id and entity in ('Bid', 'InvestmentBid')
     -- portal bids carry vergabe_id (sealed), paper bids of the office only
     -- data.tender_id (E2, never sealed): both belong to this award.
     and (vergabe_id = p_tender or (siegel_id is null and data->>'tender_id' = p_tender))
     and coalesce(data->>'status', '') <> 'zurueckgezogen';
  update public.records
     set data = data || jsonb_build_object('status', 'awarded', 'awarded_bid_id', p_bid,
                                           'awarded_date', to_jsonb(now()))
   where org_id = v_s.org_id and id = p_tender and entity = 'Tender';
  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_s.org_id, v_s.projekt_id, 'zuschlag_erteilt', 'Tender', p_tender,
                                     jsonb_build_object('bid', p_bid));
end;
$$;
revoke all on function public.zuschlag_erteilen(text, text) from public;
grant execute on function public.zuschlag_erteilen(text, text) to authenticated;
