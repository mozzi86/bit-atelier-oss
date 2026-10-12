-- 0012_freigabe_projektion.sql — Phase 74-01 Task 7: release as a PROJECTION,
-- never as the original row.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- Why projections: RLS filters ROWS, not jsonb keys. Releasing the original
-- Tender would hand every bidder `invited_contact_ids` (the list of
-- competitors) and `awarded_bid_id`; releasing an LVPosition would hand out
-- `unit_price` — the client's own cost estimate. Neither grants nor RLS can
-- mask a key inside `data`. So the office's originals stay internal, and a
-- release WRITES NEW ROWS that carry only whitelisted fields, with their own
-- uuid ids (no `<id>-frg` suffix: it would reveal internal ids and could be
-- squatted in advance).
--
-- The whitelists (one per projected kind — there is no generic masker, G-4;
-- a forgotten projection is a release that never happens, which is the safe
-- direction of the error):
--   TenderFreigabe    tender_id, project_id, name, trade, frist
--                     (project_id is required: a bidder's question is only
--                      accepted for a project he has access to, 0011)
--   MengenFreigabe    tender_id, project_id, lv_id, oz, kurztext, quantity, unit
--                     NOT unit_price, NOT long_text, NOT bim_element_ids
--   ModellFreigabe    tender_id, project_id, modell_id, name, datei
--                     (metadata + the file name of a reduced VIEW in bucket
--                      `freigaben`, never the model payload or the IFC original)
--   RueckfrageAntwort tender_id, project_id, frage, antwort
--                     (the office's answer as its OWN row, with a question
--                      text the office words itself — the bidder's original
--                      is never switched to `freigegeben`, otherwise every
--                      bidder of the project reads competitors' questions)

-- The answer kind joins the catalogue as externally visible.
insert into public.entity_regeln (entity, bereich, extern_sichtbar, modell, notiz) values
  ('RueckfrageAntwort', 'projekt', true, false, 'Antwort des Büros als eigene Projektion (0012)')
on conflict (entity) do nothing;

-- Release: owner/planner of the tender's org; a submission must exist (else
-- the order release → deadline could be turned around). Cleans up the old
-- projections of this tender first, so a position removed from position_ids
-- does not stay visible as an orphan (A-24).
-- p_modell / p_ansicht: optional — a BimModel id of the same project and the
-- file name of its reduced view under freigaben/<org>/<projekt>/<tender>/.
create function public.freigabe_erteilen(p_tender text, p_modell text default null, p_ansicht text default null)
  returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t public.records%rowtype;
  v_projekt text;
  v_frist timestamptz;
  v_mengen integer := 0;
  v_modell public.records%rowtype;
begin
  select * into v_t from public.records where id = p_tender and entity = 'Tender';
  if not found or coalesce(public.rolle_in(v_t.org_id), '') not in ('owner', 'planner')
     or not public.tender_hat_submission(v_t.org_id, p_tender) then
    perform public.vorgang_abweisen();
  end if;
  v_projekt := coalesce(v_t.projekt_id, nullif(v_t.data->>'project_id', ''));
  if v_projekt is null then
    perform public.vorgang_abweisen();
  end if;
  select frist into v_frist from public.submission where org_id = v_t.org_id and tender_id = p_tender;

  perform set_config('bit.steuerung', 'an', true);

  delete from public.records
   where org_id = v_t.org_id and vergabe_id = p_tender
     and entity in ('TenderFreigabe', 'MengenFreigabe', 'ModellFreigabe');

  insert into public.records (id, entity, org_id, data, created_by, sicht, projekt_id, vergabe_id)
  values (gen_random_uuid()::text, 'TenderFreigabe', v_t.org_id,
          jsonb_build_object('tender_id', p_tender, 'project_id', v_projekt,
                             'name', v_t.data->'name', 'trade', v_t.data->'trade', 'frist', v_frist),
          auth.uid(), 'freigegeben', v_projekt, p_tender);

  insert into public.records (id, entity, org_id, data, created_by, sicht, projekt_id, vergabe_id)
  select gen_random_uuid()::text, 'MengenFreigabe', v_t.org_id,
         jsonb_build_object('tender_id', p_tender, 'project_id', v_projekt, 'lv_id', p.id,
                            'oz', p.data->'oz', 'kurztext', p.data->'short_text',
                            'quantity', p.data->'quantity', 'unit', p.data->'unit'),
         auth.uid(), 'freigegeben', v_projekt, p_tender
    from public.records p
   where p.org_id = v_t.org_id and p.entity = 'LVPosition'
     and jsonb_typeof(v_t.data->'position_ids') = 'array'
     and p.id in (select jsonb_array_elements_text(v_t.data->'position_ids'));
  get diagnostics v_mengen = row_count;

  if p_modell is not null then
    select * into v_modell from public.records
     where id = p_modell and org_id = v_t.org_id and public.entity_modell(entity)
       and coalesce(projekt_id, data->>'project_id') = v_projekt;
    if not found or coalesce(trim(p_ansicht), '') = '' or p_ansicht ~ '[/\\]' then
      perform set_config('bit.steuerung', '', true);
      perform public.vorgang_abweisen();
    end if;
    insert into public.records (id, entity, org_id, data, created_by, sicht, projekt_id, vergabe_id)
    values (gen_random_uuid()::text, 'ModellFreigabe', v_t.org_id,
            jsonb_build_object('tender_id', p_tender, 'project_id', v_projekt, 'modell_id', v_modell.id,
                               'name', v_modell.data->'name', 'datei', p_ansicht),
            auth.uid(), 'freigegeben', v_projekt, p_tender);
  end if;

  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_t.org_id, v_projekt, 'freigabe_erteilt', 'Tender', p_tender,
    jsonb_build_object('mengen', v_mengen, 'modell', p_modell is not null));
  return jsonb_build_object('mengen', v_mengen, 'modell', p_modell is not null);
end;
$$;
revoke all on function public.freigabe_erteilen(text, text, text) from public;
grant execute on function public.freigabe_erteilen(text, text, text) to authenticated;

-- Withdraw a release: projections of the tender go back to `intern` (kept,
-- so the log and a later re-release stay traceable).
create function public.freigabe_zuruecknehmen(p_tender text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_projekt text;
  v_n integer;
begin
  select org_id, coalesce(projekt_id, nullif(data->>'project_id', '')) into v_org, v_projekt
    from public.records where id = p_tender and entity = 'Tender';
  if v_org is null or coalesce(public.rolle_in(v_org), '') not in ('owner', 'planner') then
    perform public.vorgang_abweisen();
  end if;
  perform set_config('bit.steuerung', 'an', true);
  update public.records set sicht = 'intern'
   where org_id = v_org and vergabe_id = p_tender
     and entity in ('TenderFreigabe', 'MengenFreigabe', 'ModellFreigabe', 'RueckfrageAntwort');
  get diagnostics v_n = row_count;
  perform set_config('bit.steuerung', '', true);
  perform public.protokoll_schreiben(v_org, v_projekt, 'freigabe_zurueckgenommen', 'Tender', p_tender,
                                     jsonb_build_object('zeilen', v_n));
  return v_n;
end;
$$;
revoke all on function public.freigabe_zuruecknehmen(text) from public;
grant execute on function public.freigabe_zuruecknehmen(text) to authenticated;

-- Answer a question for every participant of the tender. The office words
-- the question itself (p_frage) — the bidder's text may name the bidder.
create function public.rueckfrage_beantworten(p_tender text, p_frage text, p_antwort text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_projekt text;
  v_id text := gen_random_uuid()::text;
begin
  select org_id, coalesce(projekt_id, nullif(data->>'project_id', '')) into v_org, v_projekt
    from public.records where id = p_tender and entity = 'Tender';
  if v_org is null or v_projekt is null
     or coalesce(public.rolle_in(v_org), '') not in ('owner', 'planner')
     or coalesce(trim(p_antwort), '') = '' then
    perform public.vorgang_abweisen();
  end if;
  perform set_config('bit.steuerung', 'an', true);
  insert into public.records (id, entity, org_id, data, created_by, sicht, projekt_id, vergabe_id)
  values (v_id, 'RueckfrageAntwort', v_org,
          jsonb_build_object('tender_id', p_tender, 'project_id', v_projekt,
                             'frage', coalesce(p_frage, ''), 'antwort', p_antwort),
          auth.uid(), 'freigegeben', v_projekt, p_tender);
  perform set_config('bit.steuerung', '', true);
  return v_id;
end;
$$;
revoke all on function public.rueckfrage_beantworten(text, text, text) from public;
grant execute on function public.rueckfrage_beantworten(text, text, text) to authenticated;
