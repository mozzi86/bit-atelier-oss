-- 0015_down.sql — rollback of 0015_wohnung_sonderwunsch.sql (Phase 99).
--
-- Removes the three catalogue rows; the entities fall back to `gesperrt` (0007), which for
-- internal roles behaves the same (0011). Existing Wohneinheit / AusstattungsOption /
-- Sonderwunsch rows in records stay untouched — they are user data.

begin;

delete from public.entity_regeln where entity in ('Wohneinheit', 'AusstattungsOption', 'Sonderwunsch');

commit;
