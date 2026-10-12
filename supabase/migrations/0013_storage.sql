-- 0013_storage.sql — Phase 74-01 Task 8: storage — three buckets, three rules.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- blobs      the INTERNAL working archive (0003). The four policies narrow
--            from ist_mitglied to internal roles; writing needs owner/planner.
--            Model objects additionally need can_export_ifc. The object →
--            record link is the real column records.blob_name (0008) —
--            NOT data->>'blob_id' (no such field exists; projectImport.js
--            writes `elemente_blob`). An object WITHOUT a link counts as a
--            model: in doubt closed. Today no write path sets blob_name yet,
--            so every object counts as a model — both stock roles carry
--            can_export_ifc (0006 backfill), the office sees no difference;
--            `leser` (no flag) reads no blobs until the write path sets the link.
-- freigaben  NEW, private. <org_id>/<projekt_id>/<vergabe_id|_allgemein>/<file>.
--            Read: internal roles only. Externals do NOT read directly — they
--            download through the edge function `freigabe` (only there a log
--            entry and a refusal can be recorded, A-32). .ifc/.ifczip also
--            need can_export_ifc. Write: owner/planner with can_edit_model.
-- gebote     NEW, private. <org_id>/<vergabe_id>/<user_id>/<file>.
--            Write: only into one's OWN folder (segment 3 = auth.uid()), only
--            as participant, only while the deadline runs; overwrite/delete
--            only while it runs. Read: the author, or internal roles after the
--            opening act. Without this bucket a real offer (PDF, GAEB) has no
--            place — and the obvious workaround ("then under freigaben")
--            would make every offer readable for every bidder.
--
-- Open (documented in the SUMMARY): the attachments do not enter the seal
-- yet. storage.objects carries no content hash we control; submission_oeffnen
-- (0009) records the record hashes only.
--
-- uuid cast of path segment 1 via public.als_uuid(): NULL on malformed input
-- instead of an exception. One foreign-shaped object in a bucket would
-- otherwise abort every storage query — shortly before a deadline that is
-- not a cosmetic problem.

create function public.als_uuid(p text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;
revoke all on function public.als_uuid(text) from public;
grant execute on function public.als_uuid(text) to authenticated, service_role;

-- Is a blobs object a model (or unlinked, which counts as model)?
create function public.blob_ist_modell(p_org uuid, p_name text) returns boolean
language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.records r
     where r.org_id = p_org and r.blob_name = p_name and not public.entity_modell(r.entity)
  )
$$;
revoke all on function public.blob_ist_modell(uuid, text) from public;
grant execute on function public.blob_ist_modell(uuid, text) to authenticated, service_role;

insert into storage.buckets (id, name, public) values
  ('freigaben', 'freigaben', false),
  ('gebote', 'gebote', false)
on conflict (id) do nothing;

-- 1. blobs: replace the four policies of 0003. --------------------------------
drop policy if exists blobs_select on storage.objects;
drop policy if exists blobs_insert on storage.objects;
drop policy if exists blobs_update on storage.objects;
drop policy if exists blobs_delete on storage.objects;

create policy blobs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and public.ist_intern(public.als_uuid((storage.foldername(name))[1]))
    and ( not public.blob_ist_modell(public.als_uuid((storage.foldername(name))[1]), name)
          or public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_export_ifc') )
  );

create policy blobs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
  );

create policy blobs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
  )
  with check (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
  );

create policy blobs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'blobs'
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.json$'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
  );

-- 2. freigaben. -------------------------------------------------------------------
-- Path: 4 segments, the last is the file; no further folders.
create policy freigaben_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'freigaben'
    and array_length(storage.foldername(name), 1) = 3
    and public.ist_intern(public.als_uuid((storage.foldername(name))[1]))
    and ( name !~* '\.ifc(zip)?$'
          or public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_export_ifc') )
  );

create policy freigaben_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'freigaben'
    and array_length(storage.foldername(name), 1) = 3
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
    and public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_edit_model')
  );

create policy freigaben_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'freigaben'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
    and public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_edit_model')
  )
  with check (
    bucket_id = 'freigaben'
    and array_length(storage.foldername(name), 1) = 3
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
    and public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_edit_model')
  );

create policy freigaben_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'freigaben'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
    and public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_edit_model')
  );

-- 3. gebote. ----------------------------------------------------------------------
create policy gebote_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gebote'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.ist_extern(public.als_uuid((storage.foldername(name))[1]))
    and public.hat_recht(public.als_uuid((storage.foldername(name))[1]), 'can_submit_bid')
    and public.darf_vergabe(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2])
    and public.submission_laeuft(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2])
  );

create policy gebote_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'gebote'
    and array_length(storage.foldername(name), 1) = 3
    and ( (storage.foldername(name))[3] = auth.uid()::text
          or ( public.ist_intern(public.als_uuid((storage.foldername(name))[1]))
               and public.submission_offen(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2]) ) )
  );

-- Overwrite and delete: own folder, only while the deadline runs. After it the
-- file is part of the sealed offer.
create policy gebote_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'gebote'
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.submission_laeuft(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'gebote'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.submission_laeuft(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2])
  );

create policy gebote_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'gebote'
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.submission_laeuft(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2])
  );
