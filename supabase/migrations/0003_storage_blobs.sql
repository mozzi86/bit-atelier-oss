-- 0003_storage_blobs.sql — Phase 57-01 (D-P57-05): private bucket `blobs`.
-- Object path convention: <org_id>/<blob-id>.json — the same id whitelist as
-- packages/nova-core/server/blobs.js:17 (ID_MUSTER /^[A-Za-z0-9_-]+$/), and
-- the same membership rule as 0002: public.ist_mitglied() on path segment 1.

insert into storage.buckets (id, name, public)
values ('blobs', 'blobs', false)
on conflict (id) do nothing;

-- Path shape is enforced inside every policy:
-- '<36-char lowercase uuid>/<whitelist id>.json'.
-- The uuid cast of segment 1 is safe in practice: only inserts that passed
-- this regex ever land in the bucket, so select/update/delete policies never
-- see a malformed name (a malformed name on INSERT fails the statement —
-- still a denial, just with a Postgres error instead of "0 rows").
create policy blobs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and public.ist_mitglied((storage.foldername(name))[1]::uuid)
  );

create policy blobs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and public.ist_mitglied((storage.foldername(name))[1]::uuid)
  );

create policy blobs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and public.ist_mitglied((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and public.ist_mitglied((storage.foldername(name))[1]::uuid)
  );

create policy blobs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and public.ist_mitglied((storage.foldername(name))[1]::uuid)
  );
