-- 0008_sicht_spalten.sql — Phase 74-01 Task 3: visibility columns on records,
-- backfill, anchor trigger, column grants. Additive; every new column defaults
-- to exactly today's state, the policies of 0002 stay in force until 0011.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- The separating columns (sicht, eigner, projekt_id, vergabe_id, siegel_id,
-- blob_name, and the existing id/entity/org_id/created_by/created_date) are
-- not writable by signed-in clients — twice:
--   (a) column grants: insert only (id, entity, org_id, data, created_by),
--       update only (data) — exactly what supabaseDb.js create()/update() send;
--   (b) the BEFORE trigger records_anker() sets/resets them server-side.
--
-- NO `empfaenger uuid[]` column: in a draft it let a bidder read the auth
-- uuids of competitors with `select id, empfaenger`, and bypassed project
-- access. Named release runs through vergabe_teilnehmer (0007).
--
-- Deviation from the plan, on purpose: for INTERNAL writers projekt_id is
-- re-derived from data.project_id on every update instead of being pinned.
-- Pinning would silently undo an office user assigning a document or an LV to
-- a project (data says P1, column stays NULL, the row never moves) — a data
-- loss in the office's own workflow. The column is still never written by a
-- client; for EXTERNAL writers it is pinned as planned.

-- 1. Columns. -------------------------------------------------------------------
alter table public.records
  add column sicht      text not null default 'intern' check (sicht in ('intern', 'freigegeben')),
  add column eigner     uuid references auth.users on delete set null,
  add column projekt_id text,
  add column vergabe_id text,
  add column siegel_id  text,
  -- The real object → record link for storage rules (0013). Set by the service
  -- path only for now; how the write path fills it is decided in 0013. NOT
  -- data->>'blob_id': no field of that name exists (projectImport.js writes
  -- `elemente_blob`).
  add column blob_name  text;

-- 2. Backfill — without touching updated_date. ---------------------------------
-- records_set_updated_date (0001) would stamp all rows with "now" and reorder
-- every "last changed" list in the office; it is switched off for this one
-- statement. Project rows anchor on themselves.
alter table public.records disable trigger records_set_updated_date;
update public.records
   set projekt_id = case when entity = 'Project' then id
                         else nullif(data->>'project_id', '') end;
alter table public.records enable trigger records_set_updated_date;

-- 3. Indexes. ---------------------------------------------------------------------
create index records_org_entity_sicht_idx on public.records (org_id, entity, sicht);
create index records_org_projekt_idx on public.records (org_id, projekt_id) where projekt_id is not null;
create index records_org_eigner_idx on public.records (org_id, eigner) where eigner is not null;
create index records_vergabe_idx on public.records (vergabe_id) where vergabe_id is not null;
-- The 63 `filter({project_id})` calls of the client still run via data->>; the
-- GIN index of 0001 (jsonb_path_ops) serves containment only, not ->>.
create index records_org_entity_dataprojekt_idx on public.records (org_id, entity, (data->>'project_id'));

-- 4. Anchor trigger. ------------------------------------------------------------
-- SECURITY DEFINER: an external writer cannot see the Tender row it bids on
-- (RLS), the trigger must. auth.uid() still returns the caller.
-- Bypass: the service role (import) and the transaction-local marker
-- `bit.steuerung = 'an'`, which only the definer functions of 0009/0012 set
-- around their own writes — evaluated in the INSERT branch too (in a draft it
-- was only read on UPDATE, so the release function failed on its own trigger).
create function public.records_anker() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_extern boolean;
  v_tender record;
  v_kontakt text;
  v_schluessel text;
begin
  if public.ist_dienst() or coalesce(current_setting('bit.steuerung', true), '') = 'an' then
    return new;
  end if;

  v_extern := public.ist_extern(new.org_id);

  if tg_op = 'INSERT' then
    new.created_date := now();
    new.updated_date := now();
    new.created_by   := auth.uid();
    new.sicht        := 'intern';
    new.eigner       := null;
    new.vergabe_id   := null;
    new.siegel_id    := null;
    new.blob_name    := null;
    new.projekt_id   := case when new.entity = 'Project' then new.id
                             else nullif(new.data->>'project_id', '') end;

    if v_extern then
      -- Every external row is owned by its writer — otherwise a bidder could not
      -- read back their own question and the client would report a successful
      -- write as an error.
      new.eigner := auth.uid();
      -- Fresh server id: takes away the existence oracle of the global text
      -- primary key (23505 on a guessed id) and squatting on future ids.
      new.id := gen_random_uuid()::text;

      if public.entity_bereich(new.entity) = 'gebot' then
        -- Tender, project and seal come from the Tender row, never from data.
        select t.id, nullif(t.data->>'project_id', '') as projekt
          into v_tender
          from public.records t
         where t.org_id = new.org_id and t.entity = 'Tender' and t.id = new.data->>'tender_id';
        if not found then
          raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
        end if;
        new.vergabe_id := v_tender.id;
        new.siegel_id  := v_tender.id;
        new.projekt_id := v_tender.projekt;
        -- The bidder identity is the invitation's, not what the bidder typed.
        v_kontakt := public.mein_kontakt(new.org_id);
        new.data := jsonb_set(new.data, '{contact_id}', coalesce(to_jsonb(v_kontakt), 'null'::jsonb));
        new.data := jsonb_set(new.data, '{bidder_id}',  coalesce(to_jsonb(v_kontakt), 'null'::jsonb));
        new.data := jsonb_set(new.data, '{tender_id}',  to_jsonb(v_tender.id));
        new.data := jsonb_set(new.data, '{submitted_date}', to_jsonb(now()));
        if v_tender.projekt is not null then
          new.data := jsonb_set(new.data, '{project_id}', to_jsonb(v_tender.projekt));
        end if;
      elsif new.data ? 'tender_id' and public.darf_vergabe(new.org_id, new.data->>'tender_id') then
        -- A question about a tender the writer takes part in.
        new.vergabe_id := new.data->>'tender_id';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: reset, do not compare-and-throw (throwing would block every save
  -- of rows whose column and jsonb disagree for historical reasons).
  new.id         := old.id;
  new.entity     := old.entity;
  new.org_id     := old.org_id;
  new.created_by := old.created_by;
  new.created_date := old.created_date;
  new.sicht      := old.sicht;
  new.eigner     := old.eigner;
  new.vergabe_id := old.vergabe_id;
  new.siegel_id  := old.siegel_id;
  new.blob_name  := old.blob_name;

  if v_extern then
    new.projekt_id := old.projekt_id;
    if old.projekt_id is not null and new.entity <> 'Project' then
      new.data := jsonb_set(new.data, '{project_id}', to_jsonb(old.projekt_id));
    end if;
  else
    new.projekt_id := case when new.entity = 'Project' then new.id
                           else nullif(new.data->>'project_id', '') end;
  end if;

  -- A sealed bid keeps its identity: without this a bidder rewrites their bid
  -- onto a competitor's contact after the fact (the check sits only in INSERT).
  if old.siegel_id is not null then
    foreach v_schluessel in array array['contact_id', 'bidder_id', 'bidder_name', 'tender_id',
                                         'project_id', 'submitted_date'] loop
      if old.data ? v_schluessel then
        new.data := jsonb_set(new.data, array[v_schluessel], old.data->v_schluessel);
      else
        new.data := new.data - v_schluessel;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.records_anker() from public;

-- Name sorts before records_set_updated_date, so the anchor runs first and the
-- updated_date trigger still stamps the final row.
create trigger records_anker
  before insert or update on public.records
  for each row execute function public.records_anker();

-- 5. Column grants — the second, independent lock. ---------------------------
-- created_date is no longer client-writable: the arrival time of a bid does not
-- hang on a field the bidder sets. supabaseDb.js:180-188 writes exactly these
-- five columns, :203-209 exactly `data` — the everyday path is untouched.
revoke insert, update on public.records from authenticated;
grant insert (id, entity, org_id, data, created_by) on public.records to authenticated;
grant update (data) on public.records to authenticated;
