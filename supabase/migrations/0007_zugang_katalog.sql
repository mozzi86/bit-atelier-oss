-- 0007_zugang_katalog.sql — Phase 74-01 Task 2: project access, tender
-- participation, entity catalogue. Additive; nothing changes behaviour yet.
--
-- STATUS 12.10.2026: NOT run against Postgres (see 0006 header).
--
-- Every new table gets the triad of 0004: enable RLS + revoke all from anon,
-- authenticated + targeted grant. Without the revoke the default privileges
-- of 0005_grants.sql:28-29 would hand authenticated full DML on the table.
--
-- "Im Zweifel zu" — how it is meant, word for word:
--   `gesperrt` means: never visible to external roles and never writable by
--   them; internally the row stays visible. A new domain phase therefore
--   loses nothing and gives nothing away. An entity WITHOUT a catalogue row is
--   `gesperrt` (entity_bereich below), so no migration is needed for a new
--   entity type to be safe.

-- 1. Project access: the second axis. ---------------------------------------
create table public.projekt_zugang (
  org_id       uuid not null references public.orgs on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  projekt_id   text not null,
  rolle        text not null check (rolle in ('bidder', 'investor', 'gast')),
  gueltig_bis  timestamptz,
  angelegt_am  timestamptz not null default now(),
  angelegt_von uuid references auth.users on delete set null,
  primary key (org_id, user_id, projekt_id)
);

-- 2. Tender participation: the third axis. Project access alone would show a
-- shell-construction bidder the quantities of every trade of the project.
create table public.vergabe_teilnehmer (
  org_id        uuid not null references public.orgs on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  vergabe_id    text not null,
  projekt_id    text not null,
  kontakt_id    text,
  eingeladen_am timestamptz not null default now(),
  primary key (org_id, user_id, vergabe_id)
);

-- 3. Entity catalogue. records.entity is free text and the stock already holds
-- `BimModel` AND `BIMModel`; a permission gate on string literals is bypassed
-- with one trailing space. The category decides, not the literal.
create table public.entity_regeln (
  entity          text primary key,
  bereich         text not null check (bereich in ('buero', 'projekt', 'gebot', 'gesperrt')),
  extern_sichtbar boolean not null default false,
  -- Model entities need can_edit_model to be written (0011). A column of its
  -- own instead of a fifth `bereich`, because a model is also `projekt`.
  modell          boolean not null default false,
  notiz           text
);

-- Seed from the entity list of 74-01-PLAN Task 2 [ASSUMED]. The plan wants it
-- from the MEASURED cloud stock (scripts/supabase-bestand.mjs, Task 0), which
-- has not run; compare before rollout and add what is missing — a missing
-- entity is `gesperrt`, which is the safe direction of the error.
insert into public.entity_regeln (entity, bereich, extern_sichtbar, modell, notiz) values
  -- office-wide: never project-bound, never external
  ('Contact',              'buero',   false, false, 'Adressbuch — enthält Mitbewerber'),
  ('Setting',              'buero',   false, false, null),
  ('PriceReference',       'buero',   false, false, 'Kostenansätze des Büros'),
  ('ReferenzpreisPool',    'buero',   false, false, null),
  ('AvaFilter',            'buero',   false, false, null),
  ('ParitaetsLauf',        'buero',   false, false, null),
  ('LandListing',          'buero',   false, false, null),
  ('Din276Katalog',        'buero',   false, false, 'Katalog'),
  ('KgRegel',              'buero',   false, false, 'Katalog'),
  ('MengenMuster',         'buero',   false, false, 'Katalog'),
  ('AusschlussGrund',      'buero',   false, false, 'Katalog'),
  ('MengenbasisKatalog',   'buero',   false, false, 'Katalog'),
  ('EinheitenKatalog',     'buero',   false, false, 'Katalog'),
  ('StatusKonvention',     'buero',   false, false, 'Katalog'),
  ('BaustoffKonvention',   'buero',   false, false, 'Katalog'),
  ('Preisindexreihe',      'buero',   false, false, 'Katalog'),
  ('PreisRangfolge',       'buero',   false, false, 'Katalog'),
  ('AmpelSchwelle',        'buero',   false, false, 'Katalog'),
  ('StlbKatalog',          'buero',   false, false, 'Katalog'),
  ('PreisUebernahmeRegel', 'buero',   false, false, 'Katalog'),
  -- project-bound originals: internal only; externals see projections
  ('Project',              'projekt', false, false, null),
  ('Tender',               'projekt', false, false, 'Original — extern nur TenderFreigabe'),
  ('LVPosition',           'projekt', false, false, 'Original mit unit_price — extern nur MengenFreigabe'),
  ('BimModel',             'projekt', false, true,  null),
  ('BIMModel',             'projekt', false, true,  'zweite Schreibweise im Bestand'),
  ('BimSnapshot',          'projekt', false, true,  null),
  ('ModelVersion',         'projekt', false, true,  null),
  ('Document',             'projekt', false, false, null),
  ('Issue',                'projekt', false, false, null),
  ('ChangeOrder',          'projekt', false, false, '4 Altzeilen ohne project_id bleiben büroweit sichtbar'),
  ('Measurement',          'projekt', false, false, null),
  ('Comment',              'projekt', false, false, null),
  ('SpaceProgram',         'projekt', false, false, null),
  ('Building',             'projekt', false, false, null),
  ('SiteUnit',             'projekt', false, false, null),
  ('ScheduleTask',         'projekt', false, false, null),
  ('EnergyScenario',       'projekt', false, false, null),
  ('AuditLog',             'projekt', false, false, 'Simulationsprotokoll, KEIN Nachweis (G-10)'),
  -- bids: sealed when written by an external role (0008/0009)
  ('Bid',                  'gebot',   false, false, null),
  ('InvestmentBid',        'gebot',   false, false, null),
  ('ProjectContract',      'gebot',   false, false, null),
  -- projections and the external question: the only externally visible kinds
  ('TenderFreigabe',       'projekt', true,  false, 'Projektion, Feld-Whitelist in 0012'),
  ('MengenFreigabe',       'projekt', true,  false, 'Projektion ohne unit_price'),
  ('ModellFreigabe',       'projekt', true,  false, 'Metadaten + Ansichtsdatei, nie das IFC-Original'),
  ('BcfRueckfrage',        'projekt', true,  false, 'vom Bieter schreibbar, Antwort als eigene Projektion');

-- 4. RLS + grants (the triad). ------------------------------------------------
alter table public.projekt_zugang     enable row level security;
alter table public.vergabe_teilnehmer enable row level security;
alter table public.entity_regeln      enable row level security;

revoke all on public.projekt_zugang, public.vergabe_teilnehmer, public.entity_regeln
  from anon, authenticated;
grant select on public.projekt_zugang, public.vergabe_teilnehmer, public.entity_regeln
  to authenticated;
grant all privileges on public.projekt_zugang, public.vergabe_teilnehmer, public.entity_regeln
  to service_role;

-- Everyone sees their OWN access rows, internal roles those of their org. No
-- DML policy: invitations run through the edge function `einladung` (service role).
create policy projekt_zugang_select on public.projekt_zugang
  for select to authenticated
  using (user_id = auth.uid() or public.ist_intern(org_id));

create policy vergabe_teilnehmer_select on public.vergabe_teilnehmer
  for select to authenticated
  using (user_id = auth.uid() or public.ist_intern(org_id));

-- The catalogue is no secret; entity_bereich() below reads it as invoker.
create policy entity_regeln_select on public.entity_regeln
  for select to authenticated
  using (true);

-- 5. Functions. ---------------------------------------------------------------
-- Has the caller access to this project of this org (and is it still valid)?
create function public.darf_projekt(p_org uuid, p_projekt text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select true from public.projekt_zugang
      where org_id = p_org and user_id = auth.uid() and projekt_id = p_projekt
        and (gueltig_bis is null or gueltig_bis > now())
      limit 1),
    false)
$$;
revoke all on function public.darf_projekt(uuid, text) from public;
grant execute on function public.darf_projekt(uuid, text) to authenticated, service_role;

-- Is the caller a participant of this tender of this org?
create function public.darf_vergabe(p_org uuid, p_vergabe text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select true from public.vergabe_teilnehmer
      where org_id = p_org and user_id = auth.uid() and vergabe_id = p_vergabe
      limit 1),
    false)
$$;
revoke all on function public.darf_vergabe(uuid, text) from public;
grant execute on function public.darf_vergabe(uuid, text) to authenticated, service_role;

-- Category of an entity; 'gesperrt' when the catalogue does not know it.
-- Deliberately NOT security definer: the table is readable by authenticated
-- anyway, and an invoker SQL function can be inlined by the planner instead
-- of being called once per row.
create function public.entity_bereich(p_entity text) returns text
language sql stable set search_path = public as $$
  select coalesce((select bereich from public.entity_regeln where entity = p_entity), 'gesperrt')
$$;
revoke all on function public.entity_bereich(text) from public;
grant execute on function public.entity_bereich(text) to authenticated, service_role;

create function public.entity_extern(p_entity text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select extern_sichtbar from public.entity_regeln where entity = p_entity), false)
$$;
revoke all on function public.entity_extern(text) from public;
grant execute on function public.entity_extern(text) to authenticated, service_role;

create function public.entity_modell(p_entity text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select modell from public.entity_regeln where entity = p_entity), false)
$$;
revoke all on function public.entity_modell(text) from public;
grant execute on function public.entity_modell(text) to authenticated, service_role;
