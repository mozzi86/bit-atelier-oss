-- 0014_down.sql — rollback of 0014_grants_zugriff.sql (Phase 74-01).
-- Requires: nothing (first step of the way back; run before 0013_down.sql).
--
-- Restores the default privileges of 0005 and drops grants_bericht().
-- Deliberately NOT restored: EXECUTE for PUBLIC on every function. Every
-- function of 0006-0013 revokes PUBLIC itself; giving it back wholesale would
-- reopen protokoll_schreiben and friends — worse than the state before 0014.

begin;

drop function if exists public.grants_bericht();

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to public;

commit;
