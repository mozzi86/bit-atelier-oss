-- 0001_orgs_records.sql — Phase 57-01 (D-P57-03, D-P57-04)
--
-- Foundation of the tenant model:
--   orgs         one row per office (stage 1: exactly one — our own)
--   org_members  membership of auth users in an org, with role
--   records      THE generic data table for all 36+ entity types
--
-- Why ONE jsonb table instead of 36 typed tables (D-P57-03): the entity list
-- is open (bitApi.js:83 Proxy — "any entity name works") and the field sets
-- are not written down as a schema anywhere; the domain phases keep growing
-- them. Typed tables would freeze those field sets. Typed views can be added
-- later without a data move.
--
-- Field names id/created_date/updated_date mirror
-- packages/nova-core/server/db.js 1:1, so the import (57-03) needs no renaming.

-- gen_random_uuid() (pgcrypto; builtin since PG13, extension kept for clarity)
create extension if not exists pgcrypto;

create table public.orgs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  created_date timestamptz not null default now()
);

create table public.org_members (
  user_id uuid not null references auth.users on delete cascade,
  org_id  uuid not null references public.orgs on delete cascade,
  role    text not null check (role in ('admin', 'mitglied')),
  primary key (user_id, org_id)
);

-- `id` stays TEXT, not uuid: db.js:81 id() generates its own compact ids and
-- the import (57-03) must keep them — otherwise cross-references inside the
-- data (project_id, element_guid, blob references) would break.
create table public.records (
  id           text primary key,
  entity       text not null,
  org_id       uuid not null references public.orgs,
  data         jsonb not null default '{}',
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   uuid references auth.users
);

-- (org_id, entity) is THE access path: every client call filters both.
create index records_org_entity_idx on public.records (org_id, entity);
-- GIN for containment/path queries on the jsonb payload.
create index records_data_idx on public.records using gin (data jsonb_path_ops);
-- Most common sort is `-created_date` (db.js list default in several panels).
create index records_created_idx on public.records (org_id, entity, created_date desc);

-- Keeps updated_date current on every UPDATE (mirrors db.js update()).
create function public.set_updated_date() returns trigger
language plpgsql as $$
begin
  new.updated_date := now();
  return new;
end;
$$;

create trigger records_set_updated_date
  before update on public.records
  for each row execute function public.set_updated_date();
