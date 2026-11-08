-- 0016_bauherr.sql — Phase 110-01: the client ("Bauherr") as a fifth external role.
--
-- STATUS 05.11.2026: written and reviewed by reading only — NOT run against
-- Postgres (same as 0006…0015: no local database on the build machine). Needs
-- 0006…0015 applied first. Proof: supabase/tests/110-01_bauherr.sql against a
-- THROWAWAY project, never the live one. Rollback: supabase/rueckweg/0016_down.sql.
--
-- What a client sees, in two sentences (the same two of 0011, one word added):
--   1. Membership and role: role `bauherr` joins the EXTERNAL set (0006); the
--      office gate and the internal branch of the policies stay untouched.
--   2. Ownership or release: a client sees only rows they wrote themselves and
--      PROJECTIONS the office released for THEIR project — and only those
--      projection kinds whose catalogue row names `bauherr` as audience
--      (`zielrolle`). A bidder of the same project never sees a client
--      projection, a client never sees a bidder projection (those carry a
--      tender id and need tender participation, 0011).
--
-- Why projections again (0012): RLS filters rows, not jsonb keys. A Project row
-- carries fee data, internal notes and [ASSUMED] values; a Plan row carries its
-- internal review trail; a cost row carries the office's unit prices. The
-- office therefore WRITES new rows that carry only whitelisted keys. Unlike
-- 0012 the mapping source → projection lives in the client
-- (packages/nova-core/src/lib/bauherrProjektion.js), because the sources are
-- nested and differ per entity; the database does not trust that mapping: it
-- strips every key that is not on the SQL whitelist below and refuses rows that
-- are too large. tests/unit/bauherr-11001.test.js reads this file and checks
-- that both whitelists are the same — a key added on one side only is a red run.
--
-- Client rows (decisions, questions, uploads) are immutable once written: a
-- decision is a record ("freigegeben am …"), a correction is a new row.

-- 1. Role vocabulary. --------------------------------------------------------------
alter table public.org_members drop constraint if exists org_members_rolle_check;
alter table public.org_members
  add constraint org_members_rolle_check
  check (role in ('owner', 'planner', 'leser', 'bidder', 'investor', 'gast', 'bauherr'));

alter table public.org_members drop constraint if exists org_members_extern_ohne_internrechte;
alter table public.org_members
  add constraint org_members_extern_ohne_internrechte
  check (role not in ('bidder', 'investor', 'gast', 'bauherr')
         or (not can_edit_model and not can_export_ifc and not can_view_audit_reports));
-- org_members_gebot_nur_extern (0006) stays: a client never submits a bid.

-- The inline check of 0007 got the generated name projekt_zugang_rolle_check.
alter table public.projekt_zugang drop constraint if exists projekt_zugang_rolle_check;
alter table public.projekt_zugang
  add constraint projekt_zugang_rolle_check
  check (rolle in ('bidder', 'investor', 'gast', 'bauherr'));

create or replace function public.ist_extern(p_org uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role in ('bidder', 'investor', 'gast', 'bauherr')
       from public.org_members where org_id = p_org and user_id = auth.uid()),
    false)
$$;
revoke all on function public.ist_extern(uuid) from public;
grant execute on function public.ist_extern(uuid) to authenticated, service_role;

-- 2. Audience and writability in the catalogue. -------------------------------------
-- zielrolle NULL = every external participant of the project (the 0011 meaning,
-- unchanged for TenderFreigabe & Co.); 'bauherr' = only callers whose project
-- access row says bauherr. extern_schreibbar = an external role of the
-- audience may INSERT rows of this kind (bids and BcfRueckfrage keep their own
-- branches in records_insert).
alter table public.entity_regeln
  add column zielrolle text check (zielrolle in ('bauherr')),
  add column extern_schreibbar boolean not null default false;

insert into public.entity_regeln (entity, bereich, extern_sichtbar, modell, notiz, zielrolle, extern_schreibbar) values
  -- projections written by the office (bauherr_freigeben below)
  ('BauherrProjekt',      'projekt', true, false, 'Projektübersicht ohne Honorar/Notizen (110-01)',        'bauherr', false),
  ('BauherrTermin',       'projekt', true, false, 'Termin/Meilenstein',                                     'bauherr', false),
  ('BauherrPlan',         'projekt', true, false, 'freigegebener Plan, PDF in freigaben/_bauherr',          'bauherr', false),
  ('BauherrModell',       'projekt', true, false, 'Ansichtsdatei des Gebäudemodells, nie das IFC-Original', 'bauherr', false),
  ('BauherrKosten',       'projekt', true, false, 'Kosten auf KG-Ebene (DIN 276), ohne Einheitspreise',     'bauherr', false),
  ('BauherrDokument',     'projekt', true, false, 'Dokument mit Kennzeichen für Bauherr',                   'bauherr', false),
  ('BauherrBemusterung',  'projekt', true, false, 'Bemusterung mit Optionen und Mehrkosten',                'bauherr', false),
  ('BauherrFoto',         'projekt', true, false, 'Baustellenfoto nach Freigabe',                           'bauherr', false),
  ('BauherrRechnung',     'projekt', true, false, 'eigene Ausgangsrechnung des Büros an den Bauherrn',      'bauherr', false),
  ('BauherrBeteiligter',  'projekt', true, false, 'Liste der Projektbeteiligten: Name, Rolle, Kontakt',     'bauherr', false),
  ('BauherrAntwort',      'projekt', true, false, 'Antwort des Büros auf eine Frage (bauherr_antworten)',   'bauherr', false),
  -- written by the client
  ('BauherrRueckmeldung', 'projekt', true, false, 'Freigabe/Ablehnung/Auswahl/Frage/Kommentar, unveränderlich', 'bauherr', true),
  ('BauherrUpload',       'projekt', true, false, 'eigenes Dokument des Bauherrn, Datei im Bucket bauherr', 'bauherr', true)
on conflict (entity) do nothing;

-- 3. Guards. ----------------------------------------------------------------------
-- The caller's role on a project (valid access only), or NULL.
create function public.projekt_rolle(p_org uuid, p_projekt text) returns text
language sql security definer stable set search_path = public as $$
  select rolle from public.projekt_zugang
   where org_id = p_org and user_id = auth.uid() and projekt_id = p_projekt
     and (gueltig_bis is null or gueltig_bis > now())
   limit 1
$$;
revoke all on function public.projekt_rolle(uuid, text) from public;
grant execute on function public.projekt_rolle(uuid, text) to authenticated, service_role;

-- Invoker SQL like entity_bereich (0007): inlinable, the catalogue is no secret.
create function public.entity_zielrolle(p_entity text) returns text
language sql stable set search_path = public as $$
  select zielrolle from public.entity_regeln where entity = p_entity
$$;
revoke all on function public.entity_zielrolle(text) from public;
grant execute on function public.entity_zielrolle(text) to authenticated, service_role;

create function public.entity_extern_schreibbar(p_entity text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select extern_schreibbar from public.entity_regeln where entity = p_entity), false)
$$;
revoke all on function public.entity_extern_schreibbar(text) from public;
grant execute on function public.entity_extern_schreibbar(text) to authenticated, service_role;

-- Does the caller belong to the audience of this kind on this project?
-- NULL audience → yes (0011 meaning); otherwise the access row must name it.
create function public.ist_zielgruppe(p_org uuid, p_projekt text, p_entity text) returns boolean
language sql stable set search_path = public as $$
  select case
           when public.entity_zielrolle(p_entity) is null then true
           else coalesce(public.projekt_rolle(p_org, p_projekt), '') = public.entity_zielrolle(p_entity)
         end
$$;
revoke all on function public.ist_zielgruppe(uuid, text, text) from public;
grant execute on function public.ist_zielgruppe(uuid, text, text) to authenticated, service_role;

-- 4. The records policies of 0011, each with the audience clause. -------------------
-- Internal branches are copied word for word; only the external branches change.
drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;

create policy records_select on public.records
  for select to authenticated
  using (
    public.ist_mitglied(org_id)
    and (
      ( public.ist_intern(org_id)
        and ( public.entity_bereich(entity) <> 'gebot'
              or siegel_id is null
              or eigner = auth.uid()
              or public.submission_offen(org_id, vergabe_id) ) )
      or
      ( public.ist_extern(org_id)
        and ( eigner = auth.uid()
              or ( sicht = 'freigegeben'
                   and public.entity_extern(entity)
                   and projekt_id is not null
                   and public.darf_projekt(org_id, projekt_id)
                   and (vergabe_id is null or public.darf_vergabe(org_id, vergabe_id))
                   and public.ist_zielgruppe(org_id, projekt_id, entity) ) ) )
    )
  );

create policy records_insert on public.records
  for insert to authenticated
  with check (
    public.ist_mitglied(org_id)
    and created_by = auth.uid()
    and (
      ( coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
        and (not public.entity_modell(entity) or public.hat_recht(org_id, 'can_edit_model')) )
      or
      ( public.ist_extern(org_id)
        and eigner = auth.uid()
        and (
          ( public.entity_bereich(entity) = 'gebot'
            and public.hat_recht(org_id, 'can_submit_bid')
            and vergabe_id is not null
            and public.darf_vergabe(org_id, vergabe_id)
            and public.submission_laeuft(org_id, vergabe_id) )
          or
          ( entity = 'BcfRueckfrage'
            and projekt_id is not null
            and public.darf_projekt(org_id, projekt_id)
            and (vergabe_id is null or public.darf_vergabe(org_id, vergabe_id)) )
          or
          -- NEW (110-01): a client row on a project the writer is client of.
          -- The audience must be named (zielrolle not null): a writable kind
          -- without audience would be writable by every external role.
          ( public.entity_extern_schreibbar(entity)
            and public.entity_zielrolle(entity) is not null
            and projekt_id is not null
            and vergabe_id is null
            and public.ist_zielgruppe(org_id, projekt_id, entity) )
        ) )
    )
  );

-- External: the own row only, and never a client row (immutable, see header).
create policy records_update on public.records
  for update to authenticated
  using (
    public.ist_mitglied(org_id)
    and (
      ( coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
        and siegel_id is null
        and (not public.entity_modell(entity) or public.hat_recht(org_id, 'can_edit_model')) )
      or
      ( public.ist_extern(org_id)
        and eigner = auth.uid()
        and public.entity_zielrolle(entity) is null
        and (siegel_id is null or public.submission_laeuft(org_id, vergabe_id)) )
    )
  )
  with check (
    public.ist_mitglied(org_id)
    and (
      ( coalesce(public.rolle_in(org_id), '') in ('owner', 'planner')
        and siegel_id is null
        and (not public.entity_modell(entity) or public.hat_recht(org_id, 'can_edit_model')) )
      or
      ( public.ist_extern(org_id)
        and eigner = auth.uid()
        and public.entity_zielrolle(entity) is null
        and (siegel_id is null or public.submission_laeuft(org_id, vergabe_id)) )
    )
  );
-- records_delete (0011) stays: owner/planner only.

-- 5. Whitelists of the projections. -------------------------------------------------
-- One `when` line per kind; a nested list gets its own line '<Kind>.<key>'.
-- The client mapping (bauherrProjektion.js, BAUHERR_FELDER) must list exactly
-- the same keys — tests/unit/bauherr-11001.test.js parses the lines below.

create function public.bauherr_felder(p_art text) returns text[]
language sql immutable set search_path = public as $$
  select case p_art
    when 'BauherrProjekt'     then array['project_id','name','adresse','status','phase','baubeginn','fertigstellung','hinweis']
    when 'BauherrTermin'      then array['project_id','titel','beginn','ende','status','art']
    when 'BauherrPlan'        then array['project_id','titel','plannummer','index','massstab','status','stand','datei','entscheidung_offen']
    when 'BauherrModell'      then array['project_id','titel','stand','datei']
    when 'BauherrKosten'      then array['project_id','titel','stufe','stand','summe_netto','summe_brutto','gruppen','hinweis']
    when 'BauherrKosten.gruppen' then array['kg','bezeichnung','betrag_netto','betrag_brutto']
    when 'BauherrDokument'    then array['project_id','titel','kategorie','datum','datei','entscheidung_offen']
    when 'BauherrBemusterung' then array['project_id','titel','raum','gewerk','frist','status','optionen','entscheidung_offen']
    when 'BauherrBemusterung.optionen' then array['schluessel','titel','beschreibung','mehrkosten_brutto']
    when 'BauherrFoto'        then array['project_id','titel','datum','datei','bemerkung']
    when 'BauherrRechnung'    then array['project_id','nummer','titel','datum','betrag_netto','betrag_brutto','faellig_am','status','datei']
    when 'BauherrBeteiligter' then array['project_id','titel','personen']
    when 'BauherrBeteiligter.personen' then array['name','rolle','firma','email','telefon']
    when 'BauherrAntwort'     then array['project_id','bezug_id','frage','antwort']
    when 'BauherrRueckmeldung' then array['project_id','bezug_id','bezug_entity','art','option','text','zeitpunkt']
    when 'BauherrUpload'      then array['project_id','titel','datei','groesse_bytes','mime','text','zeitpunkt']
    else array[]::text[]
  end
$$;
revoke all on function public.bauherr_felder(text) from public;
grant execute on function public.bauherr_felder(text) to authenticated, service_role;

-- Keeps only whitelisted top-level keys; a nested list key keeps only objects,
-- each stripped to its own whitelist. Scalars inside lists are dropped.
create function public.bauherr_bereinigen(p_art text, p_inhalt jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_aus jsonb := '{}'::jsonb;
  v_schluessel text;
  v_unter text[];
  v_liste jsonb;
  v_el jsonb;
begin
  if p_inhalt is null or jsonb_typeof(p_inhalt) <> 'object' then
    return '{}'::jsonb;
  end if;
  foreach v_schluessel in array public.bauherr_felder(p_art) loop
    continue when not (p_inhalt ? v_schluessel);
    v_unter := public.bauherr_felder(p_art || '.' || v_schluessel);
    if cardinality(v_unter) > 0 then
      v_liste := '[]'::jsonb;
      if jsonb_typeof(p_inhalt->v_schluessel) = 'array' then
        for v_el in select * from jsonb_array_elements(p_inhalt->v_schluessel) loop
          if jsonb_typeof(v_el) = 'object' then
            v_liste := v_liste || jsonb_build_array(
              (select coalesce(jsonb_object_agg(k, v_el->k), '{}'::jsonb) from unnest(v_unter) k
                where v_el ? k and jsonb_typeof(v_el->k) in ('string', 'number', 'boolean', 'null')));
          end if;
        end loop;
      end if;
      v_aus := v_aus || jsonb_build_object(v_schluessel, v_liste);
    elsif jsonb_typeof(p_inhalt->v_schluessel) in ('string', 'number', 'boolean', 'null') then
      -- Only scalars on the top level (besides the named lists): an object
      -- under an allowed key would smuggle a whole source row through.
      v_aus := v_aus || jsonb_build_object(v_schluessel, p_inhalt->v_schluessel);
    end if;
  end loop;
  return v_aus;
end;
$$;
revoke all on function public.bauherr_bereinigen(text, jsonb) from public;
grant execute on function public.bauherr_bereinigen(text, jsonb) to authenticated, service_role;

-- Source entities a projection kind may be made from. A release from another
-- entity is refused: the source id is the anchor for "same release again"
-- (update in place keeps the projection id, so a client's decision on it
-- stays attached).
create function public.bauherr_quellen(p_art text) returns text[]
language sql immutable set search_path = public as $$
  -- Entity names as the office writes them (110-RESEARCH § Quellen):
  -- participants are ONE projection per project (list, from Project.beteiligte
  -- resolved against Contact) — a Contact row has no project and is office-wide;
  -- photos are Documents (BautagebuchEintrag has no photo field).
  select case p_art
    when 'BauherrProjekt'     then array['Project']
    when 'BauherrTermin'      then array['ScheduleTask', 'Termin']
    when 'BauherrPlan'        then array['Plan']
    when 'BauherrModell'      then array['BimModel', 'BIMModel']
    when 'BauherrKosten'      then array['Project', 'KostenStand']
    when 'BauherrDokument'    then array['Document']
    when 'BauherrBemusterung' then array['Bemusterung', 'Sonderwunsch']
    when 'BauherrFoto'        then array['Document']
    when 'BauherrRechnung'    then array['Ausgangsrechnung']
    when 'BauherrBeteiligter' then array['Project']
    else array[]::text[]
  end
$$;
revoke all on function public.bauherr_quellen(text) from public;
grant execute on function public.bauherr_quellen(text) to authenticated, service_role;

-- 6. Release, withdraw, answer (owner/planner). -------------------------------------
-- p_quelle: records.id of the source row; p_projekt: the project it is released
-- for (must equal the source's project, a Project row is its own project);
-- p_inhalt: the client-built projection; p_datei: optional file name of a view
-- or PDF uploaded beforehand to freigaben/<org>/<projekt>/_bauherr/<datei>.
-- Same (art, quelle) again → update in place (projection id stays).
create function public.bauherr_freigeben(p_art text, p_quelle text, p_inhalt jsonb, p_datei text default null)
  returns text
language plpgsql security definer set search_path = public as $$
declare
  v_q public.records%rowtype;
  v_projekt text;
  v_inhalt jsonb;
  v_id text;
begin
  select * into v_q from public.records where id = p_quelle;
  if not found or coalesce(public.rolle_in(v_q.org_id), '') not in ('owner', 'planner')
     or not (v_q.entity = any (public.bauherr_quellen(p_art)))
     or length(coalesce(p_inhalt::text, '')) > 65536 then
    perform public.vorgang_abweisen();
  end if;
  v_projekt := case when v_q.entity = 'Project' then v_q.id
                    else coalesce(v_q.projekt_id, nullif(v_q.data->>'project_id', '')) end;
  if v_projekt is null then
    perform public.vorgang_abweisen();
  end if;
  -- Sources that are never client material, whatever the client mapping says:
  -- an office/HR/bookkeeping/correspondence document (Document.bereich, 81) and
  -- an invoice that has not been issued (draft, planned, cancelled); a plan
  -- that is not released internally, unless it goes out to ASK the client for
  -- approval (D-BH-05: entscheidung_offen = true in the projection).
  if (v_q.entity = 'Document' and coalesce(nullif(v_q.data->>'bereich', ''), 'projekt') <> 'projekt')
     or (v_q.entity = 'Ausgangsrechnung' and coalesce(v_q.data->>'status', '') <> 'gestellt')
     or (v_q.entity = 'Plan' and coalesce(v_q.data->>'status', '') <> 'freigegeben'
         and (p_inhalt->'entscheidung_offen') is distinct from 'true'::jsonb) then
    perform public.vorgang_abweisen();
  end if;
  if p_datei is not null and (coalesce(trim(p_datei), '') = '' or p_datei ~ '[/\\]' or p_datei like '.%'
                              or length(p_datei) > 200 or p_datei ~* '\.ifc(zip)?$') then
    perform public.vorgang_abweisen();
  end if;

  v_inhalt := public.bauherr_bereinigen(p_art, p_inhalt)
              || jsonb_build_object('project_id', v_projekt);
  if p_datei is not null then
    v_inhalt := v_inhalt || jsonb_build_object('datei', p_datei);
  else
    v_inhalt := v_inhalt - 'datei';
  end if;

  perform set_config('bit.steuerung', 'an', true);
  update public.records
     set data = v_inhalt || jsonb_build_object('quelle_id', p_quelle, 'freigegeben', true), sicht = 'freigegeben'
   where org_id = v_q.org_id and entity = p_art and projekt_id = v_projekt
     and data->>'quelle_id' = p_quelle
  returning id into v_id;
  if v_id is null then
    v_id := gen_random_uuid()::text;
    insert into public.records (id, entity, org_id, data, created_by, sicht, projekt_id)
    values (v_id, p_art, v_q.org_id, v_inhalt || jsonb_build_object('quelle_id', p_quelle, 'freigegeben', true),
            auth.uid(), 'freigegeben', v_projekt);
  end if;
  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_q.org_id, v_projekt, 'freigabe_erteilt', p_art, v_id,
    jsonb_build_object('quelle', p_quelle, 'datei', p_datei is not null));
  return v_id;
end;
$$;
revoke all on function public.bauherr_freigeben(text, text, jsonb, text) from public;
grant execute on function public.bauherr_freigeben(text, text, jsonb, text) to authenticated;

-- `freigegeben` (true here, false after bauherr_zuruecknehmen) mirrors the
-- column `sicht` inside data, because the client adapter reads data only
-- (supabaseDb.js SPALTEN) — the office page needs it to tell a withdrawn
-- release from a live one. A client only ever sees rows where it is true.
-- `quelle_id` is written by the RPC only and is NOT on the whitelist of the
-- client mapping: it is the one internal id a client sees per projection, the
-- same trade-off 0012 made with tender_id/lv_id (an id without the row is no
-- content).

-- Withdraw: back to `intern`, kept (log and a later re-release stay traceable).
create function public.bauherr_zuruecknehmen(p_projektion text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_r public.records%rowtype;
begin
  select * into v_r from public.records where id = p_projektion;
  if not found or coalesce(public.rolle_in(v_r.org_id), '') not in ('owner', 'planner')
     or coalesce(public.entity_zielrolle(v_r.entity), '') <> 'bauherr'
     or public.entity_extern_schreibbar(v_r.entity) then
    perform public.vorgang_abweisen();
  end if;
  perform set_config('bit.steuerung', 'an', true);
  update public.records set sicht = 'intern', data = data || '{"freigegeben": false}'::jsonb where id = p_projektion;
  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_r.org_id, v_r.projekt_id, 'freigabe_zurueckgenommen', v_r.entity, p_projektion,
                                     '{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.bauherr_zuruecknehmen(text) from public;
grant execute on function public.bauherr_zuruecknehmen(text) to authenticated;

-- The office answers a client's question as its own projection. The question
-- text is the client's own (same project, same audience) — unlike 0012, where
-- the office rewords a bidder's question because other bidders read it.
create function public.bauherr_antworten(p_rueckmeldung text, p_antwort text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_r public.records%rowtype;
  v_id text := gen_random_uuid()::text;
begin
  select * into v_r from public.records where id = p_rueckmeldung and entity = 'BauherrRueckmeldung';
  if not found or coalesce(public.rolle_in(v_r.org_id), '') not in ('owner', 'planner')
     or v_r.projekt_id is null or coalesce(trim(p_antwort), '') = '' or length(p_antwort) > 8000 then
    perform public.vorgang_abweisen();
  end if;
  perform set_config('bit.steuerung', 'an', true);
  insert into public.records (id, entity, org_id, data, created_by, sicht, projekt_id)
  values (v_id, 'BauherrAntwort', v_r.org_id,
          jsonb_build_object('project_id', v_r.projekt_id, 'bezug_id', v_r.id,
                             'frage', coalesce(v_r.data->>'text', ''), 'antwort', p_antwort),
          auth.uid(), 'freigegeben', v_r.projekt_id);
  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_r.org_id, v_r.projekt_id, 'freigabe_erteilt', 'BauherrAntwort', v_id,
                                     jsonb_build_object('bezug', v_r.id));
  return v_id;
end;
$$;
revoke all on function public.bauherr_antworten(text, text) from public;
grant execute on function public.bauherr_antworten(text, text) to authenticated;

-- 7. Client writes: whitelist, reference check, server time. ------------------------
-- Runs after records_anker (name order), so projekt_id/eigner are already the
-- server's values. Only for EXTERNAL writers of client kinds; the office path
-- (owner/planner may write these kinds too, e.g. a decision taken by phone)
-- and the definer functions pass unchanged.
create function public.records_bauherr() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ref public.records%rowtype;
  v_art text;
begin
  if public.ist_dienst() or coalesce(current_setting('bit.steuerung', true), '') = 'an'
     or not public.ist_extern(new.org_id)
     or coalesce(public.entity_zielrolle(new.entity), '') <> 'bauherr' then
    return new;
  end if;

  new.data := public.bauherr_bereinigen(new.entity, new.data)
              || jsonb_build_object('project_id', new.projekt_id, 'zeitpunkt', now());
  if length(coalesce(new.data->>'text', '')) > 4000 then
    raise exception 'Text zu lang (höchstens 4000 Zeichen)' using errcode = '22001';
  end if;

  if new.entity = 'BauherrRueckmeldung' then
    v_art := coalesce(new.data->>'art', '');
    if v_art not in ('freigabe', 'ablehnung', 'auswahl', 'frage', 'kommentar') then
      raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
    end if;
    if new.data ? 'bezug_id' and nullif(new.data->>'bezug_id', '') is not null then
      -- The reference must be a projection THIS client can see on THIS project.
      select * into v_ref from public.records r
       where r.id = new.data->>'bezug_id' and r.org_id = new.org_id
         and r.projekt_id = new.projekt_id and r.sicht = 'freigegeben'
         and coalesce(public.entity_zielrolle(r.entity), '') = 'bauherr'
         and not public.entity_extern_schreibbar(r.entity);
      if not found then
        raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
      end if;
      new.data := new.data || jsonb_build_object('bezug_entity', v_ref.entity);
    else
      new.data := (new.data - 'bezug_id') - 'bezug_entity';
    end if;
    -- A decision needs a projection that asks for one.
    if v_art in ('freigabe', 'ablehnung', 'auswahl')
       and (v_ref.id is null or coalesce((v_ref.data->>'entscheidung_offen')::boolean, false) is not true) then
      raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
    end if;
    -- A choice names one of the offered options.
    if v_art = 'auswahl' and not exists (
         -- explicit column alias: jsonb_array_elements has the OUT parameter
         -- `value`, so a bare table alias would name the whole row.
         select 1 from jsonb_array_elements(coalesce(v_ref.data->'optionen', '[]'::jsonb)) as o(el)
          where jsonb_typeof(o.el) = 'object' and o.el->>'schluessel' = new.data->>'option') then
      raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
    end if;
    if v_art <> 'auswahl' then
      new.data := new.data - 'option';
    end if;
  elsif new.entity = 'BauherrUpload' then
    if coalesce(new.data->>'datei', '') = '' or new.data->>'datei' ~ '[/\\]' or new.data->>'datei' like '.%'
       or length(new.data->>'datei') > 200 then
      raise exception 'Vorgang nicht zulässig oder nicht gefunden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.records_bauherr() from public;

create trigger records_bauherr
  before insert on public.records
  for each row execute function public.records_bauherr();

-- 8. "Why do I see this?" with the audience clause. --------------------------------
create or replace function public.warum_sichtbar(p_id text) returns text
language plpgsql security definer stable set search_path = public as $$
declare
  r public.records%rowtype;
  v_rolle text;
begin
  select * into r from public.records where id = p_id;
  if not found or not public.ist_mitglied(r.org_id) then
    return 'nicht sichtbar: kein Datensatz in einem Ihrer Büros';
  end if;
  v_rolle := public.rolle_in(r.org_id);
  if public.ist_intern(r.org_id) then
    if public.entity_bereich(r.entity) = 'gebot' and r.siegel_id is not null
       and r.eigner is distinct from auth.uid() and not public.submission_offen(r.org_id, r.vergabe_id) then
      return format('nicht sichtbar: Siegel %s, Submission noch nicht geöffnet', r.vergabe_id);
    end if;
    return format('intern, Rolle %s', v_rolle);
  end if;
  if r.eigner = auth.uid() then
    return 'eigene Zeile';
  end if;
  if r.sicht = 'freigegeben' and public.entity_extern(r.entity) and r.projekt_id is not null
     and public.darf_projekt(r.org_id, r.projekt_id)
     and (r.vergabe_id is null or public.darf_vergabe(r.org_id, r.vergabe_id))
     and public.ist_zielgruppe(r.org_id, r.projekt_id, r.entity) then
    return format('Projektion, Projekt %s%s', r.projekt_id,
                  case when r.vergabe_id is not null then ', Vergabe ' || r.vergabe_id else '' end);
  end if;
  return format('nicht sichtbar: Rolle %s, weder eigene Zeile noch Freigabe für Ihr Projekt/Ihre Vergabe', v_rolle);
end;
$$;
revoke all on function public.warum_sichtbar(text) from public;
grant execute on function public.warum_sichtbar(text) to authenticated;

-- 9. Storage: bucket `bauherr` for the client's own uploads. ------------------------
-- Path <org_id>/<projekt_id>/<user_id>/<file>. Write: only into one's OWN
-- folder, only as client of that project; no overwrite, no delete (immutable,
-- like the rows). Read: the author, or internal roles. Released PDFs and views
-- of the office go to freigaben/<org>/<projekt>/_bauherr/<file> (0013 rules:
-- office writes, externals download through the edge function `freigabe`).
insert into storage.buckets (id, name, public) values ('bauherr', 'bauherr', false)
on conflict (id) do nothing;

create policy bauherr_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bauherr'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[3] = auth.uid()::text
    and coalesce(public.projekt_rolle(public.als_uuid((storage.foldername(name))[1]), (storage.foldername(name))[2]), '') = 'bauherr'
  );

create policy bauherr_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bauherr'
    and array_length(storage.foldername(name), 1) = 3
    and ( (storage.foldername(name))[3] = auth.uid()::text
          or public.ist_intern(public.als_uuid((storage.foldername(name))[1])) )
  );

create policy bauherr_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bauherr'
    and coalesce(public.rolle_in(public.als_uuid((storage.foldername(name))[1])), '') in ('owner', 'planner')
  );

-- 10. Grant rule of 0014 for the new client functions is above (each create is
-- followed by its revoke/grant). scripts/grants-pruefen.mjs SOLL is extended in
-- the same commit.
