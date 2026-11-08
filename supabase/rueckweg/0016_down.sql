-- 0016_down.sql — rollback of 0016_bauherr.sql (Phase 110-01).
--
-- Order: first take every client out (access rows deleted, memberships set to
-- the powerless `gast`), then the policies of 0011 word for word, then the
-- functions, the trigger, the catalogue columns and the role checks. Client
-- projections and client rows in records stay as data, but without catalogue
-- rows they are `gesperrt` (0007): invisible to every external role, visible
-- to the office. The bucket `bauherr` stays (storage refuses to drop a bucket
-- with objects); only its policies go, so nobody but the service role reads it.

begin;

-- 1. Clients out. ------------------------------------------------------------------
delete from public.projekt_zugang where rolle = 'bauherr';
update public.org_members
   set role = 'gast', can_edit_model = false, can_export_ifc = false,
       can_view_audit_reports = false, can_submit_bid = false
 where role = 'bauherr';

-- 2. Policies of 0011, unchanged text. -----------------------------------------------
drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;

create policy records_select on public.records
  for select to authenticated
  using (
    public.ist_mitglied(org_id)
    and (
      ( public.ist_intern(org_id)
        and ( public.entity_bereich(entity) <> 'gebot'
              or siegel_id is null
              or eigner = auth.uid()
              or public.submission_offen(org_id, vergabe_id) ) )
      or
      ( public.ist_extern(org_id)
        and ( eigner = auth.uid()
              or ( sicht = 'freigegeben'
                   and public.entity_extern(entity)
                   and projekt_id is not null
                   and public.darf_projekt(org_id, projekt_id)
                   and (vergabe_id is null or public.darf_vergabe(org_id, vergabe_id)) ) ) )
    )
  );

create policy records_insert on public.records
  for insert to authenticated
  with check (
    public.ist_mitglied(org_id)
    and created_by = auth.uid()
    and (
      ( coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
        and (not public.entity_modell(entity) or public.hat_recht(org_id, 'can_edit_model')) )
      or
      ( public.ist_extern(org_id)
        and eigner = auth.uid()
        and (
          ( public.entity_bereich(entity) = 'gebot'
            and public.hat_recht(org_id, 'can_submit_bid')
            and vergabe_id is not null
            and public.darf_vergabe(org_id, vergabe_id)
            and public.submission_laeuft(org_id, vergabe_id) )
          or
          ( entity = 'BcfRueckfrage'
            and projekt_id is not null
            and public.darf_projekt(org_id, projekt_id)
            and (vergabe_id is null or public.darf_vergabe(org_id, vergabe_id)) )
        ) )
    )
  );

create policy records_update on public.records
  for update to authenticated
  using (
    public.ist_mitglied(org_id)
    and (
      ( coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
        and siegel_id is null
        and (not public.entity_modell(entity) or public.hat_recht(org_id, 'can_edit_model')) )
      or
      ( public.ist_extern(org_id)
        and eigner = auth.uid()
        and (siegel_id is null or public.submission_laeuft(org_id, vergabe_id)) )
    )
  )
  with check (
    public.ist_mitglied(org_id)
    and (
      ( coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
        and siegel_id is null
        and (not public.entity_modell(entity) or public.hat_recht(org_id, 'can_edit_model')) )
      or
      ( public.ist_extern(org_id)
        and eigner = auth.uid()
        and (siegel_id is null or public.submission_laeuft(org_id, vergabe_id)) )
    )
  );

-- 3. warum_sichtbar of 0011. -------------------------------------------------------
create or replace function public.warum_sichtbar(p_id text) returns text
language plpgsql security definer stable set search_path = public as $$
declare
  r public.records%rowtype;
  v_rolle text;
begin
  select * into r from public.records where id = p_id;
  if not found or not public.ist_mitglied(r.org_id) then
    return 'nicht sichtbar: kein Datensatz in einem Ihrer Büros';
  end if;
  v_rolle := public.rolle_in(r.org_id);
  if public.ist_intern(r.org_id) then
    if public.entity_bereich(r.entity) = 'gebot' and r.siegel_id is not null
       and r.eigner is distinct from auth.uid() and not public.submission_offen(r.org_id, r.vergabe_id) then
      return format('nicht sichtbar: Siegel %s, Submission noch nicht geöffnet', r.vergabe_id);
    end if;
    return format('intern, Rolle %s', v_rolle);
  end if;
  if r.eigner = auth.uid() then
    return 'eigene Zeile';
  end if;
  if r.sicht = 'freigegeben' and public.entity_extern(r.entity) and r.projekt_id is not null
     and public.darf_projekt(r.org_id, r.projekt_id)
     and (r.vergabe_id is null or public.darf_vergabe(r.org_id, r.vergabe_id)) then
    return format('Projektion, Projekt %s%s', r.projekt_id,
                  case when r.vergabe_id is not null then ', Vergabe ' || r.vergabe_id else '' end);
  end if;
  return format('nicht sichtbar: Rolle %s, weder eigene Zeile noch Freigabe für Ihr Projekt/Ihre Vergabe', v_rolle);
end;
$$;
revoke all on function public.warum_sichtbar(text) from public;
grant execute on function public.warum_sichtbar(text) to authenticated;

-- 4. Trigger, storage policies, functions. -------------------------------------------
drop trigger if exists records_bauherr on public.records;
drop function if exists public.records_bauherr();
drop policy if exists bauherr_insert on storage.objects;
drop policy if exists bauherr_select on storage.objects;
drop policy if exists bauherr_delete on storage.objects;
drop function if exists public.bauherr_antworten(text, text);
drop function if exists public.bauherr_zuruecknehmen(text);
drop function if exists public.bauherr_freigeben(text, text, jsonb, text);
drop function if exists public.bauherr_quellen(text);
drop function if exists public.bauherr_bereinigen(text, jsonb);
drop function if exists public.bauherr_felder(text);
drop function if exists public.ist_zielgruppe(uuid, text, text);
drop function if exists public.entity_extern_schreibbar(text);
drop function if exists public.entity_zielrolle(text);
drop function if exists public.projekt_rolle(uuid, text);

-- 5. Catalogue. ---------------------------------------------------------------------
delete from public.entity_regeln where zielrolle = 'bauherr';
alter table public.entity_regeln drop column if exists zielrolle, drop column if exists extern_schreibbar;

-- 6. Role vocabulary of 0006/0007. ---------------------------------------------------
create or replace function public.ist_extern(p_org uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role in ('bidder', 'investor', 'gast')
       from public.org_members where org_id = p_org and user_id = auth.uid()),
    false)
$$;
revoke all on function public.ist_extern(uuid) from public;
grant execute on function public.ist_extern(uuid) to authenticated, service_role;

alter table public.projekt_zugang drop constraint if exists projekt_zugang_rolle_check;
alter table public.projekt_zugang
  add constraint projekt_zugang_rolle_check check (rolle in ('bidder', 'investor', 'gast'));

alter table public.org_members drop constraint if exists org_members_extern_ohne_internrechte;
alter table public.org_members
  add constraint org_members_extern_ohne_internrechte
  check (role not in ('bidder', 'investor', 'gast')
         or (not can_edit_model and not can_export_ifc and not can_view_audit_reports));

alter table public.org_members drop constraint if exists org_members_rolle_check;
alter table public.org_members
  add constraint org_members_rolle_check
  check (role in ('owner', 'planner', 'leser', 'bidder', 'investor', 'gast'));

commit;
