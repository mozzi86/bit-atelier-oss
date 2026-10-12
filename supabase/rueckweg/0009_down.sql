-- 0009_down.sql — rollback of 0009_submission.sql (Phase 74-01).
-- Requires: 0011_down.sql and 0010_down.sql have run.
--
-- Sealed bids (siegel_id set) stay in records; after 0008_down.sql the column
-- is gone and they become ordinary office-visible rows again — which is the
-- state before 74-01. If bids were sealed and the opening has not happened,
-- running this rollback opens them for the office: decide consciously.

begin;

drop function if exists public.zuschlag_erteilen(text, text);
drop function if exists public.gebot_zuruecknehmen(text);
drop function if exists public.submission_oeffnen(text);
drop function if exists public.submission_frist(text, timestamptz, text);
drop function if exists public.submission_anlegen(text, timestamptz);
drop index if exists public.gebot_je_bieter;
drop function if exists public.tender_hat_submission(uuid, text);
drop function if exists public.submission_offen(uuid, text);
drop function if exists public.submission_laeuft(uuid, text);
drop function if exists public.inhalt_hash(jsonb);
drop function if exists public.vorgang_abweisen();
drop table if exists public.submission;

commit;
