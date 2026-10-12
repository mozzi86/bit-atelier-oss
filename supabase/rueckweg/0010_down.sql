-- 0010_down.sql — rollback of 0010_protokoll.sql (Phase 74-01).
-- Requires: 0011_down.sql has run.
--
-- WARNING: this drops the access log including its hash chain. Export it first
-- (select * from public.zugriffsprotokoll order by id) — a dropped log is the
-- one thing the rollback cannot give back. The 0009 RPCs fail afterwards
-- (they call protokoll_schreiben); run 0009_down.sql next.

begin;

drop trigger if exists org_members_protokollieren on public.org_members;
drop function if exists public.org_members_protokollieren();
drop trigger if exists records_protokollieren on public.records;
drop function if exists public.records_protokollieren();

drop view if exists public.zugriffsprotokoll_sicht;
drop function if exists public.protokoll_kette_pruefen(uuid);
drop function if exists public.protokoll_schreiben(uuid, text, text, text, text, jsonb, uuid);
drop function if exists public.protokoll_hash(text, timestamptz, bigint, uuid, text, uuid, text, text, text, jsonb);

-- The immutability triggers would refuse DROP TABLE? No — DROP is not
-- UPDATE/DELETE/TRUNCATE. They go with the table.
drop table if exists public.zugriffsprotokoll;
drop function if exists public.protokoll_unveraenderlich();

commit;
