-- 0006_down.sql — rollback of 0006_rollen.sql (Phase 74-01).
-- Requires: 0011_down … 0007_down have run.
--
-- The stage-1 model knows only admin/mitglied, and a member sees EVERYTHING of
-- the org. An external membership (bidder/investor/gast) mapped back to
-- `mitglied` would hand that person the whole office — so external
-- memberships are DELETED, not mapped. `leser` becomes `mitglied` and gains
-- write access again (the old model has no read-only role).

begin;

do $$
declare
  v_extern integer;
begin
  select count(*) into v_extern from public.org_members where role in ('bidder', 'investor', 'gast');
  if v_extern > 0 then
    raise notice '0006_down: % externe Mitgliedschaft(en) werden gelöscht (im alten Modell sähen sie alles).', v_extern;
  end if;
end $$;
delete from public.org_members where role in ('bidder', 'investor', 'gast');

drop trigger if exists org_members_altrollen on public.org_members;
drop function if exists public.org_members_altrollen();

alter table public.org_members
  drop constraint if exists org_members_gebot_nur_extern,
  drop constraint if exists org_members_extern_ohne_internrechte,
  drop constraint if exists org_members_rolle_check;

update public.org_members
   set role = case role when 'owner' then 'admin' else 'mitglied' end;

alter table public.org_members
  add constraint org_members_role_check check (role in ('admin', 'mitglied'));

alter table public.org_members
  drop column if exists eingeladen_am,
  drop column if exists eingeladen_von,
  drop column if exists kontakt_id,
  drop column if exists can_submit_bid,
  drop column if exists can_view_audit_reports,
  drop column if exists can_export_ifc,
  drop column if exists can_edit_model,
  drop column if exists stufe;

drop function if exists public.ist_dienst();
drop function if exists public.mein_kontakt(uuid);
drop function if exists public.hat_recht(uuid, text);
drop function if exists public.ist_extern(uuid);
drop function if exists public.ist_intern(uuid);
drop function if exists public.rolle_in(uuid);

commit;
