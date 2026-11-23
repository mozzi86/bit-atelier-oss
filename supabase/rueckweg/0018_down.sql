-- 0018_down.sql — rollback of 0018_bauherr_moeblierung.sql (W-1118-22).
-- Puts the three functions back to their 0016 bodies and removes the kind
-- BauherrMoeblierung from the catalogue. Released furnishings and proposals
-- already stored stay as rows (records); without the catalogue row no client
-- reads them any more.

begin;

create or replace function public.bauherr_felder(p_art text) returns text[]
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

create or replace function public.bauherr_quellen(p_art text) returns text[]
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

create or replace function public.records_bauherr() returns trigger
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

delete from public.entity_regeln where entity = 'BauherrMoeblierung';

commit;
