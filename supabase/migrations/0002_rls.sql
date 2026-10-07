-- 0002_rls.sql — Phase 57-01 (D-P57-04): row level security via membership.
-- ONE rule, used by the records policies here AND by the storage policies in
-- 0003: public.ist_mitglied(org_id).

-- SECURITY DEFINER: executes as the function owner (postgres), so the lookup
-- into org_members does not recurse into org_members' own RLS.
-- search_path is pinned — definer functions must not depend on the caller's path.
create function public.ist_mitglied(p_org uuid) returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
  )
$$;

revoke all on function public.ist_mitglied(uuid) from public;
grant execute on function public.ist_mitglied(uuid) to authenticated;

alter table public.orgs        enable row level security;
alter table public.org_members enable row level security;
alter table public.records     enable row level security;

-- records: full CRUD for members of the row's org. Insert additionally
-- enforces created_by = auth.uid(), so no client can write rows "as" someone
-- else. (The import in 57-03 runs with the service-role key, which bypasses
-- RLS and leaves created_by null — intended.)
create policy records_select on public.records
  for select to authenticated
  using (public.ist_mitglied(org_id));

create policy records_insert on public.records
  for insert to authenticated
  with check (public.ist_mitglied(org_id) and created_by = auth.uid());

-- WITH CHECK on update too: without it a member could UPDATE org_id to a
-- foreign org and move rows out of their tenant (review R-1, 18.09.2026).
create policy records_update on public.records
  for update to authenticated
  using (public.ist_mitglied(org_id))
  with check (public.ist_mitglied(org_id));

create policy records_delete on public.records
  for delete to authenticated
  using (public.ist_mitglied(org_id));

-- orgs: members see their org. NO insert/update policies for clients in
-- stage 1 — orgs are created by the owner in the dashboard/SQL editor
-- (D-P57-10, invitation-based).
create policy orgs_select on public.orgs
  for select to authenticated
  using (public.ist_mitglied(id));

-- org_members: everyone sees their OWN memberships (the client needs this to
-- resolve aktuelleOrgId, 57-02). No client insert — memberships are granted
-- by the owner.
create policy org_members_select on public.org_members
  for select to authenticated
  using (user_id = auth.uid());
