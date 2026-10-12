-- 0012_down.sql — rollback of 0012_freigabe_projektion.sql (Phase 74-01).
-- Requires: 0014_down.sql and 0013_down.sql have run.
--
-- Drops the release functions. Existing projection rows (TenderFreigabe,
-- MengenFreigabe, ModellFreigabe, RueckfrageAntwort) stay in records: they
-- hold only whitelisted fields, and after 0011_down.sql they are ordinary
-- office rows. Delete them by hand if they should not stay.

begin;

drop function if exists public.rueckfrage_beantworten(text, text, text);
drop function if exists public.freigabe_zuruecknehmen(text);
drop function if exists public.freigabe_erteilen(text, text, text);
delete from public.entity_regeln where entity = 'RueckfrageAntwort';

commit;
