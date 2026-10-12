-- 0008_down.sql — rollback of 0008_sicht_spalten.sql (Phase 74-01).
-- Requires: 0011_down.sql, 0010_down.sql, 0009_down.sql have run.
--
-- FIRST the policies of 0002 are restored (again, idempotent) — only THEN the
-- columns go. A `drop column … cascade` with the 0011 policies still in place
-- would take the SELECT policy with it, and the office would see zero rows at
-- once (default deny).

begin;

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
drop policy if exists records_delete on public.records;
create policy records_select on public.records
  for select to authenticated using (public.ist_mitglied(org_id));
create policy records_insert on public.records
  for insert to authenticated with check (public.ist_mitglied(org_id) and created_by = auth.uid());
create policy records_update on public.records
  for update to authenticated using (public.ist_mitglied(org_id)) with check (public.ist_mitglied(org_id));
create policy records_delete on public.records
  for delete to authenticated using (public.ist_mitglied(org_id));

-- Table-level grants of 0005 back (the column grants go with the revoke).
revoke insert (id, entity, org_id, data, created_by) on public.records from authenticated;
revoke update (data) on public.records from authenticated;
grant insert, update on public.records to authenticated;

drop trigger if exists records_anker on public.records;
drop function if exists public.records_anker();

drop index if exists public.records_org_entity_dataprojekt_idx;
drop index if exists public.records_vergabe_idx;
drop index if exists public.records_org_eigner_idx;
drop index if exists public.records_org_projekt_idx;
drop index if exists public.records_org_entity_sicht_idx;

-- Without cascade on purpose: if anything still depends on a column, the
-- rollback stops here with a message instead of silently dropping it.
alter table public.records
  drop column if exists blob_name,
  drop column if exists siegel_id,
  drop column if exists vergabe_id,
  drop column if exists projekt_id,
  drop column if exists eigner,
  drop column if exists sicht;

commit;
