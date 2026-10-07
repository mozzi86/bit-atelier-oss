-- 0005_grants.sql — Phase 57-01 review fix (18.09.2026): explicit table grants.
--
-- Why: `supabase db push` connects as the CLI *login role*, not as `postgres`.
-- The project's default privileges (new tables → anon/authenticated/service_role)
-- are defined for objects owned by `postgres`, so they did NOT apply to the
-- tables created by 0001–0004. First live rls-check failed with
-- "permission denied for table orgs" even with the secret (service) key.
--
-- Grants are the OUTER gate (may this role touch the table at all); RLS in
-- 0002 stays the INNER gate (which rows). Both must agree with 0004:
-- llm_connections gets nothing for anon/authenticated.

grant usage on schema public to anon, authenticated, service_role;

-- service role: full access, bypasses RLS by design (import 57-03, edge functions 57-04).
grant all privileges on table
  public.orgs, public.org_members, public.records, public.llm_connections
  to service_role;

-- signed-in users: only what the 0002 policies can then narrow down.
grant select on table public.orgs, public.org_members to authenticated;
grant select, insert, update, delete on table public.records to authenticated;

grant execute on function public.ist_mitglied(uuid) to service_role;
grant execute on function public.set_updated_date() to authenticated, service_role;

-- Future tables pushed by the same login role get the same outer gate.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
