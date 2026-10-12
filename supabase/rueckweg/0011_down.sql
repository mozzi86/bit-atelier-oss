-- 0011_down.sql — rollback of 0011_policies_records.sql (Phase 74-01).
-- Requires: 0014_down … 0012_down have run — EXCEPT as the abort step of
-- Task 11/12, where it may run alone right after 0011 was applied (0012-0014
-- are not in yet at that point).
-- Restores the four records policies of 0002_rls.sql WORD FOR WORD and drops
-- warum_sichtbar(). A pure policy swap: run it in one transaction.
--
-- Why not in supabase/migrations/down/ as the plan says: the CLI reads the
-- migrations folder; a rollback file must never be picked up by `db push`.
-- Run by hand: psql "<connection string>" -f supabase/rueckweg/0011_down.sql

begin;

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
drop policy if exists records_delete on public.records;

create policy records_select on public.records
  for select to authenticated
  using (public.ist_mitglied(org_id));

create policy records_insert on public.records
  for insert to authenticated
  with check (public.ist_mitglied(org_id) and created_by = auth.uid());

create policy records_update on public.records
  for update to authenticated
  using (public.ist_mitglied(org_id))
  with check (public.ist_mitglied(org_id));

create policy records_delete on public.records
  for delete to authenticated
  using (public.ist_mitglied(org_id));

drop function if exists public.warum_sichtbar(text);

commit;
