-- 0017_einladungscodes.sql — Phase 110-06: invitation by LINK, without knowing
-- the invitee's e-mail (user request 06.11.2026: "ich schicke per WhatsApp und
-- er meldet sich an").
--
-- The owner creates a code for ONE project and ONE external role; the app
-- turns it into a link (…/einladung?code=…). The invitee opens it, registers
-- with an own e-mail + password (supabase.auth.signUp) and, signed in, redeems
-- the code: membership with the FIXED rights of the role, project access,
-- log entry. Without a valid code a fresh account gets nothing (no membership
-- → the policies of 0011/0016 show it nothing).
--
-- Only the SHA-256 of a code is stored; the code itself is shown once to the
-- owner. A code is valid until gueltig_bis, for max_nutzungen redemptions, and
-- can be withdrawn. An internal member of the office is never turned into an
-- external one (same rule as einladungErlaubt / the edge function).
--
-- Depends on 0006 (roles, rolle_in), 0007 (projekt_zugang), 0010 (log),
-- 0016 (role bauherr). Rollback: supabase/rueckweg/0017_down.sql.

create table public.einladungscode (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs on delete cascade,
  projekt_id     text not null,
  rolle          text not null check (rolle in ('bauherr')),  -- more external roles later (their projections need an audience first, 0016)
  code_hash      text not null unique,
  gueltig_bis    timestamptz not null,
  max_nutzungen  integer not null default 1 check (max_nutzungen between 1 and 20),
  nutzungen      integer not null default 0,
  widerrufen     boolean not null default false,
  angelegt_von   uuid references auth.users on delete set null,
  angelegt_am    timestamptz not null default now(),
  zuletzt_eingeloest_von uuid references auth.users on delete set null,
  zuletzt_eingeloest_am  timestamptz
);

alter table public.einladungscode enable row level security;
revoke all on public.einladungscode from public, anon, authenticated;
-- The owner lists the codes of the office (never the code itself — only the hash
-- is stored). No client DML: creating, redeeming, withdrawing run through the RPCs.
grant select on public.einladungscode to authenticated;
grant all on public.einladungscode to service_role;
create policy einladungscode_select on public.einladungscode
  for select to authenticated
  using (coalesce(public.rolle_in(org_id), '') = 'owner');

-- sha256 as hex text of a code (no salt needed: the code has 244 random bits).
create function public.einladungscode_hash(p_code text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')
$$;
revoke all on function public.einladungscode_hash(text) from public, anon, authenticated;

-- Owner: new code for a project of the own office. Returns the CODE (shown once).
create function public.einladungscode_erstellen(p_projekt text, p_rolle text default 'bauherr',
                                                p_tage integer default 14, p_nutzungen integer default 1)
  returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  -- 2 × gen_random_uuid (core since PG 13, 122 random bits each) → 64 hex
  -- characters. Not gen_random_bytes: on Supabase pgcrypto lives in schema
  -- `extensions`, invisible under the pinned search_path.
  v_code text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select org_id into v_org from public.records
   where id = p_projekt and entity = 'Project' and coalesce(public.rolle_in(org_id), '') = 'owner'
   limit 1;
  if v_org is null or p_rolle not in ('bauherr')
     or coalesce(p_tage, 0) not between 1 and 90 or coalesce(p_nutzungen, 0) not between 1 and 20 then
    perform public.vorgang_abweisen();
  end if;
  insert into public.einladungscode (org_id, projekt_id, rolle, code_hash, gueltig_bis, max_nutzungen, angelegt_von)
  values (v_org, p_projekt, p_rolle, public.einladungscode_hash(v_code), now() + make_interval(days => p_tage),
          p_nutzungen, auth.uid());
  perform public.protokoll_schreiben(v_org, p_projekt, 'einladung', 'einladungscode', null,
    jsonb_build_object('rolle', p_rolle, 'tage', p_tage, 'nutzungen', p_nutzungen, 'weg', 'link'));
  return v_code;
end;
$$;
revoke all on function public.einladungscode_erstellen(text, text, integer, integer) from public, anon;
grant execute on function public.einladungscode_erstellen(text, text, integer, integer) to authenticated;

-- Signed-in invitee: redeem a code. Membership with the fixed rights of the
-- role (never internal flags; bauherr/gast never bid), project access, log.
-- Same refusal text for every failure (no oracle for valid codes).
create function public.einladungscode_einloesen(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c public.einladungscode%rowtype;
  v_rolle text;
begin
  if auth.uid() is null then
    perform public.vorgang_abweisen();
  end if;
  select * into v_c from public.einladungscode
   where code_hash = public.einladungscode_hash(p_code)
     and not widerrufen and gueltig_bis > now() and nutzungen < max_nutzungen
   for update;
  if not found then
    perform public.vorgang_abweisen();
  end if;
  select role into v_rolle from public.org_members where org_id = v_c.org_id and user_id = auth.uid();
  if v_rolle in ('owner', 'planner', 'leser', 'admin', 'mitglied') then
    perform public.vorgang_abweisen();
  end if;

  insert into public.org_members (user_id, org_id, role, stufe, can_edit_model, can_export_ifc,
                                  can_view_audit_reports, can_submit_bid, eingeladen_von, eingeladen_am)
  values (auth.uid(), v_c.org_id, v_c.rolle, 'free', false, false, false, false, v_c.angelegt_von, now())
  on conflict (user_id, org_id) do update
     set role = excluded.role, stufe = 'free', can_edit_model = false, can_export_ifc = false,
         can_view_audit_reports = false, can_submit_bid = false;

  insert into public.projekt_zugang (org_id, user_id, projekt_id, rolle, angelegt_von)
  values (v_c.org_id, auth.uid(), v_c.projekt_id, v_c.rolle, v_c.angelegt_von)
  on conflict (org_id, user_id, projekt_id) do update set rolle = excluded.rolle;

  update public.einladungscode
     set nutzungen = nutzungen + 1, zuletzt_eingeloest_von = auth.uid(), zuletzt_eingeloest_am = now()
   where id = v_c.id;

  perform public.protokoll_schreiben(v_c.org_id, v_c.projekt_id, 'einladung', 'org_members', auth.uid()::text,
    jsonb_build_object('rolle', v_c.rolle, 'weg', 'link', 'code', v_c.id));
  return jsonb_build_object('projekt_id', v_c.projekt_id, 'rolle', v_c.rolle);
end;
$$;
revoke all on function public.einladungscode_einloesen(text) from public, anon;
grant execute on function public.einladungscode_einloesen(text) to authenticated;

-- Owner: withdraw a code.
create function public.einladungscode_widerrufen(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.einladungscode where id = p_id;
  if v_org is null or coalesce(public.rolle_in(v_org), '') <> 'owner' then
    perform public.vorgang_abweisen();
  end if;
  update public.einladungscode set widerrufen = true where id = p_id;
  return true;
end;
$$;
revoke all on function public.einladungscode_widerrufen(uuid) from public, anon;
grant execute on function public.einladungscode_widerrufen(uuid) to authenticated;
