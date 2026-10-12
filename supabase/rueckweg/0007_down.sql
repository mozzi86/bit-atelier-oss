-- 0007_down.sql — rollback of 0007_zugang_katalog.sql (Phase 74-01).
-- Requires: 0011_down … 0008_down have run (the 0011 policies and the 0008
-- trigger call the functions dropped here).
--
-- Drops project access and tender participation: invitations of external
-- persons are gone afterwards (their memberships go with 0006_down.sql).

begin;

drop function if exists public.entity_modell(text);
drop function if exists public.entity_extern(text);
drop function if exists public.entity_bereich(text);
drop function if exists public.darf_vergabe(uuid, text);
drop function if exists public.darf_projekt(uuid, text);

drop table if exists public.entity_regeln;
drop table if exists public.vergabe_teilnehmer;
drop table if exists public.projekt_zugang;

commit;
