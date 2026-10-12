-- 0013_down.sql — rollback of 0013_storage.sql (Phase 74-01).
-- Requires: 0014_down.sql has run.
--
-- Restores the four blobs policies of 0003_storage_blobs.sql word for word.
-- The buckets `freigaben` and `gebote` are NOT deleted: they may hold offers
-- (attachments of bids). Without policies no client reaches them; delete them
-- by hand in the dashboard once their content is saved or no longer needed.

begin;

drop policy if exists gebote_delete on storage.objects;
drop policy if exists gebote_update on storage.objects;
drop policy if exists gebote_select on storage.objects;
drop policy if exists gebote_insert on storage.objects;
drop policy if exists freigaben_delete on storage.objects;
drop policy if exists freigaben_update on storage.objects;
drop policy if exists freigaben_insert on storage.objects;
drop policy if exists freigaben_select on storage.objects;

drop policy if exists blobs_select on storage.objects;
drop policy if exists blobs_insert on storage.objects;
drop policy if exists blobs_update on storage.objects;
drop policy if exists blobs_delete on storage.objects;

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

drop function if exists public.blob_ist_modell(uuid, text);
drop function if exists public.als_uuid(text);

commit;
