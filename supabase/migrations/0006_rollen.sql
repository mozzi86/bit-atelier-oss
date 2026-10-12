-- 0006_rollen.sql — Phase 74-01 Task 1: roles, permission flags, NULL-safe guards.
--
-- Additive. No policy is touched here; the only behaviour change of 74-01 is
-- 0011. After this file the office works exactly as before.
--
-- STATUS 12.10.2026: written and reviewed by reading only — NOT run against
-- Postgres (no local database on the build machine). Run order and proof:
-- supabase/tests/74-01_zugriff.sql against a throwaway project (dev2), see
-- .planning/phases/74-zugriffstrennung-submissionssicherheit/74-01-SUMMARY.md.
--
-- Vocabulary — two DISJOINT sets, enforced by a check, not by habit:
--   internal  owner | planner | leser
--   external  bidder | investor | gast
-- An earlier draft had `viewer` in both sets: inviting a bidder as "viewer"
-- would have given them internal full access. One row per (user, org) (primary
-- key of 0001) and one role per row, so a person cannot be both in one office.
--
-- Migration of the two stage-1 roles BEFORE the check is narrowed:
--   admin → owner, mitglied → planner.
-- Legacy writers (scripts/zugang-freischalten.mjs, the dashboard SQL in
-- supabase/README.md) still say admin/mitglied; a BEFORE trigger translates
-- them so they keep working until they are updated (BEFORE row triggers run
-- before check constraints are evaluated).
--
-- Every guard function is fail-shut: a missing membership or an unknown flag
-- returns false, never NULL — `IF NULL THEN` takes the ELSE branch in plpgsql,
-- which is exactly how a guard opens by accident. Callers that need the role
-- text write `coalesce(public.rolle_in(x), '')`.
--
-- The audit trigger on org_members (every change → zugriffsprotokoll) is
-- created in 0010, where the log exists.

-- 1. Roles: migrate values, then narrow the check. -------------------------
alter table public.org_members drop constraint if exists org_members_role_check;

update public.org_members
   set role = case role when 'admin' then 'owner' when 'mitglied' then 'planner' else role end
 where role in ('admin', 'mitglied');

alter table public.org_members
  add constraint org_members_rolle_check
  check (role in ('owner', 'planner', 'leser', 'bidder', 'investor', 'gast'));

-- 2. Tier and four permission flags. ---------------------------------------
-- `stufe` is recorded but guards nothing in this phase (decision E4): a flag
-- that protects nothing is worse than none, because people start to trust it.
alter table public.org_members
  add column stufe                  text not null default 'free'
                                     check (stufe in ('free', 'pro', 'enterprise')),
  add column can_edit_model         boolean not null default false,
  add column can_export_ifc         boolean not null default false,
  add column can_view_audit_reports boolean not null default false,
  add column can_submit_bid         boolean not null default false,
  -- The Contact row (records.id, entity Contact) that IS this person for the
  -- office: the anchor for "their bid". Set by the invitation, never by them.
  add column kontakt_id             text,
  add column eingeladen_von         uuid references auth.users on delete set null,
  add column eingeladen_am          timestamptz;

-- Existing members keep every button they have today [ASSUMED E4: enterprise].
update public.org_members
   set stufe = 'enterprise',
       can_edit_model = true,
       can_export_ifc = true,
       can_view_audit_reports = (role = 'owner'),
       can_submit_bid = false;

-- 3. The sets stay disjoint in what they may do, too. ----------------------
-- An external role never carries an internal right; only bidders/investors
-- may submit. (A-37: role 'bidder' combined with internal access → error.)
alter table public.org_members
  add constraint org_members_extern_ohne_internrechte
  check (role not in ('bidder', 'investor', 'gast')
         or (not can_edit_model and not can_export_ifc and not can_view_audit_reports)),
  add constraint org_members_gebot_nur_extern
  check (not can_submit_bid or role in ('bidder', 'investor'));

-- 4. Legacy writers. -------------------------------------------------------
-- admin/mitglied from an old script become owner/planner with the same rights
-- the backfill above gave existing members; everything else passes unchanged
-- and meets the checks.
create function public.org_members_altrollen() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role in ('admin', 'mitglied') then
    new.role := case new.role when 'admin' then 'owner' else 'planner' end;
    if tg_op = 'INSERT' then
      new.stufe := 'enterprise';
      new.can_edit_model := true;
      new.can_export_ifc := true;
      new.can_view_audit_reports := (new.role = 'owner');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.org_members_altrollen() from public;

create trigger org_members_altrollen
  before insert or update on public.org_members
  for each row execute function public.org_members_altrollen();

-- 5. Guard functions. -------------------------------------------------------
-- All: security definer (the lookup into org_members must not recurse into
-- its own RLS), stable (evaluated once per statement where the planner can),
-- search_path pinned. Each create is followed by its revoke/grant in the same
-- block — the Postgres default is EXECUTE for PUBLIC, and PostgREST publishes
-- every function of schema public as an RPC.

-- Role of the caller in an org, or NULL when not a member.
create function public.rolle_in(p_org uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from public.org_members where org_id = p_org and user_id = auth.uid()
$$;
revoke all on function public.rolle_in(uuid) from public;
grant execute on function public.rolle_in(uuid) to authenticated, service_role;

create function public.ist_intern(p_org uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role in ('owner', 'planner', 'leser')
       from public.org_members where org_id = p_org and user_id = auth.uid()),
    false)
$$;
revoke all on function public.ist_intern(uuid) from public;
grant execute on function public.ist_intern(uuid) to authenticated, service_role;

create function public.ist_extern(p_org uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role in ('bidder', 'investor', 'gast')
       from public.org_members where org_id = p_org and user_id = auth.uid()),
    false)
$$;
revoke all on function public.ist_extern(uuid) from public;
grant execute on function public.ist_extern(uuid) to authenticated, service_role;

-- One of the four flags. An unknown flag name is false, not an error and not NULL.
create function public.hat_recht(p_org uuid, p_flag text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select case p_flag
              when 'can_edit_model'         then can_edit_model
              when 'can_export_ifc'         then can_export_ifc
              when 'can_view_audit_reports' then can_view_audit_reports
              when 'can_submit_bid'         then can_submit_bid
              else false
            end
       from public.org_members where org_id = p_org and user_id = auth.uid()),
    false)
$$;
revoke all on function public.hat_recht(uuid, text) from public;
grant execute on function public.hat_recht(uuid, text) to authenticated, service_role;

-- The caller's Contact id in an org (NULL when none was set at invitation).
create function public.mein_kontakt(p_org uuid) returns text
language sql security definer stable set search_path = public as $$
  select kontakt_id from public.org_members where org_id = p_org and user_id = auth.uid()
$$;
revoke all on function public.mein_kontakt(uuid) from public;
grant execute on function public.mein_kontakt(uuid) to authenticated, service_role;

-- Is the request running as the service role (import script, edge functions
-- with the secret key)? Deliberately NOT the JWT claim `role`: a claim can be
-- shaped by an access-token hook, the database role cannot.
--
-- Read from the `role` setting, NOT from current_user: PostgREST switches with
-- `SET LOCAL ROLE <role>`, which sets this setting; a SECURITY DEFINER function
-- changes current_user to its OWNER but leaves the setting alone. The anchor
-- trigger of 0008 is a definer function — with current_user it would ask
-- whether the owner (postgres) is a service-role member, and if it is, the
-- pinning would be off for every caller. A client cannot set `role` to
-- service_role (SET ROLE needs membership). [ASSUMED: Postgres semantics as
-- described; A-16/A-17 in supabase/tests/74-01_zugriff.sql measure it.]
-- `bit.migration = 'an'` (transaction-local, set only inside a migration)
-- lets a migration backfill past the pinning triggers of 0008.
create function public.ist_dienst() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('role', true), '') = 'service_role'
      or coalesce(current_setting('bit.migration', true), '') = 'an'
$$;
revoke all on function public.ist_dienst() from public;
grant execute on function public.ist_dienst() to authenticated, service_role;
