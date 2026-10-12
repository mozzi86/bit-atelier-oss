-- 0010_protokoll.sql — Phase 74-01 Task 5: access log with a hash chain.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- Append-only against EVERY client role: no update/delete/truncate grant, a
-- row trigger AND a statement trigger (TRUNCATE fires no row triggers — the
-- log would vanish in one command otherwise). The owner of the database stays
-- the named, unclosed residual risk (G-1): who owns the tables can drop the
-- triggers. The daily anchor (head of the chain sent outside, receipt with the
-- content hash to the bidder) is what makes a later change provable; until the
-- edge function exists it is a manual step in supabase/README.md.
--
-- Reading: through the view zugriffsprotokoll_sicht only. Deviation from the
-- plan (which granted select on the table): RLS filters rows, it cannot blank
-- columns — and actor and record id of a sealed, unopened bid must stay hidden
-- even from the office (the circle of bidders and their arrival is protected
-- like the price). The view does that; the table itself has no client grant.
--
-- Not logged (G-2): READS. A policy cannot write, and a volatile function in a
-- policy destroys `stable` and runs per row. Logged: writes on records of the
-- categories projekt/gebot, membership changes, and every RPC of 0009/0012.

create table public.zugriffsprotokoll (
  id          bigserial primary key,
  ts          timestamptz not null default clock_timestamp(),
  org_id      uuid not null,
  projekt_id  text,
  akteur      uuid,
  rolle       text,
  aktion      text not null check (aktion in (
                'datensatz_angelegt', 'datensatz_geaendert', 'datensatz_geloescht',
                'mitgliedschaft_geaendert',
                'submission_angelegt', 'frist_geaendert', 'submission_geoeffnet',
                'gebot_zurueckgezogen', 'zuschlag_erteilt',
                'freigabe_erteilt', 'freigabe_zurueckgenommen',
                'einladung', 'widerruf', 'export', 'download', 'download_verweigert')),
  entity      text,
  record_id   text,
  detail      jsonb not null default '{}'::jsonb,
  vorher_hash text,
  hash        text not null
);
create index zugriffsprotokoll_org_idx on public.zugriffsprotokoll (org_id, id);
create index zugriffsprotokoll_record_idx on public.zugriffsprotokoll (org_id, record_id) where record_id is not null;

alter table public.zugriffsprotokoll enable row level security;
-- A grant takes nothing away: `alter default privileges … grant all` of
-- 0005_grants.sql:28 gave service_role TRUNCATE at creation. Revoke explicitly.
revoke all on public.zugriffsprotokoll from public, anon, authenticated, service_role;
grant select, insert on public.zugriffsprotokoll to service_role;
revoke all on sequence public.zugriffsprotokoll_id_seq from public, anon, authenticated;
grant usage on sequence public.zugriffsprotokoll_id_seq to service_role;

create function public.protokoll_unveraenderlich() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Das Zugriffsprotokoll ist unveränderlich (%).', tg_op using errcode = '42501';
end;
$$;
revoke all on function public.protokoll_unveraenderlich() from public;

create trigger zugriffsprotokoll_keine_aenderung
  before update or delete on public.zugriffsprotokoll
  for each row execute function public.protokoll_unveraenderlich();
create trigger zugriffsprotokoll_kein_truncate
  before truncate on public.zugriffsprotokoll
  for each statement execute function public.protokoll_unveraenderlich();

-- The hash of one entry. Fixed text form, field separator '|', timestamps in
-- UTC with microseconds — `ts::text` would depend on the session's DateStyle
-- and TimeZone, and a check run from another session would see a broken chain.
-- jsonb::text is canonical (keys normalised), so detail hashes stably.
create function public.protokoll_hash(
  p_vorher text, p_ts timestamptz, p_id bigint, p_org uuid, p_projekt text, p_akteur uuid,
  p_aktion text, p_entity text, p_record text, p_detail jsonb) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce(p_vorher, '') || '|' ||
    to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
    p_id::text || '|' || p_org::text || '|' || coalesce(p_projekt, '') || '|' ||
    coalesce(p_akteur::text, '') || '|' || p_aktion || '|' || coalesce(p_entity, '') || '|' ||
    coalesce(p_record, '') || '|' || coalesce(p_detail, '{}'::jsonb)::text,
    'UTF8')), 'hex')
$$;
revoke all on function public.protokoll_hash(text, timestamptz, bigint, uuid, text, uuid, text, text, text, jsonb) from public;
grant execute on function public.protokoll_hash(text, timestamptz, bigint, uuid, text, uuid, text, text, text, jsonb)
  to authenticated, service_role;

-- Write one entry. Definer; NOT callable by anon/authenticated — in a draft the
-- revoke was missing and every holder of the published anon key could write
-- undeletable false entries. The definer functions of 0009/0012 and the
-- triggers below call it as owner; service_role (edge functions) may call it.
-- p_akteur: only for the service role (edge functions run with the secret key,
-- where auth.uid() is NULL). A signed-in caller's own uid always wins; and
-- clients cannot execute this function at all, so the parameter cannot be
-- used to write "as" someone else.
create function public.protokoll_schreiben(
  p_org uuid, p_projekt text, p_aktion text, p_entity text, p_record text, p_detail jsonb,
  p_akteur uuid default null)
  returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_ts timestamptz := clock_timestamp();
  v_vorher text;
  v_akteur uuid := coalesce(auth.uid(), p_akteur);
begin
  -- Serialise per org, otherwise two concurrent writers fork the chain.
  perform pg_advisory_xact_lock(hashtext('zugriffsprotokoll:' || p_org::text));
  select hash into v_vorher from public.zugriffsprotokoll
   where org_id = p_org order by id desc limit 1;
  v_id := nextval('public.zugriffsprotokoll_id_seq');
  insert into public.zugriffsprotokoll
    (id, ts, org_id, projekt_id, akteur, rolle, aktion, entity, record_id, detail, vorher_hash, hash)
  values
    (v_id, v_ts, p_org, p_projekt, v_akteur,
     (select m.role from public.org_members m where m.org_id = p_org and m.user_id = v_akteur),
     p_aktion, p_entity, p_record,
     coalesce(p_detail, '{}'::jsonb), v_vorher,
     public.protokoll_hash(v_vorher, v_ts, v_id, p_org, p_projekt, v_akteur, p_aktion, p_entity,
                           p_record, coalesce(p_detail, '{}'::jsonb)));
  return v_id;
end;
$$;
revoke all on function public.protokoll_schreiben(uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.protokoll_schreiben(uuid, text, text, text, text, jsonb, uuid) to service_role;

-- Chain check for one org: one row per entry, ok = predecessor and own hash
-- match. Only for holders of can_view_audit_reports (or the service role).
-- Returns no content, only ids and verdicts — the check needs the unmasked
-- values, the caller does not.
create function public.protokoll_kette_pruefen(p_org uuid)
  returns table (eintrag bigint, ok boolean)
language plpgsql security definer stable set search_path = public as $$
declare
  r public.zugriffsprotokoll%rowtype;
  v_vorher text := null;
begin
  if not public.ist_dienst()
     and not (public.ist_mitglied(p_org) and public.hat_recht(p_org, 'can_view_audit_reports')) then
    perform public.vorgang_abweisen();
  end if;
  for r in select * from public.zugriffsprotokoll where org_id = p_org order by id loop
    eintrag := r.id;
    ok := r.vorher_hash is not distinct from v_vorher
          and r.hash = public.protokoll_hash(r.vorher_hash, r.ts, r.id, r.org_id, r.projekt_id, r.akteur,
                                             r.aktion, r.entity, r.record_id, r.detail);
    return next;
    v_vorher := r.hash;
  end loop;
end;
$$;
revoke all on function public.protokoll_kette_pruefen(uuid) from public;
grant execute on function public.protokoll_kette_pruefen(uuid) to authenticated, service_role;

-- The reading view. Runs with the owner's rights (default for views), so the
-- table needs no client grant; the WHERE clause is the access rule.
-- security_barrier: a user-supplied filter cannot be evaluated before it.
create view public.zugriffsprotokoll_sicht with (security_barrier = true) as
  select p.id, p.ts, p.org_id, p.projekt_id,
         case when verdeckt.ja then null else p.akteur end    as akteur,
         p.rolle, p.aktion, p.entity,
         case when verdeckt.ja then null else p.record_id end as record_id,
         case when verdeckt.ja then jsonb_build_object('verdeckt', true, 'vergabe_id', p.detail->>'vergabe_id')
              else p.detail end                              as detail,
         p.vorher_hash, p.hash
    from public.zugriffsprotokoll p
    cross join lateral (
      select coalesce((p.detail->>'versiegelt')::boolean, false)
             and not public.submission_offen(p.org_id, p.detail->>'vergabe_id') as ja
    ) verdeckt
   where public.ist_mitglied(p.org_id)
     and public.hat_recht(p.org_id, 'can_view_audit_reports');
revoke all on public.zugriffsprotokoll_sicht from public, anon, authenticated;
grant select on public.zugriffsprotokoll_sicht to authenticated, service_role;

-- Writes on records of the categories projekt and gebot, with the content hash
-- before/after: "unchanged since the deadline" becomes a checkable sentence.
create function public.records_protokollieren() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_zeile public.records;
  v_bereich text;
begin
  v_zeile := case when tg_op = 'DELETE' then old else new end;
  v_bereich := public.entity_bereich(v_zeile.entity);
  if v_bereich not in ('projekt', 'gebot') then
    return null;
  end if;
  perform public.protokoll_schreiben(
    v_zeile.org_id, v_zeile.projekt_id,
    case tg_op when 'INSERT' then 'datensatz_angelegt' when 'UPDATE' then 'datensatz_geaendert'
               else 'datensatz_geloescht' end,
    v_zeile.entity, v_zeile.id,
    jsonb_strip_nulls(jsonb_build_object(
      'inhalt_hash_vorher',  case when tg_op <> 'INSERT' then public.inhalt_hash(old.data) end,
      'inhalt_hash_nachher', case when tg_op <> 'DELETE' then public.inhalt_hash(new.data) end,
      'vergabe_id', v_zeile.vergabe_id,
      'versiegelt', v_zeile.siegel_id is not null)));
  return null;
end;
$$;
revoke all on function public.records_protokollieren() from public;

create trigger records_protokollieren
  after insert or update or delete on public.records
  for each row execute function public.records_protokollieren();

-- Every membership change, announced in 0006.
create function public.org_members_protokollieren() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  perform public.protokoll_schreiben(v_org, null, 'mitgliedschaft_geaendert', 'org_members',
    coalesce(new.user_id, old.user_id)::text,
    jsonb_strip_nulls(jsonb_build_object(
      'vorgang', lower(tg_op),
      'rolle_vorher', case when tg_op <> 'INSERT' then old.role end,
      'rolle_nachher', case when tg_op <> 'DELETE' then new.role end)));
  return null;
end;
$$;
revoke all on function public.org_members_protokollieren() from public;

create trigger org_members_protokollieren
  after insert or update or delete on public.org_members
  for each row execute function public.org_members_protokollieren();
