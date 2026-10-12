-- 0011_policies_records.sql — Phase 74-01 Task 6: the four records policies.
-- THE ONLY STEP OF 74-01 THAT CHANGES BEHAVIOUR. One transaction (the CLI runs
-- each migration file in one): between drop and create, default deny applies.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
-- Rollback: supabase/rueckweg/0011_down.sql restores the 0002 policies word for
-- word — a pure policy swap, milliseconds. It is the abort step of Task 11.
--
-- Two sentences decide visibility:
--   1. Membership and role: the org gate of 0002 (ist_mitglied) stays the
--      outer gate unchanged; inside it internal and external roles take two
--      DISJOINT branches.
--   2. Ownership or release: an external role sees only rows it wrote itself
--      or projections that were released for a project AND tender it takes part in.
--
-- What stays exactly as before for the office (owner/planner after 0006):
--   - SELECT: every row; the only exception are SEALED bids before the opening
--     act — and sealed rows only exist once an external role has bid.
--   - INSERT/UPDATE: everything, except model entities without can_edit_model
--     (both stock roles have it) and sealed rows.
--   - DELETE: owner/planner, never a sealed row, never a tender with a
--     submission. Closes the stock risk that an invited account removes all
--     office rows with one statement.
--   - `leser` reads like the office and writes nothing.
-- Nothing depends on created_by: every imported row has NULL there
-- (0002_rls.sql comment), a rule on it would hide the whole stock.

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
drop policy if exists records_delete on public.records;

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

-- WITH CHECK sees the row AFTER the BEFORE trigger of 0008: projekt_id,
-- vergabe_id, eigner and siegel_id are the server's values, not the client's.
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
          -- a bid: once per tender (unique index gebot_je_bieter), only with
          -- the flag, only as participant, only while the deadline runs. The
          -- deadline is checked HERE, not only in an RPC: in a draft the lock
          -- hung on the opening act, so between deadline and opening (and for
          -- never-opened tenders forever) bids could be improved.
          ( public.entity_bereich(entity) = 'gebot'
            and public.hat_recht(org_id, 'can_submit_bid')
            and vergabe_id is not null
            and public.darf_vergabe(org_id, vergabe_id)
            and public.submission_laeuft(org_id, vergabe_id) )
          or
          -- a question: on a project the writer has access to
          ( entity = 'BcfRueckfrage'
            and projekt_id is not null
            and public.darf_projekt(org_id, projekt_id)
            and (vergabe_id is null or public.darf_vergabe(org_id, vergabe_id)) )
        ) )
    )
  );

-- Internal: everything except sealed rows — also after the opening; an opened
-- bid is a document, evaluation and award run through zuschlag_erteilen().
-- External: only the own row, and a bid only while the deadline runs.
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

create policy records_delete on public.records
  for delete to authenticated
  using (
    public.ist_mitglied(org_id)
    and coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
    and siegel_id is null
    and not (entity = 'Tender' and public.tender_hat_submission(org_id, id))
  );

-- "Why do I see this row — or not?" in plain words, for the caller. The
-- maintenance part of this plan: in six months this one function answers the
-- question for which five nested levels of the policy above must otherwise be
-- read. Same text for "no such row" and "not your org" (no existence oracle).
create function public.warum_sichtbar(p_id text) returns text
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
