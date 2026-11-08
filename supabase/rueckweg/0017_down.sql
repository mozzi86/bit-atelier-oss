-- 0017_down.sql — rollback of 0017_einladungscodes.sql (Phase 110-06).
-- Removes the codes and their functions. Memberships and project access that
-- were created by redeeming a code stay (they are ordinary rows of 0006/0007;
-- revoke them per person through the edge function `einladung` or by hand).

begin;

drop function if exists public.einladungscode_widerrufen(uuid);
drop function if exists public.einladungscode_einloesen(text);
drop function if exists public.einladungscode_erstellen(text, text, integer, integer);
drop function if exists public.einladungscode_hash(text);
drop table if exists public.einladungscode;

commit;
