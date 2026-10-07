-- 0004_llm_connections.sql — Phase 57-01 (D-P57-07): LLM API keys live
-- OUTSIDE the tenant-readable `records` table.
--
-- Why a table of its own: RLS is row-level, not column-level — a row in
-- `records` that org members may read would expose `api_key` in the jsonb
-- payload. Here: RLS enabled and ZERO policies for anon/authenticated, which
-- is default-deny. Reading (masked) and use only via the Edge Function
-- (57-04) with the service-role key, which bypasses RLS.

create table public.llm_connections (
  id           text primary key,
  -- Org-scoped like everything else; NOT NULL so no key can escape tenancy.
  org_id       uuid not null references public.orgs,
  name         text not null default '',
  provider     text not null,
  base_url     text,
  model        text,
  api_key      text,
  active       boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index llm_connections_org_idx on public.llm_connections (org_id);

alter table public.llm_connections enable row level security;

-- Belt and braces: Supabase default privileges grant table access to
-- anon/authenticated. RLS with zero policies already denies everything, but
-- the explicit revoke makes the 57-01 must-have "kein Grant" literally true.
revoke all on public.llm_connections from anon, authenticated;

-- Same updated_date mechanism as records (function from migration 0001).
create trigger llm_connections_set_updated_date
  before update on public.llm_connections
  for each row execute function public.set_updated_date();
