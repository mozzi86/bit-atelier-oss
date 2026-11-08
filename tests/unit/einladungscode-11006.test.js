// 110-06: invitation by link — migration 0017 (as text; the live run is the
// user's), the link builder and the public route. The SQL behaviour itself is
// proven on the live project after applying (read-only check in 110-06-SUMMARY).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { einladungsLink } from '@core/api/zugriff';
import { istOeffentlicherWeg } from '@core/lib/oeffentlicheWege';
import { SOLL } from '../../scripts/grants-pruefen.mjs';

const WURZEL = path.resolve(import.meta.dirname, '..', '..');
const SQL = fs.readFileSync(path.join(WURZEL, 'supabase/migrations/0017_einladungscodes.sql'), 'utf8');
const RUECK = fs.readFileSync(path.join(WURZEL, 'supabase/rueckweg/0017_down.sql'), 'utf8');

describe('0017 — Einladungscodes', () => {
  it('nur der Hash wird gespeichert, die Tabelle hat keine Client-Schreibrechte', () => {
    assert.match(SQL, /code_hash\s+text not null unique/);
    assert.doesNotMatch(SQL, /\bcode\s+text not null/, 'keine Klartext-Spalte');
    assert.match(SQL, /revoke all on public\.einladungscode from public, anon, authenticated;/);
    assert.match(SQL, /grant select on public\.einladungscode to authenticated;/);
    assert.doesNotMatch(SQL, /grant (insert|update|delete)[^;]*einladungscode to authenticated/);
  });
  it('erstellen nur als owner, einlösen nie für interne Mitglieder, keine internen Rechte', () => {
    const erst = SQL.slice(SQL.indexOf('create function public.einladungscode_erstellen'), SQL.indexOf('create function public.einladungscode_einloesen'));
    assert.match(erst, /rolle_in\(org_id\), ''\) = 'owner'/);
    const ein = SQL.slice(SQL.indexOf('create function public.einladungscode_einloesen'), SQL.indexOf('create function public.einladungscode_widerrufen'));
    assert.match(ein, /v_rolle in \('owner', 'planner', 'leser', 'admin', 'mitglied'\)/);
    assert.match(ein, /can_edit_model = false, can_export_ifc = false,\s+can_view_audit_reports = false, can_submit_bid = false/);
    assert.match(ein, /gueltig_bis > now\(\) and nutzungen < max_nutzungen/);
    const code = SQL.split(/\r?\n/).filter((z) => !z.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(code, /gen_random_bytes\(/, 'pgcrypto liegt auf Supabase im Schema extensions');
  });
  it('jede Client-Funktion in SOLL, Hash-Funktion nicht für Clients, Rückweg vollständig', () => {
    const granted = [...SQL.matchAll(/grant execute on function public\.([a-z_]+)\([^)]*\) to authenticated/g)].map((m) => m[1]);
    const soll = SOLL.filter((s) => s.startsWith('authenticated|function|')).map((s) => s.split('|')[2].split('(')[0]);
    assert.deepEqual(granted.sort(), ['einladungscode_einloesen', 'einladungscode_erstellen', 'einladungscode_widerrufen']);
    for (const f of granted) assert.ok(soll.includes(f), f);
    assert.ok(!soll.includes('einladungscode_hash'));
    assert.ok(SOLL.includes('authenticated|table|einladungscode|SELECT'));
    for (const m of SQL.matchAll(/^create function public\.([a-z_]+)\(/gm)) {
      assert.match(RUECK, new RegExp(`drop function if exists public\\.${m[1]}\\(`), m[1]);
    }
    assert.match(RUECK, /drop table if exists public\.einladungscode/);
  });
});

describe('Einladungslink und Route', () => {
  it('Link zeigt auf die öffentliche Seite /einladung, Code url-kodiert', () => {
    assert.equal(einladungsLink('ab12', 'https://bit-atelier.pages.dev'), 'https://bit-atelier.pages.dev/einladung?code=ab12');
    assert.equal(einladungsLink('a b', 'https://x.de'), 'https://x.de/einladung?code=a%20b');
    assert.equal(istOeffentlicherWeg('/einladung'), true);
  });
  it('App.jsx rendert /einladung im öffentlichen Zweig', () => {
    const app = fs.readFileSync(path.join(WURZEL, 'src/App.jsx'), 'utf8');
    assert.match(app, /<Route path="\/einladung" element={<Einladung \/>} \/>/);
  });
});
