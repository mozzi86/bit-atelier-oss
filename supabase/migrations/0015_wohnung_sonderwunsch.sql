-- 0015_wohnung_sonderwunsch.sql — Phase 99 (99-01…03): entity catalogue rows for the
-- buyer process of a developer: stored apartments, the project's equipment catalogue and
-- the special requests per apartment.
--
-- STATUS 21.10.2026: written and reviewed by reading only — NOT run against Postgres
-- (same as 0006…0014: no local database on the build machine).
--
-- Additive: three rows in public.entity_regeln, nothing else. No table, no function, no
-- policy. Behaviour does not change: without these rows the three entities are `gesperrt`
-- (0007: entity_bereich), and the policies of 0011 treat `gesperrt` and `projekt` alike
-- for internal roles (visible, writable by owner/planner) and hide both from external
-- roles while extern_sichtbar is false. The rows make the classification explicit — they
-- are project originals like Document or ScheduleTask — so the catalogue matches the
-- stock (scripts/supabase-bestand.mjs) and the buyer portal has to add a projection on
-- purpose instead of finding the entities unlisted.
--
-- extern_sichtbar = false for all three: the buyer portal (99-07, role `kaeufer` still
-- missing in 0006) will read PROJECTIONS of its own apartment, like TenderFreigabe for
-- bidders (0012) — never the originals, which carry the buyer's name, prices of other
-- apartments and the internal approval notes.

insert into public.entity_regeln (entity, bereich, extern_sichtbar, modell, notiz) values
  ('Wohneinheit',        'projekt', false, false, 'Wohnung mit stabiler Nummer, Käufer — extern erst als Projektion (99-07)'),
  ('AusstattungsOption', 'projekt', false, false, 'Ausstattungskatalog je Projekt mit Katalogpreis (D-P99-04)'),
  ('Sonderwunsch',       'projekt', false, false, 'Sonderwunsch je Wohnung, Freigabekette nach Schwere (D-P99-01)')
on conflict (entity) do nothing;
